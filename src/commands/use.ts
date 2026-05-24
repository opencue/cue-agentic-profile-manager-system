/**
 * `cue use <profile>` — pin a profile to the current directory.
 *
 * Writes `.cue-profile` in CWD (or $HOME with --global).
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { listProfiles } from "../lib/profile-loader";

export async function run(args: string[]): Promise<number> {
  const global = args.includes("--global") || args.includes("-g");
  const profileName = args.find(a => !a.startsWith("-"));

  if (!profileName) {
    process.stderr.write("Usage: cue use <profile> [--global]\n");
    const profiles = await listProfiles();
    process.stderr.write(`\nAvailable: ${profiles.join(", ")}\n`);
    return 1;
  }

  // Validate profile exists
  const profiles = await listProfiles();
  if (!profiles.includes(profileName)) {
    process.stderr.write(`Profile "${profileName}" not found.\n`);
    process.stderr.write(`Available: ${profiles.join(", ")}\n`);
    return 1;
  }

  const target = global ? join(homedir(), ".cue-profile") : join(process.cwd(), ".cue-profile");
  writeFileSync(target, profileName + "\n");

  const scope = global ? "globally" : `in ${process.cwd()}`;
  process.stdout.write(`✅ Now using "${profileName}" ${scope}\n`);
  return 0;
}
