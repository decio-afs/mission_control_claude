"""
mission-control-bridge.py
FastAPI bridge server for Mission Control — the Claude Code backend.
Port: 8767
"""

import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", "8767"))
# Wall-clock the process came up — used by /api/mc/health to report uptime.
BRIDGE_STARTED = time.time()
# Allow all origins by default: this is a localhost-only bridge for a local
# desktop app. Inside Electron the UI loads from file:// (Origin: "null"), so a
# fixed allow-list would block every request. Override with CORS_ORIGINS if needed.
ORIGINS = os.environ.get("CORS_ORIGINS", "*").split(",")

# ---------------------------------------------------------------------------
# The Claude brain. Mission Control drives the local `claude` CLI for
# inference — every LLM action (chat, agent spawn, task decompose, content
# synthesis, virality, digests) shells out to the local `claude` CLI.
# Conversations persist in a native SQLite store the bridge owns directly.
# ---------------------------------------------------------------------------
from mc_brain import (  # noqa: E402
    run_claude,
    claude_json,
    claude_model,
    ClaudeError,
    MCSessions,
)
from mc_store import MCStore  # noqa: E402
import mc_diag  # noqa: E402
import mc_scheduler  # noqa: E402

SESSIONS = MCSessions(Path(__file__).parent / ".mc" / "data" / "sessions.db")

# Native data layer — tasks, agents, cron, boards. The bridge owns the kanban /
# profile / cron CLI entirely; the bridge owns the JSON stores directly.
STORE = MCStore(Path(__file__).parent)

