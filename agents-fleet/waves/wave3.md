# Wave 3 — paste each prompt into its own pane (gate: Wave 2 PRs merged)

## A10

You are agent A10 working on github.com/recodeee/soul.

GOAL: Discover what npx-installed skills currently exist on the machine, so
A12 can auto-generate a profile that includes them.

OWNS:
  bin/cli/lib/scan-npx.ts
  bin/cli/lib/scan-npx.test.ts

WAITS ON: A4, A7 (uses cache.ts).

DELIVERABLES:
  1. `scanNpxSkills(): Promise<DiscoveredNpxSkill[]>`:
       - Walk ~/.claude/skills/ AND ~/.agents/skills/ (the two known locations
         per the AGENTS.md "skills not found after npx install" failure mode).
       - For each SKILL.md found, parse frontmatter (name, description, source
         repo if recorded in a `_source` field per `npx skills` convention).
       - Group by source repo so the generated profile can use the {repo, skills}
         form instead of one-off entries.
       - Return { repo, skills: [{name, description, path}] }[].
  2. Distinguish "definitely from npx" (has _source) from "unknown origin"
     (manually placed). Both reported, flagged differently.
  3. No network calls.

CONSTRAINTS:
  - Pure scan, never mutate.
  - Gracefully handle missing dirs (return empty array).
  - Symlinks resolved — follow to real location.

DONE WHEN: tests pass against fixture dirs, PR via gx.

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

## A11

You are agent A11 working on github.com/recodeee/soul.

GOAL: Discover what Claude Code plugins are currently installed and which
skills each exposes. Feeds A12.

OWNS:
  bin/cli/lib/scan-plugins.ts
  bin/cli/lib/scan-plugins.test.ts

WAITS ON: A4, A8 (shared plugin path logic).

DELIVERABLES:
  1. `scanPlugins(): Promise<DiscoveredPlugin[]>`:
       - Read ~/.claude.json's `enabledPlugins` array.
       - For each enabled plugin, locate its install dir under
         ~/.claude/plugins/ (or the path A8 settled on).
       - Enumerate plugins/<name>/skills/*/SKILL.md.
       - Return { name, version?, skills: [{name, description}] }[].
  2. Cross-check: if ~/.claude.json lists a plugin but the dir is missing, flag
     as Broken. If a dir exists but isn't enabled, flag as Disabled.
  3. Reuse the path-resolution helper A8 wrote (or extract jointly via Colony
     handoff).

CONSTRAINTS:
  - Read-only.
  - Don't crash if ~/.claude.json malformed — return diagnostic instead.

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

## A12

You are agent A12 working on github.com/recodeee/soul.

GOAL: This is the headline feature. Given scanner output (A10+A11), produce
sensible auto-generated profile.yaml files grouped by domain.

OWNS:
  bin/cli/commands/scan.ts          (replaces A4 stub)
  bin/cli/commands/new.ts           (replaces A4 stub)
  bin/cli/lib/profile-generator.ts
  bin/cli/lib/profile-generator.test.ts
  docs/profiles/auto-generation.md  (fill in A3's stub)

WAITS ON: A5, A6, A7, A8, A10, A11.

DELIVERABLES:
  1. `soul scan` command:
       - Runs A10 + A11.
       - Prints a tree of discovered skills/plugins grouped by inferred domain
         (frontend, backend, docs, devops, media, etc.) using a keyword-match
         heuristic on the SKILL.md description fields.
       - Exits 0.
  2. `soul new <name> [--from-scan] [--seed <profile>]`:
       - With --from-scan: interactively (or with --auto) bucket discovered
         skills into a draft profile. User confirms domain assignments,
         generator writes profiles/<name>/profile.yaml.
       - With --seed: copy an existing profile and prompt for modifications.
       - Without flags: create empty profile from a template.
  3. Heuristic logic in profile-generator.ts:
       - Tokenize description, score against domain keyword sets.
       - Single skill in one domain → include in that domain's profile.
       - Cross-cutting (commit, lint, file-reading) → mark as "core" and
         suggest as a base profile via inheritance.
  4. Document the heuristic in auto-generation.md so users can override it.

CONSTRAINTS:
  - The auto-generator NEVER overwrites an existing profile without --force.
  - Output must pass A13's validator on first try.
  - Interactive mode behind a TTY check; pipe-friendly mode for CI.

DONE WHEN: `soul scan` + `soul new test --from-scan --auto` produce a valid
profile on a real machine, PR via gx.

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

## A13

You are agent A13 working on github.com/recodeee/soul.

GOAL: `soul validate <profile>` — static + dynamic checks beyond schema validity.

OWNS:
  bin/cli/commands/validate.ts      (replaces A4 stub)
  bin/cli/lib/profile-linter.ts
  bin/cli/lib/profile-linter.test.ts

WAITS ON: A5, A6, A7, A8, A9.

DELIVERABLES:
  1. `soul validate <profile>` runs:
       - schema check (A5 already does this on load — re-run with verbose output)
       - resolver dry-runs (A6, A7, A8) — every referenced skill exists or is
         fetchable
       - MCP resolver dry-run (A9) — every MCP id is in the registry
       - lint rules:
           W1: profile has >25 skills (token bloat warning)
           W2: profile has >5 MCPs (token bloat warning)
           W3: inheritance chain depth > 2
           W4: skill appears in both `local` and `npx` (ambiguous source)
           E1: name collision with another profile
           E2: cyclic inheritance
           E3: missing skill, missing MCP, missing plugin
  2. Output: green checks for pass, yellow for W, red for E. Non-zero exit on E.
  3. `soul validate --all` validates every profile in profiles/.

CONSTRAINTS:
  - Pure validation — never mutate.
  - Rules numbered and documented so suppression (`# lint: ignore W1`) can be
     added later.

DONE WHEN: validator catches all E rules in test fixtures, PR via gx.

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

