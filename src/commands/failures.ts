/**
 * `cue failures [profile] [--days N] [--json]`
 *
 * Scans ~/.config/cue/session-log.jsonl (written by the session-summary
 * Stop hook) AND recent Claude Code transcripts under ~/.claude/projects/
 * for failure markers — repeated tool errors, "let me try again" phrases,
 * quality-gate vetoes, tests-failed messages.
 *
 * Outputs grouped by profile so you can see "where does this profile
 * actually struggle?" The feed for Phase 5 of the maturity ladder: failure
 * patterns become input to profile improvements.
 *
 * This is INSPECTION ONLY — it doesn't modify profiles. The improvement
 * step is still manual (or a future `cue failures --propose` could draft
 * skill additions).
 */

import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

import { findRealClaudeBin } from "../lib/claude-binary";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const SESSION_LOG = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "cue", "session-log.jsonl",
);
const PROJECTS_DIR = join(homedir(), ".claude", "projects");

interface SessionEntry {
  ts: string;
  cwd: string;
  profile: string;
  session_id: string;
}

interface FailureMarker {
  kind: "quality-gate-veto" | "tool-error" | "retry-loop" | "test-fail" | "manual-rollback";
  pattern: string;
}

const MARKERS: Array<{ kind: FailureMarker["kind"]; pattern: RegExp; label: string }> = [
  { kind: "quality-gate-veto", pattern: /cue:quality-gates BLOCKED Stop/i, label: "Quality gate vetoed Stop" },
  { kind: "tool-error",        pattern: /Tool .* failed:|Error: ENOENT|Error: command failed|tool_use_error/i, label: "Tool errored" },
  { kind: "retry-loop",        pattern: /let me try (again|that again|differently)|let's try again|i'll try again/i, label: "Agent self-retried" },
  { kind: "test-fail",         pattern: /(test|spec).*(FAIL|failed)|\d+ fail/i, label: "Tests failed" },
  { kind: "manual-rollback",   pattern: /git reset --hard|undo (that|my changes)|never mind/i, label: "Rolled back work" },
];

function readSessionLog(daysBack: number): SessionEntry[] {
  if (!existsSync(SESSION_LOG)) return [];
  const cutoff = Date.now() - daysBack * 24 * 3600 * 1000;
  const out: SessionEntry[] = [];
  for (const line of readFileSync(SESSION_LOG, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as SessionEntry;
      if (!e.profile) continue;
      if (new Date(e.ts).getTime() < cutoff) continue;
      out.push(e);
    } catch {}
  }
  return out;
}

/** Lightly scan a transcript jsonl file for marker patterns. Returns one entry per marker hit. */
function scanTranscript(path: string): FailureMarker[] {
  const out: FailureMarker[] = [];
  let content: string;
  try { content = readFileSync(path, "utf8"); } catch { return []; }
  // Truncate to last 200KB to avoid huge old sessions dominating
  if (content.length > 200_000) content = content.slice(-200_000);
  for (const m of MARKERS) {
    const matches = content.match(new RegExp(m.pattern, "gi"));
    if (matches) {
      // Take up to 3 distinct hits per marker per transcript
      const seen = new Set<string>();
      for (const hit of matches) {
        const key = hit.slice(0, 60);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ kind: m.kind, pattern: m.label });
        if (seen.size >= 3) break;
      }
    }
  }
  return out;
}

/**
 * Find ~120-char excerpts around each marker match in a transcript. Used by
 * --propose to give the LLM enough context to suggest concrete fixes without
 * sending the full transcript (which would be huge + privacy-sensitive).
 */
