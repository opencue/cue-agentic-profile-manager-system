# Draft: Soul Skill Profiles Through authmux

## Problem

New Codex sessions currently receive the full Soul skill surface.

Live evidence:

- `~/.codex/skills` has 98 Soul skill symlinks.
- `mcps/configs/mcp-skill-map.json` reports `skill_count: 98`.
- The current Codex prompt injects the full available-skills table before the task starts.
- The large injected table is mostly cached, but it still burns context window and makes every new session heavier.

We should not delete skills. We should stop exposing all skills to every agent by default.

## Goal

Make each new Codex or Claude Code session start with only the skills needed for that account, role, repo, or task.

Target:

- Default new session: 6-12 skills.
- Specialized session: 10-18 skills.
- Emergency `all` profile still available.
- No source skill directories deleted.
- Existing Soul skill install remains recoverable.

## Proposed Model

Add a Soul-owned "skill profile" layer.

Soul remains the source of truth:

```text
/home/deadpool/Documents/soul/skills/skills/<category>/<skill>/SKILL.md
```

Generated profile outputs become the runtime surface:

```text
~/.codex/skill-profiles/<profile>/skills/<skill> -> Soul source skill dir
~/.claude-accounts/<name>/skills/<skill> -> Soul source skill dir
```

authmux chooses the profile when launching or switching an agent.

## Why authmux Is The Right Layer

authmux already controls the launch boundary:

- Codex: shell hook wraps `codex`, restores terminal-pinned account snapshot, then runs `command codex`.
- Claude Code: `authmux parallel` creates per-profile config dirs with `CLAUDE_CONFIG_DIR=~/.claude-accounts/<name>`.

That is exactly where skill profile activation belongs. Skill selection should happen before a new agent process starts, not inside the running conversation.

## Profile Files

Add profile definitions to Soul:

```text
skills/profiles/base.json
skills/profiles/frontend.json
skills/profiles/medusa.json
skills/profiles/design.json
skills/profiles/deploy.json
skills/profiles/review.json
skills/profiles/orchestration.json
skills/profiles/all.json
```

Example:

```json
{
  "name": "frontend",
  "include": [
    "just",
    "help",
    "token-efficiency-review",
    "github",
    "gh-fix-ci",
    "ui-ux-pro-max",
    "web-design-guidelines",
    "vercel-react-best-practices",
    "vercel-composition-patterns",
    "screenshot",
    "playwright"
  ]
}
```

Every profile should include a tiny rescue baseline:

```text
just
help
skill-suggestion
find-skills
token-efficiency-review
```

## First Profiles

### base

For normal coding/debug sessions.

```text
just
help
skill-suggestion
find-skills
token-efficiency-review
github
gh-fix-ci
code-review
security-best-practices
colony
```

### frontend

For UI, React, screenshots, visual QA.

```text
base rescue skills
ui-ux-pro-max
web-design-guidelines
vercel-react-best-practices
vercel-composition-patterns
design-taste-frontend
screenshot
playwright
```

### medusa

For Medusa backend/storefront work.

```text
base rescue skills
building-with-medusa
building-storefronts
building-admin-dashboard-customizations
medusa-reference
db-generate
db-migrate
new-user
new-admin-via-api
storefront-best-practices
```

### design

For asset, image, brand, and redesign work.

```text
base rescue skills
imagegen-frontend-web
imagegen-frontend-mobile
image-to-code
gpt-taste
high-end-visual-design
redesign-existing-projects
brandkit
screenshot
```

### deploy

For hosting, DNS, VPS, Supabase, Coolify.

```text
base rescue skills
coolify
pnpm
supabase
vps
hosting
dns
domains
```

### review

For review/security/API checking.

```text
base rescue skills
code-review
security-review
security-best-practices
api-tester
github
gh-fix-ci
```

### orchestration

For multi-agent and coordination work.

```text
base rescue skills
colony
colony-prompts
codex-fleet
codex-fleet-login
worker
pipeline
visual-ralph
gitguardex
```

### all

Compatibility profile that exposes all 98 Soul skills. Use only when explicitly requested.

## Soul Commands

Add a profile activation command or script:

```sh
soul skills list
soul skills profiles
soul skills activate --profile frontend --agent codex
soul skills activate --profile medusa --agent claude --target ~/.claude-accounts/medusa
```

If there is no `soul` CLI yet, implement the first version as:

```text
skills/scripts/activate-profile.sh
```

Behavior:

1. Read `skills/profiles/<profile>.json`.
2. Validate every requested skill exists under `skills/skills/**/<skill>/SKILL.md`.
3. Build a symlink farm in a temp directory.
4. Atomically replace the target `skills` symlink/directory.
5. Print profile name, target path, and skill count.

