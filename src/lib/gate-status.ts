/**
 * Quality-gate status persistence.
 *
 * The Stop-hook runner (`resources/hooks/cue-quality-gates.sh`) writes one
 * JSON file per profile to `~/.config/cue/gate-status/<profile>.json`.
 * This module is the TypeScript side of that contract: read the latest run
 * for a profile, surface it to `cue gates status`, the picker, and doctor.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface GateResult {
  name: string;
  ok: boolean;
  exit: number;
  /** First ~2KB of the gate's stderr — enough to surface the failure reason. */
  stderr: string;
}

export interface GateRun {
  ts: string;
  profile: string;
  overall: "pass" | "fail" | "skip";
  results: GateResult[];
}

export function gateStatusDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "cue", "gate-status");
}

/**
 * Stop-hook sanitizes profile selectors before naming files (since `+` is
 * usually safe but other chars aren't). Mirror that sanitization here so
 * reads find what the writer produced.
 */
export function gateStatusFile(profileSelector: string): string {
  const safe = profileSelector.replace(/[^A-Za-z0-9_+-]/g, "_");
  return join(gateStatusDir(), `${safe}.json`);
}

/** Returns null when no status has been written for this profile yet. */
export function readGateStatus(profileSelector: string): GateRun | null {
  const path = gateStatusFile(profileSelector);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as GateRun;
    if (!parsed.ts || !parsed.profile) return null;
    if (!Array.isArray(parsed.results)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Every persisted gate run on disk, newest first. Used by `cue gates status --all`. */
export function readAllGateStatus(): GateRun[] {
  const dir = gateStatusDir();
  if (!existsSync(dir)) return [];
  const runs: GateRun[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = readFileSync(join(dir, f), "utf8");
      const parsed = JSON.parse(raw) as GateRun;
      if (parsed.ts && parsed.profile && Array.isArray(parsed.results)) {
        runs.push(parsed);
      }
    } catch { /* skip malformed */ }
  }
  runs.sort((a, b) => b.ts.localeCompare(a.ts));
  return runs;
}

/** Ensure the directory exists (used by code paths that simulate gate runs). */
export function ensureGateStatusDir(): void {
  mkdirSync(gateStatusDir(), { recursive: true });
}
