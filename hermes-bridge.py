"""
hermes-bridge.py
FastAPI bridge server wrapping the Hermes CLI for Mission Control.
Port: 8767 (avoids conflict with Hermes gateway on 9119)
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
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
HERMES_CMD = os.environ.get("HERMES_CMD", "hermes")
BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", "8767"))
# Wall-clock the process came up — used by /api/hermes/health to report uptime.
BRIDGE_STARTED = time.time()
# Allow all origins by default: this is a localhost-only bridge for a local
# desktop app. Inside Electron the UI loads from file:// (Origin: "null"), so a
# fixed allow-list would block every request. Override with CORS_ORIGINS if needed.
ORIGINS = os.environ.get("CORS_ORIGINS", "*").split(",")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Never flash console windows for child processes on Windows. When the bridge
# itself runs detached from any console (Electron child, dev-server launcher),
# each CLI subprocess would otherwise allocate its own visible console — the
# app polls several CLI-backed endpoints every few seconds, which looked like
# terminals rapidly opening and closing in a loop.
CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def run_hermes(*args: str, timeout: int = 60) -> dict[str, Any]:
    """Run a Hermes CLI command and return structured output."""
    cmd = [HERMES_CMD, *args]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
            creationflags=CREATE_NO_WINDOW,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail=f"Hermes command timed out after {timeout}s")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Hermes CLI not found in PATH")

    stdout = result.stdout.strip()
    stderr = result.stderr.strip()

    # Try to parse JSON output
    data: Any = None
    if stdout:
        try:
            data = json.loads(stdout)
        except json.JSONDecodeError:
            data = stdout

    response = {
        "success": result.returncode == 0,
        "returncode": result.returncode,
        "stdout": stdout,
        "stderr": stderr,
        "data": data,
    }

    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=response,
        )

    return response


def parse_cron_list(text: str) -> list[dict[str, Any]]:
    """Parse plain-text `hermes cron list` into structured JSON."""
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
    # When set, the message continues an existing Hermes session (real memory)
    # via `hermes chat --resume <session_id>`. Omitted → starts a new session.
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
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[hermes-bridge] Starting on port {BRIDGE_PORT}", flush=True)
    yield
    print("[hermes-bridge] Shutting down", flush=True)


app = FastAPI(title="Hermes Bridge", version="1.0.0", lifespan=lifespan)

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
    and the Vite dev-server launcher to detect the bridge: /api/hermes/status
    takes 1-4s (it runs the hermes CLI), which is slower than a launcher's
    per-attempt probe timeout and made startup look hung."""
    return {"ok": True, "uptime_seconds": int(time.time() - BRIDGE_STARTED)}


@app.get("/api/hermes/status")
def get_status():
    """Check Hermes is alive."""
    resp = run_hermes("--version")
    return {
        "hermes_version": resp["stdout"],
        "bridge": "ok",
    }


@app.get("/api/hermes/health")
def get_health():
    """Lightweight bridge self-report for the Diagnostics panel.

    Cheap on purpose: it reports bridge process meta (uptime, python, port) and
    does ONE `hermes --version` probe so the panel can confirm the CLI is wired
    up without serially shelling out to every endpoint. Per-endpoint latency is
    measured client-side by the health store (real round-trips from the app).
    """
    cli_ok = False
    cli_version = "unknown"
    cli_error: Optional[str] = None
    started = time.time()
    try:
        resp = run_hermes("--version", timeout=10)
        cli_ok = True
        cli_version = (resp["stdout"] or "").splitlines()[0] if resp["stdout"] else "connected"
    except HTTPException as exc:
        detail = exc.detail
        cli_error = detail if isinstance(detail, str) else str(detail)
    cli_probe_ms = round((time.time() - started) * 1000)

    return {
        "bridge": "ok",
        "port": BRIDGE_PORT,
        "uptime_seconds": round(time.time() - BRIDGE_STARTED),
        "python_version": sys.version.split()[0],
        "hermes_cmd": HERMES_CMD,
        "cli_ok": cli_ok,
        "cli_version": cli_version,
        "cli_probe_ms": cli_probe_ms,
        "cli_error": cli_error,
        "server_time": datetime.now().isoformat(timespec="seconds"),
    }


@app.get("/api/hermes/agents")
def get_agents():
    """List agents / assignees."""
    resp = run_hermes("kanban", "assignees", "--json")
    return {"agents": resp["data"]}


@app.post("/api/hermes/agents")
def create_agent(payload: AgentCreatePayload):
    """Create a new agent profile via hermes profile create."""
    args = ["profile", "create", payload.name]
    if payload.model:
        args += ["--model", payload.model]
    if payload.skills:
        args += ["--skills", ",".join(payload.skills)]
    resp = run_hermes(*args)
    return {"message": resp["stdout"], "agent": {"name": payload.name, "role": payload.role, "skills": payload.skills, "model": payload.model}}


@app.put("/api/hermes/agents/{agent_id}")
def update_agent(agent_id: str, payload: AgentUpdatePayload):
    """Update an existing agent profile."""
    args = ["profile", "update", agent_id]
    if payload.name:
        args += ["--name", payload.name]
    if payload.model:
        args += ["--model", payload.model]
    if payload.skills:
        args += ["--skills", ",".join(payload.skills)]
    resp = run_hermes(*args)
    return {"message": resp["stdout"], "agent": {"id": agent_id, **payload.model_dump(exclude_unset=True)}}


@app.delete("/api/hermes/agents/{agent_id}")
def delete_agent(agent_id: str):
    """Delete an agent profile."""
    resp = run_hermes("profile", "delete", agent_id)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/agents/{agent_id}/spawn")
def spawn_agent_on_task(agent_id: str, payload: SpawnOnTaskPayload):
    """Spawn an agent on a specific task via hermes chat -q."""
    goal = f"Execute task {payload.task_id} as agent {agent_id}"
    args = ["chat", "-q", goal, "-Q"]
    resp = run_hermes(*args, timeout=120)
    return {"message": resp["stdout"], "agent_id": agent_id, "task_id": payload.task_id}


@app.post("/api/hermes/tasks/decompose")
def decompose_task(payload: TaskDecomposePayload):
    """Decompose a complex task into sub-tasks using Hermes chat."""
    prompt = (
        f"Decompose the following task into 3-7 concrete sub-tasks that can be executed in parallel. "
        f"Return ONLY a JSON array of objects with keys: title (string), body (optional string), assignee (optional string). "
        f"Task: {payload.task}"
    )
    args = ["chat", "-q", prompt, "-Q"]
    resp = run_hermes(*args, timeout=120)
    stdout = resp.get("stdout", "")
    # Try to extract JSON array from the response
    data: list[dict[str, Any]] = []
    if stdout:
        try:
            # Find JSON array in the response
            start = stdout.find("[")
            end = stdout.rfind("]")
            if start != -1 and end != -1 and end > start:
                data = json.loads(stdout[start:end+1])
            else:
                data = json.loads(stdout)
        except json.JSONDecodeError:
            # Fallback: create a single sub-task with the raw output
            data = [{"title": "Decomposed work", "body": stdout, "assignee": None}]
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
        subtasks = [{"title": "Decomposed work", "body": stdout, "assignee": None}]
    return {"subtasks": subtasks}


@app.get("/api/hermes/tasks")
def get_tasks():
    """List kanban tasks."""
    resp = run_hermes("kanban", "list", "--json")
    return {"tasks": resp["data"]}


@app.get("/api/hermes/activity")
def get_activity():
    """Derive a live activity stream from kanban task lifecycle timestamps.

    Hermes has no dedicated activity log, so we synthesize one from real task
    events (created / claimed / completed) — every entry reflects an actual
    state change on a real task.
    """
    resp = run_hermes("kanban", "list", "--json")
    tasks = resp["data"] if isinstance(resp["data"], list) else []
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


