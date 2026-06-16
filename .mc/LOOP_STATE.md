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

_Last run: **2026-06-16 ~03:15** (Run #4 — built skill-match auto-route for triage tasks)._

| Subsystem | State | Notes |
|---|---|---|
| Bridge (:8767) | ✅ UP | `GET /api/ping` ok, uptime ~18.5h. **Still holds pre-restart code** — now **FOUR** built capabilities wait on one restart: run#1 reconcile (`POST /api/mc/kanban/reconcile`→404), run#2 scheduler (`/api/mc/cron` no `scheduler` field), run#3 web-audit (`GET /api/mc/agents/web-access`→405), run#4 triage-route (`POST /api/mc/kanban/route`→404, confirmed this run). |
| Gateway (:8642) | ⚪ N/A by design | Excised with Hermes; `/api/mc/gateway` returns graceful-empty. NOT a blocker. |
| `npm run build` | ✅ PASS | tsc + vite, 156 modules, exit 0 (chunk-size warning only) |
| `npm run lint` | ✅ PASS | `npx eslint` on the 3 touched TS files (`api.ts`, `useTaskStore.ts`, `OperationsCenter.tsx`) = "No issues found"; only pre-existing `office/tower` churn remains (sibling-owned) |
| Kanban / orchestration | 🟡 steady board | todo 8 · ready 1 · done 10 · blocked 6 · triage 1 (unchanged from run#3). No `stale_claim`. 6 blocked still `blocked_no_reason` (web-access root cause, audited run#3). The 1 triage task now has a **live deterministic router** (run#4) — routes to `narratrix` on next restart. |
| Cron jobs | 🟡 EMPTY + engine ready | store `jobs: []`; scheduler daemon built (run#2), loads on restart. Seeding the 2 pipeline jobs safe-to-fire post-restart — TO-DO #2. |
| Content pipeline | ✅ stores live | `/api/content/pipeline` → campaigns 22 · drafts 6 · calendar 31 (run#1); `.mc/data/` written |
| Modules in error state | none observed | Vite preview (:5219) renders Operations LIVE; diagnostics modal opens clean; new **⤵ AUTO-ROUTE TRIAGE (1)** button renders enabled with correct tooltip, zero console errors. (Click 404s against the old bridge by design — works on restart.) |

---

## TO-DO  _(rewritten each run — priority order, enough detail to act with no rediscovery)_

1. **Restart the bridge to activate FOUR built capabilities at once** (`npm run bridge`, or whatever
   launches the operator's bridge / desktop app). The live bridge still holds pre-restart code
   (confirmed this run: reconcile → 404, `/api/mc/cron` no `scheduler` field, `/api/mc/agents/web-access`
   → 405, `/api/mc/kanban/route` → 404). After restart, confirm **all** of:
   - `GET /api/mc/cron` → includes `"scheduler": {enabled:true, running:true, tick_seconds:30, …}`;
     Operations → ⏱ CRON modal banner flips from amber "scheduler unknown" to green **DAEMON LIVE**.
   - `POST /api/mc/kanban/reconcile` (run#1) → `{reclaimed,threshold_hours,message}`; Operations →
     ⚠ diagnostics → **⟳ RECONCILE STALE** button works (disabled at 0 stale, the current state).
   - `GET /api/mc/agents/web-access` (run#3) → `{agents,summary,hint}` (in-process: `summary.missing_web=9,
     blocked_due_to_web=6`); Operations → ⚠ diagnostics → a **WEB-ACCESS AUDIT** panel lists the 9 flagged
     agents (narratrix top, 5 blocked) with the amber provisioning hint.
   - **`POST /api/mc/kanban/route` (run#4)** → `{routed,skipped,dry_run,message}`. Verify safely first with
     `{"dry_run":true}` → in-process it returns `routed:[{id:t_6f880653 → narratrix, score 23, skill_match
     [brand,content,copy,voice], web_gap:false}]`, board unmutated. Then Operations → ⚠ diagnostics →
     **⤵ AUTO-ROUTE TRIAGE (1)** button (cyan, currently renders enabled) → click routes the triage task to
     narratrix and de-triages it to `todo` (triage 1→0, todo 8→9), result line shows `✓ routed 1 → narratrix`.
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
4. **Route the 1 triage task — now AUTOMATED (run#4).** `"Produce content: Watch One Operator Run a Whole
   Agency"` (`t_6f880653`, unassigned). The deterministic **skill-match router** now picks the owner:
   after the restart, click ⤵ AUTO-ROUTE TRIAGE (or `POST /api/mc/kanban/route`) → assigns `narratrix`
   (the content copywriter; score 23, runner-up claudelink) and de-triages to `todo`. The Claude `specify`
   flesh-out (`POST /api/mc/tasks/{id}/specify`, runs a live turn) remains a separate optional step — fire
   when the operator is present. Did NOT auto-route this run (live bridge predates the endpoint; safe to do
   post-restart).
5. **Next capability to BUILD:** retry-exhaustion escalation (GAPS #4) is now the **only** remaining ranked
   gap — `max_retries` exists on tasks but nothing escalates/notifies/reassigns when a task exhausts them.
   Note: the board currently has **no** `failed`/retry-exhausted tasks, so it's a self-management capability
   with no live data to act on yet (build it pure + testable, like run#1-#4). One end-to-end per run.

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
4. 🟡 **No retry-exhaustion escalation.** `max_retries` exists on tasks but there is no path that
   escalates / notifies / reassigns when a task exhausts retries (the spec calls for it). **Now the only
   remaining ranked gap** — next build (TO-DO #5). No live retry-exhausted tasks on the board yet.
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
