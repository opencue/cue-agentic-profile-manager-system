#!/usr/bin/env bash
# Quality gate: warn if the working tree has un-tracked files that the
# session created but never staged. Does NOT block on modified-but-staged
# files (that's normal mid-PR work). Blocks only when the working tree has
# files Claude generated that are still untracked AND aren't in .gitignore.
#
# Rationale: the most common "done but actually not" mode is a stray file
# the agent wrote and forgot about. Modified files are visible; untracked
# files are easy to miss until git status surprises someone later.
#
# Skipped cleanly when:
#   - cwd isn't a git repo
#   - the user hasn't enabled this gate
#
# Set CUE_GIT_CLEAN_ALLOW="<glob> <glob>..." to whitelist patterns (e.g.
# .env or tmp/) that legitimately shouldn't be staged.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# `--others --exclude-standard` lists only untracked-but-not-ignored files.
mapfile -t untracked < <(git ls-files --others --exclude-standard 2>/dev/null)

if [[ ${#untracked[@]} -eq 0 ]]; then
  exit 0
fi

# Apply optional whitelist.
allow="${CUE_GIT_CLEAN_ALLOW:-}"
if [[ -n "$allow" ]]; then
  filtered=()
  for f in "${untracked[@]}"; do
    keep=1
    for pat in $allow; do
      case "$f" in
        $pat) keep=0; break ;;
      esac
    done
    [[ $keep -eq 1 ]] && filtered+=("$f")
  done
  untracked=("${filtered[@]}")
fi

if [[ ${#untracked[@]} -eq 0 ]]; then
  exit 0
fi

>&2 echo "[quality-gate:git-clean] BLOCKED: ${#untracked[@]} untracked file(s) — stage or ignore them:"
for f in "${untracked[@]}"; do >&2 echo "  ?? $f"; done
>&2 echo ""
>&2 echo "To whitelist patterns: CUE_GIT_CLEAN_ALLOW=\"tmp/* *.log\" cue ..."
exit 2
