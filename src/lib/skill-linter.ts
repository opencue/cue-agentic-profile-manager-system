/**
 * Pure SKILL.md linter. Validates against the Anthropic SKILL.md spec and
 * emits both diagnostics and fix functions where appropriate.
 *
 * Each rule is independent. Rules return Diagnostic[] (zero diagnostics means
 * the rule passed). A rule can optionally provide a `fix` that transforms the
 * SKILL.md content string; the caller (cue lint-skill --fix) decides whether
 * to apply.
 *
 * No I/O. No network. Callers handle file reads, writes, and PR posting.
 */

import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCLIsFromContent, parseMetadataFromContent } from "../commands/optimizer";

// ---------------------------------------------------------------------------
// Per-CLI install command lookup (used by R006).
// Reads resources/cli-recipes.json so the auto-generated Prerequisites
// section emits real commands instead of generic "use your package manager".
// ---------------------------------------------------------------------------

interface Recipe { apt?: string; brew?: string; dnf?: string; pacman?: string; snap?: string; pip?: string; pipx?: string; npm?: string; script?: string; manual?: string; needs?: string; }
let _recipesCache: Record<string, Recipe> | null = null;
function loadRecipes(): Record<string, Recipe> {
  if (_recipesCache) return _recipesCache;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, "..", "..", "resources", "cli-recipes.json");
    _recipesCache = JSON.parse(readFileSync(path, "utf8")) as Record<string, Recipe>;
  } catch {
    _recipesCache = {};
  }
  return _recipesCache;
}

/**
 * Render the install line for a single CLI. Prefers per-platform package
 * managers (Linux + macOS), falls back to manual hint. Emits a single
 * Markdown list item that's safe to embed in any SKILL.md.
 */
function renderInstallLine(cli: string): string {
  const r = loadRecipes()[cli];
  if (!r) return `- \`${cli}\` — install via your package manager`;
  const segments: string[] = [];
  // Linux options (prefer apt as most common, then snap, then dnf/pacman)
  if (r.apt) segments.push(`apt: \`sudo apt install -y ${r.apt}\``);
  else if (r.snap) segments.push(`snap: \`sudo snap install ${r.snap} --classic\``);
  else if (r.dnf) segments.push(`dnf: \`sudo dnf install -y ${r.dnf}\``);
  else if (r.pacman) segments.push(`pacman: \`sudo pacman -S ${r.pacman}\``);
  if (r.brew) segments.push(`brew: \`brew install ${r.brew}\``);
  if (r.pipx) segments.push(`pipx: \`pipx install ${r.pipx}\``);
  else if (r.pip) segments.push(`pip: \`pipx install ${r.pip}\` _(or \`pip install --user ${r.pip}\`)_`);
  if (r.npm) segments.push(`npm: \`npm install -g ${r.npm}\``);
  if (segments.length === 0 && r.manual) return `- \`${cli}\` — ${r.manual}`;
  if (segments.length === 0 && r.script) return `- \`${cli}\` — run: \`${r.script}\``;
  if (segments.length === 0) return `- \`${cli}\` — install via your package manager`;
  const note = r.needs ? `  _Note: ${r.needs}_` : "";
  return `- **${cli}** — ${segments.join(" · ")}${note}`;
}

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  rule: string;          // e.g. "R001"
  severity: Severity;
  message: string;
  line?: number;         // 1-based, optional
  /** Pure transform: given current content, return fixed content. Idempotent. */
  fix?: (content: string) => string;
}

export interface LintResult {
  diagnostics: Diagnostic[];
  fixable: number;
}

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

function getFrontmatter(content: string): { yaml: string; start: number; end: number } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return { yaml: match[1]!, start: 0, end: match[0].length };
}

function fmField(yaml: string, key: string): string {
  const m = yaml.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  return m ? m[1]!.trim() : "";
}

function bodyAfterFrontmatter(content: string): string {
  const fm = getFrontmatter(content);
  return fm ? content.slice(fm.end).replace(/^\n/, "") : content;
}

/** Insert a new field at the bottom of the frontmatter (just before the closing ---). */
function insertFrontmatterField(content: string, key: string, value: string): string {
  const fm = getFrontmatter(content);
  if (!fm) {
    // No frontmatter at all — create one
    return `---\n${key}: ${value}\n---\n\n${content}`;
  }
  const newYaml = fm.yaml + `\n${key}: ${value}`;
  return `---\n${newYaml}\n---` + content.slice(fm.end);
}

