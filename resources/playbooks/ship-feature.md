# Playbook: Ship a Feature

Use when the user says "implement X", "add a new Y", or otherwise asks for a
new capability that touches code. Follow the steps in order — skipping ahead
is how features ship broken.

## 1. Clarify the contract (before any code)

- **Inputs:** what does the user provide?
- **Outputs:** what does success look like, as a checkable property?
- **Edges:** which cases ARE handled, which AREN'T?
- **Acceptance test:** the one assertion that, if passing, proves the feature
  works end-to-end.

If any of these are ambiguous, ask before writing code. One question now
beats three corrections later.

## 2. Find the seam (where the new code goes)

- Read the 2-3 files that already do similar work in this codebase.
- Match the existing style (test layout, error handling, naming) before
  introducing anything new.
- If you have to invent a new pattern, flag it explicitly to the user — don't
  silently diverge.

## 3. Write the failing test first

- A test that fails because the feature doesn't exist yet.
- Run it. Confirm it fails for the right reason (not import error, not typo).
- This is the goalpost. Don't move it as you implement.

## 4. Smallest implementation that turns the test green

- Resist abstraction. Inline first, extract later if a second caller appears.
- Don't add config knobs, optional params, or feature flags that weren't asked for.

## 5. Run the full verification gate

- All tests, not just the new one.
- Lint, typecheck, build — whatever this repo's `make verify` equivalent is.
- For UI work: actually open the page in a browser or capture a screenshot.
- For API work: hit the endpoint with `curl` or the test client.

## 6. Commit and announce

- Conventional commit subject. Body explains the **why** (the user need) more
  than the what (the diff already shows the what).
- Tell the user what shipped in one sentence + how to verify it themselves.

## Anti-patterns to avoid

- Writing the implementation before writing the test.
- "While I'm here, let me also refactor this nearby code."
- Marking the task done before running the verification gate.
- Long PR descriptions that boil down to "added feature X" — that's the title.