Do not mutate the source skill directories.

## Codex Integration

Preferred path:

```text
authmux account/profile -> skillProfile -> CODEX_HOME or ~/.codex/skills profile target
```

Add authmux account metadata:

```json
{
  "name": "frontend-work",
  "skillProfile": "frontend"
}
```

Add commands:

```sh
authmux use frontend-work --skill-profile frontend
authmux save frontend-work --skill-profile frontend
authmux skills use frontend
authmux skills current
```

Update the Codex shell hook:

```sh
codex() {
  command authmux restore-session >/dev/null 2>&1 || true
  command authmux skills activate-current --agent codex >/dev/null 2>&1 || true
  command codex "$@"
  local status=$?
  CODEX_AUTH_FORCE_EXTERNAL_SYNC=1 command authmux status >/dev/null 2>&1 || true
  return $status
}
```

If Codex supports a per-process skill root or `CODEX_HOME`, use that. If not, authmux can atomically switch `~/.codex/skills` before process start.

Profile changes apply to new sessions only.

## Claude Code Integration

Claude already has isolated authmux profiles:

```text
~/.claude-accounts/<name>
```

Extend `authmux parallel`:

```sh
authmux parallel --add frontend --skill-profile frontend
authmux parallel --add medusa --skill-profile medusa
authmux parallel --install
```

Generated alias:

```sh
alias claude-frontend="authmux skills activate frontend --agent claude --target ~/.claude-accounts/frontend >/dev/null 2>&1; CLAUDE_CONFIG_DIR=~/.claude-accounts/frontend command claude"
```

Claude profile skills should live inside the profile config dir if Claude discovers skills there. If Claude only reads global skills, use a Claude-specific global symlink switch with the same "new sessions only" rule.

## Repo/Task Autoselection

Keep autoselection simple at first:

1. Explicit flag wins: `--skill-profile`.
2. Account metadata wins next.
3. Repo config wins next: `.soul/skill-profile`, `.authmux-skill-profile`, or package metadata.
4. Fallback to `base`.

Examples:

```text
recodee dashboard work -> frontend
Medusa store work -> medusa
Coolify/VPS work -> deploy
PR review -> review
multi-agent planning -> orchestration
unknown -> base
```

Do not infer huge profiles from one keyword. Prefer base plus one domain profile.

## Safety Rules

- Never delete `skills/skills/**`.
- Never expose `all` unless requested.
- Profile activation must be atomic.
- Running sessions keep their current context; changes affect only new sessions.
- Keep a rescue command: `authmux skills use all`.
- Keep `base` small and stable.
- Print counts every time a profile is activated.

## Verification

Commands:

```sh
find ~/.codex/skills -maxdepth 1 -type l | wc -l
soul skills activate --profile frontend --agent codex
find ~/.codex/skills -maxdepth 1 -type l | wc -l
codex
```

Expected:

```text
before: 98
after frontend: <= 15
new Codex prompt lists only frontend profile skills
all profile restores 98
```

Claude:

```sh
authmux parallel --add frontend --skill-profile frontend
authmux parallel --aliases
claude-frontend
```

Expected:

```text
CLAUDE_CONFIG_DIR points to ~/.claude-accounts/frontend
profile skill dir contains only frontend skills
new Claude session sees only those skills
```

## Implementation Plan

1. Soul: add `skills/profiles/*.json` and `skills/scripts/activate-profile.sh`.
2. Soul: update `skills/scripts/install-codex.sh` to support `SOUL_SKILL_PROFILE`, defaulting to `all` for compatibility during transition.
3. authmux: add `skillProfile` to account/profile registry metadata.
4. authmux: add `skills` command group with `use`, `current`, `activate-current`, and `list`.
5. authmux: update Codex login hook to activate the current profile before `command codex`.
6. authmux: extend Claude parallel profile aliases with profile activation.
7. Tests: profile validation, symlink output count, missing-skill error, hook rendering, Claude alias rendering.
8. Docs: replace "install all skills by default" guidance with "base by default, all on request".

## Open Questions

- Does Codex support a per-process skills root, or only `~/.codex/skills`?
- Does Claude Code discover skills from `CLAUDE_CONFIG_DIR/skills`, or only a global path?
- Should repo profile config live in `.soul/skill-profile` or in existing agent config?

## Recommendation

Implement Soul profile generation first, then wire authmux to call it.

This gives an immediate token win without changing the source skills or waiting for deeper Codex/Claude behavior changes. The initial safe default should be `base`, not `all`.
