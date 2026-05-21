---
description: List cue profiles and pick one to switch the current cwd to
---

Run `cue list --json` via Bash to enumerate profiles, then present them as a numbered markdown list to the user. After the user replies with a number or name, write the chosen name to `./.cue-profile` with `printf '%s\n' <name> > ./.cue-profile`. Verify the profile name matches one returned by `cue list --json` before writing — reject typos. Finish by printing the line: "Profile pinned. Run `/cue reload` to apply, or restart claude."