# Where Claude Code keeps installed skills — scanned by the Systems/Arsenal pages.
_CLAUDE_HOME = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude"))
_SKILLS_ROOTS = [
    _CLAUDE_HOME / "skills",
    _CLAUDE_HOME / "plugins",
    Path(__file__).parent / ".claude" / "skills",
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Never flash console windows for child processes on Windows. When the bridge
# itself runs detached from any console (Electron child, dev-server launcher),
# each CLI subprocess would otherwise allocate its own visible console — the
# app polls several CLI-backed endpoints every few seconds, which looked like
# terminals rapidly opening and closing in a loop.
CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def parse_cron_list(text: str) -> list[dict[str, Any]]:
    """Parse plain-text cron-list output into structured JSON (legacy helper)."""
    jobs: list[dict[str, Any]] = []
    current: dict[str, Any] = {}
    for line in text.splitlines():
        line = line.rstrip()
        if not line or line.startswith(("┌", "├", "└", "│", "Scheduled Jobs")):
            continue
        # Job ID line, e.g. "  c5835bb41c40 [active]"
        m = re.match(r"\s+([a-f0-9]+)\s+\[(\w+)\]", line)
        if m:
            if current:
                jobs.append(current)
            current = {"id": m.group(1), "status": m.group(2)}
            continue
        # Key: value lines. Allow multi-word keys ("Next run", "Last run") and
        # normalize them to snake_case (next_run, last_run) so consumers like the
        # briefing endpoint can read them.
        kv = re.match(r"\s+([\w ]+?):\s+(.*)", line)
        if kv and current is not None:
            key = kv.group(1).strip().lower().replace(" ", "_")
            val = kv.group(2).strip()
            if key == "repeat":
                val = val.replace("∞", "inf")
            current[key] = val
    if current:
        jobs.append(current)
    return jobs


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CreateTaskPayload(BaseModel):
    title: str
    body: Optional[str] = None
    assignee: Optional[str] = None
    priority: Optional[int] = None
    skills: Optional[list[str]] = None
    parents: Optional[list[str]] = None
    triage: Optional[bool] = None
    # Per-task circuit-breaker cap: block after N consecutive failed runs.
    # Defaults to 2 so bridge-created tasks can never retry unbounded even
    # if the dispatcher's kanban.failure_limit config drifts. Pass null to
    # fall back to the dispatcher default explicitly.
    max_retries: Optional[int] = 2


class BlockTaskPayload(BaseModel):
    reason: str


class CommentPayload(BaseModel):
    text: str
    author: Optional[str] = None


class AssignPayload(BaseModel):
    # Profile name, or "none" to unassign.
    profile: str


class ReassignPayload(BaseModel):
    profile: str
    reclaim: Optional[bool] = None
    reason: Optional[str] = None


class ReasonPayload(BaseModel):
    reason: Optional[str] = None


class PromotePayload(BaseModel):
    reason: Optional[str] = None
    force: Optional[bool] = None


class LinkPayload(BaseModel):
    parent_id: str
    child_id: str


class EditTaskPayload(BaseModel):
    result: str
    summary: Optional[str] = None
    metadata: Optional[str] = None


class NotifyPayload(BaseModel):
    platform: str
    chat_id: str
    thread_id: Optional[str] = None
    user_id: Optional[str] = None


class NotifyUnsubPayload(BaseModel):
    platform: str
    chat_id: str
    thread_id: Optional[str] = None


class BoardCreatePayload(BaseModel):
    slug: str
    name: Optional[str] = None
    description: Optional[str] = None
    switch: Optional[bool] = None


class BoardSwitchPayload(BaseModel):
    slug: str


class CreateCronPayload(BaseModel):
    # Schedule like '30m', 'every 2h', or '0 9 * * *'.
    schedule: str
    # Optional self-contained prompt / task instruction for the agent run.
    prompt: Optional[str] = None
    name: Optional[str] = None
    # Delivery target: origin, local, telegram, discord, signal, or platform:chat_id.
    deliver: Optional[str] = None
    # Optional repeat count (integer as string is fine; passed through verbatim).
    repeat: Optional[str] = None
    skills: Optional[list[str]] = None
    # Job kind: "claude" (default — fires `prompt` through a Claude turn) or
    # "maintenance" (fires an internal `action` directly, no Claude turn).
    kind: Optional[str] = None
    # Internal verb for a maintenance job, e.g. "sweep" (board self-heal macro).
    action: Optional[str] = None


class SpawnPayload(BaseModel):
    goal: str
    model: Optional[str] = None
    skills: Optional[list[str]] = None


class AttachmentPayload(BaseModel):
    name: str
    mime: Optional[str] = None
    # base64-encoded file contents (raw base64 or a full data: URL)
    data: str


class TranscribePayload(BaseModel):
    # base64-encoded audio (raw base64 or a full data: URL), e.g. webm/opus from MediaRecorder
    audio: str
    mime: Optional[str] = None


class ChatPayload(BaseModel):
    message: str
    model: Optional[str] = None
    skills: Optional[list[str]] = None
    attachments: Optional[list[AttachmentPayload]] = None
    # When set, the message continues an existing Claude session (real memory)
    # via `claude --resume <session_id>`. Omitted → starts a new session.
    session_id: Optional[str] = None


class SessionRenamePayload(BaseModel):
    title: str


class AgentCreatePayload(BaseModel):
    name: str
    role: str
    skills: list[str]
    model: Optional[str] = None


class AgentUpdatePayload(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    skills: Optional[list[str]] = None
    model: Optional[str] = None


class SpawnOnTaskPayload(BaseModel):
    task_id: str


class TaskDecomposePayload(BaseModel):
    task: str


class SetModelPayload(BaseModel):
    model: str
    provider: str
    base_url: Optional[str] = None


class Directive(BaseModel):
    sev: str
    t: str
    msg: str


class BriefingResponse(BaseModel):
    summary: str
    trend: list[str]
    fin: list[str]
    arc: list[str]
    forecast: list[str]
    prompts: list[str]
    directives: list[Directive]


# ---------------------------------------------------------------------------
# Cron scheduler — the in-bridge daemon that actually fires due jobs.
#
# Post-Hermes there was no process firing the native cron store: the UI showed
# next-fire countdowns but nothing executed them. This thread is that engine. It
# wakes every CRON_TICK_SECONDS, asks mc_scheduler which active jobs are due
# (cron-expression or interval, local clock — identical semantics to the UI's
# cronSchedule.ts), and runs each due job's prompt through Claude, single-flight,
# stamping the outcome back onto the job. Enabled by default; set
# MC_SCHEDULER_ENABLED=0 to run the bridge without it.
# ---------------------------------------------------------------------------
import threading  # noqa: E402

MC_SCHEDULER_ENABLED = os.environ.get("MC_SCHEDULER_ENABLED", "1") not in ("0", "false", "False", "")
CRON_TICK_SECONDS = int(os.environ.get("MC_CRON_TICK_SECONDS", "30"))
CRON_JOB_TIMEOUT = int(os.environ.get("MC_CRON_JOB_TIMEOUT", "600"))

# Task dispatcher — the post-Hermes successor to the gateway's kanban dispatcher.
# DISABLED by default: firing autonomous, tool-using Claude turns has real,
# hard-to-reverse side effects, so the operator opts in explicitly (same posture
# as the Buffer content cron + the self-heal cron). Until enabled, the capability
# is fully usable via the operator-initiated POST /api/mc/dispatcher/dispatch and
# previewable via GET /api/mc/dispatcher.
MC_DISPATCHER_ENABLED = os.environ.get("MC_DISPATCHER_ENABLED", "0") not in ("0", "false", "False", "")
DISPATCH_CONCURRENCY = max(1, int(os.environ.get("MC_DISPATCH_CONCURRENCY", "1")))
DISPATCH_TICK_SECONDS = int(os.environ.get("MC_DISPATCH_TICK_SECONDS", "30"))
DISPATCH_TIMEOUT = int(os.environ.get("MC_DISPATCH_TIMEOUT", "900"))


class CronScheduler:
    """Background thread that fires due cron jobs through Claude."""

    def __init__(self):
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self.started_at: Optional[float] = None
        self.last_tick: Optional[float] = None
        self.ticks = 0
        self.fired = 0
        self.errors = 0
        self.last_fired_id: Optional[str] = None
        self.last_error: Optional[str] = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self.started_at = time.time()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="cron-scheduler")
        self._thread.start()

    def stop(self):
        self._stop.set()

    def alive(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def status(self) -> dict:
        return {
            "enabled": MC_SCHEDULER_ENABLED,
            "running": self.alive(),
            "tick_seconds": CRON_TICK_SECONDS,
            "started_at": self.started_at,
            "last_tick": self.last_tick,
            "ticks": self.ticks,
            "fired": self.fired,
            "errors": self.errors,
            "last_fired_id": self.last_fired_id,
            "last_error": self.last_error,
        }

    def _loop(self):
        print(f"[mc-bridge] cron scheduler up (tick {CRON_TICK_SECONDS}s)", flush=True)
        while not self._stop.is_set():
            try:
                self.last_tick = time.time()
                self.ticks += 1
                jobs = STORE.list_cron().get("jobs", [])
                for job in mc_scheduler.due_jobs(jobs, self.last_tick):
                    if self._stop.is_set():
                        break
                    self._fire(job)
            except Exception as e:  # never let the daemon die on a bad tick
                self.errors += 1
                self.last_error = f"tick: {e}"
                print(f"[mc-bridge] cron scheduler tick error: {e}", flush=True)
            self._stop.wait(CRON_TICK_SECONDS)

    def _fire(self, job: dict):
        job_id = job.get("id")
        if not job_id:
            return
        kind = (job.get("kind") or "claude").lower()
        print(f"[mc-bridge] cron firing {job_id} ({job.get('name', '')}) kind={kind}", flush=True)
        try:
            if kind == "maintenance":
                # Internal verb — no Claude turn. Stamp the verb's own outcome line.
                res = STORE.run_maintenance(job.get("action"))
                STORE.record_cron_result(job_id, bool(res.get("ok")), res.get("detail", ""), trigger="schedule")
            else:
                prompt = job.get("prompt")
                if not prompt:
                    return
                resp = run_claude(prompt, timeout=CRON_JOB_TIMEOUT)
                STORE.record_cron_result(job_id, True, resp.get("result", ""), trigger="schedule")
            self.fired += 1
            self.last_fired_id = job_id
        except Exception as e:
            STORE.record_cron_result(job_id, False, str(e), trigger="schedule")
            self.errors += 1
            self.last_error = f"{job_id}: {e}"
            print(f"[mc-bridge] cron job {job_id} failed: {e}", flush=True)


SCHEDULER = CronScheduler()


def _build_dispatch_prompt(task: dict, agent: dict) -> tuple[str, str]:
    """Compose the (prompt, system_prompt) for one task's Claude turn."""
    title = task.get("title") or "(untitled task)"
    body = (task.get("body") or "").strip()
    skills = ", ".join(agent.get("skills") or []) or "general operations"
    role = agent.get("role") or "autonomous Mission Control operator"
    system_prompt = (
        f"You are {agent.get('name')}, a Mission Control agent. Role: {role}. "
        f"Skills: {skills}. You are executing one assigned kanban task end-to-end, "
        f"unattended. Do the work, then return a concise summary of what you "
        f"produced and where any deliverable lives."
    )
    prompt = f"# Task: {title}" + (f"\n\n{body}" if body else "")
    return prompt, system_prompt


def dispatch_task(task_id: str) -> dict:
    """Execute one ready kanban task through its assigned agent (one Claude turn).

    Claims the task → fires a headless ``run_claude`` turn (the agent's model) →
    records the run → completes the task with the result, or requeues it to
    ``ready`` on failure (so a repeatedly-failing task accrues runs and the
    escalate verb eventually blocks it). Shared by the autonomous dispatcher
    daemon and the manual dispatch endpoint. Raises on a non-dispatchable task.
    """
    show = STORE.show_task(task_id)            # KeyError → 404 at the endpoint
    task = show["task"]
    if task.get("status") == "running":
        raise ClaudeError(f"task {task_id} is already running")
    assignee = task.get("assignee")
    agent = STORE.get_agent(assignee) if assignee else None
    if agent is None:
        raise ClaudeError(f"task {task_id} has no live agent ({assignee!r}) to dispatch to")
    prompt, system_prompt = _build_dispatch_prompt(task, agent)
    STORE.claim_task(task_id)                  # → running, started_at stamped
    try:
        resp = run_claude(prompt, system_prompt=system_prompt,
                          model=agent.get("model"), timeout=DISPATCH_TIMEOUT)
    except Exception as e:
        STORE.record_task_run(task_id, status="error", error=str(e), trigger="dispatch")
        STORE.requeue_task(task_id, reason=f"dispatch failed: {e}")
        raise
    summary = resp.get("result") or ""
    STORE.record_task_run(task_id, status="ok", summary=summary,
                          session_id=resp.get("session_id"),
                          cost_usd=resp.get("cost_usd"), trigger="dispatch")
    STORE.complete_task(task_id, result=summary)
    return {"task_id": task_id, "assignee": assignee, "ok": True,
            "summary": summary[:500], "session_id": resp.get("session_id"),
            "cost_usd": resp.get("cost_usd")}


class TaskDispatcher:
    """Background thread that runs `ready` kanban tasks through Claude.

    The post-Hermes successor to the gateway's kanban dispatcher: single-flight
    per task, capacity-capped (DISPATCH_CONCURRENCY). DISABLED by default — see
    MC_DISPATCHER_ENABLED. Never dies on a bad tick.
    """

    def __init__(self):
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._in_flight: set[str] = set()
        self.started_at: Optional[float] = None
        self.last_tick: Optional[float] = None
        self.ticks = 0
        self.dispatched = 0
        self.errors = 0
        self.last_dispatched_id: Optional[str] = None
        self.last_error: Optional[str] = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self.started_at = time.time()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="task-dispatcher")
        self._thread.start()

    def stop(self):
        self._stop.set()

    def alive(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def status(self) -> dict:
        with self._lock:
            in_flight = sorted(self._in_flight)
        return {
            "enabled": MC_DISPATCHER_ENABLED,
            "running": self.alive(),
            "concurrency": DISPATCH_CONCURRENCY,
            "tick_seconds": DISPATCH_TICK_SECONDS,
            "in_flight": in_flight,
            "started_at": self.started_at,
            "last_tick": self.last_tick,
            "ticks": self.ticks,
            "dispatched": self.dispatched,
            "errors": self.errors,
            "last_dispatched_id": self.last_dispatched_id,
            "last_error": self.last_error,
        }

    def _loop(self):
        print(f"[mc-bridge] task dispatcher up (tick {DISPATCH_TICK_SECONDS}s, "
              f"concurrency {DISPATCH_CONCURRENCY})", flush=True)
        while not self._stop.is_set():
            try:
                self.last_tick = time.time()
                self.ticks += 1
                with self._lock:
                    free = DISPATCH_CONCURRENCY - len(self._in_flight)
                if free > 0:
                    for task in STORE.dispatchable_tasks(limit=free * 3):
                        if self._stop.is_set():
                            break
                        with self._lock:
                            if len(self._in_flight) >= DISPATCH_CONCURRENCY:
                                break
                            if task["id"] in self._in_flight:
                                continue
                            self._in_flight.add(task["id"])
                        threading.Thread(target=self._run_one, args=(task["id"],),
                                         daemon=True, name=f"dispatch-{task['id']}").start()
            except Exception as e:  # never let the daemon die on a bad tick
                self.errors += 1
                self.last_error = f"tick: {e}"
                print(f"[mc-bridge] dispatcher tick error: {e}", flush=True)
            self._stop.wait(DISPATCH_TICK_SECONDS)

    def _run_one(self, task_id: str):
        print(f"[mc-bridge] dispatching {task_id}", flush=True)
        try:
            dispatch_task(task_id)
            self.dispatched += 1
            self.last_dispatched_id = task_id
        except Exception as e:
            self.errors += 1
            self.last_error = f"{task_id}: {e}"
            print(f"[mc-bridge] dispatch {task_id} failed: {e}", flush=True)
        finally:
            with self._lock:
                self._in_flight.discard(task_id)


DISPATCHER = TaskDispatcher()


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[mc-bridge] Starting on port {BRIDGE_PORT}", flush=True)
    # Warm-load Whisper in the background so the first voice turn doesn't pay
    # the model load (or the first-ever ~150MB hub download) inline.
    if _whisper_installed():
        threading.Thread(target=_get_whisper_model, daemon=True, name="whisper-warmup").start()
    # Fire due cron jobs on schedule (the missing post-Hermes daemon).
    if MC_SCHEDULER_ENABLED:
        SCHEDULER.start()
    else:
        print("[mc-bridge] cron scheduler DISABLED (MC_SCHEDULER_ENABLED=0)", flush=True)
    # Autonomously run ready kanban tasks (the missing post-Hermes dispatcher).
    # OFF unless the operator opts in (autonomous tool-using turns have side effects).
    if MC_DISPATCHER_ENABLED:
        DISPATCHER.start()
    else:
        print("[mc-bridge] task dispatcher DISABLED (set MC_DISPATCHER_ENABLED=1 to "
              "auto-run ready tasks; manual dispatch endpoint still works)", flush=True)
    yield
    SCHEDULER.stop()
    DISPATCHER.stop()
    print("[mc-bridge] Shutting down", flush=True)


app = FastAPI(title="Mission Control Bridge", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    # Must be False when allow_origins is "*" (and we don't use cookies/auth).
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/ping")
def ping():
    """Instant liveness probe — NO CLI shell-out. Used by the Electron shell
    and the Vite dev-server launcher to detect the bridge: /api/mc/status
    takes 1-4s, which is slower than a launcher's
    per-attempt probe timeout and made startup look hung."""
    return {"ok": True, "uptime_seconds": int(time.time() - BRIDGE_STARTED)}


@app.get("/api/mc/status")
def get_status():
    """Check the Claude backend is alive."""
    return {
        "mc_version": mc_diag.claude_version(),
        "bridge": "ok",
    }


@app.get("/api/mc/health")
def get_health():
    """Lightweight bridge self-report for the Diagnostics panel.

    Cheap on purpose: it reports bridge process meta (uptime, python, port) and
    does ONE `claude --version` probe so the panel can confirm the CLI is wired
    up without serially shelling out to every endpoint. Per-endpoint latency is
    measured client-side by the health store (real round-trips from the app).
    """
    cli_ok = False
    cli_version = "unknown"
    cli_error: Optional[str] = None
    started = time.time()
    ver = mc_diag.claude_version()
    if ver:
        cli_ok = True
        cli_version = ver.splitlines()[0]
    else:
        cli_error = "claude CLI not responding"
    cli_probe_ms = round((time.time() - started) * 1000)

    return {
        "bridge": "ok",
        "port": BRIDGE_PORT,
        "uptime_seconds": round(time.time() - BRIDGE_STARTED),
        "python_version": sys.version.split()[0],
        "mc_cmd": "claude",
        "cli_ok": cli_ok,
        "cli_version": cli_version,
        "cli_probe_ms": cli_probe_ms,
        "cli_error": cli_error,
        "server_time": datetime.now().isoformat(timespec="seconds"),
    }


def parse_profile_names(text: str) -> list[str]:
    """Pull profile names out of a profile-list table (legacy helper).
    Rows look like ` ◆default   kimi-k2.6   running   —   —` — the name is the
    first token, with ◆ marking the active profile."""
    names = []
    for ln in (text or "").splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("Profile") or set(ln) <= set("─- "):
            continue
        name = ln.split()[0].lstrip("◆").strip()
        if name and re.fullmatch(r"[a-z0-9][a-z0-9_-]*", name):
            names.append(name)
    return names


@app.get("/api/mc/agents")
def get_agents():
    """List agents from the native roster, enriched with live kanban task counts."""
    return {"agents": STORE.agents_with_counts()}


@app.get("/api/mc/agents/web-access")
def agents_web_access():
    """Audit which agents need live web access but lack a web-capable MCP.

    The visibility surface for the silent root cause behind blocked research
    tasks (CAPABILITY GAPS #5): research agents with no web plugin block with
    no recorded reason. Diagnostic only — provisioning a key is operator config.
    """
    return STORE.web_access_audit()


def _profile_name(raw: str) -> str:
    """Profile names are lowercase alphanumeric — normalize whatever
    the operator typed ("My Agent" → "myagent")."""
    return re.sub(r"[^a-z0-9]", "", (raw or "").lower())


def _profile_description(role: Optional[str], skills: Optional[list[str]]) -> Optional[str]:
    """Role + skills land in the profile description — the field the kanban
    decomposer actually uses to route tasks (there are no --role/--skills
    flags on the CLI)."""
    bits = []
    if role:
        bits.append(f"Role: {role}.")
    if skills:
        bits.append("Skills: " + ", ".join(skills) + ".")
    return " ".join(bits) or None


@app.post("/api/mc/agents")
def create_agent(payload: AgentCreatePayload):
    """Create a new agent in the native roster."""
    name = _profile_name(payload.name)
    if not name:
        raise HTTPException(status_code=400, detail="Agent name must contain letters or digits")
    return STORE.create_agent(name, role=payload.role, skills=payload.skills, model=payload.model)


@app.put("/api/mc/agents/{agent_id}")
def update_agent(agent_id: str, payload: AgentUpdatePayload):
    """Update an agent's name / role / skills / model."""
    new_name = _profile_name(payload.name) if payload.name else None
    try:
        return STORE.update_agent(agent_id, name=new_name, role=payload.role,
                                  skills=payload.skills, model=payload.model)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"agent {agent_id} not found")


@app.delete("/api/mc/agents/{agent_id}")
def delete_agent(agent_id: str):
    """Delete an agent from the native roster."""
    return STORE.delete_agent(agent_id)


def _agent_system_prompt(agent: Optional[dict], name: str) -> tuple[Optional[str], Optional[str]]:
    """Build a specialization system prompt + resolve the model for an agent.

    Returns (system_prompt, model). When the agent has no stored persona we fall
    back to a generic worker prompt so spawn still does something sane.
    """
    role = (agent or {}).get("role") or f"a Mission Control worker named '{name}'"
    skills = (agent or {}).get("skills") or []
    mcps = (agent or {}).get("mcps") or []
    model = (agent or {}).get("model")
    lines = [
        f"You are '{name}', a specialized Mission Control agent.",
        "",
        f"Your role: {role}",
    ]
    if skills:
        lines += ["",
                  "Skills available to you — invoke the relevant ones via the Skill tool "
                  "whenever they fit the work: " + ", ".join(skills) + "."]
    if mcps:
        lines += ["",
                  "Preferred MCP connectors for your work: " + ", ".join(mcps)
                  + ". Use them when they help."]
    lines += ["",
              "Work autonomously to complete the assigned task to its acceptance criteria. "
              "Produce the actual deliverable, not a plan to produce it. Be concise and cite "
              "sources where relevant."]
    return "\n".join(lines), model


def _task_brief(task: dict, detail: dict) -> str:
    parts = [f"# Task: {task.get('title')}", ""]
    if task.get("body"):
        parts += [task["body"], ""]
    comments = detail.get("comments") or []
    if comments:
        parts += ["## Notes / context"] + [f"- {c.get('author')}: {c.get('body')}" for c in comments] + [""]
    parts += ["Complete this task now and return the finished deliverable."]
    return "\n".join(parts)


@app.post("/api/mc/agents/{agent_id}/spawn")
def spawn_agent_on_task(agent_id: str, payload: SpawnOnTaskPayload):
    """Spawn a specialized agent on a task.

    Loads the agent's persona (role + skills + MCPs + model) and the task's full
    content, then runs a headless Claude turn with that system prompt, the
    agent's model, and the task workspace as cwd — so each agent actually
    behaves like the specialist it's configured to be.
    """
    agent = STORE.get_agent(agent_id)
    try:
        detail = STORE.show_task(payload.task_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"task {payload.task_id} not found")
    task = detail["task"]

    system_prompt, model = _agent_system_prompt(agent, agent_id)
    prompt = _task_brief(task, detail)
    cwd = task.get("workspace_path") or None

    try:
        resp = run_claude(prompt, system_prompt=system_prompt, model=model, cwd=cwd, timeout=600)
    except ClaudeError as e:
        raise HTTPException(status_code=502, detail=f"Claude: {e}")

    # Record the run on the task so the result is visible in the drawer.
    try:
        STORE.comment_task(payload.task_id, resp["result"], author=agent_id)
    except Exception:
        pass
    return {"message": resp["result"], "agent_id": agent_id, "task_id": payload.task_id,
            "model": model or "default", "skills": (agent or {}).get("skills", [])}


@app.post("/api/mc/tasks/decompose")
def decompose_task(payload: TaskDecomposePayload):
    """Decompose a complex task into sub-tasks using Claude."""
    prompt = (
        "Decompose the following task into 3-7 concrete sub-tasks that can be executed in parallel. "
        "Return ONLY a JSON array of objects with keys: title (string), body (optional string), assignee (optional string). "
        f"Task: {payload.task}"
    )
    data: list[dict[str, Any]] = []
    raw = ""
    try:
        parsed = claude_json(prompt, timeout=120)
        if isinstance(parsed, list):
            data = parsed
        elif isinstance(parsed, dict) and isinstance(parsed.get("subtasks"), list):
            data = parsed["subtasks"]
    except ClaudeError as e:
        raw = str(e)
    # Ensure each item has at least a title
    subtasks = []
    for item in data:
        if isinstance(item, dict) and "title" in item:
            subtasks.append({
                "title": item["title"],
                "body": item.get("body"),
                "assignee": item.get("assignee"),
            })
    if not subtasks:
        subtasks = [{"title": "Decomposed work", "body": raw or None, "assignee": None}]
    return {"subtasks": subtasks}


@app.get("/api/mc/tasks")
def get_tasks():
    """List kanban tasks from the native store."""
    return STORE.list_tasks()


@app.get("/api/mc/activity")
def get_activity():
    """Derive a live activity stream from kanban task lifecycle timestamps.

    There is no dedicated activity log, so we synthesize one from real task
    events (created / claimed / completed) — every entry reflects an actual
    state change on a real task.
    """
    tasks = STORE.list_tasks()["tasks"]
    events: list[dict[str, Any]] = []

    def short(title: Optional[str]) -> str:
        t = (title or "untitled").strip()
        return t if len(t) <= 64 else t[:63] + "…"

    for t in tasks:
        if not isinstance(t, dict):
            continue
        tid = str(t.get("id", ""))
        agent = t.get("assignee") or t.get("created_by") or "system"
        title = short(t.get("title"))
        created = t.get("created_at")
        started = t.get("started_at")
        completed = t.get("completed_at")
        if isinstance(created, (int, float)):
            events.append({"id": f"{tid}-c", "agent": agent, "action": f"task created · {title}", "timestamp": created, "status": "created"})
        if isinstance(started, (int, float)):
            events.append({"id": f"{tid}-s", "agent": agent, "action": f"claimed · {title}", "timestamp": started, "status": "running"})
        if isinstance(completed, (int, float)):
            status = "blocked" if t.get("status") in ("blocked", "failed") else "complete"
            verb = "blocked" if status == "blocked" else "completed"
            events.append({"id": f"{tid}-d", "agent": agent, "action": f"{verb} · {title}", "timestamp": completed, "status": status})

    # Most recent first from the source, but cap to the latest 50 events.
    events.sort(key=lambda e: e["timestamp"], reverse=True)
    return {"activities": events[:50]}


@app.get("/api/mc/events")
def get_events(limit: int = 50):
    """Board-wide task-event feed (the FULL lifecycle taxonomy).

    Unlike /api/mc/activity (three synthesized lifecycle entries per task), this
    merges every task's recorded event timeline newest-first — claim/complete/
    block/fail/route/promote/escalate/reassign/reconcile/dependency-edge/
    workspace/… — each row tagged with its task_id + title so the Operations
    event feed can deep-link to the task and render an icon+label per kind. The
    operator's at-a-glance "what just happened across the whole board" view."""
    return STORE.recent_events(limit=limit)


# Patch notes live next to the bug-hunt handoff (.mc/BUGHUNT_LOG.md); the
# autonomous routine appends one entry per shipped fix. Read-only here.
PATCH_NOTES_FILE = Path(__file__).parent / ".mc" / "patch-notes.json"


@app.get("/api/mc/patch-notes")
def get_patch_notes():
    """Changelog the autonomous bug-hunt routine writes after each run.

    Source of truth is .mc/patch-notes.json — a {"notes": [...]} document
    (or a bare list). Returned newest-first by (date, iteration). Never raises:
    a missing or malformed file yields an empty list so the UI degrades cleanly.
    """
    notes: list[dict[str, Any]] = []
    try:
        if PATCH_NOTES_FILE.exists():
            data = json.loads(PATCH_NOTES_FILE.read_text(encoding="utf-8"))
            raw = data.get("notes", []) if isinstance(data, dict) else data
            if isinstance(raw, list):
                notes = [n for n in raw if isinstance(n, dict)]
    except Exception:
        notes = []

    def _key(n: dict[str, Any]):
        it = n.get("iteration")
        return (str(n.get("date", "")), it if isinstance(it, int) else 0)

    notes.sort(key=_key, reverse=True)
    return {"notes": notes}


@app.post("/api/mc/tasks")
def create_task(payload: CreateTaskPayload):
    """Create a kanban task in the native store."""
    return STORE.create_task(payload)


@app.get("/api/mc/tasks/{task_id}")
def show_task(task_id: str):
    """Full task detail: task fields, parents/children, comments, events, runs."""
    try:
        return STORE.show_task(task_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"task {task_id} not found")


def _task_op(fn, *args):
    try:
        return fn(*args)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"task {e} not found")


@app.post("/api/mc/tasks/{task_id}/claim")
def claim_task(task_id: str):
    """Claim a kanban task."""
    return _task_op(STORE.claim_task, task_id)


@app.post("/api/mc/tasks/{task_id}/complete")
def complete_task(task_id: str):
    """Complete a kanban task."""
    return _task_op(STORE.complete_task, task_id)


@app.post("/api/mc/tasks/{task_id}/block")
def block_task(task_id: str, payload: BlockTaskPayload):
    """Block a kanban task."""
    return _task_op(STORE.block_task, task_id, payload.reason)


@app.post("/api/mc/tasks/{task_id}/unblock")
def unblock_task(task_id: str, payload: ReasonPayload):
    """Return a blocked/scheduled task to ready."""
    return _task_op(STORE.unblock_task, task_id, payload.reason)


@app.post("/api/mc/tasks/{task_id}/promote")
def promote_task(task_id: str, payload: PromotePayload):
    """Promote a todo/blocked/triage task to ready (recovery path)."""
    return _task_op(STORE.promote_task, task_id, payload.reason, payload.force)


@app.post("/api/mc/tasks/{task_id}/schedule")
def schedule_task(task_id: str, payload: ReasonPayload):
    """Park a task in Scheduled (waiting on time, not human input)."""
    return _task_op(STORE.schedule_task, task_id, payload.reason)


@app.post("/api/mc/tasks/{task_id}/archive")
def archive_task(task_id: str):
    """Archive a task."""
    return _task_op(STORE.archive_task, task_id)


@app.post("/api/mc/tasks/{task_id}/assign")
def assign_task(task_id: str, payload: AssignPayload):
    """Assign or unassign a task ('none' to unassign)."""
    return _task_op(STORE.assign_task, task_id, payload.profile)


@app.post("/api/mc/tasks/{task_id}/reassign")
def reassign_task(task_id: str, payload: ReassignPayload):
    """Reassign a task to a different profile, optionally reclaiming first."""
    return _task_op(STORE.reassign_task, task_id, payload.profile, payload.reclaim, payload.reason)


@app.post("/api/mc/tasks/{task_id}/reclaim")
def reclaim_task(task_id: str):
    """Release an active worker claim on a running task."""
    return _task_op(STORE.reclaim_task, task_id)


@app.post("/api/mc/tasks/{task_id}/comment")
def comment_task(task_id: str, payload: CommentPayload):
    """Append a comment to a task."""
    return _task_op(STORE.comment_task, task_id, payload.text, payload.author)


@app.post("/api/mc/tasks/{task_id}/edit")
def edit_task(task_id: str, payload: EditTaskPayload):
    """Backfill recovery fields on an already-completed task."""
    return _task_op(STORE.edit_task, task_id, payload.result, payload.summary, payload.metadata)


@app.post("/api/mc/tasks/link")
def link_tasks(payload: LinkPayload):
    """Add a parent->child dependency.

    Refuses self-links and cycle-closing edges (the store raises ValueError),
    surfaced as a 400 so the caller learns the link was rejected rather than
    silently persisting a loop the cascade gate can never clear.
    """
    try:
        return STORE.link(payload.parent_id, payload.child_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/mc/tasks/unlink")
def unlink_tasks(payload: LinkPayload):
    """Remove a parent->child dependency."""
    return STORE.unlink(payload.parent_id, payload.child_id)


@app.get("/api/mc/kanban/stats")
def kanban_stats():
    """Per-status + per-assignee counts + oldest-ready age."""
    return STORE.stats()


@app.get("/api/mc/kanban/diagnostics")
def kanban_diagnostics():
    """Active board diagnostics (stale claims, missing deps, etc.)."""
    return {"diagnostics": STORE.diagnostics()}


class ReconcilePayload(BaseModel):
    # Hours after which a still-"running" claim is treated as dead and reclaimed.
    # Omit to use the store default (STALE_CLAIM_SECONDS).
    threshold_hours: Optional[float] = None


@app.post("/api/mc/kanban/reconcile")
def kanban_reconcile(payload: Optional[ReconcilePayload] = None):
    """Self-heal the board: reclaim stale running claims back to `ready`.

    The companion remediation for the `stale_claim` diagnostic — turns
    detection into a one-call fleet recovery instead of a manual per-task
    reclaim, so one dead agent can't freeze the board.
    """
    thr_hours = payload.threshold_hours if payload else None
    thr_seconds = thr_hours * 3600 if thr_hours is not None else None
    return STORE.reconcile_board(thr_seconds)


class RoutePayload(BaseModel):
    # Route a single triage task by id; omit to route every triage task.
    task_id: Optional[str] = None
    # Preview the assignment plan without mutating the board.
    dry_run: bool = False


@app.post("/api/mc/kanban/route")
def kanban_route(payload: Optional[RoutePayload] = None):
    """Auto-route triage task(s) to the best-fit agent by skill match.

    The deterministic assign-by-skill half of "triage → specify → assign":
    scores every agent against the task text, requires a skill-token match for
    confidence, ties break toward the least-loaded agent, then de-triages the
    task to `todo` (no worker is fired — there is no in-process dispatcher).
    Unmatched tasks are honestly left in triage. `dry_run` previews the plan.
    """
    tid = payload.task_id if payload else None
    dry = payload.dry_run if payload else False
    try:
        return STORE.route_triage(tid, dry_run=dry)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"task {tid} not found")


class EscalatePayload(BaseModel):
    # Escalate a single task by id; omit to sweep every retry-exhausted task.
    task_id: Optional[str] = None
    # Preview the escalation plan without mutating the board.
    dry_run: bool = False


@app.post("/api/mc/kanban/escalate")
def kanban_escalate(payload: Optional[EscalatePayload] = None):
    """Escalate tasks that have exhausted their retry budget.

    `max_retries` exists on every task but nothing acted on it post-Hermes —
    a task whose assignee kept failing would silently loop. This is the missing
    self-management remediation for the `retry_exhausted` diagnostic: it moves
    each exhausted task to `blocked` with a recorded reason + an `escalated`
    event (attempts/budget/assignee), so a human or the route verb picks the
    next owner. Reversible; `dry_run` previews without mutating.
    """
    tid = payload.task_id if payload else None
    dry = payload.dry_run if payload else False
    try:
        return STORE.escalate_exhausted(tid, dry_run=dry)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"task {tid} not found")


