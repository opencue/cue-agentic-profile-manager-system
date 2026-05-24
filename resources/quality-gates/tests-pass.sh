#!/usr/bin/env bash
# Quality gate: tests must pass before the session can claim done.
#
# Auto-detects the project's test runner and runs it. Exits 0 if no test runner
# is found (so non-code sessions don't block on a missing harness).
#
# Wired in via the cue-quality-gates Stop hook (resources/hooks/cue-quality-gates.json).
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Skip the gate if there's nothing test-shaped in the project.
if [[ ! -f package.json && ! -f pyproject.toml && ! -f Cargo.toml && ! -f go.mod ]]; then
  exit 0
fi

# Each runner. First matching one wins.
if [[ -f bun.lockb || -f bun.lock ]] && command -v bun >/dev/null; then
  >&2 echo "[quality-gate:tests-pass] running bun test..."
  bun test --bail >&2 || { >&2 echo "[quality-gate:tests-pass] BLOCKED: bun test failed"; exit 2; }
elif [[ -f package.json ]] && command -v npm >/dev/null; then
  if grep -q '"test"' package.json; then
    >&2 echo "[quality-gate:tests-pass] running npm test..."
    npm test --silent >&2 || { >&2 echo "[quality-gate:tests-pass] BLOCKED: npm test failed"; exit 2; }
  fi
elif [[ -f pyproject.toml ]] && command -v pytest >/dev/null; then
  >&2 echo "[quality-gate:tests-pass] running pytest..."
  pytest -x --tb=short >&2 || { >&2 echo "[quality-gate:tests-pass] BLOCKED: pytest failed"; exit 2; }
elif [[ -f Cargo.toml ]] && command -v cargo >/dev/null; then
  >&2 echo "[quality-gate:tests-pass] running cargo test..."
  cargo test --quiet >&2 || { >&2 echo "[quality-gate:tests-pass] BLOCKED: cargo test failed"; exit 2; }
elif [[ -f go.mod ]] && command -v go >/dev/null; then
  >&2 echo "[quality-gate:tests-pass] running go test..."
  go test ./... >&2 || { >&2 echo "[quality-gate:tests-pass] BLOCKED: go test failed"; exit 2; }
fi

exit 0
