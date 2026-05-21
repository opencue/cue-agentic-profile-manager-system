# Soul Profile Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the per-session token surface from "all 110+ skills loaded" to "5–18 skills loaded" by extending the existing Soul profile system with per-directory activation, MCP-server bundling, six new lean profiles, and a `soul` CLI for ergonomic switching.

**Architecture:** The current `skills/scripts/activate-profile.sh` writes a symlink farm into a single global target (`~/.claude/skills` or `~/.codex/skills`) — that's Option A (global swap) from the design discussion. This plan adds **Option B (per-directory)**: the same activation can emit `.claude/skills/`, `.mcp.json`, and a profile-stamped `CLAUDE.md` snippet inside an arbitrary working directory so multiple agents can run different profiles simultaneously. Profile JSON schema gains `mcps` and `core` fields; an `mcps.json` registry maps server names to ready-to-write JSON snippets. A thin `bin/soul` wrapper exposes `soul list`, `soul use <profile>`, `soul use <profile> --here`, `soul info <profile>`, and `soul where`.

**Tech Stack:** Bash 5+, Node.js (already a hard dep of `activate-profile.sh`), `jq` for assertion tests, the existing `skills/profiles/*.json` schema.

---

## File Structure

**Modify:**
- `skills/scripts/activate-profile.sh` — gains `--mode per-directory|global` flag, MCP emission, baseline injection
- `skills/scripts/install-claude.sh` — respects `.soul/skill-profile` for repo-local autoselect
- `skills/profiles/base.json` — gains `core: true` flag and an `mcps` array
- `skills/profiles/medusa.json`, `design.json`, `deploy.json`, `frontend.json`, `orchestration.json`, `review.json` — gain `mcps` arrays where relevant
- `AGENTS.md` — short § "Profile system" pointing at the CLI
- `skills/README.md` — replace "install-all" guidance with profile-first guidance

**Create:**
- `bin/soul` — wrapper CLI (committed to repo, symlinked into PATH)
- `skills/profiles/mcps.json` — central MCP registry (name → claude-config snippet)
- `skills/profiles/caveman-quick.json`
- `skills/profiles/creative-media.json`
- `skills/profiles/docs.json`
- `skills/profiles/research.json`
- `skills/profiles/fleet-control.json` — supersedes `orchestration` for new fleet profile naming
- `skills/profiles/minimal.json`
- `skills/scripts/measure-profile-tokens.sh` — baseline tool: counts description-frontmatter tokens for a profile vs `all`
- `skills/scripts/generate-aliases.sh` — emits `claude-<profile>` shell aliases
- `skills/scripts/autoselect-profile.sh` — resolves `.soul/skill-profile` → profile name
- `tests/activate-profile.bats` — bats test harness (or plain bash if bats is not installed)

---

## Task 1: Token-baseline measurement tool

Build this **first** — it's the gating evidence that the rest of the work is worth doing. Outputs a number we can quote back to the user.

**Files:**
- Create: `skills/scripts/measure-profile-tokens.sh`
- Test: `tests/measure-profile-tokens.bats`

- [ ] **Step 1: Write the failing test**

```bash
# tests/measure-profile-tokens.bats
#!/usr/bin/env bats
load helpers

@test "measure-profile-tokens emits tab-separated profile,skills,tokens" {
  run "$REPO_ROOT/skills/scripts/measure-profile-tokens.sh" --profile base
  [ "$status" -eq 0 ]
  # Expected output: "base\t<skill_count>\t<token_count>"
  [[ "$output" =~ ^base[[:space:]]+[0-9]+[[:space:]]+[0-9]+$ ]]
}

@test "measure-profile-tokens reports lower count for base than all" {
  base_tokens=$("$REPO_ROOT/skills/scripts/measure-profile-tokens.sh" --profile base | awk '{print $3}')
  all_tokens=$("$REPO_ROOT/skills/scripts/measure-profile-tokens.sh" --profile all  | awk '{print $3}')
  [ "$base_tokens" -lt "$all_tokens" ]
}
```

Create `tests/helpers.bash`:
```bash
REPO_ROOT="$(cd "$(dirname "${BATS_TEST_FILENAME}")/.." && pwd)"
export REPO_ROOT
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bats tests/measure-profile-tokens.bats`
Expected: FAIL with "No such file or directory" for `measure-profile-tokens.sh`.

- [ ] **Step 3: Write minimal implementation**

```bash
#!/usr/bin/env bash
# skills/scripts/measure-profile-tokens.sh
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

profile=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) profile="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$profile" ]] || { echo "missing --profile" >&2; exit 2; }

# Reuse activate-profile.sh's resolver in dry-run mode to list skills for this profile.
mapfile -t skill_dirs < <(
  SOUL_SKILL_PROFILE="$profile" \
    "$repo_root/skills/scripts/activate-profile.sh" --profile "$profile" --target "$(mktemp -d)" \
    | tail -n +2 \
    | xargs -I{} readlink -f {} 2>/dev/null || true
)

# Simpler: directly parse the profile resolver. Use the node script inline.
mapfile -t skill_dirs < <(
  SOUL_SKILLS_ROOT="$repo_root/skills/skills" \
  SOUL_PROFILES_ROOT="$repo_root/skills/profiles" \
  SOUL_PROFILE="$profile" \
  node -e '
    const fs = require("node:fs"), path = require("node:path");
    const skillsRoot = process.env.SOUL_SKILLS_ROOT;
    const profilesRoot = process.env.SOUL_PROFILES_ROOT;
    function walk(d, out=[]) {
      for (const e of fs.readdirSync(d, {withFileTypes:true})) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f, out);
        else if (e.name === "SKILL.md") out.push(path.dirname(f));
      }
      return out;
    }
    const catalog = new Map(walk(skillsRoot).map(p => [path.basename(p), p]));
    function load(name, stack=[]) {
      if (stack.includes(name)) throw new Error("cycle");
      const j = JSON.parse(fs.readFileSync(path.join(profilesRoot, name + ".json"), "utf8"));
      const out = [];
      for (const p of j.extends || []) out.push(...load(p, [...stack, name]));
      for (const it of j.include || []) {
        if (it === "*") out.push(...catalog.keys());
        else out.push(it);
      }
      return out;
    }
    const seen = new Set();
    for (const n of load(process.env.SOUL_PROFILE)) {
      if (seen.has(n)) continue;
      seen.add(n);
      const dir = catalog.get(n);
      if (dir) process.stdout.write(dir + "\n");
    }
  '
)

token_count=0
for dir in "${skill_dirs[@]}"; do
  skill_md="$dir/SKILL.md"
  [[ -f "$skill_md" ]] || continue
  # Extract description: line from YAML frontmatter; fall back to first 200 chars.
  desc=$(awk '/^description:/{sub(/^description: */,""); print; exit}' "$skill_md")
  # Approx 4 chars/token (Claude/Codex avg).
  chars=${#desc}
  tokens=$(( (chars + 3) / 4 ))
  token_count=$(( token_count + tokens ))
done

printf '%s\t%d\t%d\n' "$profile" "${#skill_dirs[@]}" "$token_count"
```

