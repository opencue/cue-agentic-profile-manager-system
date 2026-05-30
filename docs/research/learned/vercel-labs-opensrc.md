# Learned from `vercel-labs/opensrc`

> Fetched via `opensrc path vercel-labs/opensrc` (branch `main`, 2026-05-31).
> Lens: how does opensrc cache fetched source, and could cue's runtime reuse it?

## Question

opensrc fetches package/repo source once and returns a cached path on every
later call. Could cue's runtime materialization reuse that caching approach?

## How opensrc caches (source-cited)

opensrc keys its cache by a **name + version tuple** and short-circuits the
fetch when that tuple already exists on disk.

- Cache root: `$OPENSRC_HOME` or `~/.opensrc/` — `core/cache.rs:48-55`
- On-disk layout: `repos/<host>/<owner>/<repo>/<version>/` — `core/cache.rs:80-86`
- Index: a single `sources.json` listing `{name, version, registry, path,
  fetchedAt}` per entry — `core/cache.rs:19-46`
- Short-circuit: if the requested `version` matches an existing entry, return
  it with `from_cache: true` and never clone — `core/fetcher.rs:37-50`,
  `131-144`
- Atomic write: serialize to `.sources.json.tmp`, then `fs::rename` over the
  real file so concurrent readers never see a half-written index —
  `core/cache.rs:124-153`
- Corrupt-index recovery: if `sources.json` fails to parse, back it up to
  `.bak` and continue with an empty default instead of crashing —
  `core/cache.rs:97-114`
- Refcounted shared storage: many npm packages can resolve to one monorepo
  clone; the clone is deleted only when no other package still references it —
  `core/cache.rs:177-210`

## What cue already does (source-cited)

cue's `materializeRuntime` already implements the same short-circuit, keyed by
a **content hash** instead of a version string.

- `computeHash` = sha256 of canonical sorted JSON of `{agent, profile}` —
  `src/lib/runtime-materializer.ts:82-85`
- Hash stored at `<runtimeDir>/.cue-hash` — `runtime-materializer.ts:550`
- Short-circuit: read `.cue-hash`, compare; if equal, return
  `rebuilt: false` and skip the rebuild — `runtime-materializer.ts:111-134`
- Missing/unreadable hash file falls through to a rebuild (try/catch) —
  `runtime-materializer.ts:135`
- Atomic swap: build in a sibling tmp dir, then rename — `runtime-materializer.ts:4, 137, 549`

## Verdict (cue lens)

**Don't port. cue already does this, and content-hash is strictly stronger
than opensrc's version-string match.**

| Pattern | opensrc | cue today | Adopt? |
|---|---|---|---|
| Skip work when cached | version-tuple match (`fetcher.rs:37-50`) | sha256 content hash (`materializer.ts:111-134`) | No — cue's catches *any* profile change, not just version bumps |
| Atomic write | tmp + rename (`cache.rs:124-153`) | tmp dir + rename (`materializer.ts:137`) | No — already present |
| Cache-hit signal to caller | `from_cache` bool (`fetcher.rs:21`) | `rebuilt: false` (`materializer.ts:133`) | No — already present |
| Refcounted shared storage | refcount on delete (`cache.rs:177-210`) | skills shared by symlink to source | No — cue's symlink model already dedups storage |
| Corrupt-index recovery | back up `.bak`, continue (`cache.rs:97-114`) | silent rebuild on bad hash | Marginal — see below |

## One marginal micro-nicety

opensrc preserves a corrupt index as `sources.json.bak` before falling back
(`cache.rs:97-114`). cue's bad-hash path just rebuilds silently
(`materializer.ts:135`). cue's behavior is *safer* (a bad hash can't poison a
rebuild) but loses the corrupt artifact for debugging. Note-only; not worth a
change unless we ever see hash-corruption reports.

## Recommendation

**Note-only.** No code change. The exercise confirms cue's runtime caching is
already at or above opensrc's design. File this as evidence the next time
someone proposes "add content-hash caching to the runtime" — it's already there
at `runtime-materializer.ts:82-134`.
