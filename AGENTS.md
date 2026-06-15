<!-- AGENTS.md — Mission Control (Claude) -->
# Mission Control — Agent Documentation

> **Mission Control** is a cyberpunk-themed **local desktop app** (Electron) for
> **Claude**. Every module renders **live data** — from the
> local Claude install via a FastAPI bridge, plus external content pipelines
> (Apify, Buffer, Brave) that flow **only through the bridge**. No mock data
> anywhere, nothing deployed — it runs only on the user's machine.

---

## Architecture

```
Electron window (React, file://) ──HTTP──▶ mission-control-bridge.py (FastAPI :8767) ──subprocess──▶ claude CLI
        │                                          │
        └─ reuses or spawns the bridge             ├──▶ .mc/data/*.json  (leads, calendar, creators, digests — gitignored)
                                                   └──▶ external APIs (Apify, Buffer GraphQL, Ayrshare, Brave)
Background worker service (separate service) ──▶ Telegram bots + cron ticker + embedded kanban dispatcher
```

- **`electron/main.cjs`** — desktop main process. On launch it probes
  `/api/ping`; if a bridge is already running it **reuses it** (never
  double-binds :8767), otherwise spawns one and supervises it (auto-restart
  with backoff). Exposes a `bridge:start` IPC for the diagnostics panel.
- **`mission-control-bridge.py`** — FastAPI wrapper around the `claude` CLI plus the
  file-backed data stores and external-API pipelines. All subprocesses run
  with `CREATE_NO_WINDOW` (a console-less bridge must not flash terminals).
  API keys are read from the bridge env **or `%LOCALAPPDATA%\mission-control\.env`** (AppData on
  Windows) via `_env_key()` — configure each key once, where Claude keeps it.
- **`vite.config.ts`** — the dev server hosts `POST /__bridge/start`, the
  browser-mode twin of the Electron IPC: it spawns a detached bridge (output
  → `.mc/bridge.log`) so the diagnostics panel can revive a dead bridge
  even in `npm run dev`.
- **React app** — fetches through `src/lib/api.ts` only. Zustand stores poll
  the bridge; every store exposes an `error` state so a downed bridge is
  visible, never silent. `HashRouter` because the app loads from `file://`.

### Service recovery (Bridge Diagnostics popup — the DIAG button)

Opening the popup runs an auto-diagnosis. Hard-won rules encoded there and in
the bridge — do not regress them:

- **Bridge down** → auto-started once per session (Electron IPC in desktop,
  `/__bridge/start` in dev). Probes use `/api/ping` (instant, no CLI) — the
  CLI-backed endpoints take 1–4 s and time out naive probes.
- **Gateway down** → auto-`restart`ed once per session via the **Windows
  Scheduled Task** (`schtasks /End` then `/Run` — a wedged task instance makes
  `/Run` a silent no-op). Never trust the CLI's process-scan ("Gateway process
  running (PID …)") — hung TTY-less zombies and *concurrent `background workers`
  CLI calls* fool it. **The only liveness truth is the gateway api port
  (:8642) answering.** `gateway status`+`list` are intentionally serial in
  the bridge: running them concurrently makes status detect its sibling call.
- The gateway hosts Telegram **and the kanban dispatcher** — when it dies,
  messaging *and* agent task dispatch silently stop.

### Bridge endpoint groups (≈70 endpoints; see `mission-control-bridge.py` + `api.ts`)

| Group | Endpoints (representative) | Backed by |
|---|---|---|
| Core | `/api/ping` (instant liveness) · `status` · `health` | none / CLI |
| Kanban | `tasks` CRUD + full verb set: claim, complete, block/unblock, promote, schedule, archive, assign/reassign/reclaim, comment, edit, link/unlink, specify, log, context, notify, boards, stats, diagnostics | `native kanban store` |
| Agents | `agents` CRUD + spawn-on-task, `spawn`, `chat` (session-aware), `sessions` CRUD | `claude …` |
| Capabilities | `overview` · `skills` · `plugins` (+enable/disable) · `mcp` (+test) · `gateway` (+action) · `send/targets` + `send` · `webhooks` · `memory` · `curator` · `insights` · `doctor` · `logs` · `model` · `auth` · `checkpoints` · `pairing` · `security/audit` | CLI (tolerant text parsers, always include `raw`) |
| Pipelines | `leads` CRUD · `content/calendar` CRUD (+Buffer/Ayrshare) · `creators` watch/scrape · `claude/ai-digest` · `content/ideas` · `content/pipeline` · sentinel digest/archive | `.mc/data/` stores + external APIs + `claude` |

### Content pipelines (the strategy loop)

