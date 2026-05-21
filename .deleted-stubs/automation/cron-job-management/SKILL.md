---
name: cron-job-management
description: >-
  Use when user says "cron job", "schedule this", or "recurring task" and needs cron
  automation guidance. Covers job creation, environment setup, logging, reliability, and
  verification.
---
# Cron Job Management

## Source Notes

GitHub/source scan checked public skill patterns from:
- https://github.com/anthropics/skills
- https://github.com/obra/superpowers
- https://github.com/NousResearch/hermes-agent
- https://github.com/microsoft/skills
This local skill is original Soul guidance, not a verbatim import.

## When To Use

Use this skill when the request maps to cron job management and the outcome benefits from a repeatable workflow, concrete artifacts, and explicit verification.

## Workflow

1. Identify trigger, schedule, owner, idempotency needs, and failure notification path.
2. Inspect existing jobs before adding a new scheduler.
3. Prefer simple, observable automation with logs and dry-run mode.
4. Add validation for environment, credentials, locking, and retries.
5. Verify by running the job manually or simulating the schedule.

## Output Contract

- Start with the recommended action or artifact.
- Include only the context needed to justify the recommendation.
- Provide next steps, validation, or measurement details.
- For code or workflow changes, include touched files/commands and verification evidence.

## Guardrails

- Do not invent facts, metrics, or source claims.
- Prefer specific artifacts over generic advice.
- State assumptions and unresolved risks explicitly.
