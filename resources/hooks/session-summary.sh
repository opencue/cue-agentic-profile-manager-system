#!/usr/bin/env bash
# Stop hook — appends a one-line summary to ~/.config/cue/session-log.jsonl
# when a session ends. Lets `cue stats` / `cue eval` show actual usage
# without depending on Claude Code internals.
#
# No external deps. Reads the Stop payload from stdin.
set -euo pipefail

payload="$(cat -)"
log_dir="${HOME}/.config/cue"
log="${log_dir}/session-log.jsonl"
mkdir -p "$log_dir"

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cwd="$(pwd)"
profile_file=""
if [[ -f .cue-profile ]]; then
  profile_file="$(head -1 .cue-profile | tr -d '[:space:]')"
fi

# Extract session_id from payload (best-effort, no jq dep).
session_id="$(printf '%s' "$payload" | grep -oE '"session_id"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"session_id"\s*:\s*"//; s/"$//')"

printf '{"ts":"%s","cwd":"%s","profile":"%s","session_id":"%s"}\n' \
  "$ts" "$cwd" "$profile_file" "$session_id" >> "$log"

exit 0
