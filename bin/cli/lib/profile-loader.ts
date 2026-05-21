/**
 * Profile loader — reads `profiles/<name>/profile.yaml`, validates against the
 * draft-07 schema in `profiles/schema.json`, and resolves the `inherits`
 * chain into a fully-merged `ResolvedProfile`.
 *
 * Pure-ish: the only side effects are filesystem reads under `profiles/`.
 * Never throws raw — every failure surfaces as a typed `ProfileError` subclass
 * from `profiles/_types.ts`.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { parse as parseYaml } from "yaml";

import {
  InheritanceCycle,
  InheritanceDepthExceeded,
  type NpxSkillRef,
  type Profile,
  ProfileError,
  ProfileNotFound,
  type ResolvedProfile,
  SchemaViolation,
} from "../../../profiles/_types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Inheritance depth limit, inclusive. depth == number of ancestors. */
const MAX_INHERITANCE_DEPTH = 3;

/** Resolve repo root by walking up from this file: bin/cli/lib -> repo root. */
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const DEFAULT_PROFILES_DIR = join(REPO_ROOT, "profiles");

/**
 * Roots the loader against a profiles/ tree. Honors `SOUL_PROFILES_DIR` so
 * tests can point at a temp directory without monkey-patching. The schema
 * file always comes from the repo's `profiles/schema.json` — it is the
 * canonical contract and does not move with the data root.
 */
function profilesDir(): string {
  return process.env.SOUL_PROFILES_DIR ?? DEFAULT_PROFILES_DIR;
}

const SCHEMA_PATH = join(DEFAULT_PROFILES_DIR, "schema.json");

// ---------------------------------------------------------------------------
// Ajv validator (lazy singleton)
// ---------------------------------------------------------------------------

let _validator: ValidateFunction | null = null;

async function getValidator(): Promise<ValidateFunction> {
  if (_validator) return _validator;
  const schemaText = await readFile(SCHEMA_PATH, "utf8");
  const schema = JSON.parse(schemaText);
  const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: false });
  _validator = ajv.compile(schema);
  return _validator;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function profileYamlPath(name: string): string {
  return join(profilesDir(), name, "profile.yaml");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Single-profile read + validate (no inheritance resolution)
// ---------------------------------------------------------------------------

async function readRawProfile(name: string): Promise<Profile> {
  const path = profileYamlPath(name);
  if (!(await pathExists(path))) {
    throw new ProfileNotFound(name);
  }

  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    // File disappeared between stat and read, or permission flip. Treat as
    // not-found rather than leaking a raw fs error.
    throw new ProfileNotFound(name);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    throw new SchemaViolation(name, [
      {
        keyword: "yaml-parse",
        message: err instanceof Error ? err.message : String(err),
      },
    ]);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SchemaViolation(name, [
      { keyword: "type", message: "profile.yaml must be a YAML mapping" },
    ]);
  }

  const validate = await getValidator();
  if (!validate(parsed)) {
    throw new SchemaViolation(
      name,
      (validate.errors ?? []) as ErrorObject[],
    );
  }

  const profile = parsed as Profile;

  // Lint rule E1 (per SCHEMA.md): directory name must equal the `name:` field.
  if (profile.name !== name) {
    throw new SchemaViolation(name, [
      {
        keyword: "name-mismatch",
        message: `Profile dir "${name}" does not match name field "${profile.name}"`,
      },
    ]);
  }

  return profile;
}

// ---------------------------------------------------------------------------
// Deep-merge helpers
// ---------------------------------------------------------------------------

/** Concat then dedupe primitives, preserving order (parent first, child last). */
function dedupePrimitiveArray<T extends string>(
  parent: T[] | undefined,
  child: T[] | undefined,
): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of [...(parent ?? []), ...(child ?? [])]) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/**
 * Merge NpxSkillRef arrays. Identity = `repo`. When parent and child both have
 * the same repo, the child entry wins entirely (its pin + skills replace the
 * parent's). Per SCHEMA.md the merge rule for arrays is "concat + dedupe by
 * identity"; for NpxSkillRef the per-repo override is the most useful reading
 * because pin changes are the whole point of overriding.
 */
function mergeNpxRefs(
  parent: NpxSkillRef[] | undefined,
  child: NpxSkillRef[] | undefined,
): NpxSkillRef[] {
  const byRepo = new Map<string, NpxSkillRef>();
  for (const ref of parent ?? []) byRepo.set(ref.repo, ref);
  for (const ref of child ?? []) byRepo.set(ref.repo, ref);
  return [...byRepo.values()];
}

interface ProfileSkillsResolved {
  local: string[];
  npx: NpxSkillRef[];
  plugins: string[];
}

