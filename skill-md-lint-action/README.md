# cue SKILL.md Linter — GitHub Action

Lint every `SKILL.md` in your repo against the [Claude Code skill spec](https://github.com/recodeee/cue/blob/main/src/lib/skill-linter.ts#L1) on every push or pull request. Catches frontmatter spec violations, missing `Prerequisites`, malformed `allowed-tools`, missing trigger phrases, and broken anchor links.

**Why:** Anthropic's skill discovery is unforgiving. Missing fields and malformed syntax cause your skill to silently fail in some contexts. This action runs locally on your repo with zero side effects.

## Quick start

Add `.github/workflows/lint-skill-md.yml` to your repo:

```yaml
name: Lint SKILL.md
on:
  pull_request:
    paths:
      - '**/SKILL.md'
      - '.github/workflows/lint-skill-md.yml'
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write  # only needed if comment-pr: true
    steps:
      - uses: actions/checkout@v4
      - uses: recodeee/cue/skill-md-lint-action@main
```

That's it. On every PR you'll get a comment with the lint report; on push to main the action will fail if any error-level issues are found.

## Options

| Input | Default | Description |
|---|---|---|
| `path` | `.` | What to lint. Single file or directory (recursive scan for SKILL.md). |
| `fix` | `false` | Auto-fix issues and commit back to the branch (PR only). |
| `fail-on` | `error` | Lowest severity to fail on: `error`, `warning`, or `info`. |
| `comment-pr` | `true` | Post the report as a PR comment. |

## Example: auto-fix on PR

```yaml
- uses: recodeee/cue/skill-md-lint-action@main
  with:
    fix: true              # apply fixes
    comment-pr: true       # also comment with anything that needed flagging
    fail-on: error         # only fail CI on real spec errors
```

## What it checks

| Rule | Severity | Auto-fix |
|---|---|---|
| R001 | error | ✅ — derives `name:` from first H1 |
| R002 missing `description:` | error | — (needs your judgment) |
| R003 description >200 chars | warning | — |
| R004 description lacks trigger phrase | warning | — |
| R005 malformed `allowed-tools` | error | ✅ — wraps in `Bash(name:*)` |
| R006 missing `Prerequisites` | warning | ✅ — adds section with real install commands per platform |
| R007 missing `tags:`/`domain:` | info | — |
| R008 broken in-doc anchor links | warning | — |

## Outputs

| Output | Type | Description |
|---|---|---|
| `diagnostics-json` | JSON | Full diagnostics array, per file scanned. |
| `error-count` | number | Number of error-severity diagnostics found. |

## Use locally instead

If you'd rather not run this in CI, install cue and run the linter directly:

```bash
git clone --depth 1 https://github.com/recodeee/cue ~/cue
cd ~/cue && bun install
bun ~/cue/src/index.ts lint-skill /path/to/your/skill
```

## License

MIT — same as [recodeee/cue](https://github.com/recodeee/cue).
