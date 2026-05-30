/**
 * Trigger-gap detection.
 *
 * A "gap" = a user prompt that should have fired a skill (it contains one
 * of the skill's declared trigger phrases) but no corresponding skill_hit
 * event was recorded. Surfaces under-triggering skills so profile authors
 * can sharpen the description or add triggers.
 *
 * Pure module: takes events + skill metadata, returns rows. Transcript
 * scanning + I/O live in `src/commands/trigger-gaps.ts`.
 */

import type { ParsedSkill } from "./skill-router";

export interface TriggerGapRow {
  /** Skill id (full `category/slug`). */
  id: string;
  /** Skill display name (slug). */
  name: string;
  /** User prompts that matched a declared trigger phrase. */
  matchedPrompts: number;
  /** skill_hit events recorded for this skill (over the same window). */
  recordedHits: number;
  /**
   * matchedPrompts - recordedHits, floored at 0. A positive number means the
   * trigger was uttered but the skill didn't actually fire — bad routing.
   */
  gap: number;
  /** Sample trigger phrases that drove the match (up to 3). */
  sampleTriggers: string[];
}

export interface ComputeGapsInput {
  /** Skills declared by the profile (parsed via parseSkillFromDir). */
  skills: ParsedSkill[];
  /** User-role prompts from transcripts in the window, lowercased. */
  userPrompts: string[];
  /**
   * Hit counts per skill id. Either the full id or the bare slug works —
   * the lookup tries both, matching the same convention as skill-report.
   */
  hits: Map<string, number>;
  /**
   * Minimum trigger length to consider. Avoids one- or two-character
   * triggers (e.g. `"go"`) matching every prompt. Default 4.
   */
  minTriggerLength?: number;
  /** Cap on returned rows (sorted by gap DESC). Default 10. */
  limit?: number;
}

/**
 * Compute the per-skill gap table. Designed for "user mostly says these
 * things, here's which skills should fire but aren't" — not a high-precision
 * detector (substring matching has false positives), but tight enough to
 * surface real problems when the gap count is large.
 */
export function computeTriggerGaps(input: ComputeGapsInput): TriggerGapRow[] {
  const minLen = input.minTriggerLength ?? 4;
  const limit = input.limit ?? 10;
  const promptsLower = input.userPrompts.map((p) => p.toLowerCase());

  const rows: TriggerGapRow[] = [];
  for (const skill of input.skills) {
    const triggers = (skill.triggers ?? []).filter((t) => t.length >= minLen);
    if (triggers.length === 0) continue;

    let matched = 0;
    const samples = new Set<string>();
    for (const prompt of promptsLower) {
      for (const t of triggers) {
        if (prompt.includes(t.toLowerCase())) {
          matched++;
          if (samples.size < 3) samples.add(t);
          break;
        }
      }
    }
    if (matched === 0) continue;

    const hits = input.hits.get(skill.id) ?? input.hits.get(skill.name) ?? 0;
    const gap = Math.max(0, matched - hits);
    if (gap === 0) continue;
    rows.push({
      id: skill.id,
      name: skill.name,
      matchedPrompts: matched,
      recordedHits: hits,
      gap,
      sampleTriggers: [...samples],
    });
  }
  rows.sort((a, b) => b.gap - a.gap || b.matchedPrompts - a.matchedPrompts);
  return rows.slice(0, limit);
}
