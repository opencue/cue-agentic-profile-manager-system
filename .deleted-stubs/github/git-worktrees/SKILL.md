---
name: git-worktrees
description: >-
  Use when user says "create a worktree", "resume the worktree",
  "clean up worktrees", "agent sandbox", or needs branch isolation,
  multi-worktree safety, or worktree state reasoning.
---
# Git Worktrees

## Source Notes

GitHub/source scan checked public skill patterns from:
- https://github.com/anthropics/skills
- https://github.com/obra/superpowers
- https://github.com/NousResearch/hermes-agent
- https://github.com/microsoft/skills
This local skill is original Soul guidance, not a verbatim import.

## When To Use

Use this skill when the request maps to git worktrees and the outcome benefits from a repeatable workflow, concrete artifacts, and explicit verification.

## Workflow

1. Inspect branch, worktree, remotes, dirty files, and current PR state first.
2. Keep base checkouts clean and use isolated branches/worktrees for edits.
3. Commit only intended files with a message that captures why.
4. Push, open/update PR, verify checks, merge, and clean up stale refs/worktrees.
5. Report PR URL, merge state, cleanup evidence, and any residual dirty files.

## Output Contract

- Start with the recommended action or artifact.
- Include only the context needed to justify the recommendation.
- Provide next steps, validation, or measurement details.
- For code or workflow changes, include touched files/commands and verification evidence.

## Guardrails

- Do not invent facts, metrics, or source claims.
- Prefer specific artifacts over generic advice.
- State assumptions and unresolved risks explicitly.
- Do not overwrite unrelated work or skip cleanup evidence.
