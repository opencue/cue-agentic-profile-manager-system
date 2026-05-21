/**
 * `soul current` — print the active profile and resolved capability list.
 *
 * Reads .cue-profile / repo-default / global-default via cwd-resolver.
 * Outputs profile name, source, skill count, MCP count, plugin count, and runtime dir.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { loadProfile } from "../lib/profile-loader";

function configDir(): string {
  return process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "cue") : join(homedir(), ".config", "cue");
}

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const resolved = await resolveProfileForCwd({
    cwd: process.cwd(),
    homeDir: homedir(),
    configDir: configDir(),
  });
  if (resolved.source === "none") {
    process.stdout.write(json ? "{}\n" : "no profile pinned for this cwd\n");
    return 0;
  }
  const profile = await loadProfile(resolved.profile);
  const out = {
    profile: resolved.profile,
    source: resolved.source,
    skills: profile.skills.local.length + profile.skills.npx.length,
    mcps: profile.mcps.length,
    plugins: profile.plugins.length,
    runtimeDir: join(configDir(), "runtime", resolved.profile),
  };
  process.stdout.write(json ? JSON.stringify(out, null, 2) + "\n" : formatHuman(out));
  return 0;
}

function formatHuman(o: { profile: string; source: string; skills: number; mcps: number; plugins: number; runtimeDir: string; }): string {
  return `Profile: ${o.profile} (${o.source})\nSkills: ${o.skills}\nMCPs: ${o.mcps}\nPlugins: ${o.plugins}\nRuntime dir: ${o.runtimeDir}\n`;
}
