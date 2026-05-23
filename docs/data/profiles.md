# The 16 profiles cue ships

Mirror of the `profiles-grid.svg` in the README. Each profile is a directory under [`profiles/`](../../profiles/) with a `profile.yaml` that declares its skills, MCPs, plugins, and inheritance chain.

| Profile | Domain |
|---|---|
| `core` | Baseline shared by every profile — claude-mem, caveman, RTK, gbrain. |
| `backend` | APIs, webhooks, security review, CI, packaging, databases. |
| `frontend` | UI implementation, redesign, screenshots, browser testing. |
| `marketing` | Copywriting, SEO, CRO, growth, channels, brand. |
| `medusa-dev` | Medusa v2 backend, storefront, admin, migration, shop setup. |
| `cybersecurity` | 754 cybersecurity skills (red/blue team, forensics, DFIR). |
| `nvidia` | NVIDIA cuOpt: routing, LP/MILP, GPU-accelerated optimization. |
| `creative-media` | Image, video, product asset, brand, visual generation. |
| `docs-writer` | Documentation, Markdown, PDF, Obsidian, structured writing. |
| `readme-writer` | Beautiful README design with SVG diagrams. |
| `caveman-quick` | Fast low-context edits, summaries, reviews, notes, commits. |
| `coolify` | Coolify deploys, server config, app env vars, CI. |
| `hostinger` | Hostinger DNS, domain, VPS, hosting management. |
| `fleet-control` | Multi-agent orchestration, Colony coordination, OMX flows. |
| `full` | Diagnostic fallback — loads every local skill and MCP. |
| `setup` | Per-OS install assistant (used by `setup/<os>.md`). |

Commands:

```bash
cue list                      # show all profiles
cue use <name>                # pin to current directory (writes .cue-profile)
cue use <name> --global       # set as global default
cue switch <name>             # one-shot launch with this profile
```

Inheritance: a profile's `profile.yaml` can declare `extends: <parent>`. Resolved at materialize time; children override parent keys cleanly. The full chain is always rooted at `core`.
