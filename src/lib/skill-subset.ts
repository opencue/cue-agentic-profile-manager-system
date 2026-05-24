/**
 * Smart skill subsetting: given a profile's skill list and a user prompt,
 * ask Claude which skills are plausibly relevant. The intent is to cut context
 * bloat in `cue launch` for sessions that only need 3-4 of N skills.
 *
 * Design rules:
 *   1. **Fail open.** Any error path returns the original list unchanged.
 *      Smart-subset is an optimization, not a gate. Never make `cue launch`
 *      slower than today on the failure path.
 *   2. **Single Claude call.** All skills + prompt in one --print invocation.
 *      One round-trip cost (~$0.001, ~2s) regardless of profile size.
 *   3. **Always keep "core" essentials.** A handful of skills (caveman,
 *      analyze, cue-usage) are operational primitives — never prune them
 *      even if the classifier doesn't pick them.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { findRealClaudeBin } from "./claude-binary";
import { resolveLocalSkill } from "./resolver-local";
import { parseMetadataFromContent } from "../commands/optimizer";

// Skills that survive every subset filter. They're operational, not domain-
// specific, and pruning them changes how the agent behaves more than it
// changes what it can do.
const ALWAYS_KEEP = new Set([
  "meta/analyze",
  "meta/cue-usage",
  "meta/acpx",
  "caveman/caveman",
  "caveman/caveman-commit",
]);

export interface SubsetResult {
  /** Skill IDs the classifier picked (plus ALWAYS_KEEP). Same ordering as input. */
  selected: string[];
  /** True if classification ran; false if we fell back to the original list. */
  classified: boolean;
  /** One-line reason — useful for the user-facing message. */
  reason: string;
}

interface SkillDescriptor {
  id: string;
  description: string;
}

async function loadSkillDescriptor(id: string): Promise<SkillDescriptor> {
  try {
    const dir = await resolveLocalSkill(id);
    const md = join(dir, "SKILL.md");
    if (!existsSync(md)) return { id, description: "" };
    const meta = parseMetadataFromContent(readFileSync(md, "utf8"));
    return { id, description: meta.description };
  } catch {
    return { id, description: "" };
  }
}

function buildPrompt(prompt: string, descriptors: SkillDescriptor[]): string {
  const lines = descriptors.map((d, i) => `${i + 1}. ${d.id}${d.description ? ` — ${d.description}` : ""}`);
  return `You are choosing which skills to load for a Claude Code session. Each skill is a chunk of system-prompt context; loading every skill costs tokens. Pick only the ones plausibly relevant to the user's first prompt.

User prompt:
${prompt}

Available skills:
${lines.join("\n")}

Respond in EXACTLY this format (no other text):
KEEP: <comma-separated skill IDs from the list above, or "none">
REASON: <one short sentence>

Rules:
- Pick 3-8 skills, never more than half the list.
- If the prompt is generic ("help", "what can you do"), respond KEEP: none.
- If unsure, KEEP fewer skills. The user can always load more by retrying.`;
}

function callClaude(prompt: string, timeoutMs: number): { ok: boolean; output: string } {
  const tryOne = (bin: string) => spawnSync(bin, ["--print", "-p", prompt], {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, CUE_BYPASS: "1" },
  });

  let res = tryOne("claude");
  if (res.status !== 0 || !res.stdout?.trim()) {
    const fallback = findRealClaudeBin();
    if (fallback) res = tryOne(fallback);
  }
  if (res.status !== 0 || !res.stdout?.trim()) return { ok: false, output: "" };
  return { ok: true, output: res.stdout.trim() };
}

function parseClaudeKeep(output: string, allSkillIds: string[]): string[] | null {
  const m = output.match(/KEEP:\s*(.+)/i);
  if (!m) return null;
  const raw = m[1]!.trim();
  if (/^none$/i.test(raw)) return [];
  const known = new Set(allSkillIds);
  const picked = raw.split(",").map(s => s.trim()).filter(s => s && known.has(s));
  // Sanity check: if Claude returned nothing usable, signal a parse failure
  // rather than an empty selection.
  return picked.length === 0 ? null : picked;
}

/**
 * Returns the subset of `skillIds` relevant to `prompt`. ALWAYS_KEEP skills
 * are always included. If anything goes wrong (no claude binary, timeout,
 * unparseable response), returns the original list unchanged with classified=false.
 */
export async function selectRelevantSkills(
  skillIds: string[],
  prompt: string,
  opts: { timeoutMs?: number; minKeep?: number } = {},
): Promise<SubsetResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const minKeep = opts.minKeep ?? 3;
  const trimmed = prompt.trim();

  if (!trimmed) {
    return { selected: skillIds, classified: false, reason: "empty prompt — kept all skills" };
  }
  // Very short prompts don't have enough signal to classify well.
  if (trimmed.length < 8) {
    return { selected: skillIds, classified: false, reason: `prompt too short (${trimmed.length} chars) — kept all skills` };
  }
  if (skillIds.length <= 4) {
    return { selected: skillIds, classified: false, reason: `only ${skillIds.length} skills — nothing to subset` };
  }

  const descriptors = await Promise.all(skillIds.map(loadSkillDescriptor));
  const claudePrompt = buildPrompt(trimmed, descriptors);
  const { ok, output } = callClaude(claudePrompt, timeoutMs);
  if (!ok) {
    return { selected: skillIds, classified: false, reason: "claude --print unavailable — kept all skills" };
  }

  const picked = parseClaudeKeep(output, skillIds);
  if (picked === null) {
    return { selected: skillIds, classified: false, reason: "could not parse classifier output — kept all skills" };
  }

  const keepSet = new Set(picked);
  for (const id of skillIds) if (ALWAYS_KEEP.has(id)) keepSet.add(id);

  if (keepSet.size < minKeep) {
    return { selected: skillIds, classified: false, reason: `classifier picked < ${minKeep} skills — kept all` };
  }

  // Preserve original ordering.
  const selected = skillIds.filter(id => keepSet.has(id));
  const reasonMatch = output.match(/REASON:\s*(.+)/i);
  const why = reasonMatch?.[1]?.trim().slice(0, 100) ?? "relevance ranking";
  return {
    selected,
    classified: true,
    reason: `${selected.length}/${skillIds.length} skills kept — ${why}`,
  };
}

// Exported for tests.
export const __test = { parseClaudeKeep, buildPrompt, ALWAYS_KEEP };
