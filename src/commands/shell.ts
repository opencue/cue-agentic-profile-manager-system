/**
 * `soul shell install` — drop ~/.local/bin/{claude,codex} shims and verify PATH.
 * `soul shell uninstall` — remove the shims.
 *
 * The shim is 3 lines of bash: header, exec, EOF. No logic, no version-pinning;
 * if we ever change the shim format we expect users to rerun install.
 */

import { chmod, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface InstallOptions {
  homeDir: string;
  /** PATH split into directories, in order. */
  pathDirs: string[];
  /** Absolute path to the real claude binary (if any). */
  realClaude: string | null;
  /** Absolute path to the real codex binary (if any). */
  realCodex: string | null;
}

const SHIM = (agent: string) => `#!/usr/bin/env bash
exec cue launch ${agent} "$@"
`;

function shimDir(homeDir: string): string { return join(homeDir, ".local", "bin"); }

function isShimDirFirst(opts: InstallOptions, realBin: string | null): boolean {
  if (!realBin) return true; // no real binary, no conflict.
  const sd = shimDir(opts.homeDir);
  const sdIdx = opts.pathDirs.findIndex((d) => d === sd);
  if (sdIdx < 0) return false;
  for (let i = 0; i < sdIdx; i++) {
    if (realBin.startsWith(opts.pathDirs[i] + "/")) return false;
  }
  return true;
}

export async function runInstall(opts: InstallOptions): Promise<number> {
  if (!isShimDirFirst(opts, opts.realClaude) || !isShimDirFirst(opts, opts.realCodex)) {
    process.stderr.write(
      `cue shell install: ~/.local/bin must appear earlier in PATH than the real claude/codex.\n` +
      `Add this to your shell rc and re-run:\n` +
      `  export PATH="$HOME/.local/bin:$PATH"\n`,
    );
    return 1;
  }
  await mkdir(shimDir(opts.homeDir), { recursive: true });
  for (const agent of ["claude", "codex"]) {
    const path = join(shimDir(opts.homeDir), agent);
    await writeFile(path, SHIM(agent));
    await chmod(path, 0o755);
  }
  process.stdout.write(`Wrote ${shimDir(opts.homeDir)}/{claude,codex}\n`);
  return 0;
}

export async function runUninstall(opts: { homeDir: string }): Promise<number> {
  for (const agent of ["claude", "codex"]) {
    try {
      await rm(join(shimDir(opts.homeDir), agent));
    } catch {/* ignore — already gone */}
  }
  return 0;
}

// Dispatch wrapper for the CLI registry.
export async function run(args: string[]): Promise<number> {
  const sub = args[0];
  if (sub === "install") {
    return runInstall({
      homeDir: homedir(),
      pathDirs: (process.env.PATH ?? "").split(":"),
      realClaude: await findRealBin("claude"),
      realCodex: await findRealBin("codex"),
    });
  }
  if (sub === "uninstall") return runUninstall({ homeDir: homedir() });
  process.stderr.write("cue shell: usage: cue shell {install|uninstall}\n");
  return 1;
}

async function findRealBin(name: string): Promise<string | null> {
  const sd = shimDir(homedir());
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === sd) continue;
    try {
      const path = join(dir, name);
      const st = await stat(path);
      if (st.isFile() && (st.mode & 0o111) !== 0) return path;
    } catch {/* not in this dir */}
  }
  return null;
}
