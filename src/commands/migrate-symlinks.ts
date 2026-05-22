/**
 * `cue migrate-symlinks` — rewrite external symlinks after a path change.
 *
 * Walks the directories named in --roots (default: ~/.codex/skills,
 * ~/.claude-accounts/{any}/skills), inspects each symlink, and if the link's
 * target starts with any of the configured `from` prefixes, replaces the link
 * with one whose target starts with the matching `to` prefix. Idempotent;
 * dry-run by default.
 *
 * Mappings are applied in declared order, first match wins per symlink. This
 * lets a single invocation chain rewrites (e.g. the soul→cue rename AND the
 * skills→resources/skills reorg) without rewriting the same link twice.
 */

import { readdir, readlink, lstat, unlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Mapping {
  from: string;
  to: string;
}

export interface MigrateOptions {
  /** Either a single mapping (back-compat) or a list of mappings applied in order. */
  from?: string;
  to?: string;
  mappings?: Mapping[];
  roots: string[];
  dryRun: boolean;
}

export interface MigrateSummary {
  scanned: number;
  updated: number;
  wouldUpdate: number;
  skipped: number;
  errors: { path: string; reason: string }[];
}

function resolveMappings(opts: MigrateOptions): Mapping[] {
  if (opts.mappings && opts.mappings.length > 0) return opts.mappings;
  if (opts.from && opts.to) return [{ from: opts.from, to: opts.to }];
  return [];
}

export async function migrateSymlinks(opts: MigrateOptions): Promise<MigrateSummary> {
  const summary: MigrateSummary = { scanned: 0, updated: 0, wouldUpdate: 0, skipped: 0, errors: [] };
  const mappings = resolveMappings(opts);
  if (mappings.length === 0) return summary;
  for (const root of opts.roots) await walk(root, mappings, opts.dryRun, summary);
  return summary;
}

async function walk(dir: string, mappings: Mapping[], dryRun: boolean, s: MigrateSummary): Promise<void> {
  let entries: string[];
  try { entries = await readdir(dir); } catch { return; }
  for (const name of entries) {
    const path = join(dir, name);
    let st;
    try { st = await lstat(path); } catch (e) { s.errors.push({ path, reason: (e as Error).message }); continue; }
    if (st.isSymbolicLink()) {
      s.scanned++;
      const target = await readlink(path);
      const match = mappings.find((m) => target.startsWith(m.from));
      if (match) {
        const newTarget = match.to + target.slice(match.from.length);
        if (dryRun) {
          s.wouldUpdate++;
          process.stdout.write(`would update: ${path} -> ${newTarget}\n`);
        } else {
          await unlink(path);
          await symlink(newTarget, path);
          s.updated++;
          process.stdout.write(`updated: ${path} -> ${newTarget}\n`);
        }
      } else {
        s.skipped++;
      }
    } else if (st.isDirectory()) {
      await walk(path, mappings, dryRun, s);
    }
  }
}

function parseMap(arg: string): Mapping | null {
  const eq = arg.indexOf("=");
  if (eq <= 0 || eq === arg.length - 1) return null;
  return { from: arg.slice(0, eq), to: arg.slice(eq + 1) };
}

export async function run(args: string[]): Promise<number> {
  let from = "";
  let to = "";
  let dryRun = true;
  const roots: string[] = [];
  const mappings: Mapping[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--from") from = args[++i] ?? "";
    else if (a === "--to") to = args[++i] ?? "";
    else if (a === "--apply") dryRun = false;
    else if (a === "--root") roots.push(args[++i] ?? "");
    else if (a === "--map") {
      const parsed = parseMap(args[++i] ?? "");
      if (parsed) mappings.push(parsed);
      else {
        process.stderr.write("cue migrate-symlinks: --map expects <from>=<to>\n");
        return 1;
      }
    }
  }
  if (from && to) mappings.unshift({ from, to });
  if (mappings.length === 0) {
    process.stderr.write(
      "usage: cue migrate-symlinks [--map <from>=<to>]+ [--from <path> --to <path>] [--apply] [--root <dir>]+\n",
    );
    return 1;
  }
  const defaultRoots = roots.length > 0 ? roots : [
    join(homedir(), ".codex", "skills"),
    join(homedir(), ".claude-accounts"),
  ];
  const summary = await migrateSymlinks({ mappings, roots: defaultRoots, dryRun });
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  return summary.errors.length > 0 ? 2 : 0;
}
