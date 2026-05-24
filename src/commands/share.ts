/**
 * `cue share <profile>` — publish a profile to the cue marketplace.
 * `cue browse` — browse shared profiles from the community.
 *
 * Profiles are published as GitHub Gists (no backend needed).
 * The marketplace index is a JSON file in the cue repo's GitHub Pages.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { loadProfile } from "../lib/profile-loader";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROFILES_DIR = process.env.CUE_PROFILES_DIR ?? join(REPO_ROOT, "profiles");
const MARKETPLACE_URL = "https://raw.githubusercontent.com/opencue/cue-marketplace/main/index.json";
const SKILLS_ROOT = join(REPO_ROOT, "resources", "skills", "skills");

export async function run(args: string[]): Promise<number> {
  const sub = args[0];

  if (args.includes("-h") || args.includes("--help") || !sub) {
    process.stdout.write(`cue share — publish & browse community profiles

Usage:
  cue share <profile>        Publish a profile to the marketplace
  cue share browse [query]   Browse shared profiles
  cue share install <id>     Install a shared profile

Examples:
  cue share backend          # publish your backend profile
  cue share browse           # see what others shared
  cue share browse "medusa"  # search shared profiles
  cue share install user/backend  # install someone's profile
`);
    return 0;
  }

  switch (sub) {
    case "browse": return cmdBrowse(args.slice(1));
    case "install": return cmdInstall(args[1] ?? "");
    default: return cmdShare(sub);
  }
}

async function cmdShare(profileName: string): Promise<number> {
  // Check gh CLI
  const ghCheck = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
  if (ghCheck.status !== 0) {
    process.stderr.write("Not authenticated with GitHub. Run `gh auth login` first.\n");
    return 1;
  }

  // Get username
  const whoami = spawnSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf8" });
  const username = whoami.stdout.trim();

  // Load profile
  let profile;
  try { profile = await loadProfile(profileName); } catch {
    process.stderr.write(`Profile "${profileName}" not found.\n`);
    return 1;
  }

  // Build shareable YAML
  const yaml = require("yaml");
  const shareData = {
    name: profile.name,
    description: profile.description,
    icon: profile.icon,
    author: username,
    shared_at: new Date().toISOString(),
    skills: { local: profile.skills.local.map(s => s.id) },
    mcps: profile.mcps.map(m => m.id),
    plugins: profile.plugins.map(p => p.id),
    stats: {
      skill_count: profile.skills.local.length,
      mcp_count: profile.mcps.length,
    },
  };

  const content = yaml.stringify(shareData);

  // Create a GitHub Gist
  process.stdout.write(`📤 Sharing profile "${profileName}" as ${username}/${profileName}...\n`);

  const gistRes = spawnSync("gh", [
    "gist", "create",
    "--public",
    "--desc", `cue profile: ${profileName} — ${profile.description}`,
    "--filename", `${profileName}.cue-profile.yaml`,
    "-"
  ], {
    input: content,
    encoding: "utf8",
    timeout: 15000,
  });

  if (gistRes.status !== 0) {
    process.stderr.write(`Failed to create gist: ${gistRes.stderr}\n`);
    return 1;
  }

  const gistUrl = gistRes.stdout.trim();

  process.stdout.write(`\n✅ Profile shared!\n\n`);
  process.stdout.write(`  🔗 ${gistUrl}\n`);
  process.stdout.write(`  📋 Others install with: cue share install ${username}/${profileName}\n\n`);
  process.stdout.write(`  Profile: ${profile.icon} ${profileName}\n`);
  process.stdout.write(`  Skills:  ${profile.skills.local.length}\n`);
  process.stdout.write(`  MCPs:    ${profile.mcps.length}\n`);
  process.stdout.write(`  Author:  ${username}\n\n`);

  // Save the share record locally
  const sharesFile = join(homedir(), ".config", "cue", "shares.json");
  mkdirSync(dirname(sharesFile), { recursive: true });
  let shares: Record<string, unknown>[] = [];
  try { shares = JSON.parse(readFileSync(sharesFile, "utf8")); } catch {}
  shares.push({ id: `${username}/${profileName}`, url: gistUrl, ts: new Date().toISOString() });
  writeFileSync(sharesFile, JSON.stringify(shares, null, 2));

  return 0;
}

async function cmdBrowse(args: string[]): Promise<number> {
  const query = args.filter(a => !a.startsWith("-")).join(" ");

  // Search GitHub Gists with cue-profile tag
  process.stdout.write(`🔍 Searching shared cue profiles${query ? ` for "${query}"` : ""}...\n\n`);

  const searchQuery = `cue profile ${query}`.trim();
  const res = spawnSync("gh", [
    "search", "code",
    "--json", "repository,path,textMatch",
    "--limit", "10",
    "filename:cue-profile.yaml", searchQuery,
  ], { encoding: "utf8", timeout: 15000 });

  if (res.status !== 0) {
    // Fallback: search gists
    const gistRes = spawnSync("gh", [
      "gist", "list", "--public", "--limit", "10"
    ], { encoding: "utf8", timeout: 10000 });

    if (gistRes.stdout.trim()) {
      process.stdout.write("  Recent public gists (filter by 'cue-profile'):\n\n");
      process.stdout.write(gistRes.stdout);
    } else {
      process.stdout.write("  No shared profiles found yet.\n");
      process.stdout.write("  Be the first! Run: cue share <profile>\n");
    }
    return 0;
  }

  try {
    const results = JSON.parse(res.stdout);
    if (!results.length) {
      process.stdout.write("  No shared profiles found.\n");
      process.stdout.write("  Be the first! Run: cue share <profile>\n");
      return 0;
    }
    for (const r of results) {
      const repo = r.repository?.fullName ?? "unknown";
      process.stdout.write(`  📦 ${repo}\n`);
      process.stdout.write(`     ${r.path}\n\n`);
    }
  } catch {
    process.stdout.write("  Could not parse results. Try: cue share browse\n");
  }

  return 0;
}

async function cmdInstall(id: string): Promise<number> {
  if (!id) {
    process.stderr.write("Usage: cue share install <user/profile>\n");
    return 1;
  }

  const [user, name] = id.includes("/") ? id.split("/") : [null, id];

  if (!user) {
    process.stderr.write("Specify user: cue share install <user>/<profile>\n");
    return 1;
  }

  process.stdout.write(`📥 Installing profile "${id}"...\n`);

  // Try to find the gist
  const res = spawnSync("gh", [
    "gist", "list", "--public", "--limit", "50"
  ], { encoding: "utf8", timeout: 10000 });

  // Alternative: try fetching from a known URL pattern
  const gistUrl = `https://gist.githubusercontent.com/${user}/raw/${name}.cue-profile.yaml`;

  try {
    const fetchRes = await fetch(gistUrl, { signal: AbortSignal.timeout(10000) });
    if (fetchRes.ok) {
      const content = await fetchRes.text();
      const yaml = require("yaml");
      const parsed = yaml.parse(content);
      const profileName = parsed.name ?? name;

      const profileDir = join(PROFILES_DIR, profileName!);
      mkdirSync(profileDir, { recursive: true });

      // Convert shared format back to profile.yaml
      const profileYaml: Record<string, unknown> = {
        name: profileName,
        description: parsed.description ?? `Shared by ${user}`,
        icon: parsed.icon ?? "📦",
      };
      if (parsed.skills?.local?.length) profileYaml.skills = { local: parsed.skills.local };
      if (parsed.mcps?.length) profileYaml.mcps = parsed.mcps;

      writeFileSync(join(profileDir, "profile.yaml"), yaml.stringify(profileYaml));
      process.stdout.write(`✅ Installed "${profileName}" from ${user}\n`);
      process.stdout.write(`   Activate: echo ${profileName} > .cue-profile\n`);
      return 0;
    }
  } catch { /* gist not found at that URL */ }

  // Fallback: use cue import
  process.stdout.write(`  Could not find gist. Try: cue import https://gist.github.com/${user}/<gist-id>/raw\n`);
  return 1;
}
