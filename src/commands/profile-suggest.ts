/**
 * `cue profile suggest` — audit profiles/ and propose regroupings.
 *
 * Three signals, all read-only:
 *   1. Skills present in ≥3 profiles → promote-to-core candidates.
 *   2. Profile pairs with high Jaccard overlap → merge candidates.
 *   3. Discovered gems that fit no profile → cluster + suggest new profile names.
 *
 * Output is a report only; nothing is written. Adoption is a manual edit.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { parse as parseYaml } from "yaml";

import {
  clusterByKeywords,
  jaccard,
  skillFrequency,
  type ClusterItem,
} from "../lib/cluster-skills";

const REPO_ROOT = process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROFILES_DIR = join(REPO_ROOT, "profiles");
const DISCOVER_CACHE = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "cue", "discover", "gems.json",
);

const RESERVED = new Set(["_active", "_cache", "_examples"]);

interface RawProfile {
  name?: string;
  description?: string;
  skills?: { local?: Array<string | { id: string }> };
}

function readProfileSkills(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!existsSync(PROFILES_DIR)) return out;
  for (const entry of readdirSync(PROFILES_DIR)) {
    if (RESERVED.has(entry) || entry.startsWith(".")) continue;
    const yamlPath = join(PROFILES_DIR, entry, "profile.yaml");
    if (!existsSync(yamlPath) || !statSync(yamlPath).isFile()) continue;
    try {
      const doc = parseYaml(readFileSync(yamlPath, "utf8")) as RawProfile;
      const skills = (doc?.skills?.local ?? []).map(s => typeof s === "string" ? s : s.id).filter(Boolean);
      out[entry] = skills;
    } catch {
      // Malformed YAML — skip; `cue validate` is the right tool for that.
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function reportPromoteToCore(profileSkills: Record<string, string[]>, minProfiles: number): void {
  const candidates = skillFrequency(profileSkills, { minProfiles });
  if (candidates.length === 0) {
    process.stdout.write(`  ${dim("no skills appear in ≥" + minProfiles + " non-core profiles")}\n\n`);
    return;
  }
  process.stdout.write(`  ${bold("Skills appearing in ≥" + minProfiles + " profiles — consider promoting to core:")}\n\n`);
  for (const { skill, profiles } of candidates) {
    process.stdout.write(`    • ${skill} ${dim(`(${profiles.length}× — ${profiles.join(", ")})`)}\n`);
  }
  process.stdout.write(`\n`);
}

function reportMergeCandidates(profileSkills: Record<string, string[]>, threshold: number): void {
  const names = Object.keys(profileSkills).filter(n => n !== "core" && n !== "full");
  const sets = new Map(names.map(n => [n, new Set(profileSkills[n] ?? [])]));
  const pairs: Array<{ a: string; b: string; score: number; shared: string[] }> = [];

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]!, b = names[j]!;
      const sa = sets.get(a)!, sb = sets.get(b)!;
      if (sa.size < 2 || sb.size < 2) continue;
      const score = jaccard(sa, sb);
      if (score >= threshold) {
        const shared = [...sa].filter(s => sb.has(s));
        pairs.push({ a, b, score, shared });
      }
    }
  }
  pairs.sort((x, y) => y.score - x.score);

  if (pairs.length === 0) {
    process.stdout.write(`  ${dim(`no profile pairs with Jaccard ≥ ${threshold.toFixed(2)}`)}\n\n`);
    return;
  }
  process.stdout.write(`  ${bold("Profile pairs with high skill overlap — consider merging:")}\n\n`);
  for (const p of pairs) {
    process.stdout.write(`    • ${p.a} ↔ ${p.b}  ${dim(`(Jaccard ${p.score.toFixed(2)}, ${p.shared.length} shared)`)}\n`);
    for (const s of p.shared.slice(0, 4)) {
      process.stdout.write(`        - ${s}\n`);
    }
    if (p.shared.length > 4) process.stdout.write(`        … +${p.shared.length - 4} more\n`);
  }
  process.stdout.write(`\n`);
}

interface CachedGem {
  full_name: string;
  name: string;
  description: string;
  topics: string[];
  suggested_profiles: string[];
}

function reportUnfitGems(minSize: number): void {
  if (!existsSync(DISCOVER_CACHE)) {
    process.stdout.write(`  ${dim("no discover cache — run `cue discover search` to enable this section")}\n\n`);
    return;
  }
  let cache: { gems: CachedGem[] };
  try {
    cache = JSON.parse(readFileSync(DISCOVER_CACHE, "utf8"));
  } catch {
    process.stdout.write(`  ${dim("discover cache unreadable — skipping")}\n\n`);
    return;
  }

  const unfit = cache.gems.filter(g => {
    if (!g.suggested_profiles?.length) return true;
    return g.suggested_profiles.length === 1 && g.suggested_profiles[0] === "core";
  });

  if (unfit.length < minSize) {
    process.stdout.write(`  ${dim(`only ${unfit.length} unfit gem(s); nothing to cluster`)}\n\n`);
    return;
  }

  const items: ClusterItem[] = unfit.map(g => ({
    id: g.full_name,
    text: `${g.name} ${g.description ?? ""} ${(g.topics ?? []).join(" ")}`,
  }));
  const clusters = clusterByKeywords(items, { minSize, maxClusters: 6 });

  if (clusters.length === 0) {
    process.stdout.write(`  ${dim(`${unfit.length} unfit gem(s), no clusters of ≥${minSize} formed`)}\n\n`);
    return;
  }

  process.stdout.write(`  ${bold("Clusters of unfit gems — consider creating new profiles:")}\n\n`);
  for (const c of clusters) {
    process.stdout.write(`    • "${c.term}"  ${dim(`(${c.items.length} skills)`)}\n`);
    for (const item of c.items.slice(0, 4)) {
      process.stdout.write(`        - ${item.id}\n`);
    }
    if (c.items.length > 4) process.stdout.write(`        … +${c.items.length - 4} more\n`);
  }
  process.stdout.write(`\n  ${dim("→ run `cue discover suggest-profiles` to generate draft profile.yaml files")}\n\n`);
}

// ---------------------------------------------------------------------------
// Tiny ANSI helpers (no dependency)
// ---------------------------------------------------------------------------

const noColor = !process.stdout.isTTY || !!process.env.NO_COLOR;
const bold = (s: string) => noColor ? s : `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => noColor ? s : `\x1b[2m${s}\x1b[0m`;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue profile suggest — audit profiles/ and propose regroupings

Usage:
  cue profile suggest                Run all three signals (default)
  cue profile suggest --no-cluster   Skip the discover-cache clustering section

Options:
  --min-profiles <n>    Promote-to-core threshold (default: 3)
  --jaccard <0..1>      Merge-candidate threshold (default: 0.5)
  --min-size <n>        Cluster size threshold for unfit gems (default: 3)

Output: report only. Nothing is written.
`);
    return 0;
  }

  const minProfilesIdx = args.indexOf("--min-profiles");
  const minProfiles = minProfilesIdx >= 0 ? parseInt(args[minProfilesIdx + 1] ?? "3", 10) : 3;
  const jaccardIdx = args.indexOf("--jaccard");
  const jaccardThreshold = jaccardIdx >= 0 ? parseFloat(args[jaccardIdx + 1] ?? "0.5") : 0.5;
  const minSizeIdx = args.indexOf("--min-size");
  const minSize = minSizeIdx >= 0 ? parseInt(args[minSizeIdx + 1] ?? "3", 10) : 3;
  const skipCluster = args.includes("--no-cluster");

  const profileSkills = readProfileSkills();
  const total = Object.keys(profileSkills).length;
  if (total === 0) {
    process.stderr.write("No profiles found under profiles/. Aborting.\n");
    return 1;
  }

  process.stdout.write(`\n${bold("cue profile suggest")} — scanning ${total} profiles under ${PROFILES_DIR}\n\n`);

  process.stdout.write(`${bold("1. Promote-to-core candidates")}\n\n`);
  reportPromoteToCore(profileSkills, minProfiles);

  process.stdout.write(`${bold("2. Merge candidates")}\n\n`);
  reportMergeCandidates(profileSkills, jaccardThreshold);

  if (!skipCluster) {
    process.stdout.write(`${bold("3. New-profile clusters from discover cache")}\n\n`);
    reportUnfitGems(minSize);
  }

  process.stdout.write(`${dim("(report-only — review and edit profiles/*/profile.yaml by hand)")}\n`);
  return 0;
}
