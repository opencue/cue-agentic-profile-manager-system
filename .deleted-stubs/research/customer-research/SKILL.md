---
name: customer-research
description: >-
  Use when user says "customer research", "user interviews", or "customer insights" and needs
  research guidance. Covers segments, questions, synthesis, findings, and decisions.
---
# Customer Research

## Source Notes

GitHub/source scan checked public skill patterns from:
- https://github.com/anthropics/skills
- https://github.com/obra/superpowers
- https://github.com/NousResearch/hermes-agent
- https://github.com/microsoft/skills
This local skill is original Soul guidance, not a verbatim import.

## When To Use

Use this skill when the request maps to customer research and the outcome benefits from a repeatable workflow, concrete artifacts, and explicit verification.

## Workflow

1. Frame the decision the research must support.
2. Gather evidence from local files, customer inputs, competitors, or web sources as needed.
3. Separate observations from interpretation and rank confidence.
4. Synthesize into options, risks, and recommended next actions.
5. Preserve citations, quotes, or source links when evidence matters.

## Output Contract

- Start with the recommended action or artifact.
- Include only the context needed to justify the recommendation.
- Provide next steps, validation, or measurement details.
- For code or workflow changes, include touched files/commands and verification evidence.

## Guardrails

- Do not invent facts, metrics, or source claims.
- Prefer specific artifacts over generic advice.
- State assumptions and unresolved risks explicitly.
