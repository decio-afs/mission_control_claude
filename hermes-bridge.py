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
    if payload.model:
        args += ["-m", payload.model]
    if payload.skills:
        args += ["-s", ",".join(payload.skills)]
    resp = run_hermes(*args, timeout=180)
    return {
        "response": resp["stdout"],
        "stderr": resp.get("stderr", ""),
        "success": resp.get("success", True),
    }


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

    # Sort calendar by date
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
        "calendar": [
            {"date": "2026-06-06", "title": "Post 1", "platform": "instagram", "status": "scheduled"},
            {"date": "2026-06-07", "title": "Post 2", "platform": "twitter", "status": "scheduled"},
            {"date": "2026-06-08", "title": "Post 3", "platform": "linkedin", "status": "draft"},
        ]
    }

@app.post("/api/hermes/content/generate")
def generate_content(payload: GenerateContentPayload):
    """Accept platform and topic, return a queued generation job."""
    import uuid
    return {"job_id": f"gen_{uuid.uuid4().hex[:8]}", "status": "queued"}

@app.get("/api/hermes/leads")
def get_leads():
    """Return placeholder leads."""
    return {
        "leads": [
            {"id": "1", "name": "Lead 1", "source": "website", "status": "new", "score": 85},
            {"id": "2", "name": "Lead 2", "source": "referral", "status": "contacted", "score": 72},
            {"id": "3", "name": "Lead 3", "source": "social", "status": "qualified", "score": 91},
            {"id": "4", "name": "Lead 4", "source": "website", "status": "new", "score": 64},
        ]
    }

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
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=BRIDGE_PORT)
