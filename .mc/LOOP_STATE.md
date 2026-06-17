# Mission Control — Operational Loop State

This is the **handoff ledger** for the `/loop` command (Mission Control Operational Loop),
which runs **every 2 hours**. It is SEPARATE from `LOOP_LOG.md` (evolve) and `BUGHUNT_LOG.md`
(bughunt) — do not cross-contaminate.

**Every run MUST:** read this file top-to-bottom first → run the `/loop` protocol
(HEALTH → ORCHESTRATION → PIPELINES → CLOSE GAPS → VERIFY) → then rewrite the sections
below. `## DONE` is append-only history.

## TO-DO  _(rewritten each run — priority order, enough detail to act with no rediscovery)_

0. **✅ DONE this run (#22) — BUILT the board-wide RECENT-ACTIVITY feed (GAPS #22 / prior TO-DO #5): a ▦ ACTIVITY drawer in
   Operations merges every task's FULL event timeline newest-first, reusing run #21's icon/label layer.** PRE-SCOUT found
   `GET /api/mc/activity` already exists (`bridge:873`) but only synthesizes 3 coarse lifecycle entries (created/claimed/completed)
   from timestamps — it never walks the per-task event log, so it misses `promoted`/`reconciled`/`routed`/`escalated`/`reassigned`/
   `dependency_link`/`dependency_unlink`/`workspace_ready` (the kinds run #21's `labelFor`/`eventParent` were built for) → built the
   true full-taxonomy aggregation (branch (b)), leaving the narrow `/api/mc/activity` untouched (4 consumers, no regression). Chain:
   `MCStore.recent_events(limit)` (`mc_store.py:1770`, pure appended method at end of class) walks `m["events"]` across all tasks,
   tags each with `task_id`+`title`+`assignee`+`task_status`, merge-sorts `created_at` desc → `GET /api/mc/events?limit=50`
   (`bridge:923`, clean insert after `/api/mc/activity`) → `McEvent`+`getRecentEvents()` (`api.ts:829`, clean block) →
   `src/components/EventFeedDrawer.tsx` (**new file, 100% mine**: each row `<icon> <label>` via `labelFor` + clickable task title →
   `onOpenTask` + emerald ↳ parent chip via `eventParent` + assignee + relative time; honest empty/error states) → 4 disjoint edits
   in `OperationsCenter.tsx` (import `:17`, state `:116`, **▦ ACTIVITY** toolbar button `:266`, mount `:319`). **Verified:** AST both
   .py ✅; in-process `recent_events` (2 tasks + seeded `promoted`+`dependency_link{parent}`) → `total=4`, sorted desc, parent+title+
   assignee on every row ✅; `npm run build` ✅ (157 modules, 671ms); `npx eslint` 3 files → No issues; **Vite preview** (port 5219,
   `#/operations`) → ▦ ACTIVITY button renders + drawer opens; against the live (pre-restart) bridge the feed shows the honest
   **"⚠ Request failed with status code 404"** (endpoint loads on restart) — graceful degradation, **0 console errors**. `graphify
   update .` ✅ (1828 nodes). **Commit: LOOP_STATE only** — all 4 code surfaces sibling-tangled (api.ts +108 / bridge +347 /
   mc_store +118 / OperationsCenter +94); `EventFeedDrawer.tsx` is mine but imports the uncommitted-in-full api.ts exports → joins
   the live-but-uncommitted bucket (TO-DO #2). Board healthy throughout: `ready 8 · blocked 6 · done 18`, reconcile → no stale
   claims. (See DONE Run #22.)
1. **OPERATOR-WATCHED FIRST DISPATCH — the one remaining piece to prove the full autonomy loop.** Board is now
   `ready 8 · blocked 6 · done 18`; dispatcher is **LIVE but OFF** (`enabled:false,running:false`) and FED
   (`dispatchable` = 8). Next operational step (needs operator present — side-effecting bypassPermissions turns):
   do ONE watched manual dispatch — `POST /api/mc/dispatcher/dispatch {}` (fires the best-first ready task in the
   background, returns immediately) or Operations → ⚠ diagnostics → **▶ DISPATCH NEXT** — and watch it run end-to-end
   (claim → `run_claude` turn → `complete_task(result)` → deliverable under `deliverables/`/`research/`, browsable via
   `GET /api/mc/tasks/{id}/workspace`). Pick a NON-`web_gap` task first (e.g. `t_3d362830` gridkeeper "Draft 2-week
   content calendar" or `t_688a5265` narratrix) so web availability isn't a confound. Only after a clean watched run,
   consider autonomous mode (`MC_DISPATCHER_ENABLED=1` env on bridge start). I did NOT dispatch this run (operator
   absent; dispatch has external side effects and needs sign-off — same posture as run #11–#13).
2. **Commit the stranded run #12 promote + run #15 deliverables + run #16 workspace-seam features — ONLY on a QUIET tree.**
   ALL are live-but-uncommitted — same intra-file cross-contamination blocker as runs #12–#15. **Run #16 adds two more
   sibling-congested hunks:** `mc_store.py` now carries my `ensure_workspace` (~33 lines, `:1154`) ON TOP of the purely-sibling
   `fail_task` (10 lines) — committing the file in full sweeps in sibling WIP (forbidden); `mission-control-bridge.py` now
   carries my `dispatch_task` cwd-wiring + prompt-directive edit alongside the deliverables/promote endpoints and sibling
   `fail_task`/`get_briefing`. My run #16 edits are clean isolated regions (a pure appended method + a 3-line contiguous
   call-site edit + a 1-line prompt string) → strong clean-blob candidates, but the same per-hunk surgery caveat applies.
   Earlier diff detail still holds: `src/lib/api.ts` (+57) MIXES my
   work (deliverables block L386–407, promote block L551–593, dispatcher types) with **sibling bughunt** `failMcTask`
   (L247–253) and an ambiguous `McCronJob.created_at` field — so committing api.ts *in full* would sweep in sibling WIP
   (forbidden). `mission-control-bridge.py` (+215) likewise mixes my deliverables endpoints (a CLEAN contiguous insert
   between `task_workspace` and `task_notify_list`) + my promote endpoint + sibling `fail_task`/`get_briefing`.
   `mc_store.py` (+10) is **purely sibling** `fail_task` (run #13 confirmed) — never commit it. The clean-blob technique
   (run #13) could isolate the bridge deliverables block (pure insertion, refs only HEAD symbols) AND the new
   `DeliverablesDrawer.tsx` is 100% mine — BUT the frontend unit can't be committed without api.ts's deliverables exports,
   and api.ts can't be committed in full (sibling `failMcTask`). Landing this needs per-hunk clean-blob surgery on
   api.ts+bridge.py excluding sibling hunks — defer to a quiet tree or hand to whichever lane owns `failMcTask` to land it
   first, then this commits cleanly on top. Did NOT force it (autonomous run, hard rule). New file (run #15):
   `src/components/DeliverablesDrawer.tsx` (clean, committable once its api.ts dep lands). **Run #18 adds two more clean
   hunks to the same congested files:** `mission-control-bridge.py` now also carries the `_deliverable_task_id` helper +
   the one-line `task_id` field in the listing (a clean contiguous block near `:1506`, refs only HEAD symbols), and
   `src/lib/api.ts` adds a one-line `task_id?` field to `DeliverableEntry` (L394) — both ride on top of the same sibling
   `failMcTask`/`fail_task`/`get_briefing` WIP, so still blocked from a full-file commit. `DeliverablesDrawer.tsx` (the
   100%-mine chip edit) is committable only once its api.ts dep lands. **Run #19 adds one more clean hunk to `mc_store.py`:**
   the `link()` audit-event change lives in the SAME hunk as run#17's `unlink`/`diagnostics` edits (`:407`), still riding
   directly above the purely-sibling `fail_task` method (`:319`) — so `mc_store.py` stays uncommittable in full (a full-file
   commit sweeps in `fail_task`). My link hunk refs only HEAD symbols (`_would_cycle`, `_event`, `_save_meta`) → clean-blob
   candidate, same per-hunk surgery caveat as the rest.
3. **Web access — treat as AVAILABLE (do NOT keep asking for a Brave key).** `BRAVE_SEARCH_API_KEY` is ALREADY in
   `MC_HOME/.env`, AND `run_claude` spawns agents with `--permission-mode bypassPermissions` → native WebSearch/WebFetch, no
   third-party key needed. The web-access audit's "missing web" is a narrow heuristic (scans agent `mcps` only). Real follow-
   up: on the FIRST dispatched research task, watch whether native WebSearch is actually allowed headless; only if NOT,
   attach a web tool to the research agent profiles.
4. **Seed cron jobs (operator sign-off).** Scheduler daemon LIVE (45 ticks @ 30s this run). Safe to seed once the operator
   confirms: sentinel (`0 7 * * *`) + content-engine (`30 7 * * *`) pipeline jobs (content-engine auto-posts to Buffer — outward
   side effect, needs sign-off); AND the recurring board self-heal (`*/30 * * * *`, `kind:"maintenance"`, `action:"sweep"`,
   run#10 — now ALSO promotes todo→ready via run #12's sweep step, so a `*/30` maintenance cron + an enabled dispatcher = full
   hands-free pipeline). Create via the ⏱ CRON modal or `POST /api/mc/cron`. Not auto-seeded (standing config + side effects).
5. **✅ DONE this run (#22) — board-wide RECENT-ACTIVITY feed BUILT** (see item 0 + DONE Run #22): `MCStore.recent_events`
   (`mc_store.py:1770`) → `GET /api/mc/events` (`bridge:923`) → `McEvent`/`getRecentEvents` (`api.ts:829`) →
   `EventFeedDrawer.tsx` (new, mine) → ▦ ACTIVITY button in `OperationsCenter.tsx`. **Next capability to BUILD — make the
   ▦ ACTIVITY feed LIVE (auto-refresh while open).** RATIONALE: the feed currently fetches once on open (`getRecentEvents(100)` in
   the mount effect), so an operator watching the board's pulse must close+reopen the drawer to see new events — it's a snapshot,
   not a live feed. The narrow `/api/mc/activity` is already polled live by `useActivityStore` (`src/stores/useActivityStore.ts`,
   `startPolling`/`stopPolling`, consumed by War Room / Ghost Network) — mirror that pattern for the new full-taxonomy feed.
   **Fully in-lane** (`EventFeedDrawer.tsx` is 100% mine): add a `setInterval` (e.g. 5s) inside the existing `open` effect that
   re-calls `getRecentEvents`, clearing it on unmount/close (guard the `live` flag already there); optionally a small "● LIVE"
   pulse + a paused state. No new endpoint/store/api work — pure component. Bonus (cheap, same file): a kind-filter chip row
   (all / lifecycle / dependency / orchestration) on top of the list, since the full taxonomy can get noisy. **Runner-ups**
   (smaller, also in-lane): (i) a "⬡ open task" affordance on the per-task WORKSPACE browser rows for symmetry with run #20's
   deliverables-chip navigation; (ii) a reciprocal **↳ child ‹id›** chip in the feed/timeline (currently only `parent` is
   surfaced) if children-edge events ever carry a `child` payload. Lane note: keep clear of the sibling FAIL-action/banner region
   in `TaskDetailDrawer.tsx` (`:159-231`, `:293`).
6. **→ bughunt/evolve: `npm run lint` fails project-wide (~500 errors, NEW finding run #13).** Run #13 ran the FULL project
   lint (prior runs only `npx eslint`'d their 2–3 touched files, masking this). 500 errors / 473 auto-fixable, dominant rules
   `typescript-eslint/ban-ts-comment`, `typescript-eslint/no-unused-vars`, `react-hooks/set-state-in-effect`,
   `react-hooks/refs` — spread across `GhostNetwork.tsx`, `Layout.tsx`, etc. **None introduced by this loop** (run #13 touched
   0 TS). Many are sibling-owned files currently mid-edit (16 TS files dirty). NOT auto-fixed here (would churn sibling WIP and
   needs a human to confirm the `--fix` is safe per file). The Operational-loop health gate should keep scoping lint to the
   files IT touches until this baseline is cleared by the lane that owns those files. Candidate: a one-time `eslint --fix`
   sweep on a quiet tree, reviewed.

### TO-DO — earlier detail (run #11 and before; kept for reference, superseded by 0–5 above)

---

## OPERATIONAL STATUS  _(snapshot — refresh every run)_

_Last run: **2026-06-17 (Run #22)** — **BUILT the board-wide RECENT-ACTIVITY feed (GAPS #22 / prior TO-DO #5): a ▦ ACTIVITY
drawer in Operations merges every task's FULL event timeline newest-first, reusing run #21's icon/label layer.** PRE-SCOUT:
`GET /api/mc/activity` already exists but only synthesizes 3 coarse lifecycle entries (created/claimed/completed) from timestamps
— it never walks the per-task event log (misses promoted/reconciled/routed/escalated/reassigned/dependency-edge/workspace_ready),
so built the true full-taxonomy aggregation (branch (b)), leaving `/api/mc/activity` untouched (4 consumers, no regression).
Chain: `MCStore.recent_events(limit)` (`mc_store.py:1770`, pure appended method) → `GET /api/mc/events?limit=50` (`bridge:923`,
clean insert) → `McEvent`/`getRecentEvents()` (`api.ts:829`, clean block) → `EventFeedDrawer.tsx` (new file, 100% mine: each row
`<icon> <label>` via `labelFor` + clickable task title → `onOpenTask` + emerald ↳ parent chip via `eventParent` + assignee +
relative time) → 4 disjoint edits in `OperationsCenter.tsx` (import/state/▦ ACTIVITY button/mount). Verified: AST both .py ✅;
in-process `recent_events` (2 tasks + seeded promoted+dependency_link) → total=4, sorted desc, parent+title+assignee on each row
✅; `npm run build` ✅ (157 modules, 671ms); `npx eslint` 3 files → No issues; **Vite preview** (port 5219, `#/operations`) →
▦ ACTIVITY button renders + drawer opens; against live (pre-restart) bridge the feed shows honest "⚠ 404" (endpoint loads on
restart) — graceful degradation, **0 console errors**. `graphify update .` ✅ (1828 nodes). Board steady + healthy: `ready 8 ·
blocked 6 · done 18`, reconcile → no stale claims, dispatcher LIVE-but-OFF + FED (8 dispatchable). Commit: LOOP_STATE only — all
4 code surfaces sibling-tangled (`EventFeedDrawer.tsx` is mine but imports uncommitted-in-full api.ts), joins the
live-but-uncommitted bucket (TO-DO #2). Operator-watched first dispatch (#1) + cron seeding (#4) still need sign-off. Lint
baseline (~500 errors, sibling/untouched TS) unchanged, still bughunt/evolve's (#6)._

| Subsystem | State | Notes |
|---|---|---|
| Bridge (:8767) | ✅ UP + runs #1–#15 LIVE | `GET /api/ping` ok, **uptime ~9.5h** (34325s — on run #15 code). **`POST /api/mc/kanban/promote` → 200** (run #12 LIVE), **`GET /api/mc/deliverables` → 200** (run #15 LIVE). Runs #16 (dispatch-workspace) + #17 (cycle-break `cycle_parents` + `unlink` event) + #18 (deliverables `task_id` parse) + #19 (`dependency_link` event) load on NEXT restart. **Dispatcher LIVE but OFF + FED**: `/api/mc/dispatcher` → `{enabled:false,running:false,concurrency:1}`, `dispatchable` = **8**. `/api/mc/kanban/reconcile` → "no stale claims". |
| Event-timeline UI (run #21) + board-wide feed (run #22) | 🟢 #21 per-task LIVE on rebuild; #22 endpoint loads on restart | **Run #21:** per-task EVENT TIMELINE renders each kind with icon+label + ↳ parent chip (`eventLabels.ts` + `TaskDetailDrawer.tsx:405`). **Run #22: a board-wide ▦ ACTIVITY drawer** (`EventFeedDrawer.tsx`, new) merges EVERY task's full event timeline newest-first via `GET /api/mc/events` → `MCStore.recent_events` — distinct from the narrow 3-entry `/api/mc/activity`. Each row reuses `labelFor`/`eventParent`, clickable task title → detail drawer. Endpoint 404s until bridge restart (live bridge predates it); UI degrades honestly (shows the 404, no crash). Next gap (TO-DO #5): make the feed auto-refresh (live polling) reusing the `useActivityStore` pattern. |
| Deliverables (#15 LIVE) + workspace seam (#16) + task_id parse (#18) + clickable chip (#20) | 🟢 #15 LIVE, #16/#18/#20 load on restart+rebuild | `GET /api/mc/deliverables` → 200, lists all 6 (all root-level/`research/` → `task_id:null`). Run #16: dispatch writes to `deliverables/tasks/<id>/` (task-linked, dual-browser). Run #18: listing derives `task_id` from a `tasks/<id>/…` path → UI ⬡ chip. **Run #20: the ⬡ chip is now CLICKABLE → opens the producing task's detail drawer** (DeliverablesDrawer `onOpenTask` prop + OperationsCenter wiring). Verified in Vite preview: drawer opens + lists 6 + 0 console errors. No `tasks/<id>/` file exists yet (needs a dispatch) → chip dormant (honest no-op) until then. |
| Gateway (:8642) | ⚪ N/A by design | Excised with Hermes; `/api/mc/gateway` returns graceful-empty. NOT a blocker. |
| `npm run build` | ✅ PASS | tsc + vite, exit 0 ~634ms, 157 modules (chunk-size warning only). Run #19 touched **only `mc_store.py`** (Python) → no TS change, JS build unaffected. |
| `npm run lint` | 🔴 FAIL (pre-existing, NOT this run) | **Full project `npm run lint` = ~500 errors / 473 auto-fixable** (`ban-ts-comment`, `no-unused-vars`, `set-state-in-effect`, `react-hooks/refs`) across sibling/untouched TS. Run #19 touched **0 TS files** (Python-only) so lint is unchanged. Python (my lane): `py_compile mc_store.py` ✅. |
| Kanban / orchestration | 🟢 FED + healthy | **ready 8 · done 18 · blocked 6 · todo 0 · triage 0** (steady). `reconcile` dry → no stale claims; no `retry_exhausted`/`dep`/`dead_agent`/`cycle`/`promotable`. 6 blocked = `blocked_no_reason` severity `info` (web-access, operator config). `dispatchable` = 8 (4 carousels `web_gap:true`). Did NOT dispatch (operator absent — side-effecting; TO-DO #1). |
| Cron jobs | 🟡 EMPTY + engine LIVE | store `jobs: []`; scheduler daemon running (32 ticks). Maintenance `*/30` sweep (run#10) now ALSO promotes todo→ready (run #12 sweep step). Seeding needs operator sign-off (TO-DO #4). |
| Content pipeline | ✅ stores live | `/api/content/pipeline` → campaigns 27 · drafts 13 (↑ from 5) · calendar 36 (growing; writing `.mc/data/`). |
| Modules in error state | none observed | Diagnostics clean apart from the 6 web-access `blocked_no_reason`. Run #12's ▲ PROMOTE READY button renders disabled on the live (pre-restart) bridge — honest count-0 fallback. |

---

## TO-DO  _(rewritten each run — priority order, enough detail to act with no rediscovery)_

1. **Restart the bridge to activate TEN built capabilities at once** (`npm run bridge`, or whatever
   launches the operator's bridge / desktop app). The live bridge still holds pre-restart code
   (confirmed this run: `/api/mc/kanban/sweep` → 404). After restart, confirm **all** of:
   - **maintenance cron job kind (run#10)** → `POST /api/mc/cron` with
     `{"schedule":"*/30 * * * *","kind":"maintenance","action":"sweep","name":"board self-heal"}` creates a job with
     `kind:"maintenance"`, `action:"sweep"`, `prompt:null` (the OLD bridge silently drops `kind`/`action`, creating an
     inert prompt-less claude job — that's the tell it predates this code). A bad action returns **400**
     ("unknown maintenance action"); a bad kind returns **400**. The in-bridge scheduler then fires it on the local
     clock **with no Claude turn**: `CronScheduler._fire` dispatches `kind=="maintenance"` to `STORE.run_maintenance(action)`
     → `STORE.sweep_board(dry_run=False)`, stamping `last_status`/`last_detail` (= the sweep message) via
     `record_cron_result`. `POST /api/mc/cron/{id}/run` runs the same verb on-demand. In the ⏱ CRON modal: the create
     form has a **KIND toggle** (◆ CLAUDE PROMPT / ⚙ MAINTENANCE) — selecting MAINTENANCE swaps the PROMPT textarea for
     a sweep ACTION select — and a maintenance job row shows a **⚙ sweep** chip. On the current board a fired sweep is a
     no-op (`total 0`) until ≥1 self-heal condition exists. **Do NOT auto-seed the recurring `*/30` self-heal job without
     operator sign-off** (standing config — TO-DO #5). Fully proven in-process this run (throwaway store: maintenance job
     created + validated, `is_due` fires it on action not prompt, a seeded 3h-stale claim was reconciled→ready by the
     fired sweep, `last_status=ok` stamped, 2nd fire no-op, bad action raises, raw shows the kind).
   - **one-call board self-manage macro (run#9)** → `POST /api/mc/kanban/sweep` with `{"dry_run":true}` returns
     `{reconciled,cascade,reassigned,escalated,counts:{reconciled,held,promoted,reassigned,escalated},total,dry_run,message}`.
     On the current board it returns `total:0` ("board already healthy — nothing to do") because all four self-heal
     conditions are absent (0 stale claims, 0 dep-blocked, 0 dead agents, 0 retry-exhausted), so Operations → ⚠
     diagnostics → the emerald **⚙ SWEEP BOARD** button (lead of the toolbar) stays **disabled** with tooltip
     "Board healthy — no self-heal actions pending" (`sweepCount = staleCount+depCount+deadCount+exhaustedCount = 0`).
     To exercise the live path you need ≥1 of those conditions; one click then runs reconcile→cascade→reassign→escalate
     **in that fixed order** (reconcile first frees stale claims so reassign sees the idle agent; cascade before reassign
     so a dep-held task isn't moved; escalate last as the safety net) and the result line summarizes each sub-count.
     Each sub-verb is idempotent + dry-run-able so a 2nd sweep is a no-op. Fully proven in-process this run on a throwaway
     store (4 conditions seeded → 1 sweep remediated all four in order → 2nd pass total 0; no `blocked_no_reason` after)
     and dry-run against the LIVE store (total 0, board unmutated). **Dry-run caveat (documented):** in dry-run each
     sub-verb plans against the *current* board, so a later verb doesn't see an earlier verb's planned-but-unapplied
     change (e.g. reconcile not freeing an agent yet can make reassign undercount) — the live non-dry sweep applies
     them sequentially so each verb sees the prior's result.
   - **dependency cycle/self-link guard (run#8)** → `POST /api/mc/tasks/link` with `{"parent_id":"X","child_id":"X"}`
     returns **400** ("refusing self-link … a task cannot depend on itself"); a cycle-closing edge (link `A→B`,
     `B→C`, then `C→A`) returns **400** ("would create a dependency cycle"); a valid DAG edge still 200s. If the
     `kanban-meta.json["links"]` graph ever contains a pre-existing loop, `GET /api/mc/kanban/diagnostics` emits a
     `dependency_cycle` warn row per task in the loop and the Operations → ⚠ diagnostics modal renders it
     automatically (generic `x.message || x.kind` row). On the current board (0 links) it's an honest no-op.
     Fully proven in-process this run (throwaway store: A→A rejected, A→B→C→A rejected, A→B→C valid, a pre-seeded
     X⇄Y cycle flags both X and Y). No restart needed to verify the diagnostic surface (read-only) — only the 400
     guard needs the new bridge code.
   - **`POST /api/mc/kanban/reassign` (run#7)** → `{reassigned,skipped,dead_agents,dry_run,message}`. On the
     current board it returns all-empty (`reassigned:[] dead_agents:[]`, "no dead/idle agents") because all 8
     board assignees are on the live roster and there are **0 running (stale) claims**, so Operations → ⚠
     diagnostics → the orange **♻ REASSIGN DEAD** button stays **disabled** (correct, honest empty state). To
     exercise the live path you need a dead/idle agent: either (a) an **off-roster** assignee (a task assigned to
     a name not in `agents.json`, e.g. after deleting an agent that still owns todo/ready work), or (b) an agent
     sitting on a **stale running claim** (a `running` task with `started_at` > 2h old). Such an agent's workable
     tasks (todo/ready, or the stale running claim — which is also reclaimed to ready) get a `dead_agent_task`
     diagnostic, the button enables `(n)`, and clicking moves each task to the best-fit OTHER live agent by skill
     match (least-loaded tie-break), recording a `reassigned` event; `blocked` tasks are never touched and an
     unmatched task is honestly left in place. Verify safely first with `{"dry_run":true}`. Fully proven
     in-process this run on throwaway stores (see DONE Run#7).
   - **`POST /api/mc/kanban/cascade` (run#6)** → `{held,promoted,waiting,dry_run,message}`. On the current
     board it returns all-empty (`held:[] promoted:[] waiting:[]`, "no dependency changes") because the board
     has **0 dependency links** (`kanban-meta.json["links"]` is empty), so Operations → ⚠ diagnostics → the
     violet **⇄ CASCADE DEPS** button stays **disabled** (correct, honest empty state). To exercise the live
     path you need ≥1 parent→child link (create a task with `parents:[...]`, or append to `links`): a child in
     `todo`/`ready` with an open parent gets a `blocked_by_dependency` diagnostic, the button enables `(n)`,
     and clicking HOLDS it → `blocked` (with reason, never `blocked_no_reason`); once all its parents are
     `done`, a second cascade PROMOTES it → `ready`. Fully proven in-process this run on a throwaway store
     (see DONE Run#6).
   - `GET /api/mc/cron` → includes `"scheduler": {enabled:true, running:true, tick_seconds:30, …}`;
     Operations → ⏱ CRON modal banner flips from amber "scheduler unknown" to green **DAEMON LIVE**.
   - `POST /api/mc/kanban/reconcile` (run#1) → `{reclaimed,threshold_hours,message}`; Operations →
     ⚠ diagnostics → **⟳ RECONCILE STALE** button works (disabled at 0 stale, the current state).
   - `GET /api/mc/agents/web-access` (run#3) → `{agents,summary,hint}` (in-process: `summary.missing_web=9,
     blocked_due_to_web=6`); Operations → ⚠ diagnostics → a **WEB-ACCESS AUDIT** panel lists the 9 flagged
     agents (narratrix top, 5 blocked) with the amber provisioning hint.
   - `POST /api/mc/kanban/route` (run#4) → `{routed,skipped,dry_run,message}`. Verify safely first with
     `{"dry_run":true}` → routes `t_6f880653` → narratrix (score 23, skill_match [brand,content,copy,voice]),
     board unmutated. Then Operations → ⚠ diagnostics → **⤵ AUTO-ROUTE TRIAGE (1)** button → click routes
     the triage task to narratrix and de-triages it to `todo` (triage 1→0, todo 8→9).
   - **`POST /api/mc/kanban/escalate` (run#5)** → `{escalated,skipped,dry_run,message}`. On the current board
     it returns `escalated:[]` (no task has burned its retry budget — no failed runs recorded), so Operations →
     ⚠ diagnostics → the red **⚑ ESCALATE EXHAUSTED** button stays **disabled** (correct, honest empty state).
     To exercise the live path you need a task with `max_retries=N` and ≥N runs whose `outcome` ∈
     {error,failed,failure,timeout,timed_out,crashed}; such a task gets a `retry_exhausted` warn diagnostic,
     the button enables `(n)`, and clicking moves it to `blocked` with a recorded reason + `escalated` event.
     Fully proven in-process this run on a throwaway store (see DONE Run#5).
   - To run the bridge *without* the scheduler: `MC_SCHEDULER_ENABLED=0` (tick override:
     `MC_CRON_TICK_SECONDS`, per-job timeout: `MC_CRON_JOB_TIMEOUT`).
2. **Seed sentinel(7:00 = `0 7 * * *`) + content-engine(7:30 = `30 7 * * *`) cron jobs.** This is now
   safe-to-fire (the scheduler engine exists and will actually run them on the local clock). **Two
   guards before seeding:** (a) supply the *correct* pipeline prompts (find them in loop.md / AGENTS.md
   / the existing run-on-demand paths — don't guess), and (b) **content-engine auto-posts to Buffer
   (outward-facing side effect)** — confirm with the operator before creating an auto-firing public-post
   job. Was NOT auto-seeded this run on purpose (standing config + external side effect with no operator
   present). Create via the working "+ SCHEDULE JOB" UI or `POST /api/mc/cron`.
3. **Unblock the 6 blocked research tasks (root cause: no web-access tool) — NOW AUDITED (run#3).**
   All 6 (5×`narratrix`, 1×`default`) are DA-Agency research/content tasks stalled ~150–165h. The new
   **WEB-ACCESS AUDIT** panel (Operations → ⚠ diagnostics, live after restart) names every flagged
   agent: in-process the audit shows **9 agents need web access and have none** (narratrix, default,
   signalscraper, corpnet, claudelink, coldwire, brandwarden, hivemind, metricore), with
   `blocked_due_to_web=6`. Fix remains **config, not code**: provision `web-brave-free` /
   `BRAVE_SEARCH_API_KEY` and add it to each flagged agent's `mcps`, then unblock+reassign. The audit
   makes the gap visible but does NOT provision — operator action. Surface it, don't fake it.
4. **Route the 6 triage tasks — AUTOMATED (run#4), pending restart.** The board now has **6 unassigned triage
   tasks** (was 1 — 5 new appeared this run). The deterministic **skill-match router** handles them: after the
   restart, click ⤵ AUTO-ROUTE TRIAGE (or `POST /api/mc/kanban/route` with no `task_id` to sweep all, or per-id)
   → each gets its best-fit owner by skill-token match and de-triages to `todo`; an unmatched task is honestly
   left in triage. Verify safely first with `{"dry_run":true}`. The Claude `specify` flesh-out
   (`POST /api/mc/tasks/{id}/specify`, runs a live turn) stays a separate optional step. Did NOT auto-route this
   run (live bridge predates the endpoint — `/api/mc/kanban/route` → 404; safe to do post-restart).
5. **Seed the recurring board self-heal cron job — now UNBLOCKED (run#10), needs operator sign-off.** The maintenance
   job kind exists, so a single recurring `POST /api/mc/cron`
   `{"schedule":"*/30 * * * *","kind":"maintenance","action":"sweep","name":"board self-heal"}` would keep the fleet
   healthy with **no human/Claude turn** every 30 min (reconcile→cascade→reassign→escalate; a no-op when the board is
   already healthy, so it's cheap and safe to run often). This is the post-Hermes autonomy goal. **Was NOT auto-seeded
   this run on purpose** — it's standing config and the operator isn't present. Create it via the ⏱ CRON modal's KIND
   toggle → ⚙ MAINTENANCE → sweep, or the curl above, once the operator confirms. (Pairs with TO-DO #2's pipeline cron
   jobs — those have an external Buffer side effect and need the same sign-off.)
6. **Next capability to BUILD:** **per-task `unlink` cycle-break affordance** (GAPS #10). run#8 surfaces a
   `dependency_cycle` diagnostic read-only, but there's no in-UI way to *break* a cycle — an operator who sees the
   warning has no button to remove the offending parent→child edge. Build it end-to-end: a store `unlink(parent, child)`
   verb (remove the edge from `kanban-meta.json["links"]`, record an event) → `POST /api/mc/tasks/unlink` →
   `unlinkTasks()` api fn → a small "✕ unlink" affordance in the TaskDetailDrawer's dependency list (and/or a
   cycle-break action on the `dependency_cycle` diagnostic row). Pure + testable: in-process seed an X⇄Y cycle, unlink
   one edge, assert the cycle is gone and `_cycle_nodes` is empty. Note: `TaskDetailDrawer.tsx` is currently in the
   sibling working tree (bughunt's reason-banner) — coordinate the region or prefer adding the action to the
   diagnostics modal row in `OperationsCenter.tsx` (this loop's file) to stay in-lane. One end-to-end per run.

---

## CAPABILITY GAPS  _(ranked by operator impact; ✅=built, →bughunt=broken-not-missing)_

1. ✅ **Stale-claim self-heal (BUILT this run).** Diagnostics *detected* `stale_claim` but there was
   no remediation verb — one dead agent could freeze the board forever (it did: a 160h zombie).
   Built `POST /api/mc/kanban/reconcile` → `reconcileKanban()` → `reconcileBoard()` store action →
   **⟳ RECONCILE STALE** button in the Operations diagnostics modal. Reclaims stale running claims
   back to `ready` with a recorded `reconciled` event.
2. ✅ **Cron scheduler engine (BUILT this run — was HIGHEST remaining).** Decision made: an **in-bridge
   daemon thread** (the bridge is the long-running process post-Hermes). `mc_scheduler.py` matches the
   UI's `cronSchedule.ts` semantics exactly (5-field Vixie cron + `@macros` + interval shorthand, local
   clock, DOM/DOW OR rule); `CronScheduler` in the bridge wakes every 30s, fires due jobs single-flight
   via `run_claude`, stamps the outcome. Honest liveness is surfaced in the cron modal. **Loads on next
   bridge restart** (TO-DO #1). Seeding the 2 pipeline jobs is now unblocked (TO-DO #2).
3. ✅ **Skill-match auto-route for triage tasks (BUILT this run — run#4).** Triage tasks sat unassigned
   until a human picked an owner (no dispatcher post-Hermes). Built the deterministic *assign-by-skill* half
   of "triage → specify → assign": `POST /api/mc/kanban/route` → `MCStore.route_triage(task_id?, dry_run?)`
   → `routeTriageTasks()` store action → a cyan **⤵ AUTO-ROUTE TRIAGE (n)** button in the Operations
   diagnostics modal. Scores every agent (skill slugs ×3 + role text ×1, multiplicity rewards depth),
   **requires ≥1 skill-token match** for confidence, breaks ties toward the **least-loaded** agent, assigns
   the winner + de-triages to `todo` with a `routed` event, and **honestly leaves unmatched tasks in triage**
   (never force-assigned). `dry_run` previews without mutating; flags `web_gap` when the winner needs web but
   lacks an MCP (ties into run#3's audit). No worker is fired (no in-process dispatcher). The Claude `specify`
   flesh-out stays a separate opt-in step. In-process against the live board: the 1 triage task routes to
   `narratrix` (score 23). Loads on next bridge restart (TO-DO #1).
4. ✅ **Retry-exhaustion escalation (BUILT this run — run#5).** `max_retries` existed on every task but nothing
   acted on it post-Hermes — a task whose assignee kept failing would silently loop. Built the missing
   self-management path: `_failed_attempts()` counts runs whose `outcome` ∈ `FAILED_OUTCOMES`
   (error/failed/failure/timeout/timed_out/crashed; honors an explicit `retries`/`attempts` floor), a new
   `retry_exhausted` warn **diagnostic** (open task whose failed-attempt count ≥ its positive `max_retries`,
   not yet escalated), and `POST /api/mc/kanban/escalate` → `MCStore.escalate_exhausted(task_id?, dry_run?)`
   → `escalateExhaustedTasks()` store action → a red **⚑ ESCALATE EXHAUSTED (n)** button in the Operations
   diagnostics modal. Escalation moves each exhausted task to `blocked` with a **recorded reason**
   (never `blocked_no_reason`) + an `escalated` event (attempts/budget/prev_status/assignee). Blocking — not
   silent reassign — is the safe default (same agent would re-fail; a human or the route verb picks the next
   owner); fully reversible; idempotent (a 2nd pass re-escalates nothing); `dry_run` previews. Honest by
   construction: no failed runs → nothing escalates. Loads on next bridge restart (TO-DO #1).
6. ✅ **Dependency-aware promotion gate (BUILT this run — run#6).** Parent→child links existed
   (`kanban-meta.json["links"]`, surfaced as `parents`/`children` in `show_task` + the `missing_dependency`
   diagnostic) but nothing enforced ordering — a child could be claimed before its parents finished and nothing
   re-promoted it when they did. Built the missing orchestration sweep: a new **`blocked_by_dependency` warn
   diagnostic** (non-terminal task with an existing-but-non-terminal parent), `MCStore._dep_held()` (reads a
   task's `dependency_hold`/`dependency_clear` event timeline) + `MCStore.cascade_dependencies(dry_run?)` →
   `POST /api/mc/kanban/cascade` → `cascadeDeps()` store action → a violet **⇄ CASCADE DEPS (n)** button in the
   Operations diagnostics modal. One pass HOLDS a workable child (todo/ready) with open parents → `blocked`
   (with a recorded reason + `dependency_hold` event, never `blocked_no_reason`), PROMOTES a child *it itself
   held* once all parents are `done` → `ready` (`dependency_clear` event), and surfaces children still WAITING.
   Conservative (only promotes tasks it held → a task blocked for another reason, e.g. web-access, is never
   touched), idempotent, `dry_run` previews. Honest by construction: 0 links on the live board → nothing changes.
   Loads on next bridge restart (TO-DO #1).
7. ✅ **Auto-reassign-on-dead-agent (BUILT this run — run#7).** `reconcile_board` reclaims a stale running claim
   to `ready` but **left it on the same dead assignee** (the next claim re-fails on the gone worker), and an
   off-roster (deleted) agent's backlog had no owner that would ever run it. Built the missing orchestration path:
   static `_is_stale_running()` + `_dead_agents()` (off-roster OR holding a stale running claim — NOT mere busy/
   blocked, so the web-blocked research tasks are never mistaken for a dead agent), a new **`dead_agent_task` warn
   diagnostic** (a dead/idle agent's workable task), and `POST /api/mc/kanban/reassign` → `MCStore.
   reassign_dead_agent(from_agent?, dry_run?)` → `reassignDead()` store action → an orange **♻ REASSIGN DEAD (n)**
   button in the Operations diagnostics modal. Moves each dead agent's workable task (todo/ready, or a stale
   running claim — also reclaimed to ready) to the best-fit OTHER live agent by skill match (reuses run#4
   `_route_score`; least-loaded tie-break), records a `reassigned` event, leaves an unmatched task honestly in
   place, never touches `blocked` tasks, and **never reassigns onto another dead agent** (even in single-agent
   mode). Off-roster truth uses the raw `list_agents()` roster in both the diagnostic and the verb so the button
   count and the action agree exactly. `dry_run` previews. Honest by construction: 0 dead agents on the live board
   → nothing changes. Loads on next bridge restart (TO-DO #1).
8. ✅ **Dependency cycle/self-link guard (BUILT this run — run#8).** `create_task(parents=...)` (`mc_store.py:233`)
   and `link()` (`mc_store.py:377`) accepted `A→A` and longer cycles unchecked, making run#6's cascade gate's "all
   parents done" unreachable — a child would wait forever, silently. Built the missing guard end-to-end: static
   `MCStore._would_cycle(links, parent, child)` (DFS — self-link OR child-can-already-reach-parent) wired into both
   `link()` (raises `ValueError`, surfaced as **400** on `POST /api/mc/tasks/link`) and `create_task`'s
   parent-append loop (cycle-forming parent edges silently skipped — a fresh child can only self-cycle); static
   `MCStore._cycle_nodes(links)` + a new **`dependency_cycle` warn diagnostic** in `diagnostics()` that flags every
   task participating in a pre-existing loop (so already-bad data is visible, not just newly-rejected). No new
   button — the diagnostics modal renders the new kind via its generic row (`OperationsCenter.tsx:410`); zero TS
   changed. Pure + testable; honest no-op on the live board (0 links). Loads on next bridge restart (TO-DO #1).
9. ✅ **One-call board self-manage macro (BUILT this run — run#9).** The four self-heal verbs
   (reconcile/cascade/reassign/escalate) each needed a separate button + call; nothing ran them in the right order
   in one shot. Built `MCStore.sweep_board(dry_run?)` (composes the four verbs in fixed order: reconcile → cascade →
   reassign → escalate, aggregating `{reconciled,cascade,reassigned,escalated,counts,total,dry_run,message}`) +
   added a `dry_run` param to `reconcile_board` so the macro previews cleanly; `POST /api/mc/kanban/sweep` →
   `sweepBoard()` store action → an emerald **⚙ SWEEP BOARD** button leading the Operations diagnostics toolbar
   (enabled when `staleCount+depCount+deadCount+exhaustedCount > 0`). Idempotent (2nd pass is a no-op), honest no-op
   on the live board. Loads on next bridge restart (TO-DO #1).
10. ✅ **Per-task cycle-break remediation (BUILT this run — run#17).** run#8 surfaced `dependency_cycle` read-only with no
    in-UI way to break the loop. The unlink backend chain already existed (sibling-landed `MCStore.unlink` `:415`,
    `POST /api/mc/tasks/unlink`, `unlinkMcTasks`, `useTaskStore.unlinkTasks`) but nothing consumed it and the diagnostic
    carried no edge data. Built the two missing pieces: `unlink()` now records a `dependency_unlink` event + returns
    `{removed}` (idempotent); `diagnostics()`'s `dependency_cycle` row now carries a structured `cycle_parents` array
    (on-cycle parent edges, via `_would_cycle`); `api.ts` typed the field; `OperationsCenter.tsx` renders an amber
    **✕ break ‹parent›** button per on-cycle parent → `unlinkTasks(parent, task_id)` + `fetchDiagnostics()`. In-lane
    (OperationsCenter.tsx, not the sibling TaskDetailDrawer.tsx). Verified in-process (seed cycle → flag → break → 0 cycles).
    Loads on next bridge restart; honest no-op on the live 0-link board.
11. ✅ **Scheduled / hands-free board self-heal (BUILT this run — run#10).** The sweep macro (run#9) was manual-only
    and the cron scheduler (run#2) could only fire Claude *prompts* (`run_claude`), so the board could not self-heal on
    a timer without a human or a Claude turn. Built the **maintenance cron job kind** end-to-end: `mc_scheduler.is_fireable`
    now lets a `kind:"maintenance"` job fire on its `action` (no prompt needed); `MCStore.create_cron` gains `kind`/`action`
    params (validates against `MAINTENANCE_ACTIONS={"sweep"}`, stores them, `ValueError`→400) + a new `run_maintenance(action)`
    dispatcher (`sweep`→`sweep_board(dry_run=False)`); `CronScheduler._fire` dispatches `kind=="maintenance"` to
    `STORE.run_maintenance` instead of `run_claude`, stamping the sweep message via `record_cron_result`; `POST /api/mc/cron`
    accepts `kind`/`action` and `POST /api/mc/cron/{id}/run` runs the verb on-demand. UI: a KIND toggle (◆ CLAUDE PROMPT /
    ⚙ MAINTENANCE) + sweep ACTION select in the ⏱ CRON create form, and a ⚙ sweep chip on maintenance job rows. A recurring
    `*/30 * * * *` sweep job now makes the fleet self-heal with no human in the loop — the post-Hermes autonomy goal.
    Seeding that recurring job needs operator sign-off (standing config — TO-DO #5). Loads on next bridge restart (TO-DO #1).
5. ✅ **Web-access audit surface (BUILT this run — run#3).** Research agents silently blocked on missing
   web tools with no way to *see* which agents lacked a web plugin. Built `GET /api/mc/agents/web-access`
   → `MCStore.web_access_audit()` → `getWebAccessAudit()` → a **WEB-ACCESS AUDIT** panel in the Operations
   diagnostics modal: flags every agent that needs the live web (research/intel skill markers, or sitting
   on blocked tasks) but has no web-capable MCP, sorted gap-first / most-blocked-first, with the honest
   amber provisioning hint. Diagnostic only — it never provisions a key (that stays operator config).
   In-process against the live roster: 9/14 agents flagged, `blocked_due_to_web=6` (exact match to the
   board's 5×narratrix + 1×default blocked tasks). Loads on next bridge restart (TO-DO #1).
12. ✅ **Kanban TASK DISPATCHER — the NORTH STAR, the one piece still missing post-Hermes (BUILT run #11).**
    The gateway used to host the dispatcher that turned `ready` kanban tasks into running Claude sub-agents; excising
    Hermes removed it, so 15 assigned tasks sat idle with nothing to execute them. Built the Claude-native successor
    end-to-end: `mc_store.dispatchable_tasks()` (best-first selection of `ready`+live-assignee tasks, read-only),
    `record_task_run()` (the first public run-writer — feeds `has_deliverable`/`latest_summary`/the retry-exhaustion
    counter), `requeue_task()`, and `complete_task(result=…)`; bridge `dispatch_task()` (claim → one headless
    `run_claude` turn with the agent's model/role/skills → complete-with-result, or record-error + requeue on failure),
    a `TaskDispatcher` daemon thread (single-flight, `MC_DISPATCH_CONCURRENCY`-capped, mirrors `CronScheduler`),
    `GET /api/mc/dispatcher` (status + dry-run preview) + `POST /api/mc/dispatcher/dispatch` (operator-initiated, dry-run
    or real-in-background); `api.ts` types/fetchers; an Operations → ⚠ **TASK DISPATCHER** panel (state · preview ·
    ▶ DISPATCH NEXT). **Daemon DISABLED by default** (`MC_DISPATCHER_ENABLED`) — autonomous bypassPermissions turns have
    side effects, so the operator opts in (same posture as the Buffer/self-heal crons); manual + dry-run usable
    immediately. Loads on next bridge restart (TO-DO #1).
13. ✅ **Board-wide promote_ready gate (BUILT this run — run #12).** The dispatcher (run#11) only fires `ready` work, but
    post-Hermes nothing moved `todo`→`ready` in bulk, so a freshly-routed/assigned task sat in `todo` forever and the
    dispatcher stayed starved (board `ready 0` ⇒ `dispatchable:[]`). Built the missing FEEDER end-to-end:
    `MCStore.promote_ready(task_id?, dry_run?)` (promotes every `todo` task with a **live-roster assignee** and **no open
    parent dependency** → `ready` with a `promoted` event; honestly leaves unassigned/off-roster/dep-blocked tasks in todo;
    distinct from the per-task ungated `promote_task`), a new **`promotable` info diagnostic** (the button's count source),
    a 5th **promote** step in `sweep_board` (`reconcile→cascade→reassign→escalate→promote`, new `promoted_ready` count) so
    the recurring maintenance cron flows work end-to-end; `POST /api/mc/kanban/promote` → `promoteReady()` api fn →
    `useTaskStore.promoteReady` → a sky **▲ PROMOTE READY (n)** button after ⤵ AUTO-ROUTE in the diagnostics toolbar (and
    `promoteCount` folded into the ⚙ SWEEP BOARD enable predicate). **✅ NOW LIVE (run #14):** bridge restarted →
    `POST /api/mc/kanban/promote` returns 200; ran it for real → 8 todos promoted todo→ready, dispatcher `dispatchable`
    populated (board un-starved). Store method `promote_ready` is in HEAD; the bridge endpoint + TS wiring are live-but-
    uncommitted (TO-DO #2).
14. ✅ **Non-parsing HEAD `mc_store.py` REPAIRED (run #13).** Was the standing #0 blocker for 3 runs. NOT mojibake — run #11's
    commit truncated `_would_cycle` (lost DFS body, spliced-in dispatch section closed the docstring early → bare em-dash
    tokenized as code → `SyntaxError` ~L1058). Committed a parsing `mc_store.py` (`cb8f0ae` = py_compile-clean working tree
    minus sibling `fail_task`), restoring `_would_cycle` + landing run #12's `promote_ready` in HEAD. `ast.parse(HEAD)` ✅.
    Per-hunk commits have a clean base again. (See DONE Run #13.)
15. 🔴 → bughunt/evolve (NEW, run #13): **`npm run lint` fails project-wide (~500 errors)** — pre-existing baseline in
    sibling/untouched TS, not this loop's. TO-DO #6 owns the hand-off + the suggested one-time reviewed `eslint --fix` sweep.
16. ✅ **Deliverables browser (BUILT this run — run #15).** Dispatched-agent output (markdown docs, a 25.9MB hero PNG) landed
    orphaned in `deliverables/`+`research/` at repo root — no task linkage, no UI surface (the per-task workspace browser only
    reads a task's own `workspace_path`, unset by dispatch). Built `GET /api/mc/deliverables` (listing) + `…/deliverables/file`
    (path-confined text reader, 256K cap, binary-safe) → `listDeliverables`/`readDeliverable` (api.ts) → new self-contained
    `DeliverablesDrawer.tsx` (list+viewer modal) → 📄 DELIVERABLES toolbar button in OperationsCenter. Read-only, honest-empty,
    LIVE-backed. Verified in-process (all 6 files listed, traversal→403) + build/eslint/Vite-preview. Loads on next bridge
    restart (404 until then). The natural follow-up (GAPS-runner, TO-DO #5) is the dispatcher workspace seam so these become
    task-linked. Live-but-uncommitted (TO-DO #2).
17. ✅ **Dispatcher workspace seam (BUILT this run — run #16).** The natural follow-up to #16's deliverables browser: dispatch
    ran in `PROJECT_ROOT` (`cwd=None`), so agent output was orphaned at repo root — un-owned, and collision-prone at
    concurrency>1 — and the per-task workspace browser (`GET /api/mc/tasks/{id}/workspace`) always returned "no workspace".
    Built `MCStore.ensure_workspace(task_id)` (`mc_store.py:1154`, pure appended method): creates a per-task dir at
    `deliverables/tasks/<id>/`, records its absolute path on `task['workspace_path']` + a `workspace_ready` event, idempotent.
    `dispatch_task` (`mission-control-bridge.py:464-471`) calls it before claiming and passes `cwd=` to `run_claude`; the
    dispatch-prompt directive (`:436`) now points the agent at its working directory. **Key design call:** the workspace lives
    UNDER the `deliverables/` root (not `.mc/workspaces/` as TO-DO #5 sketched) so the run #15 global deliverables browser
    (recursive walk) AND the per-task workspace browser BOTH see the output — no regression, triple payoff (task-linked +
    collision-safe + dual-browser). No new endpoint/TS — flows through the existing dispatch path. Verified in-process +
    py_compile/ast + wiring-order + build. Loads on next bridge restart. Live-but-uncommitted (TO-DO #2).
18. ✅ **Task-aware deliverables browser (BUILT this run — run #18).** The run#16 seam writes dispatched output to
    `deliverables/tasks/<id>/…` and the run#15 global browser already listed those files, but the listing never parsed the
    owning task id, so a file couldn't be tied back to the task that produced it. Built a pure `_deliverable_task_id(root,
    rel_to_root)` helper (`mission-control-bridge.py:1506`) that derives the id from a `deliverables`-root path of shape
    `tasks/<id>/<file…>` (None for `research`/root-level/bare-`tasks/<id>`, no store hit); `list_deliverables` sets `task_id`
    per entry; `api.ts:394` added `task_id?: string | null` to `DeliverableEntry`; `DeliverablesDrawer.tsx:91` renders an
    emerald ⬡ ‹task_id› chip on rows that carry one. In-lane (all this loop's files). Verified in-process (7-case parse test →
    ALL PASS) + build + eslint. Loads on next bridge restart; honest no-op chip until a watched dispatch produces a
    `tasks/<id>/` file.
19. ✅ **`link()` dependency-audit symmetry (BUILT this run — run #19).** run#17 made `unlink()` record a `dependency_unlink`
    event but `link()` still mutated `kanban-meta.json["links"]` SILENTLY — an asymmetric audit trail (edge removals visible,
    additions invisible). Built it (in-lane, `mc_store.py:410`): `link()` computes `added` (is the edge genuinely new?) and
    ONLY on a new edge appends it AND records a `dependency_link` event on the **child** (`{parent}`); the already-linked
    no-op records nothing (idempotent symmetry with `unlink`). Return shape gains `{added}` (additive — `link_tasks` returns
    it verbatim, no caller break); cycle/self-link guards unchanged (still raise→400). Pure + testable; honest no-op on the
    live 0-link board. Loads on next bridge restart. The natural follow-up (TO-DO #5): surface `dependency_link`/`_unlink` in
    the task-activity timeline UI so the audit trail is reachable.
20. ✅ **Artifact→producing-task navigation loop (BUILT this run — run #20).** run#18 surfaced each deliverable's producing
    `task_id` as an emerald ⬡ chip, but it was an inert `<span>` — an operator who saw "produced by task t_xxxx" had no way to
    jump to that task. Built the missing affordance fully in-lane (NO sibling file touched): `DeliverablesDrawer.tsx`
    (untracked, mine) gained an optional `onOpenTask?: (taskId) => void` prop and the ⬡ chip became an independently-clickable
    `<span role="button">` (`onClick` → `stopPropagation()` → `onClose()` → `onOpenTask(d.task_id)`; kept as a span because the
    row is already a `<button>` and a nested button is invalid markup; cursor/hover styling only when the handler is wired).
    `OperationsCenter.tsx` (this loop's file — already hosts both the `TaskDetailDrawer` `:315` and `DeliverablesDrawer` `:317`)
    wired it in one line: `onOpenTask={(id) => { setDeliverablesOpen(false); setOpenTaskId(id); }}`. Verified: build ✅ + eslint
    both files clean + Vite preview (drawer opens, 6 files, 0 console errors, regression-clean). Loads on next bridge restart +
    frontend rebuild; dormant honest-no-op until a watched dispatch writes a `tasks/<id>/` deliverable. The follow-up (TO-DO #5):
    surface the `dependency_link`/`_unlink` events in the `TaskDetailDrawer` event timeline (pre-scouted — see TO-DO #5).
21. ✅ **Task event-timeline legibility layer (BUILT this run — run #21).** The per-task EVENT TIMELINE rendered each event's
    raw snake_case `kind` (`<span>{e.kind}</span>`, `TaskDetailDrawer.tsx:411`) with no icon, and `eventDetail()` only scanned
    `DETAIL_KEYS` — so `dependency_link`/`dependency_unlink` events (run #17/#19) appeared but their `payload.parent` (the WHICH
    edge) was invisible. Built `src/lib/eventLabels.ts` (new file, 100% mine): `labelFor(kind)` → `{label, icon}` for the ~24
    kinds Mc emits (Title-cased fallback for unknowns, never blank) + `eventParent(payload)` (surfaces a string `payload.parent`).
    Consumed in `TaskDetailDrawer.tsx` (timeline-row region `:405-426` + import `:14`, DISJOINT from the sibling FAIL-action/
    banner WIP): the row now renders `<icon> <label>` with `title={e.kind}` (raw kind on hover) + a NEW emerald **↳ parent ‹id›**
    button → `onOpenTask(parent)`. Verified: build ✅ + eslint both files clean + Vite preview (ready task `▲ promoted`, DONE task
    `✓ completed · ◉ claimed · ▲ promoted`, 0 console errors). The ↳ parent chip is dormant until a `dependency_link`/`_unlink`
    event exists (live bridge predates run #17/#19's edge-event recording — loads on restart). `eventLabels.ts` committed; the
    `TaskDetailDrawer.tsx` consumer edit is sibling-tangled → live-but-uncommitted (TO-DO #2). The follow-up (TO-DO #5): a
    board-wide recent-activity feed reusing this helper.
22. ✅ **Board-wide recent-activity feed (BUILT this run — run #22).** run #21 made events legible *per task*, but an operator had
    no at-a-glance "what just happened across the whole board" view — they had to open each task drawer one by one. PRE-SCOUT:
    `GET /api/mc/activity` (`bridge:873`) already exists but only synthesizes 3 coarse lifecycle entries (created/claimed/completed)
    from task timestamps — it never walks the per-task event log (misses promoted/reconciled/routed/escalated/reassigned/
    dependency-edge/workspace_ready). Built the true full-taxonomy aggregation end-to-end (branch (b), leaving `/api/mc/activity`
    untouched — 4 consumers, no regression): `MCStore.recent_events(limit)` (`mc_store.py:1770`, pure appended method walking
    `m["events"]` across all tasks, tagging each with `task_id`+`title`+`assignee`+`task_status`, sorted `created_at` desc) →
    `GET /api/mc/events?limit=50` (`bridge:923`, clean insert) → `McEvent`/`getRecentEvents` (`api.ts:829`, clean block) →
    `src/components/EventFeedDrawer.tsx` (new file, 100% mine: each row `<icon> <label>` via run #21's `labelFor` + clickable task
    title → `onOpenTask` deep-link + emerald ↳ parent chip via `eventParent` + assignee + relative time; honest empty/error) →
    a **▦ ACTIVITY** toolbar button + drawer mount in `OperationsCenter.tsx` (4 disjoint edits). Verified: AST both .py + in-process
    `recent_events` (total=4, sorted desc, parent/title/assignee on each row) + build (671ms) + eslint 3 files clean + Vite preview
    (button renders, drawer opens, honest 404 against pre-restart bridge, 0 console errors). Endpoint loads on next bridge restart.
    Live-but-uncommitted (TO-DO #2). Follow-up (TO-DO #5): make the feed auto-refresh (live polling) via the `useActivityStore` pattern.
- → bughunt / NOT this loop: block-reason **display** in the task drawer + FAILED-vs-BLOCKED reconciliation (the sibling
  `fail_task` WIP, still uncommitted in the working tree) are bughunt's — do not redo.

---

## DONE  _(append-only — newest first; dated, with file:line + how verified)_

### 2026-06-17 — Run #22 (BUILT the BOARD-WIDE RECENT-ACTIVITY FEED — a ▦ ACTIVITY drawer in Operations merges every task's full event timeline newest-first, reusing run #21's icon/label layer) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE — green.** Bridge :8767 UP (`/api/ping` ok, **uptime ~13.5h** = 48732s — predates this run; still on run #15 code). `/api/mc/kanban/stats` → `ready 8 · blocked 6 · done 18 · todo 0 · triage 0`; `/api/mc/kanban/reconcile` → "no stale claims found". `npm run build` ✅ (157 modules, 671ms); `npx eslint` on all 3 touched TS files → No issues. Sibling logs unchanged (no collision).

2. **ORCHESTRATION — board steady + healthy, no action needed.** `ready 8 · blocked 6 · done 18` (unchanged from runs #19–#21). Reconcile dry → no stale claims. **Did NOT dispatch** (operator absent; side-effecting bypassPermissions turns need sign-off — TO-DO #1), did NOT enable the daemon or seed crons.

3. **PRE-SCOUT (prior TO-DO #5 required this first).** Grepped the bridge + store for a cross-task event aggregation route. Found: `GET /api/mc/activity` **already exists** (`mission-control-bridge.py:873`) — BUT it only synthesizes **three** coarse lifecycle entries per task (created/claimed/completed) from `created_at`/`started_at`/`completed_at` timestamps; it does NOT walk the per-task event log, so it never surfaces `promoted`/`reconciled`/`routed`/`escalated`/`reassigned`/`dependency_link`/`dependency_unlink`/`workspace_ready`/`blocked`(reason) — the exact kinds run #21's `labelFor`/`eventParent` were built for. No store method walked all events. So this was prior-TO-DO-#5 branch **(b): build the true event-timeline aggregation end-to-end** (the narrow `/api/mc/activity` stays untouched — War Room AGENT SIGNAL / Ghost Network / Sentinel digest / AgentDrillDown all consume it; I added a *parallel* full-taxonomy feed, no regression).

4. **BUILT: the board-wide recent-activity feed (CAPABILITY GAPS #22 / prior TO-DO #5), end-to-end.** An operator had no at-a-glance "what just happened across the whole board" view — to see recent claims/completions/blocks/promotions/dependency-edges they had to open each task drawer one by one (run #21 made it legible *per task* only). Built the full chain:
   - `MCStore.recent_events(limit=50)` (`mc_store.py:1770`, **pure appended method at the very end of the class**, clear of the sibling `fail_task` `:319` / `link` `:407` hunks): walks `m["events"]` across ALL tasks, tags each event with its owning `task_id` + `title` + `assignee` + current `task_status`, merge-sorts by `created_at` desc, caps to `min(limit,500)`. Returns `{events:[…], total}`.
   - `GET /api/mc/events?limit=50` (`mission-control-bridge.py:923`, **clean contiguous insert** right after the `/api/mc/activity` handler): thin passthrough to `STORE.recent_events`.
   - `src/lib/api.ts` (`McEvent` interface + `getRecentEvents(limit)`, **clean isolated block** right after `getMcActivity`, `:829`).
   - `src/components/EventFeedDrawer.tsx` (**new file, 100% mine**): a modal listing each event newest-first as `<icon> <label>` (reusing `labelFor(e.kind)` from run #21's `eventLabels.ts`) + the owning task's title (a `<button>` → `onOpenTask(task_id)` deep-link to its detail drawer) + an emerald **↳ parent ‹id›** chip for dependency rows (reusing `eventParent(e.payload)`) + assignee + relative time. Honest-empty + honest-error states; fetches 100 events one-shot on open.
   - `src/pages/OperationsCenter.tsx` (this loop's owned file; 4 small disjoint edits — import `:17`, `eventsOpen` state `:116`, a **▦ ACTIVITY** toolbar button next to 📄 DELIVERABLES `:266`, and the `<EventFeedDrawer>` mount `:319` wired `onOpenTask` → `setOpenTaskId`).
   **Verified:** AST-parse both Python files ✅; **in-process `recent_events` test** (throwaway store, 2 tasks + a seeded `promoted` + a `dependency_link{parent}` event) → `total=4`, sorted desc ✅, dependency row carried `parent`, every row carried title+assignee ✅; `npm run build` ✅ (157 modules, 671ms); `npx eslint EventFeedDrawer.tsx OperationsCenter.tsx api.ts` → **No issues**. **Vite preview (port 5219, `#/operations`):** the **▦ ACTIVITY** button renders in the toolbar, clicking opens the drawer (header present), and against the **live (pre-restart) bridge** the feed shows the honest error **"⚠ Request failed with status code 404"** (the running bridge predates `/api/mc/events`) — i.e. graceful degradation, NOT a crash; **zero console errors**. `graphify update .` ✅ (1828 nodes). **Loads live on the next bridge restart** (the endpoint 404s until then; `recent_events` is the verified core). Screenshot tool timed out (renderer infra — eval confirmed the DOM + zero console errors).

5. **COMMIT — `.mc/LOOP_STATE.md` only, locally on `auto/loop-reconcile-20260615` (same blocker as runs #12–#21).** All four code surfaces are sibling-tangled in the working tree: `mc_store.py` (+118 total this tree, my `recent_events` rides above sibling `fail_task`), `mission-control-bridge.py` (+347), `src/lib/api.ts` (+108), `src/pages/OperationsCenter.tsx` (+94) — a full-file `git add` on any sweeps in sibling WIP (forbidden). My new `EventFeedDrawer.tsx` is 100% mine but imports `getRecentEvents`/`McEvent` from the uncommitted-in-full `api.ts`, so committing it standalone would reference a HEAD-absent export (broken HEAD) — deferred to the live-but-uncommitted bucket (TO-DO #2), exactly like run #15's DeliverablesDrawer / run #21's TaskDetailDrawer consumer. The feature is fully present + verified in the working tree; lands cleanly once the api.ts congestion clears. My `recent_events` hunk + the bridge endpoint + the api.ts block are all disjoint clean blobs → strong per-hunk clean-blob candidates whenever a quiet tree appears.

### 2026-06-17 — Run #21 (BUILT the TASK EVENT-TIMELINE LEGIBILITY LAYER — every event kind now renders an icon + human-readable label, and dependency events surface a clickable ↳ parent edge) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE — green.** Bridge :8767 UP (`/api/ping` ok, **uptime ~11.5h** = 41526s — predates this run; still on run #15 code). `/api/mc/kanban/stats` → `ready 8 · blocked 6 · done 18 · todo 0 · triage 0`; `/api/mc/dispatcher` → `{enabled:false,running:false,concurrency:1}`, `dispatchable` = 8 (gridkeeper×2, narratrix×2, claudelink×4 — the 4 claudelink carousels carry `web_gap:true`); `/api/mc/kanban/diagnostics` → only the 6 `blocked_no_reason` (severity `info`, the audited web-access research tasks — operator config). `npm run build` ✅ (157 modules, 629–633ms).

2. **ORCHESTRATION — board steady + healthy, no action needed.** `ready 8 · blocked 6 · done 18` (unchanged from runs #19/#20). No stale/dead/cycle/exhausted/promotable diagnostics. Dispatcher fed (8 dispatchable). **Did NOT dispatch** (operator absent; side-effecting bypassPermissions turns need sign-off — TO-DO #1), did NOT enable the daemon or seed crons.

3. **BUILT: the task event-timeline legibility layer (CAPABILITY GAPS #21 / prior TO-DO #5), end-to-end.** The gap (pre-scouted run #20): the per-task EVENT TIMELINE (`TaskDetailDrawer.tsx`) rendered each event's raw `kind` as bare snake_case (`<span>{e.kind}</span>`, `:411`) with no icon, AND `eventDetail()` (`:69`) only scanned `DETAIL_KEYS=['reason','message','error','detail','note']` — so the `dependency_link`/`dependency_unlink` events (run #19/#17) appeared but their `payload.parent` (the WHICH-edge) was invisible: the operator saw "dependency_link" with no indication of which parent. Built the missing presentation layer:
   - `src/lib/eventLabels.ts` (**new file, 100% mine**): `labelFor(kind)` → `{label, icon}` mapping for the ~24 kinds Mc emits (create/claim/complete/block/unblock/fail/route/promote/escalate/reassign/reclaim/reconcile/comment/edit/specify/schedule/archive/workspace_ready + the four dependency kinds: `dependency_hold`/`dependency_clear`/`dependency_link`/`dependency_unlink`), with a Title-cased fallback for unknown kinds (never blank → a new verb stays legible without editing this file); plus `eventParent(payload)` which surfaces a string `payload.parent` (the dependency edge id), `''` otherwise.
   - `src/components/TaskDetailDrawer.tsx` (consumer, **timeline-row region only** `:405-426` + the import `:14`): the timeline row now renders `<icon> <label>` (icon in muted grey, label in the existing pink) with `title={e.kind}` (raw kind on hover, so nothing is lost), and — for any event carrying `payload.parent` — a NEW emerald **↳ parent ‹id›** button that calls `onOpenTask(parent)` (jumps to the parent task's detail). My edit region is **DISJOINT** from the sibling bughunt WIP also live in this file (the FAIL-action + no-reason banner, hunks `@@-44/-80/-155/-207/-276`).
   **Verified:** `npm run build` ✅ (157 modules, 629ms); `npx eslint src/lib/eventLabels.ts src/components/TaskDetailDrawer.tsx` → **No issues found**. **Vite preview (bridge up, port 5219, `#/operations` HASH route):** opened the ready task "Draft 2-week content calendar" → timeline row rendered **`▲ promoted`** with `title="promoted"`; opened the DONE task `t_133b08ed` → timeline rendered **`✓ completed` · `◉ claimed` · `▲ promoted`** (three kinds, all with icons + labels). **Zero console errors** (`preview_console_logs level=error` → none). `graphify update .` ✅ (1817 nodes). **Not verified live (the ↳ parent chip):** it needs a `dependency_link`/`_unlink` event, which the live (pre-restart) bridge does NOT yet record — run #19's `link()` audit-event + run #17's `unlink()` event load on the next bridge restart; the chip then renders the first time an edge is created/removed via the drawer's link UI. Proven by build + eslint + the trivial `eventParent` extractor + the clean multi-kind render. Honest dormant state until then.

4. **COMMIT — `src/lib/eventLabels.ts` (100% mine, new) + this `LOOP_STATE.md`, locally on `auto/loop-reconcile-20260615`.** The `TaskDetailDrawer.tsx` consumer edit **CANNOT** be committed: the working-tree file intermixes my two disjoint hunks (import `:14` + timeline `:405`) with **sibling bughunt WIP** (the `fail` action — `ALLOW.fail`, `failMcTaskById` destructure, the FAIL button at `:293`, the `isStuck`/no-reason banner at `:159-231`), so a full-file commit sweeps in sibling work (forbidden). A per-hunk clean-blob commit of just my two hunks is feasible (they're disjoint regions) but not forced this run — it joins the live-but-uncommitted bucket (TO-DO #2), exactly like prior runs' sibling-tangled edits. The feature is fully present + verified in the working tree; it lands cleanly once the bughunt FAIL-action lane commits its `TaskDetailDrawer.tsx` hunks. `eventLabels.ts` commits standalone (HEAD just carries an unused helper until the consumer lands — no broken import, since I'm not committing the consumer).

### 2026-06-17 — Run #20 (BUILT the ARTIFACT→TASK NAVIGATION LOOP — the deliverables ⬡ task chip is now clickable → opens that task's detail drawer) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE — green.** Bridge :8767 UP (`/api/ping` ok, **uptime ~9.5h** = 34325s — predates this run; still on run #15 code). `/api/mc/kanban/stats` → `ready 8 · blocked 6 · done 18 · todo 0 · triage 0`; `/api/mc/dispatcher` → `{enabled:false,running:false,concurrency:1}`, `dispatchable` = 8 (gridkeeper×2, narratrix×2, claudelink×4 — the 4 claudelink carousels carry `web_gap:true`); `/api/mc/kanban/diagnostics` → only the 6 `blocked_no_reason` (severity `info`, the audited web-access research tasks — operator config). `npm run build` ✅ (157 modules, 635ms). Sibling logs (BUGHUNT_LOG / LOOP_LOG) tails unchanged — no collision.

2. **ORCHESTRATION — board steady + healthy, no action needed.** `ready 8 · blocked 6 · done 18` (unchanged from run #19). No stale/dead/cycle/exhausted/promotable diagnostics. Dispatcher fed (8 dispatchable). **Did NOT dispatch** (operator absent; side-effecting bypassPermissions turns need sign-off — TO-DO #1), did NOT enable the daemon or seed crons.

3. **BUILT: the artifact→producing-task navigation loop (CAPABILITY GAPS #20 / prior TO-DO #5 runner-up), end-to-end, fully in-lane.** The gap: run #18 gave each deliverable an emerald **⬡ ‹task_id›** chip (the task that produced it), but the chip was an inert `<span>` — an operator who saw "produced by task t_xxxx" had no way to *jump* to that task's detail. Built the missing affordance across two files I own (NO sibling file touched):
   - `src/components/DeliverablesDrawer.tsx` (untracked, 100% mine): added an optional `onOpenTask?: (taskId: string) => void` prop; the ⬡ chip (`:102`) is now an independently-clickable element — kept as a `<span>` with `role="button"` + `onClick` that `stopPropagation()`s (the row itself is a `<button onClick={openFile}>`, so a nested `<button>` would be invalid markup), calls `onClose()` then `onOpenTask(d.task_id)`, and gains a `cursor-pointer` + emerald hover style ONLY when `onOpenTask` is wired (graceful: with no handler it stays a plain non-interactive label, unchanged from run #18).
   - `src/pages/OperationsCenter.tsx` (this loop's owned file): the page already hosts BOTH drawers (`TaskDetailDrawer` `:315` with `setOpenTaskId`, `DeliverablesDrawer` `:317`), so wiring is one line — `onOpenTask={(id) => { setDeliverablesOpen(false); setOpenTaskId(id); }}` on the `DeliverablesDrawer` (`:317`). Clicking a chip closes the deliverables modal and opens the producing task's detail drawer (full event timeline / runs / result).
   **Verified:** `npm run build` ✅ (157 modules, 635ms); `npx eslint` on BOTH touched files → **No issues found**. **Vite preview (bridge up, port 5219):** navigated to `#/operations` (app uses HASH routing), clicked **📄 DELIVERABLES** → drawer opens, lists all **6** deliverables, **zero console errors** (regression-clean — my additive prop didn't break the drawer). `chipCount: 0` on the live board is **expected + honest**: all 6 live deliverables are root-level/`research/` → `task_id:null`, AND the live (pre-restart) bridge predates the run #18 `task_id` parse, so no chip renders yet. The clickable behavior is a dormant honest-no-op until (a) the bridge restarts (loads run #18's `task_id` parse) AND (b) a watched dispatch produces a `deliverables/tasks/<id>/…` file. `graphify update .` ✅. **Not verified live (clickable path):** can't be exercised without a `task_id`-bearing deliverable + bridge restart; the wiring is proven by build + eslint + the clean drawer render + the trivial handler (stopPropagation → onClose → onOpenTask).

4. **COMMIT — ledger only (same blocker as runs #12–#19).** Run #20's two edits are both my files, but they ride on the same live-but-uncommitted base: `DeliverablesDrawer.tsx` depends on `api.ts`'s `DeliverableEntry.task_id` export (run #18, entangled with sibling `failMcTask`), and `OperationsCenter.tsx` already carries uncommitted run #15/#17 deliverables/cycle-break work whose api.ts/store deps aren't in HEAD — so neither can enter HEAD without breaking the build until the api.ts congestion clears (TO-DO #2). Committed **only `.mc/LOOP_STATE.md`**; the navigation affordance is operationally LIVE on the next bridge restart + frontend rebuild and joins the live-but-uncommitted bucket. Sibling WIP left fully intact.

### 2026-06-17 — Run #19 (BUILT the `link()` DEPENDENCY-AUDIT SYMMETRY — a new edge now records a `dependency_link` event, matching `unlink`) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE — green.** Bridge :8767 UP (`/api/ping` ok, **uptime ~7.5h** = 27131s — predates this run; still on run #15 code). `/api/mc/kanban/stats` → `ready 8 · blocked 6 · done 18 · todo 0 · triage 0`; `/api/mc/dispatcher` → `{enabled:false,running:false,concurrency:1}`, `dispatchable` = 8; `/api/mc/kanban/reconcile` → "no stale claims found". `npm run build` ✅ (157 modules, 634ms); `py_compile mc_store.py` ✅. Sibling logs (BUGHUNT_LOG / LOOP_LOG) tails unchanged — no collision.

2. **ORCHESTRATION — board steady + healthy, no action needed.** `ready 8 · blocked 6 · done 18` (unchanged). Diagnostics: only the 6 `blocked_no_reason` (severity `info`, the audited web-access research tasks — operator config); no stale/dead/cycle/exhausted/promotable. Dispatcher fed (8 dispatchable: gridkeeper×2, narratrix×2, claudelink×4 with `web_gap:true`). **Did NOT dispatch** (operator absent; side-effecting bypassPermissions turns need sign-off — TO-DO #1), did NOT enable the daemon or seed crons.

3. **BUILT: the `link()` dependency-audit symmetry (CAPABILITY GAPS #19 / prior TO-DO #5), end-to-end.** The gap: run#17 made `unlink()` record a `dependency_unlink` event on the child, but `MCStore.link(parent, child)` still mutated `kanban-meta.json["links"]` SILENTLY — so the dependency-edge audit trail was asymmetric (an operator could see an edge removed in the child's event timeline but never an edge added). Built the missing event:
   - `mc_store.py` `link()` (`:410`): now computes `added = pair not in m["links"]`; on a genuinely-new edge it appends the pair AND records a **`dependency_link`** event on the child with payload `{parent}`; the already-linked case records nothing (idempotent symmetry with `unlink`, which no-ops without an event). Return shape gains `{added}` alongside `{message}` — additive: the `/api/mc/tasks/link` `link_tasks` endpoint (`mission-control-bridge.py:1060`) returns the dict verbatim, so the extra key is harmless. The self-link / cycle guards (`_would_cycle`) are untouched and still raise `ValueError` → 400.
   **Verified:** in-process throwaway `MCStore(tmpdir)` — link A→B → `added:True` + exactly **1** `dependency_link` event on child B (`payload {parent:A}`); re-link A→B → `added:False`, still **1** event (idempotent — no duplicate); self-link A→A still rejected (`ValueError`); a cycle-closing edge (A→B, B→C, then C→A) still rejected; `unlink(A,B)` still records a `dependency_unlink` event → **ALL PASS**. `py_compile mc_store.py` ✅; `npm run build` ✅ (157 modules, 634ms — Python-only change, JS/TS untouched so the build & the ~500-error lint baseline are both unaffected); `graphify update .` ✅. **Loads on next bridge restart** (the live bridge predates the new event; the live board has 0 links, so the event is an honest no-op until an operator creates a dependency edge). **Not verified live/preview:** the event only fires on a real `link` call against the running bridge, which needs the restart; the logic is fully proven by the in-process test + py_compile + build.

4. **COMMIT — ledger only (same blocker as runs #12–#18).** Run #19's edit lands inside the `mc_store.py` link/unlink hunk (`:407`), which sits directly above the purely-sibling `fail_task` method (`:319`) in the same dirty file — committing `mc_store.py` in full would sweep in the sibling `fail_task` WIP (forbidden). My link hunk refs only HEAD symbols (`_would_cycle`, `_event`, `_save_meta`) → a clean-blob candidate, but the same per-hunk surgery caveat applies (TO-DO #2). Committed **only `.mc/LOOP_STATE.md`**; the `dependency_link` event is operationally LIVE on the next bridge restart and joins the live-but-uncommitted bucket. Sibling WIP left fully intact.

### 2026-06-17 — Run #18 (BUILT the TASK-AWARE DELIVERABLES BROWSER — each artifact now carries the task_id that produced it) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE — green.** Bridge :8767 UP (`/api/ping` ok, **uptime ~5.5h** = 19927s — predates this run; still on run #15 code). `/api/mc/dispatcher` → `{enabled:false,running:false,concurrency:1}`, `dispatchable` = 8; `/api/mc/kanban/reconcile` dry → "no stale claims found". `GET /api/mc/deliverables` → 200 (6 files). `npm run build` ✅ (157 modules, 637ms); `npx eslint` on the two touched TS files (`api.ts`, `DeliverablesDrawer.tsx`) → **no issues**; `py_compile mission-control-bridge.py` ✅.

2. **ORCHESTRATION — board steady + healthy, no action needed.** `ready 8 · blocked 6 · done 18 · todo 0 · triage 0` (unchanged). Diagnostics: only the 6 `blocked_no_reason` (severity `info`, the audited web-access research tasks — operator config); no stale/dead/cycle/exhausted/promotable. Dispatcher fed (8 dispatchable: gridkeeper×2, narratrix×2, claudelink×4 with `web_gap:true`). **Did NOT dispatch** (operator absent; side-effecting bypassPermissions turns need sign-off — TO-DO #1), did NOT enable the daemon or seed crons. Sibling logs (BUGHUNT/LOOP) tails unchanged — no collision.

3. **BUILT: the TASK-AWARE DELIVERABLES BROWSER (CAPABILITY GAPS #18 / prior TO-DO #5), end-to-end.** The gap: since run#16 the dispatcher writes a dispatched agent's output to `deliverables/tasks/<id>/…`, and the run#15 global `GET /api/mc/deliverables` already returned those files (recursive walk) with `rel_to_root: tasks/<id>/…` — but it never parsed the owning task id, so the DeliverablesDrawer could not show *which task* produced a file. Built the missing parse + surface:
   - `mission-control-bridge.py` (NEW helper, `:1506`, just above `list_deliverables`): `_deliverable_task_id(root, rel_to_root)` — returns the id from a `deliverables`-root path of exact shape `tasks/<id>/<file…>` (split on `/`: ≥3 segments, `parts[0]=="tasks"`, non-empty `parts[1]`, ≥1 trailing file segment); returns `None` for the `research` root, root-level files, or a bare `tasks/<id>` with no file under it. Pure string parse, **no store hit**. `list_deliverables` computes `rel_to_root` once and sets `"task_id": _deliverable_task_id(root, rel_to_root)` on each entry.
   - `src/lib/api.ts` (`:394`): added `task_id?: string | null` to the `DeliverableEntry` interface.
   - `src/components/DeliverablesDrawer.tsx` (`:91`): each list row that carries a `task_id` now renders an emerald **⬡ ‹task_id›** chip (bordered, `title="produced by task …"`) in the meta line next to the root/size/age.
   **Verified:** an in-process unit test exec'd the parsed-out helper source over 7 cases — `('deliverables','tasks/t_3d362830/calendar.md')→'t_3d362830'`, nested `tasks/t_abc/sub/dir/file.md→'t_abc'`, `assets/hero.png→None`, root-level→None, `tasks/t_abc` (no file)→None, `tasks//file.md` (empty id)→None, `research` root→None — **ALL PASS**. `py_compile mission-control-bridge.py` ✅; `npm run build` ✅ (157 modules, 637ms); `npx eslint api.ts DeliverablesDrawer.tsx` → **no issues**; `graphify update .` ✅ (1799 nodes / 3510 edges). **Loads on next bridge restart** (live bridge predates the new field — `GET /api/mc/deliverables` currently returns the 6 files with no `task_id` key; once restarted they'll carry `task_id:null` since all are root-level/`assets/`/`research/`). **Not verified live/preview:** the ⬡ chip only renders for a file under `deliverables/tasks/<id>/`, which requires BOTH the restart AND a watched dispatch (none has run — dispatcher is OFF). Logic fully proven by the 7-case parse test + build + type-check; a preview would show zero chips and prove nothing more.

4. **COMMIT — ledger only (same blocker as runs #12–#17).** Run #18's edits land in three sibling-congested files: `mission-control-bridge.py` (my clean `_deliverable_task_id` helper + 1-line `task_id` field, atop the sibling deliverables/promote endpoints + `fail_task`/`get_briefing`), `src/lib/api.ts` (my 1-line type field atop the run#15 deliverables block + sibling `failMcTask`), and `src/components/DeliverablesDrawer.tsx` (100%-mine chip edit, but uncommittable without its api.ts dep). Committing any in full sweeps in sibling/uncommitted WIP. Committed **only `.mc/LOOP_STATE.md`**; the task-aware browser is operationally LIVE on the next bridge restart and joins the live-but-uncommitted bucket (TO-DO #2). Sibling WIP left fully intact.

### 2026-06-16 — Run #17 (BUILT the PER-TASK CYCLE-BREAK AFFORDANCE — operators can now unlink an on-cycle edge from the diagnostics UI) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE — green.** Bridge :8767 UP (`/api/ping` ok, **uptime ~3.5h** — predates this run; still on run #15/#16 code). `/api/mc/dispatcher` → `{enabled:false,running:false,concurrency:1}`, `dispatchable` = 8; `/api/mc/kanban/reconcile` dry → "no stale claims found". `npm run build` ✅ (157 modules, ~630ms); `npx eslint` on the two touched TS files → **no issues**. `py_compile` + `ast.parse` `mc_store.py` + `mission-control-bridge.py` ✅.

2. **ORCHESTRATION — board steady + healthy, no action needed.** `ready 8 · blocked 6 · done 18 · todo 0 · triage 0` (unchanged). Diagnostics: only the 6 `blocked_no_reason` (severity `info`, the audited web-access research tasks — operator config); no stale/dead/cycle/exhausted/promotable. Dispatcher fed (8 dispatchable: gridkeeper×2, narratrix×2, claudelink×4 with `web_gap:true`). **Did NOT dispatch** (operator absent; side-effecting bypassPermissions turns need sign-off — TO-DO #1), did NOT enable the daemon or seed crons. Sibling logs (BUGHUNT/LOOP) tails unchanged — no collision.

3. **BUILT: the PER-TASK CYCLE-BREAK AFFORDANCE (CAPABILITY GAPS #10), end-to-end.** The gap: run#8's `dependency_cycle` diagnostic surfaced a stuck loop **read-only** — an operator who saw it had no in-UI way to *break* the cycle. **Discovery this run:** the unlink backend chain was ALREADY built (a sibling landed `MCStore.unlink` at `mc_store.py:415`, `POST /api/mc/tasks/unlink` at `mission-control-bridge.py:1019`, `unlinkMcTasks()` at `src/lib/api.ts:337`, and `useTaskStore.unlinkTasks` at `src/stores/useTaskStore.ts:454`) — but **nothing in the UI consumed it**, and the `dependency_cycle` diagnostic carried no structured edge data, so a button wouldn't know which edge to cut. Built the two missing pieces:
   - `mc_store.py` `unlink()` (`:415`): now records a **`dependency_unlink`** event on the child (`{parent}`) when an edge is actually removed (was a silent mutation; the TO-DO sketch explicitly wanted the audit event) + returns `{message, removed}` (idempotent — `removed:False`, no event, on a no-op unlink).
   - `mc_store.py` `diagnostics()` (`:520`): the `dependency_cycle` row now carries a structured **`cycle_parents`** array = the parents `p` whose edge `[p→tid]` actually lies on a cycle (computed via the existing `_would_cycle(links, p, tid)` — edge on cycle iff `tid` can already reach `p`, or self-link). The message text now lists those on-cycle parents (was all parents).
   - `src/lib/api.ts` (`:350`): added `cycle_parents?: string[]` to the `BoardDiagnostic.diagnostics` inline type.
   - `src/pages/OperationsCenter.tsx`: pulled `unlinkTasks` into the store destructure (`:66`), added a `breakingEdge` state, and in the diagnostics modal each `dependency_cycle` row now renders an amber **✕ break ‹parent›** button per on-cycle parent → `unlinkTasks(parent, task_id)` then `fetchDiagnostics()` to refresh (single-flight via `breakingEdge`, disables siblings while one runs). Stayed **in-lane** (TO-DO #5's directive): the action lives in `OperationsCenter.tsx` (this loop's file), NOT the sibling-WIP `TaskDetailDrawer.tsx`.
   **Verified:** in-process throwaway `MCStore` — built a 3-node A→B→C DAG, confirmed the cycle guard rejects the closing C→A edge, **injected** the C→A edge directly into meta to simulate pre-existing bad data → `diagnostics()` flags all 3 nodes with non-empty `cycle_parents`; `unlink(C,A)` → `removed:True` + exactly **1** `dependency_unlink` event on child A (`payload {parent:C}`); 2nd unlink → `removed:False`, still 1 event (idempotent); post-break `diagnostics()` → **0** cycle rows. `py_compile`/`ast.parse` both Python files ✅; `npm run build` ✅; `npx eslint` touched TS → no issues; `graphify update .` ✅. **Loads on next bridge restart** (live bridge predates the new `cycle_parents` field; live board has 0 links so the buttons are an honest no-op until a cycle exists). **Not verified in Vite preview** — the break button only renders when a `dependency_cycle` diagnostic exists, which needs BOTH the restart (for the new field) AND a seeded cycle; the live board has 0 links, so a preview would prove nothing the in-process test doesn't. Logic fully proven in-process + type-checked.

4. **COMMIT — ledger only (same blocker as runs #12–#16).** Run #17's edits land in three sibling-congested files: `mc_store.py` (my `unlink`/`diagnostics` edits + run#16 `ensure_workspace` + sibling `fail_task`), `src/lib/api.ts` (my one-line type field + run#15 deliverables block + sibling `failMcTask`), `src/pages/OperationsCenter.tsx` (all this loop's diagnostics UI, but the file is dirty with prior uncommitted loop work). Committing any in full sweeps in sibling/uncommitted WIP. Committed **only `.mc/LOOP_STATE.md`**; the cycle-break feature is operationally LIVE on the next bridge restart and joins the live-but-uncommitted bucket (TO-DO #2). Sibling WIP left fully intact.

### 2026-06-16 — Run #16 (BUILT the DISPATCHER WORKSPACE SEAM — dispatched output is now task-linked + collision-safe) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE — green; bridge RESTARTED so runs #12 & #15 went LIVE.** Bridge :8767 UP (`/api/ping` ok, **uptime ~92min**
   — the operator restarted it onto run #15 code). The decisive consequences: **`POST /api/mc/kanban/promote` → 200** (run #12
   LIVE) and **`GET /api/mc/deliverables` → 200** returning the 6 real artifacts (run #15 LIVE; was 404 for the prior run).
   `/api/mc/dispatcher` → `{enabled:false,running:false,concurrency:1}`, `dispatchable` = 8; `/api/mc/kanban/reconcile` dry →
   "no stale claims found". `npm run build` ✅ (157 modules, 622ms). `py_compile` + `ast.parse` working-tree `mc_store.py` +
   `mission-control-bridge.py` ✅.

2. **ORCHESTRATION — board steady + healthy, no action needed.** `ready 8 · blocked 6 · done 18 · todo 0 · triage 0`
   (unchanged from run #15 — board stays fed). Diagnostics: only the 6 `blocked_no_reason` (severity `info`, the audited
   web-access research tasks — operator config); no stale/dead/cycle/exhausted/promotable. Dispatcher fed (8 dispatchable:
   gridkeeper×2, narratrix×2, claudelink×4 with `web_gap:true`). **Did NOT dispatch** (operator absent; side-effecting
   bypassPermissions turns need sign-off — TO-DO #1), did NOT enable the daemon or seed crons. Content pipeline live
   (`/api/content/pipeline` → campaigns present, stores writing).

3. **BUILT: the DISPATCHER WORKSPACE SEAM (CAPABILITY GAPS #17), end-to-end.** The gap: `dispatch_task` ran every turn in
   `PROJECT_ROOT` (`cwd=None`) — so an agent's file output landed orphaned at repo root with no task linkage (the run #15
   deliverables browser made it *visible* but it was still un-owned), and concurrent dispatch (concurrency>1) would collide
   in one shared dir; the per-task workspace browser (`mission-control-bridge.py:1401`) always returned "no workspace". Files:
   - `mc_store.py` (NEW method, `:1154`, after `requeue_task`): `ensure_workspace(task_id)` — creates a per-task dir at
     `deliverables/tasks/<id>/`, records its **absolute** path on `task['workspace_path']` (+ a `workspace_ready` event),
     idempotent (re-creates the dir if missing, keeps an existing path), `KeyError` on unknown id. Pure appended method.
   - `mission-control-bridge.py` `dispatch_task` (`:464-471`): calls `cwd = STORE.ensure_workspace(task_id)` **before** the
     claim (so a failure after claiming still leaves a browsable workspace) and passes `cwd=cwd` to `run_claude`.
   - `mission-control-bridge.py` `_build_dispatch_prompt` (`:436`): the deliverable directive now says "write … to a file in
     your current working directory (your per-task workspace) … return the exact filename" (was repo-root `deliverables/`/
     `research/`).
   **Key design call:** the workspace dir lives UNDER the existing `deliverables/` root (NOT `.mc/workspaces/<id>/` as TO-DO #5
   sketched) — so the run #15 GLOBAL deliverables browser (which already walks `deliverables/` recursively) keeps seeing the
   output AND the per-task workspace browser (reads the same `workspace_path`) now shows real task-linked files. **No
   regression, triple payoff** (task-linked + collision-safe + both browsers work). No new endpoint/api.ts/store/UI — the
   capability flows entirely through the existing dispatch path. **Verified:** in-process against a throwaway `MCStore` — dir
   created under `deliverables/tasks/`, abs path recorded on the task, idempotent (2nd call = same path, exactly **1**
   `workspace_ready` event), `deliverables/` is a parent of the workspace, unknown id → `KeyError`. `py_compile` both files ✅;
   `ast.parse` both ✅; wiring-order assert (ensure_workspace precedes claim, `cwd=cwd` present) ✅; `npm run build` ✅ (TS
   untouched). `graphify update .` run (1793 nodes / 3498 edges). **Loads on next bridge restart** (the live bridge still runs
   the old `cwd=None` dispatch; the dispatcher is OFF so no live dispatch executed old code this run). **Not verified live:**
   an actual dispatched run writing into the workspace (needs an operator-watched dispatch + the restart — TO-DO #1).

4. **COMMIT — ledger only (deliberate, same blocker as runs #12–#15).** Run #16's edits sit in two sibling-congested files:
   `mc_store.py` now has my `ensure_workspace` (~33 lines) ON TOP of the purely-sibling `fail_task` (10 lines); `mission-
   control-bridge.py` mixes my dispatch wiring with the deliverables/promote endpoints + sibling `fail_task`/`get_briefing`.
   Committing either in full sweeps in sibling WIP (forbidden). My edits are clean isolated regions (strong clean-blob
   candidates) but per the hard rule + autonomous-run caution I did NOT force per-hunk surgery; committed **only
   `.mc/LOOP_STATE.md`**. The workspace seam is operationally LIVE on the next bridge restart and joins the run #12 promote +
   run #15 deliverables features in the live-but-uncommitted bucket (TO-DO #2). Sibling WIP left fully intact.

### 2026-06-16 — Run #15 (BUILT the DELIVERABLES BROWSER — orphaned agent output now reachable in the UI) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE — green.** Bridge :8767 UP (`/api/ping` ok, uptime ~2.2h, predates run #15). `POST /api/mc/kanban/promote`
   → 200 (run #12/#14 live); `/api/mc/dispatcher` → `{enabled:false,running:false,concurrency:1}` LIVE-but-OFF, `dispatchable`
   = 8; `/api/mc/kanban/sweep` → 200; scheduler `running:true` (262 ticks, 0 fired). `npm run build` ✅ (622ms). `ast.parse`
   working-tree `mc_store.py` ✅. Diagnostics clean apart from the 6 web-access `blocked_no_reason` (now severity `info`).

2. **ORCHESTRATION — board steady + healthy, no action needed.** `ready 8 · blocked 6 · done 18 · todo 0 · triage 0`
   (unchanged from run #14 — board stays fed). No stale/dead/cycle/exhausted/promotable diagnostics. The 6 blocked are the
   audited web-access research tasks (operator config). Dispatcher fed (8 dispatchable: gridkeeper×2, narratrix×2,
   claudelink×4 with `web_gap:true`). **Did NOT dispatch** (operator absent; side-effecting bypassPermissions turns need
   sign-off — TO-DO #1) and did NOT enable the daemon or seed crons. Content pipeline healthy (campaigns 27, drafts 13,
   calendar 36; `.mc/data/` writing).

3. **BUILT: the DELIVERABLES BROWSER (CAPABILITY GAPS #16), end-to-end & LIVE-backed.** The gap: a dispatch had produced
   6 real artifacts under `deliverables/`+`research/` at repo root (`DA-Agency-Competitor-Analysis.md` 10.3K,
   `daautonomous-instagram-strategy-MASTER.md` 24.5K, a 25.9MB hero PNG, `da-agency-llc-baseline.md`,
   `daautonomous-instagram-strategy.md`, +1 subdir file) — orphaned: no task linkage, no UI surface (the per-task workspace
   browser at `mission-control-bridge.py:1400` only reads a task's own `workspace_path`, which `dispatch_task` doesn't
   populate). The protocol requires every deliverable have a reachable home. Files:
   - `mission-control-bridge.py` (NEW, inserted between `task_workspace` and `task_notify_list`, ~L1488): `GET
     /api/mc/deliverables` (flat newest-first listing of every file under the 2 roots, `.`-hidden/`.git` skipped, 500-entry
     cap) + `GET /api/mc/deliverables/file?path=` (one file's text, resolved-and-re-confined inside the roots → 403 on
     escape, 404 missing, `_MAX_FILE_BYTES`=256K cap, binary `\x00`-detected and NOT inlined). Refs only HEAD symbols
     (`_MAX_FILE_BYTES`, `Any`, `HTTPException`, `Path`) — a clean contiguous insert.
   - `src/lib/api.ts` (L386–407): `DeliverableEntry`/`DeliverableFile` types + `listDeliverables()`/`readDeliverable(path)`.
   - `src/components/DeliverablesDrawer.tsx` (NEW, 100% mine): a list+viewer modal — newest-first file list (root chip,
     size, age), click-to-open inline text viewer, honest empty state, binary/truncation notices, fetch-error surfaced.
     Remounts on open (parent keys on `open`) so the effect only sets state in async callbacks (keeps it clean of the
     `react-hooks/set-state-in-effect` rule that dominates the project lint baseline).
   - `src/pages/OperationsCenter.tsx`: `deliverablesOpen` state + a **📄 DELIVERABLES** toolbar button (after ⏱ CRON) +
     keyed `<DeliverablesDrawer>` render.
   **Verified:** in-process replication of the list logic against the real dirs → all 6 files returned; path-confinement
   rejects `deliverables/../../mc_store.py` and root `mc_store.py` (→403), accepts a real deliverable. `npm run build` ✅
   (622ms). `npx eslint` on all 4 touched files → **No issues found**. **Live Vite preview** (:5219): Operations → 📄
   DELIVERABLES button renders, modal opens with header/"0 files"/✕ CLOSE, shows the honest **"⚠ Request failed with status
   code 404"** state (live bridge predates the endpoints — loads on restart, exactly like every prior run's capability),
   **zero console errors**. `graphify update .` run. **Not verified live:** the populated list (needs the bridge restart).

4. **COMMIT — ledger only (deliberate, same blocker as runs #12–#14).** Read the working-tree diffs to attempt isolating my
   code: `src/lib/api.ts` (+57) MIXES my deliverables + promote + dispatcher work with **sibling bughunt** `failMcTask`
   (L247–253) and an ambiguous `McCronJob.created_at`; `mission-control-bridge.py` (+215) mixes my deliverables/promote
   endpoints with sibling `fail_task`/`get_briefing`; `mc_store.py` (+10) is purely sibling `fail_task`. Committing any of
   those *in full* sweeps in sibling WIP (forbidden). The new `DeliverablesDrawer.tsx` is 100% mine but can't be committed
   without api.ts's deliverables exports, and api.ts can't go in full. Per the hard rule + autonomous-run caution, did NOT
   force per-hunk clean-blob surgery; committed **only `.mc/LOOP_STATE.md`**. The deliverables feature is operationally LIVE
   on the next bridge restart (bridge serves the working tree) and now in the Vite preview — it joins the run #12 promote
   endpoint in the live-but-uncommitted bucket (TO-DO #2). Sibling WIP left fully intact; scratch temp diffs removed.

### 2026-06-16 — Run #14 (bridge RESTARTED → `promote` LIVE → board UN-STARVED: `ready 0 → 8`) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE — green; key change: the bridge was RESTARTED.** Bridge :8767 UP (`/api/ping` ok, **uptime ~10min** —
   the operator restarted it onto run #12/#13 code; previously ~2.4h/predating run #12). The decisive consequence:
   **`POST /api/mc/kanban/promote` now returns 200** (was 404 for 3 runs) — run #12's promote endpoint is finally serving.
   `/api/mc/dispatcher` → 200 `{enabled:false,running:false,concurrency:1}`; `/api/mc/kanban/sweep` → 200; scheduler
   `running:true` (32 ticks). `HEAD:mc_store.py` `ast.parse` ✅ + working-tree `ast.parse` ✅ (run #13 repair holds).
   `npm run build` ✅ (156 modules, 667ms). Touched **0 code files** this run → no new lint exposure (baseline ~500 errors
   unchanged, still bughunt/evolve's — TO-DO #6).

2. **ORCHESTRATION — UN-STARVED the board (the run's signature increment).** Board on arrival: `todo 8 · ready 0 · blocked
   6 · done 18`; diagnostics = 8 `promotable` (info) + 6 `blocked_no_reason` (the audited web-access research tasks). The
   dispatcher was LIVE but starved (`dispatchable:[]`, only fires `ready`). With the promote endpoint now live AND the
   dispatcher OFF (so no external side effects — promote is pure board-state), I ran the real promote:
   `POST /api/mc/kanban/promote {}` → **promoted 8 task(s) todo→ready, 0 skipped** (gridkeeper×2, narratrix×2, claudelink×4;
   reasons all "live assignee, no open dependencies"). **Verified after:** `kanban/stats` → `ready 8 · blocked 6 · done 18`
   (todo 0); `/api/mc/dispatcher` → `dispatchable` now lists all 8 best-first (the 4 claudelink carousels flag
   `web_gap:true` — Notion MCP, no web tool; per TO-DO #3 native web is actually available via bypassPermissions, so this
   is a heuristic flag, not a hard block). The autonomy loop's previously-missing FEEDER step is now operationally proven
   end-to-end. **Did NOT dispatch** (operator absent; dispatch runs side-effecting bypassPermissions turns needing sign-off
   — TO-DO #1) and did NOT enable the daemon. Content pipeline healthy + growing (campaigns 27, drafts 13 ↑, calendar 36).

3. **BUILD — none this run, by design (tree too congested to add code safely).** The orchestration promote was the
   highest-impact available increment. The documented next build (dispatcher worktree isolation, TO-DO #5) only matters at
   concurrency>1 (default is 1, so it does not block the first dispatch) — lower impact than assessed. Every shared file
   carries sibling WIP (16 TS + `mc_store.py` + `mission-control-bridge.py`), so adding code would deepen the cross-lane
   commit-isolation problem the protocol forbids. Deferred to a quieter tree.

4. **COMMIT — ledger only (deliberate).** Attempted to land run #12's stranded promote bridge endpoint into HEAD (run #13
   finally made HEAD parse, so the base is clean). **Aborted the code commit:** `mission-control-bridge.py` has 6 intertwined
   diff hunks mixing my promote endpoint (`PromoteReadyPayload`+`kanban_promote`, L1227–1314) with sibling bughunt WIP
   (`fail_task` ~L990, `get_briefing` ~L1881), and two hunks (`@403` `_build_dispatch_prompt` skills/MCP/web enhancement,
   `@868` get_activity) are **ambiguous mine-vs-sibling** with no blame to disambiguate (all uncommitted). Per the hard rule
   ("stage only YOUR files — do not commit theirs") and since the capability is already LIVE and serving, forcing the
   surgery wasn't worth the contamination risk. Committed **only `.mc/LOOP_STATE.md`**; sibling WIP left fully intact. The
   promote endpoint + TS wiring remain live-but-uncommitted (TO-DO #2 — land on a quiet tree).

### 2026-06-16 — Run #13 (RESOLVED the 3-run commit blocker: repaired non-parsing HEAD `mc_store.py`) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE — bridge green; lint baseline surfaced.** Bridge :8767 UP (`/api/ping` ok, uptime ~2.4h; started
   ~1781640692, predates run #12 — confirmed `POST /api/mc/kanban/promote` → **404**, so run #12 wiring is still working-tree
   only, awaiting an operator restart). Dispatcher LIVE-but-OFF/starved (`/api/mc/dispatcher` → `{enabled:false,running:false}`,
   `dispatchable:[]`), scheduler `running:true` (285 ticks, 0 fired), `/api/mc/kanban/sweep` → 200. `npm run build` ✅ (613ms).
   `py_compile mc_store.py` + `mission-control-bridge.py` ✅. **NEW:** ran the FULL `npm run lint` (prior runs only scoped
   `npx eslint` to their touched files) → **500 errors / 473 auto-fixable**, all pre-existing in sibling/untouched TS
   (`GhostNetwork.tsx`, `Layout.tsx`, …; dominant `ban-ts-comment`/`no-unused-vars`/`set-state-in-effect`). Run #13 touched
   **0 TS** so introduced none — handed to bughunt/evolve (TO-DO #6, GAPS #15).

2. **DIAGNOSED + REPAIRED the standing #0 blocker (the run's signature increment).** `HEAD:mc_store.py` had not parsed for
   3 runs. Pinned the true root cause (NOT mojibake / not an em-dash encoding bug as previously assumed): run #11's commit
   `496fad2` **truncated `MCStore._would_cycle`** — its docstring tail + entire DFS body were lost and the `# dispatch (run
   tasks)` section was spliced straight in, so the `"""` opening `_would_cycle`'s docstring (~L1046) was closed early by
   `dispatchable_tasks`'s `"""` (~L1055), leaving the prose at ~L1058 ("…would never run it — that is the…") tokenized as bare
   code → `SyntaxError: invalid character '—' (U+2014)`. The working-tree `mc_store.py` has the intact function and
   `py_compile`s clean. **Fix:** committed a parsing `mc_store.py` (`cb8f0ae`) = the working tree **minus** the sibling
   bughunt `fail_task` method (lines 322–331, excised to stay in-lane), which restores intact `_would_cycle` AND lands run
   #12's `promote_ready` store method in HEAD. Verified before commit: staged blob `ast.parse` ✅, only `mc_store.py` staged,
   0 `fail_task` lines leaked. After commit: `ast.parse(HEAD:mc_store.py)` ✅ (**blocker resolved**). Then **restored** the
   working tree byte-identical from a verified backup (sibling `fail_task` re-added; `git diff HEAD -- mc_store.py` = exactly
   the 10-line `fail_task` block, sibling WIP undisturbed). `py_compile` working tree ✅. All scratch/backup temp files removed.

3. **ORCHESTRATION — assessed, no safe action available this run.** Board `todo 8 · ready 0 · done 18 · blocked 6 · triage 0`
   (unchanged). No stale/dead/cycle/exhausted diagnostics; the 6 blocked are the audited web-access `blocked_no_reason`
   (operator config). The dispatcher is LIVE but starved (`ready 0`), and the gated `promote_ready` endpoint is 404 on the
   live bridge — so the only lever would be the ungated per-task `promote_task`, which run #12 already (correctly) declined to
   use with no operator present. Did NOT restart the bridge (operator's running process — not mine to kill). Content pipeline
   healthy + growing (campaigns 27, drafts 5, calendar 36).

4. **Not done / handed off:** the bridge `promote` endpoint + api.ts/store/UI wiring still need a restart to go live (TO-DO #1)
   then an operator-watched promote→dispatch (TO-DO #2); cron seeding needs sign-off (#4); the lint baseline is bughunt/evolve
   (#6). No new feature built this run on purpose — un-breaking the shared commit base (3-run blocker) was the higher-impact
   increment and unblocks every loop's ability to commit.

### 2026-06-16 — Run #12 (BUILT the board-wide `promote_ready` gate — the dispatcher's feeder) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE green; key change — bridge was RESTARTED, dispatcher now LIVE.** Bridge :8767 UP (uptime ~30min — the
   operator restarted it after run #11). The run#11 dispatcher is now LIVE: `GET /api/mc/dispatcher` → 200
   `{enabled:false,running:false,concurrency:1}`, `/api/mc/kanban/sweep` → 200 (was 404 for 11 runs), scheduler `running:true`
   (45 ticks). `npm run build` ✅ (twice); `npx eslint` on the 3 touched TS files ✅; `py_compile` on the WORKING-TREE
   `mc_store.py`/`mission-control-bridge.py` ✅.

2. **ORCHESTRATION — dispatcher LIVE but STARVED (the gap this run fills).** Board: **todo 8 · ready 0 · done 18 · blocked
   6 · triage 0**. `dispatchable:[]` because there are 0 `ready` tasks (the dispatcher is conservative — only fires `ready`).
   The 8 todo are all live-assignee + no-deps = genuinely actionable but stuck in `todo`. No stale/dead/cycle/exhausted
   diagnostics; the 6 blocked remain the audited web-access root cause. **Did NOT manually promote via the old per-task
   endpoint** (operator absent; the proper gated `promote_ready` is the right tool and loads on restart).

3. **BUILT: board-wide `promote_ready` (CAPABILITY GAPS #13), end-to-end & verified.** The post-run#11 missing link —
   nothing fed the dispatcher. Files: `mc_store.py` (`promote_ready` verb + `promotable` diagnostic + `sweep_board` 5th
   promote step + `promoted_ready` count), `mission-control-bridge.py` (`PromoteReadyPayload` + `POST /api/mc/kanban/promote`
   + sweep docstring), `src/lib/api.ts` (`PromoteReadyResult`/`promoteReady` + `SweepCounts.promoted_ready` +
   `SweepResult.promoted`), `src/stores/useTaskStore.ts` (`promoteReady` action + iface), `src/pages/OperationsCenter.tsx`
   (▲ PROMOTE READY button + `promoteCount` + sweepMsg/sweepCount). **Verified:** in-process behavior test on throwaway
   stores ✅ — promotable detects only live-assignee+no-dep todos (A,D), skips unassigned/off-roster/dep-blocked; dry-run
   previews without mutating; real promote moves todo→ready; idempotent; **the promoted tasks then appear in
   `dispatchable_tasks`** (composes with the dispatcher); completing a parent makes its child promotable; `sweep_board`
   reports `promoted_ready` + a 2nd sweep is a no-op; unknown id → `KeyError`→404. `npm run build` ✅ + `npx eslint` ✅.
   **Live Vite preview** (:5219, bridge up): Operations → ⚠ diagnostics shows the new ▲ PROMOTE READY button (disabled,
   honest count-0 fallback since the live bridge predates run #12 → no `promotable` diagnostic), all run#1–#11 buttons
   render, **zero console errors**. `graphify update .` run (1654 nodes / 3143 edges). **Not verified live:** the endpoint +
   real promote+dispatch (needs the bridge restart, TO-DO #1).

4. **COMMIT — ledger only; code commit BLOCKED (documented loudly).** Attempted the usual isolate-my-hunks commit but hit a
   pre-existing blocker: **`HEAD:mc_store.py` does not parse** (valid UTF-8 but an unterminated string → `ast.parse` fails at
   ~1058; the working tree compiles). You cannot build a compiling "HEAD+mine" on a broken HEAD, and the sibling has
   **restructured** the shared Python files (code moves) which defeats both `git apply --unidiff-zero` (misplaced a hunk,
   deleting `dispatchable_tasks`) and difflib opcode filtering. Rather than commit a broken base or risk contaminating with
   sibling WIP, committed **only `.mc/LOOP_STATE.md`**. My run #12 code stays in the WORKING TREE — verified, and
   operationally live on the next bridge restart (the bridge runs the working tree). TO-DO #0 hands the HEAD-parse repair to
   bughunt; once HEAD parses, the working-tree changes commit cleanly. (No mojibake in my edits — the Edit tool writes UTF-8;
   the corruption that surfaced during staging attempts was a Windows `subprocess(text=True)` cp1252 round-trip, avoided by
   reading git output as bytes. Working tree left fully intact; all scratch/backup temp files removed.)

### 2026-06-16 — Run #11 (BUILT the kanban TASK DISPATCHER — the NORTH STAR) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE green (after a harness hiccup).** The Bash/PowerShell auto-safety classifier was *temporarily
   unavailable* for the first ~8 probes this run (`claude-opus-4-8[1m] … cannot determine the safety`) — no command
   could run, so I did read-only design work until it recovered, then ran the gate. Bridge :8767 UP (`/api/ping` ok,
   uptime ~2h = the operator's restart), scheduler **DAEMON LIVE** (`/api/mc/cron` → `running:true`, 222 ticks @ 30s),
   `.mc/bridge.log` shows runs #1–#10 all 200. `npm run build` ✅ (156 modules, exit 0, twice); `npx eslint` on the 2
   touched TS files ✅ ("No issues found"); `py_compile` on the 4 Python modules ✅. Sibling lanes isolated at commit
   (see §4).

2. **ORCHESTRATION — exercised the now-live router, cleared triage.** Board on arrival: todo 8 · ready 1 · done 10 ·
   blocked 6 · **triage 6**. The run#4 auto-route verb is now live (was 404 pre-restart for 7 runs) — dry-ran it
   (all 6 resolve to owners, 0 skips), then applied: `POST /api/mc/kanban/route` routed all 6 (narratrix×2 score 23,
   claudelink×4 score 22–23, 4 flag `web_gap`) → **triage 6→0, todo 8→14**. No `stale_claim`/`retry_exhausted`/
   `dep`/`dead_agent`/`cycle` diagnostics. The 6 blocked remain the audited web-access root cause (operator config).
   Result: 15 assigned tasks now dispatchable-but-idle — precisely the gap the new dispatcher fills.

3. **BUILT: the kanban TASK DISPATCHER (CAPABILITY GAPS #12, the NORTH STAR), end-to-end & gated-OFF-by-default.**
   The post-Hermes successor to the gateway's dispatcher — Claude-native sub-agent delegation off the kanban:
   - `mc_store.py` — `dispatchable_tasks(limit?)` (read-only best-first selection: status `ready` + assignee on the
     live roster + not running; priority desc then oldest; per-task plan row with `web_gap`); `record_task_run(...)`
     (first public writer to `meta['runs']` — feeds `has_deliverable`/`latest_summary`/`_failed_attempts`; stamps
     `session_id`); `requeue_task(reason)` (running→ready, clears `started_at`); `complete_task(result=…)` now stores
     the deliverable.
   - `mission-control-bridge.py` — module consts `MC_DISPATCHER_ENABLED` (default **0/off**), `DISPATCH_CONCURRENCY`
     (1), `DISPATCH_TICK_SECONDS` (30), `DISPATCH_TIMEOUT` (900); `_build_dispatch_prompt(task,agent)`;
     `dispatch_task(id)` (claim → `run_claude(prompt, system_prompt, model=agent.model, timeout)` → record ok-run +
     `complete_task(result)`, or on `ClaudeError` record error-run + `requeue_task` then re-raise); `TaskDispatcher`
     daemon thread (single-flight via `_in_flight` set + lock, capacity-capped, never dies on a bad tick — mirrors
     `CronScheduler`), started in `lifespan` only when enabled (+ `DISPATCHER.stop()` on shutdown);
     `GET /api/mc/dispatcher` (status + dry-run `dispatchable` preview) and `POST /api/mc/dispatcher/dispatch`
     (`{task_id?,dry_run?}` — dry-run returns the plan; real fires one turn in the background and returns immediately).
   - `src/lib/api.ts` — `DispatcherStatus`/`DispatchablePlan`/`DispatcherInfo`/`DispatchResult` types + `getDispatcher()`
     + `dispatchTask({taskId?,dryRun?})`.
   - `src/pages/OperationsCenter.tsx` — `dispatcher` state + `loadDispatcher()` (fired with the ⚠ diagnostics open,
     alongside `loadWebAudit`), and a **TASK DISPATCHER** panel (`DispatcherPanel`) in the diagnostics modal: honest
     daemon state (emerald "● DAEMON LIVE" when enabled+running, else "○ daemon OFF — manual / operator-gated"),
     best-first dispatchable list (assignee · priority · ⚠ web), and a green **▶ DISPATCH NEXT (n)** button (disabled
     when nothing ready), with a dispatched/err counter.
   **Verified:** `py_compile` ✅; **in-process store test on a throwaway store** ✅ — `dispatchable_tasks` returns only
   ready+live-assignee tasks, priority-sorted, `web_gap` correct, `limit` works; `record_task_run` records + stamps
   `session_id`; `complete_task(result)` stores the deliverable + lights `has_deliverable`; `requeue_task` resets
   running→ready/`started_at=None`; **a recorded error-run flows into the `retry_exhausted` escalate diagnostic** (the
   dispatcher composes with run#5). **In-process bridge test with `run_claude` MOCKED** (no real turn, no side effects)
   ✅ — daemon OFF by default; `get_dispatcher` returns status + preview; dry-run dispatch plans without claiming; a
   not-dispatchable id is reported honestly; a real `dispatch_task` builds the prompt from task+agent, threads the
   agent model to `run_claude`, completes with the deliverable + an ok-run; the failure path records an error-run and
   requeues to `ready`. `npm run build` ✅ + `npx eslint` ✅. **Live Vite preview** (:5219, bridge up) ✅ — Operations →
   ⚠ diagnostics: all run#1–#9 buttons + the WEB-ACCESS panel render; the **TASK DISPATCHER** panel is correctly
   **absent** (live bridge predates run#11 → `/api/mc/dispatcher` 404 → `.catch` → null, the same honest fallback as
   run#3's webAudit), **zero console errors**. `graphify update .` run after edits (1551 nodes / 3033 edges).
   **Not verified:** the live daemon/endpoints + a real dispatched Claude turn — needs the bridge restart (TO-DO #1)
   and (for autonomous mode) operator sign-off. Did NOT fire a real dispatch (no operator present; the only `ready`
   task lacks the web access it needs). The full dispatch + requeue + escalate-integration path is proven by the
   in-process tests.

4. **Commit isolation.** My changes touch 4 files that also carry sibling WIP (bughunt's `fail_task` in
   `mc_store.py`+bridge & `get_briefing` fix; evolve's cron-display `cronAnchorMs`/`created_at`/`CronNextFire` in
   `api.ts`+`OperationsCenter.tsx`). Staged **only my hunks** via a content-filtered `git apply --cached --unidiff-zero`
   patch (built at unified=0 so my `complete_task` change separates from bughunt's adjacent `fail_task`; the mixed
   import line reduced to my `../lib/api` line only). Verified: staged diff = 454 insertions across my 4 files, **0**
   `fail_task`/`get_briefing`/`cronAnchorMs`/`CronNextFire` lines leaked; sibling WIP left intact in the working tree.

### 2026-06-16 — Operator session (ACTIVATION + re-aim at Hermes parity)

1. **Diagnosed why MC showed no autonomy.** Operator reported the dashboard had no live cron jobs, no
   agent delegation, nothing running. Root cause: the live bridge (PID 59752) was an **orphaned,
   detached process from a dead shell running excision-era code (`cd96b0e`)** — never restarted onto
   any of runs #1–#10. Confirmed every built endpoint 404'd and `scheduler:None`. 10 runs of working,
   committed code had sat dormant for days behind one un-restarted process.
2. **RESTARTED the bridge onto current code (operator-authorized).** Killed PID 59752, relaunched
   `python mission-control-bridge.py` (detached → `.mc/bridge.log`), up in 2s. **Verified LIVE:**
   `/api/mc/kanban/reconcile`→200, `/sweep`→200, `/route`→200, `/api/mc/agents/web-access`→200, and
   `/api/mc/cron` → `scheduler:{running:true, tick_seconds:30}`. All 10 prior runs activated at once.
3. **Re-aimed the routine at the real goal (Hermes parity).** Operator clarified intent: the loop's job
   is to **finish the Hermes→Claude migration of the autonomous runtime** — make Claude do what Hermes
   did (cron, briefing, content crawl, sub-agent delegation off the kanban). Rewrote the top of this
   file: added the **NORTH STAR** + **STANDING ACTIVATION GATE** (architecture note) and replaced TO-DO
   with the ordered parity backlog — **#1 build the kanban DISPATCHER** (the one piece still missing),
   #2 seed+verify briefing/crawl cron jobs, #3 provision web access, #4 make activation durable. Told
   future runs to **stop building peripheral self-heal verbs**.
4. **Also created the missing `mission-control-loop` scheduled routine** (every 2h, odd hours :30,
   staggered off bughunt/evolve/hermes-tower) — earlier the operational loop had no routine at all and
   only ran when invoked by hand. Verified in the scheduler list. Posted two operator-facing patch notes
   (`loop-1-stale-claim-reconcile`, `loop-2-operational-baseline`) to `.mc/patch-notes.json`.
   _Not verified:_ no `npm run build`/`lint` this session (only `.mc/` ledger edits + a bridge restart;
   no app source changed by me). Dispatcher remains UNBUILT — next run's #1 job.

### 2026-06-16 — Run #10 (BUILT maintenance cron job kind — hands-free board self-heal) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE green.** Bridge :8767 UP (`/api/ping` ok, uptime ~30.5h). Gateway :8642 N/A by design.
   `npm run build` ✅ (156 modules, exit 0, chunk-size warning only); `npx eslint` on the 2 touched TS files ✅
   ("No issues found"); `py_compile` on `mc_scheduler.py`/`mc_store.py`/`mission-control-bridge.py` ✅ + the
   `mc_scheduler.py` self-test "ALL PASS". Confirmed the live bridge still runs **pre-restart** code:
   `POST /api/mc/kanban/sweep` → 404. Did NOT kill the operator's bridge — verified in-process instead. **TEN**
   capabilities now load together on the next restart (run#1–#10) — see TO-DO #1. Sibling lanes confirmed clear and
   isolated at commit time: bughunt's `fail_task` (`mc_store.py` + `/api/mc/tasks/{id}/fail`) and `get_briefing`
   failed-jobs fix, and evolve's cron-display polish (`api.ts` `created_at`, `OperationsCenter.tsx` `cronAnchorMs`/
   `CronNextFire`) all sit in distinct hunks from mine — staged my hunks only via a hand-built `git apply --cached`
   patch (the mixed `api.ts` McCronJob hunk split so only my `kind`/`action` lines staged, not evolve's `created_at`),
   sibling hunks left in the working tree.

2. **ORCHESTRATION.** Kanban: todo 8 · ready 1 · done 10 · blocked 6 · **triage 6** (was 1 — 5 new unassigned triage
   tasks appeared). No `stale_claim`/`retry_exhausted`/`blocked_by_dependency`/`dead_agent_task`/`dependency_cycle`;
   live `sweep_board(dry_run)` → total 0. The 6 triage tasks are routable by the run#4 auto-route verb but it's still
   404 on the live (pre-restart) bridge — noted loudly in TO-DO #4, NOT manually routed (would duplicate the verb and
   churn the board with no operator present). The 6 blocked remain the audited web-access root cause. Content pipeline
   alive & growing (campaigns 22→27, calendar 31→36).

3. **BUILT: maintenance cron job kind (CAPABILITY GAPS #11, this loop's signature increment), end-to-end & LIVE-backed.**
   The sweep macro (run#9) was manual-only and the cron scheduler (run#2) could only fire Claude *prompts*, so the board
   could not self-heal on a timer without a human/Claude turn. New capability across every layer:
   - `mc_scheduler.py` — new `is_fireable(job)` (a `kind:"maintenance"` job fires on its `action`; a `claude` job still
     needs a `prompt`); `is_due` now gates on `is_fireable` instead of a bare prompt check, so a promptless maintenance
     job actually fires. Self-test extended (maintenance job fires on action; actionless never fires).
   - `mc_store.py` — module const `MAINTENANCE_ACTIONS={"sweep"}`; `create_cron(..., kind=None, action=None)` validates
     kind∈{claude,maintenance} and (for maintenance) action∈MAINTENANCE_ACTIONS (`ValueError` on bad input), stores
     `kind`/`action` on the job, names a maintenance job `"<action> (maintenance)"` by default; new
     `run_maintenance(action)` dispatcher (`sweep`→`sweep_board(dry_run=False)`, returns `{ok,action,detail,result}`,
     `ValueError` on unknown action); `list_cron` raw shows a `Kind: maintenance (sweep)` line.
   - `mission-control-bridge.py` — `CreateCronPayload` gains `kind`/`action`; `CronScheduler._fire` dispatches
     `kind=="maintenance"` to `STORE.run_maintenance(job["action"])` (no Claude turn) vs `run_claude` for a claude job,
     stamping `record_cron_result(ok, detail=sweep message)`; `POST /api/mc/cron` passes kind/action + maps `ValueError`→400;
     `POST /api/mc/cron/{id}/run` runs the maintenance verb on-demand for a maintenance job.
   - `src/lib/api.ts` — `McCronJob` + `CreateCronRequest` gain `kind?`/`action?`.
   - `src/pages/OperationsCenter.tsx` — `cronKind`/`cronAction` state; a **KIND toggle** (◆ CLAUDE PROMPT / ⚙ MAINTENANCE)
     in the ⏱ CRON create form that swaps the PROMPT textarea for a sweep ACTION select; `handleCreateCron` sends
     kind/action for a maintenance job; a **⚙ sweep** chip on maintenance job rows.
   **Verified:** `py_compile` ✅ + scheduler self-test ✅; **in-process behavior test on a throwaway store** ✅ —
   created a maintenance job (kind/action/prompt=null correct), rejected a bad action and a bad kind (ValueError),
   `is_fireable`/`is_due` fire the maintenance job on its action at the scheduled minute, seeded a 3h-stale running
   claim, mirrored `_fire` (`run_maintenance("sweep")`) → the stale claim was **reconciled → ready** (started_at
   cleared), `record_cron_result` stamped `last_status=ok` + the sweep detail, a 2nd fire was a no-op (`total 0`),
   `run_maintenance("nope")` raised, and `list_cron` raw shows the maintenance kind. **In-process dry-run nature**: a
   fired sweep on the live board would be a no-op (0 self-heal conditions). `npm run build` ✅ + `npx eslint` ✅.
   **Live Vite preview** (:5219, bridge up) ✅ — Operations → ⏱ CRON: the create form KIND toggle renders both
   buttons; clicking ⚙ MAINTENANCE makes it active (emerald) and swaps the PROMPT textarea (textareas→0) for the
   sweep ACTION select ("sweep — reconcile · cascade · reassign · escalate"); **zero console errors**.
   `graphify update .` run after edits. Did NOT create a real cron job against the live (pre-restart) bridge — it would
   silently drop kind/action and make an inert prompt-less job, mutating the live store with no benefit.
   **Not verified:** the live scheduled fire (needs the bridge restart, TO-DO #1) and the recurring `*/30` self-heal job
   (needs operator sign-off, TO-DO #5). The full dispatch + self-heal path is proven by the in-process behavior test.

### 2026-06-16 — Run #9 (BUILT one-call board self-manage macro) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE green.** Bridge :8767 UP (`/api/ping` ok, uptime ~28.5h). Gateway :8642 N/A by design.
   `npm run build` ✅ (156 modules, exit 0, chunk-size warning only); `npx eslint` on the 3 touched TS files ✅
   ("No issues found"). Confirmed the live bridge still runs **pre-restart** code: this run's new
   `POST /api/mc/kanban/sweep` → 404, and `/api/mc/kanban/reassign` → 404. Did NOT kill the operator's bridge —
   verified the new capability in-process instead. **NINE** capabilities now load together on the next restart
   (run#1–#9) — see TO-DO #1. Sibling lanes confirmed clear: my edits sit in distinct regions from the sibling WIP
   — bughunt's `get_briefing` fix (`mission-control-bridge.py:~1550`, far from my `kanban_sweep` endpoint at ~970)
   and evolve's cron-display polish (`api.ts` `McCronJob.created_at` ~L92, `OperationsCenter.tsx` `CronNextFire`/
   schedule-anchor — far from my kanban-diagnostics toolbar + `SweepResult`). My hunks were staged surgically
   (`git apply --cached` of mine-only hunks) so the commit carries zero sibling lines; sibling hunks left in the
   working tree.

2. **ORCHESTRATION steady.** Kanban unchanged: todo 8 · ready 1 · done 10 · blocked 6 · triage 1. No `stale_claim`,
   no `retry_exhausted`, no `blocked_by_dependency`, no `dead_agent_task`, no `dependency_cycle`. Live
   `sweep_board(dry_run=True)` → `total 0` (honest no-op — 0 of all four self-heal conditions; board unmutated). The
   6 blocked (5×narratrix, 1×default) remain the audited web-access root cause (operator config). Nothing silently
   broken.

3. **BUILT: one-call board self-manage macro (CAPABILITY GAPS #9, this loop's signature increment), end-to-end &
   LIVE-backed.** The four self-heal verbs (reconcile/cascade/reassign/escalate) each needed a separate button + call;
   nothing ran them in the right order in one shot. New capability across every layer:
   - `mc_store.py` — added `dry_run: bool = False` to `reconcile_board` (gates the mutation + save, adds `dry_run` to
     the result) so the macro can preview reconcile alongside the other (already dry-run-able) verbs; new
     `MCStore.sweep_board(dry_run=False)` calls — in fixed order — `reconcile_board` → `cascade_dependencies` →
     `reassign_dead_agent` → `escalate_exhausted`, aggregating each sub-result plus a `counts`
     (`{reconciled,held,promoted,reassigned,escalated}`) / `total` / one-line `message`. Order is load-bearing:
     reconcile first frees stale claims so reassign sees the now-idle agent; cascade before reassign so a dep-held
     task isn't moved to a new owner; escalate last as the final safety net. Each sub-verb is idempotent + dry-run-able,
     so the macro is low-risk and a 2nd pass is a no-op. `_lock` is an `RLock`, so the sub-verbs' own locking composes
     safely. Docstring documents the dry-run caveat (each verb plans against the current board independently).
   - `mission-control-bridge.py` — `POST /api/mc/kanban/sweep` (`SweepPayload{dry_run?}`) → `STORE.sweep_board(...)`,
     placed right after `kanban_reassign`.
   - `src/lib/api.ts` — `SweepCounts`/`SweepResult` types + `sweepBoard({dryRun?})` fetcher; also added `dry_run?` to
     `ReconcileResult` (the store response now carries it).
   - `src/stores/useTaskStore.ts` — `sweepBoard()` action (imports the api fn aliased `runSweepBoard` to avoid the
     name clash; refreshes tasks+stats on a real change, always re-pulls diagnostics so all four diagnostic kinds
     clear at once) + iface entry.
   - `src/pages/OperationsCenter.tsx` — emerald **⚙ SWEEP BOARD (n)** button as the **lead** of the diagnostics modal
     toolbar (before ⟳ RECONCILE), `n = staleCount+depCount+deadCount+exhaustedCount`, disabled at 0; result line
     summarizes `✓ swept N · reconciled … · held … · promoted … · reassigned … · escalated …`. State `sweeping`/`sweepMsg`.
   **Verified:** `python -m py_compile` on bridge + store + scheduler ✅; **in-process behavior test on a throwaway
   store** ✅ — seeded one of each condition (stale running claim, parent→child dep with open parent, off-roster
   agent holding a skill-matchable task, retry-exhausted task at 1/1 failed): `dry_run` planned without mutating
   (board identical before/after); the real sweep remediated **all four in order** (reconciled the stale claim →
   ready, held the child → blocked, reassigned the orphan → the live skill-match agent, escalated the exhausted →
   blocked; `counts` = reconciled 1/held 1/promoted 0/reassigned 1/escalated 1, `total` 4); a 2nd pass was a no-op
   (`total` 0); **zero `blocked_no_reason` diagnostics after** (escalate + cascade both record a reason). The
   dry-run vs real difference (reassigned 0→1) demonstrated the documented caveat (reconcile frees the agent before
   reassign sees it only in the live sequential run). **In-process dry-run against the LIVE store** ✅ → `total 0`,
   "board already healthy", board unmutated. `npm run build` ✅ + `npx eslint` ✅. **Live Vite preview** (:5219,
   bridge up) ✅ — Operations → ⚠ diagnostics: the **⚙ SWEEP BOARD** button leads the toolbar, renders **disabled**
   with the honest tooltip "Board healthy — no self-heal actions pending" (DOM-read `{text:"⚙ SWEEP BOARD",
   disabled:true}`), **zero console errors**. `graphify update .` run after edits (1505 nodes / 2930 edges).
   **Not verified:** the live enabled click→sweep path — needs both the bridge restart (TO-DO #1) **and** a board with
   ≥1 self-heal condition (none exist live). The full composition is proven by the in-process behavior test.

### 2026-06-16 — Run #8 (BUILT dependency cycle/self-link guard) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE green.** Bridge :8767 UP (`/api/ping` ok, uptime ~26.5h). Gateway :8642 N/A by design.
   `npm run build` ✅ (156 modules, exit 0, chunk-size warning only). Confirmed the live bridge still runs
   **pre-restart** code (`POST /api/mc/kanban/reassign` → 404; `/api/mc/cron` no `scheduler` field; cron `jobs:[]`).
   Did NOT kill the operator's bridge — verified the new capability in-process instead. **EIGHT** capabilities now
   load together on the next restart (run#1–#8) — see TO-DO #1. This run touched **zero TS files** (pure Python),
   so `npm run lint`'s TS surface is unchanged. Sibling lane confirmed clear: the only working-tree change in my
   shared file is bughunt's `get_briefing` fix in `mission-control-bridge.py:~1547` (cron `last_status` read — far
   from the `link_tasks` endpoint at ~824); isolated via a path-limited `git stash` so my commit carries only my
   hunk, then the sibling hunk was restored.

2. **ORCHESTRATION steady.** Kanban unchanged: todo 8 · ready 1 · done 10 · blocked 6 · triage 1. No `stale_claim`,
   no `retry_exhausted`, no `blocked_by_dependency`, no `dead_agent_task`, and **no `dependency_cycle`** — the board
   has **0 dependency links** (`kanban-meta.json["links"]` empty), so the new guard/diagnostic is an honest no-op
   live. The 6 blocked (5×narratrix, 1×default) remain the audited web-access root cause (operator config). Nothing
   silently broken.

3. **BUILT: dependency cycle/self-link guard (CAPABILITY GAPS #8, this loop's signature increment), end-to-end &
   LIVE-backed.** `create_task(parents=...)` and `link()` accepted `A→A` and longer cycles unchecked — a cycle makes
   run#6's cascade gate's "all parents done" unreachable, so a child waits forever, silently. New guard + visibility:
   - `mc_store.py` — static `_would_cycle(links, parent, child)` (DFS: self-link, or `child` can already reach
     `parent` along existing `parent→child` edges) + static `_cycle_nodes(links)` (set of node ids in ≥1 directed
     loop, includes self-loops). `link()` now raises `ValueError` on a self-link / cycle-closing edge (distinct
     messages) **before** persisting; `create_task`'s parent-append loop routes every parent through `_would_cycle`
     and silently skips a cycle-forming edge (a fresh child can only self-cycle). `diagnostics()` computes
     `cycle_nodes` once and emits a new **`dependency_cycle` warn** row for each task in a pre-existing loop (so
     already-bad data is visible, not just newly-rejected).
   - `mission-control-bridge.py` — `POST /api/mc/tasks/link` (`link_tasks`, ~824) wraps `STORE.link(...)` in
     `try/except ValueError` → **HTTP 400** with the refusal detail (was a bare passthrough that silently persisted
     loops).
   - **No frontend change** — the diagnostics modal already renders any diagnostic kind via its generic
     `x.message || x.kind` row (`src/pages/OperationsCenter.tsx:410`) and `BoardDiagnostic` is an open type
     (`src/lib/api.ts:290`), so `dependency_cycle` surfaces automatically. Zero TS touched.
   **Verified:** `python -m py_compile` on bridge + store + scheduler ✅; **in-process behavior test on throwaway
   stores** ✅ — `_would_cycle`: A→A True, A→B then B→A True, A→B→C then C→A True, A→B→C valid edge False, fresh
   fanout False; `_cycle_nodes`: self-loop {A}, 2-cycle {A,B}, 3-cycle {A,B,C}, DAG ∅; `link()` persisted A→B/B→C,
   **rejected A→A** (msg "self-link") **and C→A** (msg "cycle") with neither persisted; `diagnostics()` on a
   pre-seeded X⇄Y cycle flagged exactly {X,Y} with `dependency_cycle`. **In-process against the LIVE store** ✅ →
   `links=[]`, `cycle_nodes=∅`, 0 `dependency_cycle` diagnostics (honest no-op). `npm run build` ✅.
   `graphify update .` run after edits (1495 nodes / 2907 edges).
   **Not verified:** the live 400 on `POST /api/mc/tasks/link` — needs the bridge restart (TO-DO #1); the guard
   logic + the diagnostic surface are fully proven by the in-process tests. Did not mutate the live board (no test
   links created).

### 2026-06-16 — Run #7 (BUILT auto-reassign-on-dead-agent) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE green.** Bridge :8767 UP (`/api/ping` ok, uptime ~24.5h). Gateway :8642 N/A by design.
   `npm run build` ✅ (156 modules, exit 0, chunk-size warning only); `npx eslint` on the 3 touched TS files ✅
   ("No issues found"). Confirmed the live bridge still runs **pre-restart** code: reconcile/route/escalate/cascade
   all → 404, and this run's new `POST /api/mc/kanban/reassign` → 404. Did NOT kill the operator's bridge —
   verified the new capability in-process instead. **SEVEN** capabilities now load together on the next restart
   (run#1–#7) — see TO-DO #1. Sibling lanes confirmed clear: the only working-tree change in my shared file is
   bughunt's `get_briefing` fix in `mission-control-bridge.py:~1513` (cron `last_status` read — far from my kanban
   endpoints); isolated via a path-limited `git stash` so my commit carries only my hunk, then restored.

2. **ORCHESTRATION steady.** Kanban unchanged: todo 8 · ready 1 · done 10 · blocked 6 · triage 1. No `stale_claim`,
   no `retry_exhausted`, no `blocked_by_dependency`, and **no `dead_agent_task`** — all 8 board assignees are on
   the live roster (`agents.json`) and there are **0 running/stale claims**, so the new verb is an honest no-op
   live (like run#5/#6). The 6 blocked (5×narratrix, 1×default) remain the audited web-access root cause (operator
   config). Nothing silently broken.

3. **BUILT: auto-reassign-on-dead-agent (CAPABILITY GAPS #7, this loop's signature increment), end-to-end &
   LIVE-backed.** `reconcile_board` reclaimed a stale running claim to `ready` but left it on the same dead
   assignee (the next claim re-fails on the gone worker); an off-roster agent's backlog had no owner that would
   run it. New capability across every layer:
   - `mc_store.py` — static `_is_stale_running(task, now)` (running past `STALE_CLAIM_SECONDS`) + static
     `_dead_agents(tasks, roster_names, now)` (assignees holding open work that are off the RAW `list_agents()`
     roster OR sitting on a stale running claim — explicitly NOT mere busy/blocked, so the web-blocked research
     tasks are never mistaken for dead). New **`dead_agent_task` warn diagnostic** in `diagnostics()` (a dead/idle
     agent's workable task: todo/ready or a stale running claim; `blocked` deliberately excluded). New
     `MCStore.reassign_dead_agent(from_agent=None, dry_run=False)` — moves each dead agent's workable task to the
     best-fit OTHER live agent via the run#4 `_route_score` (skill-token match required for confidence,
     least-loaded tie-break), reclaiming a stale running claim to `ready` as it moves it, recording a `reassigned`
     event, leaving an unmatched task honestly in place, **never targeting another dead agent** (separate `act_on`
     vs `exclude` sets so single-agent mode is safe too), off-roster truth from `list_agents()` so the diagnostic
     count and the verb agree exactly. Returns `{reassigned,skipped,dead_agents,dry_run,message}`.
   - `mission-control-bridge.py` — `POST /api/mc/kanban/reassign` (`ReassignPayload{from_agent?,dry_run?}`) →
     `STORE.reassign_dead_agent(...)`, placed right after `kanban_cascade`.
   - `src/lib/api.ts` — `DeadAgent`/`ReassignedTask`/`ReassignResult` types + `reassignDeadAgent({fromAgent?,dryRun?})`.
   - `src/stores/useTaskStore.ts` — `reassignDead()` action (refreshes tasks+stats on a real move, always re-pulls
     diagnostics so `dead_agent_task` rows clear) + import + iface.
   - `src/pages/OperationsCenter.tsx` — orange **♻ REASSIGN DEAD (n)** button in the diagnostics modal toolbar
     (after ⇄ CASCADE DEPS), `n` = count of `dead_agent_task` diagnostics, disabled at 0; result line summarizes
     `✓ reassigned N → from→to · K left in place`.
   **Verified:** `python -m py_compile` on bridge + store ✅; **in-process behavior test on throwaway stores** ✅ —
   seeded an off-roster agent (todo content + stale-running market-research + a blocked task + a gibberish task)
   and a LIVE agent holding a stale claim: diagnostics flagged exactly the 4 workable dead-agent tasks (NOT the
   blocked one, NOT a fresh live task); `dry_run` planned without mutating; the real pass moved the content task to
   the best-fit live agent, reclaimed+reassigned the stale running claim to `ready` (started_at cleared), left the
   blocked task untouched and the gibberish task in place (skipped, no confident match), and never assigned onto
   the dead/stale agent; idempotent 2nd pass; a named live agent with no work skipped honestly; **off-roster-only
   consistency proven** (diag count == verb action == 1); and a separate test proving single-agent mode never
   reassigns onto another dead agent. **In-process dry-run against the LIVE store** ✅ → "no dead/idle agents"
   (0 dead, 0 `dead_agent_task` diagnostics). `npm run build` ✅ + `npx eslint` ✅. **Live Vite preview** (:5219,
   bridge up) ✅ — Operations → ⚠ diagnostics: the **♻ REASSIGN DEAD** button renders **disabled** with the honest
   tooltip "No dead/idle agents with reassignable work" (DOM-read `{text:"♻ REASSIGN DEAD", disabled:true}`),
   **zero console errors**. `graphify update .` run after edits (1488 nodes / 2898 edges).
   **Not verified:** the live enabled click→reassign path — needs both the bridge restart (TO-DO #1) **and** a
   board with an actual dead/idle agent (none exist live). The full data path is proven by the in-process tests.

### 2026-06-16 — Run #6 (BUILT dependency-aware promotion gate) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE green.** Bridge :8767 UP (`/api/ping` ok, uptime ~22.5h). Gateway :8642 N/A by design.
   `npm run build` ✅ (156 modules, exit 0, chunk-size warning only); `npx eslint` on the 3 touched TS files ✅
   ("No issues found"). Confirmed the live bridge still runs **pre-restart** code: reconcile → 404, `/api/mc/cron`
   no `scheduler` field, web-access → 405, route → 404, escalate → 404, and this run's new
   `POST /api/mc/kanban/cascade` → 404. Did NOT kill the operator's bridge — verified the new capability
   in-process instead. **SIX** capabilities now load together on the next restart (run#1–#6) — see TO-DO #1.
   Sibling lanes confirmed clear: the only working-tree change in my files is bughunt's `get_briefing` fix in
   `mission-control-bridge.py:~1493` (cron-failure detection, far from my kanban endpoints) — isolated via a
   path-limited `git stash` so my commit carries only my hunk, then restored.

2. **ORCHESTRATION steady.** Kanban unchanged: todo 8 · ready 1 · done 10 · blocked 6 · triage 1. No
   `stale_claim`, no `retry_exhausted`, and **no `blocked_by_dependency`** — the board has **0 dependency links**
   (`kanban-meta.json["links"]` empty), so the new gate is a no-op live (honest empty, like run#5's escalate).
   The 6 blocked (5×narratrix, 1×default) remain the audited web-access root cause (operator config). Nothing
   silently broken; remaining items need operator config / a live Claude turn / a bridge restart.

3. **BUILT: dependency-aware promotion gate (CAPABILITY GAPS #6, this loop's signature increment), end-to-end &
   LIVE-backed.** Parent→child links existed but post-Hermes nothing enforced ordering — a child could be claimed
   before its parents finished, and nothing re-promoted it when they did. New capability across every layer:
   - `mc_store.py` — `diagnostics()` gains a **`blocked_by_dependency` warn** diagnostic (non-terminal task with
     an existing, non-terminal parent; dangling links stay the separate `missing_dependency`), built off a
     `parents_of` link lookup. New static `_dep_held(events)` (reads the `dependency_hold`/`dependency_clear`
     timeline → is the task currently gate-held?) + `MCStore.cascade_dependencies(dry_run=False)` — one sweep
     that HOLDS a workable child (status `todo`/`ready`) with open parents → `blocked` (records a
     `dependency_hold` event **and** a `blocked` reason, so never `blocked_no_reason`), PROMOTES a child *it
     held* once all parents are terminal → `ready` (`dependency_clear` event), and lists children still WAITING.
     Conservative (only promotes tasks it held), idempotent, `dry_run` mutates nothing. Returns
     `{held,promoted,waiting,dry_run,message}`.
   - `mission-control-bridge.py` — `POST /api/mc/kanban/cascade` (`CascadePayload{dry_run?}`) →
     `STORE.cascade_dependencies(...)`, placed right after `kanban_escalate`.
   - `src/lib/api.ts` — `CascadeHeld`/`CascadePromoted`/`CascadeWaiting`/`CascadeResult` types +
     `cascadeDependencies({dryRun?})` fetcher.
   - `src/stores/useTaskStore.ts` — `cascadeDeps()` action (refreshes tasks+stats on a real hold/promote, always
     re-pulls diagnostics so `blocked_by_dependency` rows clear) + import + iface.
   - `src/pages/OperationsCenter.tsx` — violet **⇄ CASCADE DEPS (n)** button in the diagnostics modal toolbar
     (after ⚑ ESCALATE EXHAUSTED), `n` = count of `blocked_by_dependency` diagnostics, disabled at 0; result
     line summarizes `✓ held N → blocked · promoted M → ready · K still waiting`.
   **Verified:** `python -m py_compile` on bridge + store + scheduler ✅; **in-process behavior test on a
   throwaway store** ✅ — seeded parents P1(todo)/P2(done) and children C1(open parent)/C2(parent done)/C3(mixed)
   /C4(no parents) + a WEB task blocked for an unrelated reason: diagnostics flagged exactly C1+C3 (not C2/C4);
   `dry_run` planned hold C1+C3 without mutating; the real pass held C1+C3 → `blocked` (with reason, no
   `blocked_no_reason`), left C2/C4/WEB untouched; a 2nd pass was idempotent (held 0, C1+C3 reported "waiting");
   completing P1 then a 3rd pass PROMOTED C1+C3 → `ready` **while WEB stayed `blocked`** (never gate-held →
   never promoted, even with a done parent); a 4th pass was a no-op. **In-process dry-run against the LIVE store**
   ✅ → "no dependency changes" (0 links). `npm run build` ✅ + `npx eslint` ✅. **Live Vite preview** (:5219,
   bridge up) ✅ — Operations → ⚠ diagnostics: modal opens, the **⇄ CASCADE DEPS** button renders **disabled**
   with the honest tooltip "No dependency-blocked tasks to gate" (DOM-read `{text:"⇄ CASCADE DEPS",
   disabled:true}`), **zero console errors**. `graphify update .` run after edits (1474 nodes / 2857 edges).
   **Not verified:** the live enabled click→hold/promote path — needs both the bridge restart (TO-DO #1) **and**
   a board with ≥1 parent→child link (none exist live). The full data path is proven by the in-process test.

### 2026-06-16 — Run #5 (BUILT retry-exhaustion escalation) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE green.** Bridge :8767 UP (`/api/ping` ok, uptime ~20.5h). Gateway :8642 N/A by design.
   `npm run build` ✅ (156 modules, exit 0, chunk-size warning only); `npx eslint` on the 3 touched TS files ✅
   ("No issues found"). Confirmed the live bridge still runs **pre-restart** code: reconcile → 404, `/api/mc/cron`
   no `scheduler` field, web-access → 405, route → 404, and this run's new `POST /api/mc/kanban/escalate` → 404.
   Did NOT kill the operator's bridge — verified the new capability in-process instead. **FIVE** capabilities now
   load together on the next restart (run#1 reconcile, run#2 scheduler, run#3 web-audit, run#4 triage-route,
   run#5 escalate) — see TO-DO #1. Sibling lanes confirmed clear: bughunt = `src/stores`/`src/lib` bug fixes,
   evolve = pages/nav/command-palette — neither touches my five bridge/store/api/page files.

2. **ORCHESTRATION steady.** Kanban unchanged: todo 8 · ready 1 · done 10 · blocked 6 · triage 1. No
   `stale_claim`, and **no `retry_exhausted`** (no task on the board has a burned retry budget — there are no
   recorded failed runs). The 6 blocked (5×narratrix, 1×default) remain the audited web-access root cause
   (operator config). Nothing silently broken; remaining items need operator config / a live Claude turn.

3. **BUILT: retry-exhaustion escalation (CAPABILITY GAPS #4, this loop's signature increment), end-to-end &
   LIVE-backed.** `max_retries` existed on every task but post-Hermes nothing escalated/notified/reassigned when
   a task burned its budget — it would silently loop. New capability across every layer:
   - `mc_store.py` — module const `FAILED_OUTCOMES` (error/failed/failure/timeout/timed_out/crashed); static
     `_failed_attempts(task, runs)` (counts runs whose `outcome` ∈ FAILED_OUTCOMES; honors an explicit
     `retries`/`attempts` field as a floor) + `_retry_budget(task)` (positive `max_retries` or None); a new
     **`retry_exhausted` warn diagnostic** in `diagnostics()` (open, non-terminal task whose failed-attempt count
     ≥ budget and not yet escalated); and `MCStore.escalate_exhausted(task_id=None, dry_run=False)` — sweeps (or
     targets one id), moves each exhausted task to `blocked` with a recorded reason + an `escalated` event
     (attempts/max_retries/prev_status/assignee) **and** a `blocked` reason event (so it never shows
     `blocked_no_reason`), leaves everything else untouched with explained skips for a named id, idempotent via
     the existing-`escalated`-event guard. Returns `{escalated,skipped,dry_run,message}`; `dry_run` mutates
     nothing.
   - `mission-control-bridge.py` — `POST /api/mc/kanban/escalate` (`EscalatePayload{task_id?,dry_run?}`) →
     `STORE.escalate_exhausted(...)`, 404 on unknown id. Placed right after `kanban_route`.
   - `src/lib/api.ts` — `EscalatedTask` / `EscalateResult` types + `escalateExhausted({taskId?,dryRun?})` fetcher.
   - `src/stores/useTaskStore.ts` — `escalateExhaustedTasks()` action (refreshes tasks+stats on a real escalate,
     always re-pulls diagnostics so the `retry_exhausted` rows clear) + import + iface.
   - `src/pages/OperationsCenter.tsx` — red **⚑ ESCALATE EXHAUSTED (n)** button in the diagnostics modal toolbar
     (after ⤵ AUTO-ROUTE TRIAGE), `n` = count of `retry_exhausted` diagnostics, disabled at 0; result line
     summarizes `✓ escalated N → blocked for review · title (attempts/budget)`.
   **Verified:** `python -m py_compile` on bridge + store + scheduler ✅; **in-process behavior test on a throwaway
   store** ✅ — seeded a task at 2/2 failed-runs (flags `retry_exhausted`), a 1/3 task (no flag), a no-budget task
   (no flag), and a `done` task with 2 fails (terminal, no flag); `dry_run` planned the 1 exhausted task without
   mutating (status stayed `running`); the real sweep moved it to `blocked` with both `escalated`+`blocked` events
   and the diagnostic then **cleared**; a 2nd pass was idempotent (escalated 0); single-id on the 1/3 task skipped
   with reason `budget not exhausted (1/3)`; unknown id raised `KeyError`. `npm run build` ✅ + `npx eslint` ✅.
   **Live Vite preview** (:5219, bridge up) ✅ — Operations → ⚠ diagnostics: modal opens, the **⚑ ESCALATE
   EXHAUSTED** button renders **disabled** with the honest tooltip "No retry-exhausted tasks to escalate" and the
   muted styling, **zero console errors** (DOM-read verified: `{found:true, disabled:true, title:…}`). `graphify
   update .` run after edits (1460 nodes / 2832 edges).
   **Not verified:** the live enabled click→escalate→`✓ escalated` path — needs both the bridge restart (TO-DO #1)
   **and** a task that has actually burned its retry budget (none exist on the live board; the screenshot tool
   timed out on the live animation widgets, as in run#2/#3 — DOM text + clean console stand in). The full data
   path is proven by the in-process behavior test.

### 2026-06-16 — Run #4 (BUILT skill-match auto-route for triage tasks) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE green.** Bridge :8767 UP (`/api/ping` ok, uptime ~18.5h). Gateway :8642 N/A by design.
   `npm run build` ✅ (156 modules, exit 0, chunk-size warning only); `npx eslint` on the 3 touched TS files ✅
   ("No issues found"). Confirmed the live bridge still runs **pre-restart** code: reconcile → 404, `/api/mc/cron`
   no `scheduler` field, web-access → 405, and this run's new `POST /api/mc/kanban/route` → 404. Did NOT kill the
   operator's bridge — verified the new capability in-process instead. **FOUR** capabilities now load together on
   the next restart (run#1 reconcile, run#2 scheduler, run#3 web-audit, run#4 triage-route) — see TO-DO #1.

2. **ORCHESTRATION steady.** Kanban unchanged: todo 8 · ready 1 · done 10 · blocked 6 · triage 1. No
   `stale_claim`. The 6 blocked (5×narratrix, 1×default) remain the audited web-access root cause (operator
   config). The 1 triage task (`t_6f880653`) is no longer a manual-only item — this run gives it a live
   deterministic router (below). Nothing silently broken; remaining items need operator config / a live Claude
   turn, documented not faked.

3. **BUILT: skill-match auto-route for triage tasks (CAPABILITY GAPS #3, this loop's signature increment),
   end-to-end & LIVE-backed.** Post-Hermes there is no dispatcher, so triage tasks sit unassigned until a human
   picks an owner. New deterministic *assign-by-skill* verb across every layer:
   - `mc_store.py` — module const `ROUTE_STOPWORDS` (generic words stripped from routing signal); static
     `_route_tokens()` + classmethod `_route_score()` (skill slugs split & weighted ×3, role text ×1,
     multiplicity rewards depth in the matched area); new `MCStore.route_triage(task_id=None, dry_run=False)` —
     scores every rostered agent per triage task, **requires ≥1 skill-token match** for confidence, ties break
     toward the **least-loaded** agent, assigns the winner + sets status `triage`→`todo` with a `routed` event,
     **leaves unmatched tasks in triage** (honest, never force-assigned). Returns `{routed,skipped,dry_run,
     message}`; each routed row carries `score/matched/skill_match/runner_up/web_gap`. `dry_run` mutates nothing.
   - `mission-control-bridge.py` — `POST /api/mc/kanban/route` (`RoutePayload{task_id?,dry_run?}`) →
     `STORE.route_triage(...)`, 404 on unknown id. Placed right after `kanban_reconcile`.
   - `src/lib/api.ts` — `RoutedTask` / `RouteResult` types + `routeTriage({taskId?,dryRun?})` fetcher.
   - `src/stores/useTaskStore.ts` — `routeTriageTasks()` action (refreshes tasks+stats on a real route) + iface.
   - `src/pages/OperationsCenter.tsx` — cyan **⤵ AUTO-ROUTE TRIAGE (n)** button in the diagnostics modal
     toolbar (next to ⟳ RECONCILE STALE), `n` = live `stats.by_status.triage`, disabled at 0; result line
     summarizes `✓ routed N → agent[…⚠web]` / `… left in triage — no skill match`.
   **Verified:** `python -m py_compile` on bridge + store + scheduler ✅; **in-process `route_triage(dry_run=True)`
   against the live store** ✅ → routes `t_6f880653` → **narratrix** (score 23, skill_match [brand,content,copy,
   voice], runner_up claudelink, web_gap False), board left at triage 1 (no mutation). **Throwaway-store full
   behavior test** ✅ — content task→narratrix(web_gap F), research task→signalscraper(web_gap **T**: research
   skill, no web MCP), gibberish→skipped/left-in-triage, `routed` event recorded, board mutated correctly
   (2→todo, 1 triage), idempotent 2nd pass, single-task on a non-triage task rejected, KeyError on unknown id.
   `npm run build` ✅ + `npx eslint` ✅. **Live Vite preview** (:5219, bridge up) ✅ — Operations → ⚠ diagnostics:
   modal opens, the **⤵ AUTO-ROUTE TRIAGE (1)** button renders **enabled** with tooltip "Auto-route 1 triage
   task(s) to the best-fit agent by skill match", **zero console errors**. `graphify update .` run after edits
   (1444 nodes / 2792 edges).
   **Not verified:** the live click→route→`✓ routed` result path — needs the bridge restart (TO-DO #1); the
   button click 404s against the old bridge by design. The data path is fully proven by the in-process dry-run
   against the live store.

### 2026-06-16 — Run #3 (BUILT the web-access audit surface) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE green.** Bridge :8767 UP (`/api/ping` ok, uptime ~16.5h). Gateway :8642 N/A by design.
   `npm run build` ✅ (exit 0, chunk-size warning only); `npx eslint` on the 2 touched TS files ✅ ("No
   issues found"). Confirmed the live bridge still runs **pre-restart** code: reconcile → 404, `/api/mc/cron`
   no `scheduler` field, and this run's new `GET /api/mc/agents/web-access` → 405 (only PUT/DELETE exist for
   that path shape on the old bridge; the explicit GET route resolves on restart). Did NOT kill the
   operator's bridge — verified the new capability in-process instead. THREE capabilities now load together
   on the next restart (run#1 reconcile, run#2 scheduler, run#3 web-audit) — see TO-DO #1.

2. **ORCHESTRATION steady.** Kanban unchanged: todo 8 · ready 1 · done 10 · blocked 6 · triage 1. No
   `stale_claim`. The 6 blocked tasks (5×narratrix, 1×default) still surface `blocked_no_reason`; this run
   makes their **root cause visible** rather than mutating the board (the fix is operator web-plugin config,
   not a silent reassign). Triage task + research-task unblock left for operator/live-Claude actions
   (TO-DO #3/#4), documented not faked.

3. **BUILT: web-access audit surface — visibility for the silent root cause of blocked research tasks
   (CAPABILITY GAPS #5, this loop's signature increment), end-to-end & LIVE-backed.** None of the 9
   research/intel agents have a web-search MCP, so research tasks block with no recorded reason. New
   capability across every layer:
   - `mc_store.py` — module consts `WEB_MCP_MARKERS` (brave/tavily/serper/exa/perplexity/websearch/
     firecrawl/fetch…) + `WEB_SKILL_MARKERS` (competitive-brief/synthesize-research/discover-brand/
     seo-audit/performance-report/brand-review/user-research); new `MCStore.web_access_audit()` —
     per-agent `{name,needs_web,has_web,gap,blocked_tasks,mcps,web_skills}` rows sorted gap-first then
     most-blocked, plus a `summary` (`total/needs_web/missing_web/blocked_due_to_web`) and an honest
     `hint`. `needs_web` = has a web-marker skill OR currently sitting on blocked tasks; diagnostic only,
     never provisions.
   - `mission-control-bridge.py:491` — `GET /api/mc/agents/web-access` → `STORE.web_access_audit()`
     (defined immediately after `get_agents`, before the `{agent_id}` PUT/DELETE routes, so the GET
     resolves cleanly).
   - `src/lib/api.ts` — new `WebAccessRow` / `WebAccessAudit` types + `getWebAccessAudit()` fetcher.
   - `src/pages/OperationsCenter.tsx` — `webAudit` state + `loadWebAudit()` (fired alongside
     `fetchDiagnostics()` on the ⚠ button), and a new `WebAccessPanel` component rendered at the top of
     the diagnostics modal: green "✓ all N web-dependent agents provisioned" when healthy, else amber
     header + per-agent gap rows (blocked count + "no web MCP", current MCPs in tooltip) + the amber
     provisioning hint. No fake "fix" button — provisioning is operator config.
   **Verified:** `python -m py_compile` on bridge + store + scheduler ✅; **in-process run of the real
   `web_access_audit()` against the live `agents.json`** ✅ → `summary={total:14, needs_web:9, missing_web:9,
   blocked_due_to_web:6}`, gap rows sorted narratrix(5 blocked)→default(1)→alphabetical, non-research agents
   (gridkeeper/broadcaster/neonsurgeon/reelforge/scriptwright) correctly `needs_web=False`; `blocked_due_to_web`
   exactly matches the board's 5×narratrix+1×default. `npm run build` ✅ + `npx eslint` ✅. **Live Vite preview**
   (:5219, bridge up) ✅ — navigated to Operations (hash route `#/operations`), opened ⚠ diagnostics: modal
   opens, reconcile bar + `blocked without a recorded reason` rows render, and the WEB-ACCESS AUDIT panel is
   **correctly absent** (old bridge 405 → `.catch` → `webAudit` null → no panel), **zero console errors** (only
   HMR debug lines). `graphify update .` run after edits (1430 nodes / 2756 edges).
   **Not verified:** the green panel path (9 gap rows + amber hint rendered) — needs the bridge restart
   (TO-DO #1); the data path that feeds it is proven by the in-process audit run.

### 2026-06-15 — Run #2 (BUILT the cron scheduler engine) · branch `auto/loop-reconcile-20260615`

1. **HEALTH GATE green.** Bridge :8767 UP (`/api/ping` ok, uptime ~14.5h; `/api/mc/health` → claude CLI
   v2.1.178, probe 147ms). Gateway :8642 N/A by design. `npm run build` ✅ (exit 0); `npx eslint` on the
   2 touched TS files ✅ ("No issues found"). Confirmed the live bridge still runs **pre-restart** code:
   `POST /api/mc/kanban/reconcile` → 404, `GET /api/mc/cron` has no `scheduler` field — so both run#1's
   reconcile and run#2's scheduler load together on the next bridge restart (did NOT kill the operator's
   bridge; verified everything in-process instead).

2. **ORCHESTRATION steady.** Kanban: todo 8 · ready 1 · done 10 · blocked 6 · triage 1. **No stale_claim**
   (run#1's 160h zombie stayed reclaimed). The 6 blocked tasks now surface `blocked_no_reason` (info) via
   diagnostics; root cause is still web-access config (TO-DO #3). Triage task unchanged (TO-DO #4). Nothing
   silently broken; the actionable items need operator config / live Claude turns, documented not faked.

3. **BUILT: in-bridge cron scheduler — the missing post-Hermes daemon (this loop's signature increment),
   end-to-end & LIVE-backed.** The UI rendered next-fire countdowns and `cronSchedule.ts` even *claimed*
   "the mc daemon runs on this machine and fires on its local clock" — but **nothing fired due jobs**
   (the gateway used to). New capability across every layer:
   - `mc_scheduler.py` (NEW) — pure, testable schedule-matcher mirroring `cronSchedule.ts`: `parse_cron`
     (5-field Vixie + `@macros`, `_expand_field` for `*` `,` `-` `*/n`), `parse_interval_seconds`
     (`30m`/`every 2h`, s/m/h/d), `is_due(job, now)` (cron: current local minute matches AND not already
     fired this minute; interval: ≥1 period since `last_run`, unfired anchored at `created_at`; inactive/
     prompt-less/unparseable never fire), `due_jobs()`, `schedule_kind()`. Standard DOM/DOW OR rule + 7→0
     Sunday normalization. Built-in self-test (`python mc_scheduler.py`).
   - `mc_store.py:623-643` — `MCStore.record_cron_result(job_id, ok, detail, trigger)` stamps `last_run`
     (epoch), `last_status` (ok|error), `last_trigger` (schedule|manual), `last_detail` excerpt, `next_run`.
   - `mission-control-bridge.py` — `import mc_scheduler`; module-level `MC_SCHEDULER_ENABLED` (default on),
     `MC_CRON_TICK_SECONDS` (30), `MC_CRON_JOB_TIMEOUT` (600); `CronScheduler` daemon thread (`status()`,
     `_loop` every tick, `_fire` single-flight via `run_claude`, never dies on a bad tick) started in
     `lifespan`; `GET /api/mc/cron` now returns `scheduler` status; manual `POST /api/mc/cron/{id}/run`
     now records results via `record_cron_result`.
   - `src/lib/api.ts:85-118` — `McCronJob` gains `last_run/last_status/last_trigger/last_detail`; new
     `CronSchedulerStatus` type; `getMcCron()` return adds optional `scheduler`.
   - `src/pages/OperationsCenter.tsx` — `SchedulerStatusBar` (green **DAEMON LIVE · tick 30s** vs amber
     starting/disabled vs amber "bridge predates daemon" when the field is absent) at the top of the
     ⏱ CRON modal, plus a per-job ✓/⚠ last-fire badge with the outcome in its tooltip.
   **Verified:** `python -m py_compile` on all 3 Python files ✅; `mc_scheduler.py` self-test ✅
   (07:00/07:30 daily fire-once-per-minute, no double-fire same minute, interval anchored at created_at
   then re-anchored at last_run, `@hourly` macro, DOM/DOW OR rule on the real 2026-06-15 Mon-the-15th,
   guards for paused/no-prompt/garbage); **in-process integration test** on a throwaway store ✅ (seeded
   interval-due + daily-not-due → `due_jobs` picks exactly the interval job → `record_cron_result` stamps
   ok/schedule and re-anchors so it's no longer due → error path stamps `error`); `npm run build` ✅ +
   `npx eslint` ✅; **live Vite preview** (bridge up) ✅ — `GET /api/mc/cron` from the page returns no
   `scheduler` field (old bridge) and the modal correctly shows the amber **"SCHEDULER STATUS UNKNOWN —
   bridge predates the cron daemon"** banner (exact honest fallback), zero console errors.
   **Not verified:** the green DAEMON-LIVE path + an actual scheduled fire — needs the bridge restart
   (TO-DO #1); the preview screenshot tool timed out twice on the live animation widgets (DOM text +
   clean console stand in). `graphify update .` run after edits (1420 nodes / 2743 edges).

### 2026-06-15 — Run #1 (baseline + stale-claim self-heal) · branch `auto/loop-reconcile-20260615`

1. **Established baseline & corrected the stale gateway assumption.** Confirmed bridge :8767 healthy
   (`/api/ping`, `/api/mc/health` → claude CLI v2.1.178). Verified via the bridge source that the
   **gateway was excised** with Hermes — `/api/mc/gateway` (`mission-control-bridge.py:2621-2624`)
   returns "No gateway under Claude". Recorded the architecture note at the top of this file so future
   runs stop treating :8642-down as a red health gate. `npm run build` ✅ (exit 0), `npm run lint` ✅
   (exit 0; only pre-existing `office/tower` churn).

2. **BUILT: kanban stale-claim self-heal (this loop's signature increment), end-to-end & LIVE-backed.**
   The board had a **160h zombie `running` claim** (`t_f76cf250`, signalscraper) that the existing
   `stale_claim` diagnostic detected but offered no fix for. Added a self-heal verb across all layers:
   - `mc_store.py:401-447` — `MCStore.reconcile_board(threshold_seconds=None)`: reclaims running tasks
     older than the threshold (default `STALE_CLAIM_SECONDS`=2h) back to `ready`, clears `started_at`,
     records a `reconciled` event with reason+`stale_hours`; returns `{reclaimed, threshold_hours, message}`.
   - `mission-control-bridge.py:732-753` — `POST /api/mc/kanban/reconcile` (`ReconcilePayload.threshold_hours?`).
   - `src/lib/api.ts:293-308` — `reconcileKanban(thresholdHours?)` + `ReconcileResult` type.
   - `src/stores/useTaskStore.ts` — `reconcileBoard()` action (import L23, iface L83, impl ~L227)
     that reclaims then refreshes tasks/stats/diagnostics; returns count.
   - `src/pages/OperationsCenter.tsx` — **⟳ RECONCILE STALE (n)** button in the diagnostics modal
     (store destructure L59, state ~L65, button ~L279), disabled & honest when stale count is 0.
   **Verified:** `npm run build` ✅ (exit 0); `npx eslint` on the 3 touched TS files ✅ ("No issues
   found"); `python -m py_compile` on bridge+store ✅; **unit test of the real `reconcile_board`** on a
   throwaway temp store ✅ (fresh-running kept, 10h-stale→ready, blocked untouched, `reconciled` event
   with reason recorded, custom-threshold path reclaims fresh) — all assertions passed.
   **Not verified:** the LIVE endpoint + DOM click — the running bridge holds pre-edit code (not killed:
   it is the operator's process) and the button can't be exercised live until a bridge restart (TO-DO #1).
   JSX compiles (tsc), logic proven by the in-process test.

3. **ORCHESTRATION: unfroze the live board.** Reclaimed the 160h zombie via the existing live
   `POST /api/mc/tasks/t_f76cf250/reclaim` (no restart needed — that verb predates this run). After:
   `by_status` running 1→0, ready 0→1; `kanban/diagnostics` `stale_claim` count 1→0. The 6 blocked +
   1 triage tasks were left in place with documented next-actions (TO-DO #2/#3) — they need
   web-access config / a live Claude turn, not silent mutation.

4. **PIPELINES checked.** `/api/content/pipeline` live → campaigns 22 · drafts 6 · calendar 31;
   `.mc/data/` stores present and written (calendar.json, content-ideas.json, ai-digest.json,
   creators-feed.json 39K, etc.). Integration env keys are not visible from the loop shell (the bridge
   may load its own env) so not asserting them unconfigured — the proven gap is web-access for the
   research agents (CAPABILITY GAPS #5). `graphify update .` run after edits.
