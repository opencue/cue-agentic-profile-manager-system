# soul/profiles — 18-agent parallel fleet

This directory stages the prompts for the 18-agent build-out of the auto-profile system on top of `recodeee/soul`. Each prompt is self-contained and includes the SHARED CONTRACT block; paste verbatim into the agent.

## Wave gates — non-negotiable

```
Wave 1 (foundation)   : A1, A2, A3                            ← parallel, all start at t=0
Wave 2 (CLI core)     : A4, A5, A6, A7, A8, A9                ← starts after Wave 1 PRs merged
Wave 3 (auto-gen)     : A10, A11, A12, A13                    ← starts after Wave 2 PRs merged
Wave 4 (UX)           : A14, A15, A16                         ← starts after Wave 3 PRs merged
Wave 5 (polish)       : A17, A18                              ← starts after Wave 4 PRs merged
```

**Do not paste Wave N until Wave N-1 PRs have all merged.** Downstream waves depend on stabilized contracts from upstream waves — especially the schema in A1.

## Files

- `SHARED_CONTRACT.md` — the contract block embedded into every prompt
- `prompts/A01.md … A18.md` — individual agent prompts
- `waves/wave1.md … wave5.md` — concatenated wave-grouped pastes for batch dispatch
- `UI_IMPROVEMENTS.md` — side notes on codex-fleet UI changes that would help wave-based runs

## Local prereqs (run on host before fleet bringup)

- `gx --version` — must be ≥ 7.x (confirmed: 7.0.43 on this host)
- `CODEX_FLEET_REPO_ROOT` — must be exported; bringup script lives at `$CODEX_FLEET_REPO_ROOT/scripts/codex-fleet/full-bringup.sh`
- Colony MCP — agents will call `mcp__colony__*`; ensure each codex window has Colony in its allowed MCP list
- Soul repo remote — `git remote -v` should show the `recodeee/soul` origin (or wherever the agents will open PRs)
- Capacity budget — Wave 2 is widest (6 agents). If running ≤3 in parallel, split it into two batches; the wave gate still holds.

## Dispatch flow

1. Bring fleet up: `bash $CODEX_FLEET_REPO_ROOT/scripts/codex-fleet/full-bringup.sh <opts>`
2. Open 8 tmux panes (per user request — 8 codex agents, spawn new ones as waves progress)
3. Paste `waves/wave1.md` into 3 of them (one prompt per pane)
4. Wait for all three PRs to merge (use `gh pr list` or codex-fleet UI)
5. Paste `waves/wave2.md` across 6 panes
6. Continue per the wave gate table
7. Side-task: keep `UI_IMPROVEMENTS.md` open as you go — note friction points as they happen
