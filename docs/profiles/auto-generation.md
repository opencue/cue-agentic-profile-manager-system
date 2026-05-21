# Auto-generation

`soul scan` discovers available skills and groups them by inferred work domain.
`soul new <name> --from-scan` uses the same grouping to write a draft
`profiles/<name>/profile.yaml`.

## What gets scanned

The scanner is read-only. It looks at:

- local skills under `skills/skills/*/*/SKILL.md`
- npx-installed skills under `~/.claude/skills` and `~/.agents/skills`
- Claude Code plugins under `~/.claude/plugins`

When A10/A11 scanner modules are installed, `soul scan` calls them. If they are
not present, the CLI uses compatible fallback scanners so the command still
works on a real machine.

## Domain heuristic

For each `SKILL.md`, soul reads YAML frontmatter and normalizes the
`description` field. The tokenizer lowercases text, splits punctuation and
hyphens, removes common stop words, and scores the remaining tokens against
domain keyword sets.

Current domains:

- `frontend`: UI, web, React, Vite, storefront, mobile, dashboard
- `backend`: API, routes, database, migrations, workflows, Medusa, Stripe
- `docs`: documentation, PDF, Word, Markdown, articles, writing
- `devops`: deploys, DNS, VPS, Docker, CI, GitHub, Coolify, Hostinger
- `media`: images, video, rendering, Remotion, photos, screenshots
- `data`: analytics, spreadsheets, CSV, metrics, reports, Supabase
- `marketing`: ads, SEO, campaigns, email, pricing, launch, sales
- `research`: search, scraping, browser research, keywords, competitors
- `security`: security, audits, secrets, tokens, sandboxing
- `orchestration`: agents, team workflows, Colony, OMX, Codex, Claude
- `core`: cross-cutting commit, lint, file-reading, notes, memory, setup
- `misc`: fallback when no domain scores

`core` is special. Cross-cutting skills are not added to a domain profile by
default. The generated YAML comments list them as core candidates and suggest
putting them in `profiles/core/profile.yaml`. If a `core` profile already
exists, generated profiles can inherit it.

## Generated profile shape

`soul new test --from-scan --auto` writes one schema-valid profile:

```yaml
name: "test"
description: "Auto-generated from soul scan (12 skills)"
agents: [claude-code, codex]
skills:
  local:
    # backend
    - "medusa/building-with-medusa"
  npx:
    # docs
    - repo: "anthropics/skills"
      skills:
        - "pdf"
  plugins:
    # frontend
    - "some-plugin"
```

If `<name>` is itself a known domain, such as `backend`, the generated profile
keeps only that domain. Otherwise it includes all non-core domains. You can also
force one domain explicitly:

```bash
soul new shop-backend --from-scan --auto --domain backend
```

The generator never overwrites `profiles/<name>/profile.yaml` unless
`--force` is passed.

## Manual override

The heuristic is deliberately simple. To override it, edit the generated YAML:

- move a skill between profile files by moving its entry
- remove broad or irrelevant entries
- add `inherits: core` after creating `profiles/core/profile.yaml`
- pin npx skills by adding `pin: tag@...` or `pin: git@...`
- split a large generated profile into smaller domain profiles

Run validation after editing:

```bash
soul validate <name>
```
