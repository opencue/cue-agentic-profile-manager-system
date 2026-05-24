---
description: Run the standard Rust quality gates — fmt --check, clippy -D warnings, nextest, audit. Read-only; no fixes.
---

# /rust-preflight

Run every standard quality gate against the working tree and report results. **Read-only** — does not modify code, does not commit, does not push.

For *fixing* build errors → use `/rust-build`. For deeper review → `/rust-review`.

## What this runs

In order, stopping on first failure unless `--all` is passed:

1. **`cargo fmt --check`** — formatting drift
2. **`cargo clippy --all-targets --all-features -- -D warnings`** — lints as errors
3. **`cargo nextest run`** (falls back to `cargo test` if nextest absent) — unit + integration tests
4. **`cargo test --doc`** — doctests (nextest doesn't run these)
5. **`cargo audit`** (skipped with a note if not installed) — RustSec advisories

## Flags

- `--all` — run every check even after a failure (default: stop on first fail)
- `--release` — run tests in release mode
- `--workspace` — apply to every workspace member (default: current crate)

## Output

Compact summary at the end:

```
fmt:    ✓
clippy: ✗ (3 warnings)
tests:  ✓ (87 passed, 0 failed)
doc:    ✓ (12 doctests)
audit:  ⚠ (skipped — cargo-audit not installed)
```

Exit codes match `cargo`'s — non-zero on any failure so this is safe in CI scripts.

## Notes

- For a tighter inner loop while coding, prefer `bacon` (TUI auto-rerun) — this command is for the end-of-task / pre-commit checkpoint.
- If a hook (e.g. `commit-message-guard`) is what triggered the failure, fix the message rather than disabling the hook.
- `cargo audit` checks `Cargo.lock` against the RustSec advisory DB — advisories drop continuously, so a passing run yesterday isn't a guarantee today.
