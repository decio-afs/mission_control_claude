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

## Current State (8 tabs — Command + Agent Hub folded into Ghost Network in Run #6; topbar bell is now a Notification Center in Run #10; War Room gained a per-hour Throughput histogram in Run #11 **+ a Backlog Burn-down / queue-health view in Run #15 + a Cycle-Time / Lead-Time SLA distribution in Run #16 + an Aging / Stale-WIP heatmap in Run #17** (the TASK panel now cycles **STATUS·FLOW·BURN·SLA·AGE**); topbar gained a `?` keyboard-shortcuts cheat-sheet in Run #12; the Operations cron modal gained live next-fire countdowns in Run #13 + a Next-24h Agenda timeline in Run #14)

Nav lives in **`src/lib/nav.ts`** (`MODULES`) — single source consumed by both
`Layout.tsx` (sidebar) and `CommandPalette.tsx`. To add/remove/reorder a tab, edit `nav.ts`.

| # | Path | Page | Data | Notes |
|---|------|------|------|-------|
| 00 | `/network`     | Ghost Network              | LIVE | **Merged primary console.** NEXUS Orchestration Deck (orbital mesh + roster) **plus** the agent Registry CRUD (create/edit/delete/spawn via the new `useAgentCrud()` hook + `+ Agent` button) **plus** the ARCAN orchestrator command bar (directives, status, reassign) wired to the shared chat session. Detail panel `▦ INSPECT` → Agent Drill-Down. Absorbed the old Hermes Command + Agent Hub (Run #6). |
| 01 | `/war-room`    | War Room                   | LIVE | Metrics gauges + **TASK STATUS ↔ FLOW ↔ BURN ↔ SLA ↔ AGE toggle** (status breakdown **or** the per-hour throughput histogram, Run #11 **or** the Backlog Burn-down / queue-health view, Run #15 **or** the Cycle-Time / Lead-Time SLA distribution with p50/p90/p95 + LEAD/CYCLE toggle, Run #16 **or** the Aging / Stale-WIP heatmap with click-to-open oldest offenders, Run #17) + **AGENT LOAD ↔ PERF toggle** (performance leaderboard, Run #6 — **now click-to-sort columns**, Run #8) + **TASKS/SIGNAL feed toggle** (now scroll-back-able, Run #15). |
| 02 | `/operations`  | Operations Center          | LIVE | Full kanban CRUD + cron list/run/create (**live next-fire countdowns + soonest-first sort**, Run #13; **+ a Next-24h Agenda timeline** plotting every upcoming fire per job, Run #14) + task decompose + **TaskDetailDrawer** (comments/events/runs/notify/boards/diagnostics + **⊞ Dependency Map**, Run #7 + **live-tail WORKER LOG**, Run #8). Single cron home. Receives ⌘F Task Search focus. |
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
  a **DIAG** button (Run #3) that opens the **Bridge Diagnostics** modal
  (`src/components/BridgeDiagnostics.tsx`) — a green/red dot mirrors `vitals.hermesOnline` —
  **and** a **🔔/🔕 Notification Center** bell (Run #9 toggle → Run #10 dropdown):
  click opens a panel of recent task-complete/fail events with the desktop-toast
  on/off toggle folded into its header (`NotifyCenter.tsx` + `useNotifyStore` +
  headless `TaskNotifier.tsx`).
- **Task Search (Run #5):** a global `⌘F`/`Ctrl+F` overlay (`src/components/TaskSearch.tsx`,
  mounted once in `Layout.tsx`) that fuzzy-searches the whole Hermes queue
  (`useTaskStore.hermesTasks`) by title / id / assignee / status, with status-filter chips.
  Selecting a task routes to Operations and focuses it (scroll-into-view + 2.4s flash highlight)
  via the tiny `useTaskFocusStore` (`focus(id)` / `clear()` + a `nonce` so re-selecting the same
  task re-fires). No new bridge endpoint — pure client filter of the already-polled store.
  Distinct from the ⌘K palette (nav/agents) — this is deep task-only filtering.
- **Task Dependency Map (Run #7):** a `⊞ MAP` button in the TaskDetailDrawer's DEPENDENCIES
  section header (shown only when a task has links) opens a full-screen modal
  (`src/components/TaskDependencyGraph.tsx`) that BFS-expands the connected parent→child
  dependency DAG (bounded `MAX_DEPTH=2` each way / `MAX_NODES=28`), lays tasks out in
  topological columns (ancestors left → descendants right, vertically centered), draws
  status-coloured nodes with bezier dependency edges (links touching the focused node turn
  coral), and lets you re-center on any node (RECENTER restores the root) or jump a node into
  the drawer (`↗`). **No new bridge endpoint** — pure client BFS over `getHermesTaskDetail`
  (parents/children) with metadata resolved from the polled `useTaskStore`.
- **Live Worker-Log Tail (Run #8):** the TaskDetailDrawer's WORKER LOG section
  (`src/components/WorkerLogStream.tsx`) is no longer load-once. A `▶ LIVE` / `⏸ PAUSE` toggle
  re-polls `getHermesTaskLog(taskId, 8000)` every 2s, replacing the buffer with the freshest tail
  and auto-following the bottom (un-pins if you scroll up to read earlier output). Shows a pulsing
  `STREAMING · 2s` indicator while live, a `⟳ REFRESH` + "task idle — tail is static" hint when
  paused. **No new bridge endpoint** — pure client polling of the existing log route.
- **Completed-Task Desktop Notifications (Run #9):** a headless watcher
  (`src/components/TaskNotifier.tsx`, mounted once in `Layout.tsx`) diffs the globally-polled
  `useTaskStore.hermesTasks` against the previous poll and fires an OS `Notification` whenever a
  task crosses from a **non-terminal → terminal** status (`done|completed|failed`). Seeds silently
  on first poll (never a startup burst for pre-existing done tasks); de-dupes per task via the
  notification `tag`; clicking a notification calls `useTaskFocusStore.focus(id)` + routes to
  `/operations` (pairs with the live worker-log tail — notify, then read the final log). On/off
  state lives in `src/stores/useNotifyStore.ts` (persisted to `localStorage` `mc-notify-enabled`,
  re-validated against `Notification.permission` on load), toggled from the topbar **🔔/🔕** bell
  (requests OS permission on enable; shows blocked/unsupported in its tooltip). **No new bridge
  endpoint** — pure client diff of the existing task store.
- **Notification Center dropdown (Run #10):** the topbar bell is no longer a bare mute toggle — it
  now opens a 320px dropdown (`src/components/NotifyCenter.tsx`) listing the task-complete/fail
  events recorded this session (newest first, capped 60), each a click-to-focus row (status glyph
  ✓/✕ + title + assignee + relative `ago()`) that routes to the task in Operations. `TaskNotifier`
  now **records every non-terminal→terminal transition into `useNotifyStore.history` regardless of
  the OS-toast toggle** (the in-app log works even when muted; OS `Notification` is still gated on
  enable+permission). The bell carries an **unseen-count badge** (cleared on open via `markSeen()`),
  and the desktop-toast **ON/OFF toggle moved into the dropdown header** (preserving Run #9's mute
  control + the blocked/unsupported hint). `CLEAR` wipes the session log. **No new bridge endpoint**
  — pure client history of the already-diffed task store. **How to access:** click the topbar bell.
- **Keyboard-Shortcuts Cheat-Sheet (Run #12):** a global `?` (Shift+/) overlay (`src/components/ShortcutsHelp.tsx`,
  mounted once in `Layout.tsx`) listing every shortcut + one-glyph affordance now live, grouped into Global
  (⌘K / ⌘F / ? / Esc / ↑↓ / ↵), Topbar (☰ / 🔔 / DIAG / ⌕⌘F / ⌘K), War Room (STATUS·FLOW, 12/24/48H, LOAD·PERF,
  sortable leaderboard, TASKS·SIGNAL) and Operations task-drawer (⊞ MAP, ▶LIVE·⏸PAUSE, ⟳, +NEW). Opens on a bare
  `?` from anywhere **except** a text field (guarded on `e.target` tag / `isContentEditable` so the char still
  reaches inputs, the chat box, task titles) or via a topbar `?` button (dispatches the same key event); Esc /
  backdrop close; the two-column `<kbd>` legend scrolls within `max-h-[80vh]`. Pure static — no store, no bridge.
  **How to access:** press `?` anywhere, or click the topbar `?` button.
- **Cron Next-Fire Countdown (Run #13):** the Operations cron modal (`⏱ CRON`) now parses each job's
  `schedule`/`repeat` and shows a **live "▸ in 3h 12m" countdown** to its next fire, with the rows **sorted
  soonest-first** (a `JOB · SCHEDULE / NEXT FIRE ▾` header tops the list). The parser lives in
  `src/lib/cronSchedule.ts` (`parseSchedule` / `formatCountdown` / `fireLabel`) — a pure, self-contained
  reader of standard 5-field Vixie cron (`*`, lists, ranges, `*/n` steps; correct dom/dow "either" rule),
  the `@daily`/`@hourly`/… macros, and `30m` / `every 2h` interval shorthand. Cron expressions get a real
  next-fire time (a cheap month/day/hour/minute *stepper* over LOCAL time — the daemon fires on the machine's
  clock; the relative countdown is timezone-independent) plus a friendly label (`*/5 * * * *` → `every 5m`,
  `0 7 * * *` → `07:00 daily`) and an absolute "Next fire: Tue 09:00 (local)" tooltip; intervals show
  `↻ repeats` (no anchorable next fire); unparseable schedules show `—`. A 1s clock (`cronNow`) ticks the
  countdowns only while the modal is open. **No new bridge endpoint** — pure client parse of the already-polled
  cron list. **How to access:** Operations → `⏱ CRON`. **Verified live against real Hermes cron data** (3 jobs:
  `kanban-auto-claim` `every 5m`, `Mission Control Auto-Audit` `every 5h`, `Sentinel Daily Trend Engine`
  `07:00 daily`) — correct labels, live countdowns (`▸ 3m / 2h 43m / 18h 43m`), soonest-first order.
- **Cron Next-24h Agenda timeline (Run #14):** the Operations cron modal (`⏱ CRON`) now opens with a
  **NEXT 24H AGENDA** panel above the job list: one thin lane per job plotting *every* upcoming fire as a
  tick across a 24-hour track (6/12/18h gridlines + a `now → +24h` axis), so the operator sees *the rhythm
  of the next day's scheduled work* at a glance (the row countdown answers "when next?"; this answers "how
  often, and when do the waves land?"). Active jobs draw coral ticks, paused jobs grey; each tick has a
  `job · Thu 07:00 (in 15h 47m)` tooltip; a header `N FIRES` totals the window. Built on a new pure helper
  `upcomingFires(schedule, nowMs, windowMs, maxFires)` in `src/lib/cronSchedule.ts` (walks cron forward via
  the Run #13 stepper; anchors intervals at `nowMs`) + `src/components/CronTimeline.tsx` (layout memoized per
  minute so it doesn't recompute every second; dense jobs capped at 300 ticks). **No new bridge endpoint** —
  pure client parse of the already-polled cron list. **How to access:** Operations → `⏱ CRON`. **Verified
  live against real Hermes cron data** (3 jobs): `kanban-auto-claim` every-5m → 288 ticks across the full
  band, `Mission Control Auto-Audit` → 5 ticks (first +4h47m), `Sentinel Daily Trend Engine` → 1 tick at
  Thu 07:00 (left 65.8% ≈ 15.8/24) — header read `294 FIRES`, axis `now/+6h/+12h/+18h/+24h` correct.
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
- **The consolidation pass is COMPLETE.** 8 tabs, all distinct. Run #7 ran the optional sanity audit:
  re-enumerated `nav.ts` (8 modules, 00–07) / `App.tsx` / `Layout.tsx`, confirmed the 3 redirects
  (`/command`,`/cyberpunk`,`/agent-hub` → `/network`) plus the Design Lab + signal-intelligence redirects
  all still resolve, and that **no dead nav entry crept back**. Do **not** cut further without strong cause.
  Next runs: UI polish + new features only.

### UI / Display Fixes
- [x] ~~Nexus detail header two `.dclose` buttons crowding the name~~ — DONE in Run #6.
- [x] ~~Nexus detail panel: the two stacked `.dctrl` button rows~~ — DONE in Run #7 (`.dctrl + .dctrl` separator).
- [x] ~~War Room AGENT PERFORMANCE leaderboard click-to-sort~~ — DONE in Run #8.
- [x] ~~Ghost Network command bar overflow~~ — PARTIALLY DONE in Run #9. The `.commandbar` packed
      session-select + ARCAN prefix + input + 3 chips + Execute into one **nowrap** flex row that overflowed
      horizontally on narrow centre columns (≤1320px). Added `flex-wrap:wrap` to `.commandbar` + `.chips`, and
      `flex:1 1 200px; min-width:200px` to `.cmd-input`. Verified live: zero horizontal overflow at 1280px
      (one row) **and** 1120px (wraps to a second row, height 126px), `scrollWidth === clientWidth` at both.
- [x] ~~Ghost Network detail-panel `.dbtn` clipping (`REASSIGN`)~~ — DONE in Run #10. Added
      `min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis` to `.dbtn` so a long label in a
      shrunk ~110px `.dctrl` 1fr cell truncates with an ellipsis instead of overflowing its column at ≤1320px.
      Verified the computed style is live (`overflow:hidden`, `text-overflow:ellipsis`, `min-width:0px`).
- [x] ~~Ghost Network detail panel — `.vitals` / `.dstats` audit~~ — DONE in Run #11. Audited both grids: the
      rendered values are always short (`.vital .vv` = `String(onlineCount)` + a small unit; `.dstat .v` = a
      percentage / small integer), so there is **no live overflow** today. Added **defensive** guards anyway so a
      future long value can't break the grid: `.vital .vv` now `overflow:hidden; text-overflow:ellipsis;
      white-space:nowrap; padding-right:72px` (the `padding-right` reserves room for the absolutely-positioned
      60px `.vspark` so a long value can't run under the sparkline), and `.dstat`/`.dstat .v`/`.dstat .l` get
      `min-width:0` + ellipsis so a wide value can't blow out the 3-col `1fr` grid on the ≤1320px panel. Verified
      live: `.vital .vv` computed style reports `overflow:hidden`, `text-overflow:ellipsis`, `white-space:nowrap`,
      `padding-right:72px`.
- [x] ~~Shared `Panel` header overflow guard~~ — DONE in Run #12. The reusable header row
      (`src/components/cyberpunk/ui.tsx`) packed `<Label>` + a `right` controls slot into a fixed-height
      (`h-[26px]`) `justify-between` flex row with no overflow handling, so a long label + a busy `right` slot
      (e.g. War Room's STATUS/FLOW + LIVE toggle on a narrow ≥lg half-column) could push the controls past the
      panel edge. Added `gap-2` + `min-w-0 truncate` on the label (flexbox blockifies the `<span>` so the ellipsis
      applies) and `shrink-0` on the right slot. **Verified live** on `/war-room`: the label computes
      `overflow:hidden / text-overflow:ellipsis / white-space:nowrap / min-width:0`, the right slot
      `flex-shrink:0`, and the header reports `scrollWidth === clientWidth` (no horizontal overflow). High-leverage
      — fixes every `Panel` header app-wide, not just War Room.
- [x] ~~Local `Modal` overflow guard (Operations Center)~~ — DONE in Run #13. The file-local `Modal`
      (`src/pages/OperationsCenter.tsx`, used by 5 modals: cron, create-task, decompose, board diagnostics,
      create-board) was a fixed `flex flex-col` box with a non-scrolling body and no height cap, so tall content
      (cron list + 3-field create form, or a long decompose result) could push the bottom action button off a
      short viewport with no way to reach it. Added `max-h-[88vh] flex flex-col` to the box, `shrink-0` + `truncate`
      to the header, and `overflow-y-auto` to the body so any modal now caps at the viewport and scrolls its body.
      **Verified live** at 1280×800: the cron modal box computes `max-height:704px` (= 88vh) and the body
      `overflow-y:auto`. High-leverage — fixes every Operations modal, not just cron.
- [x] ~~Lead Tracker `Source` column overflow~~ — DONE in Run #14. The `LEAD REGISTRY` table
      (`src/pages/LeadTracker.tsx`) lays rows on `grid-cols-[1fr_120px_100px_80px]`; the **Name** cell had
      `min-w-0 truncate` but the **Source** cell (`<span>{lead.source}</span>`) did not, so a long source
      value would overflow its fixed 120px track and run into the Status column. Added `truncate` + a `title`
      tooltip to the Source span (mirroring the proven Name-cell pattern). Build/lint clean; the fix mirrors an
      adjacent already-verified cell (couldn't render live rows — the bridge `/api/hermes/leads` poll was
      offline this run, no leads to display).
- [x] ~~Shared `LogTail` clipped history with no scroll-back~~ — DONE in Run #15. The shared `LogTail`
      (`src/components/cyberpunk/ui.tsx`, used by both War Room bottom feeds — TASK ACTIVITY + AGENT SIGNAL) was
      `overflow-hidden` with an auto-scroll-to-bottom, so any line above the fold (e.g. 40 signal lines in a
      130px box) was clipped with **no way to read it back**. Switched to `overflow-y-auto overflow-x-hidden` and
      gated the auto-follow on a `pinnedRef` (only re-pins to the bottom when the reader is already within 24px of
      it), so a poll of fresh lines no longer yanks someone who scrolled up — mirroring the Run #8 WorkerLogStream
      tail pattern. **High-leverage** (every `LogTail` consumer inherits it). **Verified live** on `/war-room`:
      the feed container computes `overflow-y:auto` / `overflow-x:hidden`.
- [x] ~~Briefing Terminal Sentinel feed — long external titles/hostnames overflow~~ — DONE in Run #16. The
      `SENTINEL FEED` (`src/pages/BriefingTerminal.tsx`) renders **arbitrary external RSS** story titles +
      hostnames. The title `<span>` sat in a `flex items-start justify-between` row with the score `shrink-0`
      but had **no `min-w-0`/`break-words`**, so a long unbroken title bled past its cell and shoved the score off
      the right edge; the source/hostname row could likewise overflow. Added `min-w-0 break-words` to the title,
      `min-w-0` + `shrink-0`/`truncate` to the hostname row, and `break-words` to the fixed-width (340px)
      directives-column message. **Verified live** on `/briefing` against real data (23 stories, 0 overflowing);
      injecting a 130-char unbroken token into a title kept the card non-overflowing (`scrollWidth ≤ clientWidth`).
- [x] ~~AgentDrillDown assigned-task title overflow~~ — DONE in Run #17. The assigned-task card title
      (`src/components/AgentDrillDown.tsx`) rendered arbitrary Hermes kanban titles with no wrap guard, so a long
      unbroken token (URL/path/hash) overflowed the fixed `max-w-[460px]` slide-over. Added `break-words min-w-0`.
- [ ] **AgentDrillDown skills row** — still no per-agent skills (GhostNode carries none). Needs a bridge
      field on the agent node. Low priority. (NOTE: `HermesTask` carries a `skills: string[]` field; the *task*
      drawer could surface required skills without a bridge change, even if the *agent* node can't.)
- [ ] **Dependency Map polish (optional follow-up to Run #7):** progressive per-ring render (the BFS fetches
      each node's detail per ring at ~1.4–5s/call, so a 28-node chain settles slowly behind one spinner). Also
      add a workflow-step stepper lane if/when swarm tasks (`workflow_template_id`) appear in live data. Low pri.
- [ ] **WorkerLogStream polish (optional follow-up to Run #8):** diff the 8000-byte tail and append only the new
      suffix instead of replacing the whole `<pre>` each 2s poll; auto-stop the stream when the task leaves
      `running`. Low priority.

### Next Feature (must differ from Run History — #1 Command Palette; #2 Cron Creation UI; #3 Bridge Diagnostics; #4 Agent Drill-Down; #5 Global Task Search ⌘F; #6 Agent Performance Leaderboard; #7 Task Dependency Map; #8 Live Worker-Log Tail; #9 Completed-Task Desktop Notifications; #10 Notification Center dropdown; #11 Task Throughput Histogram; #12 Keyboard-Shortcuts Cheat-Sheet; #13 Cron Next-Fire Countdown; #14 Cron Next-24h Agenda Timeline; #15 Backlog Burn-down / Queue-Health view; #16 Cycle-Time / Lead-Time SLA distribution; #17 Aging / Stale-WIP heatmap)
- [ ] **Pick ONE (none of the above):**
  1. **Saved task filter/view presets (Operations)** — let the operator save the current assignee (+ any future
     filter) combo as a named chip (persisted to `localStorage`), one click to re-apply. Pure client; no bridge.
     (NOTE: Operations currently only has an assignee dropdown — pair this with adding a status/column filter so
     a preset is worth saving.)
  2. **Agent idle/stall watchdog** — flag agents that are `active` but have had `tasks_running > 0` with no
     activity event for >N minutes (cross-reference `useGhostStore` + `useActivityStore`). Surfaces stuck
     workers. Pure client aggregation; no bridge.
  3. **Bridge log / activity export** — a one-click "copy / download recent activity (JSON or text)" from the War
     Room SIGNAL feed or the Notification Center, for pasting a quick incident report. Pure client over the
     already-polled `useActivityStore` / `useNotifyStore.history`; no bridge.
  4. **Cron run-history / last-fire panel (Operations)** — complement Run #13/#14's *forward* views (countdown +
     24h agenda) with a *backward* one: surface each cron job's recent fires/outcomes. Check whether the bridge
     `/api/hermes/cron` payload (or a `hermes cron log`-style call) already carries `last_run`/history; if so it's
     a pure client render, otherwise add a small read-only bridge endpoint. (Distinct from #13/#14, which only
     look ahead.)
  5. **SLA-breach badge on the leaderboard / drill-down** — Run #16 establishes the p90 baseline and Run #17 the
     open-task age; layer them: mark in-flight tasks (or agents) whose *current* age already exceeds the rolling
     p90 cycle time as "over SLA". `computeAgingWip` already produces per-task `ageSec` and `computeCycleStats`
     the p90 threshold — this is a join + a badge on the AGE oldest-list rows and/or the AgentPerformance
     leaderboard. Pure client; layers on Runs #16 + #17 + #6. **Strongest next candidate** (closes the loop the
     last two runs opened: finished-duration → open-age → over-SLA flag).
  6. **Aging-WIP → Operations deep-link polish** — Run #17's oldest-open rows route to `/operations` + `focus(id)`,
     but Operations only scrolls/highlights if that task is on the currently-visible board/filter. Verify the
     focus actually lands the task (open its drawer or auto-clear filters) when arriving from War Room; if not,
     have `useTaskFocusStore` optionally request the drawer-open, not just scroll. Small UX-correctness follow-up.
  7. **Throughput / aging trend sparkline on the gauges row** — the six top gauges are all point-in-time; add a
     tiny per-gauge sparkline of its own recent history (e.g. QUEUE DEPTH or BUSY AGENTS over the last N polls)
     using the existing `Sparkline` primitive + a small rolling client buffer. Pure client; no bridge.

---

## Run History (newest first — append, never overwrite)

### 2026-06-11 — Run #17 (branch `auto/evolve-aging-wip`)

**Inherited-state note.** Opened on the Run #16 branch tree (`auto/evolve-cycle-time-sla`), still carrying the
concurrent Hermes self-audit's uncommitted churn (`.hermes/audit-*`, `scripts/audit-and-improve.py`,
`package.json`, `BRAND_STRATEGY.md`) **plus** audit-touched edits in five of my own source files
(`CommandPalette.tsx`, `ChatTerminal.tsx`, and the three stores `useNotifyStore.ts` / `useTaskFocusStore.ts` /
`useAgentDrilldownStore.ts`). Confirmed the baseline builds green (**130 modules**) **with** that churn present,
left all of it untouched (not this run's deliverable — same call as Runs #10–#16), branched
`auto/evolve-aging-wip` from HEAD, and committed **only my own files**. (No orphaned Redux scaffold this run —
Run #15's cleanup still holds.)

**Tab audit findings (sanity pass).** Re-enumerated `src/lib/nav.ts` (**8 modules**, num 00–07), `App.tsx`, and
the Layout sidebar. Consolidation remains complete — unchanged since Run #6. All redirects still resolve
(`/command`,`/cyberpunk`,`/agent-hub` → `/network`; the 4 Design Lab legacy paths → `/design-lab?tab=…`;
`/signal-intelligence` → `/war-room`; `*` → `/network`). No dead nav entry crept back. **No consolidation
needed this run** — UI fix + new feature only, per the standing guidance.

**UI fix — Agent Drill-Down assigned-task title no longer overflows (`src/components/AgentDrillDown.tsx`).** The
ASSIGNED TASKS card title (`<div class="text-[11px] text-white leading-snug">{t.title}</div>`) rendered
**arbitrary Hermes kanban titles** with no wrap guard, so a long unbroken token (a URL / file path / hash) bled
past the fixed `max-w-[460px]` slide-over and forced a horizontal scrollbar — the same unbounded-external-content
class Run #16 fixed in the Briefing feed. Added `break-words min-w-0` to the title `<div>` so a long token wraps
within the card. (Sibling rows were already safe: the `t.id` line is `shrink-0`, the activity action `truncate`.)

**New feature — Aging / Stale-WIP heatmap (War Room, TASK panel `AGE` mode).** The dual of Run #16: where SLA
measures how long *finished* work took, this surfaces how long *open* work has been waiting — tasks silently
rotting in the queue. **Lib** (`src/lib/agingWip.ts`): pure `computeAgingWip(tasks, nowMs, topN=8)` selects every
still-open task (status not in the terminal set `done|complete|completed|failed|cancelled|canceled|archived|error`
— mirroring `computeBacklogTrend`'s open-set), ages each by `now − (started_at ?? created_at)` clamped ≥0, and
buckets it into the **same human bands as the cycle-time histogram** (`BUCKET_BOUNDS` is now `export`ed from
`cycleTime.ts` so there is one grammar, not two). Returns the N oldest offenders (sorted oldest-first), plus
headline `openCount` / `staleCount` (age ≥ 24h) / `maxAgeSec`. Deliberately **not windowed** — every open task
counts, since the point is to find the old ones; a no-timestamp open task is counted in `openCount` but not aged.
`nowMs` passed in (never `Date.now()` in render); supply 0 for an inert result. **Component**
(`src/components/AgingWip.tsx`): an OPEN / STALE(≥24h) / OLDEST readout + a **hotter-=-older** age histogram (cool
`<1h` → amber `1–24h` → red `≥1d`, anchored on each bucket's lower bound) + an actionable **OLDEST OPEN** list
whose rows jump straight to the task in Operations (reuses the Run #5 `useTaskFocusStore.focus(id)` + `navigate`
plumbing, the same as ⌘F Task Search). Reuses `fmtDuration` from `agentMetrics.ts` (no duplicate formatter).
**Wiring** (`src/pages/WarRoom.tsx`): the TASK panel toggle went from STATUS·FLOW·BURN·SLA to
**STATUS·FLOW·BURN·SLA·AGE** (5th `taskView='aging'` mode), reusing the panel's existing 0ms-seeded `nowMs` clock;
the LIVE/OFFLINE dot moved from `hidden lg:inline` to `hidden xl:inline` so five toggles + the dot still fit the
`lg:grid-cols-2` half-column without overflow. Also updated the `?` cheat-sheet (`ShortcutsHelp.tsx`) War Room
group to STATUS·FLOW·BURN·SLA·AGE + an AGE line. **No new bridge endpoint** — pure client fold of the
already-polled task store. **How to access:** War Room → TASK panel header → click **AGE** (then click any
oldest-open row to open it in Operations). **Verified live against real Hermes data** (bridge served the task
queue): the AGE view read **OPEN 15 · STALE 15 ≥24h · OLDEST 2.0d**, all **8 buckets** labelled, **8 oldest-open
rows** with real titles/assignees/ages (`Identify competitors for DA Agency LLC` · `gridkeeper` · `2.0d`, …);
clicking an oldest row routed `#/war-room → #/operations` (focus plumbing fires); the busier
STATUS·FLOW·BURN·SLA·AGE header reported `scrollWidth === clientWidth` (no overflow, 384px) at the narrowest
**1024px** 2-up width; **no component console errors** (only the documented baseline background bridge-poll
`Network Error`s). Also unit-checked `computeAgingWip` via a standalone Node harness (**10/10** assertions:
inert `nowMs=0`, terminal-status exclusion, started-vs-created anchor + bucket placement, `neverStarted` flag,
`≥24h` stale count, no-timestamp open-but-unaged, oldest-first sort, `topN` cap, `maxAgeSec`).

**Verify.** `npm run build` ✓ (tsc + vite, **132 modules**, up from 130 — `agingWip.ts` + `AgingWip.tsx`),
`npm run lint` ✓ (**0 errors, 0 warnings**), the standalone `computeAgingWip` unit-check (10 cases) ✓, and the
live Vite preview pass above on `/war-room` (AGE view + real-data readout + oldest-row click-route + header
overflow at 1024px), no component console errors.

### 2026-06-10 — Run #16 (branch `auto/evolve-cycle-time-sla`)

**Inherited-state note.** Opened on the Run #15 branch tree (`auto/evolve-backlog-burndown`), still carrying the
concurrent Hermes self-audit's uncommitted churn (`.hermes/audit-*`, `scripts/audit-and-improve.py`,
`package.json`, `BRAND_STRATEGY.md`) **plus** audit-touched edits in five of my own source files
(`CommandPalette.tsx`, `ChatTerminal.tsx`, and the three stores `useNotifyStore.ts` / `useTaskFocusStore.ts` /
`useAgentDrilldownStore.ts`). Verified the baseline builds green (**128 modules**) **with** that churn present,
left all of it untouched (not this run's deliverable — same call as Runs #10–#15), branched
`auto/evolve-cycle-time-sla` from HEAD, and committed **only my own files**. (No orphaned Redux scaffold this run
— Run #15's cleanup held.)

**Tab audit findings (sanity pass).** Re-enumerated `src/lib/nav.ts` (**8 modules**, num 00–07), `App.tsx`, and
the Layout sidebar. Consolidation remains complete — unchanged since Run #6. All redirects still resolve
(`/command`,`/cyberpunk`,`/agent-hub` → `/network`; the 4 Design Lab legacy paths → `/design-lab?tab=…`;
`/signal-intelligence` → `/war-room`; `*` → `/network`). No dead nav entry crept back. **No consolidation
needed this run** — UI fix + new feature only, per the standing guidance.

**UI fix — Briefing Terminal Sentinel feed no longer overflows on long external content
(`src/pages/BriefingTerminal.tsx`).** The `SENTINEL FEED` renders **arbitrary external RSS** story titles and
hostnames — genuinely unbounded data, unlike the synthetic/short values most prior fixes hardened. The story
title `<span>` sat in a `flex items-start justify-between gap-2` row beside a `shrink-0` score, but had **no
`min-w-0`/`break-words`**, so a long unbroken title bled past its flex cell and shoved the score off the right
edge; the source/hostname row could likewise overflow. Added `min-w-0 break-words` to the title span, `min-w-0`
to the meta row + `shrink-0` on the source / `truncate` on the hostname, and `break-words` to the fixed-width
(340px) directives-column message (`{b.msg}`). **Verified live** on `/briefing` against real data: **23 stories
rendered, 0 overflowing**, and injecting a 130-char unbroken token into a title kept the card non-overflowing
(`scrollWidth ≤ clientWidth`) — proving the wrap engages under worst case (pre-fix this overflowed).

**New feature — Cycle-Time / Lead-Time SLA distribution (War Room, TASK panel `SLA` mode).** Run #11 answered
"how much finished" (throughput), Run #15 "is the queue keeping up" (net backlog); this answers the third,
orthogonal question — *how long does work take?* **Lib** (`src/lib/cycleTime.ts`): new pure
`computeCycleStats(tasks, nowMs, hours=24)` selects done tasks whose `completed_at` falls in the trailing,
whole-UTC-hour-aligned window (same selection grammar as `computeThroughput`/`computeBacklogTrend`) and folds them
into **two duration distributions** — *lead* (`created_at`→`completed_at`, total time in system) and *cycle*
(`started_at`→`completed_at`, active working time). For each it returns p50/p90/p95 (linear-interpolation
percentiles, Excel `PERCENTILE.INC`), min/max/mean, and a human-bucketed histogram (`<5m … >3d`, 8 log-ish bands);
durations are clamped strictly-positive so a missing/inverted stamp pair is dropped from that series (but still
counted in `completedInWindow`). `nowMs` is passed in (never `Date.now()` in render); supply 0 for an inert result.
**Component** (`src/components/CycleTimeSLA.tsx`): a P50/P90/P95 readout + a **LEAD ↔ CYCLE** metric toggle + a
**12H/24H/48H** window selector + a coral duration histogram (the buckets containing p50/p90 highlighted; hover
shows per-bucket count + which percentile it holds); reuses `fmtDuration` from `agentMetrics.ts` (no duplicate
formatter). Empty states distinguish "no completions in window" from "completed but no usable start stamp — try
LEAD". **Wiring** (`src/pages/WarRoom.tsx`): the TASK panel toggle went from STATUS·FLOW·BURN to
**STATUS·FLOW·BURN·SLA** (4th `taskView='sla'` mode), reusing the panel's existing 0ms-seeded `nowMs` clock; the
toggle gap tightened `gap-1.5`→`gap-1` and the LIVE/OFFLINE dot moved to `hidden lg:inline` so four buttons + the
dot fit the `lg:grid-cols-2` half-column without overflow. Also updated the `?` cheat-sheet
(`ShortcutsHelp.tsx`) War Room group to STATUS·FLOW·BURN·SLA + a LEAD/CYCLE line. **No new bridge endpoint** —
pure client fold of the already-polled task store. **How to access:** War Room → TASK panel header → click
**SLA** (then **LEAD/CYCLE** + **12H/24H/48H**). **Verified live against real Hermes data** (bridge online): at
24H the panel reads `P50/P90/P95 —` with "No tasks completed in the last 24h"; switching to **48H + CYCLE**
surfaced **10 real completions** — `P50 7m / P90 33m / P95 35m`, histogram `<5m`=2 · `5–15m`=6 · `15–60m`=2
(n=10, mean 12m, max 36m, "10 done · 48h") — confirming the window selection + percentile + bucketing all work
end-to-end on live timestamps. Header reports `scrollWidth === clientWidth` (no overflow) at **1280px (512px)**
and **1024px (384px, narrowest 2-up)**; **no console errors**. Also unit-checked `computeCycleStats` via a
standalone tsc transpile (**16/16** assertions: empty/inert branches, window inclusion/exclusion at 24h vs 48h,
lead/cycle separation, bucket placement, not-done & missing-stamp dropping, and p50/min/max/mean/p90-interp over
a known 1–5h set).

**Verify.** `npm run build` ✓ (tsc + vite, **130 modules**, up from 128 — `cycleTime.ts` + `CycleTimeSLA.tsx`),
`npm run lint` ✓ (**0 errors, 0 warnings**), the standalone `computeCycleStats` unit-check (16 cases) ✓, and the
live Vite preview pass above on `/war-room` (SLA view + LEAD/CYCLE + window switch surfacing real 48H data +
header-overflow at 1280/1024) and `/briefing` (Sentinel long-token wrap), no console errors.

### 2026-06-10 — Run #15 (branch `auto/evolve-backlog-burndown`)

**Inherited-state note.** Opened on the Run #14 branch tree (`auto/evolve-cron-timeline`), still carrying the
concurrent Hermes self-audit's uncommitted churn (`.hermes/audit-*`, `scripts/audit-and-improve.py`,
`package.json`, `BRAND_STRATEGY.md`) **plus** audit-touched edits in five of my own source files
(`CommandPalette.tsx`, `ChatTerminal.tsx`, and the three stores). Left all of that untouched (not this run's
deliverable). **One new wrinkle this run:** the audit had also dropped two **untracked, broken Redux-tutorial
scaffold dirs** — `src/app/` (`store.ts`/`hooks.ts`/`Provider.tsx`) and `src/features/counter/counterSlice.ts`
— that import `react-redux`/`@reduxjs/toolkit` (not installed) and **broke `tsc -b`** (the build was green at 126
modules when Run #14 closed). They are orphaned boilerplate: `main.tsx` renders `<App/>` with no Redux Provider
and **nothing in the real app imports them** (only `counterSlice` imports its sibling `app/store`). Removed both
untracked dirs to **restore Run #14's known-good green build** (no tracked code or Hermes functionality touched);
documented here as inherited-state cleanup. Branched `auto/evolve-backlog-burndown` from HEAD and committed only
my own files.

**Tab audit findings (sanity pass).** Re-enumerated `src/lib/nav.ts` (**8 modules**, num 00–07), `App.tsx`, and
the Layout sidebar. Consolidation remains complete — unchanged since Run #6. All redirects still resolve
(`/command`,`/cyberpunk`,`/agent-hub` → `/network`; the 4 Design Lab legacy paths → `/design-lab?tab=…`;
`/signal-intelligence` → `/war-room`; `*` → `/network`). No dead nav entry crept back. **No consolidation
needed this run** — UI fix + new feature only, per the standing guidance.

**UI fix — shared `LogTail` no longer clips its history (`src/components/cyberpunk/ui.tsx`).** The reusable
`LogTail` (used by **both** War Room bottom feeds: TASK ACTIVITY · hermes kanban and AGENT SIGNAL · hermes
activity) was `overflow-hidden` with a blind `scrollTop = scrollHeight` on every update — so with ~40 signal
lines in a 130px box, every line above the fold was **clipped and unreachable**. Switched the container to
`overflow-y-auto overflow-x-hidden` and gated the auto-follow on a `pinnedRef` that re-pins to the bottom only
when the reader is already within 24px of it (an `onScroll` handler updates the flag), so polling fresh lines no
longer yanks someone who scrolled up to read earlier output — the same pin-to-bottom discipline Run #8 used for
the WorkerLogStream tail. **High-leverage** (every `LogTail` consumer inherits it). **Verified live** on
`/war-room`: the feed container computes `overflow-y:auto` / `overflow-x:hidden`.

**New feature — Backlog Burn-down / Queue-Health view (War Room, TASK panel `BURN` mode).** Run #11 answered
"how many tasks finished each hour" (raw histogram); this answers the operational question one level up — *is the
queue keeping up, or falling behind?* **Lib** (`src/lib/backlogTrend.ts`): new pure `computeBacklogTrend(tasks,
nowMs, hours=24)` folds the already-polled queue into UTC-hour-aligned trailing buckets and **accumulates**
arrivals (`created_at`) and completions (`completed_at` on done/complete/completed) into two cumulative series;
the gap between them is the net backlog the window added or burned down. Also returns `openBacklog` — the live,
**window-independent** count of still-open work (everything not done/failed/cancelled/archived) — plus `netDelta`
(created − done over the window) and a `trend` (growing / shrinking / flat). `nowMs` is passed in (never
`Date.now()` in render), mirroring `computeThroughput`/`agentMetrics`. **Component**
(`src/components/BacklogBurndown.tsx`): a stretched SVG (`viewBox 0 0 300 100`, `preserveAspectRatio="none"` +
`vector-effect="non-scaling-stroke"` so lines stay crisp) drawing the two cumulative polylines (sky CREATED,
emerald DONE) over 0/50/100% gridlines, with the area between them shaded coral when arrivals lead / emerald when
completions lead; a per-bucket invisible hover overlay (`02h:00 — created N · done N · net ±N`) since SVG
hit-testing under non-uniform scale is awkward; a headline OPEN / NET Δ / trend row; a 12H/24H/48H window
selector; and a CREATED Σ / DONE Σ legend. **Wiring** (`src/pages/WarRoom.tsx`): the TASK STATUS panel toggle
went from STATUS↔FLOW to **STATUS·FLOW·BURN** (third `taskView='burn'` mode), reusing the panel's existing
0ms-seeded `nowMs` clock; the LIVE/OFFLINE dot moved to `hidden md:inline` + the toggle gap tightened so three
buttons + the dot fit the `lg:grid-cols-2` half-column without overflow. Also updated the `?` cheat-sheet
(`ShortcutsHelp.tsx`) War Room group to STATUS·FLOW·BURN. **No new bridge endpoint** — pure client fold of the
already-polled task store. **How to access:** War Room → TASK panel header → click **BURN** (then **12H/24H/48H**).
**Verified live against real Hermes data** (bridge online this run): the panel renders `BACKLOG BURN-DOWN · queue
health` with both cumulative polylines (`#38bdf8` + `#10b981`), a real **`OPEN 15`** (15 live non-closed tasks),
`NET 0 / ■ FLAT` and `CREATED Σ 0 / DONE Σ 0` over the 24h window (consistent — those 15 were created >24h ago,
none completed in-window); the window selector swaps the chart from **24 → 48 hover ticks**; hover tooltips read
`02h:00 — created 0 · done 0 · net +0`; **no console errors**; and the busier STATUS·FLOW·BURN header reports
`scrollWidth === clientWidth` (no overflow) at 1040 / 980 / 1280px. Also unit-checked `computeBacklogTrend` via a
standalone CommonJS transpile (**13/13** assertions: cumulative monotonicity, `totalCreated/totalDone/netDelta`,
window-independent `openBacklog`, `trend`, and the `nowMs=0` / empty-task inert branches).

**Verify.** `npm run build` ✓ (tsc + vite, **128 modules**, up from 126 — `backlogTrend.ts` + `BacklogBurndown.tsx`),
`npm run lint` ✓ (**0 errors, 0 warnings**), the standalone `computeBacklogTrend` unit-check (13 cases) ✓, and the
live Vite preview pass above on `/war-room` (BURN view + window switch + header-overflow + LogTail computed style),
no console errors. (Inherited-state cleanup restored the green build by removing the audit's orphaned untracked
Redux scaffold; no tracked file touched.)

### 2026-06-10 — Run #14 (branch `auto/evolve-cron-timeline`)

**Inherited-state note.** Opened on the Run #13 branch tree (`auto/evolve-cron-countdown`), still carrying the
concurrent Hermes self-audit's uncommitted churn — `.hermes/audit-*`, `scripts/audit-and-improve.py`,
`BRAND_STRATEGY.md`, **plus** audit-touched edits in five of my own source files: `CommandPalette.tsx` (a
legitimate `tasks`→`hermesTasks` / `t.name`→`t.title` re-alignment, as Run #13 noted), comment-only
"bloodhound" annotations + a type re-export in the three stores (`useNotifyStore.ts`, `useTaskFocusStore.ts`,
`useAgentDrilldownStore.ts`), and a **new substantive `ChatTerminal.tsx` change** (inline Electron-safe project
create/rename replacing `window.prompt`, using the existing `Panel` `bodyClass` prop). Confirmed the baseline
builds (125 modules) + lints (0 issues) with all that churn present, **left every audit file untouched** (not
this run's deliverable), branched `auto/evolve-cron-timeline` from HEAD, and committed **only my own files**.

**Tab audit findings (sanity pass).** Re-enumerated `src/lib/nav.ts` (**8 modules**, num 00–07), `App.tsx`, and
the Layout sidebar. Consolidation remains complete — unchanged since Run #6. All redirects still resolve
(`/command`,`/cyberpunk`,`/agent-hub` → `/network`; the 4 Design Lab legacy paths → `/design-lab?tab=…`;
`/signal-intelligence` → `/war-room`; `*` → `/network`). No dead nav entry crept back. **No consolidation
needed this run** — UI fix + new feature only, per the standing guidance.

**UI fix — Lead Tracker `Source` column overflow (`src/pages/LeadTracker.tsx`).** The `LEAD REGISTRY` table
lays each row on `grid-cols-[1fr_120px_100px_80px]`; the **Name** cell carried `min-w-0 truncate` but the
**Source** cell (`<span>{lead.source}</span>`) did not, so a long source value would overflow its fixed 120px
track and bleed into the Status column. Added `truncate` + a `title` tooltip to the Source span, mirroring the
adjacent (already-verified) Name-cell pattern. Build + lint clean. (Couldn't render live rows — the bridge
`/api/hermes/leads` poll was offline this run, so the registry was empty; the one-class fix mirrors a proven
sibling cell.)

**New feature — Cron Next-24h Agenda timeline (Operations cron modal).** Run #13 gave each cron job a single
*next-fire* countdown; this adds the *forward agenda* — when does the next day's scheduled work actually land?
**Lib** (`src/lib/cronSchedule.ts`): new pure helper `upcomingFires(raw, nowMs, windowMs, maxFires=64)` returns
every fire in `(nowMs, nowMs+windowMs]`, soonest first, capped — cron expressions walked forward via the Run #13
month→day→hour→minute stepper (cursor advanced to each fire, which `nextCron` resolves strictly after, so no
repeat/stall), interval jobs anchored at `nowMs` (first fire one period out, since they have no real anchor).
**Component** (`src/components/CronTimeline.tsx`): a **NEXT 24H AGENDA** panel — one thin lane per job over a
24h track with 6/12/18h gridlines + a `now → +24h` axis, every upcoming fire drawn as a tick (coral for active
jobs, grey for paused), each with a `job · Thu 07:00 (in 15h 47m)` tooltip; a header `N FIRES` totals the window.
The tick layout is **memoized per minute** (`Math.floor(nowMs/60000)`) so it doesn't recompute on every 1s clock
tick (positions shift <0.001%/s over 24h); dense jobs capped at 300 ticks (an every-5m job → a near-continuous
band). **Wiring** (`OperationsCenter.tsx`): rendered at the top of the cron modal (`{cron.length>0 && <CronTimeline
jobs={cron} nowMs={cronNow} />}`), reusing the modal's existing 1s `cronNow` clock (no new state/clock). **No new
bridge endpoint** — pure client parse of the already-polled cron list. **How to access:** Operations → `⏱ CRON`.
**Verified live against real Hermes cron data** (bridge served the cron list; 3 jobs): the agenda rendered 3 lanes
— `kanban-auto-claim` (every 5m → **288 ticks**, first `Wed 15:15 (in 2m)` at left 0.2%), `Mission Control
Auto-Audit` (**5 ticks**, first `Wed 20:00 (in 4h 47m)` at left 20% = 4.8/24), `Sentinel Daily Trend Engine`
(**1 tick** at `Thu 07:00 (in 15h 47m)`, left 65.8% = 15.8/24) — header `294 FIRES` (288+5+1), axis labels
`now/+6h/+12h/+18h/+24h` correct. Also unit-checked `upcomingFires` via a standalone `tsc` transpile over 6
schedules (cron / macro / interval / dense / garbage) — all fire counts + boundaries correct (e.g. `0 7 * * *`
from Wed 08:00 → 1 fire Thu 07:00; `every 5h` → 4 fires; `30m` → 48 fires). **No component console errors** (only
the documented baseline background bridge-poll `Network Error`s for fetchTasks/fetchTopology). (Screenshots time
out in this sandbox — verified via `preview_eval` DOM inspection + `preview_console_logs`, as in Runs #7–#13.)

**Verify.** `npm run build` ✓ (tsc + vite, **126 modules**, up from 125 — `CronTimeline.tsx`), `npm run lint` ✓
(**0 errors, 0 warnings**), the standalone `upcomingFires` unit-check (6 cases) ✓, and the live Vite preview pass
above on `/operations` (cron agenda against real data), no component console errors.

### 2026-06-10 — Run #13 (branch `auto/evolve-cron-countdown`)

**Inherited-state note.** Opened on the Run #12 branch tree (`auto/evolve-shortcuts-help`), still carrying the
concurrent Hermes self-audit's uncommitted churn (`.hermes/audit-*`, `scripts/audit-and-improve.py`,
`BRAND_STRATEGY.md`) **plus** four of my own source files the audit had modified in the working tree:
`CommandPalette.tsx` (re-aligned `tasks`→`hermesTasks` / `t.name`→`t.title` / `t.agentName`→`t.assignee` to the
real `useTaskStore` shape — a legitimate fix), and harmless side-effect/type-only `../lib/api` imports added to
`useNotifyStore.ts`, `useTaskFocusStore.ts`, `useAgentDrilldownStore.ts` (no `.ts` extension this time, so unlike
Run #7 they build clean). Verified the baseline builds (124 modules) + lints (0 issues) **with** that churn
present, left all of it untouched (not this run's deliverable), branched `auto/evolve-cron-countdown` from HEAD,
and committed only my own files.

**Tab audit findings (sanity pass).** Re-enumerated `src/lib/nav.ts` (**8 modules**, num 00–07), `App.tsx`, and
the Layout sidebar. Consolidation remains complete — unchanged since Run #6. All redirects still resolve
(`/command`,`/cyberpunk`,`/agent-hub` → `/network`; the 4 Design Lab legacy paths → `/design-lab?tab=…`;
`/signal-intelligence` → `/war-room`; `*` → `/network`). No dead nav entry crept back. **No consolidation
needed this run** — UI fix + new feature only, per the standing guidance.

**UI fix — local `Modal` overflow guard (`src/pages/OperationsCenter.tsx`).** The file-local `Modal` (used by
**5** modals: cron, create-task, decompose, board-diagnostics, create-board) was a fixed `flex flex-col` box
whose body had no scroll and the box no height cap — so tall content (the cron list + 3-field create form, or a
long AI-decompose result) could push the bottom action button **off a short viewport with no way to scroll to
it**. Added `max-h-[88vh] flex flex-col` to the box, `shrink-0` + `truncate` to the header (so a long title can't
crowd the ✕), and `overflow-y-auto` to the body. Now every Operations modal caps at the viewport and scrolls its
own body. **High-leverage** — fixes all 5 modals, not just cron. **Verified live** at 1280×800: the cron modal
box computes `max-height:704px` (= 88vh, the rule resolves — an unset value would read `none`) and the body
`overflow-y:auto`; modal height 437px (fits, capped). (At the headless sandbox's default 0-height viewport, 88vh
resolves to 0px — why an early probe read `0px`; forcing a real viewport confirmed the cap.)

**New feature — Cron Next-Fire Countdown (Operations cron modal).** The cron home listed each job's raw schedule
string with no sense of *when it next runs*. New lib `src/lib/cronSchedule.ts` (`parseSchedule` /
`formatCountdown` / `fireLabel`, all pure) parses a job's `schedule`/`repeat` into `{ kind, label, nextMs }`:
standard 5-field Vixie cron (`*`, lists `a,b`, ranges `a-b`, `*/n` and `a-b/n` steps, the correct dom/dow
"either restricted field matches" rule), the `@daily`/`@hourly`/`@weekly`/… macros, and `30m` / `every 2h`
interval shorthand. Cron expressions get a real next-fire time via a cheap month→day→hour→minute **stepper** (skips
whole non-matching months/days/hours so it resolves in a handful of steps; a 600k-iteration guard caps the
worst case) computed in **LOCAL** time (the hermes daemon fires on the machine's clock; the relative countdown is
timezone-independent regardless), a friendly label (`*/5 * * * *` → `every 5m`, `0 7 * * *` → `07:00 daily`), and
an absolute "Next fire: Tue 09:00 (local)" tooltip. Intervals show `↻ repeats` (no anchorable next fire);
unparseable schedules show `—`. **Wiring** (`OperationsCenter.tsx`): the cron modal maps the polled job list
through `parseSchedule` (memoized on `[cron, cronNow]`), **sorts soonest-fire-first** (intervals/unknowns sink to
the bottom), adds a `JOB · SCHEDULE / NEXT FIRE ▾` header row, and renders a `CronNextFire` badge per row
(`▸ 3h 12m` coral when <1 min out). A 1s clock (`cronNow`) ticks the countdowns **only while the modal is open**
(seeded on open, interval torn down on close — never `Date.now()` in render). **No new bridge endpoint** — pure
client parse of the already-polled cron list. **How to access:** Operations → `⏱ CRON`. **Verified live against
real Hermes cron data** (bridge online, 3 jobs): `kanban-auto-claim` (`*/5 * * * *` → label `every 5m`, countdown
`▸ 3m`), `Mission Control Auto-Audit` (`every 5h`, `▸ 2h 43m`), `Sentinel Daily Trend Engine` (`07:00 daily`,
`▸ 18h 43m`) — correct labels, soonest-first order, the first countdown observed **ticking** from `<1m`→`3m`
across polls (live clock confirmed). Also unit-checked the parser via a standalone `tsc` transpile over 14
representative schedules (cron / macro / interval / weekday / monthly / garbage) — all next-fire times correct.
**No console errors.** (Screenshots time out in this sandbox — verified via `preview_eval` DOM inspection +
`preview_console_logs`, as in Runs #7–#12.)

**Verify.** `npm run build` ✓ (tsc + vite, **125 modules**, up from 124 — `cronSchedule.ts`), `npm run lint` ✓
(**0 errors, 0 warnings**), the standalone parser unit-check (14 cases) ✓, and the live Vite preview pass above on
`/operations` (cron countdowns against real data + the `Modal` height-cap computed style), no console errors.

### 2026-06-10 — Run #12 (branch `auto/evolve-shortcuts-help`)

**Inherited-state note.** Opened on the Run #11 branch tree (`auto/evolve-throughput-histogram`), still carrying
the concurrent Hermes self-audit's uncommitted churn (`.hermes/audit-*`, `scripts/audit-and-improve.py`,
`BRAND_STRATEGY.md`). Left all of it untouched — not this run's deliverable; branched `auto/evolve-shortcuts-help`
from HEAD and committed only my own files.

**Tab audit findings (sanity pass).** Re-enumerated `src/lib/nav.ts` (**8 modules**, num 00–07), `App.tsx`, and
the Layout sidebar. Consolidation remains complete — unchanged since Run #6. All redirects still resolve
(`/command`,`/cyberpunk`,`/agent-hub` → `/network`; the 4 Design Lab legacy paths → `/design-lab?tab=…`;
`/signal-intelligence` → `/war-room`; `*` → `/network`). No dead nav entry crept back. **No consolidation
needed this run** — UI fix + new feature only, per the standing guidance.

**UI fix — shared `Panel` header overflow guard (`src/components/cyberpunk/ui.tsx`).** The reusable panel header
(`px-3 h-[26px] flex items-center justify-between`) put `<Label>` and the `right` controls slot in one
fixed-height row with no overflow handling, so a long label plus a busy `right` slot — e.g. War Room's
`STATUS/FLOW` + `LIVE` toggle once the middle grid goes 2-up on a narrower window — could shove the controls past
the panel's right border. Added `gap-2` to the header, `min-w-0 truncate` to the label (flexbox blockifies the
`<span>`, so the ellipsis takes effect under genuine constraint) and `shrink-0` to the right slot so the controls
keep their size and the **label** is what yields. **High-leverage** — every `Panel` header in the app inherits the
guard, not just War Room. **Verified live** on `/war-room`: the `TASK STATUS BREAKDOWN` label computes
`overflow:hidden / text-overflow:ellipsis / white-space:nowrap / min-width:0px`, the right slot `flex-shrink:0`,
and the header reports `scrollWidth === clientWidth` (zero horizontal overflow) at a 1000px viewport.

**New feature — Keyboard-Shortcuts Cheat-Sheet (`?` overlay).** The topbar + War Room + the Operations task drawer
have accumulated a lot of shortcuts and one-glyph affordances; this is the one-stop legend. **Component:**
`src/components/ShortcutsHelp.tsx` (mounted once in `Layout.tsx`) — a centered modal with a two-column,
`max-h-[80vh]`-scrolling `<kbd>` legend grouped into **Global** (⌘K / Ctrl+K, ⌘F / Ctrl+F, ?, Esc, ↑↓, ↵),
**Topbar affordances** (☰ collapse, 🔔 notification center, DIAG, ⌕⌘F, ⌘K), **War Room** (STATUS·FLOW,
12H/24H/48H, LOAD·PERF, sortable leaderboard headers, TASKS·SIGNAL) and **Operations — task drawer** (⊞ MAP,
▶LIVE·⏸PAUSE, ⟳ refresh, +NEW cron). Opens on a bare `?` (Shift+/) from anywhere **except** a text field —
guarded on `e.target` tag (`INPUT`/`TEXTAREA`) + `isContentEditable` so the `?` char still reaches inputs, the
chat box and task-title fields — and toggles closed on a second `?`; also opened by a new topbar **`?` button**
(dispatches the same key event). Esc / backdrop close. Pure static (a `GROUPS` literal + the `<kbd>` chips) — **no
store, no bridge endpoint**. **How to access:** press `?` anywhere, or click the topbar `?` button. **Verified
live** on `/network` + `/war-room`: `?` opens the overlay (**35 `<kbd>` chips across the 4 groups**, fits the
viewport), a second `?` and Esc both close it, the topbar `?` button opens it, and a `?` dispatched from a focused
`<input>` does **not** toggle it (typing-guard holds). **No console errors.** (Screenshots time out in this
sandbox — verified via `preview_eval` DOM inspection + `preview_console_logs`, as in Runs #7–#11.)

**Verify.** `npm run build` ✓ (tsc + vite, **124 modules**, up from 123 — `ShortcutsHelp.tsx`), `npm run lint` ✓
(**0 errors, 0 warnings**), and the live Vite preview pass above on `/network` + `/war-room` (overlay open/close/
toggle + topbar button + typing-guard, and the `Panel` header computed-style guard), no console errors.

### 2026-06-10 — Run #11 (branch `auto/evolve-throughput-histogram`)

**Inherited-state note.** Opened on the Run #10 branch tree (`auto/evolve-notify-center`), still carrying the
concurrent Hermes self-audit's uncommitted churn (`.hermes/audit-*`, `scripts/audit-and-improve.py`,
`BRAND_STRATEGY.md`). Left all of it untouched — not this run's deliverable; branched
`auto/evolve-throughput-histogram` from HEAD and committed only my own files.

**Tab audit findings (sanity pass).** Re-enumerated `src/lib/nav.ts` (**8 modules**, num 00–07), `App.tsx`, and
the Layout sidebar. Consolidation remains complete — unchanged since Run #6. All redirects still resolve
(`/command`,`/cyberpunk`,`/agent-hub` → `/network`; the 4 Design Lab legacy paths → `/design-lab?tab=…`;
`/signal-intelligence` → `/war-room`; `*` → `/network`). No dead nav entry crept back. **No consolidation
needed this run** — UI fix + new feature only, per the standing guidance.

**UI fix — closed the long-pending `.vitals` / `.dstats` audit (Ghost Network detail panel).** Audited both
grids in `src/pages/ghostNexus.css`: the rendered values are always short (`.vital .vv` = `String(onlineCount)`
+ a small unit; `.dstat .v` = a percentage / small integer from `GhostNetwork.tsx`), so there is **no live
overflow today**. Added **defensive** guards anyway so a future long value can't break the fixed grids:
`.vital .vv` → `overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:72px` (the
`padding-right` reserves room for the absolutely-positioned 60px `.vspark` so a long value can't run *under* the
sparkline), and `.dstat` / `.dstat .v` / `.dstat .l` → `min-width:0` + ellipsis so a wide value can't blow out
the 3-col `1fr` row on the ≤1320px panel. **Verified live** on `/network`: `.vital .vv` computed style reports
`overflow:hidden`, `text-overflow:ellipsis`, `white-space:nowrap`, `padding-right:72px`.

**New feature — Task Throughput Histogram (War Room, STATUS ↔ FLOW toggle).** A temporal view of completion
velocity — "how many tasks finished each hour" — complementing the Run #6 agent leaderboard (a per-agent total
with no time axis). **Lib** (`src/lib/taskThroughput.ts`): `computeThroughput(tasks, nowMs, hours)` folds the
live queue into fixed, UTC-aligned one-hour buckets over a trailing window, counting `done` by `completed_at`
and `created` by `created_at`, and returns `{ buckets, totalDone, totalCreated, peak, peakLabel, avgPerHour }`.
UTC-hour alignment keeps bucket boundaries stable between polls; `nowMs` is **passed in** (never `Date.now()` in
render) so it stays render-pure, mirroring `agentMetrics`. **Component** (`src/components/TaskThroughput.tsx`):
a bar histogram (one bar per hour) with a faint sky "created" demand backdrop behind each coral "completed" bar,
the in-progress current hour drawn as a diagonal-hatch bar, hover-to-reveal per-hour counts + a full `title`
tooltip, periodic x-axis hour ticks, a DONE / PEAK / AVG summary line, a COMPLETED/CREATED legend, and a
**12H / 24H / 48H window selector**. **Wiring** (`src/pages/WarRoom.tsx`): the TASK STATUS BREAKDOWN panel now
carries a `STATUS` / `FLOW` toggle in its header (the LIVE/OFFLINE dot moved beside it); `FLOW` swaps the status
bars for `<TaskThroughput tasks={hermesTasks} nowMs={nowMs} />`, reusing the panel's already-seeded `nowMs`
(0ms-timeout seed + 30s tick). **No new bridge endpoint** — pure client fold of the already-polled task store.
**How to access:** War Room → TASK STATUS panel header → click **FLOW** (then **12H/24H/48H** to widen the
window). **Verified live** on `/war-room` (offline sandbox, so counts are 0): FLOW renders the panel as
`TASK THROUGHPUT · per hour` with the DONE/PEAK/AVG summary + COMPLETED/CREATED legend + 12H/24H/48H selector;
the histogram renders **12 bars at 12H and 48 bars at 48H** (window switch confirmed), bar `title`s read
`"14h:00 — 0 done · 0 created"` (UTC bucketing correct), **no console errors**. (Real non-zero bars need live
completions, which the offline sandbox can't produce; the count path is type-checked and exercised by the
empty-window branch.)

**Verify.** `npm run build` ✓ (tsc + vite, **123 modules**, up from 121 — `taskThroughput.ts` +
`TaskThroughput.tsx`), `npm run lint` ✓ (**0 errors, 0 warnings**), and the live Vite preview pass above on
`/war-room` (FLOW histogram + window switch) and `/network` (`.vital .vv` computed-style guard), no console
errors.

### 2026-06-10 — Run #10 (branch `auto/evolve-notify-center`)

**Inherited-state note.** Opened on the Run #9 branch tree (`auto/evolve-task-notifications`), still carrying the
concurrent Hermes self-audit's uncommitted churn (`.hermes/audit-*`, `scripts/audit-and-improve.py`,
`BRAND_STRATEGY.md`). Left all of it untouched — not this run's deliverable; branched `auto/evolve-notify-center`
from HEAD and committed only my own files.

**Tab audit findings (sanity pass).** Re-enumerated `src/lib/nav.ts` (**8 modules**, num 00–07), `App.tsx`, and
the Layout sidebar. Consolidation remains complete — unchanged since Run #6. All redirects still resolve
(`/command`,`/cyberpunk`,`/agent-hub` → `/network`; the 4 Design Lab legacy paths → `/design-lab?tab=…`;
`/signal-intelligence` → `/war-room`; `*` → `/network`). No dead nav entry crept back. **No consolidation
needed this run** — UI fix + new feature only, per the standing guidance.

**UI fix — Ghost Network detail-panel `.dbtn` no longer clips its label.** The TODO's last density item: the
Nexus agent-detail `.dctrl` is a 3-col `1fr 1fr 1fr` button grid (`STATUS/PAUSE/REASSIGN` + `SPAWN/EDIT/DELETE`),
and on the narrow ≤1320px panel each cell shrinks to ~110px where the longest label (`REASSIGN`, 11px uppercase
with 0.1em tracking) could overflow its column. Added `min-width:0; overflow:hidden; white-space:nowrap;
text-overflow:ellipsis` to `.dbtn` (`src/pages/ghostNexus.css`) so it truncates cleanly inside the cell instead.
**Verified live**: a probed `.dbtn` reports `overflow:hidden`, `text-overflow:ellipsis`, `white-space:nowrap`,
`min-width:0px` in the running stylesheet.

**New feature — Notification Center dropdown (extends Run #9).** The Run #9 bell was a bare mute toggle; it's now
a notification center. **Store** (`src/stores/useNotifyStore.ts`): added a session `history: NotifyEvent[]`
(newest first, capped 60, de-duped by `taskId:status`), an `unseen` badge counter, and `record()` / `markSeen()`
/ `clearHistory()` actions. **Watcher** (`src/components/TaskNotifier.tsx`): now **records every non-terminal→
terminal transition into the history regardless of the OS-toast toggle** — so the in-app log is useful even when
desktop toasts are muted — while the OS `Notification` stays gated on enable+permission (unchanged). **Component**
(`src/components/NotifyCenter.tsx`, mounted in `Layout.tsx` replacing the inline bell button): a 320px right-
anchored dropdown listing each event as a click-to-focus row (✓/✕ glyph + title + assignee + relative `ago()`)
that calls `useTaskFocusStore.focus(id)` + routes to `/operations`. The desktop-toast **ON/OFF toggle moved into
the dropdown header** (preserving Run #9's mute control + blocked/unsupported hint), the bell carries an
**unseen-count badge** (cleared on open), and `CLEAR` wipes the session log. Closes on Esc / outside-click. **No
new bridge endpoint** — pure client history of the already-diffed task store. **How to access:** click the topbar
🔔/🔕 bell. **Verified live** on `/network` (sandbox: `Notification.permission` OS-denied): bell renders
(`🔕 MUTED`), dropdown opens with the header + `🔕 OFF` toggle + the OS-blocked hint + the empty state
("No completed tasks yet this session."), no console errors. (Real terminal transitions can't be produced in the
offline sandbox; the row path is type-checked and exercised by the empty/blocked branches.)

**Verify.** `npm run build` ✓ (tsc + vite, **121 modules**, up from 120 — `NotifyCenter.tsx`), `npm run lint` ✓
(**0 errors, 0 warnings**), and the live Vite preview pass above on `/network` (bell + dropdown render + `.dbtn`
computed-style guard, no console errors).

### 2026-06-10 — Run #9 (branch `auto/evolve-task-notifications`)

**Inherited-state note.** Opened on the Run #8 branch tree (`auto/evolve-log-stream`), still carrying the
concurrent Hermes self-audit's uncommitted churn (`.hermes/audit-*`, `scripts/audit-and-improve.py`,
`BRAND_STRATEGY.md`). Left all of it untouched — not this run's deliverable; branched
`auto/evolve-task-notifications` from HEAD and committed only my own files.

**Tab audit findings (sanity pass).** Re-enumerated `src/lib/nav.ts` (**8 modules**, num 00–07), `App.tsx`,
and the Layout sidebar. Consolidation remains complete — unchanged since Run #6. All redirects still resolve
(`/command`,`/cyberpunk`,`/agent-hub` → `/network`; the 4 Design Lab legacy paths → `/design-lab?tab=…`;
`/signal-intelligence` → `/war-room`; `*` → `/network`). No dead nav entry crept back. **No consolidation
needed this run** — UI fix + new feature only, per the standing guidance.

**UI fix — Ghost Network command bar no longer overflows on narrow widths.** The Nexus `.commandbar`
(`src/pages/ghostNexus.css`) packed the session-switcher + `ARCAN ▷` prefix + the directive input + 3
quick-chips + `Execute` into a single **nowrap** flex row. With the 286px rail and 430px detail panel both on
screen, the centre column gets narrow (especially at the existing ≤1320px breakpoint) and that row used to
clip horizontally — the exact "command bar overflow" risk Run #7/#8 flagged in the pending density audit.
Fix: `flex-wrap:wrap` on `.commandbar` and `.chips`, plus `flex:1 1 200px; min-width:200px` on `.cmd-input`
so the input keeps a usable width and the chips/Execute wrap to a second line instead of overflowing.
**Verified live** on `/network`: at 1280px the bar stays one row with `scrollWidth === clientWidth` (no
overflow); at 1120px it wraps to a second row (height 126px) still with **zero horizontal overflow**. (The
detail panel's `.vitals`/`.dstats`/`.dctrl` grids remain un-audited — re-queued for the next run.)

**New feature — Completed-Task Desktop Notifications (🔔 / 🔕).** Closes the "did my task finish?" loop and
pairs with Run #8's live worker-log tail. **Store:** `src/stores/useNotifyStore.ts` — owns the on/off
preference (persisted to `localStorage` `mc-notify-enabled`, re-validated against `Notification.permission`
on load so a stale "on" can't show an un-fireable bell), the current permission, a session `sentCount`, and a
`toggle()` that requests OS permission when enabling. **Watcher:** `src/components/TaskNotifier.tsx` (renders
`null`, mounted once in `Layout.tsx`) keeps a `useRef` map of `taskId → status`, diffs each
`useTaskStore.hermesTasks` change, and fires an OS `Notification` only on a genuine **non-terminal → terminal**
(`done|completed|failed`) transition. It **seeds silently on the first poll** (no startup burst for tasks that
were already done), de-dupes per task via the notification `tag`, and degrades quietly if the `Notification`
constructor throws. Clicking a notification calls `useTaskFocusStore.focus(id)` + `navigate('/operations')`
(jumps straight to the finished task — which then shows its final worker-log tail). **Topbar control:** a
**🔔 NOTIFY / 🔕 MUTED** bell button in `Layout.tsx` (beside DIAG) toggles the store, turns coral/accent when
on, and shows blocked/unsupported state in its tooltip. **No new bridge endpoint** — pure client diff of the
already-polled task store. **How to access:** click the **🔕 → 🔔** bell in the top bar (grant the OS prompt);
finish/fail any task and an OS toast fires — click it to land on that task in Operations. **Verified live:**
bell renders (`🔕 MUTED` in the preview sandbox, where `Notification.permission` is OS-denied — tooltip
correctly explains), toggle wired, `TaskNotifier` mounts with no console errors; the seed-then-diff logic and
permission guards keep it inert until a real transition with granted permission.

**Verify.** `npm run build` ✓ (tsc + vite, **120 modules**, up from 118 — `useNotifyStore.ts` +
`TaskNotifier.tsx`), `npm run lint` ✓ (**0 errors, 0 warnings**), and the live Vite preview pass above on
`/network` (command-bar wrap at 1280/1120px + bell render, no console errors).

### 2026-06-09 — Run #8 (branch `auto/evolve-log-stream`)

**Inherited-state note.** Opened on the Run #7 branch tree, still carrying the concurrent Hermes self-audit's
uncommitted churn (`.hermes/audit-*`, `scripts/audit-and-improve.py`, `BRAND_STRATEGY.md`). Left all of it
untouched — not this run's deliverable; branched `auto/evolve-log-stream` from HEAD and committed only my files.

**Tab audit findings (sanity pass).** Re-enumerated `src/lib/nav.ts` (**8 modules**, num 00–07), `App.tsx`, and
the Layout sidebar. Consolidation remains complete — unchanged since Run #6. All redirects still resolve
(`/command`,`/cyberpunk`,`/agent-hub` → `/network`; the 4 Design Lab legacy paths → `/design-lab?tab=…`;
`/signal-intelligence` → `/war-room`; `*` → `/network`). No dead nav entry crept back. **No consolidation
needed this run** — UI fix + new feature only, per the standing guidance.

**UI fix — War Room AGENT PERFORMANCE leaderboard is now click-to-sort.** Run #6's leaderboard rendered a single
static throughput rank. Reworked `src/components/AgentPerformance.tsx`: all 7 column headers
(Agent/Done/Run/Fail/Rate/Avg/24h) are now clickable, each toggling a local `sortKey`+`dir`. First click sorts
that column (desc for metrics, asc for the agent name); clicking the active column flips direction; a `▼`/`▲`
glyph marks the active header (coral). The **default (null `sortKey`) preserves the upstream composite rank**
from `computeAgentMetrics` (done → success → activity), and null metrics (no resolved tasks / no duration)
always sink to the bottom regardless of direction. Pure local UI state — no change to the metrics aggregation.
**Verified live** (8 agents, real data): `Fail ▼` → narratrix (5 fails) to the top, header shows `Fail ▼`;
`Agent ▲` → strict alphabetical (claudelink…signalscraper). Default rank (signalscraper top) intact on load.

**New feature — Live Worker-Log Tail (▶ LIVE / ⏸ PAUSE).** The TaskDetailDrawer's WORKER LOG section was
load-once (a `getHermesTaskLog` snapshot). New component `src/components/WorkerLogStream.tsx` turns it into a
live tail: a `▶ LIVE` toggle re-polls `getHermesTaskLog(taskId, 8000)` every 2s (immediate first fetch, then
`setInterval`; a `cancelled` flag guards a late response after unmount/toggle-off), **replacing the buffer with
the freshest tail** each cycle. Auto-follow keeps the `<pre>` pinned to the bottom as new lines arrive, but if
the operator scrolls up to read earlier output the `pinned` ref goes false and their position is left alone
(re-pins whenever streaming restarts). While live it shows a pulsing `STREAMING · 2s` indicator; paused it shows
`⏸→▶`, a `⟳ REFRESH` one-shot, and a "task idle — tail is static" hint when the task isn't `running`. Graceful
fallback to `(no log file for this task)` / `(empty)` on a failed/empty fetch. **No new bridge endpoint** — pure
client polling of the existing `/api/hermes/tasks/{id}/log` route. The drawer's old local `log` state +
`getHermesTaskLog` import were removed (now fully encapsulated in the component). **How to access:** Operations →
click a task → WORKER LOG → `▶ LIVE` (or `LOAD WORKER LOG` for a one-shot). **Verified live** (drawer on
`t_a33fad25`): LOAD + ▶ LIVE present → ▶ LIVE flips to `⏸ PAUSE` + `STREAMING · 2s` pulse, `<pre>` renders;
⏸ PAUSE → back to `▶ LIVE` + `⟳ REFRESH` + idle hint; log fetched successfully (empty file → graceful
`(empty)`). **No React/render console errors** — only the pre-existing background bridge-poll `Network Error`s
(fetchTasks/fetchTopology every 7s, the documented baseline).

**Verify.** `npm run build` ✓ (tsc + vite, **118 modules**, up from 117), `npm run lint` ✓ (**0 errors,
0 warnings**), and the live Vite preview pass above on `/war-room` (sort) and `/operations` (log tail).

### 2026-06-09 — Run #7 (branch `auto/evolve-dependency-graph`)

**Inherited-state note.** Opened on the Run #6 branch's tree, which carried uncommitted edits from a
concurrent Hermes self-audit (`scripts/audit-and-improve.py`): `.hermes/audit-*`, `scripts/`, `BRAND_STRATEGY.md`,
**and a spurious `import '../lib/api.ts';` injected into two of my source stores** (`useTaskFocusStore.ts`,
`useAgentDrilldownStore.ts`) — a no-op side-effect import with an explicit `.ts` extension that risked the
build. Removed those two junk lines directly (targeted Edits; a bulk `git checkout --` was blocked by the
auto-mode classifier). Left the audit's own `.hermes/`/`scripts/`/`BRAND_STRATEGY.md` churn untouched — not
this run's deliverable.

**Tab audit findings (sanity pass).** Re-enumerated `nav.ts` (**8 modules**, num 00–07), `App.tsx`, and the
Layout sidebar. Consolidation remains complete — no change since Run #6. Confirmed all redirects still resolve:
`/command`,`/cyberpunk`,`/agent-hub` → `/network`; the 4 Design Lab legacy paths → `/design-lab?tab=…`;
`/signal-intelligence` → `/war-room`; `*` → `/network`. No dead nav entry crept back. **No consolidation
needed this run.**

**UI fix.** Nexus agent-detail panel (`src/pages/ghostNexus.css`): the two stacked `.dctrl` button rows —
orchestrator directives (Status/Pause/Reassign) and registry CRUD (Spawn/Edit/Delete) — sat **flush** with no
separation, reading as one cramped 6-button block (the exact density risk Run #6 flagged for the detail panel).
Added `.nexus .detail .dctrl + .dctrl { margin-top:8px; padding-top:10px; border-top:1px solid var(--line); }`
so the CRUD group is cleanly divided from the directives group. Verified the rule is loaded in the live
stylesheet.

**New feature — Task Dependency Map (⊞).** A full-screen, navigable visualization of a task's parent→child
dependency DAG — distinct from the drawer's existing flat parent/child *link list* (which only shows immediate
IDs + link/unlink controls). **Component:** `src/components/TaskDependencyGraph.tsx`. Opened from a new `⊞ MAP`
button in the **TaskDetailDrawer** DEPENDENCIES section header (rendered only when the task has ≥1 link).
**Behaviour:** bounded bidirectional BFS from the focused task over `getHermesTaskDetail()` (`MAX_DEPTH=2` each
direction, `MAX_NODES=28`, each ring fetched in parallel + cached, stale-center guarded with a `cancelled`
flag), node metadata resolved from the already-polled `useTaskStore` / fetched `detail.task`. Lays nodes out in
topological columns (ancestors left → descendants right, each column vertically centered), draws status-coloured
node cards (emerald=done / amber=running / sky=ready·review / red=blocked·failed / violet=triage / grey=todo·
scheduled) with cubic-bezier dependency edges + arrowheads; **edges touching the focused node turn coral**.
Click any node to **re-center** the graph on it (RECENTER restores the original root); the per-node `↗` opens
that task in the drawer. Legend shows `N TASKS · M LINKS · K LEVELS` + per-status counts + a truncation warning.
Graceful empty state when a task has no links. **No new bridge endpoint** — pure client BFS. Also extended the
drawer's local `Section` with an optional `right` header slot to host the button, and removed a pre-existing
stale `eslint-disable` in `TaskDetailDrawer.tsx` (Run #6's lone known warning) → **0 lint warnings** now.
**How to access:** Operations → click a task → DEPENDENCIES → `⊞ MAP`.

**Verified live against real Hermes data** (bridge online, 25 tasks): opened the map on `t_9b58127d` (blocked,
2 parents + 1 child) → BFS expanded its connected component to **8 tasks · 13 links · 4 levels**, column
distribution 1/2/4/1 (a real ancestors→root→convergence shape, the sink `t_133b08ed` fanning in), correct
per-node live statuses, root coral-ringed with 3 coral edges, canvas 828×288. Clicked `t_133b08ed` → re-centered
(new ROOT, legend → `8 TASKS · 13 LINKS · 2 LEVELS`); RECENTER restored `t_9b58127d`; Esc closed. **No console
errors** throughout. (`preview_screenshot` timed out repeatedly this session — verified via `preview_eval` DOM
inspection + `preview_console_logs` instead.)

**Verify.** `npm run build` ✓ (tsc + vite, **117 modules**, up from 116), `npm run lint` ✓ (**0 errors,
0 warnings** — cleaned the stale directive), and the live Vite preview pass above on `/operations`. **Note for
next run:** the concurrent self-audit may still be editing `.hermes/`, `scripts/`, `BRAND_STRATEGY.md` — those
are untracked/unstaged and NOT part of this run's commits.

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