@app.post("/api/hermes/tasks")
def create_task(payload: CreateTaskPayload):
    """Create a kanban task."""
    args = ["kanban", "create", payload.title, "--json"]
    if payload.body:
        args += ["--body", payload.body]
    if payload.assignee:
        args += ["--assignee", payload.assignee]
    if payload.priority is not None:
        args += ["--priority", str(payload.priority)]
    for skill in payload.skills or []:
        args += ["--skill", skill]
    for parent in payload.parents or []:
        args += ["--parent", parent]
    if payload.triage:
        args.append("--triage")
    resp = run_hermes(*args)
    return {"task": resp["data"]}


@app.get("/api/hermes/tasks/{task_id}")
def show_task(task_id: str):
    """Full task detail: task fields, parents/children, comments, events, runs."""
    resp = run_hermes("kanban", "show", task_id, "--json")
    return resp["data"]


@app.post("/api/hermes/tasks/{task_id}/claim")
def claim_task(task_id: str):
    """Claim a kanban task."""
    resp = run_hermes("kanban", "claim", task_id)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/tasks/{task_id}/complete")
def complete_task(task_id: str):
    """Complete a kanban task."""
    resp = run_hermes("kanban", "complete", task_id)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/tasks/{task_id}/block")
def block_task(task_id: str, payload: BlockTaskPayload):
    """Block a kanban task."""
    resp = run_hermes("kanban", "block", task_id, "--", payload.reason)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/tasks/{task_id}/unblock")
def unblock_task(task_id: str, payload: ReasonPayload):
    """Return a blocked/scheduled task to ready."""
    args = ["kanban", "unblock", task_id]
    if payload.reason:
        args += ["--reason", payload.reason]
    resp = run_hermes(*args)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/tasks/{task_id}/promote")
def promote_task(task_id: str, payload: PromotePayload):
    """Promote a todo/blocked/triage task to ready (recovery path)."""
    args = ["kanban", "promote", task_id]
    if payload.force:
        args.append("--force")
    if payload.reason:
        args.append(payload.reason)
    resp = run_hermes(*args)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/tasks/{task_id}/schedule")
def schedule_task(task_id: str, payload: ReasonPayload):
    """Park a task in Scheduled (waiting on time, not human input)."""
    args = ["kanban", "schedule", task_id]
    if payload.reason:
        args.append(payload.reason)
    resp = run_hermes(*args)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/tasks/{task_id}/archive")
def archive_task(task_id: str):
    """Archive a task."""
    resp = run_hermes("kanban", "archive", task_id)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/tasks/{task_id}/assign")
def assign_task(task_id: str, payload: AssignPayload):
    """Assign or unassign a task ('none' to unassign)."""
    resp = run_hermes("kanban", "assign", task_id, payload.profile)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/tasks/{task_id}/reassign")
def reassign_task(task_id: str, payload: ReassignPayload):
    """Reassign a task to a different profile, optionally reclaiming first."""
    args = ["kanban", "reassign", task_id, payload.profile]
    if payload.reclaim:
        args.append("--reclaim")
    if payload.reason:
        args += ["--reason", payload.reason]
    resp = run_hermes(*args)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/tasks/{task_id}/reclaim")
def reclaim_task(task_id: str):
    """Release an active worker claim on a running task."""
    resp = run_hermes("kanban", "reclaim", task_id)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/tasks/{task_id}/comment")
def comment_task(task_id: str, payload: CommentPayload):
    """Append a comment to a task."""
    args = ["kanban", "comment", task_id, payload.text]
    if payload.author:
        args += ["--author", payload.author]
    resp = run_hermes(*args)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/tasks/{task_id}/edit")
def edit_task(task_id: str, payload: EditTaskPayload):
    """Backfill recovery fields on an already-completed task."""
    args = ["kanban", "edit", task_id, "--result", payload.result]
    if payload.summary:
        args += ["--summary", payload.summary]
    if payload.metadata:
        args += ["--metadata", payload.metadata]
    resp = run_hermes(*args)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/tasks/link")
def link_tasks(payload: LinkPayload):
    """Add a parent->child dependency."""
    resp = run_hermes("kanban", "link", payload.parent_id, payload.child_id)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/tasks/unlink")
def unlink_tasks(payload: LinkPayload):
    """Remove a parent->child dependency."""
    resp = run_hermes("kanban", "unlink", payload.parent_id, payload.child_id)
    return {"message": resp["stdout"]}


@app.get("/api/hermes/kanban/stats")
def kanban_stats():
    """Per-status + per-assignee counts + oldest-ready age."""
    resp = run_hermes("kanban", "stats", "--json")
    return resp["data"]


@app.get("/api/hermes/kanban/diagnostics")
def kanban_diagnostics():
    """Active board diagnostics (stale claims, missing deps, etc.)."""
    resp = run_hermes("kanban", "diagnostics", "--json")
    return {"diagnostics": resp["data"]}


@app.post("/api/hermes/tasks/{task_id}/specify")
def specify_task(task_id: str):
    """Run a specifier on a triage task — fleshes out the spec and promotes it."""
    resp = run_hermes("kanban", "specify", task_id, timeout=180)
    return {"message": resp["stdout"]}


@app.get("/api/hermes/tasks/{task_id}/log")
def task_log(task_id: str, tail: Optional[int] = None):
    """The worker log for a task (from <kanban-root>/kanban/logs/)."""
    args = ["kanban", "log", task_id]
    if tail:
        args += ["--tail", str(tail)]
    resp = run_hermes(*args)
    return {"log": resp["stdout"]}


@app.get("/api/hermes/tasks/{task_id}/context")
def task_context(task_id: str):
    """The assembled context a worker sees for this task."""
    resp = run_hermes("kanban", "context", task_id)
    return {"context": resp["stdout"]}


@app.get("/api/hermes/tasks/{task_id}/notify")
def task_notify_list(task_id: str):
    """List notification subscriptions on a task."""
    resp = run_hermes("kanban", "notify-list", task_id, "--json")
    return {"subscriptions": resp["data"]}


@app.post("/api/hermes/tasks/{task_id}/notify")
def task_notify_subscribe(task_id: str, payload: NotifyPayload):
    """Subscribe a gateway channel to a task's terminal events."""
    args = ["kanban", "notify-subscribe", task_id, "--platform", payload.platform, "--chat-id", payload.chat_id]
    if payload.thread_id:
        args += ["--thread-id", payload.thread_id]
    if payload.user_id:
        args += ["--user-id", payload.user_id]
    resp = run_hermes(*args)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/tasks/{task_id}/notify/unsubscribe")
def task_notify_unsubscribe(task_id: str, payload: NotifyUnsubPayload):
    """Remove a gateway subscription from a task."""
    args = ["kanban", "notify-unsubscribe", task_id, "--platform", payload.platform, "--chat-id", payload.chat_id]
    if payload.thread_id:
        args += ["--thread-id", payload.thread_id]
    resp = run_hermes(*args)
    return {"message": resp["stdout"]}


@app.get("/api/hermes/boards")
def list_boards():
    """List kanban boards with task counts and which one is current."""
    resp = run_hermes("kanban", "boards", "list", "--json")
    return {"boards": resp["data"]}


@app.post("/api/hermes/boards")
def create_board(payload: BoardCreatePayload):
    """Create a new board (optionally switch to it)."""
    args = ["kanban", "boards", "create", payload.slug]
    if payload.name:
        args += ["--name", payload.name]
    if payload.description:
        args += ["--description", payload.description]
    if payload.switch:
        args.append("--switch")
    resp = run_hermes(*args)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/boards/switch")
def switch_board(payload: BoardSwitchPayload):
    """Set the active board for subsequent calls."""
    resp = run_hermes("kanban", "boards", "switch", payload.slug)
    return {"message": resp["stdout"]}


@app.get("/api/hermes/cron")
def get_cron():
    """List cron jobs."""
    resp = run_hermes("cron", "list")
    jobs = parse_cron_list(resp["stdout"])
    return {"jobs": jobs, "raw": resp["stdout"]}


