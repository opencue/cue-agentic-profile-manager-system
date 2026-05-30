/**
 * Pair affinity from local session history.
 *
 * Mines the on-disk session log (`~/.config/cue/session-log.jsonl`) for
 * composite picks like `medusa-vite+vite+backend` and surfaces "you usually
 * pair X with Y" suggestions. The picker uses this to pre-check companions
 * in the combine multiselect; `cue suggest-pairs` exposes the table directly.
 *
 * All reads are best-effort and crash-resistant: missing file → empty map,
 * malformed line → skipped. Telemetry must be enabled for any data to exist.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Resolved path mirrors `lib/telemetry-consent` to avoid a circular import. */
function sessionLogPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "cue", "session-log.jsonl");
}

interface SessionLogRow {
  ts?: string;
  profile?: string;
}

/**
 * Per-profile affinity record: how many sessions named this profile
 * (`picks`) and which other profiles co-occurred (`partners`).
 */
export interface ProfileAffinity {
  picks: number;
  partners: Map<string, number>;
}

export interface SuggestPartnersOptions {
  /**
   * Minimum number of times the partner must have co-occurred. Below this
   * the signal is too thin (one shared session shouldn't drive a
   * recommendation).
   */
  minCount?: number;
  /**
   * Minimum P(partner | profile) — fraction of `profile`'s sessions that
   * also included `partner`. Defaults to 0.5: only suggest partners that
   * appear in at least half the user's `profile` picks.
   */
  minAffinity?: number;
  /** Cap on returned suggestions (sorted by affinity DESC). */
  limit?: number;
}

export interface PartnerSuggestion {
  /** The recommended companion profile. */
  name: string;
  /** Count of joint occurrences with the primary profile. */
  count: number;
  /** P(partner | profile) in [0, 1]. */
  affinity: number;
}

const DEFAULT_OPTS: Required<SuggestPartnersOptions> = {
  minCount: 2,
  minAffinity: 0.5,
  limit: 5,
};

/**
 * Parse a composite selector into its constituent profile names. Trims and
 * drops empty parts so malformed entries like `+a+` resolve to `["a"]`.
 */
export function parseComposite(selector: string): string[] {
  return selector
    .split("+")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Read the session log and aggregate co-occurrence counts. Every composite
 * pick contributes one increment to each constituent profile's `picks` and
 * one to every ordered pair's partner count.
 *
 * `readLines` is exposed for tests so we don't have to write a tempfile.
 */
export function computeAffinityMap(
  readLines: () => string[] = defaultReadLines,
): Map<string, ProfileAffinity> {
  const map = new Map<string, ProfileAffinity>();
  for (const line of readLines()) {
    if (!line.trim()) continue;
    let row: SessionLogRow;
    try {
      row = JSON.parse(line) as SessionLogRow;
    } catch {
      continue; // malformed JSONL line — skip
    }
    if (!row.profile) continue;
    const parts = parseComposite(row.profile);
    if (parts.length === 0) continue;
    // Increment own picks for every part.
    for (const part of parts) {
      const entry = map.get(part) ?? { picks: 0, partners: new Map() };
      entry.picks++;
      map.set(part, entry);
    }
    // Pairwise co-occurrence (skip self-pairs).
    if (parts.length < 2) continue;
    for (const a of parts) {
      const entry = map.get(a)!;
      for (const b of parts) {
        if (a === b) continue;
        entry.partners.set(b, (entry.partners.get(b) ?? 0) + 1);
      }
    }
  }
  return map;
}

/**
 * Top-N partners for `profile` ranked by affinity. Returns empty array when
 * the profile has insufficient history (`< minCount` total picks of itself).
 */
export function suggestPartnersFor(
  profile: string,
  affinity: Map<string, ProfileAffinity>,
  opts: SuggestPartnersOptions = {},
): PartnerSuggestion[] {
  const o = { ...DEFAULT_OPTS, ...opts };
  const entry = affinity.get(profile);
  if (!entry || entry.picks < o.minCount) return [];
  const out: PartnerSuggestion[] = [];
  for (const [name, count] of entry.partners) {
    if (count < o.minCount) continue;
    const a = count / entry.picks;
    if (a < o.minAffinity) continue;
    out.push({ name, count, affinity: a });
  }
  out.sort((x, y) => y.affinity - x.affinity || y.count - x.count || x.name.localeCompare(y.name));
  return out.slice(0, o.limit);
}

/**
 * Convenience: precompute pair suggestions for every profile in the
 * affinity map. Used by the picker so runPicker doesn't have to re-scan
 * once per first-pick.
 */
export function suggestionsByProfile(
  affinity: Map<string, ProfileAffinity>,
  opts: SuggestPartnersOptions = {},
): Map<string, PartnerSuggestion[]> {
  const out = new Map<string, PartnerSuggestion[]>();
  for (const name of affinity.keys()) {
    const sug = suggestPartnersFor(name, affinity, opts);
    if (sug.length > 0) out.set(name, sug);
  }
  return out;
}

function defaultReadLines(): string[] {
  const path = sessionLogPath();
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8").split("\n");
  } catch {
    return [];
  }
}
