# Subagents — attribution

These Claude Code subagents are imported from **agency-agents** by msitarzewski
(AgentLand Contributors), MIT-licensed. See `LICENSE`.

- Source: https://github.com/msitarzewski/agency-agents
- Imported at commit: `783f6a72bfd7f3135700ac273c619d92821b419a` (2026-04-11)
- Imported: 2026-05-31

## What was imported

A curated subset — 63 of the repo's 144 agents, covering the 10 divisions cue
has no existing skill equivalent for:

`academic`, `design`, `finance`, `game-development`, `paid-media`, `product`,
`project-management`, `sales`, `spatial-computing`, `testing`.

## What was skipped (and why)

- `engineering` — overlaps cue's rust / python / go / frontend / backend skills + `code-review`
- `marketing` — overlaps cue's marketing skills; ~18 are China-platform-specific
- `specialized` — grab-bag, mostly niche or overlapping (customer-service, compliance, recruitment)
- `support` — thin, overlaps existing skills
- `strategy` / `examples` / `integrations` / `scripts` — briefs, READMEs, installers (not agents)

To pull any skipped agent back, copy its `.md` into the matching division dir
here and add its `<division>/<file-stem>` ref to a profile's `subagents:` list.

## Format

Each file is a Claude Code subagent: YAML frontmatter (`name`, `description`,
`color`, plus non-standard `emoji`/`vibe` that Claude Code ignores) followed by
the agent's system prompt. cue materializes them flat into
`$CLAUDE_CONFIG_DIR/agents/<file-stem>.md` for any profile that lists them under
`subagents:`.

## Normalization applied on import

Claude Code requires the frontmatter `name:` to be lowercase-with-hyphens and
derives subagent identity from that field alone (not the filename). The upstream
agents shipped Title-Case names with spaces (e.g. `name: AI Engineer`), which
Claude Code would not accept. On import every `name:` was rewritten to its
kebab-case file-stem (e.g. `engineering-ai-engineer`), which is already globally
unique — so `name`, filename, and the materialized `agents/<stem>.md` symlink
all agree. The human-readable role still reads from the `description:` field,
which Claude Code uses for delegation routing.
