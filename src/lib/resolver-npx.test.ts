/**
 * Tests for resolver-npx.ts. Runs under `bun test`.
 *
 * The real `npx` is never invoked — every test injects a fake NpxFetchFn via
 * `opts.fetch`. Cache root is a tmpdir per test, never profiles/_cache/.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Profile } from "../../profiles/_types";
import {
  CacheCorrupt,
  NpxFetchFailed,
  PinNotFound,
  cacheKey,
  resolveNpx,
  resolveNpxDetailed,
  type NpxFetchFn,
} from "./resolver-npx";
import { cachePath, cacheSkillPath } from "./cache";

// --- helpers ---------------------------------------------------------------

let repoRoot: string;
let calls: Array<{ repo: string; pin: string | undefined; skill: string; destDir: string }>;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "cue-test-"));
  // The resolver writes under <repoRoot>/profiles/_cache/npx/<key>/, so make
  // sure the parent dirs exist — cache.cachePut calls mkdirSync recursive.
  mkdirSync(join(repoRoot, "profiles", "_cache", "npx"), { recursive: true });
  calls = [];
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

/** Make a fetcher that drops a fake SKILL.md into <destDir>/<skill>/. */
function fakeFetcher(): NpxFetchFn {
  return async (repo, pin, skill, destDir) => {
    calls.push({ repo, pin, skill, destDir });
    const sk = join(destDir, skill);
    mkdirSync(sk, { recursive: true });
    writeFileSync(join(sk, "SKILL.md"), `# ${skill} from ${repo}@${pin ?? "HEAD"}\n`);
  };
}

/** Fetcher that always throws — used to assert "no fetch was called". */
const explodingFetcher: NpxFetchFn = async () => {
  throw new Error("fetcher invoked but should not have been");
};

function profile(npx: Profile["skills"] extends infer S ? NonNullable<S>["npx"] : never): Profile {
  return {
    name: "t",
    description: "test",
    skills: { npx },
  };
}

/** Pre-populate a cache slot for (repo, pin) with the given skills. */
function seedCache(repo: string, pin: string | undefined, skills: string[]): string {
  const key = cacheKey(repo, pin);
  const slot = cachePath({ repoRoot }, key);
  mkdirSync(slot, { recursive: true });
  for (const s of skills) {
    const d = join(slot, s);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "SKILL.md"), `# ${s}\n`);
  }
  return key;
}

// --- cache-key scheme ------------------------------------------------------

