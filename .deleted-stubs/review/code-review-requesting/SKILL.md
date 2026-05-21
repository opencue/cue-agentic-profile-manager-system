---
name: code-review-requesting
description: >-
  Use when user says "request review", "ask for code review", or "prepare PR review" and needs
  review-request guidance. Covers context, scope, risk, checklist, and reviewer notes.
---
# Code Review Requesting

## Source Notes

GitHub/source scan checked public skill patterns from:
- https://github.com/anthropics/skills
- https://github.com/obra/superpowers
- https://github.com/NousResearch/hermes-agent
- https://github.com/microsoft/skills
This local skill is original Soul guidance, not a verbatim import.

## When To Use

Use this skill when the request maps to code review requesting and the outcome benefits from a repeatable workflow, concrete artifacts, and explicit verification.

## Workflow

1. Define the concrete outcome, constraints, and stop condition.
2. Inspect the smallest relevant surface before changing anything.
3. Create or update tests/checklists before risky edits when behavior is not protected.
4. Make the smallest coherent change and preserve existing patterns.
5. Verify with targeted commands and report evidence before completion.

## Output Contract

- Start with the recommended action or artifact.
- Include only the context needed to justify the recommendation.
- Provide next steps, validation, or measurement details.
- For code or workflow changes, include touched files/commands and verification evidence.

## Guardrails

- Do not invent facts, metrics, or source claims.
- Prefer specific artifacts over generic advice.
- State assumptions and unresolved risks explicitly.
