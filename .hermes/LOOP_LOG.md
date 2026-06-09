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

## Current State (8 tabs — Command + Agent Hub folded into Ghost Network in Run #6)

Nav lives in **`src/lib/nav.ts`** (`MODULES`) — single source consumed by both
`Layout.tsx` (sidebar) and `CommandPalette.tsx`. To add/remove/reorder a tab, edit `nav.ts`.

| # | Path | Page | Data | Notes |
|---|------|------|------|-------|
| 00 | `/network`     | Ghost Network              | LIVE | **Merged primary console.** NEXUS Orchestration Deck (orbital mesh + roster) **plus** the agent Registry CRUD (create/edit/delete/spawn via the new `useAgentCrud()` hook + `+ Agent` button) **plus** the ARCAN orchestrator command bar (directives, status, reassign) wired to the shared chat session. Detail panel `▦ INSPECT` → Agent Drill-Down. Absorbed the old Hermes Command + Agent Hub (Run #6). |
| 01 | `/war-room`    | War Room                   | LIVE | Metrics gauges + task-status + **AGENT LOAD ↔ PERF toggle** (new performance leaderboard, Run #6) + **TASKS/SIGNAL feed toggle**. |
| 02 | `/operations`  | Operations Center          | LIVE | Full kanban CRUD + cron list/run/create + task decompose + **TaskDetailDrawer** (comments/events/runs/notify/boards/diagnostics). Single cron home. Receives ⌘F Task Search focus. |
| 03 | `/chat`        | Ghost Comms (ChatTerminal) | LIVE | ARCAN multi-session orchestrator chat (persistent SQLite sessions, attachments, voice). |
| 04 | `/factory`     | Content Factory            | LIVE | `useContentStore` → `/api/content/pipeline`. |
| 05 | `/briefing`    | Briefing Terminal          | LIVE | `useBriefingStore` (briefing + sentinel digest). |
| 06 | `/leads`       | Lead Tracker               | LIVE | `useLeadStore`. |
| 07 | `/design-lab`  | Design Lab                 | DEMO | **Consolidated showcase** — internal sub-tabs: Intel Deck / Workflow Builder / Archives / Broadcast Uplink. |

**Removed in Run #6:** `Hermes Command` (`Cyberpunk.tsx`) and `Agent Hub` (`AgentHub.tsx`) — Command was a
redundant mashup of the other live tabs and Agent Hub's registry duplicated agent management. Both folded into
Ghost Network (CRUD via `src/components/useAgentCrud.tsx`; directives via the command bar). `App.tsx` redirects
`/command`, `/cyberpunk`, `/agent-hub` → `/network`. **No live verb lost** (create/edit/delete/spawn + directives
all survive in the Ghost Network detail panel).

- **Global topbar tooling (in `Layout.tsx`):** `⌘K` command palette (`CommandPalette.tsx`),
  a **`⌕ ⌘F` Task Search** button (Run #5 — `src/components/TaskSearch.tsx`),
  **and** a **DIAG** button (Run #3) that opens the **Bridge Diagnostics** modal
  (`src/components/BridgeDiagnostics.tsx`) — a green/red dot mirrors `vitals.hermesOnline`.
- **Task Search (Run #5):** a global `⌘F`/`Ctrl+F` overlay (`src/components/TaskSearch.tsx`,
  mounted once in `Layout.tsx`) that fuzzy-searches the whole Hermes queue
  (`useTaskStore.hermesTasks`) by title / id / assignee / status, with status-filter chips.
  Selecting a task routes to Operations and focuses it (scroll-into-view + 2.4s flash highlight)
  via the tiny `useTaskFocusStore` (`focus(id)` / `clear()` + a `nonce` so re-selecting the same
  task re-fires). No new bridge endpoint — pure client filter of the already-polled store.
  Distinct from the ⌘K palette (nav/agents) — this is deep task-only filtering.
- **Agent Drill-Down (Run #4):** a global right-side slide-over (`src/components/AgentDrillDown.tsx`)
  mounted once in `Layout.tsx`, opened from any roster surface via the tiny
  `useAgentDrilldownStore` (`open(name)`/`close()`). Shows the agent's live status/queue,
  assigned tasks (filtered from `/api/hermes/tasks` by `assignee`) and recent activity
  (filtered from `/api/hermes/activity` by `agent`). No new bridge endpoint — pure client
  aggregation of existing stores. Esc / backdrop closes. **Now wired from all 3 roster surfaces**
  (Agent Hub, Command, **and the Nexus deck's `▦ INSPECT` button** — Run #5). The **⌘K Command
  Palette's agent results also open the drill-down in place** instead of navigating to Agent Hub
  (Run #5). Shows an **"agent not in current topology" amber hint** when the clicked agent isn't
  in the live mesh (Run #5).
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
- **The consolidation pass is effectively COMPLETE.** 8 tabs, all distinct. Command + Agent Hub (the last
  redundancy) were folded into Ghost Network in Run #6; every roster/cron/log/task-creation overlap flagged
  across Runs #1–#5 is resolved. Do **not** cut further without strong cause — the remaining 8 tabs are each a
  distinct surface. Next runs should focus on UI polish + new features.
- [ ] **Optional sanity audit only:** re-enumerate `nav.ts`/`App.tsx`/`Layout.tsx`, confirm the 3 redirects
      (`/command`,`/cyberpunk`,`/agent-hub` → `/network`) still resolve, and that no dead nav entry crept back.

### UI / Display Fixes
- [x] ~~Nexus detail header two `.dclose` buttons crowding the name~~ — DONE in Run #6 (`.dh` flex-wrap +
      `.dt` min-width:0 + name ellipsis + buttons `white-space:nowrap; flex-shrink:0`).
- [ ] **Ghost Network is now very dense** (mesh + roster + detail + CRUD modals + command bar + session
      switcher all on one screen). Audit at 1280px and 1920px for cramped panels / overflow now that it
      absorbed two tabs' worth of function — especially the right detail panel when an agent is selected
      (two `dctrl` button rows + tags + telemetry). Screenshot and tighten spacing if it clips.
- [ ] **War Room AGENT PERFORMANCE** — the leaderboard table is read-only/static-sort (ranked by throughput).
      Consider making column headers click-to-sort (done / rate / avg) if the panel grows. Low priority.
- [ ] **AgentDrillDown skills row** — still no per-agent skills (GhostNode carries none; `HermesTask.skills`
      is per-task). Would need a bridge field on the agent node. Low priority.

### Next Feature (must differ from Run History — Run #1: Command Palette; Run #2: Cron Creation UI; Run #3: Bridge Diagnostics; Run #4: Agent Drill-Down; Run #5: Global Task Search ⌘F; Run #6: Agent Performance Leaderboard)
- [ ] Build a **task dependency / workflow-step view** — `HermesTask` carries `workflow_template_id` +
      `current_step_key`, and `getHermesTaskDetail()` already returns `parents` + `children`. Render, for tasks
      in a workflow, a compact stepper/timeline of the template steps + where the task sits, and the
      parent/child dependency chain (data already in `TaskDetail`). Surface inside the **TaskDetailDrawer**
      (Operations) or the Agent Drill-Down. The parent/child graph needs **no** new endpoint; the full ordered
      template step list may need a small `hermes workflow`/`template` bridge command — check the CLI first.
- [ ] Alternative candidates (pick ONE, not already done): live log streaming (poll-tail of
      `getHermesTaskLog`, which already exists), completed-task desktop notifications (Electron `Notification`
      on `done` transitions), keyboard-shortcuts cheat-sheet `?` overlay (⌘K + ⌘F + DIAG all exist now).

---

## Run History (newest first — append, never overwrite)

### 2026-06-09 — Run #6 (branch `auto/evolve-agent-performance`)

**Inherited-state note.** This run opened on a working tree carrying a large **uncommitted** changeset from a
prior in-progress run: Command (`Cyberpunk.tsx`) + Agent Hub (`AgentHub.tsx`) deleted, `nav.ts` already trimmed
to 8 tabs, a new `useAgentCrud.tsx`, a substantial ARCAN ChatTerminal/useChatStore rewrite, and ~185 lines of
new `hermes kanban` bridge + `api.ts` endpoints — none of it committed, and lint was failing. Rather than
discard legitimate prior work, this run **verified it (build ✓, the consolidation is non-destructive — every
live verb survives in Ghost Network), let the concurrent self-audit resolve its own lint errors, and committed
it** as the run's consolidation deliverable, then layered the UI fix + new feature on top.

**Tab audit findings.** Enumerated `nav.ts`/`App.tsx`/`Layout.tsx`: **8 tabs** (down from 10). The inherited
fold removed the last redundancy the log had been tracking since Run #1 — **Hermes Command** was a mashup of
the other live tabs and **Agent Hub** duplicated agent management. Both now live in Ghost Network: agent CRUD
via the extracted `useAgentCrud()` hook (detail-panel Spawn/Edit/Delete + a `+ Agent` stage button) and the
orchestrator directives via the command bar. `App.tsx` redirects `/command`,`/cyberpunk`,`/agent-hub` →
`/network`. **No live functionality lost.** The consolidation pass is now effectively complete.

**Consolidated (committed).** `feat(nav): consolidate Command + Agent Hub into Ghost Network (10 → 8 tabs)` —
the inherited fold + its companion ARCAN chat rewrite and full kanban bridge surface, verified building clean.

**UI fix.** `fix(network)` — the Nexus agent-detail header (`.dh`) holds two action buttons (`▦ INSPECT` +
`▢ CLOSE`); a long agent name could shove them off a narrow right panel (the exact risk Run #5 flagged). Added
a defensive flex guard: `.dh` flex-wraps, `.dt` gets `min-width:0` and the name truncates with an ellipsis, and
the buttons get `white-space:nowrap; flex-shrink:0` so they keep size and wrap below the name when tight.
Verified live: `flex-wrap:wrap` + name `text-overflow:ellipsis` applied, both buttons present, no errors.

**New feature — Agent Performance Leaderboard (War Room).** A per-agent operational scoreboard behind a new
**LOAD ↔ PERF** toggle on War Room's agent panel. **Pure client aggregation** of the already-polled task store
— no new bridge endpoint. `src/lib/agentMetrics.ts` (`computeAgentMetrics`) groups `hermesTasks` by assignee →
done / running / failed counts, success rate, average task duration (`completed_at − started_at`) and trailing
24h completions, ranked by throughput; `nowMs` is passed in (seeded via a 0ms timeout, never `Date.now()` in
render) to stay render-pure. `src/components/AgentPerformance.tsx` renders a ranked table with per-agent
throughput bars, color-tiered success rate (emerald ≥85% / amber ≥60% / red below), responsive column collapse
and a graceful empty state. **How to access:** War Room → AGENT LOAD panel → click **PERF**. **Verified live
against real Hermes data:** 8 agents ranked, `signalscraper` top (6 done · 100% · 7m avg · 6 in 24h), failing
agents (`narratrix` 5 fail, `default` 1 fail) flagged red at 0%, unresolved agents show `—`; no console errors.

**Verify.** `npm run build` ✓ (tsc + vite, **116 modules**, up from 114), `npm run lint` ✓ (0 errors; the lone
warning is a pre-existing stale `eslint-disable` in committed `TaskDetailDrawer.tsx`, untouched), and a live
Vite preview pass on `/war-room` (PERF leaderboard with real data) and `/network` (header guard) — no React
errors. **Note for next run:** a concurrent Hermes self-audit (`scripts/audit-and-improve.py`) was editing
files mid-run (`.hermes/audit-*`, `scripts/`, `BRAND_STRATEGY.md` left untracked/unstaged — not part of this
run's commits).

### 2026-06-09 — Run #5 (branch `auto/evolve-task-search`)

**Tab audit findings.** Re-enumerated all 10 tabs from `nav.ts`/`App.tsx`/`Layout.tsx` (count unchanged
since Run #2). The consolidation backlog is nearly exhausted: every roster/cron/activity-log overlap flagged
across Runs #1–#4 is now resolved. The two items Run #4 queued were both handled this run — (1) the **Nexus
deck lacked an Agent Drill-Down entry point** (the slide-over was wired from only 2 of 3 roster surfaces) and
(2) the **Command Palette's agent results navigated to Agent Hub** rather than opening the shared drill-down.
Both fixed (see Consolidation). The **only remaining consolidation candidate** is Command vs Operations
task-creation duplication (CREATE TASK on both) — left untouched, conservatively, and explicitly flagged as
the last open item for the next run to decide.

**Consolidated — Agent Drill-Down now shared by all three roster surfaces + the palette.**
(1) **Nexus deck (`src/pages/GhostNetwork.tsx`)** — its in-page agent detail panel previously had no path to
the global drill-down. Added an `▦ INSPECT` button to the detail header (beside `▢ CLOSE`) that calls
`useAgentDrilldownStore.open(selected.name)`. The existing in-page telemetry panel is preserved; INSPECT is an
additional, deeper entry point, so Agent Hub + Command + Nexus all now open the same slide-over.
(2) **Command Palette (`src/components/CommandPalette.tsx`)** — selecting an `agent` result now calls
`openDrilldown(item.title)` in place instead of `navigate('/agent-hub')`; module/task/action results still
navigate. Wires the palette into the shared drill-down so searching an agent + Enter inspects it instantly.

**UI fixes.** (1) **Operations Center MISSION QUEUE** — replaced the fragile `maxHeight: calc(100% - 110px)`
magic-number on the task scroll list with a robust flex layout: the Panel body is now `flex flex-col`
(via the new `bodyClass` prop), the filter row and create-task footer are `shrink-0` siblings, and the scroll
list is `flex-1 min-h-0 overflow-auto`. No longer depends on hand-counting the filter+footer height. Verified
live: panel body is flex-col, scroll list uses `flex-1`, and `calc(100% - 110px)` is gone from the DOM.
(2) **AgentDrillDown** — when the clicked agent isn't in `useGhostStore.nodes` (e.g. opened from a stale
palette/search entry), the status strip fell back to `STATUS UNKNOWN / TYPE —` with no explanation. Added a
subtle amber hint ("Agent not in the current topology — showing its tasks & activity only…") so the empty
status reads as intentional rather than broken.

**New feature — Global Task Search (`⌘F` / `Ctrl+F`).** A keyboard-first overlay that deep-filters the
**entire** Hermes task queue — distinct from the ⌘K Command Palette (which jumps to nav modules/agents).
**Store:** `src/stores/useTaskFocusStore.ts` — a tiny global `{ focusId, nonce, focus(id), clear() }` so the
overlay can hand a task off to Operations (the `nonce` re-fires the scroll/highlight even when the same task
is chosen twice). **Component:** `src/components/TaskSearch.tsx` — subsequence fuzzy-search over
`useTaskStore.hermesTasks` across title / id / assignee / status, plus a row of status-filter chips
(ALL/READY/RUNNING/BLOCKED/DONE/FAILED); arrow-key nav, Enter opens, Esc/backdrop closes. Selecting a task
calls `focus(id)` + `navigate('/operations')`. **Operations wiring** (`src/pages/OperationsCenter.tsx`) — an
effect on `focusId`/`nonce` resets the status filter to ALL (so the task is guaranteed visible), scrolls the
matching `[data-task-id]` row into view (`block:'center'`, smooth) and flash-highlights it (coral ring) for
2.4s, then clears the focus. **Mounted** once in `Layout.tsx` with a `⌕ ⌘F` topbar button (beside `⌘K`).
**No new bridge endpoint** — pure client filter of the already-globally-polled task store. **How to access:**
press `Ctrl/⌘ F` anywhere, or click `⌕ ⌘F` in the top bar; type to filter, ↑↓ to navigate, ↵ to jump to the
task in Operations. **Verified live** (bridge offline): overlay opens via the shortcut + topbar button,
renders the status-filter chips + footer (`TASK SEARCH · ⌘F`), and degrades gracefully to "No tasks in the
queue yet." with an empty store; no React/render console errors (only the expected bridge-offline network
warnings).

**Verify.** `npm run build` ✓ (tsc + vite, **114 modules**, up from 112), `npm run lint` ✓ (0 issues), and a
live Vite preview pass: `/operations`, `/network` and the topbar all render with no React errors (only
pre-existing bridge-offline network warnings); confirmed the ⌘F overlay opens/closes, the Operations flex
layout (no magic-number), and both `⌕ ⌘F` + `⌘K` topbar buttons present.

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