class CascadePayload(BaseModel):
    # Preview the dependency hold/promote plan without mutating the board.
    dry_run: bool = False


@app.post("/api/mc/kanban/cascade")
def kanban_cascade(payload: Optional[CascadePayload] = None):
    """Enforce parent→child dependency ordering across the board.

    Parent→child links existed but nothing enforced ordering post-Hermes. This
    sweep HOLDS a workable child whose parents are still open (→ `blocked` with
    a recorded reason), PROMOTES a child it previously held once all its parents
    are `done` (→ `ready`), and surfaces children still waiting. Conservative:
    it only promotes tasks it held, so tasks blocked for other reasons are never
    touched. Idempotent; `dry_run` previews the plan without mutating.
    """
    dry = payload.dry_run if payload else False
    return STORE.cascade_dependencies(dry_run=dry)


class ReassignPayload(BaseModel):
    # Reassign one named agent's open work; omit to sweep every dead/idle agent.
    from_agent: Optional[str] = None
    # Preview the reassignment plan without mutating the board.
    dry_run: bool = False


@app.post("/api/mc/kanban/reassign")
def kanban_reassign(payload: Optional[ReassignPayload] = None):
    """Reassign a dead/idle agent's open work to the best-fit live agent.

    `reconcile` reclaims a stale claim to `ready` but leaves it on the same dead
    assignee (the next claim re-fails); an off-roster agent's backlog has no owner
    that will ever run it. This is the missing self-management remediation for the
    `dead_agent_task` diagnostic: it detects dead/idle agents (off-roster, or
    holding a stale running claim) and moves each of their workable tasks
    (`todo`/`ready`, or a stale `running` claim — also reclaimed) to the best-fit
    OTHER agent by skill match (reusing the route scorer; least-loaded tie-break).
    No confident match → the task is left in place. `blocked` tasks are never
    touched. `dry_run` previews the plan without mutating.
    """
    frm = payload.from_agent if payload else None
    dry = payload.dry_run if payload else False
    return STORE.reassign_dead_agent(frm, dry_run=dry)


class SweepPayload(BaseModel):
    # Preview the full self-manage plan without mutating the board.
    dry_run: bool = False


@app.post("/api/mc/kanban/sweep")
def kanban_sweep(payload: Optional[SweepPayload] = None):
    """One-call board self-manage macro: run the four self-heal verbs in order.

    reconcile (reclaim stale claims → ready) → cascade (hold/promote on deps) →
    reassign (move dead-agent work to live owners) → escalate (block retry-burned
    tasks). Order matters: reconcile first frees stale claims so reassign sees the
    idle agent; cascade before reassign so a dep-held task is not moved; escalate
    last as the final safety net. Each sub-verb is idempotent + dry-run-able, so
    the macro is low-risk and a second pass is a no-op. `dry_run` previews the whole
    plan without mutating. Returns each sub-result plus aggregate `counts`, `total`,
    and a one-line `message`.
    """
    dry = payload.dry_run if payload else False
    return STORE.sweep_board(dry_run=dry)


class DispatchPayload(BaseModel):
    # Dispatch a specific ready task; omit to target the best-first dispatchable.
    task_id: Optional[str] = None
    # Preview the plan without firing a Claude turn.
    dry_run: bool = False


@app.get("/api/mc/dispatcher")
def get_dispatcher():
    """Dispatcher daemon status + dry-run preview of what it would run next.

    The post-Hermes kanban dispatcher: it claims a `ready` task assigned to a live
    agent and executes it through one headless Claude turn. The daemon is OFF by
    default (MC_DISPATCHER_ENABLED) — `status.enabled/running` reports honestly —
    but a ready task can always be run by hand via POST /api/mc/dispatcher/dispatch.
    `dispatchable` is the same best-first plan the daemon consumes.
    """
    return {"status": DISPATCHER.status(),
            "dispatchable": STORE.dispatchable_tasks(limit=20)}


@app.post("/api/mc/dispatcher/dispatch")
def dispatcher_dispatch(payload: Optional[DispatchPayload] = None):
    """Manually dispatch a ready task (operator-initiated).

    `dry_run` returns the plan without firing. A real dispatch fires one headless
    Claude turn in the background and returns immediately (a turn can take
    minutes) — watch the task's status/runs for the outcome. With no `task_id`,
    targets the single best-first dispatchable task. A task that is not `ready` +
    assigned to a live agent is honestly reported as not dispatchable.
    """
    task_id = payload.task_id if payload else None
    dry = payload.dry_run if payload else False
    plan = STORE.dispatchable_tasks(limit=50)
    if task_id:
        target = next((p for p in plan if p["id"] == task_id), None)
        not_found_msg = (f"task {task_id} is not dispatchable "
                         f"(must be `ready` and assigned to a live agent)")
    else:
        target = plan[0] if plan else None
        not_found_msg = "no ready, assigned task to dispatch"
    if target is None:
        return {"dispatched": False, "dry_run": dry, "target": None, "message": not_found_msg}
    if dry:
        return {"dispatched": False, "dry_run": True, "target": target,
                "message": f"would dispatch {target['id']} → {target['assignee']}"}
    threading.Thread(target=_safe_dispatch, args=(target["id"],),
                     daemon=True, name=f"manual-dispatch-{target['id']}").start()
    return {"dispatched": True, "dry_run": False, "target": target,
            "message": f"dispatching {target['id']} → {target['assignee']} (running in background)"}


def _safe_dispatch(task_id: str):
    try:
        dispatch_task(task_id)
    except Exception as e:
        print(f"[mc-bridge] manual dispatch {task_id} failed: {e}", flush=True)


@app.post("/api/mc/tasks/{task_id}/specify")
def specify_task(task_id: str):
    """Flesh out a triage task's spec with Claude, then promote it to ready."""
    try:
        detail = STORE.show_task(task_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"task {task_id} not found")
    task = detail["task"]
    prompt = (
        "You are a delivery lead refining a task spec. Rewrite the task below into a clear, "
        "actionable spec with: a one-line goal, a short approach, and 3-6 acceptance criteria as "
        "a markdown checklist. Return ONLY the markdown body.\n\n"
        f"Title: {task.get('title')}\n\nCurrent body:\n{task.get('body') or '(empty)'}"
    )
    try:
        resp = run_claude(prompt, timeout=180)
        body = resp["result"].strip()
    except ClaudeError as e:
        raise HTTPException(status_code=502, detail=f"Claude: {e}")
    STORE.edit_task(task_id, task.get("result") or "", summary="spec refined")

    def _apply(t):
        t["body"] = body
        if t.get("status") in ("triage", "todo"):
            t["status"] = "ready"
    STORE._mutate(task_id, _apply, event="specified")
    return {"message": "spec refined and promoted to ready", "body": body}


@app.get("/api/mc/tasks/{task_id}/log")
def task_log(task_id: str, tail: Optional[int] = None):
    """The worker log for a task — synthesized from its event history."""
    try:
        detail = STORE.show_task(task_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"task {task_id} not found")
    lines = []
    for e in detail.get("events", []):
        ts = datetime.fromtimestamp(e.get("created_at", 0)).isoformat(timespec="seconds")
        payload = e.get("payload") or {}
        extra = " " + json.dumps(payload) if payload else ""
        lines.append(f"[{ts}] {e.get('kind')}{extra}")
    log = "\n".join(lines[-tail:] if tail else lines)
    return {"log": log or "(no events yet)"}


@app.get("/api/mc/tasks/{task_id}/context")
def task_context(task_id: str):
    """The assembled context a worker sees for this task."""
    try:
        detail = STORE.show_task(task_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"task {task_id} not found")
    task = detail["task"]
    parts = [f"# {task.get('title')}", "", task.get("body") or "(no body)"]
    if detail.get("comments"):
        parts += ["", "## Comments"] + [f"- {c['author']}: {c['body']}" for c in detail["comments"]]
    return {"context": "\n".join(parts)}


# Read-only workspace browser (DELIV-4 slice b). A task's file deliverables live
# in its workspace dir (and, when the work is a git branch, on that branch). The
# drawer showed only the path string; this surfaces *what's actually there* so a
# file/branch deliverable is retrievable in-app. SAFETY: the workspace path comes
# from the bridge's kanban store, never the client; a ?file= read is resolved and
# strictly confined inside that workspace (no path-traversal escape); only
# read-only git runs; listing count and file size are capped.
_BRANCH_RE = re.compile(r"^[\w./+-]+$")
_MAX_FILE_BYTES = 256 * 1024
_MAX_ENTRIES = 300


def _git_ro(ws: Path, *gitargs: str, timeout: int = 15) -> str:
    """Run a read-only git command in ws, returning stdout ('' on any failure)."""
    try:
        r = subprocess.run(
            ["git", "-C", str(ws), *gitargs],
            capture_output=True, text=True, timeout=timeout,
            encoding="utf-8", errors="replace",
            creationflags=CREATE_NO_WINDOW, stdin=subprocess.DEVNULL,
        )
    except (subprocess.SubprocessError, OSError):
        return ""
    return r.stdout.strip() if r.returncode == 0 else ""


@app.get("/api/mc/tasks/{task_id}/workspace")
def task_workspace(task_id: str, file: Optional[str] = None):
    """Read-only view of a task's file/branch deliverable.

    Without ?file: a shallow (top-level) listing of the workspace dir, plus — when
    it is a git repo — recent branch commits and a diff --stat. With ?file=<rel>:
    that file's text content (confined inside the workspace, size-capped). The
    workspace path is taken from the native store, never the client.
    """
    try:
        task = STORE.show_task(task_id)["task"]
    except KeyError:
        raise HTTPException(status_code=404, detail=f"task {task_id} not found")
    ws = (task.get("workspace_path") or "").strip()
    branch = (task.get("branch_name") or "").strip()
    out: dict[str, Any] = {
        "workspace_path": ws or None, "branch_name": branch or None,
        "exists": False, "is_git": False, "files": [],
        "log": "", "diffstat": "", "note": "",
    }
    if not ws:
        out["note"] = "This task has no workspace — nothing to browse."
        return out
    try:
        ws_root = Path(ws).resolve(strict=False)
    except (OSError, ValueError):
        out["note"] = "Workspace path could not be resolved."
        return out
    if not ws_root.is_dir():
        out["note"] = "Workspace path no longer exists on disk."
        return out
    out["exists"] = True

    # ?file= → one file's text, strictly confined to the workspace root.
    if file is not None:
        try:
            target = (ws_root / file).resolve(strict=False)
        except (OSError, ValueError):
            raise HTTPException(status_code=400, detail="invalid file path")
        if ws_root != target and ws_root not in target.parents:
            raise HTTPException(status_code=403, detail="path escapes workspace")
        if not target.is_file():
            raise HTTPException(status_code=404, detail="file not found")
        try:
            raw = target.read_bytes()[: _MAX_FILE_BYTES + 1]
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"could not read file: {exc}")
        truncated = len(raw) > _MAX_FILE_BYTES
        raw = raw[:_MAX_FILE_BYTES]
        if b"\x00" in raw:
            return {"file": file, "binary": True, "truncated": False,
                    "content": "", "note": "binary file — not shown"}
        return {"file": file, "binary": False, "truncated": truncated,
                "content": raw.decode("utf-8", errors="replace")}

    # listing (top level only), directories first then files, alpha within each
    try:
        entries = sorted(os.scandir(ws_root), key=lambda e: (e.is_file(), e.name.lower()))
    except OSError as exc:
        out["note"] = f"Could not list workspace: {exc}"
        return out
    files: list[dict[str, Any]] = []
    for e in entries:
        if e.name == ".git":
            continue
        try:
            is_dir = e.is_dir()
            size = e.stat().st_size if e.is_file() else None
        except OSError:
            is_dir, size = False, None
        files.append({"name": e.name, "rel": e.name, "is_dir": is_dir, "size": size})
        if len(files) >= _MAX_ENTRIES:
            break
    out["files"] = files
    if not files:
        out["note"] = "Workspace is empty — this task wrote no files here."

    # git summary (read-only) when the workspace is a repo
    if _git_ro(ws_root, "rev-parse", "--is-inside-work-tree") == "true":
        out["is_git"] = True
        logargs = ["log", "--oneline", "-n", "20"]
        if branch and _BRANCH_RE.match(branch):
            logargs.append(branch)
        out["log"] = _git_ro(ws_root, *logargs)
        out["diffstat"] = _git_ro(ws_root, "diff", "--stat")
    return out


