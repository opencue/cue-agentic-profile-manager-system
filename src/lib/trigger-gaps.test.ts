import { describe, expect, test } from "bun:test";

import { computeTriggerGaps } from "./trigger-gaps";
import type { ParsedSkill } from "./skill-router";

function skill(id: string, name: string, triggers: string[]): ParsedSkill {
  return {
    id, name, triggers,
    capability: "", capabilityExplicit: false, whenToInvoke: [], notFor: "",
    rawDescription: "", quality: "good", missing: false,
  };
}

describe("computeTriggerGaps", () => {
  test("flags skill whose trigger appears in prompts but never fires", () => {
    const skills = [skill("plan/investigate", "investigate", ["fix this bug", "debug this"])];
    const prompts = [
      "please fix this bug in checkout",
      "can you debug this weird crash",
      "fix this bug i'm seeing on safari",
    ];
    const rows = computeTriggerGaps({
      skills, userPrompts: prompts, hits: new Map([["plan/investigate", 0]]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "plan/investigate",
      matchedPrompts: 3,
      recordedHits: 0,
      gap: 3,
    });
    expect(rows[0]!.sampleTriggers.length).toBeGreaterThan(0);
  });

  test("no gap when hits match or exceed matched prompts", () => {
    const skills = [skill("plan/investigate", "investigate", ["debug this"])];
    const prompts = ["debug this", "debug this"];
    expect(
      computeTriggerGaps({
        skills, userPrompts: prompts, hits: new Map([["plan/investigate", 2]]),
      }),
    ).toEqual([]);
    expect(
      computeTriggerGaps({
        skills, userPrompts: prompts, hits: new Map([["plan/investigate", 5]]),
      }),
    ).toEqual([]);
  });

  test("matches hits by full id OR by bare slug", () => {
    const skills = [skill("plan/investigate", "investigate", ["debug this"])];
    const prompts = ["debug this", "debug this"];
    // Hit recorded under bare slug — should still credit.
    expect(
      computeTriggerGaps({
        skills, userPrompts: prompts, hits: new Map([["investigate", 2]]),
      }),
    ).toEqual([]);
  });

  test("triggers shorter than minTriggerLength are ignored", () => {
    const skills = [skill("x", "x", ["go", "do"])];
    const prompts = ["go do something"];
    expect(
      computeTriggerGaps({
        skills, userPrompts: prompts, hits: new Map(),
      }),
    ).toEqual([]);
  });

  test("matching is case-insensitive", () => {
    const skills = [skill("x", "x", ["Fix This Bug"])];
    const prompts = ["please FIX THIS BUG asap"];
    const rows = computeTriggerGaps({
      skills, userPrompts: prompts, hits: new Map(),
    });
    expect(rows[0]?.gap).toBe(1);
  });

  test("each prompt is counted at most once per skill (multiple matching triggers don't double-count)", () => {
    const skills = [skill("x", "x", ["fix this", "this bug"])];
    const prompts = ["please fix this bug"]; // matches BOTH triggers
    const rows = computeTriggerGaps({
      skills, userPrompts: prompts, hits: new Map(),
    });
    expect(rows[0]?.matchedPrompts).toBe(1);
  });

  test("rows sorted by gap DESC, then by matchedPrompts DESC", () => {
    const skills = [
      skill("a", "a", ["alpha keyword"]),
      skill("b", "b", ["beta keyword"]),
      skill("c", "c", ["gamma keyword"]),
    ];
    const prompts = [
      "alpha keyword 1", "alpha keyword 2",   // a: 2 matches
      "beta keyword 1", "beta keyword 2", "beta keyword 3", // b: 3 matches
      "gamma keyword 1",                       // c: 1 match
    ];
    const rows = computeTriggerGaps({
      skills, userPrompts: prompts, hits: new Map(),
    });
    expect(rows.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  test("word-boundary: single-word trigger does NOT match inside a larger word", () => {
    const skills = [skill("meta/analyze", "analyze", ["analyze"])];
    // "reanalyze" / "analyzer" must not count as the bare word "analyze".
    const prompts = ["please reanalyze the data", "run the analyzer"];
    expect(
      computeTriggerGaps({ skills, userPrompts: prompts, hits: new Map() }),
    ).toEqual([]);
  });

  test("word-boundary: 'help' does not match 'helpful' / 'helper'", () => {
    const skills = [skill("meta/help", "help", ["help"])];
    const prompts = ["that was helpful", "ask the helper agent"];
    expect(
      computeTriggerGaps({ skills, userPrompts: prompts, hits: new Map() }),
    ).toEqual([]);
  });

  test("weak single-word trigger only counts when it dominates a short prompt", () => {
    const skills = [skill("meta/help", "help", ["help"])];
    const longPrompt =
      "i need some help refactoring this enormous function that spans several files and modules";
    expect(longPrompt.length).toBeGreaterThan(80);
    // Long prompt that merely contains "help" → not an invocation.
    expect(
      computeTriggerGaps({ skills, userPrompts: [longPrompt], hits: new Map() }),
    ).toEqual([]);
    // Short, trigger-dominant prompt → genuine.
    const rows = computeTriggerGaps({
      skills, userPrompts: ["help"], hits: new Map(),
    });
    expect(rows[0]?.gap).toBe(1);
  });

  test("slash-command trigger matches at any prompt length", () => {
    const skills = [skill("caveman/caveman", "caveman", ["/caveman"])];
    const longPrompt =
      "please switch to /caveman mode because this explanation has gotten far too verbose for me";
    expect(longPrompt.length).toBeGreaterThan(80);
    const rows = computeTriggerGaps({
      skills, userPrompts: [longPrompt], hits: new Map(),
    });
    expect(rows[0]?.gap).toBe(1);
  });

  test("multi-word trigger matches at any length (word-boundary, not substring)", () => {
    const skills = [skill("caveman/caveman-commit", "caveman-commit", ["commit message"])];
    const longPrompt =
      "after you finish the refactor, write a clear commit message that explains the reasoning behind it";
    expect(longPrompt.length).toBeGreaterThan(80);
    const rows = computeTriggerGaps({
      skills, userPrompts: [longPrompt], hits: new Map(),
    });
    expect(rows[0]?.gap).toBe(1);
  });

  test("weakTriggerMaxPromptChars is configurable", () => {
    const skills = [skill("meta/help", "help", ["help"])];
    const prompt = "help me please"; // 14 chars
    // Default (80) → counts.
    expect(
      computeTriggerGaps({ skills, userPrompts: [prompt], hits: new Map() })[0]?.gap,
    ).toBe(1);
    // Tightened to 4 → the 14-char prompt is now "too long" for a weak trigger.
    expect(
      computeTriggerGaps({
        skills, userPrompts: [prompt], hits: new Map(), weakTriggerMaxPromptChars: 4,
      }),
    ).toEqual([]);
  });

  test("limit caps the row count", () => {
    const skills = Array.from({ length: 5 }, (_, i) =>
      skill(`s${i}`, `s${i}`, [`trigger phrase ${i}`]),
    );
    const prompts = skills.map((_, i) => `trigger phrase ${i}`);
    const rows = computeTriggerGaps({
      skills, userPrompts: prompts, hits: new Map(), limit: 3,
    });
    expect(rows.length).toBe(3);
  });
});
