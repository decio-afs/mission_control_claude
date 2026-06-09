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

## Current State (10 tabs — unchanged count after Run #4; Command's BRIDGE LOG now collapsible)

Nav lives in **`src/lib/nav.ts`** (`MODULES`) — single source consumed by both
`Layout.tsx` (sidebar) and `CommandPalette.tsx`. To add/remove/reorder a tab, edit `nav.ts`.

| # | Path | Page | Data | Notes |
|---|------|------|------|-------|
| 00 | `/command`     | Hermes Command (Cyberpunk) | LIVE | Primary ops console: agents, tasks, spawn/dispatch. Cron = read-only summary linking to Operations (Run #3). **BRIDGE LOG is now a collapsible drawer** (Run #4). **GHOST LEGION rows open the Agent Drill-Down** (Run #4). |
| 01 | `/network`     | Ghost Network              | LIVE | NEXUS Orchestration Deck — agent topology (rebuilt, scoped `ghostNexus.css`). |
| 02 | `/agent-hub`   | Agent Hub                  | LIVE | Agent CRUD registry + agent-activity tab + spawn-on-task. **Roster rows + INSPECT button open the Agent Drill-Down** (Run #4). |
| 03 | `/war-room`    | War Room                   | LIVE | Metrics gauges + task-status + agent-load + **TASKS/SIGNAL feed toggle**. |
| 04 | `/operations`  | Operations Center          | LIVE | Kanban CRUD + cron list/run/**create** + task decompose. **Single cron home.** |
| 05 | `/chat`        | Ghost Comms (ChatTerminal) | LIVE | Chat round-trips to Hermes. **Narrow-width layout now uses explicit grid rows** (Run #4). |
| 06 | `/factory`     | Content Factory            | LIVE | `useContentStore` → `/api/content/pipeline`. |
| 07 | `/briefing`    | Briefing Terminal          | LIVE | `useBriefingStore` (briefing + sentinel digest). |
| 08 | `/leads`       | Lead Tracker               | LIVE | `useLeadStore`. |
| 09 | `/design-lab`  | Design Lab                 | DEMO | **Consolidated showcase** — internal sub-tabs: Intel Deck / Workflow Builder / Archives / Broadcast Uplink. |

- **Global topbar tooling (in `Layout.tsx`):** `⌘K` command palette (`CommandPalette.tsx`)
  **and** a **DIAG** button (Run #3) that opens the **Bridge Diagnostics** modal
  (`src/components/BridgeDiagnostics.tsx`) — a green/red dot mirrors `vitals.hermesOnline`.
- **Agent Drill-Down (Run #4):** a global right-side slide-over (`src/components/AgentDrillDown.tsx`)
  mounted once in `Layout.tsx`, opened from any roster surface via the tiny
  `useAgentDrilldownStore` (`open(name)`/`close()`). Shows the agent's live status/queue,
  assigned tasks (filtered from `/api/hermes/tasks` by `assignee`) and recent activity
  (filtered from `/api/hermes/activity` by `agent`). No new bridge endpoint — pure client
  aggregation of existing stores. Esc / backdrop closes.
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
- [ ] **Wire the Agent Drill-Down into the Nexus deck (`/network`)** — Run #4 added the global
      `useAgentDrilldownStore` + `AgentDrillDown` slide-over and wired it from Agent Hub + Command's
      GHOST LEGION. The Nexus Orchestration Deck (`src/pages/GhostNetwork.tsx`) still has no entry point;
      make its agent nodes call `useAgentDrilldownStore.open(name)` so all three roster surfaces share it.
      Also consider routing the Command Palette's "agent" results to `open(name)` instead of (or alongside)
      navigating to Agent Hub.
- [ ] **Command vs Operations task-creation duplication** — both Command (CREATE TASK / DISPATCH AGENT) and
      Operations (MISSION QUEUE create + DECOMPOSE) expose task creation. Distinct enough (Command = quick
      inline, Operations = full kanban), but evaluate trimming Command's CREATE TASK to a link to Operations,
      mirroring how cron was consolidated in Run #3. Conservative — confirm before removing a live verb.
- [x] ~~ChatTerminal SESSIONS rail vs roster~~ — VERIFIED NOT redundant in Run #4 (it lists chat sessions
      from `useChatStore`, never agents — left as-is).
- [x] ~~Command BRIDGE LOG earns its vertical space?~~ — DONE in Run #4 (made it a collapsible drawer with
      persisted `mc-bridgelog-open` preference; default expanded).

### UI / Display Fixes
- [x] ~~ChatTerminal narrow-width layout~~ — DONE in Run #4 (explicit `grid-rows-[minmax(110px,28vh)_1fr]`
      on narrow, `lg:grid-rows-1`; verified mobile 375px stacks with 0 overflow, desktop 1440px = 240px+1fr).
- [x] ~~Command top stats `lg:grid-cols-7`~~ — DONE in Run #4 (`xl:grid-cols-7`; stays 4-up until xl width).
- [ ] **Operations Center `calc(100% - 110px)` task list** — still uses a fragile magic-number maxHeight on
      the MISSION QUEUE scroll list (subtracts the filter row + create-task footer height). Works today, but
      a flex-based `flex-1 min-h-0` layout (footer as a `shrink-0` sibling) would be more robust than the
      hardcoded 110px. Low priority — not currently clipping.
- [ ] **AgentDrillDown polish** — the status strip falls back to `STATUS UNKNOWN / TYPE —` when the clicked
      agent isn't in `useGhostStore.nodes` (e.g. opened from a stale palette entry). Acceptable, but consider
      showing a subtle "agent not in current topology" hint. Also: the slide-over has no skills row yet
      (GhostNode carries no skills; would need a bridge field) — wire skills if/when the agent detail grows.

### Next Feature (must differ from Run History — Run #1: Command Palette; Run #2: Cron Creation UI; Run #3: Bridge Diagnostics; Run #4: Agent Drill-Down)
- [ ] Build a **global task search / filter bar** — a `⌘F`-style overlay (or a persistent filter row) that
      searches `/api/hermes/tasks` across ALL tabs by title / id / assignee / status, and on selecting a task
      routes to Operations with that task focused. Reuses `useTaskStore.hermesTasks` (already polled globally).
      Distinct from the Command Palette (which jumps to nav modules/agents, not deep task filtering).
- [ ] Alternative candidates (pick ONE, not already done): live log streaming (SSE/poll tail of a Hermes
      run), task dependency / workflow-step view (HermesTask carries `workflow_template_id` + `current_step_key`),
      completed-task desktop notifications (Electron `Notification` on `done` transitions), keyboard-shortcuts
      cheat-sheet overlay.

---

## Run History (newest first — append, never overwrite)

### 2026-06-09 — Run #4 (branch `auto/evolve-agent-drilldown`)

**Tab audit findings.** Re-enumerated all 10 tabs from `nav.ts`/`App.tsx`/`Layout.tsx` (count unchanged
since Run #2). The two soft overlaps Run #3 queued were resolved: (1) **ChatTerminal's SESSIONS rail is NOT
redundant** — it renders chat sessions from `useChatStore` (name + msg count + date), never the agent roster;
left as-is. (2) **Command's BRIDGE LOG vs War Room SIGNAL are distinct** (local client action log vs Hermes
`/activity` runtime stream) — kept both, but acted on the "does BRIDGE LOG earn its vertical space" question
by making it collapsible (see below). Remaining redundancy surfaced for next run: the Nexus deck still lacks
an Agent Drill-Down entry point (the new slide-over is wired from only 2 of 3 roster surfaces), and Command
vs Operations both expose task creation (queued, not touched — conservative).

**Consolidated — Command BRIDGE LOG → collapsible drawer.** The BRIDGE LOG (a local client-side action log,
not Hermes data) permanently occupied a 140px panel at the bottom of the primary console. Made it collapsible:
the panel header `right` slot is now a toggle button (`N EVENTS ▾/▸`) that hides/shows the log body; the
preference persists to `localStorage` (`mc-bridgelog-open`, default expanded). Reclaims vertical space on the
landing console without losing the log. Verified live: toggling flips `▾`↔`▸`, removes/restores the
`h-[140px]` body, and writes `mc-bridgelog-open=false/true`.

**UI fixes.** (1) **ChatTerminal narrow-width** — root grid was `grid-cols-1 lg:grid-cols-[240px_1fr]` with no
explicit rows, so on a narrow window the SESSIONS + chat panels stacked with auto rows and could overflow the
`overflow-hidden` `<main>`. Now `grid-rows-[minmax(110px,28vh)_1fr] grid-cols-1 lg:grid-rows-1
lg:grid-cols-[240px_1fr] min-h-0`: SESSIONS gets a bounded 28vh row, chat fills the rest. Verified at 375px
(rows 227px/520px, **0 overflow** in `<main>`) and 1440px (single row, `240px 956px` cols — desktop intact).
(2) **Command top stats** — `lg:grid-cols-7` → `xl:grid-cols-7` so the 7 stat cards stay 4-up until there's
real width (at `lg` minus the 220px sidebar each card was ~110px). Verified the grid class in the live DOM.

**New feature — Agent Drill-Down slide-over.** Clicking an agent anywhere opens a right-side slide-over
aggregating everything Hermes knows about it. **Store:** `src/stores/useAgentDrilldownStore.ts` — a tiny
global `{ agentName, open(name), close() }` so any roster can open it without prop-drilling. **Component:**
`src/components/AgentDrillDown.tsx` — reads the agent's `GhostNode` (status/type/running/queue/squad/model),
its assigned tasks (filter `useTaskStore.hermesTasks` by `assignee`, with a per-status count breakdown), and
its recent activity (filter `useActivityStore.activities` by `agent`, relative `ago()` timestamps); fetches
fresh activity on open, closes on Esc/backdrop. **No new bridge endpoint** — pure client aggregation of the
three already-polled stores. **Mounted** once in `Layout.tsx` (overlays every route). **Wired** from Agent Hub
(roster row identity is now a button + a dedicated `INSPECT` action) and Command's GHOST LEGION (each row is a
button). **How to access:** Agent Hub → click an agent name or INSPECT; or Command → click any GHOST LEGION
row. **Verified live with real Hermes data:** opened on `signalscraper` → STATUS ACTIVE / FIXER / INTEL,
RUNNING 1, 2 assigned tasks ("Research DA Agency LLC…" RUNNING, "Find direct competitor agencies…" DONE, both
`9h ago`), 6 activity events — and confirmed graceful empty-state handling (STATUS UNKNOWN + "No tasks/activity"
when an agent has no topology/data).

**Verify.** `npm run build` ✓ (tsc + vite, **112 modules**, up from 110), `npm run lint` ✓ (0 issues), and a
live Vite preview pass: no React/render console errors (only pre-existing bridge-timeout warnings while the CLI
was slow), collapsible BRIDGE LOG, ChatTerminal responsive rows, and the Agent Drill-Down end-to-end against
live agent/task/activity data.

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
