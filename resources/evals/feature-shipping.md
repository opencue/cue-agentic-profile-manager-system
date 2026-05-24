---
name: feature-shipping
description: Profile should be able to ship a small feature end-to-end (write test, implement, verify, commit)
---

# Required capabilities

## Skills
- meta/analyze              # to read the codebase before changing it

## Commands (one of these)
- code-review
- checkpoint

## Playbooks (recommended)
- ship-feature              # the canonical protocol for this task type

## Quality gates (recommended)
- tests-pass.sh             # tests must pass before claiming done

## Trigger phrases the profile should handle
- "ship a new feature"
- "implement X"
- "add a Y to this repo"

# Scoring
- 1 point per required skill present
- 1 point per recommended item present (playbooks, gates)
- 2 points if all trigger phrases are covered by some skill description
- Pass threshold: ≥ 50% of max possible