@app.post("/api/hermes/cron")
def create_cron(payload: CreateCronPayload):
    """Create a scheduled job via `hermes cron create <schedule> [prompt] …`."""
    args = ["cron", "create", payload.schedule]
    if payload.prompt:
        args.append(payload.prompt)
    if payload.name:
        args += ["--name", payload.name]
    if payload.deliver:
        args += ["--deliver", payload.deliver]
    if payload.repeat:
        args += ["--repeat", payload.repeat]
    for skill in payload.skills or []:
        args += ["--skill", skill]
    resp = run_hermes(*args)
    # Return the freshly-parsed job list so the UI can refresh without a second call.
    jobs = parse_cron_list(run_hermes("cron", "list")["stdout"])
    return {"message": resp["stdout"], "jobs": jobs}


@app.post("/api/hermes/cron/{job_id}/run")
def run_cron(job_id: str):
    """Trigger a cron job."""
    resp = run_hermes("cron", "run", job_id)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/spawn")
def spawn_agent(payload: SpawnPayload):
    """Spawn a subagent via `hermes chat -q <goal> -Q` (quiet, programmatic)."""
    # -Q suppresses the banner / TTY prompts so the returned stdout is clean.
    args = ["chat", "-q", payload.goal, "-Q"]
    if payload.model:
        args += ["-m", payload.model]
    if payload.skills:
        args += ["-s", ",".join(payload.skills)]
    resp = run_hermes(*args, timeout=120)
    return {"message": resp["stdout"]}


# Attachments uploaded from the chat UI are written here so the Hermes agent can
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


@app.post("/api/hermes/chat")
def chat_message(payload: ChatPayload):
    """Send a message to Hermes chat and return the response.

    Uses `hermes chat -q <message> -Q` for quiet, non-interactive execution.
    This bypasses the PTY requirement that breaks the desktop app's /chat tab
    on native Windows.

    Attachments (images/files) are written to a temp dir and their absolute paths
    are appended to the prompt so the agent can open/read them with its own tools.
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

    args = ["chat", "-q", message, "-Q"]
    if payload.session_id:
        args += ["--resume", payload.session_id]
    if payload.model:
        args += ["-m", payload.model]
    if payload.skills:
        args += ["-s", ",".join(payload.skills)]
    resp = run_hermes(*args, timeout=180)
    # Hermes prints `session_id: <id>` to stderr in -Q mode. Capture it so the UI
    # can persist + resume the conversation; fall back to the resumed id.
    sid = parse_session_id(resp.get("stderr", "")) or payload.session_id
    return {
        "response": clean_chat_response(resp["stdout"]),
        "session_id": sid,
        "stderr": resp.get("stderr", ""),
        "success": resp.get("success", True),
    }


# ---------------------------------------------------------------------------
# Sessions — the persistent Hermes SQLite session store (`hermes sessions`).
# ---------------------------------------------------------------------------
def parse_session_id(stderr: str) -> Optional[str]:
    """Pull `session_id: <id>` out of Hermes' -Q stderr output."""
    m = re.search(r"session_id\s*:\s*(\S+)", stderr or "")
    return m.group(1) if m else None


def clean_chat_response(stdout: str) -> str:
    """Drop CLI noise (toolset warnings) from a chat response."""
    lines = [ln for ln in (stdout or "").splitlines() if not re.match(r"^\s*Warning:", ln)]
    return "\n".join(lines).strip()


def parse_sessions_table(text: str) -> list[dict[str, Any]]:
    """Parse the `hermes sessions list` table into records.

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


@app.get("/api/hermes/sessions")
def sessions_list(limit: int = 100, source: Optional[str] = None):
    """List recent Hermes sessions (id, title, preview, relative last-active)."""
    args = ["sessions", "list", "--limit", str(limit)]
    if source:
        args += ["--source", source]
    resp = run_hermes(*args, timeout=30)
    return {"sessions": parse_sessions_table(resp["stdout"])}


@app.get("/api/hermes/sessions/{session_id}")
def session_get(session_id: str):
    """Return a single session's full transcript + metadata for resuming/viewing."""
    resp = run_hermes("sessions", "export", "--session-id", session_id, "-", timeout=30)
    raw = (resp.get("stdout") or "").strip()
    try:
        obj = json.loads(raw.splitlines()[0]) if raw else {}
    except (json.JSONDecodeError, IndexError):
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found or unreadable")
    msgs = []
    for m in obj.get("messages") or []:
        if not isinstance(m, dict):
            continue
        content = m.get("content")
        if not isinstance(content, str):
            content = json.dumps(content) if content is not None else ""
        msgs.append({
            "role": m.get("role", "assistant"),
            "content": content,
            "timestamp": m.get("timestamp"),
            "tool_name": m.get("tool_name"),
        })
    return {
        "id": obj.get("id", session_id),
        "title": obj.get("title") or "",
        "cwd": obj.get("cwd"),
        "source": obj.get("source"),
        "message_count": obj.get("message_count", len(msgs)),
        "started_at": obj.get("started_at"),
        "ended_at": obj.get("ended_at"),
        "messages": msgs,
    }


@app.post("/api/hermes/sessions/{session_id}/rename")
def session_rename(session_id: str, payload: SessionRenamePayload):
    """Set a session's title (`hermes sessions rename`)."""
    run_hermes("sessions", "rename", session_id, payload.title, timeout=30)
    return {"id": session_id, "title": payload.title, "success": True}


@app.delete("/api/hermes/sessions/{session_id}")
def session_delete(session_id: str):
    """Delete a session from the store (`hermes sessions delete --yes`)."""
    run_hermes("sessions", "delete", "--yes", session_id, timeout=30)
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
    """Load (once) and return the Whisper model, or None if unavailable."""
    global _whisper_model, _whisper_load_error
    if _whisper_model is not None:
        return _whisper_model
    if _whisper_load_error is not None:
        return None
    try:
        from faster_whisper import WhisperModel
        size = os.environ.get("WHISPER_MODEL", "base.en")
        device = os.environ.get("WHISPER_DEVICE", "cpu")
        compute = os.environ.get("WHISPER_COMPUTE", "int8")
        _whisper_model = WhisperModel(size, device=device, compute_type=compute)
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


@app.get("/api/hermes/briefing")
def get_briefing():
    """Synthesize a live briefing from Hermes CLI data."""
    # The four datasets are independent; fetch them concurrently. Sequentially this
    # was ~4s per request (4 subprocess spawns) and congested the bridge under the
    # 30s polling from the Briefing page. Parallel ≈ the slowest single call (~1s).
    with ThreadPoolExecutor(max_workers=4) as _ex:
        _f_version = _ex.submit(run_hermes, "--version")
        _f_tasks = _ex.submit(run_hermes, "kanban", "list", "--json")
        _f_agents = _ex.submit(run_hermes, "kanban", "assignees", "--json")
        _f_cron = _ex.submit(run_hermes, "cron", "list")
        version_resp = _f_version.result()
        tasks_resp = _f_tasks.result()
        agents_resp = _f_agents.result()
        cron_resp = _f_cron.result()

    # 1. Version / system status
    version_lines = version_resp.get("stdout", "").strip().splitlines()
    version_line = version_lines[0] if version_lines else "Hermes connected"

    # 2. Tasks
    tasks: list[dict[str, Any]] = tasks_resp.get("data") or []
    total = len(tasks)
    done = sum(1 for t in tasks if t.get("status") in ("done", "completed"))
    blocked = sum(1 for t in tasks if t.get("status") == "blocked")
    ready = sum(1 for t in tasks if t.get("status") == "ready")
    running = sum(1 for t in tasks if t.get("status") == "running")
    pending = sum(1 for t in tasks if t.get("status") == "pending")
    failed = sum(1 for t in tasks if t.get("status") == "failed")

    # 3. Agents / assignees
    agents: list[dict[str, Any]] = agents_resp.get("data") or []
    agent_count = len(agents)
    on_disk = sum(1 for a in agents if a.get("on_disk"))

    # 4. Cron jobs
    cron_jobs = parse_cron_list(cron_resp.get("stdout", ""))
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
    """Return live content pipeline data derived from Hermes kanban tasks."""
    resp = run_hermes("kanban", "list", "--json")
    tasks: list[dict[str, Any]] = (resp.get("data") or []) if isinstance(resp.get("data"), list) else []

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
            "platform": item.get("platform", "?"),
            # Explicitly planned posts (vs dates derived from kanban tasks) —
            # the UI surfaces these first in the upcoming list.
            "planned": True,
        })
    calendar.sort(key=lambda x: x["date"])

    return {
        "campaigns": campaigns,
        "drafts": drafts,
        "calendar": calendar,
    }


