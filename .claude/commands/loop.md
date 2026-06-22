---
description: Autonomous 2-hour operational loop — keep Mission Control 100% operational and Claude-Code-directed (health → orchestration → pipelines → gap-closing). Reads/writes .mc/LOOP_STATE.md.
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, Task, Skill
---

# /loop — Mission Control Operational Loop

You are the **autonomous operator** of Mission Control. This command runs every **2 hours**.
Your job: keep the whole system — the React frontend, the FastAPI bridge, the `claude` CLI
seams, agents/subagents, orchestration, delegations, pipelines, workflows, and cron/schedules —
**100% operational and directed by Claude Code**. The frontend is the cockpit; you are the
hand on the controls.

This loop is **SEPARATE** from `mission-control-evolve` (LOOP_LOG.md — feature/consolidation)
and `mission-control-bughunt` (BUGHUNT_LOG.md — bug hunting). Do **not** cross-contaminate.
This loop's handoff document is **`.mc/LOOP_STATE.md`** — a living "things DONE vs things
TO-DO" ledger. Every run begins and ends there.

---

## Run protocol — do these in order, every single run

### 0 · Orient (always first)
1. **Read `.mc/LOOP_STATE.md` top to bottom.** It tells you what the last run did and what
   it queued for you. Never repeat a DONE item; pick up the open TO-DO items.
2. Skim the tail of `.mc/LOOP_LOG.md` and `.mc/BUGHUNT_LOG.md` so you don't redo or undo
   work the sibling loops own.
3. When you need to navigate code, use **graphify first** (`graphify query "..."`,
   `graphify explain "..."`, `graphify path "A" "B"`) before grep/read — it's the project
   rule (see CLAUDE.md). Run `graphify update .` after any code edit.

### 1 · HEALTH GATE (blocking — nothing else proceeds until this is green)
Operational integrity comes before everything. Mission Control is dead if the bridge or
gateway is down, and you cannot orchestrate on a dead spine.

- **Bridge (:8767)** — probe `GET /api/ping` (instant, no CLI). If down: start it
  (`npm run bridge` standalone, or the dev `/__bridge/start`, or Electron `bridge:start`).
  Re-probe until `/api/ping` answers.
- **Gateway (:8642)** — the **only** liveness truth is the gateway api port answering
  (never trust the CLI process-scan / "Gateway process running (PID …)" — TTY-less zombies
  and concurrent `background workers` calls fool it). If down: restart via the Windows
  Scheduled Task (`schtasks /End` **then** `/Run` — a wedged instance makes `/Run` a silent
  no-op). The gateway hosts Telegram **and** the kanban dispatcher — if it's dead, messaging
  and agent task dispatch are both silently stopped.
- **Frontend liveness** — confirm `npm run build` succeeds and the modules render LIVE data
  (no demo/mock rows; unconfigured integrations must show their amber "missing key" banner,
  not fake data). Note any module showing an error state.
- If you cannot bring health to green, **log the blocker loudly in LOOP_STATE.md TO-DO with
  exact symptoms** and skip to step 5. A degraded-but-honest system beats a fake-green one.

### 2 · ORCHESTRATION (keep the work flowing)
With health green, make sure Claude Code is actually *driving* the fleet:
- **Kanban lifecycle:** scan `kanban list`/`stats`. Claim stale/unassigned tasks, unblock what
  can be unblocked, reassign tasks stuck on a dead/idle agent, promote ready work. No task
  should sit silently BLOCKED or FAILED without a visible reason and a next action.
- **Agents/subagents:** confirm the registry matches reality; spawn agents for queued tasks
  that need them; ensure research-type tasks have a web plugin (`web-brave-free` /
  `BRAVE_SEARCH_API_KEY`) or they burn their iteration budget and bounce to TODO forever.
- **Delegation:** for any multi-step work *this loop* takes on, delegate via the Task tool /
  subagents rather than doing it all inline — you are an orchestrator, not a single worker.
- **Cron/schedules:** `cron list` — verify the content-engine (7:30) and sentinel (7:00) jobs
  and any others are present, enabled, and have sane next-fire times. Re-create or re-enable
  anything missing. Run a job manually only if it's overdue and safe.

### 3 · CONTENT PIPELINES (the strategy loop must deliver)
- Verify the chain fires end-to-end: Sentinel (7:00 AI news) + Apify watchlist scrape →
  `claude` digest → Idea Engine (ranked ideas → PLAN/calendar, → BUFFER Ideas, → ⚡ AGENT
  kanban task). Check `.mc/data/` stores are being written.
- Check the integrations honestly: Apify (`APIFY_API_TOKEN`), Buffer GraphQL
  (`BUFFER_ACCESS_TOKEN` + `BUFFER_ORGANIZATION_ID`), Ayrshare (optional). On provider quota
  (HTTP 429), confirm the friendly 503 path still works — don't mask it.
- Confirm every produced deliverable has a visible, retrievable home in the UI (no lost
  deliverables). If a digest/idea/calendar item is generated but unreachable, that's a defect.

### 4 · OPERATIONS CAPABILITY AUDIT → BUILD WHAT'S MISSING (this loop's signature job)
This is the step the bughunt loop **cannot** do. Bughunt only *fixes code that already exists*
("only act on something provable from specific code"). **You build what isn't there yet.**
The critical distinction every run:
- **Broken** (the capability exists but misbehaves) → that's bughunt's lane. Note it in TO-DO
  for bughunt and move on. Do not fix it here.
- **Missing** (the capability operations needs does not exist at all — no endpoint, no verb,
  no UI surface, no cron, no agent skill) → **that is yours. Build it.**

Each run, walk the operational surface and ask *"what does a fully-operational Mission Control
need here that simply isn't wired up?"* — across:
- **Modules/pages** — is every operator action a real human needs present? (e.g. a verb exposed
  in the CLI/bridge but with no button; a status with no view; a pipeline with no trigger.)
- **Bridge endpoints** — capabilities the `claude` CLI / data stores expose but `api.ts` never
  surfaces. Missing endpoint → add it (bridge endpoint → type in `api.ts` → store → page, the
  project's standing "new data need" path).
- **Orchestration** — delegation/spawn/reassign/escalation paths that *should* exist for the
  fleet to self-manage but don't (e.g. no auto-reassign on dead agent, no escalation when a
  task fails N times, no way to compose a multi-agent workflow).
- **Pipelines/workflows** — stages that are designed-for in BRAND_STRATEGY/AGENTS.md but have
  no implementation; deliverables generated with no home (a *missing surface*, vs bughunt's
  *broken surface*).
- **Schedules/cron** — recurring operations that should run automatically but have no job.

Method each run:
1. Reconcile **intent vs reality**: read AGENTS.md / README / BRAND_STRATEGY.md and the route
   list, then compare against what's actually wired (graphify the surface). Every divergence
   where the capability is *absent* is a candidate gap.
2. Record **all** newly-discovered gaps in `## CAPABILITY GAPS` of LOOP_STATE.md (so they're
   not los