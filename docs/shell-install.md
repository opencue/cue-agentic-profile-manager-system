# cue shell install

`cue shell install` drops two shim scripts into `~/.local/bin/`:

```
~/.local/bin/claude   →   exec cue launch claude "$@"
~/.local/bin/codex    →   exec cue launch codex  "$@"
```

From then on every `claude` and `codex` invocation on your PATH goes through
cue's resolve → materialize → exec flow.

## PATH ordering

`~/.local/bin` must appear **before** the directories containing the real
`claude` and `codex` binaries. If it doesn't, `cue shell install` refuses to
write the shims and prints the fix:

```
cue shell install: ~/.local/bin must appear earlier in PATH than the real claude/codex.
Add this to your shell rc and re-run:
  export PATH="$HOME/.local/bin:$PATH"
```

Add that line to `~/.bashrc`, `~/.zshrc`, or equivalent, open a new terminal,
then re-run `cue shell install`.

## Verify

```bash
which claude   # should print /home/<you>/.local/bin/claude
which codex    # should print /home/<you>/.local/bin/codex
```

Run `cue launch claude --dry-run` in any directory that has a `.cue.profile` to
confirm the full resolve → materialize path works without launching an actual
Claude session.

## Uninstall

```bash
cue shell uninstall
```

Removes `~/.local/bin/claude` and `~/.local/bin/codex`. The `~/.local/bin`
directory itself is left in place. After uninstall, `claude` and `codex` resolve
to the real binaries again.

## Bypass paths

You can bypass the shims without uninstalling:

| Method | How |
|---|---|
| Skip cue entirely | `CUE_BYPASS=1 claude <args>` |
| Force a specific profile | `claude --cue-profile <name> <args>` |
| Always open the picker | `claude --cue-pick <args>` |
| Bypass via absolute path | `/usr/local/bin/claude <args>` (or wherever the real binary lives) |

`CUE_BYPASS=1` makes cue exec the real binary directly without touching the
profile, materializer, or config dir. Use it when you need a raw claude session
for debugging.