# Deliverables browser. Dispatched agents are told to write any substantive
# output to deliverables/ or research/ at the repo root (see _build_dispatch_prompt),
# but until now those files had no reachable home in the UI — they sat orphaned on
# disk with no task linkage (the per-task workspace browser above only sees a task's
# own `workspace_path`, which dispatch does not yet populate). This read-only
# browser surfaces every produced artifact. SAFETY: listing is confined to the two
# known roots under the bridge dir; a ?path= read is resolved and strictly
# re-confined inside those roots (no path-traversal escape); file size is capped
# and binary files are not inlined.
_DELIVERABLE_DIR = Path(__file__).parent
_DELIVERABLE_ROOTS = ("deliverables", "research")
_DELIVERABLE_MAX_ENTRIES = 500


def _deliverable_task_id(root: str, rel_to_root: str) -> str | None:
    """Derive the owning task id from a deliverable's path, or None.

    The dispatcher workspace seam (run #16) writes a dispatched agent's output to
    `deliverables/tasks/<id>/…` (see MCStore.ensure_workspace). A path of that exact
    shape — under the `deliverables` root, first segment `tasks`, a non-empty second
    segment, and at least one more segment (the file) — yields that `<id>` so the UI
    can link a file back to the task that produced it. Pure string parse, no store
    hit. Returns None for anything else (root-level files, the `research` root, a bare
    `tasks/<id>` with no file under it)."""
    if root != "deliverables":
        return None
    parts = rel_to_root.split("/")
    if len(parts) >= 3 and parts[0] == "tasks" and parts[1]:
        return parts[1]
    return None


@app.get("/api/mc/deliverables")
def list_deliverables():
    """Flat, newest-first listing of every file under deliverables/ and research/."""
    items: list[dict[str, Any]] = []
    for root in _DELIVERABLE_ROOTS:
        base = _DELIVERABLE_DIR / root
        if not base.is_dir():
            continue
        try:
            paths = [p for p in base.rglob("*") if p.is_file()]
        except OSError:
            continue
        for p in paths:
            if p.name.startswith(".") or ".git" in p.parts:
                continue
            try:
                st = p.stat()
            except OSError:
                continue
            rel_to_root = p.relative_to(base).as_posix()
            items.append({
                "path": p.relative_to(_DELIVERABLE_DIR).as_posix(),
                "root": root,
                "name": p.name,
                "rel_to_root": rel_to_root,
                "task_id": _deliverable_task_id(root, rel_to_root),
                "size": st.st_size,
                "modified": st.st_mtime,
                "ext": p.suffix.lower().lstrip("."),
            })
    # Cap AFTER sorting newest-first, not during the walk. The old in-loop
    # `break` capped in rglob (arbitrary filesystem) order and only `break`-ed
    # the INNER loop, so once the artifact count crossed _DELIVERABLE_MAX_ENTRIES
    # the panel (a) kept an arbitrary subset instead of the NEWEST deliverables —
    # silently HIDING the operator's most-recent outputs, the exact lost-deliverable
    # failure this browser exists to prevent — and (b) the second root could still
    # leak entries past the cap. Collect every entry, sort by mtime desc, then
    # truncate, so the surviving N are always the freshest (mirrors get_activity's
    # cap-priority discipline). rglob already materializes the full path list, so
    # collecting all dicts adds only O(files) work, no extra walk.
    items.sort(key=lambda x: x["modified"], reverse=True)
    items = items[:_DELIVERABLE_MAX_ENTRIES]
    return {"deliverables": items, "count": len(items), "roots": list(_DELIVERABLE_ROOTS)}


@app.get("/api/mc/deliverables/file")
def read_deliverable(path: str):
    """Return one deliverable file's text, strictly confined to the roots."""
    try:
        target = (_DELIVERABLE_DIR / path).resolve(strict=False)
    except (OSError, ValueError):
        raise HTTPException(status_code=400, detail="invalid path")
    inside = False
    for root in _DELIVERABLE_ROOTS:
        base = (_DELIVERABLE_DIR / root).resolve(strict=False)
        if target == base or base in target.parents:
            inside = True
            break
    if not inside:
        raise HTTPException(status_code=403, detail="path escapes deliverable roots")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="deliverable not found")
    try:
        raw = target.read_bytes()[: _MAX_FILE_BYTES + 1]
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"could not read deliverable: {exc}")
    truncated = len(raw) > _MAX_FILE_BYTES
    raw = raw[:_MAX_FILE_BYTES]
    if b"\x00" in raw:
        return {"path": path, "binary": True, "truncated": False,
                "content": "", "note": "binary file — not shown"}
    return {"path": path, "binary": False, "truncated": truncated,
            "content": raw.decode("utf-8", errors="replace")}


@app.get("/api/mc/deliverables/raw")
def read_deliverable_raw(path: str):
    """Serve a deliverable's RAW bytes, strictly confined to the roots.

    The JSON `/file` endpoint can only flag a binary deliverable as "not shown",
    so a generated media deliverable (e.g. an agent-produced hero image) had no
    viewable home — the operator saw a note where their image should be. This
    streams the actual bytes (content-type inferred from the extension) so the UI
    can render an <img>. Same path-confinement as read_deliverable; no inlining
    into JSON, so the big-file/binary concern that keeps `/file` text-only does
    not apply here.
    """
    try:
        target = (_DELIVERABLE_DIR / path).resolve(strict=False)
    except (OSError, ValueError):
        raise HTTPException(status_code=400, detail="invalid path")
    inside = False
    for root in _DELIVERABLE_ROOTS:
        base = (_DELIVERABLE_DIR / root).resolve(strict=False)
        if target == base or base in target.parents:
            inside = True
            break
    if not inside:
        raise HTTPException(status_code=403, detail="path escapes deliverable roots")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="deliverable not found")
    return FileResponse(target)


@app.get("/api/mc/tasks/{task_id}/notify")
def task_notify_list(task_id: str):
    """List notification subscriptions on a task."""
    return {"subscriptions": STORE.notify_list(task_id)}


@app.post("/api/mc/tasks/{task_id}/notify")
def task_notify_subscribe(task_id: str, payload: NotifyPayload):
    """Subscribe a channel to a task's terminal events."""
    return STORE.notify_subscribe(task_id, {
        "platform": payload.platform, "chat_id": payload.chat_id,
        "thread_id": payload.thread_id, "user_id": payload.user_id,
    })


@app.post("/api/mc/tasks/{task_id}/notify/unsubscribe")
def task_notify_unsubscribe(task_id: str, payload: NotifyUnsubPayload):
    """Remove a subscription from a task."""
    return STORE.notify_unsubscribe(task_id, payload.platform, payload.chat_id, payload.thread_id)


@app.get("/api/mc/boards")
def list_boards():
    """List kanban boards with task counts and which one is current."""
    return {"boards": STORE.boards()}


@app.post("/api/mc/boards")
def create_board(payload: BoardCreatePayload):
    """Create a new board (optionally switch to it)."""
    return STORE.create_board(payload.slug, payload.name, payload.description, payload.switch)


@app.post("/api/mc/boards/switch")
def switch_board(payload: BoardSwitchPayload):
    """Set the active board for subsequent calls."""
    return STORE.switch_board(payload.slug)


@app.get("/api/mc/cron")
def get_cron():
    """List scheduled jobs from the native store + the live scheduler status,
    so the UI's next-fire countdowns can be shown as actually-firing vs inert."""
    out = STORE.list_cron()
    out["scheduler"] = SCHEDULER.status()
    return out


@app.post("/api/mc/cron")
def create_cron(payload: CreateCronPayload):
    """Create a scheduled job in the native store (claude or maintenance kind)."""
    try:
        out = STORE.create_cron(payload.schedule, payload.prompt, payload.name,
                                payload.deliver, payload.repeat, payload.skills,
                                kind=payload.kind, action=payload.action)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return out


@app.post("/api/mc/cron/{job_id}/run")
def run_cron(job_id: str):
    """Trigger a cron job now — fires its prompt through Claude, or for a
    maintenance job runs its internal verb (e.g. board sweep) with no Claude turn."""
    job = STORE.get_cron_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"cron job {job_id} not found")
    if (job.get("kind") or "claude").lower() == "maintenance":
        try:
            res = STORE.run_maintenance(job.get("action"))
        except ValueError as e:
            STORE.record_cron_result(job_id, False, str(e), trigger="manual")
            raise HTTPException(status_code=400, detail=str(e))
        STORE.record_cron_result(job_id, bool(res.get("ok")), res.get("detail", ""), trigger="manual")
        return {"message": res.get("detail", ""), "result": res.get("result")}
    prompt = job.get("prompt")
    if not prompt:
        raise HTTPException(status_code=400, detail="job has no prompt to run")
    try:
        resp = run_claude(prompt, timeout=300)
    except ClaudeError as e:
        STORE.record_cron_result(job_id, False, str(e), trigger="manual")
        raise HTTPException(status_code=502, detail=f"Claude: {e}")
    STORE.record_cron_result(job_id, True, resp.get("result", ""), trigger="manual")
    return {"message": resp["result"]}


@app.post("/api/mc/spawn")
def spawn_agent(payload: SpawnPayload):
    """Spawn a subagent — runs a headless Claude turn on the supplied goal."""
    goal = payload.goal
    if payload.skills:
        goal += "\n\n[Operator suggested skills: " + ", ".join(payload.skills) + "]"
    try:
        resp = run_claude(goal, model=payload.model, timeout=120)
    except ClaudeError as e:
        raise HTTPException(status_code=502, detail=f"Claude: {e}")
    return {"message": resp["result"]}


# Attachments uploaded from the chat UI are written here so the Claude agent can
# read them by absolute path. Lives under the system temp dir; cleaned opportunistically.
UPLOAD_DIR = Path(tempfile.gettempdir()) / "mission-control-uploads"

# Cap a single decoded attachment to keep a runaway base64 payload from filling disk.
_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024  # 25 MB


def _safe_filename(name: str) -> str:
    """Strip path components and unsafe chars from a client-supplied filename."""
    base = os.path.basename(name or "file")
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", base).strip("._") or "file"
    return cleaned[:120]


def save_attachments(attachments: list["AttachmentPayload"]) -> list[dict[str, Any]]:
    """Decode base64 attachments to disk and return their saved paths/metadata."""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    saved: list[dict[str, Any]] = []
    stamp = int(time.time() * 1000)
    for idx, att in enumerate(attachments):
        raw = att.data or ""
        if raw.startswith("data:") and "," in raw:
            raw = raw.split(",", 1)[1]  # strip the data: URL prefix
        try:
            blob = base64.b64decode(raw, validate=False)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Bad base64 for attachment '{att.name}'")
        if len(blob) > _MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=413, detail=f"Attachment '{att.name}' exceeds 25 MB limit")
        fname = f"{stamp}-{idx}-{_safe_filename(att.name)}"
        dest = UPLOAD_DIR / fname
        dest.write_bytes(blob)
        saved.append({
            "name": att.name,
            "mime": att.mime or "application/octet-stream",
            "path": str(dest),
            "size": len(blob),
        })
    return saved


@app.post("/api/mc/chat")
def chat_message(payload: ChatPayload):
    """Send a message to Claude and return the response.

    Shells out to `claude -p <message> --output-format json` in headless mode
    (bypassing permissions so the agent can use its tools unattended) and
    persists the turn in the native SQLite session store. `session_id` resumes
    a prior conversation (`claude --resume <id>`), giving real memory.

    Attachments (images/files) are written to a temp dir and their absolute
    paths are appended to the prompt so Claude can open/read them with its own
    tools.
    """
    message = payload.message
    if payload.attachments:
        saved = save_attachments(payload.attachments)
        lines = [f"- {s['name']} ({s['mime']}): {s['path']}" for s in saved]
        note = (
            "\n\n[Operator attached {n} file(s). Absolute paths on this machine:\n"
            "{paths}\n"
            "Open/read them as needed to fulfil the request.]"
        ).format(n=len(saved), paths="\n".join(lines))
        message = (message + note).strip()

    # Skills the UI selected (if any) become a soft hint — Claude Code auto-loads
    # its own skills, so we surface the request rather than forcing a flag.
    if payload.skills:
        message += "\n\n[Operator suggested skills: " + ", ".join(payload.skills) + "]"

    try:
        resp = run_claude(
            message,
            session_id=payload.session_id,
            model=payload.model or mc_diag.current_model(DATA_DIR),
            timeout=180,
        )
    except ClaudeError as e:
        msg = str(e)
        status = 503 if "quota" in msg.lower() or "429" in msg else 502
        raise HTTPException(status_code=status, detail=f"Claude: {msg}")

    sid = resp.get("session_id") or payload.session_id
    answer = resp.get("result", "")

    # Persist the turn so the sessions list / transcript view stay in sync.
    if sid:
        SESSIONS.ensure_session(sid)
        SESSIONS.append_message(sid, "user", payload.message)
        SESSIONS.append_message(sid, "assistant", answer)

    return {
        "response": answer,
        "session_id": sid,
        "stderr": resp.get("stderr", ""),
        "success": True,
    }


# ---------------------------------------------------------------------------
# Sessions — the bridge's native SQLite session store.
# ---------------------------------------------------------------------------
def parse_session_id(stderr: str) -> Optional[str]:
    """Pull `session_id: <id>` out of the `claude` -Q stderr output."""
    m = re.search(r"session_id\s*:\s*(\S+)", stderr or "")
    return m.group(1) if m else None


def clean_chat_response(stdout: str) -> str:
    """Drop CLI noise (toolset warnings) from a chat response."""
    lines = [ln for ln in (stdout or "").splitlines() if not re.match(r"^\s*Warning:", ln)]
    return "\n".join(lines).strip()


def parse_sessions_table(text: str) -> list[dict[str, Any]]:
    """Parse a sessions-list table into records (legacy helper).

    The column set is adaptive (Title is dropped when no row has one, a Src
    column appears for multi-source windows), so we discover whatever columns
    the header presents and slice each row by their offsets — values with single
    spaces (e.g. "Last Active") survive intact.
    """
    lines = (text or "").splitlines()
    header_idx = next(
        (i for i, ln in enumerate(lines) if "Last Active" in ln and re.search(r"\bID\b", ln)),
        None,
    )
    if header_idx is None:
        return []
    header = lines[header_idx]
    # Header labels are separated by runs of 2+ spaces; a label itself may hold a
    # single space ("Last Active"). Capture each label and its start offset.
    labels = re.findall(r"\S(?:.*?\S)?(?=\s{2,}|$)", header)
    positions: list[tuple[str, int]] = []
    cur = 0
    for lab in labels:
        idx = header.index(lab, cur)
        positions.append((lab.strip(), idx))
        cur = idx + len(lab)

    out: list[dict[str, Any]] = []
    for ln in lines[header_idx + 1:]:
        if not ln.strip() or set(ln.strip()) <= set("─-"):
            continue
        rec: dict[str, str] = {}
        for j, (lab, start) in enumerate(positions):
            end = positions[j + 1][1] if j + 1 < len(positions) else len(ln)
            rec[lab] = ln[start:end].strip()
        sid = rec.get("ID", "").strip()
        if not sid:
            continue
        title = rec.get("Title", "")
        out.append({
            "id": sid,
            "title": "" if title in ("—", "-") else title,
            "preview": rec.get("Preview", ""),
            "last_active": rec.get("Last Active", ""),
            "source": rec.get("Src", rec.get("Source", "")),
        })
    return out


@app.get("/api/mc/sessions")
def sessions_list(limit: int = 100, source: Optional[str] = None):
    """List recent chat sessions (id, title, preview, relative last-active)."""
    return {"sessions": SESSIONS.list(limit=limit, source=source)}


@app.get("/api/mc/sessions/{session_id}")
def session_get(session_id: str):
    """Return a single session's full transcript + metadata for resuming/viewing."""
    obj = SESSIONS.get(session_id)
    if obj is None:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    return obj


@app.post("/api/mc/sessions/{session_id}/rename")
def session_rename(session_id: str, payload: SessionRenamePayload):
    """Set a session's title."""
    SESSIONS.rename(session_id, payload.title)
    return {"id": session_id, "title": payload.title, "success": True}


