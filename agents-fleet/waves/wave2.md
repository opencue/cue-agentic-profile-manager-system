# Wave 2 — paste each prompt into its own pane (gate: Wave 1 PRs merged)

## A4

You are agent A4 working on github.com/recodeee/soul.

GOAL: Build the `soul` CLI skeleton. Bun-based (consistent with existing macOS
setup). Subcommand dispatch only — actual logic lives in modules owned by
A5–A9.

OWNS:
  bin/soul                          (executable shebang script, bun)
  bin/cli/index.ts                  (entrypoint)
  bin/cli/commands/                 (subcommand directory)
  bin/cli/commands/_index.ts        (subcommand registry)
  package.json                      (NEW — bun project at repo root, minimal)

WAITS ON: A1 (uses profiles/_types.ts), A2 (bin/ dir exists).

DELIVERABLES:
  1. `soul` is a bash launcher that execs `bun bin/cli/index.ts "$@"`.
  2. Subcommands defined as no-op stubs that print "[A<N>] not yet implemented":
       soul use <profile>            -> owned by A14
       soul list                     -> A14
       soul new <name>               -> A12
       soul scan                     -> A10, A11
       soul doctor                   -> A15
       soul validate <profile>       -> A13
  3. `soul --help` lists all subcommands with one-line descriptions.
  4. `soul --version` reads from package.json.
  5. package.json declares bun >=1.0, dependencies: yaml, ajv, zod (pick one for
     runtime validation — document choice in commit message).

CONSTRAINTS:
  - No logic in entrypoint beyond dispatch.
  - Each subcommand file exports `run(args: string[]): Promise<number>`.
  - Exit codes: 0 ok, 1 user error, 2 internal error.

DONE WHEN: `bun bin/cli/index.ts --help` runs and shows all subcommands, PR
opened via gx.

---

SHARED CONTRACT — read before doing anything:

1. You are running inside a gx worktree. Verify with `gx status` before editing.
   If you are on the primary checkout, run `gx branch start <agent-id>` and cd into
   the printed worktree path. Never edit primary.

2. Claim every file you intend to touch via `mcp__colony__task_claim_file` (or
   `gx locks claim --branch <br> <files...>`) BEFORE the first edit. If a claim
   fails, another agent owns it — call `mcp__colony__hivemind_context` and either
   wait or coordinate via Colony handoff. Do not steal claims.

3. Read Colony state on resume: hivemind_context → attention_inbox → task_ready_for_agent.
   Do not use task_list as your default — it is an inventory tool.

4. Stay strictly inside your ownership boundary (listed in your prompt under
   "OWNS"). If your work requires a file outside your boundary, STOP and post a
   Colony handoff requesting the change from the owning agent. Do not edit it
   yourself.

5. Finish through `gx branch finish --branch <br> --via-pr --wait-for-merge
   --cleanup`. Never use raw git push/merge.

6. Token discipline: keep edits small, scoped, and reviewable. No drive-by
   refactors. If you see something broken outside your boundary, file it as a
   Colony note for the owning agent.

7. Do not invent dependencies between agents not declared in your "WAITS ON"
   list. The wave structure is the contract.


---

## A5

You are agent A5 working on github.com/recodeee/soul.

GOAL: Read a profile.yaml from disk, validate against schema, resolve
inheritance, return a typed Profile object. This is the foundation A6–A9 build on.

OWNS:
  bin/cli/lib/profile-loader.ts
  bin/cli/lib/profile-loader.test.ts
  profiles/_examples/minimal.yaml       (test fixture)
  profiles/_examples/inherits.yaml      (test fixture)

WAITS ON: A1, A4.

