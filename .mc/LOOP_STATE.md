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

_Last run: **2026-06-15 ~16:40** (first real run — baseline established)._

| Subsystem | State | Notes |
|---|---|---|
| Bridge (:8767) | ✅ UP | `GET /api/ping` ok, uptime ~13.5h; claude CLI ok (v2.1.178), probe 110ms |
| Gateway (:8642) | ⚪ N/A by design | Excised with Hermes; `/api/mc/gateway` returns graceful-empty. NOT a blocker. |
| `npm run build` | ✅ PASS | tsc + vite, exit 0 (chunk-size warning only) |
| `npm run lint` | ✅ PASS | exit 0; only pre-existing `src/components/office/tower/*` churn (sibling-owned) |
| Kanban / orchestration | 🟡 stale board | todo 8 · ready 1 · done 10 · blocked 6 · triage 1. Zombie running claim reclaimed this run. |
| Cron jobs | 🔴 EMPTY | `jobs: []` — sentinel(7:00) + content-engine(7:30) absent; no in-proc scheduler (see GAPS) |
| Content pipeline | ✅ stores live | `/api/content/pipeline` → campaigns 22 · drafts 6 · calendar 31; `.mc/data/` written |
| Modules in error state | none observed | build renders; integrations rely on amber missing-key banners |

---

## TO-DO  _(rewritten each run — priority order, enough detail to act with no rediscovery)_

1. **Serve the new `/api/mc/kanban/reconcile` endpoint.** Built + verified this run but the LIVE
   bridge (PID was 59752) holds OLD code — it only loads on the next bridge restart (`npm run bridge`,
   or whatever launches the operator's bridge / desktop app). After restart, confirm
   `POST /api/mc/kanban/reconcile` returns `{reclaimed,threshold_hours,message}` and the Operations →
   ⚠ diagnostics modal → **⟳ RECONCILE STALE** button works end-to-end (it is disabled when
   stale_claim count is 0, which is the current state since the zombie was already reclaimed).
2. **Unblock the 6 blocked research tasks (root cause: no web-access tool).** All 6 (5×`narratrix`,
   1×`default`) are DA-Agency research/content tasks stalled ~146–160h. Per BUGHUNT_LOG the block
   reason is `web-access-tools-missing: No callable web search`. Fix is **config, not code**: give
   research-capable agents a web plugin (`web-brave-free` / set `BRAVE_SEARCH_API_KEY`), then
   unblock+reassign. This is an env/config action for the operator — surface it, don't fake it.
3. **Route the 1 triage task.** `"Produce content: Watch One Operator Run a Whole Agency"`
   (unassigned, ~28.6h). Next action: `POST /api/mc/tasks/{id}/specify` (Claude flesh-out → promote)
   then assign a content profile (e.g. `narratrix`/`scriptwright`). Left un-fired this run (runs a
   live Claude turn) — do it next run or when an operator is present.
3. **Decide the cron/scheduler model and seed the two required jobs.** Cron store is empty AND nothing
   fires it (see CAPABILITY GAPS #2). Either (a) add an in-bridge scheduler thread that fires due
   `next_run` jobs via `run_claude`, or (b) standardize on external Claude routines and have the UI
   reflect those. Until decided, **do not** create bridge-store cron entries that never auto-fire
   (dishonest green). Then seed sentinel(7:00) + content-engine(7:30).
4. **Next capability to BUILD** (after the above): wire a one-click remediation for `blocked_no_reason`
   and an "escalate after N failed retries" path (see CAPABILITY GAPS #3/#4).

---

## CAPABILITY GAPS  _(ranked by operator impact; ✅=built, →bughunt=broken-not-missing)_

1. ✅ **Stale-claim self-heal (BUILT this run).** Diagnostics *detected* `stale_claim` but there was
   no remediation verb — one dead agent could freeze the board forever (it did: a 160h zombie).
   Built `POST /api/mc/kanban/reconcile` → `reconcileKanban()` → `reconcileBoard()` store action →
   **⟳ RECONCILE STALE** button in the Operations diagnostics modal. Reclaims stale running claims
   back to `ready` with a recorded `reconciled` event.
2. 🔴 **No cron scheduler / no scheduled content jobs (HIGHEST remaining).** `mc_store` stores cron
   jobs and the bridge can run one on demand (`/api/mc/cron/{id}/run`), but **nothing fires jobs on
   schedule** (the gateway used to). Result: the sentinel(7:00 AI news) + content-engine(7:30)
   pipeline has zero automatic triggers. Needs an architecture decision (in-bridge thread vs external
   routine) before building — see TO-DO #3.
3. 🟡 **No auto-route for triage tasks.** Triage tasks sit until a human runs `/specify`. A
   "triage → specify → assign by skill-match" orchestration verb is missing.
4. 🟡 **No retry-exhaustion escalation.** `max_retries` exists on tasks but there is no path that
   escalates / notifies / reassigns when a task exhausts retries (the spec calls for it).
5. 🟡 **No web-access provisioning surface.** Research agents silently block on missing web tools;
   there is no UI/endpoint to see "which agents lack a web plugin" or to provision one. (Config gap,
   surfaced by the 6 blocked tasks.)
- → bughunt / NOT this loop: block-reason **display** in the task drawer already exists (built by
  bughunt, reads event payloads client-side); FAILED-vs-BLOCKED column reconciliation done by bughunt.
  Do not redo these.

---

## DONE  _(append-only — newest first; dated, with file:line + how verified)_

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
