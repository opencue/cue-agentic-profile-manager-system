---
description: Enable cue's scout mode — block reads/greps into generated and dependency dirs (node_modules, dist, build, target, .venv, etc.) so the agent scouts source, not vendored output.
---

# /scout — read-scope guard (opt-in)

Reading or grepping `node_modules`, `dist`, build output, or other generated
trees burns context for zero value. `/scout` makes the `scout-block` hook
refuse `Read`, `Grep`, and `Glob` calls that target those directories, so the
model stays on the real source.

## Activate

```bash
mkdir -p ~/.config/cue
touch ~/.config/cue/scout-block
echo "cue: scout mode active. To turn off: rm ~/.config/cue/scout-block"
```

## What it blocks

`Read` / `Grep` / `Glob` whose path is inside any of:

`node_modules`, `.next`, `.nuxt`, `.svelte-kit`, `.output`, `dist`, `build`,
`out`, `target`, `.venv`, `venv`, `__pycache__`, `.cache`, `.turbo`,
`.gradle`, `coverage`, `vendor`, `bower_components`, `Pods`, `DerivedData`,
`.terraform`.

The block reason is printed to stderr; the model picks a source path instead.

## Read a blocked path anyway

Add a path substring to `CUE_SCOUT_ALLOW` (space-separated) for that call:

```bash
CUE_SCOUT_ALLOW="node_modules/some-pkg/src"
```

Bash commands are not gated by this hook (use `/careful` for destructive-shell
guarding). Scout only covers the file-reading tools.

## Deactivate

```bash
rm ~/.config/cue/scout-block
```

## When to use

- Large repos where the agent keeps wandering into `node_modules` / build output
- Long sessions where context budget matters
- Pair with `/careful` (destructive shell) and `/freeze` (edit scope) for a full guard set