@app.delete("/api/mc/sessions/{session_id}")
def session_delete(session_id: str):
    """Delete a session and its transcript from the native store."""
    SESSIONS.delete(session_id)
    return {"id": session_id, "success": True}


# ---------------------------------------------------------------------------
# Local voice transcription (offline, via faster-whisper). Optional dependency:
#   pip install faster-whisper
# Lazy-loaded so the bridge starts fine without it; the UI falls back to the
# browser Web Speech API when this endpoint reports unavailable.
# ---------------------------------------------------------------------------
_whisper_model = None
_whisper_load_error: Optional[str] = None


def _whisper_installed() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:
        return False


def _get_whisper_model():
    """Load (once) and return the Whisper model, or None if unavailable.

    A failed load is recorded for /api/transcribe/status but NOT latched —
    the next call retries. (First-ever load downloads the model from the hub;
    a transient network failure there used to brick transcription until the
    bridge was restarted.)
    """
    global _whisper_model, _whisper_load_error
    if _whisper_model is not None:
        return _whisper_model
    try:
        from faster_whisper import WhisperModel
        size = os.environ.get("WHISPER_MODEL", "base.en")
        device = os.environ.get("WHISPER_DEVICE", "cpu")
        compute = os.environ.get("WHISPER_COMPUTE", "int8")
        _whisper_model = WhisperModel(size, device=device, compute_type=compute)
        _whisper_load_error = None
        return _whisper_model
    except Exception as exc:  # noqa: BLE001
        _whisper_load_error = str(exc)
        return None


@app.get("/api/transcribe/status")
def transcribe_status():
    """Report whether local Whisper transcription is available on this bridge."""
    return {
        "available": _whisper_installed(),
        "model": os.environ.get("WHISPER_MODEL", "base.en"),
        "loadError": _whisper_load_error,
    }


@app.post("/api/transcribe")
def transcribe(payload: TranscribePayload):
    """Transcribe a base64 audio clip to text using a local Whisper model."""
    if not _whisper_installed():
        raise HTTPException(
            status_code=503,
            detail="faster-whisper not installed on the bridge (pip install faster-whisper)",
        )
    model = _get_whisper_model()
    if model is None:
        raise HTTPException(status_code=500, detail=f"Whisper model failed to load: {_whisper_load_error}")

    raw = payload.audio or ""
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        blob = base64.b64decode(raw, validate=False)
    except Exception:
        raise HTTPException(status_code=400, detail="Bad base64 audio")
    if not blob:
        raise HTTPException(status_code=400, detail="Empty audio upload")

    mime = (payload.mime or "").lower()
    suffix = ".webm"
    if "ogg" in mime:
        suffix = ".ogg"
    elif "wav" in mime:
        suffix = ".wav"
    elif "mp4" in mime or "m4a" in mime:
        suffix = ".mp4"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(blob)
        tmp_path = tmp.name
    try:
        segments, _info = model.transcribe(tmp_path, language="en", vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments).strip()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return {"text": text}


@app.get("/api/mc/briefing")
def get_briefing():
    """Synthesize a live briefing from the native data layer."""
    # 1. Version / system status
    version_line = "Mission Control · Claude online"

    # 2. Tasks
    tasks: list[dict[str, Any]] = STORE.list_tasks()["tasks"]
    total = len(tasks)
    done = sum(1 for t in tasks if t.get("status") in ("done", "completed"))
    blocked = sum(1 for t in tasks if t.get("status") == "blocked")
    ready = sum(1 for t in tasks if t.get("status") == "ready")
    running = sum(1 for t in tasks if t.get("status") == "running")
    pending = sum(1 for t in tasks if t.get("status") in ("pending", "todo"))
    failed = sum(1 for t in tasks if t.get("status") == "failed")

    # 3. Agents / assignees
    agents: list[dict[str, Any]] = STORE.agents_with_counts()
    agent_count = len(agents)
    on_disk = sum(1 for a in agents if a.get("on_disk"))

    # 4. Cron jobs
    cron_jobs = STORE.list_cron()["jobs"]
    active_jobs = [j for j in cron_jobs if j.get("status") == "active"]
    job_count = len(cron_jobs)
    active_count = len(active_jobs)
    failed_jobs = [j for j in cron_jobs if "error" in (j.get("last_run", "") or "").lower() or "failed" in (j.get("last_run", "") or "").lower()]

    now_str = datetime.now().strftime("%Y.%m.%d · %H:%M ZULU")

    summary = (
        f"{version_line} — {total} mission{'s' if total != 1 else ''} in system, "
        f"{done} complete, {running} running, {blocked} blocked, {failed} failed. "
        f"{agent_count} agent profiles on disk. {active_count}/{job_count} cron jobs active."
    )

    trend: list[str] = []
    if ready > 0:
        trend.append(f"Queue depth: {ready} task{'s' if ready != 1 else ''} ready for dispatch.")
    if pending > 0:
        trend.append(f"Backlog: {pending} task{'s' if pending != 1 else ''} pending assignment.")
    if not trend:
        trend.append("No queued work. System at idle or steady-state.")

    fin: list[str] = [
        f"Agents: {agent_count} profiles ({on_disk} on disk).",
        f"Task velocity: {done} completed / {total} total.",
    ]
    if failed > 0:
        fin.append(f"Failure rate: {failed}/{total} ({(failed / total * 100):.0f}%).")
    else:
        fin.append("Failure rate: 0%.")

    arc: list[str] = [
        f"Cron coverage: {active_count} active, {job_count - active_count} inactive.",
    ]
    if failed_jobs:
        names = [j.get("name", j.get("id", "?")) for j in failed_jobs[:2]]
        arc.append(f"Last run error detected in: {', '.join(names)}.")
    else:
        arc.append("Last run status clean across all jobs.")

    forecast: list[str] = []
    for job in active_jobs[:3]:
        nxt = job.get("next_run", "—")
        forecast.append(f"{job.get('name', job.get('id', '?'))}: next run {nxt}")
    if not forecast:
        forecast.append("No scheduled jobs on the horizon.")

    prompts: list[str] = []
    if blocked > 0:
        prompts.append(f"Unblock {blocked} blocked task{'s' if blocked != 1 else ''} to restore flow.")
    if failed > 0:
        prompts.append(f"Review {failed} failed mission{'s' if failed != 1 else ''} for retry or close.")
    if ready > 0 and agent_count > 0:
        prompts.append(f"Dispatch ready queue ({ready}) to available runners.")
    if not prompts:
        prompts.append("System nominal. No immediate action required.")

    directives: list[dict[str, str]] = []
    # Build directives from real conditions
    if blocked > 0:
        directives.append({"sev": "WARN", "t": now_str, "msg": f"{blocked} blocked task{'s' if blocked != 1 else ''} detected. Recommend review and unblock."})
    if failed > 0:
        directives.append({"sev": "HIGH", "t": now_str, "msg": f"{failed} failed mission{'s' if failed != 1 else ''} in kanban. Inspect logs before retry."})
    if running == 0 and ready > 0:
        directives.append({"sev": "INFO", "t": now_str, "msg": f"{ready} task{'s' if ready != 1 else ''} ready but no active runners. Dispatch recommended."})
    if failed_jobs:
        directives.append({"sev": "WARN", "t": now_str, "msg": f"Cron job failure detected in {failed_jobs[0].get('name', failed_jobs[0].get('id', '?'))}. Check script path and delivery config."})
    if not directives:
        directives.append({"sev": "INFO", "t": now_str, "msg": "All systems nominal. No critical directives at this time."})

    return {
        "summary": summary,
        "trend": trend,
        "fin": fin,
        "arc": arc,
        "forecast": forecast,
        "prompts": prompts,
        "directives": directives,
    }


# ---------------------------------------------------------------------------
# Content Pipeline endpoint
# ---------------------------------------------------------------------------

CONTENT_KEYWORDS = re.compile(r"content|instagram|website|blog|post|creative", re.IGNORECASE)

@app.get("/api/content/pipeline")
def get_content_pipeline():
    """Return live content pipeline data derived from native kanban tasks."""
    tasks: list[dict[str, Any]] = STORE.list_tasks()["tasks"]

    # Filter tasks whose title or body matches content keywords
    content_tasks = [
        t for t in tasks
        if CONTENT_KEYWORDS.search(t.get("title", "") or "") or CONTENT_KEYWORDS.search(t.get("body", "") or "")
    ]

    # Campaigns = tasks that look like active content campaigns (non-draft statuses)
    campaigns = []
    # Drafts = pending/ready tasks
    drafts = []
    # Calendar = tasks with a scheduled date in title/body or just upcoming ready tasks
    calendar = []

    for t in content_tasks:
        task_id = t.get("id", "")
        title = t.get("title", "")
        body = t.get("body") or ""
        status = (t.get("status") or "").lower()
        assignee = t.get("assignee") or "Unassigned"
        priority = t.get("priority", 0)
        created_at = t.get("created_at")

        # Determine campaign status
        campaign_status: str
        if status in ("done", "completed"):
            campaign_status = "done"
        elif status == "running":
            campaign_status = "running"
        elif status == "blocked":
            campaign_status = "blocked"
        elif status == "failed":
            campaign_status = "failed"
        else:
            campaign_status = "ready"

        # Campaign card
        campaigns.append({
            "id": task_id,
            "title": title,
            "status": campaign_status,
            "assignee": assignee,
            "priority": priority,
            "platform": _detect_platform(title + " " + body),
        })

        # Draft queue entry
        if status in ("pending", "ready", "blocked", "failed"):
            drafts.append({
                "id": task_id,
                "title": title,
                "status": campaign_status,
                "assignee": assignee,
                "priority": priority,
                "platform": _detect_platform(title + " " + body),
            })

        # Calendar entry — try to extract a date from title/body, else use created_at + 1 day as placeholder
        scheduled = _extract_date(title + " " + body)
        if scheduled is None and created_at:
            scheduled = datetime.fromtimestamp(created_at).strftime("%Y-%m-%d")
        calendar.append({
            "id": task_id,
            "title": title,
            "date": scheduled or datetime.now().strftime("%Y-%m-%d"),
            "status": campaign_status,
            "platform": _detect_platform(title + " " + body),
        })

    # Merge the planned-post calendar (local store, Ayrshare-synced) with the
    # kanban-derived entries, then sort by date.
    for item in _load_store("calendar", []):
        calendar.append({
            "id": item.get("id"),
            "title": item.get("title", ""),
            "date": (item.get("date") or "")[:10],
            "status": item.get("status", "draft"),
            # Normalize through the same detector the kanban-derived entries use,
            # so the merged calendar doesn't mix code badges (IG/LI/TT) with raw
            # stored full names (instagram/linkedin) for the same platform.
            "platform": _detect_platform(item.get("platform") or ""),
            # Explicitly planned posts (vs dates derived from kanban tasks) —
            # the UI surfaces these first in the upcoming list.
            "planned": True,
            # Pass through the Higgsfield virality verdict (score/hook/risk +
            # the concrete improvement suggestions) so the analysis the operator
            # paid 1-3 min for actually reaches the card. Stripping it here left
            # the whole 🔮 verdict — including suggestions — invisible.
            "virality": item.get("virality"),
        })
    calendar.sort(key=lambda x: x["date"])

    return {
        "campaigns": campaigns,
        "drafts": drafts,
        "calendar": calendar,
    }


def _detect_platform(text: str) -> str:
    text_l = text.lower()
    # Full platform names match as substrings, but the short codes (ig/tt/x/li/yt)
    # must match as WHOLE WORDS. A bare `"ig" in text` fired inside ordinary words
    # ("agencies", "strategic"), `"tt"` inside "captions"/"twitter", `"li"` inside
    # "deliverables"/"pillars" — mislabeling the platform badge on >half the
    # Content Factory cards. Word-boundary the codes; keep operator shorthand
    # ("post for IG", "the TT cut") working (BUGHUNT iter #16).
    def code(abbr: str) -> bool:
        return re.search(rf"\b{abbr}\b", text_l) is not None
    if "instagram" in text_l or code("ig"):
        return "IG"
    if "tiktok" in text_l or code("tt"):
        return "TT"
    if "twitter" in text_l or code("x"):
        return "X"
    if "linkedin" in text_l or code("li"):
        return "LI"
    if "youtube" in text_l or code("yt"):
        return "YT"
    if "blog" in text_l or "website" in text_l:
        return "WEB"
    return "MULTI"


def _extract_date(text: str) -> str | None:
    # Look for ISO-like dates YYYY-MM-DD
    m = re.search(r"(\d{4}-\d{2}-\d{2})", text)
    if m:
        return m.group(1)
    # Look for MM/DD/YYYY or DD/MM/YYYY
    m = re.search(r"(\d{2}/\d{2}/\d{4})", text)
    if m:
        parts = m.group(1).split("/")
        return f"{parts[2]}-{parts[0]}-{parts[1]}"
    return None


# ---------------------------------------------------------------------------
# Local data-store endpoints (Phase 1)
# ---------------------------------------------------------------------------
# Local data stores (.mc/data/) — real, file-backed pipelines that both the
# dashboard and Claude agents (via these endpoints) read and write. No demo data.
# ---------------------------------------------------------------------------

DATA_DIR = Path(__file__).parent / ".mc" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Mission Control's own config home — platform/API keys live in MC_HOME/.env and
# global settings in MC_HOME/config.yaml. Self-contained: no dependency on any
# other tool's home directory. Override the location with the MC_HOME env var.
MC_HOME = Path(os.environ.get("MC_HOME", "")) if os.environ.get("MC_HOME") else (
    Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "mission-control"
    if os.name == "nt" else Path.home() / ".mission-control"
)
MC_HOME.mkdir(parents=True, exist_ok=True)


def _env_key(name: str, *aliases: str) -> str:
    for n in (name, *aliases):
        if os.environ.get(n):
            return os.environ[n]
    env_file = MC_HOME / ".env"
    if env_file.exists():
        try:
            for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() in (name, *aliases):
                    return v.strip().strip('"').strip("'")
        except Exception:
            pass
    return ""


def _load_store(name: str, default: Any) -> Any:
    p = DATA_DIR / f"{name}.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return default


