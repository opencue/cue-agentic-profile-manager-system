#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${SOUL_E2E_WORK:-$(mktemp -d "${TMPDIR:-/tmp}/soul-e2e.XXXXXX")}"

export SOUL_E2E_ROOT="$ROOT"
export SOUL_E2E_WORK="$WORK"
export SOUL_E2E_NPX_CACHE="${SOUL_E2E_NPX_CACHE:-$ROOT/profiles/_cache/npx}"
export BUN_INSTALL_CACHE_DIR="${BUN_INSTALL_CACHE_DIR:-$ROOT/profiles/_cache/bun}"
export HOME="$WORK/home"
export NO_COLOR=1

mkdir -p "$HOME" "$SOUL_E2E_NPX_CACHE" "$BUN_INSTALL_CACHE_DIR"

cleanup() {
  if [ "${SOUL_E2E_KEEP_WORK:-0}" != "1" ]; then
    rm -rf "$WORK"
  else
    printf '[e2e] kept work dir: %s\n' "$WORK"
  fi
}
trap cleanup EXIT

printf '[e2e] repo: %s\n' "$ROOT"
printf '[e2e] work: %s\n' "$WORK"
printf '[e2e] HOME: %s\n' "$HOME"

for scenario in "$ROOT"/test/e2e/scenarios/*.sh; do
  printf '\n[e2e] running %s\n' "$(basename "$scenario")"
  bash "$scenario"
done

printf '\n[e2e] all scenarios passed\n'
