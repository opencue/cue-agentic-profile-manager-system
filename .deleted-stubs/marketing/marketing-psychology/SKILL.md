---
name: marketing-psychology
description: >-
  Use when user says "marketing psychology", "marketing psychology help", or "use
  marketing-psychology" and needs the marketing psychology skill for marketing work. Covers
  the existing workflow, guardrails, validation, and handoff guidance in this SKILL.md.
---
# Marketing Psychology

## Source Notes

GitHub/source scan checked public skill patterns from:
- https://github.com/anthropics/skills
- https://github.com/obra/superpowers
- https://github.com/NousResearch/hermes-agent
- https://github.com/microsoft/skills
This local skill is original Soul guidance, not a verbatim import.

## When To Use

Use this skill when the request maps to marketing psychology and the outcome benefits from a repeatable workflow, concrete artifacts, and explicit verification.

## Workflow

1. Define audience, offer, funnel stage, channel, and measurable outcome.
2. Inspect the current asset or market context before proposing changes.
3. Produce 3-5 ranked recommendations or variants with rationale.
4. Specify instrumentation, success metrics, and the smallest useful test.
5. Call out legal, platform-policy, tracking, or deliverability risks.

## Output Contract

- Start with the recommended action or artifact.
- Include only the context needed to justify the recommendation.
- Provide next steps, validation, or measurement details.
- For code or workflow changes, include touched files/commands and verification evidence.

## Guardrails

- Do not invent facts, metrics, or source claims.
- Prefer specific artifacts over generic advice.
- State assumptions and unresolved risks explicitly.
- Do not suggest deceptive urgency, dark patterns, or non-compliant tracking.
