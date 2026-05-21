---
name: frontend-design
description: >-
  Use when user says "frontend design", "build the UI", or "redesign this page" and needs
  application UI guidance. Covers layout, components, interactions, responsiveness, and
  verification.
---
# Frontend Design

## Source Notes

GitHub/source scan checked public skill patterns from:
- https://github.com/anthropics/skills
- https://github.com/obra/superpowers
- https://github.com/NousResearch/hermes-agent
- https://github.com/microsoft/skills
This local skill is original Soul guidance, not a verbatim import.

## When To Use

Use this skill when the request maps to frontend design and the outcome benefits from a repeatable workflow, concrete artifacts, and explicit verification.

## Workflow

1. Identify product type, user intent, brand constraints, and design system surface.
2. Audit existing patterns before introducing new visual language.
3. Design complete states: default, empty, loading, error, disabled, hover/focus, mobile.
4. Implement or specify accessible, responsive, production-ready details.
5. Verify with screenshots, contrast, interaction checks, or component tests when applicable.

## Output Contract

- Start with the recommended action or artifact.
- Include only the context needed to justify the recommendation.
- Provide next steps, validation, or measurement details.
- For code or workflow changes, include touched files/commands and verification evidence.

## Guardrails

- Do not invent facts, metrics, or source claims.
- Prefer specific artifacts over generic advice.
- State assumptions and unresolved risks explicitly.
