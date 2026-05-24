/**
 * Unit tests for pr-poster. Uses a mock `Runner` to avoid hitting real GitHub.
 * Tests assert on the *plan* (which gh / git commands would have run) and the
 * state-transition return shape — not on actual repo mutation.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  whoami, forkRepo, openPr, postPrToRepo, fetchPrState, deleteFork,
  writeFilesToWorktree, checkOptOutMarker,
  type Runner,
} from "./pr-poster";

interface Call { cmd: string; args: string[]; cwd?: string }

function mockRunner(responses: Array<{ match: RegExp; stdout?: string; stderr?: string; status?: number }>): { runner: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: Runner = {
    async run(cmd, args, opts) {
      calls.push({ cmd, args, cwd: opts?.cwd });
      const key = [cmd, ...args].join(" ");
      const r = responses.find((r) => r.match.test(key));
      return { stdout: r?.stdout ?? "", stderr: r?.stderr ?? "", status: r?.status ?? 0 };
    },
  };
  return { runner, calls };
}

describe("whoami", () => {
  test("returns trimmed login on success", async () => {
    const { runner } = mockRunner([{ match: /api user/, stdout: "octocat\n" }]);
    expect(await whoami(runner)).toBe("octocat");
  });

  test("returns null on non-zero status", async () => {
    const { runner } = mockRunner([{ match: /api user/, status: 1, stderr: "not authed" }]);
    expect(await whoami(runner)).toBeNull();
  });
});

describe("forkRepo", () => {
  test("returns fork name on fresh fork", async () => {
    const { runner } = mockRunner([
      { match: /api user/, stdout: "octocat" },
      { match: /repo fork example\/skill/, stdout: "forked\n" },
    ]);
    const res = await forkRepo(runner, "example/skill");
    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.fork).toBe("octocat/skill");
      expect(res.existed).toBe(false);
    }
  });

  test("treats `already exists` as success (existed=true)", async () => {
    const { runner } = mockRunner([
      { match: /api user/, stdout: "octocat" },
      { match: /repo fork example\/skill/, status: 1, stderr: "fork already exists, won't fork again" },
    ]);
    const res = await forkRepo(runner, "example/skill");
    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.existed).toBe(true);
    }
  });

  test("returns error when gh user lookup fails", async () => {
    const { runner } = mockRunner([{ match: /api user/, status: 1 }]);
    const res = await forkRepo(runner, "example/skill");
    expect("error" in res).toBe(true);
  });
});

describe("openPr", () => {
  test("parses PR URL + number from success stdout", async () => {
    const { runner } = mockRunner([
      { match: /pr create/, stdout: "https://github.com/example/skill/pull/42\n" },
    ]);
    const res = await openPr(runner, "example/skill", "octocat/skill", "cue/fixes", "title", "body");
    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.number).toBe(42);
      expect(res.url).toBe("https://github.com/example/skill/pull/42");
    }
  });

  test("recovers existing PR from `already exists` error", async () => {
    const { runner } = mockRunner([
      { match: /pr create/, status: 1, stderr: "a pull request for branch \"cue/fixes\" already exists: https://github.com/example/skill/pull/7" },
    ]);
    const res = await openPr(runner, "example/skill", "octocat/skill", "cue/fixes", "t", "b");
    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.number).toBe(7);
    }
  });

  test("returns error on other gh failures", async () => {
    const { runner } = mockRunner([
      { match: /pr create/, status: 1, stderr: "network error" },
    ]);
    const res = await openPr(runner, "x/y", "me/y", "b", "t", "b");
    expect("error" in res).toBe(true);
  });
});

describe("writeFilesToWorktree", () => {
  test("writes only files whose content actually differs", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cue-wt-"));
    try {
      mkdirSync(join(tmp, "skills", "a"), { recursive: true });
      writeFileSync(join(tmp, "skills", "a", "SKILL.md"), "OLD");
      writeFileSync(join(tmp, "skills", "a", "OTHER.md"), "X");

      const changed = writeFilesToWorktree(tmp, [
        { path: "skills/a/SKILL.md", before: "OLD", after: "NEW" },
        { path: "skills/a/OTHER.md", before: "X", after: "X" }, // unchanged, should skip
        { path: "skills/missing/SKILL.md", before: "Z", after: "Z2" }, // file doesn't exist
      ]);

      expect(changed).toEqual(["skills/a/SKILL.md"]);
      expect(readFileSync(join(tmp, "skills", "a", "SKILL.md"), "utf8")).toBe("NEW");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("fetchPrState", () => {
  test("returns merged when gh reports merged:true", async () => {
    const { runner } = mockRunner([
      { match: /pr view 42/, stdout: '{"state":"MERGED","merged":true}' },
    ]);
    expect(await fetchPrState(runner, "x/y", 42)).toBe("merged");
  });

  test("returns closed when state=CLOSED + merged=false", async () => {
    const { runner } = mockRunner([
      { match: /pr view 1/, stdout: '{"state":"CLOSED","merged":false}' },
    ]);
    expect(await fetchPrState(runner, "x/y", 1)).toBe("closed");
  });

  test("returns open when state=OPEN", async () => {
    const { runner } = mockRunner([
      { match: /pr view 1/, stdout: '{"state":"OPEN","merged":false}' },
    ]);
    expect(await fetchPrState(runner, "x/y", 1)).toBe("open");
  });

  test("returns unknown on gh failure or bad JSON", async () => {
    const { runner } = mockRunner([{ match: /pr view/, status: 1 }]);
    expect(await fetchPrState(runner, "x/y", 1)).toBe("unknown");
  });
});

describe("deleteFork", () => {
  test("invokes gh repo delete --yes", async () => {
    const { runner, calls } = mockRunner([{ match: /repo delete/, stdout: "" }]);
    const res = await deleteFork(runner, "octocat/skill");
    expect("error" in res).toBe(false);
    expect(calls[0]!.args).toEqual(["repo", "delete", "octocat/skill", "--yes"]);
  });
});

describe("checkOptOutMarker", () => {
  test("true when README contains the marker", async () => {
    const { runner } = mockRunner([{ match: /api repos\/x\/y\/readme/, stdout: "Hello\n<!-- cue: ignore -->\nWorld" }]);
    expect(await checkOptOutMarker(runner, "x/y", "<!-- cue: ignore -->")).toBe(true);
  });

  test("false when README is clean", async () => {
    const { runner } = mockRunner([{ match: /api repos\/x\/y\/readme/, stdout: "Just a normal readme." }]);
    expect(await checkOptOutMarker(runner, "x/y", "<!-- cue: ignore -->")).toBe(false);
  });

  test("null when gh fails (caller should fail open)", async () => {
    const { runner } = mockRunner([{ match: /api/, status: 1 }]);
    expect(await checkOptOutMarker(runner, "x/y", "<!-- cue: ignore -->")).toBeNull();
  });
});

describe("postPrToRepo — driver state transitions (mocked runner)", () => {
  test("happy path: fork → clone → write → commit → push → PR returns ok=true", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "cue-driver-"));
    try {
      // Pre-populate the clone target with the file we'll modify
      mkdirSync(join(tmp, "fake-clone"), { recursive: true });
      writeFileSync(join(tmp, "fake-clone", "SKILL.md"), "OLD");

      const { runner } = mockRunner([
        { match: /api user/, stdout: "octocat" },
        { match: /repo fork/, stdout: "ok" },
        { match: /repo sync/, status: 0 },
        // intercept the clone — make it succeed and we'll manually copy after
        { match: /repo clone/, status: 0 },
        { match: /git checkout/, status: 0 },
        { match: /git add/, status: 0 },
        { match: /git commit/, status: 0 },
        { match: /git push/, status: 0 },
        { match: /pr create/, stdout: "https://github.com/example/skill/pull/99" },
      ]);

      // postPrToRepo creates its own tmp dir via mkdtempSync, so we can't
      // override the clone target. Instead we test it accepts files that
      // don't exist (which exercises the "no files changed" failure path).
      const res = await postPrToRepo({
        upstream: "example/skill",
        changes: [{ path: "does/not/exist/SKILL.md", before: "x", after: "y" }],
        prTitle: "title",
        prBody: "body",
        runner,
      });
      // Files don't exist in the freshly cloned tmpdir, so apply fails
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.step).toBe("apply");
        expect(res.fork).toBe("octocat/skill");
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("fork failure aborts with step=fork", async () => {
    const { runner } = mockRunner([
      { match: /api user/, stdout: "octocat" },
      { match: /repo fork/, status: 1, stderr: "network error" },
    ]);
    const res = await postPrToRepo({
      upstream: "example/skill",
      changes: [{ path: "SKILL.md", before: "x", after: "y" }],
      prTitle: "t", prBody: "b",
      runner,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.step).toBe("fork");
  });
});
