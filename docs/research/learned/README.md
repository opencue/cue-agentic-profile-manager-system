# Learned from other codebases

Findings from studying external repos through the cue lens ("what can cue
adopt?"). Written by the [`learn-from-repo`](../../../resources/skills/skills/tools/learn-from-repo/SKILL.md)
skill. Each row links to a full note; the verdict says whether cue should act.

Verdicts: **adopt** (port it), **spike** (prototype first), **note-only**
(no change — cue already does this, or it doesn't fit).

| Repo | Date | Question | Verdict |
|---|---|---|---|
| [vercel-labs/opensrc](./vercel-labs-opensrc.md) | 2026-05-31 | How does it cache fetched source; could cue's runtime reuse it? | note-only (cue already does it better via sha256 content-hash) |