function mergeSkills(
  parent: Profile["skills"],
  child: Profile["skills"],
): ProfileSkillsResolved {
  return {
    local: dedupePrimitiveArray(parent?.local, child?.local),
    npx: mergeNpxRefs(parent?.npx, child?.npx),
    plugins: dedupePrimitiveArray(parent?.plugins, child?.plugins),
  };
}

function mergeEnv(
  parent: Profile["env"],
  child: Profile["env"],
): Record<string, string> {
  return { ...(parent ?? {}), ...(child ?? {}) };
}

const DEFAULT_AGENTS: ResolvedProfile["agents"] = ["claude-code", "codex"];

// ---------------------------------------------------------------------------
// Inheritance resolution
// ---------------------------------------------------------------------------

/**
 * Walk the `inherits` chain root-first. Returns `[oldestAncestor, ..., self]`.
 * Detects cycles and enforces a max depth (parent count) of 3.
 */
async function buildInheritanceChain(name: string): Promise<Profile[]> {
  const chainNames: string[] = [];
  const chain: Profile[] = [];
  let current: string | undefined = name;

  while (current) {
    if (chainNames.includes(current)) {
      throw new InheritanceCycle([...chainNames, current]);
    }
    chainNames.push(current);

    const profile = await readRawProfile(current);
    chain.push(profile);
    current = profile.inherits;
  }

  // chainNames is [child, parent, grandparent, ...]; parents = total - 1.
  if (chainNames.length - 1 > MAX_INHERITANCE_DEPTH) {
    throw new InheritanceDepthExceeded(chainNames);
  }

  // Reverse so the oldest ancestor is first and the leaf is last.
  return chain.reverse();
}

/** Fold the chain root-first into a resolved profile. */
function foldChain(chain: Profile[]): ResolvedProfile {
  if (chain.length === 0) {
    // Defensive — buildInheritanceChain always returns >=1 entry.
    throw new ProfileError(
      "EMPTY_CHAIN",
      "Inheritance chain unexpectedly empty",
    );
  }

  // Start from the root ancestor.
  let acc: ResolvedProfile = normalizeToResolved(chain[0]!, [chain[0]!.name]);

  for (let i = 1; i < chain.length; i++) {
    const child = chain[i]!;
    acc = {
      // Identity comes from the leaf.
      name: child.name,
      description: child.description,
      // agents: arrays merge by dedupe; if neither parent nor child declares
      // agents we fall back to the default at the end.
      agents: dedupePrimitiveArray(
        acc.agents,
        child.agents,
      ) as ResolvedProfile["agents"],
      // inherits is a leaf-level field; we drop it from the resolved view
      // because the chain is already flattened. But we surface it on the leaf
      // so callers can see the immediate parent if they want.
      inherits: child.inherits,
      skills: mergeSkills(acc.skills, child.skills),
      mcps: dedupePrimitiveArray(acc.mcps, child.mcps),
      env: mergeEnv(acc.env, child.env),
      inheritanceChain: [...acc.inheritanceChain, child.name],
    };
  }

  // If neither parent nor child declared `agents`, apply the schema default.
  if (acc.agents.length === 0) {
    acc = { ...acc, agents: [...DEFAULT_AGENTS] };
  }

  return acc;
}

/** Promote a raw `Profile` into a `ResolvedProfile` with all defaults applied. */
function normalizeToResolved(p: Profile, chain: string[]): ResolvedProfile {
  return {
    name: p.name,
    description: p.description,
    agents: p.agents && p.agents.length > 0 ? [...p.agents] : [],
    inherits: p.inherits,
    skills: {
      local: [...(p.skills?.local ?? [])],
      npx: [...(p.skills?.npx ?? [])],
      plugins: [...(p.skills?.plugins ?? [])],
    },
    mcps: [...(p.mcps ?? [])],
    env: { ...(p.env ?? {}) },
    inheritanceChain: chain,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load and fully resolve a profile by name. Reads
 * `profiles/<name>/profile.yaml`, validates it, then recursively merges in any
 * ancestor profiles declared via `inherits`.
 *
 * @throws ProfileNotFound      if `profiles/<name>/profile.yaml` is missing
 * @throws SchemaViolation      if YAML is malformed or fails schema validation
 * @throws InheritanceCycle     if the `inherits` chain loops
 * @throws InheritanceDepthExceeded if the chain has more than 3 ancestors
 */
export async function loadProfile(name: string): Promise<ResolvedProfile> {
  const chain = await buildInheritanceChain(name);
  return foldChain(chain);
}

/**
 * List every profile under `profiles/` that contains a `profile.yaml`, sorted
 * alphabetically. Directory entries beginning with `_` (e.g. `_active`,
 * `_cache`, `_examples`) are skipped — those are reserved system folders.
 */
export async function listProfiles(): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(profilesDir(), { withFileTypes: true });
  } catch {
    return [];
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    if (await pathExists(profileYamlPath(entry.name))) {
      names.push(entry.name);
    }
  }
  names.sort();
  return names;
}
