#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"
ensure_temp_home

repo="$(fresh_repo 02-use-per-dir)"
install_deps "$repo"
require_profile "$repo" "medusa-dev"

soul "$repo" use medusa-dev

workspace="$repo/profiles/medusa-dev/workspace"
assert_dir "$workspace"
assert_file "$workspace/.mcp.json"
assert_file "$workspace/CLAUDE.md"
assert_file "$workspace/AGENTS.md"
assert_symlink_tree_ok "$workspace/.claude/skills"

(
  cd "$workspace"
  [ -d ".claude/skills" ] || fail "workspace cd lost .claude/skills"
)

log "medusa-dev materializes as a per-directory workspace"
