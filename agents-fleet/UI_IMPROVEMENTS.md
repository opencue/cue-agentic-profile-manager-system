# codex-fleet UI — improvement notes

Living doc — append observations as the 18-agent run progresses. Reorganize after.

## Goal of the UI

Coordinate N parallel codex panes against a wave-structured plan, where:
- Each wave has a "gate" (all prior PRs merged)
- Each agent owns a file ownership boundary (Colony claims)
- Each agent finishes via `gx branch finish --via-pr --wait-for-merge`
- The human is a supervisor, not a babysitter — UI should escalate exceptions, not status

## Friction points the current 18-agent plan exposes

### 1. Wave-gate visibility

**Problem:** A human paste-and-go workflow ("paste Wave 2 when Wave 1 merges") is fragile. The user has to manually `gh pr list --state merged --label wave-1` and decide.

**Fix:** A "Waves" panel that shows, per wave:
- Which agents are running / done / failed
- Which PRs are open / merged / failed CI
- A single status pill: `WAVE 1 — 2/3 merged, blocker: A3 CI failing`
- A "Paste Wave 2" button greyed out until the gate clears

### 2. Ownership boundary collisions

**Problem:** Two agents touching the same file is the entire failure mode the parallel-agents tier exists to prevent. Right now the only signal is Colony's claim-failure error inside the agent's own pane — invisible to the supervisor unless they read each pane.

**Fix:** A "Claims" panel showing the live Colony file-claim graph. Conflicts surface red. Hovering a file shows the chain of claim/release events.

### 3. Prompt provenance

**Problem:** Pasting 3KB prompts manually into 6+ panes is mechanical work that begs for typos and missed-paste errors.

**Fix:** Each pane has a "Prompt source" dropdown — picks `agents-fleet/prompts/AXX.md`, reads it from the worktree, pastes verbatim. The pane logs which prompt-file-and-sha was loaded so the audit trail is clean.

### 4. gx + Colony state on resume

**Problem:** Per the SHARED CONTRACT, agents must read `hivemind_context` → `attention_inbox` → `task_ready_for_agent` on every resume. They forget. Most failures cascade from this.

**Fix:** A pane-level "Resume hook" the UI injects on reactivate: prepends `mcp__colony__hivemind_context && mcp__colony__attention_inbox && mcp__colony__task_ready_for_agent` to the next user message. Agents stop drifting.

### 5. PR-merge wait-time

**Problem:** `gx branch finish --wait-for-merge` blocks the pane until CI passes and merge completes. With 6 panes in Wave 2, that's six panes idle-waiting for CI for 5–15 min each.

**Fix:** Move the wait off-pane. Pane reports "PR opened, waiting for merge" and detaches; a background worker watches the PR; the UI re-attaches the pane when merged so the agent can do post-merge cleanup. Capacity recovered instantly.

### 6. Budget headroom

**Problem:** No visibility into spend. 18 agents at full reasoning can burn $100+ before anyone notices.

**Fix:** A spend-meter per pane and per wave, sourced from the Anthropic / OpenAI billing APIs (or local token-count proxy). Soft ceiling that pauses new panes when crossed, hard ceiling that halts in-flight.

### 7. Agent-spawn ergonomics

**Problem:** User asked for "8 codex agents working on it that spawn new ones." The current UI doesn't model agent-spawns-agent — every pane is human-launched.

**Fix:** A `soul agent spawn <prompt-file>` command an agent can call from inside its pane. Spawns a new tmux pane in the codex-fleet session, attaches a fresh codex process, pastes the prompt file. Lets a "coordinator" agent run on pane 1 and dispatch the 18 worker agents itself.

### 8. Wave promotion is manual

**Problem:** Today, the human pastes Wave 2 manually after seeing Wave 1 merge. Even with great UI, this is 30 seconds of mechanical work per wave.

**Fix:** Auto-promote. When a wave's gate clears, the UI dispatches Wave N+1 prompts to N idle panes automatically (gated by a "auto-advance" toggle the human can flip off mid-run).

## Implementation priority

If only one ships first: **#1 Wave-gate visibility.** It unlocks confidence in the whole flow. Everything else is optimization on top.

Second: **#4 Resume hook.** Cheap to implement, single biggest failure-rate reducer.

Third: **#5 Off-pane merge wait.** Frees real capacity instead of just showing better dashboards.

## Things I noticed building this plan

- The SHARED CONTRACT block being 7 numbered paragraphs glued to the bottom of every prompt is fine for now, but at 18 prompts it's 600+ duplicated lines. A v2 UI could inject the contract automatically and prompts could just declare the variant they need.
- Several prompts reference each other ("share with A11 via Colony handoff", "after A4 lands"). The UI could surface those edges as a real dependency graph — right now they're only in prose inside `WAITS ON:` lines.
- `recodeee/soul` vs `/home/deadpool/Documents/soul` — the prompts hardcode the GitHub remote. A v2 UI could template the remote per fleet-run so the same prompts work against forks.