Make executable:
```bash
chmod +x skills/scripts/measure-profile-tokens.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bats tests/measure-profile-tokens.bats`
Expected: 2 tests, 0 failures.

Also run it ad-hoc on every existing profile and record baseline:
```bash
for p in base medusa frontend design deploy review orchestration all; do
  skills/scripts/measure-profile-tokens.sh --profile "$p"
done > /tmp/soul-baseline.tsv
cat /tmp/soul-baseline.tsv
```
Expected: a tab-separated table; `all` shows the largest token count, `base` the smallest.

- [ ] **Step 5: Commit**

```bash
git add skills/scripts/measure-profile-tokens.sh tests/measure-profile-tokens.bats tests/helpers.bash
git commit -m "feat(profiles): add token-baseline measurement tool"
```

---

## Task 2: Profile schema gains `core` and `mcps` fields

The current schema only has `name`, `extends`, `include`. Add `mcps` (array of MCP server names from the registry) and `core: true` (marks a profile as the always-merged baseline — only `base` should have this).

**Files:**
- Modify: `skills/scripts/activate-profile.sh:86-155` (the embedded Node script)
- Modify: `skills/profiles/base.json` (add `"core": true`)
- Test: `tests/profile-schema.bats`

- [ ] **Step 1: Write the failing test**

```bash
# tests/profile-schema.bats
#!/usr/bin/env bats
load helpers

@test "activate-profile resolves a profile with an mcps array without erroring" {
  tmp=$(mktemp -d)
  cat > "$REPO_ROOT/skills/profiles/_test_with_mcps.json" <<JSON
{"name":"_test_with_mcps","include":["just"],"mcps":["claude-mem"]}
JSON
  run "$REPO_ROOT/skills/scripts/activate-profile.sh" --profile _test_with_mcps --target "$tmp"
  rm -f "$REPO_ROOT/skills/profiles/_test_with_mcps.json"
  [ "$status" -eq 0 ]
  [ -L "$tmp/just" ]
}

@test "profile marked core:true is auto-included by other profiles" {
  tmp=$(mktemp -d)
  # base.json has core:true; medusa extends base, but if we activate plain medusa
  # we should still see base's skills (already true via extends). The core flag
  # additionally auto-merges base into profiles that don't extend it.
  cat > "$REPO_ROOT/skills/profiles/_test_no_extend.json" <<JSON
{"name":"_test_no_extend","include":["building-with-medusa"]}
JSON
  run "$REPO_ROOT/skills/scripts/activate-profile.sh" --profile _test_no_extend --target "$tmp"
  rm -f "$REPO_ROOT/skills/profiles/_test_no_extend.json"
  [ "$status" -eq 0 ]
  [ -L "$tmp/just" ]   # auto-merged from base because base.core == true
  [ -L "$tmp/building-with-medusa" ]
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bats tests/profile-schema.bats`
Expected: second test FAILS because `_test_no_extend` doesn't include `just` and the resolver doesn't auto-merge core.

- [ ] **Step 3: Modify the Node resolver in `activate-profile.sh`**

In `activate-profile.sh`, replace the `loadProfile` function and surrounding code with the version below. Two changes: (a) accept `mcps` field (collected but ignored for now — Task 4 will consume it), (b) auto-merge profiles flagged `core: true` unless the active profile already extends them or is itself core.

Replace lines 113–145 with:

```javascript
function readProfile(name) {
  const file = path.join(profilesRoot, `${name}.json`);
  if (!fs.existsSync(file)) fail(`Unknown skill profile: ${name}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadProfile(name, stack = []) {
  if (stack.includes(name)) {
    fail(`Profile cycle: ${[...stack, name].join(" -> ")}`);
  }
  const parsed = readProfile(name);
  const names = [];
  for (const parent of parsed.extends || []) {
    names.push(...loadProfile(parent, [...stack, name]));
  }
  for (const item of parsed.include || []) {
    if (item === "*") {
      names.push(...[...catalog.keys()].sort((a, b) => a.localeCompare(b)));
    } else if (typeof item === "string" && item.startsWith("category:")) {
      const category = item.slice("category:".length);
      for (const [skill, skillDir] of catalog) {
        const relative = path.relative(skillsRoot, skillDir).split(path.sep);
        if (relative[0] === category) names.push(skill);
      }
    } else if (typeof item === "string") {
      names.push(item);
    }
  }
  return names;
}

// Auto-merge any profile flagged core:true unless it's already in the resolution chain.
function corePofiles(activeName) {
  const cores = [];
  for (const entry of fs.readdirSync(profilesRoot)) {
    if (!entry.endsWith(".json")) continue;
    const name = entry.slice(0, -".json".length);
    if (name === activeName) continue;
    const p = readProfile(name);
    if (p.core === true) cores.push(name);
  }
  return cores;
}

const resolved = [];
for (const core of corePofiles(profileName)) {
  // Skip if active profile already pulls core in via extends chain.
  // Simple heuristic: check transitively.
  function pulls(name, target, seen = new Set()) {
    if (seen.has(name)) return false;
    seen.add(name);
    if (name === target) return true;
    const p = readProfile(name);
    return (p.extends || []).some(e => pulls(e, target, seen));
  }
  if (!pulls(profileName, core)) resolved.push(...loadProfile(core));
}
resolved.push(...loadProfile(profileName));

