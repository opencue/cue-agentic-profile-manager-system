#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"
ensure_temp_home

repo="$(fresh_repo 03-scan-and-new)"
install_deps "$repo"

soul "$repo" scan > "$SOUL_E2E_WORK/03-scan.txt"
soul "$repo" new test-gen --from-scan --auto

assert_file "$repo/profiles/test-gen/profile.yaml"
soul "$repo" validate test-gen

log "scan succeeds and generated profile validates"
