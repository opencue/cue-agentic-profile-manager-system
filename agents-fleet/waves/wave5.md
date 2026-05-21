# Wave 5 — paste each prompt into its own pane (gate: Wave 4 PRs merged)

## A17

You are agent A17 working on github.com/recodeee/soul.

GOAL: Ship 10 hand-tuned profiles that cover the main use cases visible in the
existing skills/ tree. These are the profiles users see on first install.

OWNS:
  profiles/core/profile.yaml              (base — inherited by most)
  profiles/medusa-dev/profile.yaml
  profiles/fleet-control/profile.yaml
  profiles/creative-media/profile.yaml
  profiles/caveman-quick/profile.yaml
  profiles/docs-writer/profile.yaml
  profiles/research/profile.yaml
  profiles/frontend/profile.yaml
  profiles/backend/profile.yaml
  profiles/full/profile.yaml              (escape hatch — loads everything)
  profiles/<each>/README.md               (one per profile)

WAITS ON: A1, A13, A14.

DELIVERABLES:
  1. `core` profile: 3–5 skills every other profile inherits (file-reading,
     caveman-commit, house style). MCPs: claude-mem only.
  2. Each non-core profile: inherits core, adds 5–12 domain-specific skills,
     0–2 extra MCPs. Use the npx and plugin scanners' output to validate the
     skill names exist or can be fetched.
  3. `full` profile: inherits core, declares all skills/* via local glob and
     all MCPs. Documented as "diagnostic / fallback only — uses ~20k extra
     context tokens per session".
  4. Each profile's README.md: 1 paragraph on intent, list of skills, list of
     MCPs, sample tasks it's tuned for.
  5. Every profile must pass `soul validate` with zero warnings (token bloat
     budget < 25 skills, < 5 MCPs — except `full`).

CONSTRAINTS:
  - Token discipline > completeness. Cut hard.
  - Do not invent skills that don't exist in skills/ or aren't fetchable via
     a known npx repo.
  - If a skill is "almost right but bloated," prefer the leaner option.

DONE WHEN: `soul validate --all` passes, `soul use <each>` materializes
without error, PR via gx.

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

## A18

You are agent A18 working on github.com/recodeee/soul.

GOAL: Wire it all up. README updates, smoke tests, CI.

OWNS:
  test/e2e/                              (NEW directory)
  test/e2e/scenarios/*.sh                (one shell script per scenario)
  test/e2e/run.sh                        (orchestrator)
  .github/workflows/profiles-ci.yml      (NEW)
  README.md                              (append "Profiles" section, link to docs)
  docs/profiles/anatomy.md               (fill in A3's stub — uses real profiles)

WAITS ON: A14, A15, A17 (needs real profiles to test against).

DELIVERABLES:
  1. E2E scenarios (each a bash script that exits 0 on success):
       - 01-fresh-install: clean repo, run `bun install`, `soul list` shows
         all 10 profiles
       - 02-use-per-dir: `soul use medusa-dev`, cd in, verify symlinks
       - 03-scan-and-new: `soul scan` succeeds; `soul new test-gen --from-scan
         --auto` produces a valid profile
       - 04-doctor-detects-drift: break a symlink, `soul doctor` exits non-zero;
         `--fix` repairs it
       - 05-validate-all: `soul validate --all` exits 0
       - 06-inheritance: a child profile resolves its parent's skills correctly
       - 07-npx-cache-hit: second `soul use` of an npx-using profile makes no
         network calls (mock npx, assert no call)
  2. .github/workflows/profiles-ci.yml runs test/e2e/run.sh on
     ubuntu-latest + macos-latest. Skip Windows for v1.
  3. README.md gets a new "## Profiles" section after "Optional — Parallel
     agents tier", with a 3-line example and link to docs/profiles/.
  4. anatomy.md: walks through the medusa-dev profile field-by-field, then
     shows the inheritance chain to `core`.

CONSTRAINTS:
  - E2E scenarios run in a temp HOME so they don't touch the real ~/.claude.
  - No network in CI except the first npx fetch — that one cached in CI artifact
     between runs.
  - README addition < 30 lines — link to docs for depth.

DONE WHEN: CI green on a PR that touches nothing but adds a no-op skill, PR
via gx.

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

