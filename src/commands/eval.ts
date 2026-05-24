/**
 * `cue eval [profile]` — benchmark profile performance.
 *
 * Measures: token overhead, skill usage rate, MCP tool hit rate,
 * session duration, and compares against the "full" baseline.
 */

import { resolve, join, dirname } from "node:path";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { loadProfile, listProfiles } from "../lib/profile-loader";
import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { computeStats } from "../lib/analytics";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "resources", "skills", "skills");

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  let profileName = args.find(a => !a.startsWith("-"));

  if (!profileName) {
    try {
      const resolved = await resolveProfileForCwd({ cwd: process.cwd(), homeDir: homedir(), configDir: join(homedir(), ".config", "cue") });
      if (resolved.source !== "none") profileName = (resolved as any).profile;
    } catch {}
  }

  if (!profileName) {
    process.stderr.write("Usage: cue eval [profile]\n");
    return 1;
  }

  const profile = await loadProfile(profileName);
  const skillCount = profile.skills.local.length + profile.skills.npx.length;
  const mcpCount = profile.mcps.length;
  const pluginCount = profile.plugins.length;

  // Measure token overhead
  let totalTokens = 0;
  for (const s of profile.skills.local) {
    const p = join(SKILLS_ROOT, s.id, "SKILL.md");
    try {
      const size = readFileSync(p, "utf8").length;
      totalTokens += Math.ceil(size / 4);
    } catch {}
  }

  // Get usage stats for this profile
  const stats = computeStats();
  const profileStats = stats.find(s => s.profile === profileName);
  const sessions = profileStats?.sessions ?? 0;
  const avgDuration = profileStats?.avg_duration_s ?? 0;

  // Compare against full profile
  let fullTokens = 0;
  try {
    const full = await loadProfile("full");
    for (const s of full.skills.local) {
      const p = join(SKILLS_ROOT, s.id, "SKILL.md");
      try { fullTokens += Math.ceil(readFileSync(p, "utf8").length / 4); } catch {}
    }
  } catch {}

  const savings = fullTokens > 0 ? Math.round((1 - totalTokens / fullTokens) * 100) : 0;
  const costPerSession = (totalTokens / 1000) * 0.003; // ~$3/1M input tokens
  const fullCostPerSession = (fullTokens / 1000) * 0.003;

  if (json) {
    process.stdout.write(JSON.stringify({
      profile: profileName,
      skills: skillCount,
      mcps: mcpCount,
      plugins: pluginCount,
      tokens: totalTokens,
      fullTokens,
      savings: `${savings}%`,
      costPerSession: `$${costPerSession.toFixed(4)}`,
      sessions,
      avgDurationS: avgDuration,
    }, null, 2) + "\n");
    return 0;
  }

  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

  process.stdout.write(`\n  ${bold("Profile Eval:")} ${profileName}\n\n`);

  // Loadout
  process.stdout.write(`  ${bold("Loadout")}\n`);
  process.stdout.write(`    Skills: ${skillCount}    MCPs: ${mcpCount}    Plugins: ${pluginCount}\n`);
  process.stdout.write(`    Token overhead: ~${(totalTokens / 1000).toFixed(1)}K tokens\n\n`);

  // Efficiency vs full
  process.stdout.write(`  ${bold("Efficiency vs full profile")}\n`);
  process.stdout.write(`    This profile:  ${(totalTokens / 1000).toFixed(1)}K tokens  (~$${costPerSession.toFixed(4)}/msg)\n`);
  process.stdout.write(`    Full profile:  ${(fullTokens / 1000).toFixed(1)}K tokens  (~$${fullCostPerSession.toFixed(4)}/msg)\n`);
  process.stdout.write(`    ${green(`Savings: ${savings}%`)} ${dim(`(${((fullTokens - totalTokens) / 1000).toFixed(1)}K tokens saved per message)`)}\n\n`);

  // Usage
  process.stdout.write(`  ${bold("Usage")}\n`);
  process.stdout.write(`    Sessions: ${sessions}\n`);
  if (avgDuration > 0) {
    const mins = Math.round(avgDuration / 60);
    process.stdout.write(`    Avg duration: ${mins}m\n`);
  }

  // Score
  const score = Math.min(100, Math.round(
    (savings * 0.4) +                          // 40% weight: token savings
    (Math.min(sessions, 20) / 20 * 30) +       // 30% weight: actual usage
    (mcpCount > 0 ? 15 : 0) +                  // 15% weight: has MCPs
    (pluginCount > 0 ? 15 : 0)                 // 15% weight: has plugins
  ));

  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  const gradeColor = score >= 75 ? green : yellow;

  process.stdout.write(`\n  ${bold("Score:")} ${gradeColor(`${score}/100 (${grade})`)}\n`);
  process.stdout.write(`  ${dim("Score = 40% token savings + 30% usage + 15% MCPs + 15% plugins")}\n\n`);

  return 0;
}
