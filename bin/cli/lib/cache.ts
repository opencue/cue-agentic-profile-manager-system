/**
 * Shared cache helpers for resolver modules (currently only resolver-npx).
 *
 * The on-disk layout is contract-bound (see profiles/_cache/README.md):
 *
 *   <repoRoot>/profiles/_cache/npx/<key>/<skill-name>/SKILL.md
 *
 * Callers compute `<key>` (sha256 of repo + pin) and hand it to:
 *   - cachePath(key)        -> absolute dir path (may or may not exist)
 *   - cacheHit(key)         -> true iff a non-empty cache dir exists
 *   - cachePut(key, srcDir) -> atomic-ish move of an already-prepared
 *                              directory into the cache slot
 *
 * The cache root is injected so tests can use tmpdir() instead of touching
 * the real profiles/_cache/ tree.
 *
 * TODO(future): cache eviction policy. Today the cache grows unbounded until
 * a human runs `rm -rf profiles/_cache/npx/*`. A future iteration should add
 * LRU + a size budget + a `soul cache prune` subcommand.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface CacheLayout {
  /** Repo root (absolute). Cache lives at `<repoRoot>/profiles/_cache/npx/`. */
  repoRoot: string;
}

const NPX_SUBDIR = "npx";

/**
 * Resolve the absolute cache dir for a given key. Does NOT create it.
 *
 * `key` must be a hex sha256 — callers compute it via crypto.createHash so
 * we keep cache.ts hash-agnostic and reusable for non-npx caches later.
 */
export function cachePath(layout: CacheLayout, key: string): string {
  if (!key || key.includes("/") || key.includes("..")) {
    throw new Error(`cache: invalid key ${JSON.stringify(key)}`);
  }
  return resolve(layout.repoRoot, "profiles", "_cache", NPX_SUBDIR, key);
}

/**
 * True iff the cache dir for `key` exists AND contains at least one entry.
 * An empty dir is treated as a miss — half-populated caches are corruption,
 * not hits.
 */
export function cacheHit(layout: CacheLayout, key: string): boolean {
  const dir = cachePath(layout, key);
  if (!existsSync(dir)) return false;
  try {
    const st = statSync(dir);
    if (!st.isDirectory()) return false;
    const entries = readdirSync(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * Move an already-prepared directory at `srcDir` into the cache slot for
 * `key`. If the slot already exists, it's replaced. Cross-device safe in
 * the common case (same FS) — we rely on rename within the repo tree.
 *
 * Callers should populate `srcDir` in a temp directory first, then call
 * cachePut to publish atomically. Never write directly into cachePath().
 */
export function cachePut(layout: CacheLayout, key: string, srcDir: string): string {
  if (!existsSync(srcDir)) {
    throw new Error(`cache: source dir does not exist: ${srcDir}`);
  }
  const dest = cachePath(layout, key);
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  renameSync(srcDir, dest);
  return dest;
}

/**
 * Internal helper: list children of a cache slot. Used by resolver-npx to
 * detect partial / corrupt caches without re-implementing path math.
 */
export function cacheChildren(layout: CacheLayout, key: string): string[] {
  const dir = cachePath(layout, key);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Convenience: full path to a single skill inside a cache slot. */
export function cacheSkillPath(layout: CacheLayout, key: string, skill: string): string {
  return join(cachePath(layout, key), skill);
}
