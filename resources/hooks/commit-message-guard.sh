#!/usr/bin/env bash
# PreToolUse:Bash hook — reject weak `git commit -m "..."` messages.
#
# Catches the common failure mode where an agent commits with "wip", "fix",
# "update", or one-word messages. Allows multi-line / detailed messages.
# Allows --amend / --fixup. Doesn't touch commits via HEREDOC, files, or editors.
#
# Exit 0 = allow, exit 2 = block.
set -euo pipefail

payload="$(cat -)"
# Robust JSON extraction — naive grep breaks on escaped quotes.
cmd="$(printf '%s' "$payload" | python3 -c 'import sys,json
try: d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))
except Exception: pass' 2>/dev/null)"
if [[ -z "$cmd" ]]; then exit 0; fi

# Only inspect git commit invocations with an inline -m flag. Skip --amend,
# editor-based commits, and commits whose message comes from a file/HEREDOC.
if [[ ! "$cmd" =~ ^[[:space:]]*git[[:space:]]+commit ]]; then exit 0; fi
if [[ "$cmd" == *"--amend"* || "$cmd" == *"--fixup"* || "$cmd" == *"--squash"* ]]; then exit 0; fi
if [[ "$cmd" != *"-m"* && "$cmd" != *"--message"* ]]; then exit 0; fi

# Extract the -m / --message argument. Handle both quote styles.
msg="$(printf '%s' "$cmd" | grep -oE '(-m|--message)[[:space:]]+("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)' | head -1 \
  | sed -E 's/^(-m|--message)[[:space:]]+//; s/^["'"'"']//; s/["'"'"']$//')"

# HEREDOC indirection — `git commit -m "$(cat <<EOF ... EOF)"` — let it through.
if [[ "$msg" == *'$('* || "$msg" == *'`'* ]]; then exit 0; fi

# Empty / unparseable — let git itself complain.
if [[ -z "$msg" ]]; then exit 0; fi

# Rule 1: at least 15 chars (covers "fix", "wip", "update", "asdf", etc.).
if (( ${#msg} < 15 )); then
  >&2 echo "cue:commit-message-guard blocked: commit message is too short (${#msg} chars):"
  >&2 echo "  \"$msg\""
  >&2 echo "Rewrite with a real subject — what changed and why."
  exit 2
fi

# Rule 2: reject low-effort one-word/two-word fillers.
lower="$(printf '%s' "$msg" | tr '[:upper:]' '[:lower:]' | tr -d '.!?')"
case "$lower" in
  wip|fix|fixes|fixed|update|updates|updated|patch|tweak|tweaks|misc|changes|cleanup|refactor|stuff|things|various)
    >&2 echo "cue:commit-message-guard blocked: \"$msg\" is a filler message."
    >&2 echo "Say what changed: 'add X', 'fix Y crash on Z', etc."
    exit 2 ;;
esac

exit 0
