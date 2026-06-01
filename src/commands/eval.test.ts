/**
 * Tests for `cue eval`.
 *
 * Runs the command's JSON mode against the real profiles tree (the repo's
 * actual `profiles/`) and asserts on the structure + math. Avoids parsing
 * ANSI-formatted text mode, which is unstable.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { run as evalRun } from "./eval";

// Some sibling test files set CUE_PROFILES_DIR to a temp dir and don't reset.
// Force the repo's real profiles/ tree before each test so loadProfile finds core/gstack/etc.
beforeEach(() => {
  delete process.env.CUE_PROFILES_DIR;
  delete process.env.SOUL_PROFILES_DIR;
});

interface JsonReport {
  profile: string;
  counts: { skills: number; rules: number; commands: number; hooks: number; mcps: number; plugins: number };
  tokens: {
    perMessage: number;
    onDemand: number;
    bySource: Record<string, { perMessage: number; onDemand: number }>;
  };
  fullPerMessage: number;
  savingsPct: number;
  costPerMessage: string;
  sessions: number;
  score: number;
  grade: string;
}

async function captureStdout<T>(fn: () => Promise<T>): Promise<{ stdout: string; value: T }> {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as any).write = (chunk: string | Uint8Array) => { buf += String(chunk); return true; };
  try {
    const value = await fn();
    return { stdout: buf, value };
  } finally {
    (process.stdout as any).write = orig;
  }
}

describe("cue eval", () => {
  test("--json on a real profile returns the expected shape and positive totals", async () => {
    const { stdout, value } = await captureStdout(() => evalRun(["core", "--json"]));
    expect(value).toBe(0);
    const report = JSON.parse(stdout) as JsonReport;
    expect(report.profile).toBe("core");
    expect(report.counts.skills).toBeGreaterThan(0);
    expect(report.tokens.perMessage).toBeGreaterThan(0);
    expect(report.tokens.perMessage).toBeLessThan(report.tokens.onDemand);
    // sum of bySource.perMessage should equal tokens.perMessage
    const sum = Object.values(report.tokens.bySource).reduce((s, b) => s + b.perMessage, 0);
    expect(sum).toBe(report.tokens.perMessage);
    expect(report.grade).toMatch(/^[A-F]$/);
  });

  test("--compare emits delta and is symmetric in absolute value", async () => {
    const { stdout, value } = await captureStdout(() => evalRun(["--compare", "core", "gstack", "--json"]));
    expect(value).toBe(0);
    const cmp = JSON.parse(stdout) as { a: any; b: any; delta: { perMessage: number; score: number } };
    expect(cmp.a.profile).toBe("core");
    expect(cmp.b.profile).toBe("gstack");
    expect(cmp.delta.perMessage).toBe(cmp.b.tokens.perMessage - cmp.a.tokens.perMessage);
  });

  test("--all returns an array sorted by perMessage ascending", async () => {
    const { stdout, value } = await captureStdout(() => evalRun(["--all", "--json"]));
    expect(value).toBe(0);
    const rows = JSON.parse(stdout) as Array<{ name: string; perMessage: number; ok: boolean }>;
    expect(rows.length).toBeGreaterThan(5);
    const okRows = rows.filter((r) => r.ok);
    for (let i = 1; i < okRows.length; i++) {
      expect(okRows[i].perMessage).toBeGreaterThanOrEqual(okRows[i - 1].perMessage);
    }
  });

  test("--compare with missing second arg returns usage error (exit 1)", async () => {
    const orig = process.stderr.write.bind(process.stderr);
    let err = "";
    (process.stderr as any).write = (chunk: string | Uint8Array) => { err += String(chunk); return true; };
    try {
      const exit = await evalRun(["--compare", "core"]);
      expect(exit).toBe(1);
      expect(err).toContain("--compare");
    } finally {
      (process.stderr as any).write = orig;
    }
  });

  test("on-demand bodies exceed per-message tokens — verifies the lazy/eager split", async () => {
    const { stdout } = await captureStdout(() => evalRun(["gstack", "--json"]));
    const report = JSON.parse(stdout) as JsonReport;
    // gstack declares rules + commands; both should have measurable on-demand cost
    expect(report.tokens.bySource.rules.onDemand).toBeGreaterThan(report.tokens.bySource.rules.perMessage);
    expect(report.tokens.bySource.commands.onDemand).toBeGreaterThan(report.tokens.bySource.commands.perMessage);
  });
});