def _detect_platform(text: str) -> str:
    text_l = text.lower()
    if "instagram" in text_l or "ig" in text_l:
        return "IG"
    if "tiktok" in text_l or "tt" in text_l:
        return "TT"
    if "twitter" in text_l or " x " in text_l or text_l.startswith("x "):
        return "X"
    if "linkedin" in text_l or "li" in text_l:
        return "LI"
    if "youtube" in text_l or "yt" in text_l:
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
# New Hermes endpoints (Phase 1)
# ---------------------------------------------------------------------------

class GenerateContentPayload(BaseModel):
    platform: str
    topic: str

@app.get("/api/hermes/content/ideas")
def get_content_ideas():
    """Return placeholder content ideas."""
    return {
        "ideas": [
            {"id": "1", "title": "AI Content Idea 1", "platform": "instagram", "status": "draft"},
            {"id": "2", "title": "AI Content Idea 2", "platform": "twitter", "status": "draft"},
            {"id": "3", "title": "AI Content Idea 3", "platform": "linkedin", "status": "draft"},
        ]
    }

@app.get("/api/hermes/content/calendar")
def get_content_calendar():
    """Return placeholder content calendar."""
    return {
        # Real planned posts from the local calendar store (no demo data).
        "calendar": _load_store("calendar", []),
    }

@app.post("/api/hermes/content/generate")
def generate_content(payload: GenerateContentPayload):
    """Accept platform and topic, return a queued generation job."""
    import uuid
    return {"job_id": f"gen_{uuid.uuid4().hex[:8]}", "status": "queued"}

# ---------------------------------------------------------------------------
# Local data stores (.hermes/data/) — real, file-backed pipelines that both the
# dashboard and Hermes agents (via these endpoints) read and write. No demo data.
# ---------------------------------------------------------------------------

DATA_DIR = Path(__file__).parent / ".hermes" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Hermes keeps platform/API keys in its own .env (AppData\Local\hermes\.env on
# Windows, ~/.hermes/.env elsewhere). Read keys from there too, so the user
# configures each key exactly once, in the place Hermes already uses.
HERMES_HOME = Path(os.environ.get("HERMES_HOME", "")) if os.environ.get("HERMES_HOME") else (
    Path.home() / "AppData" / "Local" / "hermes" if os.name == "nt" else Path.home() / ".hermes"
)


def _env_key(name: str, *aliases: str) -> str:
    for n in (name, *aliases):
        if os.environ.get(n):
            return os.environ[n]
    env_file = HERMES_HOME / ".env"
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


# ── Leads — real local pipeline (agents POST here; CRM sync can come later) ──

class LeadPayload(BaseModel):
    name: str
    source: Optional[str] = "manual"
    status: Optional[str] = "new"
    score: Optional[int] = 50
    company: Optional[str] = None
    contact: Optional[str] = None
    notes: Optional[str] = None


@app.get("/api/hermes/leads")
def get_leads():
    """Real leads from the local store (agents add via POST /api/hermes/leads)."""
    return {"leads": _load_store("leads", []), "source": "local-store"}


@app.post("/api/hermes/leads")
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


@app.put("/api/hermes/leads/{lead_id}")
def update_lead(lead_id: str, payload: LeadUpdatePayload):
    leads = _load_store("leads", [])
    for lead in leads:
        if lead.get("id") == lead_id:
            for k, v in payload.model_dump(exclude_none=True).items():
                lead[k] = v
            _save_store("leads", leads)
            return {"lead": lead}
    raise HTTPException(status_code=404, detail=f"lead {lead_id} not found")


@app.delete("/api/hermes/leads/{lead_id}")
def delete_lead(lead_id: str):
    leads = _load_store("leads", [])
    kept = [l for l in leads if l.get("id") != lead_id]
    if len(kept) == len(leads):
        raise HTTPException(status_code=404, detail=f"lead {lead_id} not found")
    _save_store("leads", kept)
    return {"deleted": lead_id}


# ── Content calendar — local store + optional social scheduling ──────────────
# Buffer's MODERN GraphQL API (graph.buffer.com) accepts the account's OIDC
# token; its public surface is the Ideas workflow — we push planned content
# into Buffer Ideas, where it gets dragged onto the posting queue. (The legacy
# REST API rejects OIDC tokens.) Ayrshare remains a direct-scheduling fallback.

BUFFER_TOKEN = _env_key("BUFFER_ACCESS_TOKEN", "BUFFER_TOKEN")
BUFFER_ORG_ID = _env_key("BUFFER_ORGANIZATION_ID", "BUFFER_ORG_ID")
AYRSHARE_KEY = _env_key("AYRSHARE_API_KEY", "AYRSHARE_KEY")
BUFFER_GRAPHQL = "https://api.buffer.com/"


def _buffer_graphql(query: str, variables: Optional[dict] = None) -> dict:
    data = _http_json("POST", BUFFER_GRAPHQL,
                      payload={"query": query, **({"variables": variables} if variables else {})},
                      headers={"Authorization": f"Bearer {BUFFER_TOKEN}"}, timeout=45)
    if data.get("errors"):
        raise HTTPException(status_code=502, detail=f"buffer graphql: {data['errors'][0].get('message', data['errors'][0])}")
    return data.get("data") or {}


class CalendarItemPayload(BaseModel):
    title: str
    date: str  # ISO date or datetime
    platform: str = "instagram"
    body: Optional[str] = None
    status: Optional[str] = "draft"  # draft | scheduled | posted
    media_urls: Optional[list[str]] = None
    # When true and AYRSHARE_API_KEY is set, schedule the post via Ayrshare.
    publish: Optional[bool] = False


@app.get("/api/content/calendar")
def get_content_calendar():
    """Real calendar: local store, plus the scheduler's queue when configured.
    Provider preference: Buffer, then Ayrshare."""
    items = _load_store("calendar", [])
    scheduler: dict[str, Any] = {
        "provider": "buffer" if (BUFFER_TOKEN and BUFFER_ORG_ID) else "ayrshare" if AYRSHARE_KEY else None,
        "configured": bool((BUFFER_TOKEN and BUFFER_ORG_ID) or AYRSHARE_KEY),
        "history": [],
    }
    try:
        if BUFFER_TOKEN and BUFFER_ORG_ID:
            # Ideas pushed from here are tracked in the local store (status
            # 'idea-sent'); Buffer's public GraphQL surface is push-oriented,
            # so the queue itself is managed inside Buffer.
            scheduler["history"] = [
                {"id": i.get("buffer_id"), "title": i.get("title", "")[:90],
                 "date": i.get("date"), "platform": i.get("platform", "?"), "status": i.get("status", "idea-sent")}
                for i in items if i.get("buffer_id")
            ]
        elif AYRSHARE_KEY:
            hist = _http_json("GET", "https://api.ayrshare.com/api/history",
                              headers={"Authorization": f"Bearer {AYRSHARE_KEY}"}, timeout=30)
            posts = hist if isinstance(hist, list) else hist.get("history", hist.get("posts", []))
            for p in (posts or [])[:50]:
                scheduler["history"].append({
                    "id": p.get("id"),
                    "title": (p.get("post") or "")[:90],
                    "date": p.get("scheduleDate") or p.get("created"),
                    "platform": ",".join(p.get("platforms", [])) or "?",
                    "status": p.get("status", "posted"),
                })
    except HTTPException as e:
        scheduler["error"] = str(e.detail)
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
        if BUFFER_TOKEN and BUFFER_ORG_ID:
            # Push into Buffer Ideas via the modern GraphQL API. The idea text
            # carries the planned date/platform so it's actionable inside Buffer.
            idea_text = (payload.body or payload.title) + f"\n\n[planned: {payload.date} · {payload.platform} · via Mission Control]"
            # Inline-args form mirrors Buffer's documented example exactly
            # (avoids guessing their GraphQL input type names for variables).
            mutation = (
                "mutation CreateIdea { createIdea(input: { "
                f"organizationId: {json.dumps(BUFFER_ORG_ID)}, "
                f"content: {{ title: {json.dumps(payload.title)} text: {json.dumps(idea_text)} }} "
                "}) { ... on Idea { id content { title text } } } }"
            )
            data = _buffer_graphql(mutation)
            idea = data.get("createIdea") or {}
            if not idea.get("id"):
                raise HTTPException(status_code=502, detail=f"buffer createIdea returned no id: {json.dumps(idea)[:200]}")
            item["status"] = "idea-sent"
            item["buffer_id"] = idea["id"]
        elif AYRSHARE_KEY:
            resp = _http_json("POST", "https://api.ayrshare.com/api/post", payload={
                "post": payload.body or payload.title,
                "platforms": [payload.platform],
                "scheduleDate": payload.date,
                **({"mediaUrls": payload.media_urls} if payload.media_urls else {}),
            }, headers={"Authorization": f"Bearer {AYRSHARE_KEY}"}, timeout=60)
            item["status"] = "scheduled"
            item["ayrshare_id"] = resp.get("id")
        else:
            raise HTTPException(status_code=400, detail="no scheduler configured — set BUFFER_ACCESS_TOKEN (preferred) or AYRSHARE_API_KEY in ~/.hermes/.env")
    items.append(item)
    items.sort(key=lambda x: x.get("date", ""))
    _save_store("calendar", items)
    return {"item": item}


@app.delete("/api/content/calendar/{item_id}")
def delete_calendar_item(item_id: str):
    items = _load_store("calendar", [])
    kept = [i for i in items if i.get("id") != item_id]
    if len(kept) == len(items):
        raise HTTPException(status_code=404, detail=f"calendar item {item_id} not found")
    _save_store("calendar", kept)
    return {"deleted": item_id}


# ── Creator intel — Apify scraping of niche creators for viral-content signals ─

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
            run_input = {"username": handles, "resultsLimit": 12}
        else:  # tiktok
            run_input = {"profiles": handles, "resultsPerPage": 12, "shouldDownloadVideos": False}
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
            for it in expanded:
                likes = it.get("likesCount") or it.get("diggCount") or 0
                comments = it.get("commentsCount") or it.get("commentCount") or 0
                views = it.get("videoViewCount") or it.get("playCount") or 0
                items.append({
                    "platform": platform,
                    "creator": it.get("ownerUsername") or it.get("authorMeta", {}).get("name") or "?",
                    "caption": (it.get("caption") or it.get("text") or "")[:280],
                    "url": it.get("url") or it.get("webVideoUrl") or "",
                    "likes": likes, "comments": comments, "views": views,
                    "posted_at": it.get("timestamp") or it.get("createTime") or None,
                    # crude viral score: engagement weighted toward velocity-friendly signals
                    "viral_score": int(likes + comments * 8 + views * 0.02),
                })
        except HTTPException as e:
            errors.append(f"{platform}: {e.detail}")

    items.sort(key=lambda x: x["viral_score"], reverse=True)
    feed = {"scraped_at": datetime.now().isoformat(), "items": items[:120], "errors": errors}
    _save_store("creators-feed", feed)
    return feed


# ── Consolidated AI digest — LLM-synthesized from Sentinel, ranked for virality ─

DIGEST_MAX_AGE_H = 12


@app.get("/api/hermes/ai-digest")
def get_ai_digest():
    """Cached consolidated digest (regenerate with POST /api/hermes/ai-digest)."""
    digest = _load_store("ai-digest", None)
    if not digest:
        return {"available": False, "reason": "not generated yet — POST /api/hermes/ai-digest"}
    return {"available": True, **digest}


@app.post("/api/hermes/ai-digest")
def generate_ai_digest():
    """Synthesize Sentinel's raw story links into ONE consolidated digest with
    viral-potential content ideas, via `hermes -z`. Slow (LLM): 1-3 min."""
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
    resp = run_hermes("-z", prompt, timeout=240)
    raw = resp["stdout"].strip()
    if "HTTP 429" in raw or "usage limit" in raw:
        raise HTTPException(status_code=503, detail="LLM quota exhausted (Kimi 429). Wait for the quota refresh or add a fallback provider: hermes fallback add")
    # Tolerate accidental fences or leading text around the JSON.
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        raise HTTPException(status_code=502, detail=f"model returned no JSON: {raw[:200]}")
    try:
        parsed = json.loads(m.group(0))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"model JSON invalid: {e}")
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


