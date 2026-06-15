# Mission Control — Autonomous Bug-Hunt Loop Log

This file is the **handoff document** for the `mission-control-bughunt` scheduled task,
which fires **every 2 hours** (cron `0 */2 * * *`, local time) and uses the **/graphify** skill.
It is SEPARATE from `LOOP_LOG.md` (the `mission-control-evolve` consolidation/feature loop) —
do not cross-contaminate the two.

Each run MUST, in order:

1. **Read this file top to bottom** before doing anything else — never re-fix or re-report a
   bug already listed under "Run History"; pick up the "Next Targets" the previous run queued.
2. **Run /graphify** (Skill tool, `skill: "graphify"`) to scope the hunt area — use
   `graphify query/path/explain` rather than blind grep; run `graphify update .` after editing code.
3. **Pick the SINGLE highest-operator-impact item.** Hunt ALL bug classes across the whole stack
   (logic / visual-UI / coding / misconfiguration; frontend + `hermes-bridge.py` backend + the seams),
   AND each run check the operational spine: kanban lifecycle (delegation / completion / BLOCKED+FAILED
   visibility) and **deliverable integrity** (does every produced output have a visible, retrievable home,
   or is it a lost deliverable? — see "Systemic Threads"). Prioritize lost/hidden deliverables + broken
   lifecycle visibility over cosmetics. Only act on something provable from specific code.
4. **Fix it minimally**, matching the surrounding style.
5. **Test**: `npm run build` + `npm run lint` must pass; add a standalone check for pure-lib logic;
   verify in the Vite preview when it's a UI bug and the bridge is up. State any layer you couldn't verify.
6. **Append** a dated, numbered entry to "Run History" (bug, fix `file:line`, how verified), then
   **rewrite "Next Targets"** with the next focus area + leftover suspicious spots. Never delete history.

**Rules:** ONE solid fix per run beats many shaky ones. Keep all LIVE Hermes-backed functionality
intact. The working tree may carry unrelated inherited churn from the `mission-control-evolve` loop —
leave it untouched; touch only the files for your fix + this log. Do NOT push or open PRs.

---

## Focus-Area Rotation (cycle through so coverage spreads)

