---
description: Switch the cwd to a specific cue profile (no picker)
arguments:
  - name: profile
    description: Profile name (or list number from /cue current)
---

Validate that `{{profile}}` matches a name returned by `cue list --json`. If valid, write it to `./.cue.profile`. If not, surface the error and suggest `/cue` to pick from a list.
