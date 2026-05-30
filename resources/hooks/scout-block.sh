#!/usr/bin/env bash
# PreToolUse:Read|Grep|Glob — block reads into generated/dependency dirs (opt-in).
#
# Reading or grepping node_modules, dist, build output, etc. burns context for
# zero value — the agent should scout source, not vendored/generated trees.
# This hook refuses those reads so the model stays on the real codebase.
#
# Opt-in only: active when ${HOME}/.config/cue/scout-block exists (toggle with
# the /scout slash command, or `touch`/`rm` the file). Off by default.
#
# Bypass one path: add a substring to CUE_SCOUT_ALLOW (space-separated), e.g.
#   CUE_SCOUT_ALLOW="node_modules/some-pkg/src .next/types"
# Bash dangers are covered by careful-mode + bash-quality-preflight, not here.
#
# Exit 0 = allow, exit 2 = block (Claude sees stderr as the reason).
set -euo pipefail

state_file="${HOME}/.config/cue/scout-block"
[[ -f "$state_file" ]] || exit 0

payload="$(cat -)"

# Pull every path-bearing field the read tools expose.
paths="$(printf '%s' "$payload" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); ti=d.get("tool_input",{})
    for k in ("file_path","path","notebook_path"):
        v=ti.get(k)
        if v: print(v)
except Exception: pass' 2>/dev/null)"
[[ -z "$paths" ]] && exit 0

# Generated / dependency directories that should never be read directly.
blocked_segs=(
  node_modules .next .nuxt .svelte-kit .output dist build out target
  .venv venv __pycache__ .cache .turbo .gradle coverage vendor
  bower_components Pods DerivedData .terraform
)

# Honor the per-call allowlist (negation).
read -r -a allow <<< "${CUE_SCOUT_ALLOW:-}"
is_allowed() {
  local p="$1" a
  for a in "${allow[@]}"; do
    [[ -n "$a" && "$p" == *"$a"* ]] && return 0
  done
  return 1
}

while IFS= read -r p; do
  [[ -z "$p" ]] && continue
  is_allowed "$p" && continue
  for seg in "${blocked_segs[@]}"; do
    if [[ "$p" == *"/$seg/"* || "$p" == "$seg/"* || "$p" == *"/$seg" || "$p" == "$seg" ]]; then
      >&2 echo "cue:scout-block blocked: '$p' is inside a generated/dependency dir ('$seg')."
      >&2 echo "Scout source, not vendored/build output. To read it anyway: set CUE_SCOUT_ALLOW='$seg', or disable with: rm $state_file"
      exit 2
    fi
  done
done <<< "$paths"

exit 0
