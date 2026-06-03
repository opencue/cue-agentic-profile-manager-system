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
  /**
   * A bare single-word trigger (e.g. "help", "analyze") that isn't a
   * slash-command only counts as a match when the prompt is at most this many
   * characters — i.e. the word plausibly *is* the request, not a substring of a
   * longer unrelated prompt. Multi-word and slash-command triggers match at any
   * length. Default 80.
   */
  weakTriggerMaxPromptChars?: number;
  /** Cap on returned rows (sorted by gap DESC). Default 10. */
  limit?: number;
}

const DEFAULT_MIN_TRIGGER_LENGTH = 4;
const DEFAULT_WEAK_TRIGGER_MAX_PROMPT_CHARS = 80;

/** A trigger is "weak" when it's a single bare word (no spaces) and not a
 *  slash-command — these are the ones that drown the metric in substring noise
 *  ("help" inside "help me", "analyze" inside "reanalyze"). */
function isWeakTrigger(triggerLower: string): boolean {
  return !/\s/.test(triggerLower) && !triggerLower.startsWith("/");
}

/**
 * Compile a trigger into a word-boundary matcher. Plain `String.includes` (the
 * old behavior) matched "analyze" inside "reanalyze" and "help" inside
 * "helpful"; `\b` doesn't work for triggers with leading punctuation
 * ("/caveman") or internal hyphens ("agent-to-agent"), so we anchor on
 * alphanumeric look-arounds instead: the trigger must not abut a word char.
 */
function compileTrigger(triggerLower: string): RegExp {
  const escaped = triggerLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9_])${escaped}(?![a-z0-9_])`);
}

/**
 * Compute the per-skill gap table. Designed for "user mostly says these
 * things, here's which skills should fire but aren't" — not a high-precision
 * detector (substring matching has false positives), but tight enough to
 * surface real problems when the gap count is large.
 */
export function computeTriggerGaps(input: ComputeGapsInput): TriggerGapRow[] {
  const minLen = input.minTriggerLength ?? DEFAULT_MIN_TRIGGER_LENGTH;
  const limit = input.limit ?? 10;
  const weakMaxChars = input.weakTriggerMaxPromptChars ?? DEFAULT_WEAK_TRIGGER_MAX_PROMPT_CHARS;
  // Keep each prompt's length alongside its lowercased text for the weak-trigger
  // proportion check.
  const prompts = input.userPrompts.map((p) => ({ text: p.toLowerCase(), len: p.length }));

  const rows: TriggerGapRow[] = [];
  for (const skill of input.skills) {
    // Precompile each trigger's word-boundary matcher once (15k+ prompts × N
    // triggers per skill — compiling per prompt would be wasteful).
    const triggers = (skill.triggers ?? [])
      .filter((t) => t.length >= minLen)
      .map((t) => {
        const lower = t.toLowerCase();
        return { raw: t, re: compileTrigger(lower), weak: isWeakTrigger(lower) };
      });
    if (triggers.length === 0) continue;

    let matched = 0;
    const samples = new Set<string>();
    for (const prompt of prompts) {
      for (const t of triggers) {
        // A bare single word only counts when it dominates a short prompt.
        if (t.weak && prompt.len > weakMaxChars) continue;
        if (t.re.test(prompt.text)) {
          matched++;
          if (samples.size < 3) samples.add(t.raw);
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