def _save_store(name: str, data: Any) -> None:
    (DATA_DIR / f"{name}.json").write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def _http_json(method: str, url: str, payload: Optional[dict] = None,
               headers: Optional[dict] = None, timeout: int = 60) -> Any:
    """Minimal stdlib JSON HTTP client (Apify / Ayrshare)."""
    import urllib.request
    import urllib.error
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:400]
        raise HTTPException(status_code=502, detail=f"{url.split('/')[2]} HTTP {e.code}: {detail}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"request to {url.split('/')[2]} failed: {e}")


# ── Voice Link — ElevenLabs text-to-speech (Ghost Network's voice channel) ──
# STT is the local Whisper endpoint above (free); this is the speak-back half.
# The key is read like every other bridge secret: env var first, then
# MC_HOME/.env. The UI falls back to the browser's speechSynthesis when
# this reports unavailable, so the feature degrades to free instead of broken.

ELEVEN_DEFAULT_VOICE = os.environ.get("ELEVENLABS_VOICE_ID", "pNInz6obpgDQGcFmaJgB")  # "Adam"
ELEVEN_DEFAULT_MODEL = os.environ.get("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5")  # cheapest: 0.5 credits/char
# Hard cap per request so one long agent reply can't burn the credit balance.
TTS_MAX_CHARS = int(os.environ.get("ELEVENLABS_MAX_CHARS", "2400"))


class TTSPayload(BaseModel):
    text: str
    voice_id: Optional[str] = None


def _eleven_key() -> str:
    return _env_key("ELEVENLABS_API_KEY", "ELEVEN_API_KEY", "XI_API_KEY")


@app.get("/api/tts/status")
def tts_status():
    """Report whether ElevenLabs TTS is configured on this bridge."""
    return {
        "available": bool(_eleven_key()),
        "voice_id": ELEVEN_DEFAULT_VOICE,
        "model_id": ELEVEN_DEFAULT_MODEL,
        "max_chars": TTS_MAX_CHARS,
    }


@app.post("/api/tts")
def tts_synthesize(payload: TTSPayload):
    """Synthesize speech via ElevenLabs and return raw MP3 bytes."""
    key = _eleven_key()
    if not key:
        raise HTTPException(status_code=503, detail="ELEVENLABS_API_KEY not configured in the bridge environment")
    text = (payload.text or "").strip()[:TTS_MAX_CHARS]
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")
    import urllib.request
    import urllib.error
    voice = payload.voice_id or ELEVEN_DEFAULT_VOICE
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_64"
    body = json.dumps({"text": text, "model_id": ELEVEN_DEFAULT_MODEL}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("xi-api-key", key)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            audio = resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:400]
        raise HTTPException(status_code=502, detail=f"ElevenLabs HTTP {e.code}: {detail}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ElevenLabs request failed: {e}")
    return Response(content=audio, media_type="audio/mpeg")


# ── Leads — real local pipeline (agents POST here; CRM sync can come later) ──

class LeadPayload(BaseModel):
    name: str
    source: Optional[str] = "manual"
    status: Optional[str] = "new"
    score: Optional[int] = 50
    company: Optional[str] = None
    contact: Optional[str] = None
    notes: Optional[str] = None


@app.get("/api/mc/leads")
def get_leads():
    """Real leads from the local store (agents add via POST /api/mc/leads)."""
    return {"leads": _load_store("leads", []), "source": "local-store"}


@app.post("/api/mc/leads")
def add_lead(payload: LeadPayload):
    import uuid
    leads = _load_store("leads", [])
    lead = {
        "id": f"lead_{uuid.uuid4().hex[:8]}",
        "created_at": time.time(),
        **payload.model_dump(),
    }
    leads.insert(0, lead)
    _save_store("leads", leads)
    return {"lead": lead}


class LeadUpdatePayload(BaseModel):
    status: Optional[str] = None
    score: Optional[int] = None
    notes: Optional[str] = None


@app.put("/api/mc/leads/{lead_id}")
def update_lead(lead_id: str, payload: LeadUpdatePayload):
    leads = _load_store("leads", [])
    for lead in leads:
        if lead.get("id") == lead_id:
            for k, v in payload.model_dump(exclude_none=True).items():
                lead[k] = v
            _save_store("leads", leads)
            return {"lead": lead}
    raise HTTPException(status_code=404, detail=f"lead {lead_id} not found")


@app.delete("/api/mc/leads/{lead_id}")
def delete_lead(lead_id: str):
    leads = _load_store("leads", [])
    kept = [l for l in leads if l.get("id") != lead_id]
    if len(kept) == len(leads):
        raise HTTPException(status_code=404, detail=f"lead {lead_id} not found")
    _save_store("leads", kept)
    return {"deleted": lead_id}


# ── Content calendar — local store + Metricool auto-posting ──────────────────
# Metricool is the SOLE posting provider (replaced Buffer's ideas-only push and
# Ayrshare's scheduling, 2026-06-12). Preferred transport: DIRECT JSON-RPC to
# Metricool's MCP server with header auth (X-Mc-Auth) — deterministic, no LLM.
# A `claude` one-shot is the fallback when no API key is configured, but it
# proved unreliable from a headless bridge (hangs on MCP connect, and the model
# sometimes fabricates tool output instead of calling the tool).

METRICOOL_MCP_URL = "https://ai.metricool.com/mcp"
METRICOOL_API_KEY = _env_key("METRICOOL_API_KEY", "METRICOOL_USER_TOKEN")


def _metricool_mcp(tool: str, arguments: Optional[dict] = None) -> Any:
    """Call one Metricool MCP tool over streamable-HTTP JSON-RPC (initialize →
    initialized → tools/call). Returns the tool's structured/parsed payload."""
    import urllib.request
    import urllib.error
    if not METRICOOL_API_KEY:
        raise HTTPException(status_code=400,
                            detail="METRICOOL_API_KEY not set — copy it from Metricool Settings → API and add it to MC_HOME/.env")

    def post(payload: dict, session: Optional[str] = None) -> tuple[Any, Optional[str]]:
        req = urllib.request.Request(METRICOOL_MCP_URL, data=json.dumps(payload).encode("utf-8"), method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json, text/event-stream")
        req.add_header("X-Mc-Auth", METRICOOL_API_KEY)
        if session:
            req.add_header("Mcp-Session-Id", session)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                sid = resp.headers.get("Mcp-Session-Id") or session
                ctype = resp.headers.get("Content-Type") or ""
                text = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            raise HTTPException(status_code=502,
                                detail=f"metricool mcp HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:300]}")
        if not text.strip():
            return None, sid
        if "text/event-stream" in ctype:
            # take the last data: chunk — servers may stream progress first
            chunks = [ln[5:].strip() for ln in text.splitlines() if ln.startswith("data:") and ln[5:].strip()]
            return (json.loads(chunks[-1]) if chunks else None), sid
        return json.loads(text), sid

    _, sid = post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-03-26", "capabilities": {},
        "clientInfo": {"name": "mission-control-bridge", "version": "1.0"},
    }})
    post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
    msg, _ = post({"jsonrpc": "2.0", "id": 2, "method": tool if tool.endswith("/list") else "tools/call",
                   "params": {} if tool.endswith("/list") else {"name": tool, "arguments": arguments or {}}}, sid)
    if msg is None:
        raise HTTPException(status_code=502, detail="metricool mcp returned no payload")
    if msg.get("error"):
        raise HTTPException(status_code=502, detail=f"metricool mcp error: {json.dumps(msg['error'])[:300]}")
    res = msg.get("result") or {}
    if res.get("isError"):
        raise HTTPException(status_code=502, detail=f"metricool tool '{tool}' error: {json.dumps(res)[:300]}")
    if "structuredContent" in res:
        return res["structuredContent"]
    for block in res.get("content") or []:
        if block.get("type") == "text":
            txt = block.get("text", "")
            try:
                return json.loads(txt)
            except json.JSONDecodeError:
                return txt
    return res


@app.get("/api/metricool/mcp-tools")
def get_metricool_mcp_tools():
    """tools/list passthrough — used to discover exact tool input schemas."""
    return _metricool_mcp("tools/list")


def _metricool_brand() -> dict:
    """First synced brand from the local cache (POST /api/metricool/brands)."""
    cache = _load_store("metricool-brands", None)
    brands = (cache or {}).get("brands") or []
    if not brands:
        raise HTTPException(status_code=400,
                            detail="Metricool brands not synced — POST /api/metricool/brands once (needs the metricool MCP)")
    return brands[0]


def _metricool_schedule(item: dict) -> dict:
    """Schedule a post via Metricool createScheduledPost (auto-publishes at the
    planned time). Media must be publicly hosted URLs — Higgsfield-generated
    media already is; locally staged files are not reachable by Metricool."""
    brand = _metricool_brand()
    platform = (item.get("platform") or "instagram").lower()
    networks = brand.get("networks") or {}
    if networks and platform not in networks:
        raise HTTPException(status_code=400,
                            detail=f"'{platform}' is not connected in Metricool (connected: {', '.join(networks)})")
    urls = item.get("media_urls") or []
    if not urls and item.get("media_local"):
        raise HTTPException(status_code=400,
                            detail="attached media is only staged locally — Metricool needs public URLs (Higgsfield-generated media works as-is)")
    prompt = (
        "Use the metricool MCP. Schedule a post with createScheduledPost using EXACTLY these values:\n"
        f"- blog/brand id: {brand.get('blogId') or brand.get('id')}\n"
        f"- network: {platform}\n"
        f"- text: {json.dumps(item.get('body') or item.get('title'))}\n"
        f"- media URLs: {json.dumps(urls) if urls else '(none)'}\n"
        f"- publication date: {item.get('date')} — if this has no time of day, first call "
        f"getBestTimeToPostByNetwork for {platform} and use the best hour on that date\n"
        "- autoPublish: true (publish automatically, not a draft)\n"
        'Then output STRICT JSON only (no prose, no fences): {"id": "<scheduled post id>", '
        '"scheduled_for": "<final ISO datetime>", "status": "<status from metricool>"}'
    )
    return _llm_json(prompt, timeout=300)


@app.get("/api/metricool/brands")
def get_metricool_brands():
    """Cached connected-accounts map (refresh with POST)."""
    cache = _load_store("metricool-brands", None)
    if not cache:
        return {"available": False, "reason": "not synced yet — POST /api/metricool/brands"}
    return {"available": True, **cache}


_MC_NETWORKS = ("instagram", "threads", "tiktok", "facebook", "linkedin", "twitter",
                "x", "youtube", "pinterest", "bluesky", "gmb", "twitch")


def _normalize_metricool_brand(b: dict) -> dict:
    """Best-effort {name, blogId, networks} from a raw getBrandSettings brand."""
    networks: dict[str, str] = {}
    for net in _MC_NETWORKS:
        for key in (net, f"{net}UserName", f"{net}Handle", f"{net}Account", f"{net}_handle"):
            v = b.get(key)
            if isinstance(v, dict):
                v = v.get("username") or v.get("handle") or v.get("name")
            if isinstance(v, str) and v.strip():
                networks[net] = v.strip().lstrip("@")
                break
    return {
        "name": b.get("label") or b.get("name") or b.get("title") or "?",
        "blogId": b.get("blogId") or b.get("id"),
        "networks": networks,
    }


@app.post("/api/metricool/brands")
def sync_metricool_brands():
    """Pull brands + connected profiles from Metricool. Direct MCP call when
    METRICOOL_API_KEY is set; `claude` one-shot fallback otherwise (slow, LLM)."""
    if METRICOOL_API_KEY:
        raw = _metricool_mcp("getBrandSettings")
        raw_brands = raw if isinstance(raw, list) else \
            (raw.get("brands") or raw.get("data") or []) if isinstance(raw, dict) else []
        brands = [_normalize_metricool_brand(b) for b in raw_brands if isinstance(b, dict)]
        cache = {"synced_at": datetime.now().isoformat(), "via": "mcp-direct",
                 "brands": brands, "raw": raw_brands}
    else:
        prompt = (
            "Call the metricool MCP tool getBrandSettings. Output STRICT JSON only (no prose, no fences): "
            '{"brands": [{"name": "<brand name>", "blogId": <numeric id>, '
            '"networks": {"<network>": "<connected handle>", ...}}]}'
        )
        parsed = _llm_json(prompt, timeout=300)
        brands = parsed.get("brands") or []
        # Hallucination guard: a real Metricool blogId is numeric. The model has
        # been observed inventing plausible brands instead of calling the tool.
        for b in brands:
            try:
                int(str(b.get("blogId")))
            except (TypeError, ValueError):
                raise HTTPException(status_code=502,
                                    detail=f"non-numeric blogId {b.get('blogId')!r} — the model likely fabricated the data instead of calling the MCP; retry, or set METRICOOL_API_KEY for the deterministic path")
        cache = {"synced_at": datetime.now().isoformat(), "via": "claude-llm", "brands": brands}
    if not cache["brands"]:
        raise HTTPException(status_code=502, detail="getBrandSettings returned no brands — is the Metricool account connected?")
    _save_store("metricool-brands", cache)
    return {"available": True, **cache}


class CalendarItemPayload(BaseModel):
    title: str
    date: str  # ISO date or datetime
    platform: str = "instagram"
    body: Optional[str] = None
    status: Optional[str] = "draft"  # draft | scheduled | posted
    media_urls: Optional[list[str]] = None
    # When true, schedule the post via Metricool immediately on creation.
    publish: Optional[bool] = False


@app.get("/api/content/calendar")
def get_content_calendar():
    """Real calendar: local store + Metricool scheduling status. Posts pushed
    from here are stamped with metricool_id; the live queue is Metricool's."""
    items = _load_store("calendar", [])
    scheduler: dict[str, Any] = {
        "provider": "metricool",
        "configured": bool((_load_store("metricool-brands", None) or {}).get("brands")),
        "history": [
            {"id": i.get("metricool_id"), "title": i.get("title", "")[:90],
             "date": i.get("scheduled_for") or i.get("date"),
             "platform": i.get("platform", "?"), "status": i.get("status", "scheduled")}
            for i in items if i.get("metricool_id")
        ],
    }
    return {"calendar": items, "scheduler": scheduler}


@app.post("/api/content/calendar")
def add_calendar_item(payload: CalendarItemPayload):
    import uuid
    items = _load_store("calendar", [])
    item = {
        "id": f"cal_{uuid.uuid4().hex[:8]}",
        "created_at": time.time(),
        **payload.model_dump(exclude={"publish"}),
    }
    if payload.publish:
        resp = _metricool_schedule(item)
        item["status"] = "scheduled"
        item["metricool_id"] = resp.get("id")
        item["scheduled_for"] = resp.get("scheduled_for")
    items.append(item)
    items.sort(key=lambda x: x.get("date", ""))
    _save_store("calendar", items)
    return {"item": item}


# ── Media + scheduling — upload video/images in the dashboard, attach them to
# calendar items, then schedule the actual social post through Metricool.
# Locally staged media is for drafting/preview only: Metricool needs publicly
# hosted URLs (Higgsfield-generated media qualifies; localhost does not). ─────

MEDIA_DIR = DATA_DIR / "media"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_MAX_BYTES = 120 * 1024 * 1024  # 120 MB — covers typical reels


class MediaUploadPayload(BaseModel):
    name: str
    data: str  # base64 (raw or data: URL)
    mime: Optional[str] = None


@app.post("/api/content/media")
def upload_media(payload: MediaUploadPayload):
    import uuid
    raw = payload.data
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[-1]
    try:
        blob = base64.b64decode(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid base64 payload")
    if len(blob) > MEDIA_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"file exceeds {MEDIA_MAX_BYTES // (1024*1024)} MB cap")
    safe = re.sub(r"[^\w.\-]", "_", payload.name)[-90:] or "upload.bin"
    media_id = f"{uuid.uuid4().hex[:10]}_{safe}"
    (MEDIA_DIR / media_id).write_bytes(blob)
    return {"media_id": media_id, "bytes": len(blob), "url": f"/api/content/media/{media_id}"}


@app.get("/api/content/media/{media_id}")
def serve_media(media_id: str):
    from fastapi.responses import FileResponse
    p = MEDIA_DIR / re.sub(r"[^\w.\-]", "_", media_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="media not found")
    return FileResponse(p)


class AttachMediaPayload(BaseModel):
    media_ids: list[str]


@app.put("/api/content/calendar/{item_id}/media")
def attach_calendar_media(item_id: str, payload: AttachMediaPayload):
    items = _load_store("calendar", [])
    for item in items:
        if item.get("id") == item_id:
            existing = item.get("media_local") or []
            item["media_local"] = existing + [m for m in payload.media_ids if m not in existing]
            _save_store("calendar", items)
            return {"item": item}
    raise HTTPException(status_code=404, detail=f"calendar item {item_id} not found")


