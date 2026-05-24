#!/usr/bin/env bash
# Stop-hook runner: executes every script under <runtime>/quality-gates/
# sequentially. If any gate exits non-zero, this script exits 2 — vetoing the
# Stop and signalling to Claude that work isn't actually done.
#
# Profiles opt in by adding `qualityGates: [tests-pass.sh, ...]` to profile.yaml.
# The materializer symlinks those scripts into <runtime>/quality-gates/.
set -uo pipefail

GATE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/quality-gates"

if [[ ! -d "$GATE_DIR" ]]; then
  # No gates declared for this profile — nothing to enforce.
  exit 0
fi

shopt -s nullglob
gates=("$GATE_DIR"/*)
shopt -u nullglob

if [[ ${#gates[@]} -eq 0 ]]; then exit 0; fi

failed=()
for gate in "${gates[@]}"; do
  [[ -x "$gate" || "$gate" == *.sh ]] || continue
  name="$(basename "$gate")"
  if ! bash "$gate"; then
    failed+=("$name")
  fi
done

if [[ ${#failed[@]} -gt 0 ]]; then
  >&2 echo ""
  >&2 echo "cue:quality-gates BLOCKED Stop — these gates failed:"
  for f in "${failed[@]}"; do >&2 echo "  ✗ $f"; done
  >&2 echo ""
  >&2 echo "Fix them, then end the session normally."
  exit 2
fi

exit 0