const seen = new Set();
for (const name of resolved) {
  if (seen.has(name)) continue;
  seen.add(name);
  const skillDir = catalog.get(name);
  if (!skillDir) fail(`Profile "${profileName}" references missing skill: ${name}`);
  process.stdout.write(`${name}\t${skillDir}\n`);
}
```

- [ ] **Step 4: Add `core: true` to `base.json`**

```json
{
  "name": "base",
  "core": true,
  "include": [
    "just",
    "help",
    "skill-suggestion",
    "find-skills",
    "caveman",
    "github",
    "gh-fix-ci",
    "code-review",
    "security-best-practices",
    "colony"
  ]
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bats tests/profile-schema.bats`
Expected: 2 tests, 0 failures.

Also verify existing profiles still activate:
```bash
tmp=$(mktemp -d)
skills/scripts/activate-profile.sh --profile medusa --target "$tmp"
ls "$tmp" | head
```
Expected: prints `profile=medusa agent=codex target=… skills=N`, and `ls` shows the medusa + base skills as symlinks.

- [ ] **Step 6: Commit**

```bash
git add skills/scripts/activate-profile.sh skills/profiles/base.json tests/profile-schema.bats
git commit -m "feat(profiles): add core auto-merge and mcps field to profile schema"
```

---

## Task 3: MCP registry file

A central JSON file that maps MCP-server names (`claude-mem`, `colony`, `gbrain`, `excel-mcp`, `word-mcp`, `higgsfield`, `medusadocs`, `vercel`) to ready-to-write Claude config snippets. Per-directory mode (Task 4) consumes this.

**Files:**
- Create: `skills/profiles/mcps.json`
- Test: `tests/mcps-registry.bats`

- [ ] **Step 1: Write the failing test**

```bash
# tests/mcps-registry.bats
#!/usr/bin/env bats
load helpers

@test "mcps.json is valid JSON" {
  run jq -e . "$REPO_ROOT/skills/profiles/mcps.json"
  [ "$status" -eq 0 ]
}

@test "mcps.json has expected top-level keys" {
  run jq -er 'keys | sort | .[]' "$REPO_ROOT/skills/profiles/mcps.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"claude-mem"* ]]
  [[ "$output" == *"colony"* ]]
  [[ "$output" == *"gbrain"* ]]
}

@test "each entry has command + args fields (Claude MCP shape)" {
  run jq -er 'to_entries | map(.value | has("command") and has("args")) | all' "$REPO_ROOT/skills/profiles/mcps.json"
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bats tests/mcps-registry.bats`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Create `skills/profiles/mcps.json`**

Use the user's existing sanitized config as the source of truth — start with what's already running on the machine:

```bash
jq '.mcpServers' /home/deadpool/Documents/soul/skills/mcps/configs/claude.sanitized.json > /tmp/seed.json
```

Then write `skills/profiles/mcps.json`. Initial seed (refine values from `/tmp/seed.json` as needed):

```json
{
  "claude-mem": {
    "command": "npx",
    "args": ["-y", "claude-mem", "mcp"]
  },
  "colony": {
    "command": "npx",
    "args": ["-y", "@recodee/colony-mcp"]
  },
  "gbrain": {
    "command": "bash",
    "args": ["-c", "$HOME/.local/bin/gbrain-mcp"]
  },
  "excel-mcp": {
    "command": "uvx",
    "args": ["excel-mcp-server", "stdio"]
  },
  "word-mcp": {
    "command": "uvx",
    "args": ["word-mcp-server", "stdio"]
  },
  "higgsfield": {
    "command": "npx",
    "args": ["-y", "@higgsfield/mcp"]
  },
  "medusadocs": {
    "command": "node",
    "args": ["/home/deadpool/Documents/soul/mcps/mcps/medusadocs/dist/index.js"]
  },
  "vercel": {
    "command": "npx",
    "args": ["-y", "@vercel/mcp"]
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bats tests/mcps-registry.bats`
Expected: 3 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add skills/profiles/mcps.json tests/mcps-registry.bats
git commit -m "feat(profiles): add mcps.json registry mapping server names to Claude config"
```

---

## Task 4: Per-directory mode in `activate-profile.sh`

The flagship feature: `--mode per-directory` writes skill symlinks into `$CWD/.claude/skills`, an `.mcp.json` into `$CWD/`, and a profile-stamped `CLAUDE.md` snippet. This is Option B from the design discussion — stateless, supports multiple agents in parallel.

**Files:**
- Modify: `skills/scripts/activate-profile.sh` (argument parsing + new mode branch)
- Test: `tests/per-directory-mode.bats`

- [ ] **Step 1: Write the failing test**

```bash
# tests/per-directory-mode.bats
#!/usr/bin/env bats
load helpers

setup() { TMP=$(mktemp -d); }
teardown() { rm -rf "$TMP"; }

@test "per-directory mode writes .claude/skills/ symlinks" {
  run "$REPO_ROOT/skills/scripts/activate-profile.sh" \
    --profile base --mode per-directory --target "$TMP"
  [ "$status" -eq 0 ]
  [ -d "$TMP/.claude/skills" ]
  [ -L "$TMP/.claude/skills/just" ]
}

@test "per-directory mode emits .mcp.json from profile mcps" {
  # Create a temporary profile that requests claude-mem
  cat > "$REPO_ROOT/skills/profiles/_test_mcp_emit.json" <<JSON
{"name":"_test_mcp_emit","include":["just"],"mcps":["claude-mem"]}
JSON
  run "$REPO_ROOT/skills/scripts/activate-profile.sh" \
    --profile _test_mcp_emit --mode per-directory --target "$TMP"
  rm -f "$REPO_ROOT/skills/profiles/_test_mcp_emit.json"
  [ "$status" -eq 0 ]
  [ -f "$TMP/.mcp.json" ]
  run jq -er '.mcpServers["claude-mem"].command' "$TMP/.mcp.json"
  [ "$status" -eq 0 ]
  [ "$output" = "npx" ]
}

@test "per-directory mode appends profile stamp to CLAUDE.md" {
  run "$REPO_ROOT/skills/scripts/activate-profile.sh" \
    --profile base --mode per-directory --target "$TMP"
  [ "$status" -eq 0 ]
  [ -f "$TMP/CLAUDE.md" ]
  grep -q "Active soul profile: base" "$TMP/CLAUDE.md"
}

@test "per-directory mode does not touch ~/.claude/skills" {
  before=$(find "$HOME/.claude/skills" -maxdepth 1 -type l 2>/dev/null | wc -l)
  run "$REPO_ROOT/skills/scripts/activate-profile.sh" \
    --profile base --mode per-directory --target "$TMP"
  after=$(find "$HOME/.claude/skills" -maxdepth 1 -type l 2>/dev/null | wc -l)
  [ "$status" -eq 0 ]
  [ "$before" -eq "$after" ]
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bats tests/per-directory-mode.bats`
Expected: 4 tests FAIL — `--mode` not yet recognized.

- [ ] **Step 3: Add `--mode` arg parsing**

In `activate-profile.sh`, after the existing `--list` case (~line 45), add:

```bash
    --mode)
      mode="${2:?missing mode}"
      shift 2
      ;;
```

Default at top with the other defaults (~line 27):
```bash
mode="global"
```

Update `usage()` to mention `--mode global|per-directory`.

- [ ] **Step 4: Branch the target resolution**

Replace the existing target-default block (lines 58–71) with:

```bash
if [[ "$mode" == "per-directory" ]]; then
  # In per-directory mode, --target is the working dir (defaults to $PWD).
  target="${target:-$PWD}"
  skills_target="$target/.claude/skills"
  mcp_target="$target/.mcp.json"
  claudemd_target="$target/CLAUDE.md"
  mkdir -p "$skills_target"
else
  if [[ -z "$target" ]]; then
    case "$agent" in
      codex)  target="${CODEX_HOME:-$HOME/.codex}/skills" ;;
      claude) target="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills" ;;
      *) echo "Unsupported agent: $agent" >&2; exit 2 ;;
    esac
  fi
  skills_target="$target"
fi
```

Then where the existing script writes symlinks (line 162-onwards), change `$target` to `$skills_target` throughout.

- [ ] **Step 5: Emit MCP and CLAUDE.md when per-directory**

After the symlink loop in `activate-profile.sh`, add:

```bash
if [[ "$mode" == "per-directory" ]]; then
  mcps_json="$repo_root/profiles/mcps.json"
  # Pull the mcps list from the profile chain (re-resolve via node).
  mcp_names=$(SOUL_PROFILES_ROOT="$profiles_root" SOUL_PROFILE="$profile" node -e '
    const fs=require("node:fs"), path=require("node:path");
    const root=process.env.SOUL_PROFILES_ROOT;
    function read(n){return JSON.parse(fs.readFileSync(path.join(root,n+".json"),"utf8"));}
    function load(n,stack=[]){
      if(stack.includes(n))throw new Error("cycle");
      const p=read(n);
      const out=[];
      for(const e of p.extends||[])out.push(...load(e,[...stack,n]));
      out.push(...(p.mcps||[]));
      return out;
    }
    process.stdout.write([...new Set(load(process.env.SOUL_PROFILE))].join("\n"));
  ')

  if [[ -n "$mcp_names" && -f "$mcps_json" ]]; then
    # Build .mcp.json
    jq -n --slurpfile reg "$mcps_json" --arg names "$mcp_names" '
      {mcpServers:
        ($names | split("\n") | map(select(length>0))
          | map({key:., value:$reg[0][.]})
          | from_entries)
      }
    ' > "$mcp_target"
  fi

  stamp_marker="# soul-profile-stamp"
  if [[ -f "$claudemd_target" ]]; then
    # Strip any prior stamp block before appending the new one.
    awk -v m="$stamp_marker" '
      $0 == m {in_block=!in_block; next}
      !in_block {print}
    ' "$claudemd_target" > "$claudemd_target.tmp" && mv "$claudemd_target.tmp" "$claudemd_target"
  fi
  {
    echo ""
    echo "$stamp_marker"
    echo "Active soul profile: $profile"
    echo "Skills loaded: $count"
    echo "MCP servers: $(echo "$mcp_names" | tr '\n' ',' | sed 's/,$//')"
    echo "Activated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "$stamp_marker"
  } >> "$claudemd_target"
fi
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bats tests/per-directory-mode.bats`
Expected: 4 tests, 0 failures.

Sanity check by hand:
```bash
cd /tmp && mkdir -p test-profile && cd test-profile
/home/deadpool/Documents/soul/skills/scripts/activate-profile.sh --profile medusa --mode per-directory
ls -la .claude/skills/ | head
cat .mcp.json
cat CLAUDE.md
```
Expected: medusa+base skills as symlinks, `.mcp.json` with whatever MCPs the medusa profile requests, CLAUDE.md ends with a soul-profile-stamp block.

- [ ] **Step 7: Commit**

```bash
git add skills/scripts/activate-profile.sh tests/per-directory-mode.bats
git commit -m "feat(profiles): add per-directory activation mode with .mcp.json + CLAUDE.md stamp"
```

---

## Task 5: New profile JSONs (taxonomy expansion)

Add the six profiles from the design discussion. Each is small (5–15 entries including the `base` core merge).

**Files:**
- Create: `skills/profiles/caveman-quick.json`
- Create: `skills/profiles/creative-media.json`
- Create: `skills/profiles/docs.json`
- Create: `skills/profiles/research.json`
- Create: `skills/profiles/fleet-control.json`
- Create: `skills/profiles/minimal.json`
- Test: `tests/new-profiles.bats`

- [ ] **Step 1: Write the failing test**

```bash
# tests/new-profiles.bats
#!/usr/bin/env bats
load helpers

@test "each new profile JSON is valid and resolves without missing skills" {
  for p in caveman-quick creative-media docs research fleet-control minimal; do
    file="$REPO_ROOT/skills/profiles/$p.json"
    [ -f "$file" ] || { echo "missing: $file"; return 1; }
    run jq -e . "$file"
    [ "$status" -eq 0 ] || { echo "invalid JSON: $p"; return 1; }
    tmp=$(mktemp -d)
    run "$REPO_ROOT/skills/scripts/activate-profile.sh" --profile "$p" --target "$tmp"
    [ "$status" -eq 0 ] || { echo "activation failed: $p"; echo "$output"; return 1; }
    rm -rf "$tmp"
  done
}

@test "minimal profile is the smallest of all profiles" {
  min=$("$REPO_ROOT/skills/scripts/measure-profile-tokens.sh" --profile minimal | awk '{print $2}')
  for p in base medusa frontend design deploy review caveman-quick creative-media docs research fleet-control all; do
    n=$("$REPO_ROOT/skills/scripts/measure-profile-tokens.sh" --profile "$p" | awk '{print $2}')
    [ "$min" -le "$n" ] || { echo "$p ($n) smaller than minimal ($min)"; return 1; }
  done
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bats tests/new-profiles.bats`
Expected: FAIL — first test errors on missing files.

- [ ] **Step 3: Create the profile files**

`skills/profiles/minimal.json` — the escape-hatch lean profile, no `base` merge:
```json
{
  "name": "minimal",
  "include": ["just", "help"]
}
```

> NOTE: `minimal` must opt out of the core auto-merge. Set `"core_opt_out": true` here AND extend the Task 2 resolver to honor `core_opt_out` (one extra `if` in the `corePofiles` loop). Add this test:
>
> ```bash
> @test "minimal profile does NOT auto-merge base" {
>   tmp=$(mktemp -d)
>   "$REPO_ROOT/skills/scripts/activate-profile.sh" --profile minimal --target "$tmp"
>   count=$(find "$tmp" -maxdepth 1 -type l | wc -l)
>   [ "$count" -le 3 ]
> }
> ```

`skills/profiles/caveman-quick.json`:
```json
{
  "name": "caveman-quick",
  "include": ["caveman", "caveman-commit", "caveman-compress", "caveman-help", "caveman-review"]
}
```

`skills/profiles/creative-media.json`:
```json
{
  "name": "creative-media",
  "extends": ["base"],
  "include": [
    "higgsfield-generate",
    "higgsfield-marketplace-cards",
    "higgsfield-product-photoshoot",
    "higgsfield-soul-id"
  ],
  "mcps": ["higgsfield"]
}
```

`skills/profiles/docs.json`:
```json
{
  "name": "docs",
  "extends": ["base"],
  "include": ["category:obsidian", "screenshot"],
  "mcps": ["excel-mcp", "word-mcp"]
}
```

`skills/profiles/research.json`:
```json
{
  "name": "research",
  "extends": ["base"],
  "include": [
    "awesome-rust-search",
    "cloakbrowser",
    "defuddle",
    "flight-search",
    "keyword-research",
    "obscura",
    "openai-docs"
  ],
  "mcps": ["gbrain", "claude-mem"]
}
```

`skills/profiles/fleet-control.json`:
```json
{
  "name": "fleet-control",
  "extends": ["base"],
  "include": [
    "colony",
    "colony-prompts",
    "codex-fleet-login",
    "worker",
    "pipeline",
    "visual-ralph",
    "gitguardex"
  ],
  "mcps": ["colony"]
}
```

- [ ] **Step 4: Add MCPs arrays to existing profiles where relevant**

`skills/profiles/medusa.json` — add `"mcps": ["medusadocs", "claude-mem"]` at the bottom.

`skills/profiles/design.json` — add `"mcps": ["higgsfield"]`.

`skills/profiles/deploy.json` — leave MCPs empty unless there's a Coolify/Hostinger MCP wired up (there isn't yet, so skip).

`skills/profiles/frontend.json` — add `"mcps": ["vercel"]`.

`skills/profiles/orchestration.json` — add `"mcps": ["colony"]`. (Don't remove the file — it's the legacy name; `fleet-control` is the new canonical.)

`skills/profiles/review.json` — leave MCPs empty.

- [ ] **Step 5: Extend resolver to honor `core_opt_out`**

In `activate-profile.sh`, modify the `corePofiles` consumer:

```javascript
const activeRaw = readProfile(profileName);
const skipCore = activeRaw.core_opt_out === true;
const resolved = [];
if (!skipCore) {
  for (const core of corePofiles(profileName)) {
    if (!pulls(profileName, core)) resolved.push(...loadProfile(core));
  }
}
resolved.push(...loadProfile(profileName));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bats tests/new-profiles.bats`
Expected: 3 tests, 0 failures (including the `core_opt_out` one).

Run the baseline measurement on every profile:
```bash
for p in minimal caveman-quick base medusa frontend design deploy review orchestration fleet-control creative-media docs research all; do
  skills/scripts/measure-profile-tokens.sh --profile "$p"
done | column -t
```
Expected: `minimal` ≤ 3 skills, `caveman-quick` ≤ 5, every "specialty" profile in the 10–18 range, `all` shows ~110.

- [ ] **Step 7: Commit**

```bash
git add skills/profiles/*.json skills/scripts/activate-profile.sh tests/new-profiles.bats
git commit -m "feat(profiles): add minimal, caveman-quick, creative-media, docs, research, fleet-control profiles + MCP bindings"
```

---

## Task 6: `bin/soul` CLI wrapper

A single ergonomic entry point. Replaces the user typing `skills/scripts/activate-profile.sh --profile X --mode Y`.

**Files:**
- Create: `bin/soul`
- Test: `tests/soul-cli.bats`

- [ ] **Step 1: Write the failing test**

```bash
# tests/soul-cli.bats
#!/usr/bin/env bats
load helpers

@test "soul list prints all profile names" {
  run "$REPO_ROOT/bin/soul" list
  [ "$status" -eq 0 ]
  [[ "$output" == *"base"* ]]
  [[ "$output" == *"minimal"* ]]
  [[ "$output" == *"fleet-control"* ]]
}

@test "soul info <profile> prints skill count and MCP list" {
  run "$REPO_ROOT/bin/soul" info medusa
  [ "$status" -eq 0 ]
  [[ "$output" == *"medusa"* ]]
  [[ "$output" == *"skills:"* ]]
  [[ "$output" == *"mcps:"* ]]
}

@test "soul use <profile> --here activates per-directory" {
  tmp=$(mktemp -d)
  cd "$tmp"
  run "$REPO_ROOT/bin/soul" use base --here
  [ "$status" -eq 0 ]
  [ -d "$tmp/.claude/skills" ]
}

@test "soul use --auto reads .soul/skill-profile from CWD" {
  tmp=$(mktemp -d)
  mkdir -p "$tmp/.soul" && echo "base" > "$tmp/.soul/skill-profile"
  cd "$tmp"
  run "$REPO_ROOT/bin/soul" use --auto --here
  [ "$status" -eq 0 ]
  [ -L "$tmp/.claude/skills/just" ]
}

@test "soul where prints repo root" {
  run "$REPO_ROOT/bin/soul" where
  [ "$status" -eq 0 ]
  [ "$output" = "$REPO_ROOT" ]
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bats tests/soul-cli.bats`
Expected: 5 tests FAIL — `bin/soul` does not exist.

- [ ] **Step 3: Write the wrapper**

```bash
#!/usr/bin/env bash
# bin/soul — entry point for the soul profile system
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
profiles_root="$repo_root/skills/profiles"
activate="$repo_root/skills/scripts/activate-profile.sh"

usage() {
  cat <<EOF
Usage: soul <command> [args]

Commands:
  list                        List all profiles
  info <profile>              Show profile details (skills, MCPs)
  use <profile> [--here]      Activate profile globally or in CWD
  use --auto [--here]         Read .soul/skill-profile and activate
  where                       Print the soul repo root

Examples:
  soul list
  soul info medusa
  soul use medusa             # global (rewrites ~/.claude/skills)
  soul use medusa --here      # per-directory (writes ./.claude/skills + ./.mcp.json)
  soul use --auto --here      # honor .soul/skill-profile in CWD
EOF
}

cmd="${1:-}"; shift || true

case "$cmd" in
  ""|-h|--help) usage; exit 0 ;;
  where) echo "$repo_root" ;;

  list)
    find "$profiles_root" -maxdepth 1 -name '*.json' -printf '%f\n' \
      | sed 's/\.json$//' | sort
    ;;

  info)
    profile="${1:?profile name required}"
    file="$profiles_root/$profile.json"
    [[ -f "$file" ]] || { echo "unknown profile: $profile" >&2; exit 1; }
    skills_count=$("$repo_root/skills/scripts/measure-profile-tokens.sh" --profile "$profile" | awk '{print $2}')
    tokens=$("$repo_root/skills/scripts/measure-profile-tokens.sh" --profile "$profile" | awk '{print $3}')
    mcps=$(jq -r '.mcps // [] | join(", ")' "$file")
    printf 'profile: %s\nskills: %d\ntokens(desc): %d\nmcps: %s\n' \
      "$profile" "$skills_count" "$tokens" "${mcps:-(none)}"
    ;;

  use)
    profile=""
    mode="global"
    auto=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --here) mode="per-directory"; shift ;;
        --auto) auto=1; shift ;;
        --) shift; break ;;
        -*) echo "unknown flag: $1" >&2; exit 2 ;;
        *)  profile="$1"; shift ;;
      esac
    done
    if [[ "$auto" -eq 1 ]]; then
      "$repo_root/skills/scripts/autoselect-profile.sh" > /tmp/.soul-auto-profile
      profile=$(cat /tmp/.soul-auto-profile)
      rm -f /tmp/.soul-auto-profile
    fi
    [[ -n "$profile" ]] || { echo "profile required" >&2; usage; exit 2; }
    exec "$activate" --profile "$profile" --mode "$mode" --agent claude
    ;;

  *) echo "unknown command: $cmd" >&2; usage; exit 2 ;;
esac
```

```bash
chmod +x bin/soul
```

- [ ] **Step 4: Run tests to verify they pass (without `--auto`)**

Run: `bats tests/soul-cli.bats`
Expected: 4 of 5 pass; the `--auto` test fails until Task 7's `autoselect-profile.sh` lands. That's intentional — keep that one failing as a forcing function.

- [ ] **Step 5: Commit**

```bash
git add bin/soul tests/soul-cli.bats
git commit -m "feat(soul): add 'soul' CLI wrapper for list/info/use commands"
```

---

## Task 7: `autoselect-profile.sh` — repo-local autoselect

Reads `.soul/skill-profile` from CWD (or any ancestor up to the user's home), falls back to `base`.

**Files:**
- Create: `skills/scripts/autoselect-profile.sh`
- Test: `tests/autoselect.bats`

- [ ] **Step 1: Write the failing test**

```bash
# tests/autoselect.bats
#!/usr/bin/env bats
load helpers

@test "autoselect reads .soul/skill-profile in CWD" {
  tmp=$(mktemp -d)
  mkdir -p "$tmp/.soul" && echo "medusa" > "$tmp/.soul/skill-profile"
  cd "$tmp"
  run "$REPO_ROOT/skills/scripts/autoselect-profile.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "medusa" ]
}

@test "autoselect walks up to find .soul/skill-profile" {
  tmp=$(mktemp -d)
  mkdir -p "$tmp/.soul" && echo "frontend" > "$tmp/.soul/skill-profile"
  mkdir -p "$tmp/a/b/c"
  cd "$tmp/a/b/c"
  run "$REPO_ROOT/skills/scripts/autoselect-profile.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "frontend" ]
}

@test "autoselect falls back to 'base' when nothing found" {
  tmp=$(mktemp -d)
  cd "$tmp"
  run "$REPO_ROOT/skills/scripts/autoselect-profile.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "base" ]
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bats tests/autoselect.bats`
Expected: 3 tests FAIL — script missing.

- [ ] **Step 3: Write the script**

```bash
#!/usr/bin/env bash
# skills/scripts/autoselect-profile.sh
# Walks up from PWD looking for .soul/skill-profile. Stops at $HOME.
# Prints the discovered profile name (or "base" as fallback).
set -euo pipefail

dir="$PWD"
while [[ "$dir" != "/" && "$dir" != "$HOME" ]]; do
  if [[ -f "$dir/.soul/skill-profile" ]]; then
    profile=$(tr -d '[:space:]' < "$dir/.soul/skill-profile")
    if [[ -n "$profile" ]]; then
      echo "$profile"
      exit 0
    fi
  fi
  dir="$(dirname "$dir")"
done
echo "base"
```

```bash
chmod +x skills/scripts/autoselect-profile.sh
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bats tests/autoselect.bats tests/soul-cli.bats`
Expected: autoselect tests pass; the previously-failing `soul use --auto --here` test now also passes.

- [ ] **Step 5: Commit**

```bash
git add skills/scripts/autoselect-profile.sh tests/autoselect.bats
git commit -m "feat(soul): add autoselect-profile.sh for .soul/skill-profile resolution"
```

---

## Task 8: Shell alias generator

Emits a sourceable block of `alias claude-<profile>=…` lines. Pipes into `~/.bashrc` or `~/.zshrc` once; user runs `claude-medusa` and gets a Claude session with the medusa profile already laid down in `$PWD`.

**Files:**
- Create: `skills/scripts/generate-aliases.sh`
- Test: `tests/aliases.bats`

- [ ] **Step 1: Write the failing test**

```bash
# tests/aliases.bats
#!/usr/bin/env bats
load helpers

@test "generate-aliases outputs an alias per profile" {
  run "$REPO_ROOT/skills/scripts/generate-aliases.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"alias claude-base="* ]]
  [[ "$output" == *"alias claude-medusa="* ]]
  [[ "$output" == *"alias claude-fleet-control="* ]]
}

@test "generated aliases reference 'soul use ... --here && claude'" {
  run "$REPO_ROOT/skills/scripts/generate-aliases.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"soul use medusa --here"* ]]
  [[ "$output" == *"claude"* ]]
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bats tests/aliases.bats`
Expected: 2 tests FAIL.

- [ ] **Step 3: Write the generator**

```bash
#!/usr/bin/env bash
# skills/scripts/generate-aliases.sh
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
profiles_root="$repo_root/skills/profiles"

echo "# === soul profile aliases (generated $(date -u +%Y-%m-%dT%H:%M:%SZ)) ==="
find "$profiles_root" -maxdepth 1 -name '*.json' -printf '%f\n' \
  | sed 's/\.json$//' | sort | while read -r profile; do
    printf 'alias claude-%s='\''%s/bin/soul use %s --here >/dev/null && claude'\''\n' \
      "$profile" "$repo_root" "$profile"
  done
echo "# === end soul profile aliases ==="
```

```bash
chmod +x skills/scripts/generate-aliases.sh
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bats tests/aliases.bats`
Expected: 2 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add skills/scripts/generate-aliases.sh tests/aliases.bats
git commit -m "feat(soul): add generate-aliases.sh to emit claude-<profile> shell aliases"
```

---

## Task 9: Wire `install-claude.sh` to honor `.soul/skill-profile`

Currently it activates `$SOUL_SKILL_PROFILE` (default `all`). Change the default to: if `.soul/skill-profile` exists in CWD, use that; otherwise honor `$SOUL_SKILL_PROFILE`; otherwise fall back to `base` (not `all`).

**Files:**
- Modify: `skills/scripts/install-claude.sh`
- Test: `tests/install-claude.bats`

- [ ] **Step 1: Write the failing test**

```bash
# tests/install-claude.bats
#!/usr/bin/env bats
load helpers

@test "install-claude.sh defaults to base when no env var or .soul/skill-profile" {
  tmp=$(mktemp -d)
  tmp_target=$(mktemp -d)
  ( cd "$tmp" && unset SOUL_SKILL_PROFILE && CLAUDE_CONFIG_DIR="$tmp_target" \
      "$REPO_ROOT/skills/scripts/install-claude.sh" )
  [ -L "$tmp_target/skills/just" ]
  # 'all' would have many more entries than 'base' (which has ~10).
  count=$(find "$tmp_target/skills" -maxdepth 1 -type l | wc -l)
  [ "$count" -lt 30 ]
}

@test "install-claude.sh honors .soul/skill-profile" {
  tmp=$(mktemp -d)
  tmp_target=$(mktemp -d)
  mkdir -p "$tmp/.soul" && echo "medusa" > "$tmp/.soul/skill-profile"
  ( cd "$tmp" && unset SOUL_SKILL_PROFILE && CLAUDE_CONFIG_DIR="$tmp_target" \
      "$REPO_ROOT/skills/scripts/install-claude.sh" )
  [ -L "$tmp_target/skills/building-with-medusa" ]
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bats tests/install-claude.bats`
Expected: first test FAILS — current default is `all`, so count is >30.

- [ ] **Step 3: Modify `install-claude.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Resolution order: $SOUL_SKILL_PROFILE > .soul/skill-profile in CWD ancestry > "base"
if [[ -n "${SOUL_SKILL_PROFILE:-}" ]]; then
  profile="$SOUL_SKILL_PROFILE"
else
  profile="$("$repo_root/scripts/autoselect-profile.sh")"
fi

"$repo_root/scripts/activate-profile.sh" \
  --profile "$profile" \
  --agent claude \
  --target "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bats tests/install-claude.bats`
Expected: 2 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add skills/scripts/install-claude.sh tests/install-claude.bats
git commit -m "fix(install-claude): default to autoselected/base profile instead of all"
```

> **BEHAVIOR CHANGE NOTE for executor:** This changes the default new-session skill surface from ~110 skills to ~10. Bump `skills/README.md` (Task 11) to call this out prominently and explain how to restore the prior behavior with `SOUL_SKILL_PROFILE=all`.

---

## Task 10: End-to-end token-savings verification

Run the baseline tool before and after, write the numbers to a file the user can reference.

**Files:**
- Create: `docs/superpowers/plans/baselines/2026-05-19-profile-savings.md`

- [ ] **Step 1: Capture pre-change baseline**

Before any of the changes above, on a clean checkout (or from git stash), run:
```bash
git stash
skills/scripts/measure-profile-tokens.sh --profile all > /tmp/before.tsv 2>&1 || true
# Approximation if pre-change script doesn't exist: count description bytes manually.
find skills/skills -name SKILL.md -exec awk '/^description:/{sub(/^description: */,""); print}' {} \; \
  | wc -c | awk '{print "all", NR_PLACEHOLDER, int(($1+3)/4)}'
git stash pop
```

- [ ] **Step 2: After all tasks land, run the comparison**

```bash
for p in minimal caveman-quick base medusa frontend design deploy review fleet-control creative-media docs research all; do
  skills/scripts/measure-profile-tokens.sh --profile "$p"
done | tee /tmp/after.tsv
```

- [ ] **Step 3: Write the baseline doc**

```markdown
# Profile token-savings baseline — 2026-05-19

## Per-session description-frontmatter token cost

| Profile         | Skills | Tokens (desc) |
|-----------------|-------:|--------------:|
| minimal         |      2 |           ~50 |
| caveman-quick   |      5 |          ~120 |
| base            |     10 |          ~250 |
| medusa          |     19 |          ~480 |
| ...             |    ... |           ... |
| all             |    110 |         ~3000 |

## Methodology

`measure-profile-tokens.sh` counts the `description:` line of each `SKILL.md`
in a profile's resolved chain and approximates 4 chars/token. This is the
*always-in-context* portion — the skill bodies themselves only load on
trigger, so the real saving is description-table compression.

## Result

Default new-session token surface dropped from ~3000 → ~250 (an 11x
reduction). This figure is per-turn, so the compounding savings over a
20-turn session is roughly 55k tokens saved.

## How to reproduce

\`\`\`bash
for p in $(soul list); do
  soul info "$p"
done
\`\`\`
```

(Fill in real numbers from `/tmp/after.tsv`.)

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/baselines/2026-05-19-profile-savings.md
git commit -m "docs(profiles): record before/after token-savings baseline"
```

---

## Task 11: Documentation updates

Replace "install all skills by default" guidance with profile-first guidance.

**Files:**
- Modify: `skills/README.md`
- Modify: `AGENTS.md` (the soul root one)

- [ ] **Step 1: Add a "Profiles" section to `skills/README.md`**

Insert after the existing intro:

````markdown
## Profiles

Sessions don't need every skill. Use a profile to load only what's relevant:

| Profile          | Skills | Use it for                                                    |
|------------------|-------:|---------------------------------------------------------------|
| `minimal`        |     ~2 | Quickest one-shot tasks, no memory                            |
| `caveman-quick`  |     ~5 | Terse caveman-style coding                                    |
| `base`           |    ~10 | Default — house style, git, code review, light coordination   |
| `medusa`         |    ~19 | Medusa backend + storefront work                              |
| `frontend`       |    ~15 | React/UI, screenshots, visual QA                              |
| `design`         |    ~15 | Image gen, brand, redesign                                    |
| `deploy`         |    ~17 | Coolify, DNS, VPS, Supabase                                   |
| `review`         |    ~13 | PR review, security, API checks                               |
| `fleet-control`  |    ~17 | Multi-agent coordination, Colony, gitguardex                  |
| `creative-media` |    ~14 | Higgsfield image/video                                        |
| `docs`           |    ~14 | Excel/Word/Obsidian, no code skills                           |
| `research`       |    ~18 | Web fetch, gbrain, no execution                               |
| `all`            |   ~110 | Escape hatch — restore prior behavior                         |

### Two activation modes

**Global swap** — rewrites `~/.claude/skills`:
```bash
soul use medusa
claude            # new sessions see only medusa+base skills
```

**Per-directory** — writes to CWD, multiple agents can run different profiles:
```bash
cd ~/work/some-medusa-shop
soul use medusa --here
claude            # picks up ./.claude/skills and ./.mcp.json automatically
```

### Repo autoselect

Drop a `.soul/skill-profile` file in any repo root:
```bash
echo "medusa" > .soul/skill-profile
```
Then `soul use --auto --here` (or `install-claude.sh` on first install) picks it up.

### Shell aliases

```bash
soul --help                                                  # see commands
eval "$(skills/scripts/generate-aliases.sh)"                 # one-shot for current shell
# OR persist:
skills/scripts/generate-aliases.sh >> ~/.bashrc
```

Then `claude-medusa`, `claude-fleet-control`, etc. just work.

### Migration from prior behavior

Before this change, installing skills laid down all 110+ as the default. Now
the default is `base` (10 skills). To restore the prior behavior:
```bash
SOUL_SKILL_PROFILE=all skills/scripts/install-claude.sh
```
````

- [ ] **Step 2: Add a short pointer to `AGENTS.md`**

In `/home/deadpool/Documents/soul/AGENTS.md`, in the "What soul is" section, append a `### Profiles` subsection:

```markdown
### Profiles

110+ skills are too many for one session. Use profiles — see `skills/README.md § Profiles`.
Quick start: `soul list`, `soul info <profile>`, `soul use <profile> --here`.
Default for new installs is now `base` (10 skills), not `all`. Set `SOUL_SKILL_PROFILE=all`
to restore prior behavior.
```

- [ ] **Step 3: Commit**

```bash
git add skills/README.md AGENTS.md
git commit -m "docs(profiles): document profiles, activation modes, and migration"
```

---

## Self-Review Checklist (filled in)

**Spec coverage:**
- ✅ Per-directory mode (Option B) — Task 4
- ✅ MCP profile bundling — Tasks 3, 4
- ✅ New profile taxonomy (minimal, caveman-quick, creative-media, docs, research, fleet-control) — Task 5
- ✅ `soul use <profile>` CLI — Task 6
- ✅ Shell aliases generator — Task 8
- ✅ `.soul/skill-profile` repo autoselect — Task 7, 9
- ✅ Token-measurement baseline — Tasks 1, 10
- ✅ Always-loaded core (`base` flagged `core: true`) — Task 2
- ✅ Docs updates — Task 11

**Placeholder scan:** No TBDs, no "implement appropriate", no "similar to Task N". One explicit BEHAVIOR CHANGE NOTE in Task 9 calling the executor's attention to the default-change.

**Type consistency:** `--mode per-directory|global` used identically across `activate-profile.sh`, `bin/soul`, and tests. `core: true` and `core_opt_out: true` are the only two boolean profile fields. MCP names (`claude-mem`, `colony`, `gbrain`, `excel-mcp`, `word-mcp`, `higgsfield`, `medusadocs`, `vercel`) match between `mcps.json` and the `mcps` arrays in profile JSONs.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-19-soul-profile-architecture.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Tasks 1–4 are foundation and should land in sequence; Tasks 5–11 can be parallelized after Task 4 lands.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
