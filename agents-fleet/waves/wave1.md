# Wave 1 — paste each prompt into its own pane

## A1

You are agent A1 working on github.com/recodeee/soul.

GOAL: Define the canonical profile schema. This is the source of truth that every
other agent depends on.

OWNS:
  profiles/SCHEMA.md
  profiles/schema.json     (JSON Schema draft-07 for tooling)
  profiles/_types.ts       (TypeScript types, used by CLI in bun)

WAITS ON: nothing. Start immediately.

DELIVERABLES:
  1. Define a profile.yaml schema with these top-level keys:
       name              (string, required, kebab-case, matches dirname)
       description       (string, one-line)
       agents            (array: claude-code | codex)
       skills:
         local           (array of paths relative to soul/skills/)
         npx             (array of {repo, skills[], pin?})
         plugins         (array of plugin marketplace names)
       mcps              (array of MCP server IDs from soul/mcps/configs/)
       env               (map, optional — env vars to set when profile is active)
       inherits          (string, optional — name of base profile to extend)
  2. SCHEMA.md explains every field with an example, the inheritance rule, and
     name uniqueness rule (profile name == directory name).
  3. schema.json validates real YAML when piped through `ajv-cli`.
  4. _types.ts exports `Profile`, `SkillRef`, `NpxSkillRef`, `MCPRef` interfaces.

CONSTRAINTS:
  - inheritance is a single string, not a list. Deep chains discouraged.
  - npx pin is "git@sha" or "tag@v1.2.3" — document both forms.
  - No optional fields without a sensible default documented in SCHEMA.md.

DONE WHEN: schema.json validates the example profile in SCHEMA.md, types compile
under `tsc --noEmit`, PR opened via gx.

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

## A2

You are agent A2 working on github.com/recodeee/soul.

GOAL: Lay down the directory structure the other 17 agents will write into.
Empty stub files with READMEs explaining intent — no logic yet.

OWNS:
  profiles/                          (new top-level dir)
  profiles/README.md
  profiles/_cache/.gitkeep           (npx skill cache, gitignored content)
  profiles/_cache/README.md
  profiles/_active/.gitkeep          (current active profile symlink target)
  bin/                               (new top-level dir)
  bin/README.md
  .gitignore                         (append, don't replace)

WAITS ON: nothing. Start in parallel with A1, A3.

DELIVERABLES:
  1. Create the directories above with .gitkeep where empty.
  2. profiles/README.md: 200-word explainer of what lives where. Reference
     SCHEMA.md (A1 will write it — link is fine even if file doesn't exist yet).
  3. profiles/_cache/README.md: explains it's the canonical npx skill cache,
     never edit by hand, populated by `soul use`.
  4. bin/README.md: notes that the `soul` CLI lives here (A4 will write it).
  5. Append to .gitignore:
       profiles/_cache/*
       !profiles/_cache/.gitkeep
       !profiles/_cache/README.md
       profiles/_active/current
  6. Do NOT touch existing skills/, mcps/, setup/, AGENTS.md, README.md, CLAUDE.md.

CONSTRAINTS: zero logic, zero opinions in stub files. Just structure.

DONE WHEN: tree -L 2 profiles/ bin/ shows the layout, PR opened via gx.

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

## A3

You are agent A3 working on github.com/recodeee/soul.

GOAL: Write the docs hub for the profile system. Stub pages other agents fill in.

OWNS:
  docs/profiles/
  docs/profiles/README.md           (entry point, links to all subpages)
  docs/profiles/quickstart.md       (3-command happy path, stub for A14)
  docs/profiles/auto-generation.md  (stub for A12)
  docs/profiles/anatomy.md          (deep dive, stub — links to SCHEMA.md from A1)
  docs/profiles/troubleshooting.md  (stub for A15)
  CONTRIBUTING.md                   (NEW — does not exist yet in repo)

WAITS ON: nothing. Parallel with A1, A2.

DELIVERABLES:
  1. CONTRIBUTING.md covering:
       - how to add a profile (the .yaml goes in profiles/<name>/profile.yaml)
       - how to add a local skill (existing pattern, link to README § Contributing)
       - how to add an MCP entry
       - the PR-only-via-gx rule for anyone running soul in dev mode
  2. docs/profiles/README.md links each subpage with a one-line description.
  3. Each subpage is a stub with a single H1, a one-paragraph intro, and a
     `<!-- TODO: A<N> fills this in -->` comment.

CONSTRAINTS: don't speculate on implementation details — leave that to the
owning agents.

DONE WHEN: all 6 files exist with frontmatter and TOC link, PR opened via gx.

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
