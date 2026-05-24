/**
 * Tests for `cue eval-behavior` — purely structural, no LLM or live commands.
 * Uses the real profile tree because the loader is happy to find existing
 * scenarios under resources/evals/.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { run as evalRun } from "./eval-behavior";

beforeEach(() => {
  // Some sibling tests redirect CUE_PROFILES_DIR — restore so loadProfile finds real profiles.
  delete process.env.CUE_PROFILES_DIR;
  delete process.env.SOUL_PROFILES_DIR;
});

async function capture<T>(fn: () => Promise<T>): Promise<{ stdout: string; value: T }> {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as any).write = (c: string | Uint8Array) => { buf += String(c); return true; };
  try { const value = await fn(); return { stdout: buf, value }; }
  finally { (process.stdout as any).write = orig; }
}

describe("cue eval-behavior", () => {
  test("core passes both seeded scenarios", async () => {
    const { stdout, value } = await capture(() => evalRun(["core", "--json"]));
    expect(value).toBe(0);
    const reports = JSON.parse(stdout) as Array<{ profile: string; results: Array<{ scenario: string; passed: boolean; score: number; max: number }> }>;
    expect(reports).toHaveLength(1);
    expect(reports[0]!.profile).toBe("core");
    expect(reports[0]!.results.length).toBeGreaterThan(0);
    for (const r of reports[0]!.results) {
      expect(r.passed).toBe(true);
      expect(r.score).toBeGreaterThan(0);
    }
  });

  test("explicit profile arg evaluates that profile and reports its inherited scenarios", async () => {
    // Every profile inheriting core now picks up the seeded evals.
    const { stdout, value } = await capture(() => evalRun(["frontend", "--json"]));
    expect(value === 0 || value === 1).toBe(true);
    const reports = JSON.parse(stdout) as Array<{ profile: string; results: Array<{ scenario: string }> }>;
    expect(reports[0]!.profile).toBe("frontend");
    // frontend inherits core, so the core-declared scenarios show up here too.
    const scenarioNames = reports[0]!.results.map((r) => r.scenario);
    expect(scenarioNames).toContain("feature-shipping");
  });

  test("--all runs across every profile + JSON output is well-formed", async () => {
    const { stdout, value } = await capture(() => evalRun(["--all", "--json"]));
    expect(value === 0 || value === 1).toBe(true);  // 1 if any profile fails
    const reports = JSON.parse(stdout);
    expect(Array.isArray(reports)).toBe(true);
    expect(reports.length).toBeGreaterThan(5);
  });
});