@app.post("/api/content/calendar/{item_id}/schedule")
def schedule_calendar_item(item_id: str):
    """The real posting hop: book the post with Metricool for the item's date —
    Metricool auto-publishes at that time, no human click needed."""
    items = _load_store("calendar", [])
    item = next((i for i in items if i.get("id") == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail=f"calendar item {item_id} not found")
    resp = _metricool_schedule(item)
    item["status"] = "scheduled"
    item["metricool_id"] = resp.get("id")
    item["scheduled_for"] = resp.get("scheduled_for")
    _save_store("calendar", items)
    return {"item": item, "metricool": resp}


@app.delete("/api/content/calendar/{item_id}")
def delete_calendar_item(item_id: str):
    items = _load_store("calendar", [])
    kept = [i for i in items if i.get("id") != item_id]
    if len(kept) == len(items):
        raise HTTPException(status_code=404, detail=f"calendar item {item_id} not found")
    _save_store("calendar", kept)
    return {"deleted": item_id}


@app.post("/api/content/calendar/{item_id}/predict-virality")
def predict_calendar_virality(item_id: str):
    """Advisory virality QA on the item's produced video: a one-shot Claude
    session runs it through Higgsfield's virality predictor MCP and the
    verdict is stamped on the item. Never blocks scheduling — the threshold
    stays human until predicted vs. actual engagement has been compared."""
    items = _load_store("calendar", [])
    item = next((i for i in items if i.get("id") == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail=f"calendar item {item_id} not found")
    urls = list(item.get("media_urls") or [])
    if not urls:
        raise HTTPException(status_code=400, detail="no media to analyze — the item needs a publicly hosted media URL (Higgsfield-generated media works as-is)")
    prompt = (
        "Use the higgsfield MCP tools: import this video with media_import_url, then run "
        f"virality_predictor on it. Video: {urls[0]} . Target platform: {item.get('platform', 'instagram')}. "
        "From the predictor output produce STRICT JSON (no markdown fences, no prose): "
        '{"score": <0-100 overall virality>, "hook_strength": "<one line>", '
        '"retention_risk": "<one line>", "verdict": "<post|revise>", '
        '"suggestions": ["<concrete improvement>", ...]}'
    )
    parsed = _llm_json(prompt, timeout=600)
    item["virality"] = {
        "predicted_at": datetime.now().isoformat(),
        "media_url": urls[0],
        "score": parsed.get("score"),
        "hook_strength": parsed.get("hook_strength", ""),
        "retention_risk": parsed.get("retention_risk", ""),
        "verdict": parsed.get("verdict", ""),
        "suggestions": (parsed.get("suggestions") or [])[:5],
    }
    _save_store("calendar", items)
    return {"item": item}


# ── Creator intel — Apify scraping of niche creators for viral-content signals ─

# Trend windows in short-form are days, not months: anything older than this
# is noise for the Idea Engine, so it's filtered both at the Apify actor and
# again locally (Instagram pinned posts leak through the actor-side filter).
RECENCY_MAX_AGE_DAYS = 30
# Within the window, freshness halves the score every N days.
VIRAL_DECAY_HALF_LIFE_DAYS = 7.0


def _post_age_days(posted_at: Any) -> Optional[float]:
    """Age in days from an IG ISO timestamp or a TikTok unix epoch (s or ms)."""
    if posted_at is None:
        return None
    try:
        if isinstance(posted_at, (int, float)) or (isinstance(posted_at, str) and posted_at.isdigit()):
            ts = float(posted_at)
            if ts > 1e12:  # milliseconds
                ts /= 1000.0
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(posted_at).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        return max(0.0, (datetime.now(timezone.utc) - dt).total_seconds() / 86400.0)
    except (ValueError, OSError, OverflowError):
        return None


APIFY_TOKEN = _env_key("APIFY_API_TOKEN", "APIFY_TOKEN")
# Actor per platform; run-sync-get-dataset-items returns scraped items directly.
# instagram-post-scraper returns POST items (likes/comments per post) — the
# profile scraper only returns account objects, useless for viral ranking.
APIFY_ACTORS = {
    "instagram": "apify~instagram-post-scraper",
    "tiktok": "clockworks~tiktok-scraper",
}


class CreatorPayload(BaseModel):
    handle: str
    platform: str = "instagram"
    niche: Optional[str] = None


@app.get("/api/creators")
def get_creators():
    """Watchlist + last scraped viral-signal feed."""
    return {
        "configured": bool(APIFY_TOKEN),
        "watchlist": _load_store("creators-watchlist", []),
        "feed": _load_store("creators-feed", {"scraped_at": None, "items": []}),
    }


@app.post("/api/creators/watch")
def watch_creator(payload: CreatorPayload):
    wl = _load_store("creators-watchlist", [])
    handle = payload.handle.lstrip("@").strip()
    if any(w["handle"] == handle and w["platform"] == payload.platform for w in wl):
        raise HTTPException(status_code=409, detail=f"@{handle} already on the watchlist")
    wl.append({"handle": handle, "platform": payload.platform, "niche": payload.niche, "added_at": time.time()})
    _save_store("creators-watchlist", wl)
    return {"watchlist": wl}


@app.delete("/api/creators/watch/{platform}/{handle}")
def unwatch_creator(platform: str, handle: str):
    wl = _load_store("creators-watchlist", [])
    kept = [w for w in wl if not (w["handle"] == handle and w["platform"] == platform)]
    _save_store("creators-watchlist", kept)
    return {"watchlist": kept}


@app.post("/api/creators/scrape")
def scrape_creators():
    """Run Apify scrapers over the watchlist and rank posts by engagement.
    Slow (Apify actor runs take 1-4 min) — call on demand or from a cron."""
    if not APIFY_TOKEN:
        raise HTTPException(status_code=400, detail="APIFY_API_TOKEN not configured in the bridge environment")
    wl = _load_store("creators-watchlist", [])
    if not wl:
        raise HTTPException(status_code=400, detail="watchlist is empty — add creators first")

    items: list[dict] = []
    errors: list[str] = []
    by_platform: dict[str, list[str]] = {}
    for w in wl:
        by_platform.setdefault(w["platform"], []).append(w["handle"])

    for platform, handles in by_platform.items():
        actor = APIFY_ACTORS.get(platform)
        if not actor:
            errors.append(f"no Apify actor mapped for platform '{platform}'")
            continue
        if platform == "instagram":
            run_input = {"username": handles, "resultsLimit": 12,
                         "onlyPostsNewerThan": f"{RECENCY_MAX_AGE_DAYS} days"}
        else:  # tiktok
            run_input = {"profiles": handles, "resultsPerPage": 12, "shouldDownloadVideos": False,
                         "scrapeLastNDays": RECENCY_MAX_AGE_DAYS}
        try:
            data = _http_json(
                "POST",
                f"https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items?token={APIFY_TOKEN}&timeout=240",
                payload=run_input, timeout=280,
            )
            raw_items = data if isinstance(data, list) else []
            # Profile-shaped objects carry their posts under latestPosts — expand.
            expanded: list[dict] = []
            for it in raw_items:
                if isinstance(it.get("latestPosts"), list):
                    expanded.extend(it["latestPosts"])
                else:
                    expanded.append(it)
            dropped_old = 0
            for it in expanded:
                likes = it.get("likesCount") or it.get("diggCount") or 0
                comments = it.get("commentsCount") or it.get("commentCount") or 0
                views = it.get("videoViewCount") or it.get("playCount") or 0
                posted_at = it.get("timestamp") or it.get("createTime") or None
                # Hard local floor: actor-side date filters miss pinned posts,
                # and undated items can't be proven fresh — both are out.
                age = _post_age_days(posted_at)
                if age is None or age > RECENCY_MAX_AGE_DAYS:
                    dropped_old += 1
                    continue
                items.append({
                    "platform": platform,
                    "creator": it.get("ownerUsername") or it.get("authorMeta", {}).get("name") or "?",
                    "caption": (it.get("caption") or it.get("text") or "")[:280],
                    "url": it.get("url") or it.get("webVideoUrl") or "",
                    "likes": likes, "comments": comments, "views": views,
                    "posted_at": posted_at,
                    "age_days": round(age, 1),
                    # engagement weighted toward active signals; relative score added below
                    "engagement": int(likes + comments * 8 + views * 0.02),
                })
            if dropped_old:
                errors.append(f"{platform}: dropped {dropped_old} post(s) older than {RECENCY_MAX_AGE_DAYS}d or undated")
        except HTTPException as e:
            errors.append(f"{platform}: {e.detail}")

    # Viral score = outperformance × freshness. A post is measured against its
    # OWN creator's median engagement in this batch (so big accounts don't win
    # on size, and IG/TikTok scales cancel out), then decayed by age. 100 ≈ a
    # creator's fresh, baseline post; 500 ≈ a 5× breakout this week.
    baseline: dict[tuple[str, str], float] = {}
    for key in {(i["platform"], i["creator"]) for i in items}:
        vals = [float(i["engagement"]) for i in items if (i["platform"], i["creator"]) == key]
        baseline[key] = max(median(vals), 1.0)
    for i in items:
        rel = i["engagement"] / baseline[(i["platform"], i["creator"])]
        decay = 0.5 ** (i["age_days"] / VIRAL_DECAY_HALF_LIFE_DAYS)
        i["viral_score"] = round(rel * decay * 100, 1)

    items.sort(key=lambda x: x["viral_score"], reverse=True)
    feed = {"scraped_at": datetime.now().isoformat(), "items": items[:120], "errors": errors}
    _save_store("creators-feed", feed)
    return feed


# ── Consolidated AI digest — LLM-synthesized from Sentinel, ranked for virality ─

DIGEST_MAX_AGE_H = 12


@app.get("/api/mc/ai-digest")
def get_ai_digest():
    """Cached consolidated digest (regenerate with POST /api/mc/ai-digest)."""
    digest = _load_store("ai-digest", None)
    if not digest:
        return {"available": False, "reason": "not generated yet — POST /api/mc/ai-digest"}
    return {"available": True, **digest}


@app.post("/api/mc/ai-digest")
def generate_ai_digest():
    """Synthesize Sentinel's raw story links into ONE consolidated digest with
    viral-potential content ideas, via the `claude` CLI. Slow (LLM): 1-3 min."""
    latest = SENTINEL_CACHE_DIR / "latest.json"
    if not latest.exists():
        raise HTTPException(status_code=404, detail="no Sentinel digest cached yet — run the Sentinel cron first")
    stories = json.loads(latest.read_text(encoding="utf-8")).get("stories", [])[:25]
    if not stories:
        raise HTTPException(status_code=404, detail="Sentinel cache has no stories")
    story_lines = "\n".join(f"- {s['title']} ({s['source']}, score {s.get('score', 0)}) {s['url']}" for s in stories)
    prompt = (
        "You are the AI-news editor for a content creator in the AI/autonomous-agents niche. "
        "From the headlines below, produce STRICT JSON (no markdown fences, no prose) with this shape: "
        '{"summary": "<one tight paragraph consolidating today\'s AI news narrative>", '
        '"ideas": [{"title": "<content idea headline>", "angle": "<the specific viral hook/angle>", '
        '"why_viral": "<why this can go viral now>", "source_url": "<most relevant url>"}]} '
        "Pick the 5-7 stories with the highest viral potential for short-form content. Headlines:\n" + story_lines
    )
    parsed = _llm_json(prompt, timeout=240)
    digest = {
        "generated_at": datetime.now().isoformat(),
        "summary": parsed.get("summary", ""),
        "ideas": parsed.get("ideas", [])[:8],
        "story_count": len(stories),
    }
    _save_store("ai-digest", digest)
    return {"available": True, **digest}


# ── Idea Engine — the synthesis step: trending news × competitor viral
# patterns × the brand strategy doc → ranked, brand-grounded content ideas. ──

BRAND_DOC = Path(__file__).parent / "BRAND_STRATEGY.md"


def _idea_deck_view(ideas: dict) -> dict:
    """Deck = generated ideas minus used (acted on) minus skipped (disliked)."""
    gone = set(ideas.get("used", [])) | set(ideas.get("skipped", []))
    remaining = [i for i in ideas.get("ideas", []) if i.get("title") not in gone]
    return {"available": True, **{**ideas, "ideas": remaining, "used_count": len(gone)}}


def _gather_idea_inputs() -> tuple[str, str, str, dict]:
    """Shared inputs for idea generation: viral feed, news, brand doc."""
    feed = _load_store("creators-feed", {"items": []})
    viral = (feed.get("items") or [])[:12]
    stories = []
    latest = SENTINEL_CACHE_DIR / "latest.json"
    if latest.exists():
        stories = json.loads(latest.read_text(encoding="utf-8")).get("stories", [])[:12]
    brand = BRAND_DOC.read_text(encoding="utf-8", errors="replace")[:3000] if BRAND_DOC.exists() else ""
    viral_lines = "\n".join(
        f"- @{v['creator']} ({v['platform']}, ⚡{v.get('viral_score', 0)} = outperformance×freshness, "
        f"{v.get('age_days', '?')}d old, {v['likes']}L/{v['comments']}C/{v['views']}V): {v['caption'][:160]}"
        for v in viral
    ) or "(no creator signals scraped yet)"
    news_lines = "\n".join(f"- {s['title']} ({s['source']}, score {s.get('score', 0)})" for s in stories) or "(no news cached)"
    counts = {"viral_posts": len(viral), "news_stories": len(stories), "brand_doc": bool(brand)}
    return viral_lines, news_lines, brand, counts


def _llm_json(prompt: str, timeout: int = 240) -> dict:
    """Synthesize a JSON object via Claude. The single chokepoint behind every
    content endpoint (ideas, virality, digest, Metricool fallback)."""
    try:
        obj = claude_json(prompt, timeout=timeout)
    except ClaudeError as e:
        msg = str(e)
        if "quota" in msg.lower() or "429" in msg:
            raise HTTPException(status_code=503, detail="LLM quota exhausted (429). Wait for refresh.")
        raise HTTPException(status_code=502, detail=f"Claude: {msg}")
    if isinstance(obj, list):
        # Some prompts ask for a bare array; wrap so dict-typed callers don't break.
        return {"items": obj}
    if not isinstance(obj, dict):
        raise HTTPException(status_code=502, detail="model returned non-object JSON")
    return obj


@app.get("/api/content/ideas")
def get_content_ideas():
    ideas = _load_store("content-ideas", None)
    if not ideas:
        return {"available": False}
    return _idea_deck_view(ideas)


class ConsumeIdeaPayload(BaseModel):
    title: str


@app.post("/api/content/ideas/consume")
def consume_content_idea(payload: ConsumeIdeaPayload):
    """Mark an idea as used (planned / sent to Buffer / handed to an agent) so
    it leaves the deck. A regeneration deals a fresh deck."""
    ideas = _load_store("content-ideas", None)
    if not ideas:
        raise HTTPException(status_code=404, detail="no idea deck generated yet")
    used = ideas.get("used", [])
    if payload.title not in used:
        used.append(payload.title)
    ideas["used"] = used
    _save_store("content-ideas", ideas)
    return {"deck": _idea_deck_view(ideas)}


@app.post("/api/content/ideas/skip")
def skip_content_idea(payload: ConsumeIdeaPayload):
    """Skip = dislike. The idea leaves the deck, the dislike is remembered as
    taste (negative examples for future generations), and ONE replacement idea
    is generated against today's data, steering away from skipped angles.
    Slow (LLM): ~30-90s."""
    ideas = _load_store("content-ideas", None)
    if not ideas:
        raise HTTPException(status_code=404, detail="no idea deck generated yet")
    skipped = ideas.get("skipped", [])
    if payload.title not in skipped:
        skipped.append(payload.title)
    ideas["skipped"] = skipped
    _save_store("content-ideas", ideas)

    # Persist taste across decks (capped) — regenerations read this too.
    taste = _load_store("idea-taste", [])
    if payload.title not in [t.get("title") for t in taste]:
        taste.append({"title": payload.title, "at": time.time()})
    _save_store("idea-taste", taste[-50:])

    viral_lines, news_lines, brand, _counts = _gather_idea_inputs()
    existing = [i.get("title", "") for i in ideas.get("ideas", [])]
    avoid = skipped + [t["title"] for t in taste[-15:]]
    prompt = (
        "You are the content strategist for the brand below. The operator SKIPPED some ideas — treat those "
        "as negative taste examples and avoid similar angles. Produce STRICT JSON only (no fences): "
        '{"idea": {"title": "<punchy working title>", "platform": "instagram|tiktok|linkedin", '
        '"format": "<reel|carousel|post|thread>", "hook": "<first 2 seconds / first line>", '
        '"why_now": "<trending-news or timing tie-in>", "pattern_source": "<viral pattern it remixes, or \'original\'>"}} '
        "Give exactly ONE new high-viral-potential idea. It must be clearly different from ALL of these existing "
        f"titles: {json.dumps(existing)} and avoid angles similar to these SKIPPED/disliked ones: {json.dumps(avoid)}.\n\n"
        f"=== BRAND (excerpt) ===\n{brand}\n\n"
        f"=== NICHE VIRAL SIGNALS ===\n{viral_lines}\n\n"
        f"=== TRENDING AI NEWS ===\n{news_lines}"
    )
    parsed = _llm_json(prompt)
    new_idea = parsed.get("idea") or parsed  # tolerate a bare idea object
    if not new_idea.get("title"):
        raise HTTPException(status_code=502, detail=f"replacement idea malformed: {json.dumps(parsed)[:200]}")
    ideas = _load_store("content-ideas", ideas)  # reload in case of concurrent use
    ideas.setdefault("ideas", []).append(new_idea)
    _save_store("content-ideas", ideas)
    return {"deck": _idea_deck_view(ideas), "replacement": new_idea}


@app.post("/api/content/ideas")
def generate_content_ideas():
    """Fuse the three live inputs into a content strategy via the `claude` CLI:
    1. Viral creator posts (Apify feed) — what's working in the niche
    2. Trending AI news (Sentinel) — what's hot right now
    3. BRAND_STRATEGY.md — who we are and how we sound
    Skipped-idea taste history steers generations away from disliked angles.
    Deals a fresh deck (used/skipped reset). Slow (LLM): 1-3 min."""
    viral_lines, news_lines, brand, counts = _gather_idea_inputs()
    if not counts["viral_posts"] and not counts["news_stories"]:
        raise HTTPException(status_code=400, detail="no inputs yet — scrape creators (Content Factory) and/or run the Sentinel cron first")
    taste = _load_store("idea-taste", [])
    taste_note = ""
    if taste:
        taste_note = ("\n\nThe operator previously SKIPPED these ideas — avoid similar angles: "
                      + json.dumps([t["title"] for t in taste[-15:]]))

    prompt = (
        "You are the content strategist for the brand described below. Produce STRICT JSON only "
        "(no markdown fences, no prose outside JSON) with this shape: "
        '{"strategy_note": "<2-3 sentences: this week\'s content thesis connecting the news cycle and the niche patterns to OUR positioning>", '
        '"ideas": [{"title": "<punchy working title>", "platform": "instagram|tiktok|linkedin", '
        '"format": "<reel|carousel|post|thread>", "hook": "<the first 2 seconds / first line>", '
        '"why_now": "<the trending-news or timing tie-in>", '
        '"pattern_source": "<which viral pattern or creator signal this remixes, or \'original\'>"}]} '
        "Give 6 ideas ranked by viral potential. Every idea must be executable by an AI agent fleet brand "
        "(demos, hot takes, build-in-public, contrarian POVs) and sound like the brand voice."
        + taste_note + "\n\n"
        f"=== BRAND (excerpt) ===\n{brand}\n\n"
        f"=== NICHE VIRAL SIGNALS (scraped) ===\n{viral_lines}\n\n"
        f"=== TRENDING AI NEWS (Sentinel) ===\n{news_lines}"
    )
    parsed = _llm_json(prompt)
    result = {
        "generated_at": datetime.now().isoformat(),
        "strategy_note": parsed.get("strategy_note", ""),
        "ideas": parsed.get("ideas", [])[:8],
        "inputs": counts,
        # fresh deck — nothing used or skipped yet
        "used": [],
        "skipped": [],
    }
    _save_store("content-ideas", result)
    return {"available": True, **result}

@app.get("/api/mc/sentinel")
def get_mc_sentinel():
    """Alias to existing /api/sentinel/digest logic."""
    latest_path = SENTINEL_CACHE_DIR / "latest.json"
    if not latest_path.exists():
        script_path = Path(__file__).parent / "scripts" / "sentinel_news_pipeline.py"
        if script_path.exists():
            try:
                subprocess.run(
                    [sys.executable, str(script_path)],
                    capture_output=True,
                    text=True,
                    timeout=120,
                    creationflags=CREATE_NO_WINDOW,
                )
            except Exception:
                pass

    if latest_path.exists():
        try:
            with open(latest_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to parse digest: {str(e)}")

    raise HTTPException(status_code=404, detail="No digest available. Run the Sentinel cron or wait for next cycle.")


# ---------------------------------------------------------------------------
# Sentinel endpoints
# ---------------------------------------------------------------------------

SENTINEL_CACHE_DIR = Path(__file__).parent / ".mc" / "cache" / "sentinel"

@app.get("/api/sentinel/digest")
def get_sentinel_digest():
    """Return the latest Sentinel AI Daily Digest from cache."""
    latest_path = SENTINEL_CACHE_DIR / "latest.json"
    if not latest_path.exists():
        # Try to run the pipeline to generate today's digest
        script_path = Path(__file__).parent / "scripts" / "sentinel_news_pipeline.py"
        if script_path.exists():
            try:
                subprocess.run(
                    [sys.executable, str(script_path)],
                    capture_output=True,
                    text=True,
                    timeout=120,
                    creationflags=CREATE_NO_WINDOW,
                )
            except Exception:
                pass
    
    if latest_path.exists():
        try:
            with open(latest_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to parse digest: {str(e)}")
    
    raise HTTPException(status_code=404, detail="No digest available. Run the Sentinel cron or wait for next cycle.")


@app.get("/api/sentinel/archive")
def get_sentinel_archive(limit: int = 30):
    """Return metadata for past Sentinel digests."""
    digests = []
    for f in sorted(SENTINEL_CACHE_DIR.glob("digest_*.json"), reverse=True):
        date_str = f.stem.replace("digest_", "")
        try:
            stat = f.stat()
            digests.append({
                "date": date_str,
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
        except Exception:
            continue
    return {"digests": digests[:limit]}


@app.get("/api/sentinel/digest/{date}")
def get_sentinel_digest_by_date(date: str):
    """Return a specific day's Sentinel digest."""
    cache_path = SENTINEL_CACHE_DIR / f"digest_{date}.json"
    if not cache_path.exists():
        raise HTTPException(status_code=404, detail=f"No digest found for {date}")
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse digest: {str(e)}")


# ---------------------------------------------------------------------------
# Capability endpoints — Claude backend surface for Mission Control
# ---------------------------------------------------------------------------
# All parsers are tolerant: they extract what they can from the human-readable
# CLI tables and ALWAYS include the raw text so the UI can fall back to it.

_BOX_VERT = ("│", "┃", "|")


def _split_table_row(line: str) -> list[str]:
    """Split a box-drawing table row into trimmed cells."""
    for ch in _BOX_VERT[:2]:
        if ch in line:
            return [c.strip() for c in line.strip().strip(ch).split(ch)]
    return []


def _cols(line: str) -> list[str]:
    """Split a plain table row on runs of 2+ spaces."""
    return [c.strip() for c in re.split(r"\s{2,}", line.strip()) if c.strip()]


@app.get("/api/mc/overview")
def get_mc_overview():
    """Claude backend overview — model, MCP connectors, auth."""
    return mc_diag.overview(DATA_DIR)


@app.get("/api/mc/skills")
def get_mc_skills():
    """Installed Claude Code skills, scanned from the skills directories."""
    return mc_diag.skills(_SKILLS_ROOTS)


@app.get("/api/mc/mcp")
def get_mc_mcp():
    """Configured MCP servers (`claude mcp list`)."""
    return mc_diag.mcp_servers()


@app.post("/api/mc/mcp/{name}/test")
def test_mc_mcp(name: str):
    """Probe an MCP server (`claude mcp get <name>`)."""
    return mc_diag.mcp_test(name)


@app.get("/api/mc/plugins")
def get_mc_plugins():
    """Plugins are managed by Claude Code — graceful empty surface."""
    return mc_diag.plugins()


@app.post("/api/mc/plugins/{name}/enable")
def enable_mc_plugin(name: str):
    return {"message": "Plugins are managed by Claude Code (/plugin)."}


@app.post("/api/mc/plugins/{name}/disable")
def disable_mc_plugin(name: str):
    return {"message": "Plugins are managed by Claude Code (/plugin)."}


GATEWAY_API_PORT = int(os.environ.get("MC_GATEWAY_API_PORT", "8642"))


def _gateway_api_alive() -> bool:
    """Authoritative gateway liveness: its api_server answering on 8642.
    Process scans lie — a TTY-less direct-spawned gateway can hang forever
    without ever binding the port, and transient gateway CLI calls
    match the CLI's own process heuristics."""
    import socket
    try:
        with socket.create_connection(("127.0.0.1", GATEWAY_API_PORT), timeout=1.5):
            return True
    except OSError:
        return False


@app.get("/api/mc/gateway")
def get_mc_gateway():
    """No gateway under Claude — graceful empty status."""
    return mc_diag.gateway()


class GatewayActionPayload(BaseModel):
    action: str  # start | stop | restart


@app.post("/api/mc/gateway/action")
def gateway_action(payload: GatewayActionPayload):
    return mc_diag.gateway_action(payload.action)


# ---------------------------------------------------------------------------
# Local patches — a legacy concept from the old backend. Mission Control runs
# natively on Claude Code with no local patch layer, so these endpoints report
# an empty, fully-applied state. Kept because the Diagnostics panel calls them.
# ---------------------------------------------------------------------------

@app.get("/api/mc/patches")
def get_mc_patches():
    """No local patch layer under Claude — empty report."""
    return {"mc_dir": "", "mode": "check", "patches": [], "all_applied": True,
            "applicable": 0, "conflicts": 0}


@app.post("/api/mc/patches/apply")
def apply_mc_patches():
    """No local patches to apply under Claude."""
    return {"mc_dir": "", "mode": "apply", "patches": [], "all_applied": True,
            "applicable": 0, "conflicts": 0, "changed": 0, "gateway_restart_suggested": False}


@app.get("/api/mc/send/targets")
def get_send_targets():
    """Direct send is handled by MCP connectors under Claude — empty target list."""
    return mc_diag.send_targets()


class SendMessagePayload(BaseModel):
    target: str
    message: str
    subject: Optional[str] = None


@app.post("/api/mc/send")
def send_mc_message(payload: SendMessagePayload):
    """Platform delivery now goes through MCP connectors (Twilio, Metricool, …)."""
    return {"result": None,
            "message": "Direct send is handled by MCP connectors — use the relevant integration."}


@app.get("/api/mc/webhooks")
def get_mc_webhooks():
    """Webhooks are not used under Claude — graceful empty surface."""
    return mc_diag.webhooks()


@app.get("/api/mc/memory")
def get_mc_memory():
    """Claude memory directory status."""
    return mc_diag.memory(_CLAUDE_HOME / "projects")


@app.get("/api/mc/curator")
def get_mc_curator():
    """Skill curation is managed by Claude Code — graceful empty surface."""
    return mc_diag.curator()


@app.get("/api/mc/insights")
def get_mc_insights(days: int = 30):
    """Usage analytics derived from the native session store."""
    sessions = SESSIONS.list(limit=1000)
    msg_total = 0
    for s in sessions:
        detail = SESSIONS.get(s["id"])
        if detail:
            msg_total += detail.get("message_count", 0)
    return mc_diag.insights(days, len(sessions), msg_total, mc_diag.current_model(DATA_DIR))


@app.get("/api/mc/doctor")
def get_mc_doctor():
    """Claude-native health checks (CLI, MCP connectivity, stores)."""
    return mc_diag.doctor(DATA_DIR, Path(__file__).parent)


@app.get("/api/mc/logs")
def get_mc_logs(name: str = "agent", lines: int = 80, level: Optional[str] = None, since: Optional[str] = None):
    """Tail the bridge log (Claude has no separate agent/gateway logs)."""
    candidates = [Path(__file__).parent / "bridge.log",
                  Path(__file__).parent / ".mc" / "bridge.log"]
    text = ""
    for c in candidates:
        if c.exists():
            try:
                text = c.read_text(encoding="utf-8", errors="replace")
                break
            except OSError:
                continue
    out_lines = text.splitlines()[-max(1, min(lines, 500)):]
    return {"name": name, "lines": out_lines or ["(no bridge log yet)"]}


@app.get("/api/mc/model")
def get_mc_model():
    """Current Claude model + (no) fallback chain."""
    return mc_diag.model_info(DATA_DIR)


@app.get("/api/mc/auth")
def get_mc_auth():
    """Claude subscription auth — single Anthropic provider."""
    return mc_diag.auth()


@app.get("/api/mc/checkpoints")
def get_mc_checkpoints():
    """Checkpoints are managed by Claude Code."""
    return mc_diag.simple_raw("Checkpoints are managed by Claude Code (rewind / /resume).")


@app.get("/api/mc/pairing")
def get_mc_pairing():
    """No DM pairing under Claude."""
    return mc_diag.simple_raw("DM pairing is not used under Claude.")


@app.get("/api/mc/security/audit")
def run_security_audit():
    """Dependency audit — runs `npm audit` over the project, best-effort."""
    try:
        r = subprocess.run(["npm", "audit", "--json"], cwd=str(Path(__file__).parent),
                           capture_output=True, text=True, timeout=180,
                           encoding="utf-8", errors="replace",
                           creationflags=CREATE_NO_WINDOW, stdin=subprocess.DEVNULL)
        raw = r.stdout or r.stderr or ""
    except (subprocess.SubprocessError, OSError, FileNotFoundError):
        return {"vulnerabilities": 0, "raw": "npm audit unavailable."}
    vulns = 0
    try:
        data = json.loads(raw)
        vulns = (data.get("metadata", {}).get("vulnerabilities", {}) or {}).get("total", 0)
    except json.JSONDecodeError:
        vulns = len(re.findall(r"(CVE-\d{4}-\d+|GHSA-[\w-]+)", raw))
    return {"vulnerabilities": vulns, "raw": raw[:5000]}


# ---------------------------------------------------------------------------
# LLM model switcher
# ---------------------------------------------------------------------------
# Curated catalog: provider must already be configured in config.yaml or .env.
# key_env is checked at request time — a model is "enabled" only when its key
# resolves to a non-empty string.
MODEL_CATALOG = [
    # Kimi direct — KIMI_API_KEY + kimi-coding provider
    {"id": "kimi-k2.6",  "label": "Kimi K2.6",   "provider": "kimi-coding", "base_url": "https://api.kimi.com/coding", "key_env": "KIMI_API_KEY", "ctx_k": 128, "tags": ["coding", "fast"]},
    {"id": "kimi-k2.5",  "label": "Kimi K2.5",   "provider": "kimi-coding", "base_url": "https://api.kimi.com/coding", "key_env": "KIMI_API_KEY", "ctx_k": 128, "tags": ["coding"]},
    # Google AI direct — GOOGLE_API_KEY
    {"id": "gemini-2.5-pro",   "label": "Gemini 2.5 Pro",   "provider": "google", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "key_env": "GOOGLE_API_KEY", "ctx_k": 1048, "tags": ["long-context", "powerful"]},
    {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash", "provider": "google", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "key_env": "GOOGLE_API_KEY", "ctx_k": 1048, "tags": ["fast", "cheap"]},
    # OpenRouter — OPENROUTER_API_KEY (or providers.openrouter.api_key in config.yaml)
    {"id": "anthropic/claude-opus-4-8",    "label": "Claude Opus 4.8",      "provider": "openrouter", "base_url": None, "key_env": "OPENROUTER_API_KEY", "ctx_k": 200,  "tags": ["powerful"]},
    {"id": "anthropic/claude-sonnet-4-6",  "label": "Claude Sonnet 4.6",    "provider": "openrouter", "base_url": None, "key_env": "OPENROUTER_API_KEY", "ctx_k": 200,  "tags": ["balanced"]},
    {"id": "anthropic/claude-haiku-4-5",   "label": "Claude Haiku 4.5",     "provider": "openrouter", "base_url": None, "key_env": "OPENROUTER_API_KEY", "ctx_k": 200,  "tags": ["fast", "cheap"]},
    {"id": "google/gemini-2.5-pro",        "label": "Gemini 2.5 Pro",       "provider": "openrouter", "base_url": None, "key_env": "OPENROUTER_API_KEY", "ctx_k": 1048, "tags": ["long-context"]},
    {"id": "google/gemini-2.5-flash",      "label": "Gemini 2.5 Flash",     "provider": "openrouter", "base_url": None, "key_env": "OPENROUTER_API_KEY", "ctx_k": 1048, "tags": ["fast", "cheap"]},
    {"id": "x-ai/grok-3-beta",             "label": "Grok 3 Beta",          "provider": "openrouter", "base_url": None, "key_env": "OPENROUTER_API_KEY", "ctx_k": 131,  "tags": ["powerful"]},
    {"id": "deepseek/deepseek-r2",         "label": "DeepSeek R2",          "provider": "openrouter", "base_url": None, "key_env": "OPENROUTER_API_KEY", "ctx_k": 64,   "tags": ["reasoning"]},
    {"id": "meta-llama/llama-4-maverick",  "label": "Llama 4 Maverick",     "provider": "openrouter", "base_url": None, "key_env": "OPENROUTER_API_KEY", "ctx_k": 1000, "tags": ["open", "fast"]},
    {"id": "qwen/qwen3-235b-a22b",         "label": "Qwen 3 235B",          "provider": "openrouter", "base_url": None, "key_env": "OPENROUTER_API_KEY", "ctx_k": 40,   "tags": ["reasoning", "open"]},
    {"id": "mistralai/mistral-large-2411", "label": "Mistral Large",        "provider": "openrouter", "base_url": None, "key_env": "OPENROUTER_API_KEY", "ctx_k": 128,  "tags": ["balanced"]},
]


def _read_mc_config() -> dict:
    """Read the global Mission Control config.yaml. Returns empty dict on failure."""
    cfg_path = MC_HOME / "config.yaml"
    if not cfg_path.exists():
        return {}
    try:
        import yaml
        return yaml.safe_load(cfg_path.read_text(encoding="utf-8", errors="replace")) or {}
    except Exception:
        return {}


@app.get("/api/mc/models")
def get_models():
    """Return the Claude model catalog with the currently active model."""
    return mc_diag.models(DATA_DIR)


@app.put("/api/mc/models")
def set_model(payload: SetModelPayload):
    """Persist the active Claude model (used by chat / brain calls)."""
    try:
        return mc_diag.set_model(DATA_DIR, payload.model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=BRIDGE_PORT)