function scanTranscriptExcerpts(path: string, maxPerPattern: number): Array<{ pattern: string; excerpt: string }> {
  const out: Array<{ pattern: string; excerpt: string }> = [];
  let content: string;
  try { content = readFileSync(path, "utf8"); } catch { return []; }
  if (content.length > 200_000) content = content.slice(-200_000);
  for (const m of MARKERS) {
    const re = new RegExp(m.pattern, "gi");
    let match: RegExpExecArray | null;
    let count = 0;
    while ((match = re.exec(content)) && count < maxPerPattern) {
      const start = Math.max(0, match.index - 60);
      const end = Math.min(content.length, match.index + match[0].length + 60);
      // Strip raw JSONL noise — just want a short snippet
      const excerpt = content.slice(start, end).replace(/\s+/g, " ").trim();
      out.push({ pattern: m.label, excerpt });
      count++;
    }
  }
  return out;
}

/** Most-recently-modified N transcripts under ~/.claude/projects/<*>/<*>.jsonl */
function recentTranscripts(daysBack: number, limit: number): string[] {
  if (!existsSync(PROJECTS_DIR)) return [];
  const cutoff = Date.now() - daysBack * 24 * 3600 * 1000;
  const out: { path: string; mtime: number }[] = [];
  try {
    for (const proj of readdirSync(PROJECTS_DIR)) {
      const projDir = join(PROJECTS_DIR, proj);
      try {
        for (const f of readdirSync(projDir)) {
          if (!f.endsWith(".jsonl")) continue;
          const full = join(projDir, f);
          try {
            const st = statSync(full);
            if (st.mtimeMs >= cutoff) out.push({ path: full, mtime: st.mtimeMs });
          } catch {}
        }
      } catch {}
    }
  } catch {}
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, limit).map((x) => x.path);
}

