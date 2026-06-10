/**
 * `cue auto-detect` — detect project type and suggest a profile.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectProfileV2 } from "../lib/auto-detect";
import { scanProject } from "../lib/project-scanner";

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const apply = args.includes("--apply");
  const cwd = process.cwd();

  // Same detector the launch picker's "Suggested for this cwd" uses, so the
  // CLI and the picker can never disagree about what this directory looks
  // like (the old v1 file-signal detector was blind to package.json deps).
  const results = detectProfileV2(cwd);
  const project = scanProject(cwd);

  if (json) {
    process.stdout.write(JSON.stringify({ project, suggestions: results }, null, 2) + "\n");
    return 0;
  }

  // Project info
  const detected: string[] = [];
  if (project.languages.length) detected.push(...project.languages);
  if (project.frameworks.length) detected.push(...project.frameworks);
  if (project.tools.length) detected.push(...project.tools);

  process.stdout.write(`Detected: ${detected.length ? detected.join(", ") : "no strong signals"}\n\n`);

  if (results.length === 0) {
    process.stdout.write("No profile matches detected. Use `cue init` for interactive setup.\n");
    return 0;
  }

  process.stdout.write("Suggested profiles:\n\n");
  for (let i = 0; i < Math.min(results.length, 5); i++) {
    const r = results[i]!;
    process.stdout.write(`  ${i + 1}. ${r.profile}  (${Math.round(r.confidence * 100)}% match)\n`);
    process.stdout.write(`     signals: ${r.reasons.join(", ")}\n\n`);
  }

  if (apply && results.length > 0) {
    const best = results[0]!;
    writeFileSync(join(cwd, ".cue.profile"), best.profile + "\n");
    process.stdout.write(`✅ Pinned "${best.profile}" to .cue.profile\n`);
  } else if (!apply && results.length > 0) {
    process.stdout.write(`Run with --apply to pin the top match, or use \`cue init\` for interactive selection.\n`);
  }

  return 0;
}
