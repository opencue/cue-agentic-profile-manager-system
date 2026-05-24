#!/usr/bin/env bash
# PreToolUse:Bash quality preflight.
#
# Reads the hook payload from stdin (Claude Code hook protocol) and rejects
# obviously destructive commands so the model has to think twice before issuing
# them. Exit 0 = allow, exit 2 = block (Claude sees stderr as the rejection
# reason and chooses something else).
#
# No external deps. No plugin paths. Safe to run anywhere.
set -euo pipefail

payload="$(cat -)"
# Robust JSON extraction — naive grep breaks on escaped quotes inside command.
cmd="$(printf '%s' "$payload" | python3 -c 'import sys,json
try: d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))
except Exception: pass' 2>/dev/null)"

if [[ -z "$cmd" ]]; then exit 0; fi

# Patterns that are almost always wrong without explicit confirmation.
deny_patterns=(
  'rm[[:space:]]+-rf?[[:space:]]+(/|~|\$HOME)([[:space:]]|$)'
  'rm[[:space:]]+-rf?[[:space:]]+\*'
  ':\(\)\{.*\};:'                 # fork bomb
  'mkfs(\.|[[:space:]])'
  'dd[[:space:]]+if=.*of=/dev/sd' # disk overwrite
  'chmod[[:space:]]+-R[[:space:]]+777[[:space:]]+/'
  '>[[:space:]]*/dev/sd[a-z]'     # raw disk write
  'shutdown|reboot|halt|poweroff'
  'git[[:space:]]+push[[:space:]]+.*--force(-with-lease)?[[:space:]]+.*[[:space:]](main|master)'
)

for pat in "${deny_patterns[@]}"; do
  if printf '%s' "$cmd" | grep -qE "$pat"; then
    >&2 echo "cue:bash-quality-preflight blocked: command matches '$pat'"
    >&2 echo "If you really mean it, ask the user first."
    exit 2
  fi
done

exit 0
