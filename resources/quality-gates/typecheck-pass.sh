#!/usr/bin/env bash
# Quality gate: typechecker must pass before the session can claim done.
#
# Auto-detects the project's typechecker and runs it. Exits 0 if no
# typechecker is found (so non-typed projects don't block on a missing
# harness). Runs CHECK-only flags — never modifies source.
#
# Wired in via the cue-quality-gates Stop hook (auto-injected when the
# active profile declares `qualityGates`).
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# TypeScript via tsc (works for any package.json with a tsconfig.json).
if [[ -f tsconfig.json ]] && command -v bunx >/dev/null 2>&1; then
  >&2 echo "[quality-gate:typecheck-pass] running tsc --noEmit..."
  bunx tsc --noEmit >&2 || {
    >&2 echo "[quality-gate:typecheck-pass] BLOCKED: tsc reported errors"
    exit 2
  }
  exit 0
fi
if [[ -f tsconfig.json ]] && command -v npx >/dev/null 2>&1; then
  >&2 echo "[quality-gate:typecheck-pass] running tsc --noEmit (via npx)..."
  npx --no-install tsc --noEmit >&2 || {
    >&2 echo "[quality-gate:typecheck-pass] BLOCKED: tsc reported errors"
    exit 2
  }
  exit 0
fi

# Python via mypy or pyright if either is configured.
if [[ -f pyproject.toml || -f mypy.ini || -f setup.cfg ]] && command -v mypy >/dev/null 2>&1; then
  >&2 echo "[quality-gate:typecheck-pass] running mypy..."
  mypy . >&2 || {
    >&2 echo "[quality-gate:typecheck-pass] BLOCKED: mypy reported errors"
    exit 2
  }
  exit 0
fi
if [[ -f pyrightconfig.json ]] && command -v pyright >/dev/null 2>&1; then
  >&2 echo "[quality-gate:typecheck-pass] running pyright..."
  pyright >&2 || {
    >&2 echo "[quality-gate:typecheck-pass] BLOCKED: pyright reported errors"
    exit 2
  }
  exit 0
fi

# Rust: cargo check (cheaper than cargo test; catches type errors).
if [[ -f Cargo.toml ]] && command -v cargo >/dev/null 2>&1; then
  >&2 echo "[quality-gate:typecheck-pass] running cargo check..."
  cargo check --quiet >&2 || {
    >&2 echo "[quality-gate:typecheck-pass] BLOCKED: cargo check failed"
    exit 2
  }
  exit 0
fi

# Go: build all packages (no test execution).
if [[ -f go.mod ]] && command -v go >/dev/null 2>&1; then
  >&2 echo "[quality-gate:typecheck-pass] running go build ./..."
  go build ./... >&2 || {
    >&2 echo "[quality-gate:typecheck-pass] BLOCKED: go build failed"
    exit 2
  }
  exit 0
fi

# Nothing detected — skip cleanly.
exit 0