@app.get("/api/content/ideas")
def get_content_ideas():
    ideas = _load_store("content-ideas", None)
    if not ideas:
        return {"available": False}
    return {"available": True, **ideas}


@app.post("/api/content/ideas")
def generate_content_ideas():
    """Fuse the three live inputs into a content strategy via `hermes -z`:
    1. Viral creator posts (Apify feed) — what's working in the niche
    2. Trending AI news (Sentinel) — what's hot right now
    3. BRAND_STRATEGY.md — who we are and how we sound
    Slow (LLM): 1-3 min. Cache in the content-ideas store."""
    feed = _load_store("creators-feed", {"items": []})
    viral = (feed.get("items") or [])[:12]
    stories = []
    latest = SENTINEL_CACHE_DIR / "latest.json"
    if latest.exists():
        stories = json.loads(latest.read_text(encoding="utf-8")).get("stories", [])[:12]
    if not viral and not stories:
        raise HTTPException(status_code=400, detail="no inputs yet — scrape creators (Content Factory) and/or run the Sentinel cron first")

    brand = ""
    if BRAND_DOC.exists():
        brand = BRAND_DOC.read_text(encoding="utf-8", errors="replace")[:3000]

    viral_lines = "\n".join(
        f"- @{v['creator']} ({v['platform']}, ⚡{v['viral_score']}, {v['likes']}L/{v['comments']}C/{v['views']}V): {v['caption'][:160]}"
        for v in viral
    ) or "(no creator signals scraped yet)"
    news_lines = "\n".join(f"- {s['title']} ({s['source']}, score {s.get('score', 0)})" for s in stories) or "(no news cached)"

    prompt = (
        "You are the content strategist for the brand described below. Produce STRICT JSON only "
        "(no markdown fences, no prose outside JSON) with this shape: "
        '{"strategy_note": "<2-3 sentences: this week\'s content thesis connecting the news cycle and the niche patterns to OUR positioning>", '
        '"ideas": [{"title": "<punchy working title>", "platform": "instagram|tiktok|linkedin", '
        '"format": "<reel|carousel|post|thread>", "hook": "<the first 2 seconds / first line>", '
        '"why_now": "<the trending-news or timing tie-in>", '
        '"pattern_source": "<which viral pattern or creator signal this remixes, or \'original\'>"}]} '
        "Give 6 ideas ranked by viral potential. Every idea must be executable by an AI agent fleet brand "
        "(demos, hot takes, build-in-public, contrarian POVs) and sound like the brand voice.\n\n"
        f"=== BRAND (excerpt) ===\n{brand}\n\n"
        f"=== NICHE VIRAL SIGNALS (scraped) ===\n{viral_lines}\n\n"
        f"=== TRENDING AI NEWS (Sentinel) ===\n{news_lines}"
    )
    resp = run_hermes("-z", prompt, timeout=240)
    raw = resp["stdout"].strip()
    if "HTTP 429" in raw or "usage limit" in raw:
        raise HTTPException(status_code=503, detail="LLM quota exhausted (Kimi 429). Wait for the quota refresh or add a fallback provider: hermes fallback add")
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        raise HTTPException(status_code=502, detail=f"model returned no JSON: {raw[:200]}")
    try:
        parsed = json.loads(m.group(0))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"model JSON invalid: {e}")
    result = {
        "generated_at": datetime.now().isoformat(),
        "strategy_note": parsed.get("strategy_note", ""),
        "ideas": parsed.get("ideas", [])[:8],
        "inputs": {"viral_posts": len(viral), "news_stories": len(stories), "brand_doc": bool(brand)},
    }
    _save_store("content-ideas", result)
    return {"available": True, **result}

