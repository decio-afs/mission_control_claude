<!-- AGENTS.md — Mission Control (Hermes Edition) -->
# Mission Control — Agent Documentation

> **Mission Control** is a cyberpunk-themed **local desktop app** (Electron) for
> the **Hermes Agent** system. It renders 100% live data from a local Hermes
> install via a thin FastAPI bridge. No mock data, no other backend, nothing
> deployed — it runs only on the user's machine.

---

## Architecture

```
Electron window (React app, file://)  ──HTTP──▶  hermes-bridge.py (FastAPI :8767)  ──subprocess──▶  hermes CLI
        │
        └── spawns/kills the bridge on app launch/quit
```

- **`electron/main.cjs`** — desktop main process. On launch it spawns the Hermes
  bridge, waits for it to answer, then opens the window loading the built app from
  `dist/index.html` (or `MC_DEV_URL` in dev). Kills the bridge on quit. Enforces a
  single-instance lock so two bridges never run at once.
- **`hermes-bridge.py`** — FastAPI wrapper around the `hermes` CLI. Each endpoint
  shells out to a Hermes command, parses its JSON (or plain text for `cron`), and
  returns it. This is the *only* integration point — keep the React app and the
  bridge in lock-step.
- **React app** — fetches from the bridge through `src/lib/api.ts`. Zustand stores
  poll the bridge; pages subscribe to stores. Every store exposes an `error` state
  so a downed bridge is visible in the UI rather than failing silently. Routing is
  `HashRouter` because the app loads from `file://` inside Electron.

### Bridge endpoints → Hermes CLI

| Endpoint                                   | Hermes command                          |
|--------------------------------------------|-----------------------------------------|
| `GET  /api/hermes/status`                  | `hermes --version`                      |
| `GET  /api/hermes/agents`                  | `hermes kanban assignees --json`        |
| `GET  /api/hermes/tasks`                   | `hermes kanban list --json`             |
| `POST /api/hermes/tasks`                   | `hermes kanban create … --json`         |
| `POST /api/hermes/tasks/{id}/claim`        | `hermes kanban claim <id>`              |
| `POST /api/hermes/tasks/{id}/complete`     | `hermes kanban complete <id>`           |
| `POST /api/hermes/tasks/{id}/block`        | `hermes kanban block <id> -- <reason>`  |
| `GET  /api/hermes/cron`                    | `hermes cron list`                      |
| `POST /api/hermes/cron/{id}/run`           | `hermes cron run <id>`                  |
| `POST /api/hermes/spawn`                   | `hermes chat -q <goal> [-m … -s …]`     |

Hermes JSON shapes are mirrored 1:1 in `src/lib/api.ts` (`HermesAgent`,
`HermesTask`, `HermesCronJob`, `HermesStatus`). If a CLI shape changes, update
both the bridge parser and these types.

---

## Technology Stack

- **React 19** + **TypeScript 5.9** (strict) + **Vite 8** (dev server `:3001`)
- **Tailwind CSS 4** via `@tailwindcss/vite`
- **Zustand 5** — state stores
- **React Router 7** — routing
- **Axios** — bridge HTTP client
- **pathfinding** — A* movement in the Ghost Network visualization
- **lucide-react**, **date-fns** — icons / time formatting
- **FastAPI + uvicorn** (Python) — the bridge

---

## Project Structure

