/**
 * `cue lint-skill <path> [--fix] [--json] [--pr-body --repo <owner/name>]`
 *
 * Lints a SKILL.md (or every SKILL.md under a directory) against the cue
 * skill spec. With --fix, writes corrections back. With --pr-body, prints
 * the markdown body cue would post if it opened a PR for this skill.
 */

import { readFileSync, writeFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";

import { lint, applyFixes, buildPrBody, type Diagnostic } from "../lib/skill-linter";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const sevColor: Record<string, (s: string) => string> = {
  error: red, warning: yellow, info: dim,
};

/** Return every SKILL.md beneath a path. If `path` is a file, returns [path]. */
function collectSkillFiles(path: string): string[] {
  const abs = isAbsolute(path) ? path : resolve(path);
  if (!existsSync(abs)) return [];
  const st = statSync(abs);
  if (st.isFile()) return [abs];
  // Directory — walk one level deep first (most repos have skills/foo/SKILL.md)
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e);
      try {
        const s = statSync(full);
        if (s.isDirectory()) walk(full, depth + 1);
        else if (e === "SKILL.md" || e === "skill.md") out.push(full);
      } catch {}
    }
  };
  walk(abs, 0);
  return out;
}

interface FileReport {
  path: string;
  diagnostics: Diagnostic[];
  fixed?: string[];   // rules whose fix was applied
}

function renderReport(reports: FileReport[]): void {
  let totalErr = 0, totalWarn = 0, totalInfo = 0, totalFixed = 0;
  for (const r of reports) {
    if (r.diagnostics.length === 0 && (!r.fixed || r.fixed.length === 0)) {
      process.stdout.write(`  ${green("✓")} ${r.path} ${dim("(clean)")}\n`);
      continue;
    }
    process.stdout.write(`\n  ${bold(r.path)}\n`);
    if (r.fixed && r.fixed.length > 0) {
      process.stdout.write(`    ${green(`✓ Applied ${r.fixed.length} fix(es): ${r.fixed.join(", ")}`)}\n`);
      totalFixed += r.fixed.length;
    }
    for (const d of r.diagnostics) {
      const col = sevColor[d.severity] ?? dim;
      const tag = col(`${d.severity.toUpperCase().padEnd(7)} ${d.rule}`);
      const fixable = d.fix ? dim(" (fixable with --fix)") : "";
      process.stdout.write(`    ${tag}  ${d.message}${fixable}\n`);
      if (d.severity === "error") totalErr++;
      else if (d.severity === "warning") totalWarn++;
      else totalInfo++;
    }
  }
  process.stdout.write(`\n  ${bold("Summary")}: ${red(`${totalErr} error`)}, ${yellow(`${totalWarn} warning`)}, ${dim(`${totalInfo} info`)}`);
  if (totalFixed > 0) process.stdout.write(`, ${green(`${totalFixed} auto-fixed`)}`);
  process.stdout.write("\n\n");
}

export async function run(args: string[]): Promise<number> {
  const asJson = args.includes("--json");
  const doFix = args.includes("--fix");
  const prBody = args.includes("--pr-body");
  const repoIdx = args.indexOf("--repo");
  const repo = repoIdx >= 0 ? args[repoIdx + 1] : undefined;
  const positional = args.filter((a, i) => !a.startsWith("-") && args[i - 1] !== "--repo");

  if (positional.length === 0) {
    process.stderr.write("Usage: cue lint-skill <path> [--fix] [--json] [--pr-body --repo owner/name]\n");
    return 1;
  }

  // Collect files
  const files: string[] = [];
  for (const p of positional) files.push(...collectSkillFiles(p));
  if (files.length === 0) {
    process.stderr.write(`No SKILL.md (or skill.md) found under: ${positional.join(", ")}\n`);
    return 1;
  }

  const reports: FileReport[] = [];
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    if (doFix) {
      const { fixed, applied } = applyFixes(before);
      if (fixed !== before) writeFileSync(file, fixed);
      const { diagnostics } = lint(fixed); // re-lint after fix to show remaining
      reports.push({ path: file, diagnostics, fixed: applied });
    } else {
      const { diagnostics } = lint(before);
      reports.push({ path: file, diagnostics });
    }
  }

  // --pr-body: requires --repo, single-file mode
  if (prBody) {
    if (!repo) {
      process.stderr.write("--pr-body requires --repo <owner/name>\n");
      return 1;
    }
    if (files.length !== 1) {
      process.stderr.write("--pr-body works on a single SKILL.md file (got " + files.length + ")\n");
      return 1;
    }
    const before = readFileSync(files[0]!, "utf8");
    const { fixed, applied } = applyFixes(before);
    const { diagnostics: leftover } = lint(fixed);
    const fixedDiags = lint(before).diagnostics.filter((d) => applied.includes(d.rule));
    const { title, body } = buildPrBody({
      repo,
      files: [{ path: files[0]!, before, after: fixed, fixedRules: [...new Set(applied)] }],
      diagnosticsFixed: fixedDiags,
      diagnosticsLeft: leftover,
    });
    if (asJson) {
      process.stdout.write(JSON.stringify({ title, body, diff: fixed !== before }, null, 2) + "\n");
    } else {
      process.stdout.write(`${bold("PR title:")} ${title}\n\n${bold("PR body:")}\n\n${body}\n`);
    }
    return 0;
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(reports.map((r) => ({
      path: r.path,
      fixed: r.fixed ?? [],
      diagnostics: r.diagnostics.map((d) => ({ rule: d.rule, severity: d.severity, message: d.message, fixable: !!d.fix })),
    })), null, 2) + "\n");
    return 0;
  }

  renderReport(reports);
  const anyError = reports.some((r) => r.diagnostics.some((d) => d.severity === "error"));
  return anyError ? 1 : 0;
}
