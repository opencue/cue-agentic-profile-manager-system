---
name: prompt-caching
description: >-
  Use when user says "prompt caching", "cache prompts", or "reduce LLM cost" and needs AI
  prompt-cache guidance. Covers cache boundaries, invalidation, token savings, and validation.
---
# Prompt Caching

## Source Notes

GitHub/source scan checked public skill patterns from:
- https://github.com/anthropics/skills
- https://github.com/obra/superpowers
- https://github.com/NousResearch/hermes-agent
- https://github.com/microsoft/skills
This local skill is original Soul guidance, not a verbatim import.

## When To Use

Use this skill when the request maps to prompt caching and the outcome benefits from a repeatable workflow, concrete artifacts, and explicit verification.

## Workflow

1. Check current official provider docs before relying on SDK/API details.
2. Define model, latency, cost, privacy, and eval constraints.
3. Design the smallest integration surface with clear failure handling.
4. Add regression tests, fixtures, or eval cases for prompt/API behavior.
5. Document migration notes, limits, and operational runbook items.

## Output Contract

- Start with the recommended action or artifact.
- Include only the context needed to justify the recommendation.
- Provide next steps, validation, or measurement details.
- For code or workflow changes, include touched files/commands and verification evidence.

## Guardrails

- Do not invent facts, metrics, or source claims.
- Prefer specific artifacts over generic advice.
- State assumptions and unresolved risks explicitly.
- Treat model names, pricing, SDK methods, and API capabilities as drift-prone; verify against official docs.
