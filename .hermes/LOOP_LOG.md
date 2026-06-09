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

## Current State (10 tabs after the 2026-06-09 Run #2 consolidation)

Nav lives in **`src/lib/nav.ts`** (`MODULES`) — single source consumed by both
`Layout.tsx` (sidebar) and `CommandPalette.tsx`. To add/remove/reorder a tab, edit `nav.ts`.

| # | Path | Page | Data | Notes |
|---|------|------|------|-------|
| 00 | `/command`     | Hermes Command (Cyberpunk) | LIVE | Primary ops console: agents, tasks, cron, spawn/dispatch. |
| 01 | `/network`     | Ghost Network              | LIVE | Sprite-room agent topology (unique viz). |
| 02 | `/agent-hub`   | Agent Hub                  | LIVE | Agent CRUD registry + agent-activity tab + spawn-on-task. |
| 03 | `/war-room`    | War Room                   | LIVE | Metrics gauges + task-status + agent-load + **TASKS/SIGNAL feed toggle**. |
| 04 | `/operations`  | Operations Center          | LIVE | Kanban CRUD + cron list/run/**create** + task decompose. |
| 05 | `/chat`        | Ghost Comms (ChatTerminal) | LIVE | Chat round-trips to Hermes. |
| 06 | `/factory`     | Content Factory            | LIVE | `useContentStore` → `/api/content/pipeline`. |
| 07 | `/briefing`    | Briefing Terminal          | LIVE | `useBriefingStore` (briefing + sentinel digest). |
| 08 | `/leads`       | Lead Tracker               | LIVE | `useLeadStore`. |
| 09 | `/design-lab`  | Design Lab                 | DEMO | **Consolidated showcase** — internal sub-tabs: Intel Deck / Workflow Builder / Archives / Broadcast Uplink. |

- **Consolidated this run (Run #2):** the 4 standalone DEMO tabs (Intel Deck, Workflow
  Builder, Archives, Broadcast Uplink) → ONE `Design Lab` tab (`src/pages/DesignLab.tsx`)
  with internal sub-tab nav. Old routes redirect to `/design-lab?tab=<id>`. 13 → 10 tabs.
  No page files deleted — the 4 demo components are now children of `DesignLab`.
- **Removed in Run #1:** `Signal Intelligence` (folded into War Room; `/signal-intelligence`
  → `/war-room`; page deleted).
- **Only DEMO/static content left:** lives entirely inside Design Lab now. The other 9 tabs are LIVE.
- **Global ⌘K / Ctrl+K command palette** mounted in `Layout.tsx` (`src/components/CommandPalette.tsx`).
  Picks up `nav.ts` automatically; deep-links to Design Lab work via the query-param redirect.

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
- [ ] **Command vs Operations cron duplication** — Command (`src/pages/Cyberpunk.tsx`) still has an
      inline cron list/run widget that now overlaps Operations' fuller cron CRUD (list/run/create).
      Trim Command's cron widget down to a read-only summary that *links* to Operations, leaving
      Operations as the single cron home. Do NOT remove Command's spawn/dispatch — only the cron block.
- [ ] **Agent Hub "Activity" tab vs War Room SIGNAL feed** — both surface agent activity. Verify whether
      Agent Hub's Activity tab (`useGhostStore.agentActivity`) adds anything over War Room's live
      `/api/hermes/activity` SIGNAL feed; if redundant, drop the Agent Hub Activity tab and point to War Room.

### UI / Display Fixes
- [ ] **Cyberpunk / Hermes Command** page not yet audited this loop — it's the largest page (16.5K) and the
      primary console. Check for overflow, cramped widgets, and design-system drift on small Electron widths.
- [ ] **Ghost Network** (22.3K) and **ChatTerminal** (23.2K) are the two biggest pages and have never been
      UI-audited in this loop — review them for overflow/scroll/responsive issues next.
- [ ] **Operations Center** is now a 2-col grid with two modals (decompose + cron) — on the smallest window
      width confirm the `lg:grid-cols-[360px_1fr]` left column doesn't squeeze the kanban cards.

### Next Feature (must differ from everything in Run History — Run #1: Command Palette; Run #2: Cron Creation UI)
- [ ] Build a **Bridge Health Diagnostics panel** (new tab or a modal off the topbar): ping each bridge
      endpoint (`/api/hermes/status`, `/agents`, `/tasks`, `/cron`, `/activity`, `/content/pipeline`,
      `/sentinel/digest`), show per-endpoint latency + last-success time + HTTP status, and surface the
      Hermes CLI version. Add a lightweight `GET /api/hermes/health` aggregator to `hermes-bridge.py`.
- [ ] Alternative candidates (pick ONE, not already done): live log streaming (SSE/poll tail of a Hermes
      run), agent drill-down panel (click an agent → its tasks/skills/recent activity), task dependency
      view, completed-task desktop notifications, keyboard shortcuts cheat-sheet overlay.

---

## Run History (newest first — append, never overwrite)

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
