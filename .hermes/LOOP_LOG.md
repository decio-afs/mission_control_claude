# Mission Control — Autonomous Evolution Loop Log

This file is the **handoff document** for the `mission-control-evolve` scheduled task,
which runs every 3 hours. Each run MUST:

1. **Read this file top to bottom** before doing anything else.
2. **Execute the "Next Steps / TODO" items** listed below (consolidation, UI fixes, the next feature).
3. **Append a new dated entry** to the "Run History" section describing exactly what it did.
4. **Rewrite the "Next Steps / TODO" section** with what the *next* run should tackle
   (remaining consolidation, new UI issues found, and the next feature to build).
5. Commit this file alongside the code changes.

**Rules:** Never repeat a feature already listed under Run History. Verify `npm run build`
and `npm run lint` pass before committing. Work on an `auto/evolve-*` branch, commit locally,
do not push/PR. Keep LIVE Hermes-backed functionality intact; only consolidate redundant tabs.

---

## Current State (10 tabs — unchanged count after Run #3; cron consolidated within Command)

Nav lives in **`src/lib/nav.ts`** (`MODULES`) — single source consumed by both
`Layout.tsx` (sidebar) and `CommandPalette.tsx`. To add/remove/reorder a tab, edit `nav.ts`.

| # | Path | Page | Data | Notes |
|---|------|------|------|-------|
| 00 | `/command`     | Hermes Command (Cyberpunk) | LIVE | Primary ops console: agents, tasks, spawn/dispatch. **Cron is now a read-only summary that links to Operations** (Run #3). |
| 01 | `/network`     | Ghost Network              | LIVE | NEXUS Orchestration Deck — agent topology (rebuilt, scoped `ghostNexus.css`). |
| 02 | `/agent-hub`   | Agent Hub                  | LIVE | Agent CRUD registry + agent-activity tab + spawn-on-task. |
| 03 | `/war-room`    | War Room                   | LIVE | Metrics gauges + task-status + agent-load + **TASKS/SIGNAL feed toggle**. |
| 04 | `/operations`  | Operations Center          | LIVE | Kanban CRUD + cron list/run/**create** + task decompose. **Single cron home.** |
| 05 | `/chat`        | Ghost Comms (ChatTerminal) | LIVE | Chat round-trips to Hermes. |
| 06 | `/factory`     | Content Factory            | LIVE | `useContentStore` → `/api/content/pipeline`. |
| 07 | `/briefing`    | Briefing Terminal          | LIVE | `useBriefingStore` (briefing + sentinel digest). |
| 08 | `/leads`       | Lead Tracker               | LIVE | `useLeadStore`. |
| 09 | `/design-lab`  | Design Lab                 | DEMO | **Consolidated showcase** — internal sub-tabs: Intel Deck / Workflow Builder / Archives / Broadcast Uplink. |

- **Global topbar tooling (in `Layout.tsx`):** `⌘K` command palette (`CommandPalette.tsx`)
  **and** a new **DIAG** button (Run #3) that opens the **Bridge Diagnostics** modal
  (`src/components/BridgeDiagnostics.tsx`) — a green/red dot mirrors `vitals.hermesOnline`.
- **Cron lives in ONE place now (Run #3):** Operations is the cron home (list/run/create).
  Command's old cron widget (with per-job RUN NOW buttons) was trimmed to a read-only
  count + name/schedule list + "OPEN OPERATIONS" link. No live cron *control* duplicated.
- **Consolidated in Run #2:** the 4 standalone DEMO tabs → ONE `Design Lab` tab
  (`src/pages/DesignLab.tsx`) with internal sub-tab nav. Old routes redirect to
  `/design-lab?tab=<id>`. No page files deleted.
- **Removed in Run #1:** `Signal Intelligence` (folded into War Room; `/signal-intelligence`
  → `/war-room`; page deleted).
- **Only DEMO/static content left:** lives entirely inside Design Lab. The other 9 tabs are LIVE.

---

## Redundancy Matrix (observed — for the next run's consolidation)

- **Activity/log views** — was: Signal Intel feed + Agent Hub "Activity" tab + War Room task log.
  Signal Intel folded into War Room this run. Agent Hub's "Activity" tab (agent CRUD events from
  `useGhostStore.agentActivity`) still partially overlaps War Room's SIGNAL feed (Hermes `/activity`).
- **Command vs War Room** — both surface agent roster + task summary. Command is the *action* console
  (spawn/claim/complete), War Room is the *read-only metrics* board. Distinct enough; keep separate.
- **Command vs Operations** — both expose cron + tasks. Operations is the fuller kanban CRUD; Command
  has a lighter inline cron/task widget. Candidate for a future trim of Command's cron duplication.
- **4 DEMO tabs** — Intel Deck / Workflow Builder / Archives / Broadcast Uplink have no Hermes source.
  Strongest candidate for the next consolidation: collapse into ONE "Showcase / Design Lab" tab with
  internal sub-tabs (preserves the design work without 4 separate top-level nav entries).

---

## Next Steps / TODO (the next run executes these)

### Consolidation
- [ ] **ChatTerminal "SESSIONS" rail vs other roster/list views** — ChatTerminal has its own
      left rail; confirm it's session-scoped (chat history) and not duplicating the Agent Hub roster.
      If it only lists chat sessions, leave it; if it re-renders agents, dedupe.
- [ ] **War Room SIGNAL feed vs Command BRIDGE LOG** — both are time-ordered event streams. War Room's
      SIGNAL is live Hermes `/activity`; Command's BRIDGE LOG is local client action log. Distinct, but
      consider whether Command's BRIDGE LOG earns its vertical space on the primary console or could be a
      collapsible drawer.
- [x] ~~Command vs Operations cron duplication~~ — DONE in Run #3 (Command cron → read-only summary).
- [x] ~~Agent Hub Activity tab vs War Room SIGNAL~~ — VERIFIED NOT redundant in Run #3 (Agent Hub Activity
      is a *local session* registry-CRUD audit: created/spawned/deleted events from `useGhostStore.agentActivity`;
      War Room SIGNAL is *Hermes runtime* task lifecycle from `/api/hermes/activity`. Different sources — KEPT both).

### UI / Display Fixes
- [ ] **ChatTerminal narrow-width (`grid-cols-1`) layout** — root is `h-full grid grid-cols-1 lg:grid-cols-[240px_1fr]`
      with no explicit grid-rows; on a narrow Electron window the SESSIONS panel + chat column stack with
      auto rows and may overflow `<main>` (which is `overflow-hidden`). Give the narrow layout explicit rows
      or a scroll container. (Desktop `lg` width is fine.)
- [ ] **Command top stats** — `grid-cols-2 md:grid-cols-4 lg:grid-cols-7` packs 7 stat cards; at the `lg`
      breakpoint minus the 220px sidebar each card is ~110px and tight. Consider `xl:grid-cols-7` so it
      stays 4-up until there's real width.
- [ ] **Operations Center** — still confirm `lg:grid-cols-[360px_1fr]` left column + the `calc(100% - 110px)`
      maxHeight on the task list doesn't squeeze/clip kanban cards on the smallest window width.

### Next Feature (must differ from Run History — Run #1: Command Palette; Run #2: Cron Creation UI; Run #3: Bridge Diagnostics)
- [ ] Build an **Agent Drill-Down panel** — clicking an agent (in Agent Hub roster, Command's GHOST LEGION,
      or the Nexus deck) opens a slide-over/modal showing that agent's: assigned tasks (filter
      `/api/hermes/tasks` by `assignee`), skills, online/queue status, and recent activity rows
      (filter `/api/hermes/activity` by agent). Reuses existing endpoints — likely no new bridge route,
      or add `GET /api/hermes/agents/{name}/detail` if a single aggregated call is cleaner.
- [ ] Alternative candidates (pick ONE, not already done): live log streaming (SSE/poll tail of a Hermes
      run), task dependency / workflow-step view, completed-task desktop notifications, keyboard-shortcuts
      cheat-sheet overlay, global task search/filter bar.

---

## Run History (newest first — append, never overwrite)

### 2026-06-09 — Run #3 (branch `auto/evolve-bridge-diagnostics`)

**Tab audit findings.** Re-enumerated all 10 tabs from `nav.ts`/`App.tsx`/`Layout.tsx` (count
unchanged since Run #2). Two live-tab overlaps were queued by Run #2: (1) Command's inline cron
list/run widget vs Operations' fuller cron CRUD, and (2) Agent Hub's Activity tab vs War Room's
SIGNAL feed. Investigated both. **(1) is a real duplication** — Command and Operations both let you
*run* cron jobs. **(2) is NOT redundant** — Agent Hub's Activity tab renders `useGhostStore.agentActivity`,
a *local, session-scoped* audit of registry CRUD (agent created / spawned / deleted), whereas War Room's
SIGNAL feed renders the *Hermes runtime* task-lifecycle stream from `/api/hermes/activity`. Different
data, different purpose — kept both. New overlaps noted for next run: ChatTerminal's SESSIONS rail and
Command's BRIDGE LOG vs War Room SIGNAL (queued, not touched).

**Consolidated — cron now lives only in Operations.** Trimmed Command's (`src/pages/Cyberpunk.tsx`)
CRON JOBS panel from an interactive widget (per-job **RUN NOW** buttons via `runHermesCron`) down to a
**read-only summary**: a JOBS/ACTIVE stat pair, a compact name + schedule list (status dot, no controls),
and two links to Operations (a `MANAGE →` header link + an `OPEN OPERATIONS · SCHEDULE / RUN JOBS` button).
Removed the now-unused `runHermesCron` import and `handleRunCron` handler. Operations is the single cron
home (list / run / create). No spawn/dispatch/task-create functionality on Command was touched.

**UI fixes.** (1) Added vertical spacing between Command's main 3-col grid and the BRIDGE LOG panel —
they were flush (the grid had no bottom margin); gave BRIDGE LOG `mt-4` and extended the file-local
`Panel` to accept a `className`. (2) The trimmed cron summary also reads better — denser rows
(`max-h-[120px]`), a status dot instead of a status pill, and schedule shown inline.

**New feature — Bridge Health Diagnostics (topbar `DIAG` button → modal).** Closes the "is the bridge
healthy?" gap. **Bridge:** added `GET /api/hermes/health` to `hermes-bridge.py` — a cheap self-report
(uptime since `BRIDGE_STARTED`, port, python version, `hermes_cmd`, plus one `hermes --version` CLI probe
with its own latency + error). **api.ts:** `HermesHealth` type + `getHermesHealth()`, a `BRIDGE_ENDPOINTS`
list (the 10 GET routes), and `probeEndpoint(path)` (per-call HTTP status + round-trip latency via
`performance.now()`). **Store:** `src/stores/useHealthStore.ts` pulls meta + probes every endpoint in
parallel, preserving each row's prior `lastSuccess` timestamp on a failed probe. **UI:**
`src/components/BridgeDiagnostics.tsx` — a modal with 4 meta cards (BRIDGE/PORT/UPTIME/CLI), a CLI/python/
server-time line, and a per-endpoint table (status dot, HTTP code, color-tiered latency, "last OK" ago),
plus an `N/M OK` pill and a RE-RUN button. Mounted in `Layout.tsx`; the topbar `DIAG` button carries a
green/red dot mirroring `vitals.hermesOnline`. **How to access:** click **DIAG** in the top-right of the
top bar (every route). **Verified live:** the bridge was running, modal showed **9/10 OK** with real
latencies (1.4–5.2s — the bridge shells out to the CLI per request) and correctly flagged
`/api/hermes/health` as 404 because the *running* bridge process predates the new endpoint — it resolves
on the next bridge restart. The panel degrades gracefully (404 row red, other 9 green, meta cards `—`).

**Verify.** `npm run build` ✓ (tsc + vite, **110 modules**), `npm run lint` ✓ (0 issues),
`python -m py_compile hermes-bridge.py` ✓, and a live Vite preview pass (no console errors; cron summary +
OPEN OPERATIONS link + BRIDGE LOG render; DIAG modal opens and probes all 10 endpoints).

### 2026-06-09 — Run #2 (branch `auto/evolve-designlab-cron`)

**Tab audit findings.** Re-enumerated all 13 tabs from `nav.ts`/`App.tsx`/`Layout.tsx`. Confirmed the
Run #1 split of LIVE (9) vs DEMO (4). The 4 DEMO tabs (Intel Deck, Workflow Builder, Archives, Broadcast
Uplink) render purely from static `legionData.ts` / hardcoded arrays with a `DemoBadge` and have no Hermes
source — they were the clearest remaining top-level clutter (the Redundancy Matrix flagged exactly this).
Remaining live-tab overlaps noted for next run: Command's inline cron widget vs Operations' cron CRUD, and
Agent Hub's Activity tab vs War Room's SIGNAL feed (queued in Next Steps, not touched this run).

**Consolidated.** Collapsed the 4 DEMO tabs into ONE **Design Lab** tab (13 → 10). New `src/pages/DesignLab.tsx`
hosts the four existing demo components behind internal sub-tabs driven by a `?tab=` search param (so
`useSearchParams` keeps deep-links + the command palette working). `nav.ts` now lists a single `designlab`
module (`/design-lab`, num 09) and renumbers the live tabs 00–08. `App.tsx` renders `<DesignLab/>` at
`/design-lab` and redirects the 4 legacy paths (`/intelligence`,`/builder`,`/archives`,`/broadcast`) to
`/design-lab?tab=<id>`. No page files deleted — zero design work lost. Verified live: sidebar shows 10 tabs,
sub-tab switching works, and `#/archives` correctly redirects to `#/design-lab?tab=archives` with the
Archives sub-tab highlighted.

**UI fixes.** Fixed the **Briefing Terminal "TODAY'S DIRECTIVES" panel overflow** — the directives list had
no scroll container, so a long directive list overflowed the panel (and the whole grid never scrolled on
short viewports). Added `overflow-y-auto` + `h-full` to the directives list, `min-h-0` to its Panel, and
`overflow-y-auto` to the page's outer grid (fixes mobile/`grid-cols-1` stacking too). Verified the scroller
mounts.

**New feature — Cron Creation UI (Operations).** Closes the missing cron CRUD verb (bridge previously only
listed/ran jobs). Added `POST /api/hermes/cron` to `hermes-bridge.py` (shells `hermes cron create <schedule>
[prompt] --name --deliver --repeat --skill …`, returns the message + freshly-parsed job list), a
`CreateCronRequest` type + `createHermesCron()` in `src/lib/api.ts`, and a **"+ NEW" button** in the
Operations "SCHEDULED JOBS" panel header that opens a modal (schedule / name / prompt fields, error display,
optimistic list refresh from the response). **How to access:** Operations tab → SCHEDULED JOBS panel →
`+ NEW`. Verified the modal opens with the schedule input present (did not submit — that's a live write).

**Verify.** `npm run build` ✓ (tsc + vite, 107 modules), `npm run lint` ✓ (0 issues),
`python -m py_compile hermes-bridge.py` ✓, and a live Vite preview pass (no console errors; routes,
redirects, Design Lab sub-tabs, Briefing scroller, and the cron modal all confirmed).

### 2026-06-09 — Run #1 (branch `auto/evolve-cmdk-consolidation`)

**Tab audit findings.** Enumerated all 14 tabs from `Layout.tsx`/`App.tsx`. Classified by data source
(grep for `legionData`/`DemoBadge` vs store/`api` imports): 9 LIVE (Command, Network, Agent Hub, War Room,
Operations, Chat, Signal Intel, Content Factory now live, Briefing, Lead Tracker) and 4 DEMO/static
(Intel Deck, Workflow Builder, Archives, Broadcast Uplink). Note: AGENTS.md is stale — Content Factory &
Briefing are now LIVE (wired to `useContentStore`/`useBriefingStore`), and AgentHub/ChatTerminal/
SignalIntelligence/LeadTracker exist but aren't documented there. Clearest redundancy: **three overlapping
"activity/log" views** — the standalone Signal Intelligence feed, Agent Hub's Activity tab, and War Room's
bottom task log all answer "what are the agents doing right now."

**Consolidated.** Merged **Signal Intelligence → War Room** (14 → 13 tabs). War Room's bottom panel is now
a TASKS/SIGNAL toggle: TASKS keeps the kanban activity log; SIGNAL renders the live Hermes `/api/hermes/activity`
feed via `useActivityStore` (the exact data the old tab showed — no live functionality lost). Deleted
`src/pages/SignalIntelligence.tsx`, removed its route, added a `/signal-intelligence → /war-room` redirect.
Extracted the nav list into `src/lib/nav.ts` so Layout and the new palette share one source of truth.

**UI fixes.** (1) Fixed the **frozen ZULU clock** in the topbar — it only re-rendered on the 7s data poll,
so the seconds counter jumped in ~7s steps; added a 1s `setInterval` tick (`now` state) so it updates every
second. (2) Added a clickable **⌘K hint button** in the topbar that opens the command palette.

**New feature — Command Palette (⌘K / Ctrl+K).** `src/components/CommandPalette.tsx`, mounted globally in
`Layout.tsx`. Subsequence fuzzy-search across all nav modules, quick actions, and **live Hermes entities**
(agents from `useGhostStore`, tasks from `useTaskStore` — already polled by Layout, no new bridge endpoint).
Arrow keys navigate, Enter opens, Esc/backdrop close. Selecting a module/agent/task routes to the relevant
screen. **How to access:** press Ctrl+K (or ⌘K), or click the `⌘K` chip in the top bar.

**Verify.** `npm run build` ✓ (tsc + vite, 106 modules) and `npm run lint` ✓ (0 issues) both pass.