1. `src/lib/*.ts` pure logic — cronSchedule, cycleTime, backlogTrend, agingWip, agentMetrics (date/seconds-vs-ms math, reducers, percentiles)
2. `src/stores/*.ts` Zustand stores — polling, race conditions, stale state, terminal-status sets
3. `src/lib/api.ts` ↔ bridge wiring — endpoint/param names vs `hermes-bridge.py`, response shape decoding  (AUDITED iter #2: CLEAN — skip unless code changed)
4. `src/pages/*.tsx` — Operations Center (Kanban CRUD), War Room, Content Factory, Ghost Network
5. `src/components/*.tsx` — drawers, modals, feeds (null-crashes, effect deps, key collisions, cleanup)
6. `hermes-bridge.py` backend — route logic, CLI arg construction, timeouts, error propagation, response shaping
7. MISCONFIG sweep — `vite.config`, `tsconfig`, `.eslintrc`, `tailwind`, `package.json` scripts, env vars (`VITE_BRIDGE_URL`/ports/timeouts), CORS, axios per-endpoint timeouts vs the bridge's real latency
8. CROSS-SURFACE deliverable/lifecycle audit — see "Systemic Threads" below (this is a standing, higher-priority track)  ◀ ACTIVE TRACK (iter #4 closed DELIV-1; iter #5 added Patch Notes panel; iter #6 closed DELIV-2 slice a [block/fail reason]; iter #7 closed DELIV-2 slice b [FAILED column] — DELIV-2 FULLY DONE; iter #8 closed DELIV-3 [empty-result done → worker-log tail], LIVE-VERIFIED on 6 real both-empty tasks; iter #9 closed DELIV-4 slice a [copyable ARTIFACTS path/branch]; iter #10 closed DELIV-4 slice b [read-only workspace file browser + inline reader], LIVE-VERIFIED on a real 12KB deliverable — **DELIV-4 FULLY DONE**; iter #11 closed LIFE-1 [drawer action errors surfaced + bridgeDetail reasons], LIVE-VERIFIED via zero-mutation monkeypatch; iter #12 closed DONE-CARD [board done cards show a ◆ when result/branch present], LIVE-VERIFIED both cases via zero-mutation client patch; iter #13 closed DONE-CARD-2 [server-computed `has_deliverable` on the `mc_store` list projection — result/branch/run-summary/non-empty-workspace-dir], LIVE-VERIFIED 7-lit/3-dark on the real board + over HTTP via a throwaway :8799 bridge; iter #14 closed LABEL-1 [topbar bridge port derived from `BRIDGE_BASE_URL`, LIVE-VERIFIED rendering `:8799` at an alternate port] — **the ENTIRE deliverable/lifecycle track is now FULLY CLOSED; next run advances to focus area #1/#2: `src/lib/*.ts` pure logic + `src/stores/*.ts` stores**)

---

## Systemic Threads (standing, multi-run — HIGHER priority than isolated bugs)

These come from the iter #3 deliverable-flow investigation. Mission Control is the command center; a task's
output must have a visible, retrievable home or it's a **lost deliverable**. The backend PERSISTS deliverables
correctly (`task.result`, `latest_summary`, `runs[].summary`, worker-log file, `workspace_path`, `branch_name`),
but the UI surfaces them only through **`TaskDetailDrawer`**, reachable only from Operations Center board cards.
Work these top-down; each is likely several runs. Reuse `TaskDetailDrawer` (already renders result/summary/runs)
rather than building new surfaces.

- [x] **DELIV-1 (HIGH) — Content Factory deliverables unreachable — FIXED iter #4.** Campaign + draft cards in
  `src/pages/ContentFactory.tsx` are now clickable `<button>`s that open the existing `TaskDetailDrawer` (card `id`
  IS the kanban task id — verified in both the bridge `get_content_pipeline` payload and the client-side fallback).
  A finished content task's `result`/`latest_summary`/`runs`/worker-log is now readable/copyable from the Factory.
  Verified live (bridge up): clicked a DONE content card → drawer opened with the real deliverable text. **Remaining
  smaller slice (folded into DONE-CARD):** the calendar items in the sidebar are still not clickable, and cards give
  no inline "has-deliverable" snippet — but the core unreachability is resolved.
- [x] **DELIV-2 (HIGH) — block/fail reason shown (slice a, iter #6) + FAILED column (slice b, iter #7) — FULLY DONE.**
  ✅ **Slice (a) FIXED iter #6** — `src/components/TaskDetailDrawer.tsx` now renders the block/fail *why*: a new
  `eventDetail()` helper (DETAIL_KEYS = reason/message/error/detail/note — keys confirmed live in real Hermes event
  payloads) feeds (1) a prominent BLOCKED/FAILED reason banner at the top of the drawer and (2) a detail line under
  every EVENT TIMELINE row. Verified live on `t_4b8bab28`.
  ✅ **Slice (b) FIXED iter #7** — `src/pages/OperationsCenter.tsx`: `colOf` no longer folds `failed → blocked`; FAILED
  is now its own board column (`COLUMNS` :24, tone `#b91c1c` distinct from BLOCKED `#ef4444`) and falls through
  `colOf` naturally; added a header **FAILED chip** (:188, `stats.by_status.failed ?? summary.failed`, red-500) while
  the BLOCKED chip stays blocked-only (red-400). Columns now reconcile with chips: BLOCKED column == BLOCKED chip,
  FAILED column == FAILED chip; failed is distinguishable from blocked. Closes Next-Target #3 too. Verified live
  (bridge up): all 9 columns render in order with FAILED at rgb(185,28,28); FAILED chip present reading 0 (no live
  failed task), zero console errors.
- [x] **DELIV-3 (MED) — empty-result `done` = zero-visibility — FIXED iter #8 (LIVE-VERIFIED).** The RESULT/SUMMARY
  section (`TaskDetailDrawer.tsx`) rendered `latest_summary || result`; when both were empty on a `done`/`completed`
  task the section vanished and the work lived only in the raw worker log. **Fix:** `load()` now, for a done/completed
  task with both empty, fetches the worker-log tail via the existing `getHermesTaskLog(taskId, 4000)` (no new endpoint)
  into `rawOutput` state; the RESULT section falls through to a **"RESULT / SUMMARY · RAW OUTPUT"** block (note "no
  summary was written — showing the tail of the worker log" + a `<pre>` tail). Normal summary path is untouched.
  **Live-verified (bridge up, 6 real both-empty done tasks found):** `t_ac3acb98` now shows RAW OUTPUT with 3554 chars
  of worker-log tail (was blank before); `t_f76cf250` (has summary) still shows the plain RESULT/SUMMARY, no fallback;
  zero console errors.
- [x] **DELIV-4 (MED) — file/branch artifacts not viewable — slice a (display) FIXED iter #9; slice b (browse) FIXED
  iter #10 — FULLY DONE (LIVE-VERIFIED).** ✅ **Slice (a) FIXED iter #9** — `TaskDetailDrawer.tsx` ARTIFACTS section with
  copyable, untruncated `WORKSPACE PATH` + `BRANCH` rows (`Artifact` component, `⧉ COPY`). ✅ **Slice (b) FIXED iter #10**
  — new read-only `GET /api/hermes/tasks/{id}/workspace` (`hermes-bridge.py`) lists the workspace files (`?file=` reads
  one file's text, confined inside the workspace, size-capped) + git log/diff --stat when the dir is a repo; client
  helpers `getHermesTaskWorkspace`/`getHermesTaskWorkspaceFile` (`api.ts`); a `⊞ BROWSE FILES` toggle + self-contained
  `WorkspaceBrowser` in the ARTIFACTS section (📄 click → inline file content, 📁 dirs listed). **Live-verified** on a real
  task: `t_26d8eb11/competitor_analysis.md` (12 292 B) — previously invisible — now lists + reads inline; all
  path-traversal guards 403; empty/missing degrade gracefully. So a file/branch deliverable is now fully retrievable
  in-app. (Future polish, not blocking: subdirectory drill-down — dirs are listed but not yet browsable; the `?file=`
  endpoint already accepts confined sub-paths, so it's a UI-only follow-up.)
- [x] **LIFE-1 (LOW/MED) — drawer actions swallow errors — FIXED iter #11 (LIVE-VERIFIED).** `TaskDetailDrawer.tsx`
  `act()` ran `await fn(); await load();` with no catch and **ignored the boolean** every store verb returns — so a
  failed verb (claim/complete/block/promote/reassign/comment/link…) just silently reloaded with no operator-visible
  reason. **Fix (2 files):** (1) `act()` now wraps in try/catch/finally, checks the returned `ok`, and on `false`
  captures `useTaskStore.getState().error` into a new `actError` state (rendered as a dismissible red banner under the
  ACTIONS grid; the catch also covers any throw from the callback bodies like `if(ok)onClose()`). (2) store `mutate()`
  now stashes `bridgeDetail(err)` instead of `errMessage(err)` — so the surfaced reason is the bridge's real FastAPI
  `detail` / CLI stderr (e.g. "task 't_x' not found") not axios's generic "Request failed with status code N"; this also
  upgrades the only other consumer of `useTaskStore.error` (WorkflowBuilder). **Live-verified (bridge up):** confirmed
  the bridge returns `{"detail":"task '…' not found"}` on a rejected verb (curl, no mutation); then in the :5219 preview
  opened a real todo task's drawer and, via a **zero-mutation** monkeypatch of `promoteTask` (dynamic-imported the same
  store module, made it resolve `false` + set error exactly like a real reject), clicked PROMOTE → the red error line
  rendered "⚠ task '…' is not ready (simulated bridge reject)" with the right styling, ✕ dismissed it, override restored,
  board confirmed unchanged throughout, zero console errors.
- [x] **DONE-CARD (MED) — board done cards now show a "has deliverable" ◆ — FIXED iter #12 (LIVE-VERIFIED both cases).**
  `OperationsCenter.tsx`: new pure helper `hasDeliverable(t)` = `Boolean(t.result?.trim() || t.branch_name?.trim())` (both
  fields are already on the board's `McTask` list payload — **no per-card fetch**), and a small emerald `◆` marker in the
  done-card footer right-group, gated `col.key === 'done' && hasDeliverable(t)` (title "Deliverable available — open to view
  the result/branch"). **Key signal-quality call:** `workspace_path` is DELIBERATELY excluded — live probe of all 10 done
  tasks showed `workspace_path` set on 10/10 (it's set on virtually every task even when empty, per iter #10), so it would
  light every done card and carry no signal; `result`/`branch_name` were empty on all 10, giving zero false positives. So
  the dot is the canonical-deliverable cue (`task.result` is THE deliverable field per the deliverable-flow map) with no
  noise. **Caveat (next-target seed below):** the deliverable summary an agent writes lives in `latest_summary` (a computed
  `TaskDetail` field, fetched per-task) and the worker log — NEITHER is in the list payload — so a done task whose only
  output is `latest_summary`/worker-log (the DELIV-3 case) does NOT get the board dot. Catching those at the board level
  needs a cheap **server-computed `has_deliverable` boolean on the list endpoint** (the bridge can see latest_summary/runs/
  worker-log existence without shipping content) — recorded as DONE-CARD-2 below.
- [x] **LABEL-1 (LOW, cosmetic) — topbar bridge label was hardcoded — FIXED iter #14 (LIVE-VERIFIED at an alternate port).**
  `Layout.tsx:203` rendered the literal text `● BRIDGE :8767` regardless of the real `VITE_BRIDGE_URL`/`BRIDGE_BASE_URL`
  (it cost a verification detour in iters #10, #12 AND #13). **Fix (2 files):** `api.ts:9` now **exports** `BRIDGE_BASE_URL`
  (already the axios `baseURL`); `Layout.tsx` imports it and derives a module-level `BRIDGE_PORT = new URL(BRIDGE_BASE_URL).port
  || '8767'` (try/catch → `'8767'` fallback), and the label is now `● BRIDGE :{BRIDGE_PORT}`. Default output is byte-identical
  (`:8767`), so no visual change on the normal config. **Live-verified:** a throwaway Vite preview on :5223 with a gitignored
  `.env.local` `VITE_BRIDGE_URL=http://localhost:8799` rendered the sidebar span as **`● BRIDGE :8799`** (DOM read), proving the
  label now tracks the configured URL; zero label-code console errors; full teardown. **This closes the entire
  deliverable/lifecycle track.**
- [x] **DONE-CARD-2 (MED) — board dot now catches file/summary/branch deliverables — FIXED iter #13 (LIVE-VERIFIED 7/3).**
  The iter #12 ◆ dot keyed on `result`/`branch_name`, the only deliverable fields on the **list** payload, and lit **0/10**
  current done cards. **Fix (3 files):** `mc_store.py` `list_tasks()` now computes a server-side `has_deliverable: bool` per
  task via a new `_has_deliverable(task, runs)` helper — true if `result` OR `branch_name` OR **any run summary** (= a
  non-empty `latest_summary`, computed once from in-memory meta — no per-card fetch) OR a **non-empty workspace dir** (≥1
  non-hidden entry; the common case here, where the deliverable is a file the agent wrote). `McTask` (`src/lib/api.ts`) gains
  optional `has_deliverable?: boolean`; `OperationsCenter.tsx` `hasDeliverable()` ORs the server flag in (keeping the raw
  `result`/`branch` fallback for older payloads). **Migration-aware call:** the handoff's original spec listed "non-empty
  worker log" as a signal, but in the native `mc_store` the worker log is **synthesized from the event timeline**
  (`task_log` :814) — every task has a `created` event, so it's never empty and would light EVERY card; deliberately
  excluded (documented in the helper). Bare `workspace_path` still excluded (iter #10/#12: set on ~every task even when
  empty) — we require the dir to actually contain a real entry. **Live-verified on the REAL board (read-only):** the new
  `list_tasks()` over the live data files lights **exactly the 7 done tasks with a workspace deliverable file** (`competitor_
  analysis.md`, `daautonomous_instagram_audit.md`, etc.) and leaves the **3 empty-workspace done tasks dark** — and a
  throwaway bridge on :8799 (new code, operator's :8767 untouched) **served the same 7/3 over HTTP**. Closes the
  deliverable-integrity track except cosmetic LABEL-1.

---

## Next Targets (the next run executes these)

Iteration #1 ran a full read-only recon (focus: stores + lib). It fixed the topbar QUEUE
double-count (see Run History #1) and queued these **verified-by-recon, not-yet-fixed** leads.
Pick ONE per run, highest-value first; confirm it still exists before fixing (the tree is churning).

1. **`mapHermesToOp` is a lossy status projection** — `src/stores/useTaskStore.ts:108-114`. The ternary
   maps only `done/completed/running/blocked/failed/ready`; `triage/todo/review/scheduled/pending` all
   collapse to `'pending'`, and the `OpTask['status']` union doesn't even include those states. Today
   only `tasks.length` is read (WarRoom), so impact is latent — but any consumer that reads
   `tasks[].status` for those states gets wrong data. Fix: extend the union + mapping, or document the
   projection as lossy. (decoding / wrong-data, latent)
2. ~~**WarRoom activity timestamp**~~ — RESOLVED (not a bug). Iteration #2 confirmed `hermes-bridge.py`
   `/api/hermes/activity` (L583-593) emits task lifecycle stamps verbatim in epoch **seconds**, so WarRoom's
   `new Date(a.timestamp * 1000)` is correct. GhostNetwork's `norm()` is just defensive. Do NOT "fix" this.
3. ~~**Operations BLOCKED column vs chip mismatch**~~ — RESOLVED iter #7. FAILED is now its own column +
   chip in `src/pages/OperationsCenter.tsx`; BLOCKED column == BLOCKED chip, FAILED column == FAILED chip.
4. **`OperationsCenter` OLDEST READY: correct-by-accident math** — `src/pages/OperationsCenter.tsx:143,189`.
   `stats.oldest_ready_age_seconds` is already an age (per `KanbanStats` in `api.ts`), but it's rendered as
   `ago(now - oldestReady)` = `now - (now - age) = age` — right only because two errors cancel. One refactor
   of `ago()` breaks it. Fix: format the age directly (small `fmtAge(sec)` / `formatCountdown(age*1000)`),
   drop the `Date.now()` subtraction. (logical / latent)
5. **`useChatStore.send` catch re-derives the transcript key** — `src/stores/useChatStore.ts:199` (user msg
   uses `key`) vs `:235` (catch appends error to `get().activeId || DRAFT_KEY`). After a draft is adopted, the
   error line can land on a different key than the user line. Fix: reuse the same key in the catch. (UI /
   logical, rare)

**PATCH NOTES CONTRACT (added iter #5):** an operator-facing changelog now lives at `.hermes/patch-notes.json`
(`{"notes":[...]}`, NEWEST FIRST), served by `hermes-bridge.py` GET `/api/hermes/patch-notes` and shown in the
dashboard via topbar **⚙ UI → PATCH NOTES** (`src/components/PatchNotes.tsx`). EVERY run that ships a code fix MUST
append one entry (id `iter-<N>-<slug>`, iteration, date, plain-English title ≤70 chars, jargon-free 2-3 sentence
summary written for the operator not a dev, category `bug|deliverable|lifecycle|ui|perf|misconfig`, severity,
files). Pure-audit runs add none. Keep the JSON valid.

**TOP PRIORITY for the NEXT run (iteration #15): the deliverable/lifecycle track is FULLY CLOSED** (DELIV-1..4, LIFE-1,
DONE-CARD, DONE-CARD-2, LABEL-1 all done — LABEL-1 closed iter #14). **Fall back to the focus-area rotation, advancing to
area #1/#2: `src/lib/*.ts` pure logic + `src/stores/*.ts` stores.** The strongest concrete, recon-verified leads to pick
from (confirm each still exists before fixing — the tree churns):
- **Lead #4 (recommended next — clean self-contained logic fix): `OperationsCenter` OLDEST READY correct-by-accident math**
  — `src/pages/OperationsCenter.tsx:143,189`. `stats.oldest_ready_age_seconds` is ALREADY an age, but it's rendered as
  `ago(now - oldestReady)` = `now - (now - age) = age` — right only because two errors cancel; one refactor of `ago()` breaks
  it. Fix: format the age directly (small `fmtAge(sec)`), drop the `Date.now()` subtraction. Standalone-testable pure logic.
- **Lead #1: lossy `mapMcToOp`/`mapHermesToOp` status projection** — `src/stores/useTaskStore.ts:108-114`. The ternary maps
  only `done/completed/running/blocked/failed/ready`; `triage/todo/review/scheduled/pending` all collapse to `'pending'` and
  the `OpTask['status']` union doesn't even include those states. Latent today (only `tasks.length` is read) but any future
  consumer of `tasks[].status` gets wrong data. Fix: extend the union + mapping, or document the projection as lossy.
- **Lead #5: `useChatStore.send` catch re-derives the transcript key** — `src/stores/useChatStore.ts:199` (user msg uses
  `key`) vs `:235` (catch appends error to `get().activeId || DRAFT_KEY`). After a draft is adopted, the error line can land
  on a different key than the user line. Fix: reuse the same `key` in the catch.

**Possible DONE-CARD-2 follow-up (LOW, optional):** the iter #13 workspace-dir check is shallow (top-level `os.scandir`,
counts any non-hidden entry). If a workspace ever holds only scaffolding (a stray non-hidden file with no real deliverable)
the dot could over-fire; not observed on the current board (the 7 lit all have a single real `.md`), so this is a watch
item, not a bug. The list endpoint now does one cheap `scandir`-with-early-exit per task whose in-store fields are empty —
negligible for a local board of dozens of tasks, but if the board grows large, consider caching or gating it.

**Verification note:** iter #8 was the first deliverable-thread fix LIVE-CONFIRMED on a real populated edge case (6
done tasks on the live board had BOTH `latest_summary` and `result` empty — `t_ac3acb98`, `t_db3e97f0`, `t_34d9de94`,
`t_f2f41469`, `t_a33fad25`, `t_9b58127d`). Contrast iter #6/#7 (no live blocked/failed task existed). The board is
otherwise all-`done` (`by_status:{done:31}`); a future run that catches a live blocked/failed task should still
visually confirm the iter #6 reason banner + a populated iter #7 FAILED column.

**Secondary focus rotation:** area #4/#5 (`src/pages/*.tsx` + `src/components/*.tsx`). The
`api.ts` ↔ `hermes-bridge.py` contract (area #3) was AUDITED in iteration #2 and is CLEAN — every request
body key the client sends matches the bridge Pydantic models / route handlers (comment→`text`/`author`,
edit→`result`/`summary`/`metadata`, block→`reason`, assign→`profile`, reassign→`profile`/`reclaim`/`reason`,
notify→`platform`/`chat_id`/`thread_id`/`user_id`, create→`title`/`body`/`assignee`/`priority`/`skills`/
`parents`/`triage`/`max_retries`, cron, boards, spawn, chat, decompose→`task`). No bridge param bug exists;
don't re-audit it. Remaining unfixed leads above after iter #7 closed #3: **#1** lossy `mapHermesToOp`,
**#4** OLDEST-READY correct-by-accident math, **#5** chat-store catch key — pick one only if DELIV-4/LIFE-1 are
blocked.

---

## Run History (newest first — append, never overwrite)

### 2026-06-15 — Iteration #14 (focus: LABEL-1 — hardcoded topbar bridge port; FIXED [front, 2 files] — LIVE-VERIFIED at an alternate port)

**Audited.** The top-priority queued item LABEL-1 — the LAST item in the deliverable/lifecycle track (DONE-CARD-2 closed it
all bar this). Scoped via /graphify (existing graph fast-path; `query "Layout topbar bridge label BRIDGE port hardcoded
BRIDGE_BASE_URL api.ts axios baseURL VITE_BRIDGE_URL"`, BFS depth 2, 24 nodes — confirmed `bridge`/`api.ts` in community 4 and
the axios `bridge` client at `api.ts:11`). Read the label site (`Layout.tsx:200-211`) + the axios base URL definition
(`api.ts:9`).

**Bug/gap.** `Layout.tsx:203` rendered the **literal string** `● BRIDGE :8767` in the sidebar bridge status line, regardless
of the real bridge URL. `api.ts:9` already derives the true base from `VITE_BRIDGE_URL || 'http://localhost:8767'`, but the
label never consulted it. Harmless on the default port, but it actively **misled the live verification in iters #10, #12 AND
#13** (the label read `:8767` while throwaway bridges ran on `:8799`), and it would mislead any operator who repoints the
dashboard via `VITE_BRIDGE_URL`. Low severity / cosmetic, but a real (thrice-proven) source of confusion.

**Fix (front, 2 files).** (1) `api.ts:9` — `const BRIDGE_BASE_URL` → **`export const BRIDGE_BASE_URL`** (it was already the
axios `baseURL`). (2) `Layout.tsx` — imported `BRIDGE_BASE_URL` from `../lib/api`; added a module-level `BRIDGE_PORT`
constant = `new URL(BRIDGE_BASE_URL).port || '8767'` wrapped in try/catch (falls back to `'8767'` on a malformed URL or one
with no explicit port); changed the label to `● BRIDGE :{BRIDGE_PORT}`. No backend, no new component, no behavior change on
the default config (still renders `:8767`).

**Verify.** `npm run build` ✓ (tsc + vite, 155 modules, 638ms). `npx eslint src/components/Layout.tsx src/lib/api.ts` ✓ ("No
issues found"). **Standalone Node check of the exact derivation** `new URL(u).port || '8767'` (6 cases) ✓: default
`:8767`→`8767`, `:8799`→`8799`, `:3001`→`3001`, no-port URL→`8767`, malformed→`8767`, empty→`8767` — ALL PASS (default output
byte-identical to the old literal, so zero visual regression; alternate ports now tracked). **LIVE DOM-VERIFIED at a NON-default
port (the whole point):** the operator's bridge was up at :8767 (health + patch-notes both 200, left untouched). Started a
throwaway Vite dev server on **:5223** running the real `Mission_Control_Claude` app via a temp `npm --prefix` launch config in
the parent `Mission_Control/.claude/` (the Claude-Preview MCP roots at the near-empty parent folder, not the app repo — the
known misdirection), with a gitignored `.env.local` setting `VITE_BRIDGE_URL=http://localhost:8799`. DOM read of the sidebar
span returned **`● BRIDGE :8799`** (not `:8767`) — conclusive proof the label now tracks the configured URL. Console showed
only the expected baseline bridge-down `Network Error`s (no bridge on :8799) — **none from `Layout`/`BRIDGE_PORT`**. Full
teardown: stopped the :5223 preview, deleted `.env.local`, deleted the parent `Mission_Control/.claude/` (did not exist
before), reverted the `vite-label` config out of the app's `.claude/launch.json` (back to the lone `vite`/:5219). Added patch
note `iter-14-label-1-bridge-port` (ui, low). Ran `graphify update .`.

**This closes the ENTIRE deliverable/lifecycle track** (DELIV-1..4, LIFE-1, DONE-CARD, DONE-CARD-2, LABEL-1). The next run
falls back to the **focus-area rotation** (advance to area #1/#2: `src/lib/*.ts` pure logic + `src/stores/*.ts` stores) plus the
remaining isolated leads #1/#4/#5.

**Files touched:** `src/lib/api.ts`, `src/components/Layout.tsx`, `.hermes/patch-notes.json`, `.hermes/BUGHUNT_LOG.md` (this
entry). No commit/push (loop rules; working tree carries unrelated `mission-control-evolve` + Hermes→Claude rename churn — left
intact).

### 2026-06-14 — Iteration #13 (focus: DONE-CARD-2 — server-computed `has_deliverable`; FIXED [front+store+seam] — LIVE-VERIFIED 7/3)

**Audited.** The top-priority queued item DONE-CARD-2, the last functional item in the deliverable/lifecycle track. Scoped
via /graphify (existing graph fast-path; `query "mc kanban list projection task fields result branch_name latest_summary
has_deliverable McTask OperationsCenter hasDeliverable board done card"` confirmed `hasDeliverable()` at
`OperationsCenter.tsx:52`, `OperationsCenter()` :56). Read the full chain: board card render + `hasDeliverable()`
(`OperationsCenter.tsx:44-54`) → `McTask` list type (`api.ts:57-78`, no deliverable summary field) → `/api/mc/tasks`
(`mission-control-bridge.py:590` = `STORE.list_tasks()`) → `mc_store.py` `list_tasks()` :119 (returned raw `_tasks()`) +
`show_task()` :156 (`latest_summary` = result, overridden by last run summary) + `task_log` (worker log).

**Bug/gap.** iter #12's ◆ dot keyed on `result`/`branch_name` — the only deliverable fields on the LIST payload — and a
live probe showed those are empty on **all 10** current done tasks, so the dot lit **0/10**. The real deliverables on this
migrated board live as **files the agent wrote into the workspace dir** (probed: 7 of 10 done tasks hold a real `.md`
deliverable — `competitor_analysis.md`, `daautonomous_instagram_audit.md`, `da_agency_llc_profile.md`, …; 3 have empty
workspaces) — none of which the board could see without a per-card fetch. So 7 genuinely-finished, deliverable-producing
tasks gave the operator no board signal.

**Migration-aware design call (the crux).** The original DONE-CARD-2 spec listed "non-empty worker log" as a signal — but
in the native `mc_store` the worker log is **synthesized from the event timeline** (`task_log` :814), so every task (having
≥1 `created` event) has a non-empty log; using it would light EVERY card (degenerate). Deliberately **excluded** (documented
in the helper). Also confirmed the live board has NO done task with a real `latest_summary`/run summary either (the old
`t_f76cf250` 461-char summary was Hermes-era data, not migrated into the native store) — so the signal that actually fires
here is the **non-empty workspace dir**, the DELIV-4/iter #10 case. Bare `workspace_path` stays excluded (iter #10/#12: set
on ~every task even when empty); we require the dir to contain a real (non-hidden) entry.

**Fix (front + store + seam, 3 files).** (1) **Store** `mc_store.py` — new `@staticmethod _has_deliverable(task, runs)`:
`result` OR `branch_name` OR any non-empty run `summary` (= a non-empty `latest_summary`, from in-memory meta — no fetch)
OR a workspace dir with ≥1 non-hidden entry (`os.scandir` early-exit, OSError-safe); added `import os`. `list_tasks()` now
loads `meta["runs"]` once and stamps `has_deliverable` on each task (computed on the freshly-read list, never persisted).
(2) **Client** `api.ts` — `McTask` gains optional `has_deliverable?: boolean`. (3) **UI** `OperationsCenter.tsx` —
`hasDeliverable()` ORs `t.has_deliverable` in (raw `result`/`branch` kept as a fallback for pre-flag payloads); comment
rewritten. No new endpoint, no new component, no per-card fetch.

**Verify.** `npm run build` ✓ (tsc + vite, 155 modules, 712ms). `npx eslint src/pages/OperationsCenter.tsx src/lib/api.ts`
✓ ("No issues found"). `python -c ast.parse` on `mc_store.py` ✓. **Standalone unit test of `_has_deliverable`** (9 cases) ✓:
result/branch/run-summary → true; whitespace-only summary, all-empty, missing dir, empty dir, hidden-only dir → false; real
file → true. **LIVE-VERIFIED on the REAL board (read-only, zero mutation):** instantiated a fresh `MCStore(.)` over the live
data files — new `list_tasks()` lights **exactly 7/10** done tasks (the 7 with a workspace deliverable file) and leaves the
**3 empty-workspace** done tasks dark, matching the workspace-file probe 1:1 (iter #12's `result`/branch check would light
0/10). **End-to-end over HTTP:** started a throwaway bridge on **:8799** (new code, env `BRIDGE_PORT=8799`, reads the same
data files read-only) — `GET /api/mc/tasks` **served `has_deliverable` on all tasks, 7 done LIT / 3 DARK**, identical to the
in-process result. The operator's **:8767 left untouched** throughout (re-confirmed 200, 26 tasks, still old code without the
field); :8799 killed, temp log removed. **Layer relied on reasoning (not pixels):** the actual rendering of the 7 ◆ dots
through a Vite preview pointed at :8799 — the render gate (`col.key==='done' && hasDeliverable(t)` → emerald ◆) is
byte-for-byte the same path iter #12 already live-verified; iter #13 only widened the predicate to honor the now-proven
server boolean, so the 7 served-true done tasks will render the dot. Added patch note `iter-13-done-card-2-server-deliverable`
(deliverable, medium). Ran `graphify update .` (1436 nodes / 2741 edges / 70 communities). NB: the topbar `● BRIDGE :8767`
label (LABEL-1) misled again — read `:8767` while the throwaway bridge ran on :8799; promoted to the next run's top target.

**Files touched:** `mc_store.py`, `src/lib/api.ts`, `src/pages/OperationsCenter.tsx`, `.hermes/patch-notes.json`,
`.hermes/BUGHUNT_LOG.md` (this entry). No commit/push (loop rules; working tree carries unrelated `mission-control-evolve`
+ Hermes→Claude rename churn — left intact).

### 2026-06-14 — Iteration #12 (focus: DONE-CARD — board done cards show a "has deliverable" ◆; FIXED — LIVE-VERIFIED both cases)

**Audited.** The top-priority queued item DONE-CARD, the last functional item in the deliverable/lifecycle track (only the
cosmetic LABEL-1 remained besides it). Scoped via /graphify (`query "OperationsCenter board done column card render result
latest_summary workspace_path branch_name has deliverable indicator"`, BFS depth 2, 117 nodes), then read the board card
render (`OperationsCenter.tsx:228-250`) + the `McTask` list type (`api.ts:57-78`: `result`, `workspace_path`, `branch_name`
are all on the list payload).

**Bug/gap.** Board done cards gave **no signal** about which finished tasks actually produced a retrievable deliverable —
the operator had to open each one to find out. The board is mostly all-done (10 done tasks live), so this is real friction.

**Signal-quality investigation (the crux of this run).** Probed all 10 live done tasks via the bridge before coding:
`workspace_path` is set on **10/10** (confirms iter #10 — it's set on virtually every task even when the workspace is
empty), while `result` and `branch_name` are empty on **0/10... i.e. set on 0/10**. So: using `workspace_path` would light
EVERY done card and carry zero signal (rejected); `result`/`branch_name` give zero false positives and are the canonical
deliverable fields (`task.result` is THE deliverable per the deliverable-flow map). Also confirmed the deeper limitation:
the agent-written summary lives in `latest_summary` (a computed `TaskDetail`-only field, NOT on the list) and raw output in
the worker log — neither is reachable on the board without a per-card fetch (which the task forbids). So the board dot is
the canonical `result`/`branch` cue; the `latest_summary`/worker-log-only case is recorded as the new **DONE-CARD-2** target
(needs a server-computed `has_deliverable` on the list projection).

**Fix (`src/pages/OperationsCenter.tsx`, one file, 2 edits).** (1) New pure helper `hasDeliverable(t: McTask)` =
`Boolean(t.result?.trim() || t.branch_name?.trim())` with a comment documenting why `workspace_path` is excluded. (2) A
small emerald `◆` marker in the done-card footer right-group, gated `col.key === 'done' && hasDeliverable(t)`, title
"Deliverable available — open to view the result/branch". No per-card fetch (reuses board data), no new component, no
backend.

**Verify.** `npm run build` ✓ (tsc + vite, 155 modules, 756ms). `npx eslint src/pages/OperationsCenter.tsx` ✓ ("No issues
found"). Standalone Node logic check of `hasDeliverable` ✓ (6 cases: result→true, branch→true, whitespace→false,
workspace_path-only→false, empty-strings→false, undefined→false). **LIVE end-to-end, BOTH cases (bridge up at :8767, 26
tasks / 10 done), via Chrome MCP at the dev server (started on :3001), zero bridge mutation:** (a) **Negative** — board
rendered, **0** `◆` markers on the 10 deliverable-less done cards (matches the API probe: result/branch empty on all 10) —
no false positives, no crash, zero console errors. (b) **Positive** — dynamic-imported the same store module
(`import('/src/stores/useTaskStore.ts')`) and client-only `setState` to put a `result` on one done task (`t_3a3b4d01`, no
bridge write) → exactly **1** `◆` appeared, **on that card** (`cardHasMarker:true`, `markerText:["◆"]`); restoring the
state cleared it back to 0; a final real `fetchTasks()` re-confirmed 0 (board untouched throughout). Full-board screenshot
captured (zoom timed out — the documented WebGL-orb rasterizer stall, iter #4/#10 — DOM proof is conclusive). Bridge :8767
re-confirmed HTTP 200 at the end; dev server on :3001 killed; temp log removed. Added patch note
`iter-12-done-card-deliverable-dot` (deliverable, medium). Ran `graphify update .` (1433 nodes / 2735 edges / 79
communities). NB: the topbar `● BRIDGE :8767` label (LABEL-1) again misled mid-run — read "8767" while the app was on 3001.

**Files touched:** `src/pages/OperationsCenter.tsx`, `.hermes/patch-notes.json`, `.hermes/BUGHUNT_LOG.md` (this entry). No
commit/push (loop rules; working tree carries unrelated `mission-control-evolve` + Hermes→Claude rename churn — left
intact).

### 2026-06-14 — Iteration #11 (focus: LIFE-1 — drawer actions swallow errors; FIXED [front + store] — LIVE-VERIFIED)

**Audited.** The top-priority queued item LIFE-1, the last open deliverable/lifecycle thread besides DONE-CARD/LABEL-1.
Scoped via /graphify (`query "TaskDetailDrawer act lifecycle verb claim complete block error handling store action
boolean return"`), then read the full chain: `TaskDetailDrawer.tsx` `act()` + every `Btn` that calls it →
`useTaskStore.ts` action signatures (all `=> Promise<boolean>`) + the `mutate()` helper (`:137-149`) → `api.ts`
`errMessage`/`bridgeDetail`.

**Bug/gap.** `act()` (`:167-172`) did `setBusy(key); await fn(); await load(); setBusy(null);` — **no try/catch and it
discarded the boolean** that every store verb returns. `mutate()` catches all errors internally (never throws), stashes
the reason in the store's `error`, and returns `false`. So a failed verb (claim/complete/block/promote/reassign/comment/
link/schedule/unblock/archive/edit/unlink) just silently reloaded the drawer with **no operator-visible reason** — the
button looked like it did nothing. **Confirmed not-latent:** `useTaskStore.error` is read by only ONE surface in the whole
app (`WorkflowBuilder.tsx:36`) — never by Operations Center / the drawer — so a drawer verb failure was genuinely
invisible. Verified the bridge does carry a reason: a rejected verb returns `{"detail":"task '…' not found"}` (curl, 404,
no mutation), but `mutate()` was throwing that away by storing axios's generic `errMessage` instead of the `detail`.

**Fix (2 files).** (1) `TaskDetailDrawer.tsx` — new `actError` state; `act()` rewritten with try/catch/finally: checks the
returned `ok`, on `false` sets `actError = useTaskStore.getState().error || \`${key} failed\``, catch covers any throw from
the callback bodies (e.g. `archive`'s `if(ok)onClose()`), finally always clears `busy`; rendered a dismissible red banner
(`border-red-400/40 bg-red-400/[0.06]`, ⚠ + ✕) directly under the ACTIONS grid (after the reason input). (2)
`useTaskStore.ts` — `mutate()`'s catch now stores `bridgeDetail(err)` (imported alongside the still-used `errMessage`)
instead of `errMessage(err)`, so the surfaced reason is the bridge's real FastAPI `detail` / run_mc CLI stderr, not
"Request failed with status code N". This strictly upgrades WorkflowBuilder's error display too. No backend, no new
endpoint.

**Verify.** `npm run build` ✓ (tsc + vite, 155 modules, 690ms). `npx eslint src/components/TaskDetailDrawer.tsx
src/stores/useTaskStore.ts` ✓ ("No issues found"). **LIVE end-to-end (bridge up at :8767, 26 tasks: 8 todo/1 running/6
blocked/10 done/1 triage):** Vite :5219 → Operations → opened real todo task `t_133b08ed`'s drawer (PROMOTE/SCHEDULE/
BLOCK/ARCHIVE shown). To exercise the failure path **without mutating the operator's real board** (the store has no
state-guards — a real promote would succeed), dynamic-imported the same store module in page context
(`import('/src/stores/useTaskStore.ts')`), monkeypatched `promoteTask` to resolve `false` + set `error` exactly like a
real reject, clicked PROMOTE → the red error line rendered **"⚠ task 't_xxx' is not ready (simulated bridge reject)"** with
the exact banner classes; the ✕ dismissed it; restored the original `promoteTask`. Board confirmed **unchanged** before,
during, and after (todo:8/running:1/done:10/blocked:6/triage:1 throughout — zero real mutations). Zero console errors.
Added patch note `iter-11-life-1-action-errors` (lifecycle, medium). Ran `graphify update .` (1560 nodes / 2759 edges /
161 communities).

**Files touched:** `src/components/TaskDetailDrawer.tsx`, `src/stores/useTaskStore.ts`, `.hermes/patch-notes.json`,
`.hermes/BUGHUNT_LOG.md` (this entry). No commit/push (loop rules; working tree carries unrelated `mission-control-evolve`
+ Hermes→Claude rename churn — left intact).

### 2026-06-14 — Iteration #10 (focus: DELIV-4 slice b — workspace not browsable; FIXED [front+back+seam] — DELIV-4 FULLY DONE)

**Audited.** The top-priority queued item DELIV-4 slice b. Scoped via /graphify (`query "hermes-bridge
workspace_path branch_name git diff endpoint TaskDetailDrawer ARTIFACTS api.ts getHermesTask"`, BFS depth 2, 87 nodes),
then read the full chain: `TaskDetailDrawer.tsx` ARTIFACTS section + `Artifact()`/`Section()` → `api.ts` helper pattern
(`getHermesTaskLog`/`getHermesTaskContext`) + axios `bridge` (baseURL `VITE_BRIDGE_URL || :8767`) → `hermes-bridge.py`
route patterns (`run_hermes` shells the CLI; `show_task` = `kanban show --json`; `task_log`/`task_context`).

**Bug/gap.** iter #9 surfaced the workspace *path* (copyable) but the deliverable still wasn't *browsable* — no endpoint
listed the workspace files or showed their content, so a file a task wrote had no in-app home. **Confirmed live, not
latent:** probed all 61 live tasks — every one has a `workspace_path` under `…/hermes/kanban/workspaces/t_<id>`; most are
empty but several hold real deliverable files (e.g. `t_26d8eb11/competitor_analysis.md`, **12 292 bytes** of finished
analysis) that were 100% invisible in the dashboard. None of the live workspaces are git repos, so the highest-value slice
here is a **file browser + inline file reader**, not a branch diff (git log/diff --stat still surfaced when a workspace
*is* a repo, for future-proofing).

**Fix (front + back + seam, 3 files).** (1) **Backend** `hermes-bridge.py` — new read-only `GET
/api/hermes/tasks/{id}/workspace`: without `?file` returns a shallow (top-level) listing (dirs-first, `name`/`rel`/
`is_dir`/`size`, capped 300) + git `log`/`diffstat` when the dir is a repo; with `?file=<rel>` returns that file's text
(capped 256 KB, binary-detected via NUL byte). **Hard guards:** the workspace path is taken from Hermes (`kanban show`),
**never the client**; a `?file` read is `(ws_root/file).resolve()`-confined inside the workspace (`ws_root in
target.parents`) → path-traversal/absolute/encoded escapes all 403; git runs read-only via list-form `subprocess` (no
shell, branch validated against `_BRANCH_RE`); missing path/empty dir degrade to a friendly note, never a crash. Added
`_git_ro()` helper. (2) **Client** `api.ts` — `getHermesTaskWorkspace`/`getHermesTaskWorkspaceFile` + `TaskWorkspace`/
`WorkspaceEntry`/`TaskWorkspaceFile` types. (3) **UI** `TaskDetailDrawer.tsx` — a `⊞ BROWSE FILES` toggle in the ARTIFACTS
section reveals a new self-contained `WorkspaceBrowser` (fetch-on-mount like `<WorkerLogStream/>`): file rows (📄 click →
inline `<pre>` of the content; 📁 dirs shown, not yet drilled), human size via `fmtBytes`, git COMMITS/UNCOMMITTED-CHANGES
blocks when present, friendly note when empty. This closes DELIV-4.

**Verify.** `npm run build` ✓ (tsc + vite, 155 modules, 829ms). `npx eslint src/components/TaskDetailDrawer.tsx
src/lib/api.ts` ✓ ("No issues found" — fixed one self-introduced `react-hooks/set-state-in-effect` by dropping a
redundant synchronous `setLoading(true)`; initial state is already true). `python -c ast.parse` on the bridge ✓.
**FULL end-to-end live verification** without touching the operator's running bridge: started a **throwaway 2nd bridge on
:8799** (new code) and pointed a **2nd Vite preview (:5220) at it via a gitignored `.env.local`** (the operator's :5219 +
:8767 left untouched throughout — re-confirmed :8767 still 200 at the end). Backend, via curl to :8799: `t_26d8eb11`
listing returns `competitor_analysis.md` (12292 B); `?file=` returns the real markdown content; empty workspace
(`t_00adc31a`) → "Workspace is empty" note; **security:** `../../…/etc/hosts` → 403, `..%2f..%2f` encoded → 403, absolute
`C:/Windows/win.ini` → 403, missing file → 404, unknown task → graceful "no workspace" note. **UI, driven in the :5220
preview:** clicked the real `t_26d8eb11` card → drawer opened (header `t_26d8eb11`), ARTIFACTS + BROWSE FILES present;
clicked BROWSE FILES → file row `competitor_analysis.md` + size **12.0KB** rendered (no "could not read"); clicked the file
→ its content rendered inline in a `<pre>` ("# Instagram Competitor Analysis…"). Zero console errors. (Screenshot tool
timed out — the known WebGL-orb rasterizer stall, see iter #4 — DOM proof is conclusive.) Note: the topbar `● BRIDGE
:8767` label is **hardcoded text** in `Layout.tsx:203`, not derived from the bridge URL — it misled mid-run (read it as
"still on 8767" when the app was actually on 8799); flagged below as a tiny cosmetic gap. Teardown: stopped :5220 preview,
killed :8799, removed `.env.local`, reverted the temp `vite-newbridge` launch.json config (all confirmed clean via `git
status`). Added patch note `iter-10-deliv-4-workspace-browser` (deliverable, medium). Ran `graphify update .` (1434 nodes
/ 2395 edges / 165 communities).

**Files touched:** `hermes-bridge.py`, `src/lib/api.ts`, `src/components/TaskDetailDrawer.tsx`, `.hermes/patch-notes.json`,
`.hermes/BUGHUNT_LOG.md` (this entry). No commit/push (loop rules; working tree carries unrelated `mission-control-evolve`
churn — left intact).

### 2026-06-14 — Iteration #9 (focus: DELIV-4 slice a — file/branch artifacts not viewable; FIXED [display slice])

**Audited.** The top-priority queued item DELIV-4. Scoped via /graphify (`query "TaskDetailDrawer workspace_path
branch_name meta grid render copy"`, BFS depth 2, 76 nodes), then read the full chain: `TaskDetailDrawer.tsx` meta-grid
render (:205-214) + `Meta()` component (:397) → `HermesTask` type in `api.ts` (`workspace_kind: string` :65,
`workspace_path: string|null` :66, `branch_name: string|null` :67).

**Bug/gap.** When a task's deliverable is a set of files or a git branch, the operator had no retrievable home for it.
`t.workspace_path` (the actual filesystem location of the work) was **never rendered anywhere** in the drawer — the
"WORKSPACE" meta cell showed `workspace_kind` ("git"/"local"), not the path. `t.branch_name` was shown only as a bare
`Meta k="BRANCH"` cell (:213) that **truncates** (`truncate` class) and **can't be copied**. So a file/branch
deliverable couldn't be located or checked out from the dashboard — a lost (well, hidden) deliverable.

**Fix (`src/components/TaskDetailDrawer.tsx`, one file, 2 edits).** (1) Added an **ARTIFACTS** `Section` (rendered only
when `t.workspace_path || t.branch_name`) after the meta grid, with copyable `WORKSPACE PATH` + `BRANCH` rows via a new
`Artifact` component — full value shown untruncated (`break-all` so a long path wraps instead of overflowing the 460px
drawer), and a `⧉ COPY` button (`navigator.clipboard.writeText` + a 1.2s `✓ COPIED` tick). (2) Removed the now-redundant
truncated `Meta k="BRANCH"` cell from the meta grid (avoids duplication; branch lives in ARTIFACTS, copyable). No new
endpoints, no backend change. Reused the existing `Section`. This is DELIV-4 **slice a (display)**; slice b (a read-only
bridge endpoint to list workspace files / show a branch diff) is recorded as the next target.

**Verify.** `npm run build` ✓ (tsc + vite, 155 modules, 590ms — TS narrows `workspace_path`/`branch_name` from
`string|null` to `string` inside each `&&` guard, clean). `npx eslint src/components/TaskDetailDrawer.tsx` ✓ ("No issues
found"). **Bridge DOWN this run** (`localhost:8767` actively refused — `WinError 10061`; not started, per loop rules /
quota-burn risk), so the drawer can't be populated with a real task (it fetches detail from the bridge). Partial live
verification done in the Vite preview (:5219) instead: app loads with the change compiled in, zero NEW console errors
(only the documented baseline bridge-down `fetchTasks/fetchTopology/fetchStats` Network Errors — none from
`TaskDetailDrawer`/`Artifact`); and the two bridge-independent dependencies of the new UI were DOM-probed and confirmed —
`navigator.clipboard.writeText` is available (COPY will work) and `.break-all` resolves to `word-break: break-all` (long
paths wrap, won't overflow). The conditional render + copy logic is otherwise proven by build + lint + reasoning. **Not
live-verified:** a populated ARTIFACTS section on a real task with a `workspace_path`/`branch_name` (needs the bridge up
+ such a task) — a future run with the bridge up should click a task that has a workspace/branch and confirm the section
renders both copyable rows. Added patch note `iter-9-deliv-4-artifacts` (category deliverable, medium). Ran `graphify
update .`.

**Files touched:** `src/components/TaskDetailDrawer.tsx`, `.hermes/patch-notes.json`, `.hermes/BUGHUNT_LOG.md` (this
entry). No commit/push (loop rules; working tree carries unrelated `mission-control-evolve` churn — left intact).

### 2026-06-14 — Iteration #8 (focus: DELIV-3 — empty-result `done` = zero-visibility; FIXED + LIVE-VERIFIED)

**Audited.** The top-priority queued item DELIV-3. Scoped via /graphify (`query "TaskDetailDrawer RESULT section
latest_summary result worker log fetch render done task"`, BFS depth 2, 83 nodes), then read the full chain:
`TaskDetailDrawer.tsx` RESULT/SUMMARY render (:207) → `WorkerLogStream.tsx` (how the drawer already fetches the worker
log via `getHermesTaskLog`) → `TaskDetail`/`HermesTask` types in `api.ts` (`latest_summary: string|null`, `result:
string|null`).

**Bug/gap.** The RESULT/SUMMARY section rendered `{(detail.latest_summary || t.result) && <Section>…}` — when BOTH
were empty/whitespace on a `done`/`completed` task the section vanished entirely, so the task's only output (the raw
worker log) was invisible unless the operator knew to scroll down and click "LOAD WORKER LOG". **Confirmed live, not
latent:** probing all 31 done tasks on the live board found **6** with both `latest_summary` AND `result` empty
(`t_ac3acb98`, `t_db3e97f0`, `t_34d9de94`, `t_f2f41469`, `t_a33fad25`, `t_9b58127d`) — each had a non-empty worker log
(e.g. `t_ac3acb98` = 3894 bytes). These six were genuinely zero-visibility before this fix.

**Fix (`src/components/TaskDetailDrawer.tsx`, one file, 4 edits).** (1) imported `getHermesTaskLog`; (2) added
`rawOutput` state; (3) in `load()`, for a done/completed task with both summary+result empty, fetch the worker-log
tail via the existing `getHermesTaskLog(taskId, 4000)` (no new endpoint, same one `<WorkerLogStream/>` uses) into
`rawOutput`; (4) the RESULT section now falls through `latest_summary||result ? <Section> : (done&&rawOutput) ?
<RAW OUTPUT Section> : null` — the fallback shows a **"RESULT / SUMMARY · RAW OUTPUT"** header, a "no summary was
written — showing the tail of the worker log" note, and a `<pre>` worker-log tail. The normal summary path is
byte-for-byte unchanged. No new components.

**Verify.** `npm run build` ✓ (tsc + vite, 155 modules, 645ms). `npx eslint src/components/TaskDetailDrawer.tsx` ✓
("No issues found"). **Live preview ✓ (bridge up at :8767, `/kanban/stats` 200):** Vite on :5219 (HashRouter →
`#/operations`). Clicked the real card `t_ac3acb98` (both-empty done) → drawer rendered **RESULT / SUMMARY · RAW
OUTPUT** with the fallback note and a `<pre>` of **3554 chars** of worker-log tail (previously this section was
absent). Clicked `t_f76cf250` (has a 461-char `latest_summary`) → drawer showed the **plain** RESULT/SUMMARY with the
real summary text ("DA Agency LLC full brand recon completed…") and **no** RAW OUTPUT fallback — normal path intact.
Zero console errors. This is the first deliverable-thread fix confirmed on a live populated edge case. Added patch note
`iter-8-deliv-3-raw-output` (category deliverable, medium). Ran `graphify update .` (1418 nodes / 2369 edges / 158
communities).

**Files touched:** `src/components/TaskDetailDrawer.tsx`, `.hermes/patch-notes.json`, `.hermes/BUGHUNT_LOG.md` (this
entry). No commit/push (loop rules; working tree carries unrelated `mission-control-evolve` churn — left intact).

### 2026-06-13 — Iteration #7 (focus: DELIV-2 slice b — FAILED column / BLOCKED-chip gap; FIXED — DELIV-2 fully closed)

**Audited.** The top-priority queued item: DELIV-2 slice (b), the last piece of DELIV-2. Scoped via /graphify
(`query "OperationsCenter colOf column rendering failed blocked status chip stats by_status"`, BFS depth 2, 59 nodes),
then read the full chain: `src/pages/OperationsCenter.tsx` `COLUMNS`/`colOf`/`byColumn`/header chips/column render →
`KanbanStats.by_status` (`Record<string,number>`, so `by_status.failed` is a safe access) and `TaskSummary` in
`useTaskStore.ts` (`failed` and `blocked` are computed disjointly at L129/L131).

**Bug/gap.** `colOf` folded `failed → blocked` (`OperationsCenter.tsx:31`), so failed tasks were dumped into the
BLOCKED column with no way to tell a genuine failure from a task waiting on a dependency. Worse, the BLOCKED header
chip (`:187`) read `stats.by_status.blocked ?? summary.blocked` — which EXCLUDES failed — so the header count and the
column contents diverged (failed cards in the column, not in its count). There was no FAILED column and no FAILED chip
anywhere. A failed task is a distinct lifecycle dead-end and was invisible as such.

**Fix (`src/pages/OperationsCenter.tsx`, one file, 3 edits).** (1) Added a dedicated FAILED column to `COLUMNS` (:24)
after BLOCKED, tone `#b91c1c` (deep red, distinct from BLOCKED `#ef4444`). (2) Removed the `failed → blocked` line
from `colOf` (:31) so `failed` now falls through the existing `COLUMNS.some(...)` branch to its own column. (3) Added
a header **FAILED chip** (:188) reading `stats?.by_status?.failed ?? summary?.failed ?? 0` (red-500), leaving the
BLOCKED chip blocked-only (red-400). Net: BLOCKED column == BLOCKED chip, FAILED column == FAILED chip — fully
reconciled — and failed is now visually + structurally distinct from blocked. No new components. This also closes the
old Next-Target #3 (BLOCKED column/chip mismatch).

**Verify.** `npm run build` ✓ (tsc + vite, 155 modules, 662ms). `npx eslint src/pages/OperationsCenter.tsx` ✓ ("No
issues found"). **Live preview ✓ (bridge up at :8767, `/kanban/stats` HTTP 200):** Vite on :5219 → clicked OPERATIONS
nav → MISSION KANBAN mounted. DOM-verified all **9 columns** render in order (TRIAGE/TODO/READY/RUNNING/REVIEW/BLOCKED/
**FAILED**/SCHEDULED/DONE) with FAILED at computed `rgb(185,28,28)` (= #b91c1c) vs BLOCKED `rgb(239,68,68)` (= #ef4444);
**FAILED chip** present reading `0` in red-500 (`oklch(0.637 0.237 25.331)`). Zero console errors.
**Could NOT live-populate the FAILED column** — the live board is currently all-`done` (`by_status: {done:31}`, no
blocked/failed/ready tasks), so the column + chip were proven by structure + the verified `stats.by_status.failed` data
path, not by a populated failed card (same caveat as iter #6's reason banner). Added patch note `iter-7-failed-column`
(category lifecycle, high). Ran `graphify update .` (1415 nodes / 2365 edges / 167 communities).

**Files touched:** `src/pages/OperationsCenter.tsx`, `.hermes/patch-notes.json`, `.hermes/BUGHUNT_LOG.md` (this
entry). No commit/push (loop rules; working tree carries unrelated `mission-control-evolve` churn — left intact).

### 2026-06-13 — Iteration #6 (focus: DELIV-2 slice a — block/fail reason never shown; FIXED)

**Audited.** The top-priority Systemic Thread DELIV-2 (the *why* of a stuck task is invisible). Scoped via /graphify
(`query "TaskDetailDrawer event timeline block fail reason rendering"`, BFS depth 2, 73 nodes), then read the full chain:
`TaskDetailDrawer.tsx` event timeline → `TaskEvent`/`TaskDetail` types in `api.ts` → `hermes-bridge.py` `GET
/api/hermes/tasks/{id}` (L653-657, pass-through of `hermes kanban show --json`) → `HermesTask` (no block_reason field).

**Bug/gap.** A blocked/failed task's reason is persisted ONLY inside event payloads (`payload.reason`/`message`/`error`),
never on the task. The drawer's EVENT TIMELINE (`TaskDetailDrawer.tsx:284-294`) rendered only `e.kind` and
`e.payload?.status`, dropping the reason entirely — so the real "output" of a blocked/failed task (why it stalled) was
invisible everywhere in the dashboard. **Confirmed against live data:** probed real Hermes payloads across 12 tasks —
`t_4b8bab28` carries a `blocked` event with `payload.reason = "web-access-tools-missing: No callable web search…"`, and
the full set of payload keys in the wild includes `reason`, `message`, `error`, `note` (all covered by the fix).

**Fix (`src/components/TaskDetailDrawer.tsx`, one file).** Added `eventDetail(payload)` helper (DETAIL_KEYS =
reason/message/error/detail/note, type-safe over `Record<string,unknown>|null`). Used it twice: (1) a prominent
**BLOCKED/FAILED · REASON banner** at the top of the drawer (only when `status` is blocked|failed; pulls the latest
matching block/fail event payload via `blockFailReason`, amber for blocked / red for failed, matching `STATUS_TONE`);
(2) a **detail line under every EVENT TIMELINE row** (`ml-2 border-l border-white/10 pl-2`, matching the body-quote
style). No new components; reused the existing drawer.

**Verify.** `npm run build` ✓ (tsc + vite, 155 modules, 649ms). `npx eslint src/components/TaskDetailDrawer.tsx` ✓
("No issues found"). **Live preview ✓ (bridge up at :8767):** Vite on :5219 → Operations → opened `t_4b8bab28`'s drawer
→ EVENT TIMELINE now contains a detail `<div>` with the exact new class
(`text-[#cdd3df] ml-2 mt-0.5 border-l border-white/10 pl-2 whitespace-pre-wrap leading-snug`) rendering
"web-access-tools-missing: …" — the block reason, previously absent from the timeline. Zero console errors.
**Could NOT live-verify the top banner** — no task is currently in blocked/failed status (BLOCKED 0 on the board), so the
banner branch was proven by build + the shared, live-verified `eventDetail` + event-payload path (same data, gated on
status), not by a live blocked card. Added patch note `iter-6-deliv-2-reason` (category deliverable, high). Ran
`graphify update .`.

**Files touched:** `src/components/TaskDetailDrawer.tsx`, `.hermes/patch-notes.json`, `.hermes/BUGHUNT_LOG.md` (this
entry). No commit/push (loop rules; working tree carries unrelated `mission-control-evolve` churn — left intact).

### 2026-06-13 — Iteration #5 (operator-requested feature: PATCH NOTES panel in Settings)

**Not a routine bug-hunt run — an operator request** distilled into a shipped feature, recorded here so the loop
stays consistent. The operator wanted to SEE what this routine fixes, from inside the dashboard settings, with the
routine writing a short summary each run. Built the full path:
- **Data:** `.hermes/patch-notes.json` (`{"notes":[...]}`, newest-first) — the routine appends one entry per shipped fix.
- **Backend:** `hermes-bridge.py` new `GET /api/hermes/patch-notes` (reads the file relative to `__file__`, sorts
  newest-first by (date, iteration), never raises — missing/malformed file → empty list). `PATCH_NOTES_FILE` const.
- **Client:** `src/lib/api.ts` `PatchNote` interface + `getPatchNotes()`.
- **UI:** `src/components/PatchNotes.tsx` — a modal (matches the BridgeDiagnostics shell) with color-coded category
  badges, severity, `date · run #N`, title, jargon-free summary, file chips; loading/empty/error states. Opened from a
  new **PATCH NOTES** button inside the topbar **⚙ UI** settings popover (`src/components/Layout.tsx`).
- Seeded `patch-notes.json` with iter #1 (QUEUE), iter #4 (Content Factory deliverables), iter #5 (this feature).

**Verify.** `npm run build` ✓ (tsc + vite, green); `npm run lint` ✓ (no new issues in touched files); `patch-notes.json`
JSON-valid + `hermes-bridge.py` AST-parses (python check). **Live preview verified** (Vite on :5219 + a real
`hermes-bridge.py` started on :8767): `GET /api/hermes/patch-notes` returned both seeded notes; drove the UI (clicked
⚙ UI → PATCH NOTES) and the modal rendered both entries with correct category badges (DELIVERABLE/BUG FIX), titles,
summaries, and file chips (screenshot confirmed); no PatchNotes console errors (only the documented baseline
background bridge-poll Network Errors). The routine prompt was updated to write a patch note each run (new step 6).
Next routine run is **#6 → DELIV-2**.

### 2026-06-13 — Iteration #4 (focus: DELIV-1 — Content Factory deliverables unreachable; FIXED)

**Audited.** The #1 Systemic Thread (DELIV-1): the clearest "deliverables being lost" surface. Scoped via graphify
(`query` on the ContentCampaign/ContentDraft↔TaskDetailDrawer relationship), then read the full chain:
`src/pages/ContentFactory.tsx` cards → `src/stores/useContentStore.ts` → `src/lib/api.ts` content types →
`hermes-bridge.py` `get_content_pipeline` (L1321-1414) → how `OperationsCenter.tsx` already mounts `TaskDetailDrawer`.

**Bug/gap.** A content task that finishes flips its Factory card to `done`, but the campaign cards
(`ContentFactory.tsx` ~L457) and draft rows (~L489) were non-interactive `<div>`s — there was **no path from the
Content Factory to the task's deliverable** (`result`/`latest_summary`/`runs[].summary`/worker log). Those outputs
were persisted by the backend and rendered only by `TaskDetailDrawer`, reachable solely from the Operations Center
board. From the operator's content surface, finished work was invisible — a lost deliverable.

**Fix (`src/pages/ContentFactory.tsx`).** Confirmed first that a card's `id` IS the kanban task id in BOTH paths
(bridge `get_content_pipeline` sets `"id": task_id` at hermes-bridge.py:1364/1375; client fallback maps `id: t.id` in
useContentStore.ts), so the existing drawer resolves them directly. Then, reusing `TaskDetailDrawer` (no new surface):
imported `TaskDetailDrawer` + `useGhostStore`; added `openTaskId` state and `profiles` (live ghost agents ∪ campaign
assignees) / `allTasks` (`campaigns.map(id,title)`) memos mirroring OperationsCenter's wiring; converted campaign
cards and draft rows from `<div>` to clickable `<button type="button" onClick={() => setOpenTaskId(id)}>` (kept all
existing styling + CornerBrackets, added a selected-border + hover affordance + tooltip); mounted
`<TaskDetailDrawer key={openTaskId} … />` at the page root. All edits are in one file.

**Verify.** `npm run build` ✓ (tsc + vite, 154 modules, 611ms). `npx eslint src/pages/ContentFactory.tsx` ✓ ("No
issues found"). **Live preview ✓ (bridge up at :8767, returned HTTP 200):** Vite on :5219 → Content Factory →
ACTIVE CAMPAIGNS rendered **21 clickable cards**; clicked a DONE card (`t_f76cf250` "Research DA Agency LLC brand
and services") → the right-anchored `TaskDetailDrawer` opened showing **RESULT/SUMMARY, RUNS, WORKER LOG, COMMENTS,
DEPENDENCIES**, with the real deliverable text ("DA Agency LLC full brand recon completed…"). Zero console errors.
(Screenshot tool timed out — the background WebGL orb stalls the rasterizer — so proof is DOM-level, which is
conclusive here.) Ran `graphify update .` (1400 nodes / 2344 edges / 170 communities).

**Files touched:** `src/pages/ContentFactory.tsx`, `.hermes/BUGHUNT_LOG.md` (this entry). No commit/push (loop rules;
working tree carries unrelated `mission-control-evolve` churn — left intact).

### 2026-06-13 — Iteration #3 (focus: deliverable-flow investigation; no code fix — seeded Systemic Threads)

**Triggered by the operator's directive:** broaden the loop to catch ALL bug classes (logic / visual / coding /
misconfiguration) across frontend + bridge backend + the seams, and specifically watch the kanban
(delegation / completion / blocked) AND answer "tasks are supposed to output a deliverable — where do they go,
are they being lost?". Ran a read-only end-to-end trace of the deliverable flow (no files changed).

**Deliverable flow map:** created → delegated (assignee/reassign) → running (worker writes live to
`kanban/logs/<id>`) → completed (agent writes deliverable into `task.result` + run `summary`=`latest_summary`;
maybe `workspace_path`/`branch_name`). Output LIVES correctly in the kanban store + log file. Output is SHOWN
only in `TaskDetailDrawer` (Operations Center → click card → drawer): RESULT/SUMMARY (`latest_summary || result`),
RUNS (`runs[].summary`), live WORKER LOG. **Conclusion: deliverables are persisted, NOT lost at the backend —
but they are hidden/unreachable at several UI surfaces.** Six concrete gaps recorded as **Systemic Threads**
(DELIV-1..4, LIFE-1, DONE-CARD) above; the worst is **DELIV-1** (Content Factory: finished content deliverables
have no path to their `result` at all). No build/lint (read-only). The scheduled routine prompt was upgraded
this run to the broader holistic mandate (all bug classes + lifecycle + deliverable-integrity each run).

### 2026-06-13 — Iteration #2 (focus: api.ts ↔ hermes-bridge.py contract audit; no code fix)

**No bug fixed — area cleared.** Audited the full client↔bridge request contract: read every task-mutation
route handler (`hermes-bridge.py` L600-859) and its Pydantic model (L150-300) against the corresponding
`src/lib/api.ts` caller. Every request-body key matches (comment `text`/`author`, edit `result`/`summary`/
`metadata`, block/unblock/schedule `reason`, promote `reason`/`force`, assign/reassign `profile`/`reclaim`/
`reason`, notify `platform`/`chat_id`/`thread_id`/`user_id`, link `parent_id`/`child_id`, create-task
`title`/`body`/`assignee`/`priority`/`skills`/`parents`/`triage`/`max_retries`, cron, boards, spawn, chat,
decompose `task`). **No mismatch bug exists** — area #3 is cleared; future runs should not re-audit it.
**Also resolved Next-Target #2 as NOT-a-bug:** `/api/hermes/activity` (L583-593) emits task lifecycle
timestamps verbatim in epoch **seconds**, so WarRoom's `new Date(a.timestamp * 1000)` is correct (GhostNetwork's
`norm()` is merely defensive). Marked it resolved above so it isn't mistakenly "fixed". No build/lint run
(read-only audit; no files changed). Scheduling was migrated this run from a session-only CronCreate job to a
durable local routine (`mission-control-bughunt`, cron `7 */2 * * *`, stored under `~/.claude/scheduled-tasks/`).

### 2026-06-13 — Iteration #1 (focus: stores + lib recon)

**Setup.** First run of the `mission-control-bughunt` loop (cron `0 */2 * * *`). Created this handoff file.
Confirmed baseline `npm run build` green (**154 modules**); baseline `npm run lint` carries **pre-existing**
issues only in the untracked `src/components/office/tower/*` inherited churn (`no-var`, unused vars) — not
this loop's deliverable, left untouched. Ran a read-only recon agent over `src/stores/*`, `src/lib/*`,
`src/pages/*`, `src/components/*`, cross-checking field usage against the `src/lib/api.ts` interfaces.

**Bug fixed — topbar QUEUE double-counts READY tasks (wrong-data, high confidence).**
`summarize()` in `src/stores/useTaskStore.ts:125` computed `pending` as `status === 'pending' || status === 'ready'`,
while `ready` was tallied separately at L127 — so every `ready` task was counted in **both** named buckets.
The `pending` field is consumed only by the topbar **QUEUE** indicator (`src/components/Layout.tsx:230`),
which therefore conflated two states behind a field named `pending`, making it untrustworthy for any future
consumer (WarRoom/ContentFactory/Operations all read `ready` as a *distinct* count). **Fix:** made the buckets
disjoint — `pending` is now strictly `is('pending')` (`useTaskStore.ts:125`, with an explanatory comment) —
and changed the topbar to show `summary.pending + summary.ready` (`Layout.tsx:230`) so the operator's visible
QUEUE number is **unchanged** (it already equalled pending+ready) while the underlying data model is now correct.

**Verify.** `npm run build` ✓ (tsc + vite, 154 modules); `npm run lint` ✓ for the two touched files
(`useTaskStore.ts`, `Layout.tsx` report **no** issues — only the pre-existing office/tower churn remains);
standalone Node logic check ✓ (`pending` disjoint = 2 not 5, `ready` = 3, `pending+ready` = old combined = 5,
`pending !== oldCombined`). **Not verified in Vite preview** — QUEUE is a pure function of live Hermes task
statuses (needs the bridge at `localhost:8767` + live tasks); the math is fully proven by tsc + the standalone
check, so a preview adds no signal this run. Ran `graphify update .` to keep the graph current.

**Files touched:** `src/stores/useTaskStore.ts` (L119-130), `src/components/Layout.tsx` (L230),
`.hermes/BUGHUNT_LOG.md` (this entry). No commit/push (per loop rules; working tree carries unrelated
`mission-control-evolve` churn — left intact).
