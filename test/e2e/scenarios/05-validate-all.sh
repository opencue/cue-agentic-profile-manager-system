#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"
ensure_temp_home

repo="$(fresh_repo 05-validate-all)"
install_deps "$repo"

soul "$repo" validate --all

log "all shipped profiles validate"