/** Slugify a string → kebab-case for derived `name:` values. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * R001 — frontmatter must declare `name:` (used by Claude's skill discovery
 * for the canonical id). Auto-fix: derive from the first `# Heading` in the
 * body, slugified.
 */
function ruleR001(content: string): Diagnostic[] {
  const fm = getFrontmatter(content);
  if (fm && fmField(fm.yaml, "name")) return [];
  const body = bodyAfterFrontmatter(content);
  const heading = body.match(/^#\s+(.+)$/m);
  const derived = heading ? slugify(heading[1]!) : "";
  return [{
    rule: "R001",
    severity: "error",
    message: "Frontmatter missing `name:` field — required for skill discovery.",
    fix: derived ? (c) => insertFrontmatterField(c, "name", derived) : undefined,
  }];
}

/**
 * R002 — frontmatter must declare `description:` (the trigger sentence Claude
 * matches against user requests). No auto-fix: the description needs human
 * judgment about *when* the skill should fire.
 */
function ruleR002(content: string): Diagnostic[] {
  const fm = getFrontmatter(content);
  if (fm && fmField(fm.yaml, "description")) return [];
  return [{
    rule: "R002",
    severity: "error",
    message: "Frontmatter missing `description:` — required so Claude knows when to invoke the skill.",
  }];
}

/**
 * R003 — description ≤ 200 chars. Anthropic's discovery truncates beyond
 * that and you lose the trigger semantics. No auto-fix (needs rewriting).
 */
function ruleR003(content: string): Diagnostic[] {
  // Read directly from frontmatter, not parseMetadataFromContent (which clips).
  const fm = getFrontmatter(content);
  if (!fm) return [];
  const raw = fmField(fm.yaml, "description");
  if (!raw || raw.length <= 200) return [];
  return [{
    rule: "R003",
    severity: "warning",
    message: `Description is ${raw.length} chars (>200); Claude's discovery may truncate it.`,
  }];
}

/**
 * R004 — description must contain a trigger phrase. The strongest signals
 * for Claude's discovery are second-person verbs ("Use when …", "Triggers …",
 * "When the user …"). Descriptions that are pure noun phrases ("A Python
 * library for X") fire much less reliably.
 */
function ruleR004(content: string): Diagnostic[] {
  const meta = parseMetadataFromContent(content);
  if (!meta.description) return [];
  const lower = meta.description.toLowerCase();
  const triggers = ["use when", "triggers", "when the user", "when you ", "when asked", "to be used", "used to", "used when"];
  if (triggers.some((t) => lower.includes(t))) return [];
  return [{
    rule: "R004",
    severity: "warning",
    message: 'Description has no trigger phrase (e.g. "Use when ...", "When the user ..."). Without one, Claude may not discover this skill reliably.',
  }];
}

/**
 * R005 — `allowed-tools:` must use Anthropic's `Bash(name:*)` / `Read(path)`
 * syntax. Common mistake: comma-separated bare names like `allowed-tools: nmap, curl`.
 */
function ruleR005(content: string): Diagnostic[] {
  const fm = getFrontmatter(content);
  if (!fm) return [];
  const raw = fmField(fm.yaml, "allowed-tools");
  if (!raw) return [];
  // Strip array brackets/braces if present.
  const value = raw.replace(/^\[|\]$/g, "").trim();
  // Valid form has at least one Tool(...) wrapper.
  if (/\b(Bash|Read|Write|Edit|Glob|Grep|WebFetch|WebSearch)\s*\(/.test(value)) return [];

  // Common malformation: comma-separated bare names. Auto-fix by wrapping.
  const bareNames = value.split(/[,\s]+/).filter(Boolean);
  if (bareNames.length === 0) return [];
  const fixed = bareNames.map((n) => `Bash(${n}:*)`).join(", ");
  return [{
    rule: "R005",
    severity: "error",
    message: `\`allowed-tools:\` must use \`Bash(name:*)\` / \`Read(path)\` syntax; got bare names "${value}".`,
    fix: (c) => {
      const fmm = getFrontmatter(c);
      if (!fmm) return c;
      const newYaml = fmm.yaml.replace(/^allowed-tools:.*$/m, `allowed-tools: ${fixed}`);
      return `---\n${newYaml}\n---` + c.slice(fmm.end);
    },
  }];
}

/**
 * R006 — skill declares CLI dependencies but has no `## Prerequisites`
 * section listing them. Auto-fix: synthesize one from the extracted CLI set.
 * This is the single highest-value PR cue can open on a skill repo.
 */
function ruleR006(content: string): Diagnostic[] {
  const clis = parseCLIsFromContent(content);
  if (clis.length === 0) return [];
  if (/^##\s+Prerequisites\b/m.test(content)) return [];

  const fix = (c: string): string => {
    const fm = getFrontmatter(c);
    const body = fm ? c.slice(fm.end) : c;
    const block = `\n\n## Prerequisites\n\n` +
      clis.map(renderInstallLine).join("\n") + "\n";
    // Insert after the first heading + any intro paragraph, OR at end of body.
    const firstH = body.search(/^#\s+.+$/m);
    if (firstH === -1) return c + block;
    // Find next blank line after the heading
    const after = body.indexOf("\n\n", firstH);
    if (after === -1) return c + block;
    return (fm ? c.slice(0, fm.end) : "") + body.slice(0, after) + block + body.slice(after);
  };

  return [{
    rule: "R006",
    severity: "warning",
    message: `Skill uses ${clis.length} CLI tool(s) (${clis.slice(0, 5).join(", ")}${clis.length > 5 ? "…" : ""}) but has no \`## Prerequisites\` section. Users won't know what to install.`,
    fix,
  }];
}

/**
 * R007 — frontmatter has no `tags:` / `domain:` / `category:`. These are what
 * marketplaces and search index against; missing them hurts discoverability.
 * No auto-fix (judgment required), but the message lists the inferred tags
 * for the maintainer to copy in.
 */
function ruleR007(content: string): Diagnostic[] {
  const fm = getFrontmatter(content);
  if (!fm) return [];
  const hasAny = ["tags", "domain", "category"].some((k) => fmField(fm.yaml, k));
  if (hasAny) return [];

  // Suggest tags from the body — frequent capitalized nouns / known CLIs.
  const clis = parseCLIsFromContent(content);
  const suggestions = clis.slice(0, 4);
  const hint = suggestions.length > 0 ? ` Suggested tags from your CLI usage: [${suggestions.join(", ")}].` : "";
  return [{
    rule: "R007",
    severity: "info",
    message: `Frontmatter has no \`tags:\`, \`domain:\`, or \`category:\` — hurts discoverability.${hint}`,
  }];
}

/**
 * R008 — markdown links pointing nowhere within the document. Detects
 * `[text](#anchor)` where `#anchor` doesn't correspond to any heading.
 * Pure (no network), so safe in CI. URL links are out of scope.
 */
function ruleR008(content: string): Diagnostic[] {
  const headings = new Set<string>();
  for (const m of content.matchAll(/^#+\s+(.+)$/gm)) {
    headings.add(slugify(m[1]!));
  }
  const broken: string[] = [];
  for (const m of content.matchAll(/\[([^\]]+)\]\(#([^)]+)\)/g)) {
    if (!headings.has(m[2]!.toLowerCase())) broken.push(m[2]!);
  }
  if (broken.length === 0) return [];
  return [{
    rule: "R008",
    severity: "warning",
    message: `Broken in-document anchor link(s): ${broken.slice(0, 5).join(", ")}${broken.length > 5 ? "…" : ""}`,
  }];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const ALL_RULES = [ruleR001, ruleR002, ruleR003, ruleR004, ruleR005, ruleR006, ruleR007, ruleR008];

/** Run every rule against the SKILL.md content. */
export function lint(content: string): LintResult {
  const diagnostics: Diagnostic[] = [];
  for (const rule of ALL_RULES) {
    diagnostics.push(...rule(content));
  }
  return { diagnostics, fixable: diagnostics.filter((d) => d.fix).length };
}

/** Apply every fixable diagnostic. Idempotent if rules are well-behaved. */
export function applyFixes(content: string): { fixed: string; applied: string[] } {
  let current = content;
  const applied: string[] = [];
  // Re-lint after each fix so rules see the updated content.
  // Cap iterations to avoid infinite loops if a fix re-triggers another rule.
  for (let i = 0; i < 5; i++) {
    const { diagnostics } = lint(current);
    const next = diagnostics.find((d) => d.fix);
    if (!next) break;
    current = next.fix!(current);
    applied.push(next.rule);
  }
  return { fixed: current, applied };
}

// ---------------------------------------------------------------------------
// PR body generator — meaningful pull request body for the auto-PR flow.
// Caller is responsible for repo forking, branching, pushing, and `gh pr create`.
// ---------------------------------------------------------------------------

export interface PrFile {
  path: string;
  before: string;
  after: string;
  fixedRules: string[];      // rule ids that touched this file
}

export interface PrBodyInput {
  repo: string;                   // owner/name
  files: PrFile[];                // every file the PR touches
  diagnosticsFixed: Diagnostic[]; // aggregated across files (deduped by rule)
  diagnosticsLeft: Diagnostic[];  // unfixable ones the maintainer can act on
}

const RULE_SUMMARIES: Record<string, string> = {
  R001: "Added missing `name:` field (derived from first H1)",
  R002: "Flagged missing `description:` for human review",
  R003: "Description exceeds 200 chars — Claude's discovery truncates it",
  R004: "Description lacks a trigger phrase (e.g. \"Use when …\")",
  R005: "Fixed `allowed-tools:` syntax to use `Bash(name:*)` form",
  R006: "Added `## Prerequisites` section listing CLI dependencies",
  R007: "Flagged missing `tags:` / `domain:` (hurts discoverability)",
  R008: "Flagged broken in-document anchor link(s)",
};

const RULE_TITLE_PHRASES: Record<string, string> = {
  R001: "add missing `name:`",
  R002: "flag missing `description:`",
  R003: "shorten over-long description",
  R004: "rewrite description with trigger phrase",
  R005: "fix `allowed-tools` syntax",
  R006: "add `Prerequisites` section",
  R007: "flag missing `tags:`/`domain:`",
  R008: "flag broken anchor links",
};

/**
 * Compose a meaningful PR title from the list of rules actually fixed.
 * Examples:
 *   1 rule    → "cue: fix allowed-tools syntax"
 *   2 rules   → "cue: fix allowed-tools syntax + add Prerequisites"
 *   3 rules   → "cue: fix allowed-tools syntax, add Prerequisites, +1 more"
 *   0 rules   → "cue: SKILL.md spec issues need review (R002, R007)"
 */
export function buildPrTitle(fixedRules: string[], flaggedRules: string[]): string {
  const dedup = [...new Set(fixedRules)];
  if (dedup.length === 0) {
    const flags = [...new Set(flaggedRules)].slice(0, 3);
    return `cue: SKILL.md spec issues need review (${flags.join(", ")})`;
  }
  const phrases = dedup.map((r) => RULE_TITLE_PHRASES[r] ?? r).filter(Boolean);
  if (phrases.length === 1) return `cue: ${phrases[0]}`;
  if (phrases.length === 2) return `cue: ${phrases[0]} + ${phrases[1]}`;
  return `cue: ${phrases.slice(0, 2).join(", ")}, +${phrases.length - 2} more`;
}

/**
 * Render a unified-diff-style block for a single file. Not a true Myers diff
 * — just lines that differ between before and after. Adequate for the small
 * frontmatter/Prerequisites edits cue typically makes.
 */
function renderInlineDiff(path: string, before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  // Simple LCS-free diff: find the first and last differing lines, emit a hunk.
  let firstDiff = 0;
  while (firstDiff < beforeLines.length && firstDiff < afterLines.length && beforeLines[firstDiff] === afterLines[firstDiff]) firstDiff++;

  let lastDiffBefore = beforeLines.length - 1;
  let lastDiffAfter = afterLines.length - 1;
  while (
    lastDiffBefore > firstDiff && lastDiffAfter > firstDiff &&
    beforeLines[lastDiffBefore] === afterLines[lastDiffAfter]
  ) { lastDiffBefore--; lastDiffAfter--; }

  // Show a small context window before/after
  const ctx = 2;
  const ctxStart = Math.max(0, firstDiff - ctx);
  const ctxEndBefore = Math.min(beforeLines.length, lastDiffBefore + 1 + ctx);
  const ctxEndAfter = Math.min(afterLines.length, lastDiffAfter + 1 + ctx);

  const lines: string[] = [];
  for (let i = ctxStart; i < firstDiff; i++) lines.push("  " + beforeLines[i]);
  for (let i = firstDiff; i <= lastDiffBefore; i++) lines.push("- " + beforeLines[i]);
  for (let i = firstDiff; i <= lastDiffAfter; i++) lines.push("+ " + afterLines[i]);
  // Trailing context comes from the after version since lines may have shifted.
  for (let i = lastDiffAfter + 1; i < ctxEndAfter; i++) lines.push("  " + afterLines[i]);

  return `### \`${path}\`\n\n\`\`\`diff\n${lines.join("\n")}\n\`\`\``;
}

export function buildPrBody(input: PrBodyInput): { title: string; body: string } {
  const fixedRuleIds = [...new Set(input.diagnosticsFixed.map((d) => d.rule))];
  const flaggedRuleIds = [...new Set(input.diagnosticsLeft.map((d) => d.rule))];

  const fixedList = input.diagnosticsFixed.length > 0
    ? input.diagnosticsFixed.map((d) => `- **${d.rule}** — ${RULE_SUMMARIES[d.rule] ?? d.message}`).join("\n")
    : "_(none — only flags, no automatic fixes)_";

  const leftList = input.diagnosticsLeft.length > 0
    ? input.diagnosticsLeft.map((d) => `- **${d.rule}** _(${d.severity})_ — ${d.message}`).join("\n")
    : "_(none — the file is clean after this PR)_";

  const title = buildPrTitle(fixedRuleIds, flaggedRuleIds);

  // Per-file diff blocks (only for files that actually changed)
  const diffBlocks = input.files
    .filter((f) => f.before !== f.after)
    .map((f) => renderInlineDiff(f.path, f.before, f.after))
    .join("\n\n");

  const skillPathDesc = input.files.length === 1
    ? input.files[0]!.path
    : `${input.files.filter((f) => f.before !== f.after).length} of ${input.files.length} SKILL.md files`;

  const body = `# SKILL.md quality fixes from \`cue\`

Hi! [\`cue\`](https://github.com/recodeee/cue) is an open-source agent profile manager that auto-discovers Claude Code skills via GitHub Code Search. We indexed **${skillPathDesc}** in [${input.repo}](https://github.com/${input.repo}) and ran our SKILL.md linter against it.

This PR applies the **safe, mechanical fixes** below. It does **not** add any branding, badges, or marketing — only spec-compliance changes that improve how Claude's skill discovery sees your skill.

## What this PR changes

${fixedList}

${diffBlocks ? `## Inline diff\n\n${diffBlocks}\n` : ""}
## What's flagged for your review (no diff)

These are issues we won't auto-fix because they need your judgment:

${leftList}

## Why each rule exists

| Rule | Source |
|---|---|
| R001 \`name:\` | Required for Claude Code's skill registry |
| R002 \`description:\` | Used as the trigger string by Claude's discovery |
| R003 desc length | Anthropic's discovery truncates >200 chars |
| R004 trigger phrase | Verb-leading descriptions fire ~3× more reliably |
| R005 \`allowed-tools\` syntax | Malformed tool declarations get silently ignored |
| R006 Prerequisites | Users don't know which CLIs to install otherwise |
| R007 tags/domain | Required for skill marketplace indexing |

## How to opt out

If you'd rather we don't open PRs like this on your repo, add a line to your README:

\`\`\`
<!-- cue: ignore -->
\`\`\`

We'll skip your repo on every future scan. **No follow-up PRs without you re-inviting us.**

You can also run the linter yourself by adding our GitHub Action (no PRs needed):

\`\`\`yaml
# .github/workflows/lint-skill-md.yml
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: recodeee/cue/skill-md-lint-action@main
\`\`\`

---

🤖 Generated by \`cue\` · [report a bad fix](https://github.com/recodeee/cue/issues/new?title=cue+lint+bad+fix:+${encodeURIComponent(input.repo)})
`;

  return { title, body };
}
