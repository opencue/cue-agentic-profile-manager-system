---
name: technical-writing
description: >-
  Use when user says "technical writing", "write docs", or "explain the system" and needs
  technical documentation. Covers audience, structure, accuracy, examples, and review.
---
# Technical Writing

## Source Notes

GitHub/source scan checked public skill patterns from:
- https://github.com/anthropics/skills
- https://github.com/obra/superpowers
- https://github.com/NousResearch/hermes-agent
- https://github.com/microsoft/skills
This local skill is original Soul guidance, not a verbatim import.

## When To Use

Use this skill when the request maps to technical writing and the outcome benefits from a repeatable workflow, concrete artifacts, and explicit verification.

## Workflow

1. Clarify audience, job-to-be-done, tone, medium, and required length.
2. Extract the core promise, proof, objections, and conversion action.
3. Draft or edit with a concrete structure instead of generic advice.
4. Tighten language for specificity, scanability, and voice consistency.
5. Return final copy plus any assumptions or test variants.

## Output Contract

- Start with the recommended action or artifact.
- Include only the context needed to justify the recommendation.
- Provide next steps, validation, or measurement details.
- For code or workflow changes, include touched files/commands and verification evidence.

## Guardrails

- Do not invent facts, metrics, or source claims.
- Prefer specific artifacts over generic advice.
- State assumptions and unresolved risks explicitly.
