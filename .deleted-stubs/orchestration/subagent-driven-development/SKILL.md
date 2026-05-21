---
name: subagent-driven-development
description: >-
  Use when user says "use subagents", "delegate work", or "subagent development" and needs
  bounded native subagent guidance. Covers slicing, prompts, integration, and validation.
---
# Subagent-Driven Development

## Source Notes

GitHub/source scan checked public skill patterns from:
- https://github.com/anthropics/skills
- https://github.com/obra/superpowers
- https://github.com/NousResearch/hermes-agent
- https://github.com/microsoft/skills
This local skill is original Soul guidance, not a verbatim import.

## When To Use

Use this skill when the request maps to subagent-driven development and the outcome benefits from a repeatable workflow, concrete artifacts, and explicit verification.

## Workflow

1. Split work only when lanes are independent, bounded, and verifiable.
2. Assign ownership by files, artifacts, and acceptance criteria.
3. Keep one integrator responsible for conflicts, review, and final truth.
4. Run verification per lane and again after integration.
5. Close with merged state, handoff notes, and cleanup evidence.

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
