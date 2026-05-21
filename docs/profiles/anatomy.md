# Anatomy of a profile

This page walks the shipped `medusa-dev` profile field by field, then shows
how it inherits the always-on `core` baseline. For the complete schema
contract, see [`../../profiles/SCHEMA.md`](../../profiles/SCHEMA.md).

## `profiles/medusa-dev/profile.yaml`

`medusa-dev` is the working profile for Medusa v2 backend, storefront, admin,
migration, and shop setup tasks. It stays below the normal warning threshold
while still covering the common shop-build loop.

```yaml
name: medusa-dev
description: Medusa v2 backend, storefront, admin, migration, and shop setup work
inherits: core
skills:
  local:
    - medusa/medusa-reference
    - medusa/building-with-medusa
    - medusa/building-storefronts
    - medusa/storefront-best-practices
    - medusa/building-admin-dashboard-customizations
    - medusa/creating-internal-agents
    - medusa/db-generate
    - medusa/db-migrate
    - medusa/new-user
    - medusa/new-admin-via-api
    - medusa/medusa-shop-setup
    - medusa/woocommerce-to-medusa-import
mcps:
  - medusadocs
  - coolify
```

### Fields

`name` must match the directory name exactly. The loader rejects a mismatch
between `profiles/medusa-dev/` and `name: medusa-dev`.

`description` is the short human label shown by `soul list` and stamped into
the generated workspace docs.

`inherits: core` means `medusa-dev` starts with the shared baseline, then adds
Medusa-specific skills and MCPs. Parent entries resolve before child entries.

`agents` is omitted, so the schema default applies: the materializer prepares
both Claude Code and Codex surfaces.

`skills.local` is the profile's local skill bundle. Each value maps to
`skills/skills/<category>/<slug>/SKILL.md`; for example,
`medusa/building-with-medusa` resolves to
`skills/skills/medusa/building-with-medusa/SKILL.md`.

`mcps` lists MCP server ids from the sanitized registries under
`mcps/configs/`. `medusadocs` gives the profile local Medusa docs lookup;
`coolify` covers the deploy-control path used by Medusa shops.

`env` is omitted. If a future profile adds it, values are copied into the
materialized workspace environment as plain strings; do not put secrets in
profile YAML.

## Inheritance Chain

`soul validate medusa-dev` should report this chain:

```text
core -> medusa-dev
```

`core` owns the low-friction defaults every profile can share:

```yaml
name: core
description: Baseline profile for every lean Soul install profile
skills:
  local:
    - meta/analyze
    - meta/just
    - meta/skill-suggestion
    - caveman/caveman
    - caveman/caveman-commit
mcps:
  - claude-mem
```

`medusa-dev` inherits those first, then appends its Medusa-specific skills and
MCPs.

The resolved profile behaves like this:

```yaml
name: medusa-dev
description: Medusa v2 backend, storefront, admin, migration, and shop setup work
skills:
  local:
    - meta/analyze
    - meta/just
    - meta/skill-suggestion
    - caveman/caveman
    - caveman/caveman-commit
    - medusa/medusa-reference
    - medusa/building-with-medusa
    - medusa/building-storefronts
    - medusa/storefront-best-practices
    - medusa/building-admin-dashboard-customizations
    - medusa/creating-internal-agents
    - medusa/db-generate
    - medusa/db-migrate
    - medusa/new-user
    - medusa/new-admin-via-api
    - medusa/medusa-shop-setup
    - medusa/woocommerce-to-medusa-import
mcps:
  - claude-mem
  - medusadocs
  - coolify
```

Arrays merge parent-first with duplicates removed, so a child can include a
core skill without creating two symlinks. Scalar fields such as `name` and
`description` come from the leaf profile.