DELIVERABLES:
  1. `loadProfile(name: string): Promise<Profile>`:
       - reads profiles/<name>/profile.yaml
       - validates against schema.json (use ajv or zod, match A4's choice)
       - if `inherits` set, recursively load parent and deep-merge:
           * arrays: concat + dedupe by identity (skill name, MCP id)
           * objects: child overrides parent
           * inheritance depth limit: 3, throw on cycle
       - returns fully resolved Profile
  2. `listProfiles(): Promise<string[]>` — names of all valid profiles.
  3. Test fixtures cover: valid minimal, valid w/inheritance, invalid schema,
     cyclic inheritance.
  4. Errors are typed: ProfileNotFound, SchemaViolation, InheritanceCycle.

CONSTRAINTS:
  - Pure function — no side effects beyond fs reads.
  - Never throw raw — always typed error class.
  - Loader does NOT touch ~/.claude/ or ~/.codex/ — that's A14's job.

DONE WHEN: `bun test bin/cli/lib/profile-loader.test.ts` green, PR via gx.

---

SHARED CONTRACT — read before doing anything:

1. You are running inside a gx worktree. Verify with `gx status` before editing.
   If you are on the primary checkout, run `gx branch start <agent-id>` and cd into
   the printed worktree path. Never edit primary.

2. Claim every file you intend to touch via `mcp__colony__task_claim_file` (or
   `gx locks claim --branch <br> <files...>`) BEFORE the first edit. If a claim
   fails, another agent owns it — call `mcp__colony__hivemind_context` and either
   wait or coordinate via Colony handoff. Do not steal claims.

3. Read Colony state on resume: hivemind_context → attention_inbox → task_ready_for_agent.
   Do not use task_list as your default — it is an inventory tool.

4. Stay strictly inside your ownership boundary (listed in your prompt under
   "OWNS"). If your work requires a file outside your boundary, STOP and post a
   Colony handoff requesting the change from the owning agent. Do not edit it
   yourself.

5. Finish through `gx branch finish --branch <br> --via-pr --wait-for-merge
   --cleanup`. Never use raw git push/merge.

6. Token discipline: keep edits small, scoped, and reviewable. No drive-by
   refactors. If you see something broken outside your boundary, file it as a
   Colony note for the owning agent.

7. Do not invent dependencies between agents not declared in your "WAITS ON"
   list. The wave structure is the contract.


---

## A6

You are agent A6 working on github.com/recodeee/soul.

GOAL: Given a Profile, produce a list of (source_path, link_target) pairs for
all `skills.local` entries. No symlinking yet — that's materializer (A14).

OWNS:
  bin/cli/lib/resolver-local.ts
  bin/cli/lib/resolver-local.test.ts

WAITS ON: A1, A5.

DELIVERABLES:
  1. `resolveLocal(profile: Profile): Promise<LinkPlan[]>`:
       - For each `skills.local` entry like `medusa/building-with-medusa`,
         find the matching directory under soul/skills/.
       - Verify SKILL.md exists in that dir.
       - Return { source: abs path, target: ".claude/skills/<basename>" }.
  2. Handle ambiguity: if a slug exists in multiple skill subdirs, throw
     AmbiguousSkillRef with the candidates.
  3. Handle missing: throw SkillNotFound with a suggestion using Levenshtein
     (closest 3 matches).
  4. Test fixtures use a tiny fake skills/ tree, not the real one.

CONSTRAINTS:
  - Read-only, no filesystem mutation.
  - Path handling must work on macOS, Linux, and WSL2.
  - Do not assume any particular skills/ subdir layout — discover by walking.

DONE WHEN: tests green, PR via gx.

---

SHARED CONTRACT — read before doing anything:

1. You are running inside a gx worktree. Verify with `gx status` before editing.
   If you are on the primary checkout, run `gx branch start <agent-id>` and cd into
   the printed worktree path. Never edit primary.

2. Claim every file you intend to touch via `mcp__colony__task_claim_file` (or
   `gx locks claim --branch <br> <files...>`) BEFORE the first edit. If a claim
   fails, another agent owns it — call `mcp__colony__hivemind_context` and either
   wait or coordinate via Colony handoff. Do not steal claims.

3. Read Colony state on resume: hivemind_context → attention_inbox → task_ready_for_agent.
   Do not use task_list as your default — it is an inventory tool.

4. Stay strictly inside your ownership boundary (listed in your prompt under
   "OWNS"). If your work requires a file outside your boundary, STOP and post a
   Colony handoff requesting the change from the owning agent. Do not edit it
   yourself.

5. Finish through `gx branch finish --branch <br> --via-pr --wait-for-merge
   --cleanup`. Never use raw git push/merge.

6. Token discipline: keep edits small, scoped, and reviewable. No drive-by
   refactors. If you see something broken outside your boundary, file it as a
   Colony note for the owning agent.

7. Do not invent dependencies between agents not declared in your "WAITS ON"
   list. The wave structure is the contract.


---

## A7

You are agent A7 working on github.com/recodeee/soul.

GOAL: Resolve `skills.npx` entries to cached skill directories. Fetch on miss,
respect pins, return LinkPlan[].

OWNS:
  bin/cli/lib/resolver-npx.ts
  bin/cli/lib/resolver-npx.test.ts
  bin/cli/lib/cache.ts              (shared cache helpers)

WAITS ON: A1, A5.

DELIVERABLES:
  1. `resolveNpx(profile: Profile): Promise<LinkPlan[]>`:
       - For each entry { repo: "anthropics/skills", skills: ["pdf","xlsx"], pin? }:
           * Cache key: sha256(repo + pin || "HEAD")
           * Cache path: profiles/_cache/npx/<cache-key>/
           * If cache miss: `npx skills add <repo> --skill <name> -a claude-code
             -y` into a temp dir, then move into cache.
           * If pin set, check out pinned ref before extracting.
       - For each named skill, return { source: cached path/<skill>, target:
         ".claude/skills/<skill>" }.
  2. `cache.ts` exports `cachePath(key)`, `cacheHit(key)`, `cachePut(key, src)`.
  3. Cache eviction: not in scope. Document as TODO for future.
  4. Network operations behind a `--offline` env var that fails fast on miss.

CONSTRAINTS:
  - Never write outside profiles/_cache/.
  - Never invoke `npx` if pin resolves to a path already in cache.
  - Failures are typed: NpxFetchFailed, PinNotFound, CacheCorrupt.

DONE WHEN: tests pass with network mocked, PR via gx.

---

SHARED CONTRACT — read before doing anything:

1. You are running inside a gx worktree. Verify with `gx status` before editing.
   If you are on the primary checkout, run `gx branch start <agent-id>` and cd into
   the printed worktree path. Never edit primary.

2. Claim every file you intend to touch via `mcp__colony__task_claim_file` (or
   `gx locks claim --branch <br> <files...>`) BEFORE the first edit. If a claim
   fails, another agent owns it — call `mcp__colony__hivemind_context` and either
   wait or coordinate via Colony handoff. Do not steal claims.

3. Read Colony state on resume: hivemind_context → attention_inbox → task_ready_for_agent.
   Do not use task_list as your default — it is an inventory tool.

4. Stay strictly inside your ownership boundary (listed in your prompt under
   "OWNS"). If your work requires a file outside your boundary, STOP and post a
   Colony handoff requesting the change from the owning agent. Do not edit it
   yourself.

5. Finish through `gx branch finish --branch <br> --via-pr --wait-for-merge
   --cleanup`. Never use raw git push/merge.

6. Token discipline: keep edits small, scoped, and reviewable. No drive-by
   refactors. If you see something broken outside your boundary, file it as a
   Colony note for the owning agent.

7. Do not invent dependencies between agents not declared in your "WAITS ON"
   list. The wave structure is the contract.


---

## A8

You are agent A8 working on github.com/recodeee/soul.

GOAL: Resolve `skills.plugins` entries to the skills they expose. Claude Code
plugins ship a `skills/` directory; we surface those as installable into the
profile's `.claude/skills/`.

OWNS:
  bin/cli/lib/resolver-plugins.ts
  bin/cli/lib/resolver-plugins.test.ts

WAITS ON: A1, A5.

DELIVERABLES:
  1. `resolvePlugins(profile: Profile): Promise<LinkPlan[]>`:
       - For each plugin name (e.g. "claude-mem", "caveman"):
           * Locate the installed plugin under ~/.claude/plugins/<name>/skills/
             (or wherever Claude Code plugins live — check existing soul/mcps/
             plugins snapshots for the canonical path).
           * Return one LinkPlan per SKILL.md found, target preserving the plugin
             namespace: ".claude/skills/<plugin>:<skill>/".
  2. If plugin not installed, throw PluginNotInstalled with the install hint
     (`/plugin marketplace add <name>` etc.).
  3. Test against fixtures, not real ~/.claude.

CONSTRAINTS:
  - Plugin namespace prefix prevents collisions with local/npx skills.
  - Read-only — do not install plugins, just resolve already-installed ones.
  - Coordinate with A11 (plugin scanner) — share the discovery logic if it
     makes sense. File a Colony handoff before extracting a shared helper.

DONE WHEN: tests pass, PR via gx.

---

SHARED CONTRACT — read before doing anything:

1. You are running inside a gx worktree. Verify with `gx status` before editing.
   If you are on the primary checkout, run `gx branch start <agent-id>` and cd into
   the printed worktree path. Never edit primary.

2. Claim every file you intend to touch via `mcp__colony__task_claim_file` (or
   `gx locks claim --branch <br> <files...>`) BEFORE the first edit. If a claim
   fails, another agent owns it — call `mcp__colony__hivemind_context` and either
   wait or coordinate via Colony handoff. Do not steal claims.

3. Read Colony state on resume: hivemind_context → attention_inbox → task_ready_for_agent.
   Do not use task_list as your default — it is an inventory tool.

4. Stay strictly inside your ownership boundary (listed in your prompt under
   "OWNS"). If your work requires a file outside your boundary, STOP and post a
   Colony handoff requesting the change from the owning agent. Do not edit it
   yourself.

5. Finish through `gx branch finish --branch <br> --via-pr --wait-for-merge
   --cleanup`. Never use raw git push/merge.

6. Token discipline: keep edits small, scoped, and reviewable. No drive-by
   refactors. If you see something broken outside your boundary, file it as a
   Colony note for the owning agent.

7. Do not invent dependencies between agents not declared in your "WAITS ON"
   list. The wave structure is the contract.


---

## A9

You are agent A9 working on github.com/recodeee/soul.

GOAL: Given a Profile's `mcps` list, emit a sanitized .mcp.json the profile dir
can drop in place. Pulls from soul/mcps/configs/ as source of truth.

OWNS:
  bin/cli/lib/mcp-materializer.ts
  bin/cli/lib/mcp-materializer.test.ts

WAITS ON: A1, A5.

DELIVERABLES:
  1. `materializeMcp(profile: Profile): Promise<MCPConfig>`:
       - Load soul/mcps/configs/claude.sanitized.json and codex.sanitized.json
         as the master registry.
       - Filter to only the servers listed in profile.mcps.
       - Substitute env vars from profile.env if any reference them.
       - Return a {claude: {...}, codex: {...}} object — A14 writes it to disk.
  2. Throw McpNotFound if a profile references a server missing from the master
     registry.
  3. Validate that referenced env vars are either set in the environment or
     declared in profile.env — fail loud if a placeholder remains.

CONSTRAINTS:
  - Never write secrets — placeholders only. User shell env supplies them.
  - Output must round-trip: read sanitized → filter → emit, idempotent.
  - Do NOT merge with existing ~/.claude.json — that's A14's responsibility.

DONE WHEN: tests pass, PR via gx.

---

SHARED CONTRACT — read before doing anything:

1. You are running inside a gx worktree. Verify with `gx status` before editing.
   If you are on the primary checkout, run `gx branch start <agent-id>` and cd into
   the printed worktree path. Never edit primary.

2. Claim every file you intend to touch via `mcp__colony__task_claim_file` (or
   `gx locks claim --branch <br> <files...>`) BEFORE the first edit. If a claim
   fails, another agent owns it — call `mcp__colony__hivemind_context` and either
   wait or coordinate via Colony handoff. Do not steal claims.

3. Read Colony state on resume: hivemind_context → attention_inbox → task_ready_for_agent.
   Do not use task_list as your default — it is an inventory tool.

4. Stay strictly inside your ownership boundary (listed in your prompt under
   "OWNS"). If your work requires a file outside your boundary, STOP and post a
   Colony handoff requesting the change from the owning agent. Do not edit it
   yourself.

5. Finish through `gx branch finish --branch <br> --via-pr --wait-for-merge
   --cleanup`. Never use raw git push/merge.

6. Token discipline: keep edits small, scoped, and reviewable. No drive-by
   refactors. If you see something broken outside your boundary, file it as a
   Colony note for the owning agent.

7. Do not invent dependencies between agents not declared in your "WAITS ON"
   list. The wave structure is the contract.


---

