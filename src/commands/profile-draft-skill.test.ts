/**
 * Tests for `cue profile draft-skill` — covers the help path and the
 * empty-corpus path. The Claude-call path is exercised through the underlying
 * cluster-skills lib and skill-subset (already tested) — no point mocking
 * claude --print here since the fail-open behavior is the contract that
 * matters.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = join(tmpdir(), `cue-draft-skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const ORIG_XDG = process.env.XDG_CONFIG_HOME;

beforeAll(() => {
  mkdirSync(join(TMP, "cue"), { recursive: true });
  process.env.XDG_CONFIG_HOME = TMP;
});

afterAll(() => {
  if (ORIG_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIG_XDG;
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
});

function captureStdout<T>(fn: () => Promise<T>): Promise<{ result: T; out: string }> {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as any).write = (chunk: string | Uint8Array) => { buf += String(chunk); return true; };
  return fn()
    .then(result => ({ result, out: buf }))
    .finally(() => { (process.stdout as any).write = orig; });
}

describe("cue profile draft-skill", () => {
  test("--help prints usage", async () => {
    const { run } = await import("./profile-draft-skill");
    const { result, out } = await captureStdout(() => run(["--help"]));
    expect(result).toBe(0);
    expect(out).toContain("cue profile draft-skill");
    expect(out).toContain("first-prompts");
    expect(out).toContain("--dry-run");
  });

  test("with no captured prompts → reports nothing to draft (non-error)", async () => {
    const { run } = await import("./profile-draft-skill");
    const { result, out } = await captureStdout(() => run([]));
    expect(result).toBe(0);
    expect(out).toContain("No first-prompts captured");
  });

  test("with synthetic captured prompts < minSize → reports insufficient data", async () => {
    const dir = join(TMP, "cue", "first-prompts");
    mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString();
    writeFileSync(join(dir, "aaa.json"), JSON.stringify({
      ts, cwd: "/x", session_id: "s1", prompt: "fix the auth bug in the OAuth flow",
    }));
    writeFileSync(join(dir, "bbb.json"), JSON.stringify({
      ts, cwd: "/y", session_id: "s2", prompt: "add unit tests for the rust crate",
    }));
    // Only 2 prompts — below the default minSize of 3.

    const { run } = await import("./profile-draft-skill");
    const { result, out } = await captureStdout(() => run([]));
    expect(result).toBe(0);
    expect(out).toContain("need ≥3");
  });

  test("with ≥3 similar captured prompts + --no-claude + --dry-run → reports clusters without writing", async () => {
    const dir = join(TMP, "cue", "first-prompts");
    mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString();
    // Three prompts sharing "deploy" + "coolify" → one cluster
    const prompts = [
      { id: "c", prompt: "deploy this app via coolify to my VPS" },
      { id: "d", prompt: "deploy the new build to coolify production" },
      { id: "e", prompt: "set up coolify deploy with environment variables" },
    ];
    for (const p of prompts) {
      writeFileSync(join(dir, `${p.id}.json`), JSON.stringify({
        ts, cwd: `/x-${p.id}`, session_id: `s-${p.id}`, prompt: p.prompt,
      }));
    }

    const { run } = await import("./profile-draft-skill");
    const { result, out } = await captureStdout(() => run(["--no-claude", "--dry-run"]));
    expect(result).toBe(0);
    expect(out).toContain("session pattern cluster");
    expect(out).toContain("[dry-run]");
    // The cluster term should be a content word from the shared prompts.
    expect(out.toLowerCase()).toMatch(/coolify|deploy/);
  });
});
