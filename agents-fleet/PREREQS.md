# Fleet bringup prereqs — current status on this host

Snapshot taken 2026-05-20.

## What's already here

- `gx --version` → **7.0.43** ✅ (at `/home/deadpool/.nvm/versions/node/v22.22.0/bin/gx`)
- soul repo at `/home/deadpool/Documents/soul`, branch `HEAD` (likely detached or fresh)

## What's missing — blockers for the fleet run

| Blocker | How to clear |
|---|---|
| `CODEX_FLEET_REPO_ROOT` is unset | `export CODEX_FLEET_REPO_ROOT=/path/to/codex-fleetui` in the launching shell, then re-run bringup |
| No `/tmp/codex-fleet` (no fleet workspace) | Bringup creates it: `bash $CODEX_FLEET_REPO_ROOT/scripts/codex-fleet/full-bringup.sh <args>` |
| No `tmux -L codex-fleet` session | Bringup launches the tmux server |
| soul repo's git origin not confirmed for PRs to `recodeee/soul` | `git remote -v` from soul root; agent prompts assume `recodeee/soul` is the upstream — confirm or rewrite the prompts to match the actual remote |
| Colony MCP availability in each codex pane | Verify `mcp__colony__*` is registered in `~/.codex/config.toml` for the account each pane uses |
| Plugin marketplace state for A8/A11 | Both agents assume Claude Code plugins live under `~/.claude/plugins/<name>/skills/`. Verify path with `ls ~/.claude/plugins/` before Wave 2 starts; if the path differs, A8 will mis-resolve and A11 will return empty |
| `bun` installed | Wave 2 uses bun for the CLI — `bun --version` should print ≥1.0 on each pane |

## Things to confirm with the user before paid launch

1. **Repo target.** The prompts say `github.com/recodeee/soul`. The local clone is at `/home/deadpool/Documents/soul`. Is the remote the same? If `git remote -v` shows e.g. `recodeeee/soul` or a different fork, every PR opens against the wrong base.

2. **Budget ceiling.** 18 agents at full reasoning capacity, ~3–5 turns each before PR-open, plus review rounds. Rough order: $40–$120 in API spend. Set the ceiling before paste-and-go.

3. **8-pane capacity.** User asked for "8 codex agents working on it that spawn new ones." With wave gates respected, that means:
   - Wave 1: 3 panes used, 5 idle
   - Wave 2: 6 panes used, 2 idle  ← widest wave fits
   - Wave 3: 4 panes used, 4 idle
   - Wave 4: 3 panes used, 5 idle
   - Wave 5: 2 panes used, 6 idle
   
   Wave 2 fits in 8 with room to spare. No spawning past 8 is needed unless we run multiple waves concurrently — but the gates forbid that.

4. **Colony task-graph init.** Agents call `mcp__colony__task_claim_file` etc. Someone has to seed the Colony with the task list before the first agent starts, or every claim call will create implicit tasks (Colony may or may not handle this gracefully — depends on the install).

5. **gx PR auto-merge.** The contract says `gx branch finish --branch <br> --via-pr --wait-for-merge --cleanup`. This auto-merges PRs when CI is green. Decide: human review gate per PR, or trust the contract and auto-merge?

## Suggested first step (no API spend)

Before paying for 18 agents, run **Wave 1 manually in this Claude session** to validate the contract:

- Have *me* (this session) execute A1, A2, A3 sequentially as a single-operator dry-run
- Open three PRs against the soul repo
- Verify gx + Colony + the PR-merge loop actually work end-to-end
- *Then* paste Wave 2 into 6 paid panes — by that point the path is proven

This costs ~5 minutes of conversation and zero codex-fleet spend. If it works, the 18-agent path is much less risky.

## Suggested side-task (cheap, useful)

While the fleet runs, keep `UI_IMPROVEMENTS.md` open and note every friction point as it happens. After the fleet completes, those notes become the spec for v2 of codex-fleetui.
