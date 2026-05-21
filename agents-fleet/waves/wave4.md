# Wave 4 — paste each prompt into its own pane (gate: Wave 3 PRs merged)

## A14

You are agent A14 working on github.com/recodeee/soul.

GOAL: The actual "switch profile" command. Takes a profile name, materializes
its skills + MCPs into a working directory the user can launch claude/codex
from.

OWNS:
  bin/cli/commands/use.ts           (replaces A4 stub)
  bin/cli/commands/list.ts          (replaces A4 stub)
  bin/cli/lib/materializer.ts
  bin/cli/lib/materializer.test.ts
  docs/profiles/quickstart.md       (fill in A3's stub)

WAITS ON: ALL of A5–A9, A13.

DELIVERABLES:
  1. `soul use <profile>` with two modes (flag-selectable, default = per-dir):
       MODE A (per-dir, default):
         - Materializes into profiles/<name>/workspace/
         - Writes .claude/skills/* symlinks (per A6/A7/A8 LinkPlans)
         - Writes .mcp.json (per A9 output)
         - Writes .envrc if profile.env set
         - Writes CLAUDE.md and AGENTS.md scoped to this profile (template +
           profile.description)
         - Prints: `cd profiles/<name>/workspace && claude`
       MODE B (global-swap, --global):
         - Backs up ~/.claude/skills/ to ~/.claude/skills.bak.<ts>/
         - Clears it, then writes symlinks per LinkPlans
         - Merges MCP config into ~/.claude.json (preserving non-soul entries)
         - Writes profiles/_active/current → <name>
         - Refuses if another `soul use --global` is in progress (file lock)
  2. `soul list` shows all profiles with their skill/MCP counts and which one
     is active (from _active/current).
  3. Validates profile via A13 BEFORE materializing — refuse on errors.
  4. Always idempotent — re-running yields the same workspace state.

CONSTRAINTS:
  - Symlinks always relative when possible (portability).
  - Never delete user's data — only soul-managed paths.
  - Mode B file lock at profiles/_active/.lock with PID + timestamp.
  - Quickstart doc shows mode A as primary, mode B as advanced.

DONE WHEN: `soul use medusa-dev` then `claude` from the workspace shows only
medusa-bundle skills, PR via gx.

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

## A15

You are agent A15 working on github.com/recodeee/soul.

GOAL: Diff what the active profile says should be installed vs what's actually
on disk. Surface drift.

OWNS:
  bin/cli/commands/doctor.ts        (replaces A4 stub)
  bin/cli/lib/doctor.ts
  bin/cli/lib/doctor.test.ts
  docs/profiles/troubleshooting.md  (fill in A3's stub)

WAITS ON: A14, A10, A11.

DELIVERABLES:
  1. `soul doctor` checks:
       - Active profile resolves (profiles/_active/current → exists?)
       - Each declared skill has a working symlink at the expected target
       - Each MCP server in declared config is reachable (smoke test: spawn,
         exit cleanly on stdin close)
       - No stale symlinks pointing to deleted cache entries
       - No skills present on disk but not in any profile (orphans)
  2. `soul doctor --fix` (opt-in):
       - Re-runs materialization (A14) to repair missing symlinks
       - Re-fetches missing npx cache entries
       - Prunes orphans (with confirmation)
  3. Troubleshooting doc maps doctor errors → resolution steps.

CONSTRAINTS:
  - --fix never crosses boundaries (won't install plugins for you, just
     prints the install command).
  - Read-only by default — mutation only behind --fix.

DONE WHEN: doctor detects a deliberately-broken symlink and --fix repairs it,
PR via gx.

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

## A16

You are agent A16 working on github.com/recodeee/soul.

GOAL: Make `soul use` ergonomic. Per-directory profiles via direnv, global
aliases for one-shot launches.

OWNS:
  bin/cli/commands/init-shell.ts    (NEW subcommand — register in A4's index)
  bin/cli/lib/shell-init.ts
  templates/envrc.template
  templates/zsh-aliases.template
  templates/bash-aliases.template
  templates/powershell-profile.template

WAITS ON: A14.

DELIVERABLES:
  1. `soul init-shell` (interactive):
       - Detects shell (zsh/bash/pwsh)
       - Offers to append `source <(soul shell-completions)` and alias block
       - For each profile, generates `alias claude-<name>='cd
         <repo>/profiles/<name>/workspace && claude'`
       - Same for codex
       - Backs up existing rc file before append.
  2. `soul use --direnv <profile>` writes a `.envrc` in the current dir that:
       - Adds the profile workspace's `.claude/` to CLAUDE_CONFIG_PATH (or
         equivalent — verify the right env var per Claude Code docs)
       - Sources profile.env entries
  3. PowerShell template uses profile functions, not aliases (PS aliases can't
     chain `cd && ...`).

CONSTRAINTS:
  - Never edit shell rc files without explicit confirmation.
  - Always print the diff and ask before writing.
  - Templates are plain files with {{PLACEHOLDER}} tokens — readable.

DONE WHEN: init-shell on a clean zsh produces working `claude-<name>` aliases
for every profile, PR via gx.

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