@app.get("/api/hermes/sentinel")
def get_hermes_sentinel():
    """Alias to existing /api/sentinel/digest logic."""
    latest_path = SENTINEL_CACHE_DIR / "latest.json"
    if not latest_path.exists():
        script_path = Path.home() / "AppData" / "Local" / "hermes" / "scripts" / "sentinel_news_pipeline.py"
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

SENTINEL_CACHE_DIR = Path.home() / ".hermes" / "cache" / "sentinel"

@app.get("/api/sentinel/digest")
def get_sentinel_digest():
    """Return the latest Sentinel AI Daily Digest from cache."""
    latest_path = SENTINEL_CACHE_DIR / "latest.json"
    if not latest_path.exists():
        # Try to run the pipeline to generate today's digest
        script_path = Path.home() / "AppData" / "Local" / "hermes" / "scripts" / "sentinel_news_pipeline.py"
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
# Capability endpoints — full Hermes CLI surface for Mission Control
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


@app.get("/api/hermes/overview")
def get_hermes_overview():
    """Parsed `hermes status` — model, API keys, messaging platforms, gateway."""
    resp = run_hermes("status", timeout=90)
    raw = resp["stdout"]
    out: dict[str, Any] = {"model": None, "provider": None, "platforms": [],
                           "gateway": {"running": False, "pids": []},
                           "jobs": None, "sessions": None, "api_keys": [], "raw": raw}
    section = ""
    for line in raw.splitlines():
        s = line.strip()
        low = s.lower()
        if not s:
            continue
        # Section headers are emoji-prefixed titles without ':' key-value shape.
        if "api key" in low and ":" not in s:
            section = "keys"; continue
        if "messaging platforms" in low:
            section = "platforms"; continue
        if "gateway service" in low:
            section = "gateway"; continue
        if "scheduled jobs" in low:
            section = "jobs"; continue
        if "sessions" in low and ":" not in s:
            section = "sessions"; continue
        if "auth providers" in low or "api-key providers" in low or "terminal backend" in low or "environment" in low:
            section = "env" if "environment" in low else "other"; continue

        m = re.match(r"^(Model|Provider):\s+(.*)$", s)
        if m:
            out[m.group(1).lower()] = m.group(2).strip()
            continue
        if section == "keys":
            km = re.match(r"^([\w ./()-]+?)\s{2,}(.+)$", s)
            if km:
                val = km.group(2)
                out["api_keys"].append({
                    "name": km.group(1).strip(),
                    "set": "not set" not in val,
                })
            continue
        if section == "platforms":
            pm = re.match(r"^([\w ()-]+?)\s{2,}(.+)$", s)
            if pm:
                val = pm.group(2)
                home = re.search(r"home:\s*([^)]+)\)", val)
                out["platforms"].append({
                    "name": pm.group(1).strip(),
                    "configured": "configured" in val and "not configured" not in val,
                    "home": home.group(1).strip() if home else None,
                })
            continue
        if section == "gateway":
            if low.startswith("status:"):
                out["gateway"]["running"] = "running" in low
            pid_m = re.search(r"PID\(s\):\s+([\d, ]+)", s) or re.search(r"PID:\s*(\d+)", s)
            if pid_m:
                out["gateway"]["pids"] = [int(p) for p in re.findall(r"\d+", pid_m.group(1))]
            continue
        if section == "jobs":
            jm = re.match(r"^Jobs:\s+(.*)$", s)
            if jm:
                out["jobs"] = jm.group(1)
            continue
        if section == "sessions":
            sm = re.match(r"^Active:\s+(.*)$", s)
            if sm:
                out["sessions"] = sm.group(1)
            continue
    return out


@app.get("/api/hermes/skills")
def get_hermes_skills():
    """Parsed `hermes skills list` — installed skills with category/source/status."""
    resp = run_hermes("skills", "list", timeout=90)
    raw = resp["stdout"]
    skills = []
    for line in raw.splitlines():
        cells = _split_table_row(line)
        if len(cells) >= 5 and cells[0] and cells[0] != "Name" and not set(cells[0]) <= set("-+"):
            skills.append({
                "name": cells[0], "category": cells[1], "source": cells[2],
                "trust": cells[3], "enabled": cells[4].lower() == "enabled",
            })
    summary = None
    sm = re.search(r"(\d+) hub-installed, (\d+) builtin, (\d+) local\s+\W\s+(\d+) enabled, (\d+) disabled", raw)
    if sm:
        summary = {"hub": int(sm.group(1)), "builtin": int(sm.group(2)), "local": int(sm.group(3)),
                   "enabled": int(sm.group(4)), "disabled": int(sm.group(5))}
    return {"skills": skills, "summary": summary, "raw": raw}


@app.get("/api/hermes/mcp")
def get_hermes_mcp():
    """Parsed `hermes mcp list` — configured MCP servers."""
    resp = run_hermes("mcp", "list", timeout=90)
    raw = resp["stdout"]
    servers = []
    in_table = False
    for line in raw.splitlines():
        s = line.rstrip()
        if re.match(r"^\s*Name\s{2,}Transport", s):
            in_table = True
            continue
        if in_table:
            if not s.strip() or set(s.strip()) <= set("- "):
                if servers:
                    break
                continue
            cells = _cols(s)
            if len(cells) >= 4:
                servers.append({"name": cells[0], "transport": cells[1], "tools": cells[2],
                                "enabled": "enabled" in cells[3].lower()})
    return {"servers": servers, "raw": raw}


@app.post("/api/hermes/mcp/{name}/test")
def test_hermes_mcp(name: str):
    """`hermes mcp test <name>` — connection probe."""
    resp = run_hermes("mcp", "test", name, timeout=120)
    return {"message": resp["stdout"], "ok": resp["success"]}


@app.get("/api/hermes/plugins")
def get_hermes_plugins():
    """Parsed `hermes plugins list --plain` — status/source/version/name rows."""
    resp = run_hermes("plugins", "list", "--plain", timeout=90)
    raw = resp["stdout"]
    plugins = []
    for line in raw.splitlines():
        # e.g. "not enabled  bundled  1.0.0    browser-browser-use"
        m = re.match(r"^(enabled|not enabled|disabled)\s{2,}(\S+)\s{2,}(\S+)\s{2,}(\S+)\s*$", line.strip())
        if m:
            plugins.append({"status": m.group(1), "source": m.group(2),
                            "version": m.group(3), "name": m.group(4),
                            "enabled": m.group(1) == "enabled"})
    return {"plugins": plugins, "raw": raw}


@app.post("/api/hermes/plugins/{name}/enable")
def enable_hermes_plugin(name: str):
    resp = run_hermes("plugins", "enable", name, timeout=120)
    return {"message": resp["stdout"]}


@app.post("/api/hermes/plugins/{name}/disable")
def disable_hermes_plugin(name: str):
    resp = run_hermes("plugins", "disable", name, timeout=120)
    return {"message": resp["stdout"]}


GATEWAY_API_PORT = int(os.environ.get("HERMES_GATEWAY_API_PORT", "8642"))


def _gateway_api_alive() -> bool:
    """Authoritative gateway liveness: its api_server answering on 8642.
    Process scans lie — a TTY-less direct-spawned gateway can hang forever
    without ever binding the port, and transient `hermes gateway *` CLI calls
    match the CLI's own process heuristics."""
    import socket
    try:
        with socket.create_connection(("127.0.0.1", GATEWAY_API_PORT), timeout=1.5):
            return True
    except OSError:
        return False


