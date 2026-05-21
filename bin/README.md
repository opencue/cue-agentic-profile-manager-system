# bin/

The `soul` CLI lives here. Bun-based (consistent with the macOS/Linux setup
flow). Subcommand dispatch only — actual logic is in `bin/cli/lib/`.

## Layout

```
bin/
├── soul                 # bash launcher → `bun bin/cli/index.ts "$@"`
└── cli/
    ├── index.ts         # entrypoint, dispatches to commands/
    ├── commands/        # one file per `soul <subcommand>`
    └── lib/             # profile loader, resolvers, materializers
```

## Subcommands (planned)

| Command             | Purpose                                                          |
|---------------------|------------------------------------------------------------------|
| `soul use <name>`   | Materialize a profile into CWD (or `--global` into ~/.claude/)   |
| `soul list`         | List profiles with skill/MCP counts and active marker            |
| `soul new <name>`   | Create a profile; `--from-scan` buckets discovered skills        |
| `soul scan`         | Print a tree of installed skills/plugins grouped by domain       |
| `soul doctor`       | Diff declared profile vs actual disk state; `--fix` repairs      |
| `soul validate`     | Schema + lint checks for one profile (or `--all`)                |
| `soul init-shell`   | Generate `claude-<profile>` aliases for zsh/bash/pwsh            |

Exit codes:
- `0` — success
- `1` — user error (bad args, missing profile)
- `2` — internal error
