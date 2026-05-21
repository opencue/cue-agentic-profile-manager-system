---
description: Restart claude under the currently pinned cue profile
---

Run `exec ~/.local/bin/claude` via Bash. This replaces the current claude process with a fresh one that resolves the current `.cue-profile`. The user's transcript is preserved.

If `~/.local/bin/claude` does not exist, instead print: "shim not installed; run `cue shell install` in a terminal first."
