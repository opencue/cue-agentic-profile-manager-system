# cue dashboard

Read-only dashboard for the `cue` profile manager. Two deployment modes from one codebase:

- **Local** — `cue dashboard` (in the parent repo) spawns a Bun server on `127.0.0.1:7891`. The React app fetches `/api/v1/*` against that server. Real data from `~/.config/cue/`.
- **Vercel demo** — `vercel.json` builds + serves the React app statically and rewrites every `/api/v1/*` request to `demo-data.json` so visitors see realistic numbers without any local install.

## Develop

**One command (recommended)** — boots both the API server and Vite together with color-prefixed logs, single Ctrl-C tears them both down:

```bash
cd web
npm install         # or: bun install
npm run dev:full    # → [dash] http://127.0.0.1:7891  +  [vite] http://127.0.0.1:5173
```

Open <http://localhost:5173>.

**Two terminals** if you want them split:

```bash
# T1
bun ../src/index.ts dashboard --no-open

# T2
cd web && npm run dev
```

**Proxy fault tolerance.** When the Bun API server isn't running, the Vite proxy (configured in `vite.config.ts`) intercepts the upstream error and returns a clean JSON envelope (`{ok:false, error:"dashboard-server-unreachable: ..."}` with HTTP 503) instead of Vite's stock HTML 500 page. The React app detects that envelope at startup and renders a single "server offline" banner with the command to start it, instead of every card repeating the same error.

## Build

```bash
npm run build      # → dist/
```

Once `web/dist/` exists, `cue dashboard` serves the static build alongside its `/api/v1/*` endpoints (no Vite needed).

## Demo data

`scripts/dashboard-demo-data.ts` produces `public/demo-data.json` from a hand-curated snapshot. Re-generate after editing the script:

```bash
npm run gen-demo-data
```

`vercel.json` runs this as part of the build, so the demo on Vercel always has fresh sample data.

## Deploy to Vercel

```bash
vercel deploy --prod
```

Make sure the Vercel project's "root directory" points at `web/`. The `vercel.json` here handles the rest (build command, output dir, rewrites, security headers).

## Architecture

```
src/
├── main.tsx           ← entry, QueryClientProvider
├── App.tsx            ← root layout, 6 cards
├── lib/
│   ├── fetcher.ts     ← local-vs-demo adapter
│   └── format.ts      ← bytes / relative-time
├── components/
│   ├── ActiveProfile.tsx
│   ├── SkillActivation.tsx
│   ├── TokenCostChart.tsx
│   ├── PairSuggestions.tsx
│   ├── TriggerGaps.tsx
│   └── GateTimeline.tsx
└── styles/globals.css ← CSS variables, dark-first, light fallback
```

Each component fetches one endpoint via TanStack Query, renders a card with a `cue ...` CLI hint in the corner so users can drop into the equivalent CLI command at any time.