```
Sentinel cron (7:00) ──▶ AI news stories ─┐
Apify scrape (watchlist) ─▶ viral posts ──┼─▶ claude ──▶ AI digest (Briefing)
BRAND_STRATEGY.md ────────────────────────┘              └─▶ Idea Engine (Factory):
                                                              strategy note + ranked ideas
                                                              → + PLAN (calendar)
                                                              → BUFFER (Buffer Ideas, GraphQL)
                                                              → ⚡ AGENT (kanban task, triage)
```

- **Apify** (`APIFY_API_TOKEN`): `apify~instagram-post-scraper` /
  `clockworks~tiktok-scraper` via `run-sync-get-dataset-items`; posts ranked
  by a viral score. The IG **profile** scraper is useless here (account
  objects, not posts).
- **Buffer** (`BUFFER_ACCESS_TOKEN` + `BUFFER_ORGANIZATION_ID`): the modern
  **GraphQL API at `api.buffer.com`** with the account OIDC token — the
  legacy REST API rejects OIDC, and `graph.buffer.com` redirects here. Public
  surface is the Ideas workflow (`createIdea`); queue scheduling happens
  inside Buffer. Ayrshare (`AYRSHARE_API_KEY`) is the direct-scheduling
  fallback provider.
- **LLM synthesis** endpoints (`ai-digest`, `content/ideas`) call `claude`
  with strict-JSON prompts; they return a friendly 503 on provider quota
  exhaustion (HTTP 429 in CLI output).