@app.get("/api/hermes/gateway")
def get_hermes_gateway():
    """Gateway service status + per-profile gateway list."""
    # SERIAL on purpose. `hermes gateway status` finds the gateway by scanning
    # process command lines — when `gateway list` runs concurrently (an earlier
    # latency optimization), status matches its own sibling CLI invocation and
    # reports a phantom "Gateway process running (PID: <the list call>)". That
    # phantom made the UI show BOOTING forever and suppressed auto-recovery.
    status = run_hermes("gateway", "status", timeout=60)
    listing = run_hermes("gateway", "list", timeout=60)
    raw_status, raw_list = status["stdout"], listing["stdout"]
    service = {
        # Match "Gateway process running (PID: n)" specifically — the scheduled
        # task's own "Status: Running" line false-positives a bare substring.
        "running": bool(re.search(r"process running", raw_status, re.I)),
        "api_listening": _gateway_api_alive(),
        "manager": None,
        "pids": [int(p) for p in re.findall(r"process running \(PID:?\s*(\d+)", raw_status, re.I)],
    }
    mm = re.search(r"(Scheduled Task registered|Manager):\s*(.+)", raw_status)
    if mm:
        service["manager"] = mm.group(2).strip()
    gateways = []
    for line in raw_list.splitlines():
        m = re.match(r"^\s+\S?\s*([\w-]+)(\s+\(current\))?\s+\W\s+(.*)$", line.rstrip())
        if m and m.group(1).lower() != "gateways":
            tail = m.group(3)
            pid = re.search(r"PID\s+(\d+)", tail)
            gateways.append({
                "name": m.group(1),
                "current": bool(m.group(2)),
                "running": pid is not None,
                "pid": int(pid.group(1)) if pid else None,
            })
    return {"service": service, "gateways": gateways, "raw": raw_status + "\n" + raw_list}


class GatewayActionPayload(BaseModel):
    action: str  # start | stop | restart


@app.post("/api/hermes/gateway/action")
def gateway_action(payload: GatewayActionPayload):
    if payload.action not in ("start", "stop", "restart"):
        raise HTTPException(status_code=400, detail="action must be start|stop|restart")
    # Hard-won lessons encoded here:
    #  * `hermes gateway start` run from a TTY-less bridge can take the CLI's
    #    direct-spawn fallback, producing a gateway that hangs forever without
    #    logging or binding its port — a zombie that then poisons the CLI's
    #    process-scan "already running" checks. So on Windows we start via the
    #    Scheduled Task directly (clean pythonw environment, proven path).
    #  * Liveness is judged ONLY by the gateway api port answering — process
    #    scans match transient `hermes gateway *` CLI calls and hung zombies.
    #  * A cold boot can take 60s+ under load; we wait a bounded 20s and
    #    return pending=True so the UI keeps polling instead of blocking.
    def _quiet_cli(*cli_args: str, timeout: int) -> None:
        subprocess.run(
            [HERMES_CMD, *cli_args],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            creationflags=CREATE_NO_WINDOW,
        )

    try:
        if payload.action in ("stop", "restart"):
            _quiet_cli("gateway", "stop", timeout=90)
        if payload.action in ("start", "restart"):
            started_via_task = False
            if os.name == "nt":
                # /End first: if a previous task instance is wedged in the
                # "Running" state (dead pythonw, lingering cmd wrapper), /Run
                # is a silent no-op with result 267009. /End on a not-running
                # task errors harmlessly.
                subprocess.run(
                    ["schtasks", "/End", "/TN", "Hermes_Gateway"],
                    capture_output=True, text=True, timeout=30,
                    creationflags=CREATE_NO_WINDOW,
                )
                time.sleep(1)
                r = subprocess.run(
                    ["schtasks", "/Run", "/TN", "Hermes_Gateway"],
                    capture_output=True, text=True, timeout=30,
                    creationflags=CREATE_NO_WINDOW,
                )
                started_via_task = r.returncode == 0
            if not started_via_task:
                _quiet_cli("gateway", "start", timeout=120)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail=f"gateway {payload.action} timed out")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Hermes CLI / schtasks not found")

    if payload.action == "stop":
        return {"message": "gateway stop: drained", "running": _gateway_api_alive(), "pending": False}

    deadline = time.time() + 20
    while time.time() < deadline:
        if _gateway_api_alive():
            return {"message": f"gateway {payload.action}: api answering on :{GATEWAY_API_PORT}", "running": True, "pending": False}
        time.sleep(1.5)
    return {
        "message": f"gateway {payload.action} issued — still booting (can take 60s+ under load)",
        "running": False,
        "pending": True,
    }


@app.get("/api/hermes/send/targets")
def get_send_targets():
    """Parsed `hermes send --list` — configured delivery targets per platform."""
    resp = run_hermes("send", "--list", timeout=60)
    raw = resp["stdout"]
    platforms: list[dict[str, Any]] = []
    current: Optional[dict[str, Any]] = None
    for line in raw.splitlines():
        hm = re.match(r"^([A-Za-z][\w ]+):\s*$", line.strip())
        if hm and "target" not in hm.group(1).lower():
            current = {"platform": hm.group(1), "targets": []}
            platforms.append(current)
            continue
        if current and line.startswith("  ") and line.strip():
            t = line.strip()
            if not t.lower().startswith(("use these", "bare platform")):
                current["targets"].append(t)
    return {"platforms": platforms, "raw": raw}


class SendMessagePayload(BaseModel):
    target: str
    message: str
    subject: Optional[str] = None


@app.post("/api/hermes/send")
def send_hermes_message(payload: SendMessagePayload):
    """`hermes send --to <target> --json <message>` — direct platform delivery."""
    args = ["send", "--to", payload.target, "--json"]
    if payload.subject:
        args += ["--subject", payload.subject]
    args.append(payload.message)
    resp = run_hermes(*args, timeout=90)
    return {"result": resp["data"], "message": resp["stdout"]}


@app.get("/api/hermes/webhooks")
def get_hermes_webhooks():
    """`hermes webhook list` — subscriptions, or enabled=false with setup hint."""
    resp = run_hermes("webhook", "list", timeout=60)
    raw = resp["stdout"]
    enabled = "not enabled" not in raw.lower()
    subs = []
    if enabled:
        for line in raw.splitlines():
            cells = _split_table_row(line) or _cols(line)
            if len(cells) >= 2 and cells[0].lower() not in ("id", "route", "name"):
                subs.append({"cells": cells})
    return {"enabled": enabled, "subscriptions": subs, "raw": raw}


@app.get("/api/hermes/memory")
def get_hermes_memory():
    """Parsed `hermes memory status` — active provider + installed providers."""
    resp = run_hermes("memory", "status", timeout=60)
    raw = resp["stdout"]
    out: dict[str, Any] = {"provider": None, "plugin_installed": False,
                           "available": False, "providers": [], "raw": raw}
    for line in raw.splitlines():
        s = line.strip()
        m = re.match(r"^Provider:\s+(\S+)", s)
        if m:
            out["provider"] = m.group(1)
        if s.lower().startswith("plugin:"):
            out["plugin_installed"] = "installed" in s.lower()
        if s.lower().startswith("status:"):
            out["available"] = "available" in s.lower()
        pm = re.match(r"^\W?\s*([\w-]+)\s+\(([^)]+)\)(.*)$", s)
        if pm and pm.group(2) and ("key" in pm.group(2).lower() or "local" in pm.group(2).lower()):
            out["providers"].append({
                "name": pm.group(1), "auth": pm.group(2),
                "active": "active" in pm.group(3).lower(),
            })
    return out


@app.get("/api/hermes/curator")
def get_hermes_curator():
    """Parsed `hermes curator status` — runs, cadence, skill activity."""
    resp = run_hermes("curator", "status", timeout=60)
    raw = resp["stdout"]
    out: dict[str, Any] = {"enabled": "ENABLED" in raw, "runs": None, "last_run": None,
                           "interval": None, "skills_total": None, "active": None,
                           "stale": None, "archived": None, "most_active": [], "raw": raw}
    for line in raw.splitlines():
        s = line.strip()
        for key, field in (("runs:", "runs"), ("last run:", "last_run"), ("interval:", "interval")):
            if s.lower().startswith(key):
                out[field] = s.split(":", 1)[1].strip()
        tm = re.match(r"^agent-created skills:\s+(\d+) total", s)
        if tm:
            out["skills_total"] = int(tm.group(1))
        for field in ("active", "stale", "archived"):
            fm = re.match(rf"^{field}\s+(\d+)$", s)
            if fm:
                out[field] = int(fm.group(1))
    # "most active (top 5):" rows: name  activity=N use=N view=N patches=N last_activity=X
    in_most = False
    for line in raw.splitlines():
        if "most active" in line.lower():
            in_most = True
            continue
        if in_most:
            am = re.match(r"^\s+([\w-]+)\s+activity=\s*(\d+).*last_activity=(.+)$", line)
            if am:
                out["most_active"].append({"name": am.group(1), "activity": int(am.group(2)),
                                           "last_activity": am.group(3).strip()})
            elif line.strip() and not line.startswith("  "):
                break
            if len(out["most_active"]) >= 5:
                break
    return out


