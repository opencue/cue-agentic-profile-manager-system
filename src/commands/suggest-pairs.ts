/**
 * `cue suggest-pairs` — surface "you usually pair X with Y" from local
 * session history. Read-only inspection of the same data that the picker
 * uses to pre-check companions in the combine multiselect.
 *
 * Flags:
 *   --profile <name>     Show partners for just this profile.
 *   --min-count <n>      Minimum joint occurrences (default 2).
 *   --min-affinity <f>   Minimum P(partner | profile) in 0..1 (default 0.5).
 *   --limit <n>          Cap per-profile partner list (default 5).
 *   --json               Emit machine-readable JSON instead of the table.
 */

import {
  computeAffinityMap,
  suggestionsByProfile,
  suggestPartnersFor,
  type PartnerSuggestion,
} from "../lib/pair-suggestions";

interface ParsedArgs {
  profile: string | null;
  minCount: number;
  minAffinity: number;
  limit: number;
  json: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    profile: null,
    minCount: 2,
    minAffinity: 0.5,
    limit: 5,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--profile") out.profile = argv[++i] ?? null;
    else if (a === "--min-count") out.minCount = Math.max(1, Number(argv[++i] ?? "2") || 2);
    else if (a === "--min-affinity") {
      const v = Number(argv[++i] ?? "0.5");
      out.minAffinity = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
    } else if (a === "--limit") out.limit = Math.max(1, Number(argv[++i] ?? "5") || 5);
  }
  return out;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function renderTable(
  rows: ReadonlyArray<{ profile: string; partners: PartnerSuggestion[] }>,
): string {
  if (rows.length === 0) {
    return [
      "No pair suggestions yet.",
      "",
      "cue mines composite picks (e.g. `medusa-vite+backend`) from your local",
      "session log. Once you start combining profiles via the picker, this table",
      "fills in. Telemetry must be enabled: `cue telemetry status`.",
    ].join("\n");
  }
  const lines: string[] = [];
  lines.push("Pair suggestions from your local session history:");
  lines.push("");
  for (const r of rows) {
    lines.push(`  ${r.profile}`);
    for (const p of r.partners) {
      const a = pct(p.affinity);
      lines.push(`    + ${p.name.padEnd(28)} ${a.padStart(4)} (${p.count}× together)`);
    }
    lines.push("");
  }
  lines.push("Picker behavior: when you pick a profile in this list, its top");
  lines.push("partners are pre-checked in the combine multiselect.");
  return lines.join("\n");
}

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(
      [
        "cue suggest-pairs — show \"you usually pair X with Y\" from local session history",
        "",
        "Usage:",
        "  cue suggest-pairs [--profile <name>] [--min-count <n>] [--min-affinity <f>] [--limit <n>] [--json]",
        "",
        "Defaults: --min-count 2  --min-affinity 0.5  --limit 5",
        "",
        "The same data drives picker pre-checking in the combine multiselect.",
        "",
      ].join("\n"),
    );
    return 0;
  }

  const opts = {
    minCount: args.minCount,
    minAffinity: args.minAffinity,
    limit: args.limit,
  };

  const affinity = computeAffinityMap();

  if (args.profile) {
    const partners = suggestPartnersFor(args.profile, affinity, opts);
    if (args.json) {
      process.stdout.write(JSON.stringify({ profile: args.profile, partners }, null, 2) + "\n");
      return 0;
    }
    process.stdout.write(renderTable([{ profile: args.profile, partners }]) + "\n");
    return 0;
  }

  const sug = suggestionsByProfile(affinity, opts);
  const rows = [...sug.entries()]
    .map(([profile, partners]) => ({ profile, partners }))
    .sort((a, b) => a.profile.localeCompare(b.profile));

  if (args.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(renderTable(rows) + "\n");
  return 0;
}
