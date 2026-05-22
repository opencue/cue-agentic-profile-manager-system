/**
 * `cue new <name>`
 *
 * Creates a schema-valid profile from an empty template, an existing seed, or
 * the scan/domain heuristic.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { ProfileDomain } from "../lib/profile-generator";
import {
  ProfileAlreadyExists,
  bucketSkills,
  defaultProfilesDir,
  formatScanTree,
  generateProfile,
  profileExists,
  scanInstalledSkills,
  validateProfileName,
  writeGeneratedProfile,
} from "../lib/profile-generator";

interface NewArgs {
  name?: string;
  fromScan: boolean;
  seed?: string;
  auto: boolean;
  force: boolean;
  domain?: ProfileDomain;
}

const DOMAIN_NAMES = new Set<ProfileDomain>([
  "frontend",
  "backend",
  "docs",
  "devops",
  "media",
  "data",
  "marketing",
  "research",
  "security",
  "orchestration",
  "core",
  "misc",
]);

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    printHelp();
    return 0;
  }

  let parsed: NewArgs;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    process.stderr.write(`cue new: ${messageOf(err)}\n`);
    return 1;
  }

  if (!parsed.name) {
    process.stderr.write("cue new: missing profile name\n");
    printHelp();
    return 1;
  }
  if (!validateProfileName(parsed.name)) {
    process.stderr.write(
      `cue new: invalid profile name "${parsed.name}" (use lowercase kebab-case)\n`,
    );
    return 1;
  }
  if (parsed.fromScan && parsed.seed) {
    process.stderr.write("cue new: choose either --from-scan or --seed, not both\n");
    return 1;
  }

  try {
    if (parsed.fromScan) {
      return await createFromScan(parsed);
    }
    if (parsed.seed) {
      return await createFromSeed(parsed);
    }
    return await createEmpty(parsed);
  } catch (err) {
    if (err instanceof ProfileAlreadyExists) {
      process.stderr.write(`cue new: ${err.message}\n`);
      return 1;
    }
    process.stderr.write(`cue new: ${messageOf(err)}\n`);
    return 1;
  }
}

async function createFromScan(args: NewArgs): Promise<number> {
  if (!args.auto && !isInteractive()) {
    process.stderr.write(
      "cue new: --from-scan needs a TTY for confirmation; pass --auto for CI\n",
    );
    return 1;
  }

  const scan = await scanInstalledSkills();
  const assignments = bucketSkills(scan.skills);
  const domains = inferDomainFilter(args.name!, args.domain);
  const inheritCore = await profileExists("core");
  const generated = generateProfile({
    name: args.name!,
    assignments,
    domains,
    inheritCore,
  });

  if (!args.auto) {
    process.stdout.write(formatScanTree(assignments) + "\n\n");
    if (scan.diagnostics.length > 0) {
      process.stdout.write("Diagnostics:\n");
      for (const diagnostic of scan.diagnostics) {
        process.stdout.write(`  - ${diagnostic}\n`);
      }
      process.stdout.write("\n");
    }
    process.stdout.write(generated.yaml + "\n");
    const ok = await confirm("Write this profile?", true);
    if (!ok) return 1;
  }

  const path = await writeGeneratedProfile(generated, { force: args.force });
  process.stdout.write(`Created ${path}\n`);
  if (generated.core.length > 0 && !inheritCore) {
    process.stdout.write(
      `Detected ${generated.core.length} core candidates; create profiles/core/profile.yaml to share them via inherits: core.\n`,
    );
  }
  return 0;
}

async function createFromSeed(args: NewArgs): Promise<number> {
  if (!args.auto && !isInteractive()) {
    process.stderr.write(
      "cue new: --seed needs a TTY for modifications; pass --auto to copy unchanged\n",
    );
    return 1;
  }

  const sourcePath = join(defaultProfilesDir(), args.seed!, "profile.yaml");
  const sourceText = await readFile(sourcePath, "utf8");
  const source = parseYaml(sourceText) as Record<string, unknown> | null;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error(`Seed profile ${args.seed} is not a YAML mapping`);
  }

  source.name = args.name!;
  if (!args.auto) {
    const currentDescription =
      typeof source.description === "string"
        ? source.description
        : `Profile seeded from ${args.seed}`;
    const nextDescription = await promptLine(
      `Description [${currentDescription}]: `,
    );
    source.description = nextDescription.trim() || currentDescription;
  } else if (typeof source.description !== "string" || source.description.length === 0) {
    source.description = `Profile seeded from ${args.seed}`;
  }

  const yaml = stringifyYaml(source).trimEnd() + "\n";
  const generated = {
    profile: { name: args.name!, description: String(source.description) },
    yaml,
    included: [],
    core: [],
    skipped: [],
  };
  const path = await writeGeneratedProfile(generated, { force: args.force });
  process.stdout.write(`Created ${path}\n`);
  return 0;
}

async function createEmpty(args: NewArgs): Promise<number> {
  const description = `Custom soul profile ${args.name}`;
  const generated = {
    profile: { name: args.name!, description, agents: ["claude-code", "codex"] },
    yaml: [
      `name: ${JSON.stringify(args.name)}`,
      `description: ${JSON.stringify(description)}`,
      "agents: [claude-code, codex]",
      "",
    ].join("\n"),
    included: [],
    core: [],
    skipped: [],
  };
  const path = await writeGeneratedProfile(generated, { force: args.force });
  process.stdout.write(`Created ${path}\n`);
  return 0;
}

function parseArgs(args: string[]): NewArgs {
  const out: NewArgs = {
    fromScan: false,
    auto: false,
    force: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--from-scan") {
      out.fromScan = true;
    } else if (arg === "--auto") {
      out.auto = true;
    } else if (arg === "--force") {
      out.force = true;
    } else if (arg === "--seed") {
      const seed = args[++i];
      if (!seed) throw new Error("--seed requires a profile name");
      out.seed = seed;
    } else if (arg === "--domain") {
      const domain = args[++i];
      if (!domain || !DOMAIN_NAMES.has(domain as ProfileDomain)) {
        throw new Error("--domain requires a known domain");
      }
      out.domain = domain as ProfileDomain;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown flag ${arg}`);
    } else if (!out.name) {
      out.name = arg;
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }

  return out;
}

function inferDomainFilter(
  name: string,
  explicit: ProfileDomain | undefined,
): ProfileDomain[] | undefined {
  if (explicit) return [explicit];
  if (DOMAIN_NAMES.has(name as ProfileDomain) && name !== "core" && name !== "misc") {
    return [name as ProfileDomain];
  }
  return undefined;
}

async function confirm(question: string, defaultYes: boolean): Promise<boolean> {
  const answer = await promptLine(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `);
  const normalized = answer.trim().toLowerCase();
  if (!normalized) return defaultYes;
  return normalized === "y" || normalized === "yes";
}

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: cue new <name> [--from-scan] [--seed <profile>] [--auto] [--force]",
      "",
      "Modes:",
      "  no flags             Create an empty schema-valid profile",
      "  --from-scan          Generate a draft from discovered skills/plugins",
      "  --seed <profile>     Copy an existing profile and update its name",
      "",
      "Flags:",
      "  --auto               Do not prompt; required for non-TTY --from-scan/--seed",
      "  --domain <domain>    Limit --from-scan output to one inferred domain",
      "  --force              Overwrite profiles/<name>/profile.yaml if it exists",
      "  --help               Show this help",
      "",
    ].join("\n"),
  );
}