- **Cron**: `content-engine-daily` at **7:30** (after Sentinel's 7:00) runs
  scrape → digest → ideas and delivers a morning report to Telegram.

Keys live in `%LOCALAPPDATA%\mission-control\.env`: `APIFY_API_TOKEN`, `BUFFER_ACCESS_TOKEN`,
`BUFFER_ORGANIZATION_ID`, `AYRSHARE_API_KEY` (optional), `BRAVE_SEARCH_API_KEY`
(for the agents' `web-brave-free` plugin — without a web plugin, research
tasks burn their iteration budget and bounce back to TODO forever).

---

## Technology Stack

- **React 19** + **TypeScript 5.9** (strict) + **Vite 8** (dev server `:3001`;
  the preview/launch config uses `:5219`)
- **Tailwind CSS 4** via `@tailwindcss/vite`
- **Zustand 5** — state stores · **React Router 7** — routing · **Axios** — bridge client
- **FastAPI + uvicorn** (Python) — the bridge
- **Electron 42** — desktop shell

---

## Project Structure

```
electron/
├── main.cjs                 # Reuse-or-spawn bridge, supervision, bridge:start IPC
└── preload.cjs              # window.missionControl { desktop, bridgePort, startBridge }
mission-control-bridge.py             # FastAPI ↔ claude CLI + data stores + external pipelines
vite.config.ts               # + mc-bridge-launcher dev middleware (/__bridge/start)
BRAND_STRATEGY.md            # Brand positioning/voice — grounds the Idea Engine
.mc/
├── data/                    # leads/calendar/creators/digest/ideas stores (gitignored)
├── bridge.log               # detached-bridge output (gitignored)
└── repair_mojibake.py       # PS5.1 encoding-corruption repair (see Conventions)
src/
├── lib/api.ts               # Bridge client + ALL types (the only data source)
├── stores/
│   ├── useGhostStore.ts     # Agents → topology + sampled fleet/agent history (real sparklines)
│   ├── useTaskStore.ts      # Kanban tasks + full verb set
│   ├── useCapabilitiesStore.ts # Arsenal/Uplink/Systems domains (independent loading/errors)
│   ├── useContentStore.ts   # /api/content/pipeline first, client-side kanban derivation as fallback
│   └── …                    # system, activity, briefing, leads, chat, notify, focus
├── components/
│   ├── Layout.tsx           # Premium chrome: gradient sidebar, blurred topbar (relative z-40 —
│   │                        #   backdrop-blur traps dropdown z-index without it)
│   ├── cyberpunk/ui.tsx     # Design system: Panel (gradient surface, coral notch,
│   │                        #   overflow-hidden), Pill, Stat (truncating), Ring, LogTail…
│   ├── BridgeDiagnostics.tsx# DIAG popup: endpoint probes + bridge/gateway auto-recovery
│   └── TaskDetailDrawer.tsx # Full task verb set, deps, comments, live worker log
├── pages/                   # ALL LIVE — no demo data anywhere
│   ├── GhostNetwork.tsx     # 00 default: orbital mesh (activity-lit power states: gray idle,
│   │                        #   squad-color when executing; core dims on standby / brightens
│   │                        #   when thinking), real task titles, reroute via kanban verb,
│   │                        #   Orbit/Grid toggle, real history sparklines (+ ghostNexus.css)
│   ├── WarRoom.tsx          # 01 metrics: status/flow/burn/SLA/aging views
│   ├── OperationsCenter.tsx # 02 kanban: lifecycle, decompose, cron, boards, diagnostics
│   ├── ChatTerminal.tsx     # 03 multi-session orchestrator chat
│   ├── ContentFactory.tsx   # 04 Idea Engine (news×viral×brand) + campaigns + calendar
│   │                        #   (+PLAN/→BUFFER) + Viral Signals (Apify watchlist/scrape)
│   ├── BriefingTerminal.tsx # 05 daily brief + consolidated AI digest (viral content ideas)
│   ├── LeadTracker.tsx      # 06 leads CRUD (agents POST /api/mc/leads)
│   ├── Arsenal.tsx          # 07 skills/plugins(toggle)/MCP(test)/memory/curator
│   ├── Uplink.tsx           # 08 gateway control, channel matrix, transmit console, webhooks
│   ├── Systems.tsx          # 09 insights, log tail, doctor, model/auth, OSV audit
│   └── DesignLab.tsx        # 10 LIVE: creator intel / sentinel archive / channel matrix /
│                            #   real kanban dependency flow (former demo showcase)
├── App.tsx                  # Routes (default → /network; legacy paths redirect)
└── main.tsx
```

`src/lib/legionData.ts` and `DemoBadge.tsx` have **zero consumers** (demo era
is over) — delete on sight if convenient.

---

## Routes — all LIVE

`00 /network` · `01 /war-room` · `02 /operations` · `03 /chat` · `04 /factory`
· `05 /briefing` · `06 /leads` · `07 /arsenal` · `08 /uplink` · `09 /systems`
· `10 /design-lab` — defined once in `src/lib/nav.ts` (sidebar + ⌘K consume it).
Legacy paths (`/command`, `/agent-hub`, `/intelligence`, …) redirect.

---

## Build & Run

```bash
npm run desktop      # build UI + open desktop window (reuses or starts the bridge)
npm run dev          # vite dev server (browser; DIAG popup can start the bridge)
npm run bridge       # python mission-control-bridge.py (standalone, foreground)
npm run build        # tsc -b && vite build → dist/
npm run lint
```

`base: './'` + `HashRouter` for `file://`; dev server binds `127.0.0.1` only.

---

## Conventions

- **Everything flows through the bridge.** The React app never calls external
  services directly — Apify/Buffer/Ayrshare/Brave live in `mission-control-bridge.py`.
  New data need → bridge endpoint → type in `api.ts` → store → page.
- **No demo data, ever.** Honest empty states with guidance ("add creators,
  then SCRAPE") instead of fabricated rows. Unconfigured integrations say so
  in the UI (amber banner naming the missing env key).
- **Local desktop only.** No deploy config; keep localhost binding.
- **Surface errors.** Stores set `error`; pages render it.
- **Stacked-panel layouts:** panels in a fixed-height flex column must be
  `shrink-0` (page scrolls) or capped (`max-h-*` + `overflow-y-auto` body) —
  flexbox squeezing + Panel's `overflow-hidden` otherwise clips content.
  Fixed-height stat cards must be `min-h-*`, never `h-*`.
- **⚠ Never bulk-edit sources with PowerShell 5.1** (`Get/Set-Content` reads
  BOM-less UTF-8 as cp1252 and mojibakes every `—·✓⚠●`). Use python; a repair
  script exists at `.mc/repair_mojibake.py`.
- React components: function declarations, `PascalCase`; stores: `useXStore`.

---

## Design System (quick reference)

```
Fonts:       Chakra Petch (UI) · JetBrains Mono (data/labels) — the ONLY two,
             app-wide, loaded in index.html (never declare unloaded fonts)
Type scale:  10 / 11 / 13 / 16 / 20 px — snap to these, nothing else
Background:  #050505 deep · panels are gradient #0d0d10→#09090b, 4px radius,
             inner top highlight, soft drop shadow, coral header notch
Ambience:    body has fixed radial glows (coral top-right, sky bottom-left)
Brand:       #f64e6e → #ff795e — reserved for: orchestrator core, panel
             notches, active nav, primary actions. Squad identity hues are
             separate from status hues: SEC violet #a78bfa · INTEL cyan
             #22d3ee · INFRA #10b981 · CONT #f59e0b · DEV #38bdf8 — red
             #ef4444 means DANGER only, amber #f59e0b means WARN only.
Text:        #FFFFFF / #b8b8b8 / #707070 (dim) / #585858 (faint)
Motion:      means something — agents light up only while executing; packets
             only on working spokes; core brightens when thinking. Ambient
             rotation is decoration-only layers. prefers-reduced-motion and
             the hidden-tab pause must keep working.
Topbar:      backdrop-blur ⇒ stacking context — keep `relative z-40` or
             header dropdowns paint under page content.
```
