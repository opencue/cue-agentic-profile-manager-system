# How to find Claude Code skills on GitHub

_Last updated: 2026-05-24_

**Short answer:** Use cue's `cue marketplace discover --cli-aware` command. It runs **GitHub Code Search for `filename:SKILL.md`** — finding repos that *demonstrably contain SKILL.md files*, not awesome-lists that just mention "Claude Code". Each result is scored, mapped to your cue profile by keyword overlap, and annotated with which CLIs it needs (and whether you have them).

---

## The problem with regular GitHub search

`gh search repos "claude code skill"` returns the most-starred repos *mentioning* those words. That's why the top results are awesome-lists like `awesome-claude-code` (no actual SKILL.md), agent collections, and meta-projects — not the skill repos themselves.

What you actually want: *repos that have a SKILL.md file in them*. That's a different query — **GitHub Code Search**, which lets you filter by filename across all of GitHub.

---

## Use cue (the easy way)

```bash
npm install -g cue-ai
cue marketplace discover --cli-aware --limit 50
```

Output:

```text
  50 repos with SKILL.md files (sorted by skill count, then stars)

         13 skills    334 ★  majiayu000/claude-skill-registry        → video, creative-media
                                                                       (no CLI deps declared)

          5 skills   2237 ★  jeremylongshore/cc-plugins-plus-skills  → backend, fleet-control
                                                                       ⚠ 2/3 missing: gcloud, vault

          1 skill     352 ★  CTCT-CT2/openclaw-security-watchdog    → cybersecurity, backend
                                                                       (no CLI deps declared)

          1 skill    1362 ★  elementalsouls/Claude-OSINT            → cybersecurity
                                                                       ⚠ 3/5 missing: amass, subfinder, nuclei
```

Each row shows:

| Column | What it means |
|---|---|
| **status** | `added` if you've already installed it via cue; blank otherwise |
| **skills** | how many SKILL.md files cue found in the repo (higher = more meaningful) |
| **★** | GitHub star count |
| **repo** | `owner/name` (clickable) |
| **profile fit** | which of *your* cue profiles best matches based on keyword overlap |
| **CLI status** | `✓ no new installs` (frictionless), `⚠ N/M missing: <names>` (needs installs), or `(no CLI deps declared)` |

---

## What gets matched

cue runs three code-search queries in parallel:

1. `filename:SKILL.md` (broad)
2. `claude filename:SKILL.md` (Claude Code skills)
3. `anthropic filename:SKILL.md` (Anthropic-spec skills)

Then deduplicates by repo, sorts by skill density, and enriches the top N with star counts (via `gh api repos/<owner>/<name>`).

Configure the result count with `--limit N` (default 30). For deeper sweeps:

```bash
cue marketplace discover --cli-aware --limit 100
```

---

## Filter by your active profile

```bash
cue marketplace discover --cli-aware --limit 30
#  → annotated with which of *your* profiles each repo best fits

# Want to see only repos matching one profile?
# Filter by reading the JSON output:
cue marketplace discover --json --limit 50 | jq '.[] | select(.bestFitProfiles[0].profile == "cybersecurity")'
```

cue's profile-fit matching builds a keyword index from each profile (name + skill first-segments + MCP IDs + description tokens) and scores each discovered repo against that index. Repos with no overlap show `(no profile match)`.

---

## Install a discovered skill

```bash
cue skills add majiayu000/claude-skill-registry --profile creative-media
```

cue fetches the repo, copies the SKILL.md files into `resources/skills/skills/<category>/`, updates your `~/skills-lock.json`, and re-resolves the profile. Next `claude` launch picks up the new skill.

For deeper inspection before installing:

```bash
# Preview what cue would PR to that repo if you asked it to fix spec issues
cue marketplace discover --pr-preview majiayu000/claude-skill-registry
```

---

## Where else to look (manual paths)

cue covers ~90% of the discovery surface, but for completeness:

- **GitHub topics** — search `topic:claude-skill`, `topic:claude-code-skill`, `topic:mcp-server`
- **Anthropic's own [claude-code-plugins](https://github.com/anthropics/claude-code-plugins)** — official plugin marketplace
- **[OpenClaw](https://github.com/openclaw)** — open-source agent ecosystem with its own skill registry
- **[MCP servers list](https://github.com/modelcontextprotocol/servers)** — official MCP server registry (cue auto-detects MCPs declared in profile.yaml)

---

## Why cue is better than `gh search`

| Capability | cue marketplace discover | raw `gh search repos` |
|---|---|---|
| Finds repos containing SKILL.md (vs mentioning Claude) | ✅ | ❌ |
| Counts SKILL.md files per repo | ✅ | ❌ |
| Maps each repo to your cue profile | ✅ | ❌ |
| Annotates with CLI requirements | ✅ | ❌ |
| Checks which CLIs are already installed | ✅ | ❌ |
| Generates per-profile SEO pages | ✅ (`--site --html`) | ❌ |
| One-command install of found skill | ✅ (`cue skills add`) | ❌ (manual clone + copy) |

---

## See also

- [Glossary: SKILL.md, profile, MCP defined](../glossary.md)
- [cue vs skillport](../comparison/cue-vs-skillport.md) — skill installer comparison
- [Reduce Claude Code token cost](./reduce-claude-code-token-cost.md) — the savings playbook
- [GitHub Code Search docs](https://docs.github.com/en/search-github/searching-on-github/searching-code) — the underlying API
