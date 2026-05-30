#!/usr/bin/env bash
# UserPromptSubmit hook — when a user prompt expresses build intent ("let's
# build X", "implement Y", "add a feature"), inject a "💡 Prior-art check"
# context block reminding Claude to search open-source prior art FIRST, before
# writing net-new code. Makes tools/prior-art proactive instead of reactive.
#
# Philosophy: don't reinvent what someone already shipped. Research, check if
# it exists, pull the best repo via opensrc, learn from it, then decide
# adopt-vs-build. See resources/rules/common/development-workflow.md (Research
# & Reuse) and tools/prior-art/SKILL.md.
#
# Non-blocking observability hook: exit 0 always. Never gates a prompt.
# Suppress for a single turn by including [skip-prior-art] in the prompt.
# Throttled to once per ~5 min per session so it reminds without nagging.

set -uo pipefail

payload="$(cat -)"
CACHE_DIR="${XDG_RUNTIME_DIR:-/tmp}/cue-prior-art-nudge"
mkdir -p "$CACHE_DIR" 2>/dev/null || exit 0

extract() {
  printf '%s' "$payload" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 \
    | sed "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"//; s/\"$//"
}

prompt="$(extract prompt)"
session_id="$(extract session_id)"
[ -z "$prompt" ] && exit 0
[ "${#prompt}" -lt 12 ] && exit 0

prompt_lc="$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')"

# Per-turn suppression.
case "$prompt_lc" in
  *"[skip-prior-art]"*) exit 0 ;;
esac

# Negative guard: don't nudge when the user is already doing prior-art / reuse
# research, or explicitly fetching/learning from a repo.
if printf '%s' "$prompt_lc" | grep -qE \
  'prior.?art|already exist|reinvent|opensrc|learn.?from|reuse|is there (a|an|any) (existing|open)|research first'; then
  exit 0
fi

# Build-intent detection. Match strong "I'm about to write net-new code"
# signals; tolerate a little noise since the block is brief and non-blocking.
if ! printf '%s' "$prompt_lc" | grep -qE \
  "let'?s build|i (want|need|'?d like) to (build|implement|create|write|add|make)|\bimplement(ing)?\b|build (a|an|me a|out) |write (a|an|some) (function|class|module|parser|wrapper|client|service|component|endpoint|cli|script|library|helper|util|feature)|create (a|an) (feature|component|module|service|endpoint|integration|wrapper|system|tool)|add (a|an) (feature|endpoint|integration|command|page|component|module|wrapper)"; then
  exit 0
fi

# Throttle: once per 300s per session.
throttle_file="$CACHE_DIR/throttle.${session_id:-default}"
now_s=$(date +%s)
last_s=$(cat "$throttle_file" 2>/dev/null || echo 0)
if [ $((now_s - last_s)) -lt 300 ]; then exit 0; fi
printf '%s' "$now_s" > "$throttle_file"

printf '💡 Prior-art check (cue): before building this, search for existing open-source solutions so we do not reinvent the wheel.\n'
printf '   Run tools/prior-art: it searches GitHub + package registries, ranks candidates by fit/license/maintenance, and suggests adopt-vs-build.\n'
printf '   Quick start: gh search repos "<what you are building>" --limit 10 --json fullName,description,stargazersCount,license,updatedAt\n'
printf '   Then opensrc path <owner>/<repo> to pull the winner and learn from it. Suppress this turn with [skip-prior-art].\n'

exit 0
