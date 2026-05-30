/**
 * `cue merge <a> <b> …` — combine several profiles into one.
 *
 *   cue merge medusa-dev designer --name commerce
 *   cue merge medusa-dev designer --name commerce --optimize prune,router
 *   cue merge backend frontend --name builder --alias        # live, auto-syncs
 *   cue merge a b --name x --dry-run                          # preview only
 *
 * Static (default) writes a flattened fat `profile.yaml` (`inherits: core` +
 * inlined skills). `--alias` writes a thin `inherits: [a, b, …]` profile that
 * stays in sync with its sources.
 */

import {
  mergeProfiles,
  renderMerged,
  writeMergedProfile,
  MergedProfileExists,
  type OptimizeAction,
  type MergeMode,
  type MergePreview,
} from "../lib/profile-merge";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const VALID_ACTIONS = new Set<OptimizeAction>(["prune", "dedupe", "budget", "router"]);

interface Parsed {
  names: string[];
  name?: string;
  mode: MergeMode;
  optimize: OptimizeAction[];
  budget?: number;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(args: string[]): Parsed | "help" {
  if (args.includes("-h") || args.includes("--help")) return "help";
  const parsed: Parsed = { names: [], mode: "static", optimize: [], dryRun: false, force: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--name") parsed.name = args[++i];
    else if (a === "--alias") parsed.mode = "alias";
    else if (a === "--dry-run") parsed.dryRun = true;
    else if (a === "--force" || a === "-f") parsed.force = true;
    else if (a === "--budget") parsed.budget = Number(args[++i]);
    else if (a === "--optimize" || a === "-o") {
      for (const token of (args[++i] ?? "").split(",").map((t) => t.trim()).filter(Boolean)) {
        const eq = token.indexOf("=");
        if (eq !== -1) {
          const key = token.slice(0, eq) as OptimizeAction;
          const val = Number(token.slice(eq + 1));
          if (key === "budget") { parsed.budget = val; parsed.optimize.push("budget"); }
          else if (VALID_ACTIONS.has(key)) parsed.optimize.push(key);
        } else if (VALID_ACTIONS.has(token as OptimizeAction)) {
          parsed.optimize.push(token as OptimizeAction);
        }
      }
    } else if (!a.startsWith("-")) parsed.names.push(a);
  }
  return parsed;
}

function printHelp(): void {
  process.stdout.write(`cue merge — combine several profiles into one

Usage: cue merge <a> <b> [<c>…] --name <name> [flags]

Flags:
  --name <name>          target profile name (required to write)
  --alias                write a live alias (inherits: [sources]) instead of a
                         flattened static profile
  --optimize, -o <list>  comma list of: prune, dedupe, budget, router
                         (e.g. --optimize prune,router  or  -o budget=60)
  --budget <n>           skill cap for the budget action (default 60)
  --dry-run              print the preview + rendered YAML, write nothing
  --force, -f            overwrite an existing profile of the same name

Examples:
  cue merge medusa-dev designer --name commerce
  cue merge medusa-dev designer --name commerce --optimize prune,router
  cue merge backend frontend --name builder --alias
`);
}

function summarize(p: MergePreview, mode: MergeMode): void {
  const out = process.stdout;
  out.write(`\n${BOLD}${p.icon} ${p.name}${RESET}  ${DIM}(${mode})${RESET}\n`);
  out.write(`${DIM}${p.description}${RESET}\n\n`);
  out.write(`  📦 skills: ${BOLD}${p.skills.length}${RESET}   🔌 MCPs: ${BOLD}${p.mcps.length}${RESET}   🧩 plugins: ${p.plugins.length}   ~${Math.round(p.estTokens / 1000)}k tok\n`);
  out.write(`  ${DIM}bundles: ${p.names.join(" + ")}${RESET}\n`);

  if (p.appliedOptimizations.length > 0) {
    out.write(`  ${GREEN}optimize:${RESET} ${p.appliedOptimizations.join(", ")}`);
    if (p.dropped.length > 0) out.write(`  ${DIM}(dropped ${p.dropped.length} skills)${RESET}`);
    out.write(`\n`);
  }
  if (p.profileConflicts.length > 0) {
    out.write(`  ${RED}⚠ profile conflicts:${RESET} ${p.profileConflicts.map((c) => `${c.a} vs ${c.b}`).join(", ")}\n`);
    out.write(`    ${DIM}these sources are declared mutually exclusive — pick one${RESET}\n`);
  }
  if (p.skillConflicts.length > 0) {
    out.write(`  ${YELLOW}⚠ ${p.skillConflicts.length} skill-directive conflict(s)${RESET} ${DIM}(${p.skillConflicts.slice(0, 2).map((c) => `${c.skillA} ↔ ${c.skillB}`).join("; ")}${p.skillConflicts.length > 2 ? "; …" : ""})${RESET}\n`);
  }
  out.write(`\n`);
}

export async function run(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed === "help") { printHelp(); return 0; }

  if (parsed.names.length < 2) {
    process.stderr.write(`${RED}cue merge needs at least 2 source profiles.${RESET}\n`);
    printHelp();
    return 1;
  }

  let preview: MergePreview;
  try {
    preview = await mergeProfiles(parsed.names, {
      name: parsed.name,
      optimize: parsed.optimize,
      budget: parsed.budget,
    });
  } catch (err) {
    process.stderr.write(`${RED}merge failed:${RESET} ${(err as Error).message}\n`);
    return 1;
  }

  summarize(preview, parsed.mode);
  const yaml = renderMerged(preview, parsed.mode);

  if (parsed.dryRun || !parsed.name) {
    if (!parsed.name) {
      process.stdout.write(`${YELLOW}No --name given — preview only (nothing written).${RESET}\n\n`);
    }
    process.stdout.write(`${DIM}--- profiles/${preview.name}/profile.yaml ---${RESET}\n`);
    process.stdout.write(yaml);
    return 0;
  }

  try {
    const path = await writeMergedProfile(parsed.name, yaml, { force: parsed.force });
    process.stdout.write(`${GREEN}✓ wrote${RESET} ${path}\n`);
    process.stdout.write(`${DIM}next:${RESET} cue validate ${parsed.name}  ·  cue optimizer ${parsed.name}  ·  cue use ${parsed.name}\n`);
    return 0;
  } catch (err) {
    if (err instanceof MergedProfileExists) {
      process.stderr.write(`${RED}${err.message}${RESET}\n`);
      return 1;
    }
    process.stderr.write(`${RED}write failed:${RESET} ${(err as Error).message}\n`);
    return 1;
  }
}
