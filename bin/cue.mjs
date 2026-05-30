#!/usr/bin/env node
/**
 * cue — node launcher for the published npm package.
 *
 * Sets CUE_REPO_ROOT to the package root so the bundled CLI resolves its
 * profiles/, resources/, and skills regardless of where npm installed it
 * (the bundle may carry build-machine paths; the env override wins), then
 * runs the prebuilt node bundle.
 *
 * The repo's own dev/shim path uses bin/cue (bash → bun src), not this file.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.CUE_REPO_ROOT) process.env.CUE_REPO_ROOT = pkgRoot;

const bundle = resolve(pkgRoot, "dist", "cue.js");
if (!existsSync(bundle)) {
  process.stderr.write(
    "cue: dist/cue.js missing. Run `bun run build:bundle` (maintainers) or reinstall the package.\n",
  );
  process.exit(2);
}

await import(bundle);
