# full

Full is a diagnostic / fallback only profile. It is intentionally expensive because it loads every local skill via the `*/*` local glob and all known MCPs; expect about 20k extra context tokens per session compared with a lean profile.

## Skills

- `*/*` local glob

## MCPs

- `claude-mem`
- `Higgsfield`
- `colony`
- `coolify`
- `drawio`
- `gbrain`
- `hostinger-api`
- `letsfg`
- `marva-blog`
- `medusadocs`
- `obsidian-vault`
- `polymarket-live`
- `recodee`
- `ruflo`
- `soul-skills`

## Sample Tasks

- Diagnose a missing profile capability.
- Run a fallback session when the right lean profile is unclear.
- Inspect whether a skill or MCP should be moved into a lean profile.
