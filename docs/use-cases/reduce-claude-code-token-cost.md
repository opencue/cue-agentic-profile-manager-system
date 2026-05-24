# How to reduce Claude Code token cost — the cue playbook

_Last updated: 2026-05-24_

**Short answer:** A typical Claude Code session that loads every skill globally costs **~$2.70 per session**. With cue's per-directory profile isolation it drops to **~$0.12**. With RTK and caveman terse-mode stacked on top, it drops to **~$0.08**. That's a **22–33× reduction** in real spend, plus better tool-selection accuracy because the model isn't drowning in 1,900 irrelevant tool descriptions.

This page is the data-backed playbook for cutting Claude Code costs.

---

## Where the tokens actually go

Run `cue eval --breakdown <profile>` to see your real breakdown:

```text
  Profile Eval: ecc

  Loadout
    Skills: 8  Rules: 10  Commands: 6  Hooks: 4  MCPs: 1  Plugins: 1
    Per-message: 779 tokens  ($0.0023/msg)
    On-demand:   20.0K tokens (lazy — only when invoked)

  Breakdown (per-message tokens)
    skills       449  76%  ████████████████████  (+8.3K on-demand)
    rules         18   2%  █                      (+4.4K on-demand)
    commands      18   2%  █                      (+5.6K on-demand)
    hooks        120  15%  ████                   (+392 on-demand)
```

**Two budgets, not one:**

- **Per-message** = what every single turn pays in input tokens. This is the budget that compounds across a session.
- **On-demand** = lazy bodies. Skills, commands, and rule bodies are *referenced* in CLAUDE.md as one-line entries but their full content is only loaded when the model actually reads them. They count once per session, not per turn.

Naïve token estimation conflates these and over-reports cost by 20×+. `cue eval` shows the real picture.

---

## The 3 optimizations that actually compound

### 1. Profile isolation (biggest single win — 10–25×)

Without cue: `~/.claude/` is one global folder. Every session loads every skill, every MCP, every plugin you've ever installed. Frontend session loads cybersecurity skills. Marketing session loads Rust skills.

With cue: `cue use backend` in your backend repo. `cue use marketing` in your marketing repo. Each session loads only the relevant profile's loadout.

Run `cue eval --compare full backend` to see the delta in your own setup.

### 2. RTK shell-output filter (60–90% per shell command)

[RTK](https://github.com/rtk-ai/rtk) is a Claude Code hook that filters shell command output before it hits the model. `ls -la /usr` produces ~10K tokens of file listings; RTK distills it to a 200-token summary the model can act on. cue ships RTK in every profile via `core`.

Run `rtk gain` to see your cumulative savings.

### 3. Caveman terse-output mode (~40% output tokens)

The `caveman` plugin ships a `/caveman` slash command that flips Claude into a terse-response mode — no filler, no "I'd be happy to help", no "let me explain..." prefixes. You also save on output tokens (which are billed at the higher rate for Sonnet/Opus).

Activate per-session with `/caveman` or globally by triggering it at session start.

---

## Real numbers (typical backend session, Claude Sonnet 4.6)

| Setup | Per-message tokens | Cost per session (20 messages) | Annual cost (1 session/day) |
|---|---|---|---|
| **Naïve global Claude Code** (all skills + MCPs loaded) | ~9,000 | **~$2.70** | ~$985 |
| **cue with `backend` profile** | ~400 | **~$0.12** | ~$44 |
| **cue + RTK** | ~400 input + 60% less shell output | **~$0.08** | ~$29 |
| **cue + RTK + caveman** | same + 40% less output | **~$0.05** | ~$18 |

Sonnet 4.6 input is $3/MTok, output is $15/MTok. Numbers above use a typical 50/50 input/output mix per turn.

A team of 5 developers each doing 3 Claude Code sessions/day = **$5,400/year saved** by switching from naïve global config to cue + RTK + caveman.

---

## How to actually measure your savings

```bash
# 1. Establish a baseline
cue eval --compare full backend --json > baseline.json

# 2. Track over time
cue eval --all                          # all profiles ranked
cue stats                               # session count + duration per profile
rtk gain                                # cumulative RTK savings in tokens

# 3. Drill into a specific profile
cue eval backend --breakdown            # see where the tokens are going
cue failures backend --days 7           # see where the profile is failing (= where it's wasteful)
```

---

## What NOT to do

- **Don't over-prune profiles.** Cutting skills makes the model worse at the things you actually do. The 25× savings comes from removing *irrelevant* skills, not from minimalism for its own sake.
- **Don't disable hooks to save tokens.** The safety hooks (bash-preflight, secrets-guard, commit-message-guard) cost ~120 tokens/message total. They prevent real failures that cost orders of magnitude more.
- **Don't stack token-saving prompts.** `caveman` mode is enough; adding "be terse" + "no filler" + "short answer" in custom prompts is double-counting and confuses the model.

---

## See also

- [Glossary: per-message vs on-demand](../glossary.md#materialization) — formal definitions
- [Claude Code for marketing teams](./claude-code-for-marketing-teams.md) — domain-specific savings
- [cue's optimizer dashboard](../../README.md#cue-optimizer--see-every-loadout-at-a-glance) — see your loadout at a glance
- [RTK upstream](https://github.com/rtk-ai/rtk) — the shell-output filter cue bundles