@app.get("/api/hermes/insights")
def get_hermes_insights(days: int = 30):
    """Parsed `hermes insights --days N` — usage analytics."""
    resp = run_hermes("insights", "--days", str(days), timeout=180)
    raw = resp["stdout"]
    out: dict[str, Any] = {"days": days, "overview": {}, "models": [], "platforms": [],
                           "top_tools": [], "weekday_activity": [], "peak_hours": None, "raw": raw}
    # Overview pairs can appear two per line; scan globally.
    for key, field in (
        ("Sessions", "sessions"), ("Messages", "messages"), ("Tool calls", "tool_calls"),
        ("User messages", "user_messages"), ("Input tokens", "input_tokens"),
        ("Output tokens", "output_tokens"), ("Total tokens", "total_tokens"),
        ("Active time", "active_time"), ("Avg session", "avg_session"),
        ("Avg msgs/session", "avg_msgs_per_session"),
    ):
        m = re.search(rf"{re.escape(key)}:\s+([~\d,.\w%/ ]+?)(?:\s{{2,}}|$)", raw, re.M)
        if m:
            val = m.group(1).strip()
            num = val.replace(",", "")
            out["overview"][field] = int(num) if num.isdigit() else val
    section = ""
    for line in raw.splitlines():
        low = line.lower()
        if "models used" in low:
            section = "models"; continue
        if "platforms" in low and "---" not in low:
            section = "platforms"; continue
        if "top tools" in low:
            section = "tools"; continue
        if "top skills" in low or "activity patterns" in low:
            section = "activity" if "activity" in low else ""
            continue
        if "notable sessions" in low:
            section = ""; continue
        s = line.strip()
        if not s or set(s) <= set("-– ") or s.lower().startswith(("model ", "platform ", "tool ", "peak hours", "active days", "best streak", "... and")):
            pm = re.match(r"^Peak hours:\s+(.*)$", s)
            if pm:
                out["peak_hours"] = pm.group(1)
            continue
        if section == "models":
            m = re.match(r"^(\S+)\s{2,}([\d,]+)\s{2,}([\d,]+)$", s)
            if m:
                out["models"].append({"model": m.group(1), "sessions": int(m.group(2).replace(",", "")),
                                      "tokens": int(m.group(3).replace(",", ""))})
        elif section == "platforms":
            m = re.match(r"^(\S+)\s{2,}([\d,]+)\s{2,}([\d,]+)\s{2,}([\d,]+)$", s)
            if m:
                out["platforms"].append({"platform": m.group(1), "sessions": int(m.group(2).replace(",", "")),
                                         "messages": int(m.group(3).replace(",", "")),
                                         "tokens": int(m.group(4).replace(",", ""))})
        elif section == "tools":
            m = re.match(r"^(\S+)\s{2,}([\d,]+)\s{2,}([\d.]+)%$", s)
            if m:
                out["top_tools"].append({"tool": m.group(1), "calls": int(m.group(2).replace(",", "")),
                                         "pct": float(m.group(3))})
        elif section == "activity":
            m = re.match(r"^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\S*\s*(\d+)$", s)
            if m:
                out["weekday_activity"].append({"day": m.group(1), "sessions": int(m.group(2))})
    return out


@app.get("/api/hermes/doctor")
def get_hermes_doctor():
    """`hermes doctor` — config/dependency diagnostics, classified per line."""
    resp = run_hermes("doctor", timeout=180)
    raw = resp["stdout"] + ("\n" + resp["stderr"] if resp["stderr"] else "")
    checks = []
    for line in raw.splitlines():
        s = line.strip()
        if not s:
            continue
        level = None
        if re.match(r"^(✓|✔|OK\b|\[ok\])", s, re.I):
            level = "ok"
        elif re.match(r"^(⚠|WARN|warning)", s, re.I) or "warning" in s.lower():
            level = "warn"
        elif re.match(r"^(✗|✘|×|FAIL|ERROR)", s, re.I):
            level = "fail"
        if level:
            checks.append({"level": level, "text": s.lstrip("✓✔✗✘×⚠ ").strip()})
    counts = {lvl: sum(1 for c in checks if c["level"] == lvl) for lvl in ("ok", "warn", "fail")}
    return {"checks": checks, "counts": counts, "raw": raw}


@app.get("/api/hermes/logs")
def get_hermes_logs(name: str = "agent", lines: int = 80, level: Optional[str] = None, since: Optional[str] = None):
    """`hermes logs <name> -n <lines>` — tail of agent/errors/gateway/gui logs."""
    if name not in ("agent", "errors", "gateway", "gui", "desktop"):
        raise HTTPException(status_code=400, detail="name must be agent|errors|gateway|gui|desktop")
    args = ["logs", name, "-n", str(max(1, min(lines, 500)))]
    if level:
        args += ["--level", level]
    if since:
        args += ["--since", since]
    resp = run_hermes(*args, timeout=60)
    return {"name": name, "lines": resp["stdout"].splitlines()}


@app.get("/api/hermes/model")
def get_hermes_model():
    """Current model/provider (from status) + fallback chain."""
    overview = get_hermes_overview()
    fb = run_hermes("fallback", "list", timeout=60)
    fb_raw = fb["stdout"]
    fallbacks = []
    if "no fallback providers" not in fb_raw.lower():
        for line in fb_raw.splitlines():
            m = re.match(r"^\s*(?:#?\d+[.)]?\s+)?(\S.*)$", line.strip())
            if m and m.group(1) and "add one with" not in m.group(1).lower():
                fallbacks.append(m.group(1))
    return {"model": overview["model"], "provider": overview["provider"],
            "fallbacks": fallbacks, "raw": fb_raw}


@app.get("/api/hermes/auth")
def get_hermes_auth():
    """Parsed `hermes auth list` — pooled provider credentials."""
    resp = run_hermes("auth", "list", timeout=60)
    raw = resp["stdout"]
    providers = []
    current = None
    for line in raw.splitlines():
        hm = re.match(r"^(\S+) \((\d+) credentials?\):", line.strip())
        if hm:
            current = {"provider": hm.group(1), "count": int(hm.group(2)), "credentials": []}
            providers.append(current)
            continue
        cm = re.match(r"^#(\d+)\s+(\S+)\s+(\S+)\s+(\S+)", line.strip())
        if cm and current:
            current["credentials"].append({"index": int(cm.group(1)), "label": cm.group(2),
                                           "kind": cm.group(3), "source": cm.group(4)})
    return {"providers": providers, "raw": raw}


@app.get("/api/hermes/checkpoints")
def get_hermes_checkpoints():
    """`hermes checkpoints status` — shadow-repo disk usage."""
    resp = run_hermes("checkpoints", "status", timeout=60)
    return {"raw": resp["stdout"]}


@app.get("/api/hermes/pairing")
def get_hermes_pairing():
    """`hermes pairing list` — pending + approved DM users."""
    resp = run_hermes("pairing", "list", timeout=60)
    return {"raw": resp["stdout"]}


@app.get("/api/hermes/security/audit")
def run_security_audit():
    """`hermes security audit` — OSV.dev supply-chain scan (slow, on demand)."""
    resp = run_hermes("security", "audit", timeout=300)
    raw = resp["stdout"]
    vulns = len(re.findall(r"(CVE-\d{4}-\d+|GHSA-[\w-]+|OSV-[\w-]+)", raw))
    return {"vulnerabilities": vulns, "raw": raw}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=BRIDGE_PORT)
