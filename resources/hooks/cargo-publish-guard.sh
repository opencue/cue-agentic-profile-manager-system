#!/usr/bin/env bash
# PreToolUse:Bash guard for crates.io publishes.
#
# Publishing to crates.io is irreversible (you can yank but not delete), and a
# bad release wedges every downstream user. This hook blocks the action so the
# human has to explicitly approve. Mirrors the bash-quality-preflight pattern.
#
# Exit 0 = allow, exit 2 = block (Claude sees stderr as the rejection reason).
# Pure bash; reads the hook payload from stdin (Claude Code hook protocol).
set -euo pipefail

payload="$(cat -)"
cmd="$(printf '%s' "$payload" | python3 -c 'import sys,json
try: d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))
except Exception: pass' 2>/dev/null)"

if [[ -z "$cmd" ]]; then exit 0; fi

# Patterns that perform real publishes. Dry-runs are allowed.
deny_patterns=(
  'cargo[[:space:]]+publish([[:space:]]|$)'        # plain cargo publish
  'cargo[[:space:]]+release[[:space:]]+.*publish'  # cargo-release with publish
  'release-plz[[:space:]]+(release|publish)'       # release-plz release/publish
  'cargo[[:space:]]+owner[[:space:]]+--add'        # adding owners is also production-affecting
  'cargo[[:space:]]+yank'                           # yanking is reversible but still production
)

# Allow explicit dry-runs.
if printf '%s' "$cmd" | grep -qE '\-\-dry-run\b'; then exit 0; fi

for pat in "${deny_patterns[@]}"; do
  if printf '%s' "$cmd" | grep -qE "$pat"; then
    >&2 echo "cue:cargo-publish-guard blocked: '$pat' affects crates.io / the public registry."
    >&2 echo "If you really mean it, ask the user first — releases are irreversible."
    >&2 echo "For a dry-run, append --dry-run."
    exit 2
  fi
done

exit 0
