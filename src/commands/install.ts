/**
 * `cue install` — pre-materialize cue-managed runtimes and optionally install
 * profile-required CLIs.
 *
 * This is the safe umbrella for "make this profile ready" workflows:
 *   - materialize isolated Claude/Codex runtimes under ~/.config/cue/runtime/
 *   - optionally delegate to `cue cli install --all` for missing system CLIs
 *
 * Dry-run is the default. Pass --yes to write runtimes and run CLI installers.
 */

import { existsSync, readFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

import type { AgentKind, ResolvedProfile } from "../../profiles/_types";
import { configDir } from "../lib/config-paths";
import { resolveActiveProfile } from "../lib/cwd-resolver";
import { loadProfile, listProfiles } from "../lib/profile-loader";
import { resolveLocalSkill, listAllSkillIds } from "../lib/resolver-local";
import { materializeRuntime, type McpServerConfig } from "../lib/runtime-materializer";
import { run as cliRun } from "./cli";

type RuntimeAgent = Extract<AgentKind, "claude-code" | "codex">;

interface ParsedArgs {
  profiles: string[];
  allProfiles: boolean;
  agents: RuntimeAgent[];
  yes: boolean;
  dryRun: boolean;
  json: boolean;
  force: boolean;
  withClis: boolean;
}

interface InstallAction {
  profile: string;
  agent: RuntimeAgent;
  runtimeDir: string;
  status: "planned" | "rebuilt" | "cached" | "failed";
  error?: string;
}

const RUNTIME_AGENTS: RuntimeAgent[] = ["claude-code", "codex"];

function bold(s: string): string {
  return `\x1b[1m${s}\x1b[0m`;
}

function green(s: string): string {
  return `\x1b[32m${s}\x1b[0m`;
}

function yellow(s: string): string {
  return `\x1b[33m${s}\x1b[0m`;
}

function dim(s: string): string {
  return `\x1b[2m${s}\x1b[0m`;
}

function usage(): void {
  process.stdout.write(`cue install — prepare cue profiles for local agents

Usage:
  cue install [profile] [--agents claude-code,codex] [--with-clis] [--yes]
  cue install --all-profiles [--agents claude-code,codex] [--with-clis] [--yes]

Flags:
  --all-profiles       Prepare every installed profile
  --profile <name>     Prepare a specific profile
  --agents <list>      Runtime agents to materialize: claude-code,codex,all
  --with-clis          Also run cue cli install --all for each profile
  --yes                Execute writes/installers. Default is dry-run
  --dry-run            Show the plan without writing
  --force              Rebuild runtimes by dropping their .cue-hash first
  --json               Machine-readable output

Examples:
  cue install                         # plan active profile runtime install
  cue install gstack --yes            # build gstack Claude/Codex runtimes
  cue install --all-profiles --yes    # build all profile runtimes
  cue install backend --with-clis      # include CLI install plan
`);
}

function parseAgents(raw: string | undefined): RuntimeAgent[] | null {
  if (!raw || raw === "all") return [...RUNTIME_AGENTS];
  const out: RuntimeAgent[] = [];
  for (const part of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
    const normalized = part === "claude" ? "claude-code" : part;
    if (normalized !== "claude-code" && normalized !== "codex") return null;
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out.length > 0 ? out : null;
}

function parse(args: string[]): ParsedArgs | null {
  const profiles: string[] = [];
  let allProfiles = false;
  let agents: RuntimeAgent[] = [...RUNTIME_AGENTS];
  let yes = false;
  let dryRun = false;
  let json = false;
  let force = false;
  let withClis = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-h" || a === "--help") return null;
    if (a === "--all-profiles") allProfiles = true;
    else if (a === "--profile") profiles.push(args[++i] ?? "");
    else if (a === "--agents") {
      const parsed = parseAgents(args[++i]);
      if (!parsed) throw new Error("invalid --agents value; use claude-code,codex,all");
      agents = parsed;
    } else if (a === "--yes") yes = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--json") json = true;
    else if (a === "--force") force = true;
    else if (a === "--with-clis" || a === "--clis") withClis = true;
    else if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
    else profiles.push(a);
  }

  return {
    profiles: profiles.filter(Boolean),
    allProfiles,
    agents,
    yes,
    dryRun: dryRun || !yes,
    json,
    force,
    withClis,
  };
}

async function resolveProfiles(parsed: ParsedArgs): Promise<string[]> {
  if (parsed.allProfiles) return listProfiles();
  if (parsed.profiles.length > 0) return [...new Set(parsed.profiles)];
  const active = await resolveActiveProfile();
  if (!active) {
    throw new Error("no active profile. Pass a profile name or use --all-profiles.");
  }
  return [active];
}

async function expandWildcards(profile: ResolvedProfile): Promise<void> {
  if (!profile.skills.local.some((s) => s.id === "*/*")) return;
  const allIds = await listAllSkillIds();
  const wildcard = profile.skills.local.find((s) => s.id === "*/*")!;
  const existing = new Set(profile.skills.local.filter((s) => s.id !== "*/*").map((s) => s.id));
  profile.skills.local = [
    ...profile.skills.local.filter((s) => s.id !== "*/*"),
    ...allIds.filter((id) => !existing.has(id)).map((id) => ({ ...wildcard, id })),
  ];
}

async function loadMcpRegistry(agent: RuntimeAgent): Promise<Record<string, McpServerConfig>> {
  const root = process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? resolve(import.meta.dirname, "..", "..");
  const files = agent === "claude-code"
    ? ["claude_runtime.sanitized.json", "claude.sanitized.json"]
    : ["codex.sanitized.json"];
  const merged: Record<string, McpServerConfig> = {};
  for (const file of files) {
    try {
      const raw = JSON.parse(await readFile(join(root, "resources", "mcps", "configs", file), "utf8")) as {
        servers?: Record<string, McpServerConfig>;
      };
      for (const [id, config] of Object.entries(raw.servers ?? {})) {
        if (!(id in merged)) merged[id] = config;
      }
    } catch {
      // Missing registries are tolerated; validate/doctor report broken refs.
    }
  }
  return merged;
}

async function readUserMemory(agent: RuntimeAgent): Promise<string> {
  const path = agent === "claude-code"
    ? join(homedir(), ".claude", "CLAUDE.md")
    : join(homedir(), ".codex", "AGENTS.md");
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function resolveClaudeCredentialsSource(): Promise<string | undefined> {
  const explicit = process.env.CLAUDE_CONFIG_DIR;
  if (explicit && existsSync(join(explicit, ".credentials.json"))) return explicit;
  const global = join(homedir(), ".claude");
  if (existsSync(join(global, ".credentials.json"))) return global;
  return undefined;
}

function runtimeDirFor(profile: string, agent: RuntimeAgent): string {
  return join(configDir(), "runtime", profile, agent === "claude-code" ? "claude" : "codex");
}

async function materializeProfile(profileName: string, agent: RuntimeAgent, force: boolean): Promise<InstallAction> {
  const runtimeDir = runtimeDirFor(profileName, agent);
  try {
    if (force) await rm(join(runtimeDir, ".cue-hash"), { force: true });
    const profile = await loadProfile(profileName);
    await expandWildcards(profile);
    const result = await materializeRuntime({
      profile,
      agent,
      runtimeRoot: join(configDir(), "runtime"),
      skillSourceLookup: (id) => resolveLocalSkill(id),
      mcpRegistry: await loadMcpRegistry(agent),
      userClaudeMd: await readUserMemory(agent),
      credentialsSource: agent === "claude-code" ? await resolveClaudeCredentialsSource() : undefined,
    });
    return {
      profile: profileName,
      agent,
      runtimeDir: result.runtimeDir,
      status: result.rebuilt ? "rebuilt" : "cached",
    };
  } catch (err) {
    return {
      profile: profileName,
      agent,
      runtimeDir,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function plannedActions(profiles: string[], agents: RuntimeAgent[]): InstallAction[] {
  const actions: InstallAction[] = [];
  for (const profile of profiles) {
    for (const agent of agents) {
      actions.push({ profile, agent, runtimeDir: runtimeDirFor(profile, agent), status: "planned" });
    }
  }
  return actions;
}

async function captureStdout(fn: () => Promise<number>): Promise<{ stdout: string; code: number }> {
  const orig = process.stdout.write.bind(process.stdout);
  let stdout = "";
  (process.stdout as any).write = (chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  };
  try {
    const code = await fn();
    return { stdout, code };
  } finally {
    (process.stdout as any).write = orig;
  }
}

async function runCliStep(profile: string, dryRun: boolean, json: boolean): Promise<{ profile: string; code: number; stdout?: string }> {
  const args = ["install", "--all", profile];
  if (!dryRun) args.push("--yes");
  if (json || dryRun) args.push("--json");
  if (json || dryRun) {
    const result = await captureStdout(() => cliRun(args));
    return { profile, code: result.code, stdout: result.stdout };
  }
  const code = await cliRun(args);
  return { profile, code };
}

function parseJsonOrText(stdout: string | undefined): unknown {
  if (!stdout) return undefined;
  try {
    return JSON.parse(stdout);
  } catch {
    return { text: stdout };
  }
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    usage();
    return 0;
  }

  let parsed: ParsedArgs;
  try {
    const p = parse(args);
    if (!p) {
      usage();
      return 0;
    }
    parsed = p;
  } catch (err) {
    process.stderr.write(`cue install: ${(err as Error).message}\n`);
    return 1;
  }

  let profiles: string[];
  try {
    profiles = await resolveProfiles(parsed);
  } catch (err) {
    process.stderr.write(`cue install: ${(err as Error).message}\n`);
    return 1;
  }

  const actions = parsed.dryRun
    ? plannedActions(profiles, parsed.agents)
    : (await Promise.all(profiles.flatMap((profile) =>
        parsed.agents.map((agent) => materializeProfile(profile, agent, parsed.force)),
      )));

  const cliResults = parsed.withClis
    ? await Promise.all(profiles.map((profile) => runCliStep(profile, parsed.dryRun, parsed.json)))
    : [];

  if (parsed.json) {
    process.stdout.write(JSON.stringify({
      dryRun: parsed.dryRun,
      profiles,
      agents: parsed.agents,
      actions,
      cliResults: cliResults.map((r) => ({
        profile: r.profile,
        code: r.code,
        plan: parseJsonOrText(r.stdout),
      })),
    }, null, 2) + "\n");
    return actions.some((a) => a.status === "failed") || cliResults.some((r) => r.code !== 0) ? 1 : 0;
  }

  process.stdout.write(`\n  ${bold("cue install")} ${parsed.dryRun ? dim("(dry-run; pass --yes to execute)") : ""}\n`);
  process.stdout.write(`  profiles: ${profiles.join(", ")}\n`);
  process.stdout.write(`  agents:   ${parsed.agents.join(", ")}\n\n`);

  for (const action of actions) {
    const status = action.status === "planned" ? yellow("plan")
      : action.status === "rebuilt" ? green("rebuilt")
      : action.status === "cached" ? green("cached")
      : yellow("failed");
    process.stdout.write(`  ${status.padEnd(16)} ${action.profile.padEnd(20)} ${action.agent.padEnd(11)} ${dim(action.runtimeDir)}\n`);
    if (action.error) process.stdout.write(`    ${yellow(action.error)}\n`);
  }

  if (parsed.withClis) {
    process.stdout.write(`\n  ${bold("CLI installers")}\n`);
    for (const result of cliResults) {
      process.stdout.write(`  ${result.code === 0 ? green("ok") : yellow("failed")} ${result.profile}\n`);
      if (result.stdout && !parsed.dryRun) process.stdout.write(result.stdout);
      if (result.stdout && parsed.dryRun) {
        try {
          const plan = JSON.parse(result.stdout) as { plans?: unknown[] };
          process.stdout.write(`    ${plan.plans?.length ?? 0} missing CLI plan(s)\n`);
        } catch {
          process.stdout.write(result.stdout);
        }
      }
    }
  }

  if (parsed.dryRun) {
    process.stdout.write(`\n  Execute: ${bold("cue install " + (parsed.allProfiles ? "--all-profiles " : profiles.join(" ") + " ") + "--yes")}\n\n`);
  } else {
    process.stdout.write(`\n  ${green("install complete")}\n\n`);
  }

  return actions.some((a) => a.status === "failed") || cliResults.some((r) => r.code !== 0) ? 1 : 0;
}
