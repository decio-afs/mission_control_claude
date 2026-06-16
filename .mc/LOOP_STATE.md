# Mission Control — Operational Loop State

This is the **handoff ledger** for the `/loop` command (Mission Control Operational Loop),
which runs **every 2 hours**. It is SEPARATE from `LOOP_LOG.md` (evolve) and `BUGHUNT_LOG.md`
(bughunt) — do not cross-contaminate.

**Every run MUST:** read this file top-to-bottom first → run the `/loop` protocol
(HEALTH → ORCHESTRATION → PIPELINES → CLOSE GAPS → VERIFY) → then rewrite the sections
below. `## DONE` is append-only history; `## TO-DO` is rewritten each run for the next run;
`## OPERATIONAL STATUS` is the at-a-glance current-reality snapshot.

> **Architecture note (post-Hermes excision, commit `cd96b0e`):** Mission Control is now
> **Claude-native**. There is **NO gateway on :8642** anymore — `/api/mc/gateway` deliberately
> returns "No gateway under Claude". The loop.md spec's "Gateway :8642 health gate" is **stale**;
> :8642 being down is **expected and correct**, NOT a blocker. The bridge (:8767) talks to Claude
> directly. There is also **no in-process kanban dispatcher and no in-process cron scheduler** —
> the gateway used to host both. Task execution + scheduling now depend on Claude Code (chat /
> spawn / this loop) and external Claude routines / Windows Scheduled Tasks, not a daemon.

---

## OPERATIONAL STATUS  _(snapshot — refresh every run)_

_Last run: **2026-06-16 ~18:40** (Run #10 — built the maintenance cron job kind: `kind:"maintenance"` + `action:"sweep"` → scheduler fires `STORE.sweep_board()` with no Claude turn → hands-free board self-heal on a timer)._

| Subsystem | State | Notes |
|---|---|---|
| Bridge (:8767) | ✅ UP | `GET /api/ping` ok, uptime ~30.5h. **Still holds pre-restart code** — now **TEN** built capabilities wait on one restart: run#1 reconcile (`POST /api/mc/kanban/reconcile`→404), run#2 scheduler (`/api/mc/cron` no `scheduler` field), run#3 web-audit (`GET /api/mc/agents/web-access`→405), run#4 triage-route (`POST /api/mc/kanban/route`→404), run#5 escalate (`POST /api/mc/kanban/escalate`→404), run#6 cascade (`POST /api/mc/kanban/cascade`→404), run#7 reassign (`POST /api/mc/kanban/reassign`→404), run#8 dep-cycle guard (`POST /api/mc/tasks/link` accepts cycles), run#9 sweep (`POST /api/mc/kanban/sweep`→404 — confirmed this run), **run#10 maintenance cron** (old bridge accepts-but-ignores `kind`/`action` on `POST /api/mc/cron` — created jobs have no kind, scheduler can't fire an internal verb). |
| Gateway (:8642) | ⚪ N/A by design | Excised with Hermes; `/api/mc/gateway` returns graceful-empty. NOT a blocker. |
| `npm run build` | ✅ PASS | tsc + vite, 156 modules, exit 0 (chunk-size warning only) |
| `npm run lint` | ✅ PASS | Run #10 touched 2 TS files (`api.ts`, `OperationsCenter.tsx`); `npx eslint` on both = "No issues found". Python: `py_compile` on `mc_scheduler.py`/`mc_store.py`/`mission-control-bridge.py` ✅ + `mc_scheduler.py` self-test ALL PASS. Only pre-existing `office/tower` churn remains (sibling-owned). |
| Kanban / orchestration | 🟡 steady, triage grew | todo 8 · ready 1 · done 10 · blocked 6 · **triage 6** (was 1 — 5 new unassigned triage tasks this run). No `stale_claim`, no `retry_exhausted`, no `blocked_by_dependency`, no `dead_agent_task`, no `dependency_cycle`. Live `sweep_board(dry_run)` → total 0 (honest no-op). 6 blocked still `blocked_no_reason` (web-access root cause, audited run#3). The 6 triage tasks need the run#4 auto-route verb — pending restart (TO-DO #4). |
| Cron jobs | 🟡 EMPTY + engine ready | store `jobs: []`; scheduler daemon built (run#2) loads on restart; **maintenance-job kind built (run#10)** lets a recurring `*/30 * * * *` sweep job self-heal the board with no human/Claude turn. Seeding pipeline + self-heal jobs safe post-restart — TO-DO #2/#5. |
| Content pipeline | ✅ stores live | `/api/content/pipeline` → campaigns 27 · drafts 6 · calendar 36 (was 22/6/31 — pipeline alive & writing `.mc/data/`) |
| Modules in error state | none observed | Run #10 adds a **KIND toggle** (◆ CLAUDE PROMPT / ⚙ MAINTENANCE) + sweep ACTION select to the Operations → ⏱ CRON create form, and a ⚙ maintenance chip on maintenance job rows. Live preview (bridge up, 0 jobs): toggle renders, switching to MAINTENANCE swaps prompt textarea → sweep action select, zero console errors. Prior runs' buttons unchanged. |

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
10. 🟡 **No per-task cycle-break remediation.** run#8 surfaces `dependency_cycle` read-only; there's no in-UI
    "unlink to break cycle" affordance in the task drawer. Bughunt-adjacent UI — runner-up (TO-DO #5).
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
- → bughunt / NOT this loop: block-reason **display** in the task drawer already exists (built by
  bughunt, reads event payloads client-side); FAILED-vs-BLOCKED column reconciliation done by bughunt.
  Do not redo these.

---

## DONE  _(append-only — newest first; dated, with file:line + how verified)_

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
