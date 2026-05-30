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
