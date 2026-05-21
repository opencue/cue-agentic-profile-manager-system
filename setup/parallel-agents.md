# soul — Parallel Agents Tier (Colony + gitguardex)

> Optional tier *on top of* the lean stack from `setup/macos.md` / `setup/linux.md` / `setup/windows.md`. Pick this if you want to run **multiple Codex/Claude agents in parallel** on the same repo without them stomping on each other's edits.

If you're a solo dev with one Claude Code window at a time, **skip this file** — it adds RAM and surface area you won't use.

Self-contained prompt — paste into Claude Code after the lean install is verified.

---

## Why these two together

| | gitguardex (`gx`) | Colony (MCP) |
|---|---|---|
| **What it owns** | Branch + worktree isolation, file locks, PR-only merges | Live task graph, file claims, durable handoffs, cross-session memory |
| **Scope** | One git repo at a time | Cross-repo coordination via SQLite at `~/.colony` |
| **When agents see it** | Every `gx branch start` / `gx finish` call | Every Colony MCP tool call (`task_post`, `task_claim_file`, `hivemind_context`, …) |
| **Cost** | ~5 MB on disk, no daemon | ~50 MB SQLite + ~100 MB Bun MCP process |
| **Repo** | [recodeee/gitguardex](https://github.com/recodeee/gitguardex) (public) | [recodeee/colony](https://github.com/recodeee/colony) (public) |

Together they make the answer to "what if I ran 4 codex windows at once" go from chaos to deterministic. gitguardex isolates the filesystem; Colony coordinates the work.

---

## Prereqs

- Lean stack from `setup/<your-os>.md` is installed and verified (Phase 1–8 completed).
- Linux or macOS. Windows users: run this inside WSL2 — `gx` is bash and assumes POSIX worktrees.
- Disk: ~200 MB extra for Colony's SQLite + Bun runtime cache, plus N×(your-repo-size) for parallel worktrees.

---

## Phase A — install gitguardex

```bash
# Clone + install the gx CLI (puts gx on $PATH)
git clone https://github.com/recodeee/gitguardex.git ~/Documents/gitguardex
cd ~/Documents/gitguardex
bash install.sh        # writes ~/.local/bin/gx + completions

# verify:
gx --version
gx doctor              # diagnoses local git state, hook readiness
```

**What `gx doctor` checks:** repo is clean, post-checkout guard is wired, `agent/*` branches don't collide, dirty primary-tree rule, stale lock files. Run it any time the fleet feels off.

The big surface:

| Command | What it does |
|---|---|
| `gx branch start "<task>" "<agent>"` | Creates `agent/<agent>/<task>-<ts>` branch + worktree, prints the path. cd there to work. |
| `gx locks claim --branch <br> <files...>` | File-level locks so two agents can't edit the same path. |
| `gx branch finish --branch <br> --via-pr --wait-for-merge --cleanup` | Commit + push + open PR + wait for merge + prune worktree. The canonical exit. |
| `gx finish --all` | Same, for every active agent branch. |

Read the full SKILL: `~/.claude/skills/gitguardex/SKILL.md` after the next Claude Code restart, or [recodeee/gitguardex on GitHub](https://github.com/recodeee/gitguardex).

---

## Phase B — install Colony

```bash
# Clone + install
git clone https://github.com/recodeee/colony.git ~/Documents/colony
cd ~/Documents/colony

# Pick your runtime: bun is faster + lower RAM
bun install
bun run build

# CLI wrapper on PATH
ln -sfn ~/Documents/colony/apps/cli/dist/index.js ~/.local/bin/colony
chmod +x ~/.local/bin/colony

# verify:
colony --version
colony doctor          # checks ~/.colony SQLite, MCP entry, agent profile
```

If `bun run build` fails on Linux because of an old node version, `nvm install 22 && nvm use 22` then retry.

---

## Phase C — Colony MCP wrapper (like the gbrain one)

Same shape as the gbrain wrapper — `bun --smol` for lower RSS, parent-PID watcher so a crashing Claude Code doesn't orphan the Colony MCP process.

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/colony-mcp-wrapper.sh <<'SH'
#!/usr/bin/env bash
set -u
export COLONY_HOME="${COLONY_HOME:-$HOME/.colony}"
COLONY_CLI=$(readlink -f "$(which colony)")
BUN_BIN=$(which bun)
# Parent-PID watcher: if Claude Code dies, kill our process group.
parent_pid=$PPID
( while kill -0 "$parent_pid" 2>/dev/null; do sleep 10; done; kill -TERM 0 2>/dev/null ) &
exec "$BUN_BIN" --smol "$COLONY_CLI" mcp 2>/tmp/colony-mcp.stderr
SH
chmod +x ~/.local/bin/colony-mcp-wrapper.sh
# verify:
[ -x ~/.local/bin/colony-mcp-wrapper.sh ] && echo "wrapper ok"
```

---

## Phase D — register Colony MCP in `~/.claude.json`

```bash
python3 - <<'PY'
import json, pathlib, os
p = pathlib.Path(os.path.expanduser('~/.claude.json'))
d = json.loads(p.read_text()) if p.exists() else {}
d.setdefault('mcpServers', {})['colony'] = {
    'command': os.path.expanduser('~/.local/bin/colony-mcp-wrapper.sh')
}
p.write_text(json.dumps(d, indent=2))
print('Colony MCP registered. Restart Claude Code to pick it up.')
PY
```

After restart, `mcp__colony__*` tools show up in your tool list. The compact-startup loop (`hivemind_context` → `attention_inbox` → `task_ready_for_agent`) replaces 30k-token repo dumps with ~400 tokens of coordination state.

---

## Phase E — opt the lean-stack skills into parallel work

The lean stack's CLAUDE.md (written in `setup/<os>.md` Phase 7) is conservative ("minimal safe mode"). For parallel work, append the gitguardex + Colony contract:

```bash
cat >> ~/.claude/CLAUDE.md <<'EOF'

## Parallel agents — Guardex + Colony contract

When running 2+ agents on the same repo:
- Work from `agent/*` branches in worktrees (`gx branch start`), never on `main`.
- Claim files via Colony `task_claim_file` (or `gx locks claim`) before editing.
- Coordinate via Colony task posts/messages — not chat history.
- Finish through `gx branch finish --via-pr --wait-for-merge --cleanup`, never a bare `git push`.
- Read latest Colony state before replacing another agent's code.
- Never `git checkout <agent/...>` from the primary tree. Always work inside the agent's printed worktree path.

Full contract: see `~/.claude/skills/gitguardex/SKILL.md` and `~/.claude/skills/colony/SKILL.md`.
EOF
```

---

## Phase F — final verification

```bash
# All three tools live:
gx --version && colony --version && which colony-mcp-wrapper.sh

# Colony MCP entry visible in Claude config:
python3 -c "import json,os; d=json.load(open(os.path.expanduser('~/.claude.json'))); print(list(d.get('mcpServers',{})))"

# Skills (colony + gitguardex) installed for Claude Code:
ls ~/.claude/skills/colony ~/.claude/skills/gitguardex 2>/dev/null

# Open a fresh Claude Code session and check the MCP tool list:
claude
# inside Claude:
# > list available MCP tools
# you should see mcp__colony__hivemind_context, mcp__colony__task_post, mcp__colony__task_claim_file, etc.
```

---

## Smoke test — your first parallel run

In your repo, open one Claude Code window per worker. In each:

```bash
# Window 1 — kick off the lane
gx branch start "fix-the-thing" "claude-1"
# cd into the printed worktree path, then in Claude Code:
# > "Use Colony to claim files X and Y, work on the bug, and finish via gx when done."

# Window 2 — separate lane
gx branch start "polish-the-docs" "claude-2"
# cd into printed path
# > "Use Colony to claim files A and B, do the docs pass, and finish via gx when done."
```

Both agents now see each other's claims via `mcp__colony__hivemind_context` and won't touch the other's files. PRs land via `gx branch finish` — one merge at a time, no force-pushes.

---

## When to skip this tier

- You only ever run one Claude Code window at a time. (Then claude-mem + gbrain are enough.)
- You're not collaborating with other AI agents on the same repo.
- Disk is tight (~200 MB extra) or RAM is tight (~150 MB extra per concurrent Claude window).

You can always come back and add it later — the lean stack and the parallel tier compose cleanly.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `gx: command not found` | `~/.local/bin` not on PATH | `export PATH=$HOME/.local/bin:$PATH` (add to `.bashrc`/`.zshrc`) |
| `colony doctor` reports missing SQLite | First-run init didn't write `~/.colony` | `colony init` |
| Colony MCP not in Claude tool list | Claude Code wasn't restarted after Phase D | `pkill -f claude && claude` |
| `gx branch finish` hangs at `gh pr create` | Stale `GH_TOKEN` env var | See `skills/skills/github/gh-auth-doctor/SKILL.md` — diagnoses & repair steps |
| Two agents both editing the same file anyway | One of them skipped `task_claim_file` | Add the claim contract to `~/.claude/CLAUDE.md` (Phase E) and restart |
| Colony MCP process keeps orphaning to PID 1 | Wrapper missing or symlink stale | Re-run Phase C; `pgrep -af 'colony mcp'` to confirm only one per Claude window |

---

## Ask before running

Read the above, then ask:

1. **OS / shell**: Linux native, macOS, or WSL2 inside Windows? (Native Windows PowerShell is **not** supported for `gx` — needs POSIX worktrees.)
2. **Runtime**: Bun (recommended, lower RAM) or Node? If you don't have Bun, the lean-stack install put it on PATH already.
3. **Where to clone**: default is `~/Documents/{gitguardex,colony}`. Override if you keep code elsewhere.

Then run Phase A, verify, proceed to Phase B, and so on. Don't run as one blob — each phase has a verification step.