export async function run(args: string[]): Promise<number> {
  const asJson = args.includes("--json");
  const daysIdx = args.indexOf("--days");
  const days = daysIdx >= 0 && args[daysIdx + 1] ? Math.max(1, parseInt(args[daysIdx + 1]!, 10) || 7) : 7;
  const propose = args.includes("--propose");
  const profileFilter = args.find((a) => !a.startsWith("-") && a !== String(days));

  if (propose) return runPropose({ days, profileFilter, asJson });

  const sessions = readSessionLog(days);
  const transcripts = recentTranscripts(days, 30);

  // Map cwd → profile via session-log; some transcripts won't have a known profile.
  const cwdToProfile = new Map<string, string>();
  for (const s of sessions) cwdToProfile.set(s.cwd, s.profile);

  // Aggregate failures per profile
  const byProfile = new Map<string, Map<string, number>>();
  for (const path of transcripts) {
    // Transcript dir name encodes cwd (with / → -); we can't perfectly invert it,
    // so use the most-recent session entry as the profile guess for now.
    const guessProfile = sessions[0]?.profile ?? "(unknown)";
    if (profileFilter && guessProfile !== profileFilter) continue;
    const markers = scanTranscript(path);
    if (markers.length === 0) continue;
    const labels = byProfile.get(guessProfile) ?? new Map<string, number>();
    for (const m of markers) labels.set(m.pattern, (labels.get(m.pattern) ?? 0) + 1);
    byProfile.set(guessProfile, labels);
  }

  if (asJson) {
    const out: any = { sinceDays: days, sessions: sessions.length, transcripts: transcripts.length, byProfile: {} };
    for (const [p, m] of byProfile) out.byProfile[p] = Object.fromEntries(m);
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`\n  ${bold("Failure pattern review")}  ${dim(`(last ${days} days)`)}\n\n`);
  process.stdout.write(`  Sessions logged: ${sessions.length}  ·  Transcripts scanned: ${transcripts.length}\n\n`);

  if (byProfile.size === 0) {
    process.stdout.write(`  ${green("✓")} No failure patterns detected. Either things are going well, or the session-summary hook isn't installed.\n\n`);
    process.stdout.write(`  ${dim("Install: add resources/hooks/session-summary.json to your profile's hooks list.")}\n\n`);
    return 0;
  }

  for (const [profile, markers] of byProfile) {
    const total = [...markers.values()].reduce((s, n) => s + n, 0);
    const sev = total >= 10 ? red(`${total} hits`) : total >= 3 ? yellow(`${total} hits`) : dim(`${total} hits`);
    process.stdout.write(`  ${bold(profile)}  ${sev}\n`);
    const sorted = [...markers.entries()].sort((a, b) => b[1] - a[1]);
    for (const [label, count] of sorted) {
      process.stdout.write(`    ${dim("·")} ${String(count).padStart(3)} × ${label}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(`  ${dim("Want more detail per pattern? Run with --json and pipe to jq.")}\n\n`);
  process.stdout.write(`  ${dim("Or: cue failures --propose [profile]  — ask Claude to draft profile changes from these failures.")}\n\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// --propose — read recent failures, ask Claude to draft profile improvements,
// write the proposal to ~/.config/cue/proposals/ for review. Never auto-applies.
// ---------------------------------------------------------------------------

const PROPOSALS_DIR = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "cue", "proposals",
);

interface FailureBundle {
  profile: string;
  patternCounts: Map<string, number>;
  excerpts: Array<{ pattern: string; excerpt: string }>;  // sampled across transcripts
}

function gatherFailureBundle(profileFilter: string | undefined, days: number): FailureBundle | null {
  const sessions = readSessionLog(days);
  const transcripts = recentTranscripts(days, 30);
  if (transcripts.length === 0) return null;

  // Guess profile from the most-recent session (matches the detector's logic).
  const guessProfile = profileFilter ?? sessions[0]?.profile;
  if (!guessProfile) return null;

  const patternCounts = new Map<string, number>();
  const excerpts: Array<{ pattern: string; excerpt: string }> = [];
  let excerptCount = 0;
  const MAX_EXCERPTS = 25;

  for (const path of transcripts) {
    if (profileFilter && sessions[0]?.profile !== profileFilter) continue;
    for (const m of scanTranscript(path)) patternCounts.set(m.pattern, (patternCounts.get(m.pattern) ?? 0) + 1);
    if (excerptCount < MAX_EXCERPTS) {
      for (const ex of scanTranscriptExcerpts(path, 2)) {
        if (excerptCount >= MAX_EXCERPTS) break;
        excerpts.push(ex);
        excerptCount++;
      }
    }
  }
  if (patternCounts.size === 0) return null;
  return { profile: guessProfile, patternCounts, excerpts };
}

function buildProposalPrompt(bundle: FailureBundle, profileSnapshot: string): string {
  const patternLines = [...bundle.patternCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `- ${n}× ${p}`)
    .join("\n");
  const excerptLines = bundle.excerpts
    .slice(0, 15)
    .map((e, i) => `${i + 1}. [${e.pattern}]\n   "${e.excerpt.slice(0, 200)}"`)
    .join("\n\n");

  return `You are reviewing a cue profile that's been struggling. Below is its current loadout and a sample of failure patterns from recent sessions. Your job: propose 3-5 concrete, minimal-change improvements that would prevent these failures.

# Profile: ${bundle.profile}

\`\`\`yaml
${profileSnapshot}
\`\`\`

# Failure patterns (last week)

${patternLines}

# Sample excerpts from failed sessions

${excerptLines}

# Your task

Propose 3-5 concrete profile changes. For each:
1. **Change type** — one of: add-skill, add-rule, add-playbook, tighten-persona, add-quality-gate, remove-skill
2. **Rationale** — which specific failure pattern this addresses (cite the count)
3. **Concrete YAML diff** — a snippet that can be pasted into the profile.yaml

Format each proposal as:

## Proposal N: <short title>
**Type:** add-skill | add-rule | etc.
**Addresses:** <pattern> (N occurrences)
**Rationale:** <1-2 sentences>
**YAML diff:**
\`\`\`yaml
# add to profile.yaml:
<the change>
\`\`\`

Constraints:
- Don't propose anything that requires the user to write new code/files unless absolutely necessary.
- Prefer reusing existing skills/rules/playbooks in cue's resources/ directory.
- Be specific. "Add a testing skill" is bad; "Add nvidia/skill-evolution skill which catches X" is good.
- If a failure pattern can't be helped by a profile change, say so explicitly.
`;
}

async function runPropose(opts: { days: number; profileFilter: string | undefined; asJson: boolean }): Promise<number> {
  const bundle = gatherFailureBundle(opts.profileFilter, opts.days);
  if (!bundle) {
    process.stderr.write(`No failures detected in last ${opts.days} days${opts.profileFilter ? ` for profile "${opts.profileFilter}"` : ""}.\n`);
    return 0;
  }

  // Load the profile snapshot (description + skills + rules etc) for context.
  let profileSnapshot = "";
  try {
    const { loadProfile } = await import("../lib/profile-loader");
    const p = await loadProfile(bundle.profile);
    profileSnapshot = JSON.stringify({
      name: p.name,
      description: p.description,
      persona: (p as any).persona ?? "",
      skills: p.skills.local.map((s) => s.id),
      rules: p.rules,
      commands: p.commands,
      playbooks: (p as any).playbooks ?? [],
      qualityGates: (p as any).qualityGates ?? [],
    }, null, 2);
  } catch (e) {
    process.stderr.write(`Could not load profile "${bundle.profile}": ${e}\n`);
    return 1;
  }

  const prompt = buildProposalPrompt(bundle, profileSnapshot);

  // Use the `claude` CLI in one-shot mode (-p / --print). The user's existing
  // auth is reused. No new dependency added.
  // Find the REAL claude binary, skipping cue's shim. The shim re-routes
  // through `cue launch claude` which would either picker-loop or recurse.
  const claudeBin = findRealClaudeBin();
  if (!claudeBin) {
    process.stderr.write(`✗\nCould not find a real \`claude\` binary (only found cue's shim).\n`);
    process.stderr.write(`Install Claude Code: https://docs.claude.com/en/docs/claude-code\n`);
    return 1;
  }

  process.stderr.write(`📝 Asking Claude to draft profile improvements for "${bundle.profile}"... `);
  const t0 = Date.now();
  // Strip CUE_LAUNCHING + CLAUDE_CONFIG_DIR so claude runs cleanly even when
  // this process is inside a cue-managed session.
  const childEnv = { ...process.env };
  delete childEnv.CUE_LAUNCHING;
  delete childEnv.CLAUDE_CONFIG_DIR;
  const res = spawnSync(claudeBin, ["-p", prompt], {
    encoding: "utf8",
    timeout: 120000,
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (res.status !== 0) {
    process.stderr.write(`✗\n`);
    process.stderr.write(`claude failed (exit ${res.status}): ${res.stderr.trim() || "(no stderr)"}\n`);
    process.stderr.write(`Make sure the \`claude\` CLI is installed and authed. Try \`claude /login\` first.\n`);
    return 1;
  }
  process.stderr.write(`✓ (${elapsed}s)\n`);

  mkdirSync(PROPOSALS_DIR, { recursive: true });
  const fname = `${bundle.profile}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
  const path = join(PROPOSALS_DIR, fname);
  const header = `# cue profile improvement proposal — ${bundle.profile}\n\n` +
    `_Generated: ${new Date().toISOString()}_\n` +
    `_Scanned: last ${opts.days} days · ${[...bundle.patternCounts.values()].reduce((s, n) => s + n, 0)} failure hits across ${bundle.patternCounts.size} patterns_\n\n` +
    `> **Review carefully before applying.** Claude drafted these from limited context. Cross-check each YAML diff against your real failure mode before pasting it into the profile.\n\n` +
    `---\n\n`;
  writeFileSync(path, header + res.stdout);

  if (opts.asJson) {
    process.stdout.write(JSON.stringify({
      proposal: path,
      profile: bundle.profile,
      patterns: Object.fromEntries(bundle.patternCounts),
      bytes: res.stdout.length,
    }, null, 2) + "\n");
  } else {
    process.stdout.write(`\n  Proposal written to: ${bold(path)}\n\n`);
    process.stdout.write(`  ${dim("Review it, then apply the changes you like by editing profile.yaml.")}\n`);
    process.stdout.write(`  ${dim("Nothing was auto-applied — your profile is unchanged.")}\n\n`);
  }
  return 0;
}