```
electron/
├── main.cjs                # Desktop main process: spawns bridge, opens window
└── preload.cjs             # Minimal contextBridge (exposes window.missionControl)
hermes-bridge.py            # FastAPI ↔ hermes CLI bridge (port 8767)
scripts/audit-and-improve.py# Hermes-driven self-audit tooling
.hermes/                    # Audit instructions, logs, reports
src/
├── lib/
│   ├── api.ts              # Bridge client + Hermes types (the only LIVE data source)
│   └── legionData.ts       # Static demo data for the DEMO showcase modules
├── stores/
│   ├── useGhostStore.ts    # Agents → topology (mapAgentsToTopology)
│   ├── useTaskStore.ts     # Kanban tasks + summary + create/claim/complete/block
│   └── useSystemStore.ts   # Bridge status, version, latency history
├── components/
│   ├── Layout.tsx          # Sidebar + topbar shell; polls stores to stay live
│   ├── cyberpunk/ui.tsx    # Design system (Panel, Pill, Stat, Ring, Sparkline…)
│   └── DemoBadge.tsx       # "DEMO DATA" marker for non-Hermes modules
├── pages/
│   ├── Cyberpunk.tsx       # LIVE "Hermes Command" — primary ops dashboard (/command)
│   ├── GhostNetwork.tsx    # LIVE sprite-room agent visualization (/network)
│   ├── WarRoom.tsx         # LIVE Hermes metrics & task activity (/war-room)
│   ├── OperationsCenter.tsx# LIVE kanban queue + cron management (/operations)
│   ├── IntelligenceDeck.tsx# DEMO trend signal
│   ├── ContentFactory.tsx  # DEMO carousel composer
│   ├── BriefingTerminal.tsx# DEMO daily brief
│   ├── WorkflowBuilder.tsx # DEMO node graph
│   ├── Archives.tsx        # DEMO mission history
│   └── BroadcastUplink.tsx # DEMO channel stats
├── App.tsx                 # Routes (default → /command)
└── main.tsx                # Entry
```

---

## Routes

| Path            | Page              | Data    | Notes                              |
|-----------------|-------------------|---------|------------------------------------|
| `/` `/command`  | Hermes Command    | LIVE    | Default. Agents, tasks, cron, dispatch. |
| `/network`      | Ghost Network     | LIVE    | Live agent topology (sprite room). |
| `/war-room`     | War Room          | LIVE    | Derived live metrics + task log.   |
| `/operations`   | Operations Center | LIVE    | Kanban CRUD + cron run.            |
| `/intelligence` | Intel Deck        | DEMO    | Trend signal (static demo data).   |
| `/factory`      | Content Factory   | DEMO    | Carousel composer (static).        |
| `/briefing`     | Briefing Terminal | LIVE    | Daily brief (live Hermes data).    |
| `/builder`      | Workflow Builder  | DEMO    | Node graph (static).               |
| `/archives`     | Archives          | DEMO    | Mission history (static).          |
| `/broadcast`    | Broadcast Uplink  | DEMO    | Channel stats (static).            |
| `*`             | → `/command`      | —       | Catch-all + legacy `/cyberpunk` redirect. |

DEMO modules are the original design ported faithfully; they have no Hermes data
source, so they render `src/lib/legionData.ts` and show a `DEMO DATA` badge.
Wire them to a real source by replacing that import with bridge calls.

---

## Build & Run

```bash
npm run desktop      # build UI + open desktop window (auto-starts the bridge)
npm run desktop:dev  # open desktop window against MC_DEV_URL (hot reload)
npm run dev          # vite dev server :3001 (browser, bridge run separately)
npm run bridge       # python hermes-bridge.py (standalone)
npm run build        # tsc -b && vite build → dist/
npm run lint
```

`vite.config.ts` uses `base: './'` so the build loads from `file://`; the dev
server binds to `127.0.0.1` only (local-only, no LAN exposure).

---

## Conventions

- **Hermes is the single source of truth.** Do not reintroduce mock data, Notion,
  OpenClaw, VPS, or socket layers — they were removed in the Hermes refactor.
- **Local desktop only.** No web hosting/deployment. Keep `base: './'`, `HashRouter`,
  and localhost binding. Don't add deploy config (Vercel etc.) back.
- **Surface errors.** Stores set `error` on failure; pages should show it, not
  render stale/empty state silently.
- **New data needs?** Add a CLI-backed endpoint to `hermes-bridge.py`, mirror the
  type in `api.ts`, then consume it in a store. Never call external services
  directly from the React app.
- **Design system first.** Reuse `components/cyberpunk/ui.tsx` primitives; the
  palette is coral `#f64e6e` on near-black `#050505`/`#0A0A0A`, mono labels in
  uppercase with wide tracking.
- React components: function declarations, `PascalCase`; stores: `useXStore`.

---

## Design System (quick reference)

```
Background:  #050505 (deep) · #0A0A0A (card) · #080808 (inset)
Brand:       #f64e6e → #ff795e
Accents:     emerald #10b981 (good) · amber #f59e0b (warn) · sky #38bdf8 (info) · red #ef4444 (bad)
Text:        #FFFFFF / #b8b8b8 / #545454 / #363636
Type:        Inter (sans) · JetBrains Mono / ui-monospace (data, labels)
```
