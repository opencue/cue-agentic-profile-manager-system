# Playbook: Triage a Bug

Use when the user reports something broken ("X doesn't work", "Y returns the
wrong value", "Z crashes"). Bug triage is investigation FIRST, fix LAST.

## 1. Reproduce before theorizing

- Get the exact command, input, and observed output from the user. If any
  piece is missing, ask before guessing.
- Run it yourself. If you can't reproduce, the bug isn't where you think it is
  — it's in the user's environment, your assumptions, or the report itself.
- If reproduction needs special setup, write down the exact steps before doing
  anything else. You'll need them again when verifying the fix.

## 2. Write the failing test

- A regression test that captures the bug as an assertion.
- The test must fail TODAY (proving the bug exists) and pass after the fix
  (proving the fix worked + the bug stays fixed).
- If the bug doesn't have a natural test boundary, that's a code-smell — note
  it but don't fix it in the same change.

## 3. Bisect to the smallest reproduction

- Can you shrink the input that triggers it?
- Can you find the commit that introduced it (`git bisect`)?
- The smaller the repro, the faster the diagnosis.

## 4. Find the root cause, not the proximate cause

- "Variable was undefined" is a proximate cause. Why was it undefined?
- "Function returned null" is a proximate cause. Why did it return null?
- Keep asking "why" until the answer is a design decision, not another bug.
- Document the root cause in the commit message.

## 5. Fix the root cause, not the symptom

- Adding a null-check is usually NOT the fix. The bug is the thing that
  produced the null in the first place.
- If the proper fix is too large for this PR, write the surface-level fix AND
  open an issue describing the root cause for later.

## 6. Verify the regression test passes + nothing else broke

- Run the new test. It passes.
- Run the full suite. Nothing regressed.
- Reproduce the original user scenario manually. Confirm it now works.

## 7. Tell the user

- One sentence: what the bug was, what the fix changes, how they can verify.
- If the root cause exposes a class of bugs, mention that — they may want to
  audit similar code.

## Anti-patterns to avoid

- Adding a try/catch around the symptom and moving on.
- "I think the fix is X" without reproducing the bug first.
- Skipping the regression test because "the fix is obvious".
- Closing the report without explaining the root cause.