describe("cacheKey", () => {
  it("uses sha256(repo + (pin || 'HEAD'))", () => {
    expect(cacheKey("anthropics/skills", undefined)).toBe(
      createHash("sha256").update("anthropics/skillsHEAD").digest("hex"),
    );
    expect(cacheKey("anthropics/skills", "tag@v1.2.3")).toBe(
      createHash("sha256").update("anthropics/skillstag@v1.2.3").digest("hex"),
    );
    expect(cacheKey("anthropics/skills", "git@abcdef0")).toBe(
      createHash("sha256").update("anthropics/skillsgit@abcdef0").digest("hex"),
    );
  });

  it("produces distinct keys for distinct pins on the same repo", () => {
    const a = cacheKey("anthropics/skills", undefined);
    const b = cacheKey("anthropics/skills", "tag@v1.0.0");
    const c = cacheKey("anthropics/skills", "git@deadbeef");
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

// --- cache hit / miss ------------------------------------------------------

describe("resolveNpx — cache behavior", () => {
  it("returns LinkPlans without calling fetch when cache is fully populated", async () => {
    seedCache("anthropics/skills", undefined, ["pdf", "xlsx"]);
    const plans = await resolveNpx(
      profile([{ repo: "anthropics/skills", skills: ["pdf", "xlsx"] }]),
      { repoRoot, fetch: explodingFetcher },
    );
    expect(plans).toHaveLength(2);
    expect(calls).toHaveLength(0); // exploder would have thrown if called
    expect(plans[0]).toMatchObject({
      target: ".claude/skills/pdf",
      origin: "npx",
    });
    expect(plans[0].source.endsWith("/pdf")).toBe(true);
  });

  it("fetches on cache miss and publishes to the cache slot", async () => {
    const fetcher = fakeFetcher();
    const plans = await resolveNpx(
      profile([{ repo: "anthropics/skills", skills: ["pdf"] }]),
      { repoRoot, fetch: fetcher },
    );
    expect(plans).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].skill).toBe("pdf");
    const key = cacheKey("anthropics/skills", undefined);
    expect(existsSync(join(cachePath({ repoRoot }, key), "pdf", "SKILL.md"))).toBe(true);
  });

  it("a second resolve after a fetch is a pure cache hit", async () => {
    const fetcher = fakeFetcher();
    const prof = profile([{ repo: "anthropics/skills", skills: ["pdf"] }]);

    await resolveNpx(prof, { repoRoot, fetch: fetcher });
    expect(calls).toHaveLength(1);

    // Reset the call log and try again — should not re-fetch.
    calls.length = 0;
    const plans = await resolveNpx(prof, { repoRoot, fetch: explodingFetcher });
    expect(calls).toHaveLength(0);
    expect(plans).toHaveLength(1);
  });

  it("returns [] for a profile with no npx entries", async () => {
    const plans = await resolveNpx({ name: "t", description: "" }, {
      repoRoot,
      fetch: explodingFetcher,
    });
    expect(plans).toEqual([]);
  });
});

// --- offline mode ----------------------------------------------------------

describe("resolveNpx — offline mode", () => {
  it("fails hard on cache miss when offline=true", async () => {
    const p = profile([{ repo: "anthropics/skills", skills: ["pdf"] }]);
    await expect(
      resolveNpx(p, { repoRoot, fetch: explodingFetcher, offline: true }),
    ).rejects.toBeInstanceOf(NpxFetchFailed);
    expect(calls).toHaveLength(0);
  });

  it("still serves cache hits when offline=true", async () => {
    seedCache("anthropics/skills", undefined, ["pdf"]);
    const plans = await resolveNpx(
      profile([{ repo: "anthropics/skills", skills: ["pdf"] }]),
      { repoRoot, fetch: explodingFetcher, offline: true },
    );
    expect(plans).toHaveLength(1);
  });

  it("treats partial cache as CacheCorrupt under offline=true", async () => {
    // Seed only "pdf"; request "pdf" + "xlsx".
    seedCache("anthropics/skills", undefined, ["pdf"]);
    await expect(
      resolveNpx(
        profile([{ repo: "anthropics/skills", skills: ["pdf", "xlsx"] }]),
        { repoRoot, fetch: explodingFetcher, offline: true },
      ),
    ).rejects.toBeInstanceOf(CacheCorrupt);
  });

  it("honors SOUL_OFFLINE=1 env when opts.offline is undefined", async () => {
    const prev = process.env.SOUL_OFFLINE;
    process.env.SOUL_OFFLINE = "1";
    try {
      await expect(
        resolveNpx(
          profile([{ repo: "anthropics/skills", skills: ["pdf"] }]),
          { repoRoot, fetch: explodingFetcher },
        ),
      ).rejects.toBeInstanceOf(NpxFetchFailed);
    } finally {
      if (prev === undefined) delete process.env.SOUL_OFFLINE;
      else process.env.SOUL_OFFLINE = prev;
    }
  });
});

// --- pins ------------------------------------------------------------------

describe("resolveNpx — pin variants", () => {
  it("git@<sha> pin produces its own cache slot", async () => {
    const fetcher = fakeFetcher();
    await resolveNpx(
      profile([{ repo: "anthropics/skills", pin: "git@deadbeefcafe", skills: ["pdf"] }]),
      { repoRoot, fetch: fetcher },
    );
    expect(calls[0].pin).toBe("git@deadbeefcafe");
    const key = cacheKey("anthropics/skills", "git@deadbeefcafe");
    expect(existsSync(cachePath({ repoRoot }, key))).toBe(true);
    // HEAD slot should NOT exist
    const headKey = cacheKey("anthropics/skills", undefined);
    expect(existsSync(cachePath({ repoRoot }, headKey))).toBe(false);
  });

  it("tag@v1.2.3 pin produces its own cache slot", async () => {
    const fetcher = fakeFetcher();
    await resolveNpx(
      profile([{ repo: "anthropics/skills", pin: "tag@v1.2.3", skills: ["pdf"] }]),
      { repoRoot, fetch: fetcher },
    );
    expect(calls[0].pin).toBe("tag@v1.2.3");
    const key = cacheKey("anthropics/skills", "tag@v1.2.3");
    expect(existsSync(cacheSkillPath({ repoRoot }, key, "pdf"))).toBe(true);
  });

  it("different pins on same repo do not share cache slots", async () => {
    const fetcher = fakeFetcher();
    await resolveNpx(
      profile([
        { repo: "anthropics/skills", pin: "tag@v1.0.0", skills: ["pdf"] },
        { repo: "anthropics/skills", pin: "tag@v2.0.0", skills: ["pdf"] },
      ]),
      { repoRoot, fetch: fetcher },
    );
    expect(calls).toHaveLength(2);
    const k1 = cacheKey("anthropics/skills", "tag@v1.0.0");
    const k2 = cacheKey("anthropics/skills", "tag@v2.0.0");
    expect(k1).not.toBe(k2);
    expect(existsSync(cachePath({ repoRoot }, k1))).toBe(true);
    expect(existsSync(cachePath({ repoRoot }, k2))).toBe(true);
  });
});

// --- corrupt / pin-not-found -----------------------------------------------

describe("resolveNpx — error paths", () => {
  it("PinNotFound when fetcher silently produces no skill dir", async () => {
    const sneakyFetcher: NpxFetchFn = async () => {
      // does not create <destDir>/<skill>/ — simulates a bad pin where
      // `npx skills add` succeeds but ships nothing.
    };
    await expect(
      resolveNpx(
        profile([{ repo: "anthropics/skills", pin: "tag@bogus", skills: ["pdf"] }]),
        { repoRoot, fetch: sneakyFetcher },
      ),
    ).rejects.toBeInstanceOf(PinNotFound);
  });

  it("repairs a partial cache by re-fetching only the missing skills (online)", async () => {
    // Seed cache with "pdf" but request "pdf" + "xlsx".
    seedCache("anthropics/skills", undefined, ["pdf"]);
    const fetcher = fakeFetcher();
    const plans = await resolveNpx(
      profile([{ repo: "anthropics/skills", skills: ["pdf", "xlsx"] }]),
      { repoRoot, fetch: fetcher },
    );
    expect(plans).toHaveLength(2);
    // Only xlsx should have been fetched; pdf was warm.
    expect(calls.map((c) => c.skill)).toEqual(["xlsx"]);
    const key = cacheKey("anthropics/skills", undefined);
    expect(existsSync(cacheSkillPath({ repoRoot }, key, "pdf"))).toBe(true);
    expect(existsSync(cacheSkillPath({ repoRoot }, key, "xlsx"))).toBe(true);
  });

  it("propagates fetcher errors as NpxFetchFailed via the public surface", async () => {
    const failingFetcher: NpxFetchFn = async () => {
      throw new NpxFetchFailed("anthropics/skills", "synthetic boom");
    };
    await expect(
      resolveNpx(
        profile([{ repo: "anthropics/skills", skills: ["pdf"] }]),
        { repoRoot, fetch: failingFetcher },
      ),
    ).rejects.toBeInstanceOf(NpxFetchFailed);
  });
});

// --- detailed result -------------------------------------------------------

describe("resolveNpxDetailed", () => {
  it("returns cache keys keyed by repo@pin", async () => {
    seedCache("anthropics/skills", "tag@v1.0.0", ["pdf"]);
    const { plans, keys } = await resolveNpxDetailed(
      profile([{ repo: "anthropics/skills", pin: "tag@v1.0.0", skills: ["pdf"] }]),
      { repoRoot, fetch: explodingFetcher },
    );
    expect(plans).toHaveLength(1);
    expect(keys["anthropics/skills@tag@v1.0.0"]).toBe(
      cacheKey("anthropics/skills", "tag@v1.0.0"),
    );
  });
});
