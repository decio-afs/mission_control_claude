"""
mc_brain.py
-----------
The Claude brain for Mission Control. Every LLM action in the dashboard
shells out to the local `claude` CLI; conversations persist in a SQLite store
local, subscription-authed `claude` CLI in headless print mode.

Two layers:
  * run_claude()  — one round-trip to `claude -p ... --output-format json`,
                    returning the assistant text plus a resumable session id.
  * claude_json() — run_claude + tolerant JSON extraction, the drop-in for the
                    old `_llm_json()` synthesis helper.

Plus MCSessions: a native SQLite session store the bridge owns directly, so the
chat transcript / resume history is owned by the bridge.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

# `claude` is on PATH (C:\Users\<user>\.local\bin\claude.exe). Override with
# CLAUDE_CMD if it lives elsewhere.
CLAUDE_CMD = os.environ.get("CLAUDE_CMD", "claude")

# Never flash a console window for the child process on Windows (the bridge runs
# headless under Electron / the dev launcher).
CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

# Default working directory for brain calls — the Mission Control project root,
# so Claude has a sane cwd for tool use (Read attachments, etc.).
PROJECT_ROOT = Path(__file__).resolve().parent

# Claude model aliases we accept from the UI; anything else falls back to the
# CLI default so a stale external model id can never wedge a chat.
_CLAUDE_MODEL_ALIASES = {"haiku", "sonnet", "opus", "fable"}


def claude_model(model: Optional[str]) -> Optional[str]:
    """Normalize a UI-supplied model into something `claude --model` accepts.

    Accepts short aliases (haiku/sonnet/opus/fable) and any full Claude model id
    (`claude-*`). Returns None for unknown/blank values so the caller omits the
    flag and Claude uses its configured default.
    """
    if not model:
        return None
    m = model.strip()
    low = m.lower()
    if low in _CLAUDE_MODEL_ALIASES:
        return low
    if low.startswith("claude-") or low.startswith("claude"):
        return m
    return None


class ClaudeError(RuntimeError):
    """Raised when the claude CLI fails or returns an error result."""

    def __init__(self, message: str, *, returncode: int | None = None, raw: str = ""):
        super().__init__(message)
        self.returncode = returncode
        self.raw = raw


def run_claude(
    prompt: str,
    *,
    session_id: Optional[str] = None,
    model: Optional[str] = None,
    cwd: Optional[str] = None,
    system_prompt: Optional[str] = None,
    allowed_tools: Optional[list[str]] = None,
    bypass_permissions: bool = True,
    timeout: int = 180,
) -> dict[str, Any]:
    """Run one headless Claude turn and return structured output.

    Returns a dict shaped like the legacy CLI result so call sites read
    naturally::

        {
          "success": bool,
          "result":  str,   # the assistant's text answer
          "stdout":  str,   # alias of result (legacy callers read ["stdout"])
          "session_id": str | None,  # resumable id
          "cost_usd": float,
          "raw": dict,      # full claude JSON envelope
        }

    `session_id` resumes a prior conversation (`claude --resume <id>`).
    `bypass_permissions` lets the agent actually use its tools unattended —
    appropriate for a trusted, local, single-user agent backend.
    """
    cmd: list[str] = [CLAUDE_CMD, "-p", prompt, "--output-format", "json"]

    m = claude_model(model)
    if m:
        cmd += ["--model", m]
    if session_id:
        cmd += ["--resume", session_id]
    if system_prompt:
        cmd += ["--append-system-prompt", system_prompt]
    if allowed_tools:
        cmd += ["--allowedTools", ",".join(allowed_tools)]
    if bypass_permissions:
        cmd += ["--permission-mode", "bypassPermissions"]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            creationflags=CREATE_NO_WINDOW,
            # Closed stdin: headless claude must not wait on a TTY (the 3s
            # "no stdin data received" stall) — feed it nothing.
            stdin=subprocess.DEVNULL,
            cwd=cwd or str(PROJECT_ROOT),
        )
    except subprocess.TimeoutExpired:
        raise ClaudeError(f"claude timed out after {timeout}s", returncode=124)
    except FileNotFoundError:
        raise ClaudeError("claude CLI not found in PATH (set CLAUDE_CMD)")

    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()

    if proc.returncode != 0 and not stdout:
        raise ClaudeError(
            f"claude exited {proc.returncode}: {stderr[:300] or 'no output'}",
            returncode=proc.returncode,
            raw=stderr,
        )

    envelope: dict[str, Any] = {}
    try:
        envelope = json.loads(stdout)
    except json.JSONDecodeError:
        # --output-format json should always emit a JSON object; if not, treat
        # the raw stdout as the answer rather than hard-failing.
        envelope = {"result": stdout, "is_error": proc.returncode != 0}

    result_text = envelope.get("result")
    if not isinstance(result_text, str):
        result_text = json.dumps(result_text) if result_text is not None else ""

    if envelope.get("is_error"):
        detail = result_text or envelope.get("api_error_status") or stderr or "unknown error"
        # Surface usage-limit / 429 distinctly so the bridge can map it to 503.
        raise ClaudeError(str(detail), returncode=proc.returncode, raw=stdout)

    return {
        "success": True,
        "result": result_text,
        "stdout": result_text,
        "session_id": envelope.get("session_id") or session_id,
        "cost_usd": envelope.get("total_cost_usd"),
        "raw": envelope,
        "stderr": stderr,
    }


def claude_json(prompt: str, *, model: Optional[str] = None, timeout: int = 240,
                cwd: Optional[str] = None) -> Any:
    """Run a Claude turn and parse a JSON value out of the answer.

    The drop-in for the old `_llm_json()`: tolerates prose / code fences around
    the JSON and returns the parsed object (or list).
    """
    resp = run_claude(prompt, model=model, timeout=timeout, cwd=cwd)
    raw = (resp.get("result") or "").strip()

    if "HTTP 429" in raw or "usage limit" in raw.lower():
        raise ClaudeError("LLM quota exhausted (429)")

    # Prefer a fenced ```json block, else the first {...} or [...] span.
    fence = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", raw, re.S)
    candidate = fence.group(1) if fence else None
    if candidate is None:
        obj = re.search(r"\{.*\}", raw, re.S)
        arr = re.search(r"\[.*\]", raw, re.S)
        if obj and arr:
            candidate = obj.group(0) if obj.start() < arr.start() else arr.group(0)
        elif obj:
            candidate = obj.group(0)
        elif arr:
            candidate = arr.group(0)
    if candidate is None:
        raise ClaudeError(f"model returned no JSON: {raw[:200]}")
    try:
        return json.loads(candidate)
    except json.JSONDecodeError as e:
        raise ClaudeError(f"model JSON invalid: {e}")


# ---------------------------------------------------------------------------
# Native session store — SQLite, owned by the bridge.
# ---------------------------------------------------------------------------
class MCSessions:
    """A tiny SQLite-backed conversation store.

    Each session's `id` IS the Claude session id from its first turn, so resume
    is `claude --resume <id>`. We persist the transcript ourselves so the UI's
    session list / detail view is owned by the bridge.
    """

    def __init__(self, db_path: str | os.PathLike[str]):
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._lock, self._conn() as c:
            c.execute(
                """CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    cwd TEXT,
                    source TEXT DEFAULT 'mission-control',
                    created_at REAL,
                    updated_at REAL
                )"""
            )
            c.execute(
                """CREATE TABLE IF NOT EXISTS messages (
                    session_id TEXT,
                    seq INTEGER,
                    role TEXT,
                    content TEXT,
                    tool_name TEXT,
                    timestamp REAL,
                    PRIMARY KEY (session_id, seq)
                )"""
            )

    # -- writes ------------------------------------------------------------
    def ensure_session(self, session_id: str, *, title: str = "", cwd: Optional[str] = None,
                       source: str = "mission-control") -> None:
        now = time.time()
        with self._lock, self._conn() as c:
            row = c.execute("SELECT id FROM sessions WHERE id=?", (session_id,)).fetchone()
            if row is None:
                c.execute(
                    "INSERT INTO sessions (id, title, cwd, source, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?)",
                    (session_id, title, cwd, source, now, now),
                )

    def append_message(self, session_id: str, role: str, content: str,
                       tool_name: Optional[str] = None) -> None:
        now = time.time()
        with self._lock, self._conn() as c:
            nxt = c.execute(
                "SELECT COALESCE(MAX(seq), -1) + 1 FROM messages WHERE session_id=?",
                (session_id,),
            ).fetchone()[0]
            c.execute(
                "INSERT INTO messages (session_id, seq, role, content, tool_name, timestamp) "
                "VALUES (?,?,?,?,?,?)",
                (session_id, nxt, role, content, tool_name, now),
            )
            # Auto-title from the first user message if still blank.
            if role == "user":
                cur = c.execute("SELECT title FROM sessions WHERE id=?", (session_id,)).fetchone()
                if cur is not None and not (cur["title"] or "").strip():
                    title = content.strip().splitlines()[0][:60] if content.strip() else ""
                    c.execute("UPDATE sessions SET title=? WHERE id=?", (title, session_id))
            c.execute("UPDATE sessions SET updated_at=? WHERE id=?", (now, session_id))

    def rename(self, session_id: str, title: str) -> None:
        with self._lock, self._conn() as c:
            c.execute("UPDATE sessions SET title=? WHERE id=?", (title, session_id))

    def delete(self, session_id: str) -> None:
        with self._lock, self._conn() as c:
            c.execute("DELETE FROM messages WHERE session_id=?", (session_id,))
            c.execute("DELETE FROM sessions WHERE id=?", (session_id,))

    # -- reads -------------------------------------------------------------
    def list(self, limit: int = 100, source: Optional[str] = None) -> list[dict[str, Any]]:
        q = "SELECT * FROM sessions"
        params: list[Any] = []
        if source:
            q += " WHERE source=?"
            params.append(source)
        q += " ORDER BY updated_at DESC LIMIT ?"
        params.append(limit)
        with self._lock, self._conn() as c:
            rows = c.execute(q, params).fetchall()
            out = []
            for r in rows:
                prev = c.execute(
                    "SELECT content FROM messages WHERE session_id=? ORDER BY seq DESC LIMIT 1",
                    (r["id"],),
                ).fetchone()
                preview = (prev["content"] if prev else "") or ""
                out.append({
                    "id": r["id"],
                    "title": r["title"] or "",
                    "preview": preview.strip().replace("\n", " ")[:80],
                    "last_active": _rel_time(r["updated_at"]),
                    "source": r["source"] or "mission-control",
                })
            return out

    def get(self, session_id: str) -> Optional[dict[str, Any]]:
        with self._lock, self._conn() as c:
            s = c.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
            if s is None:
                return None
            rows = c.execute(
                "SELECT role, content, tool_name, timestamp FROM messages "
                "WHERE session_id=? ORDER BY seq ASC",
                (session_id,),
            ).fetchall()
            msgs = [{
                "role": r["role"],
                "content": r["content"] or "",
                "timestamp": r["timestamp"],
                "tool_name": r["tool_name"],
            } for r in rows]
            return {
                "id": s["id"],
                "title": s["title"] or "",
                "cwd": s["cwd"],
                "source": s["source"],
                "message_count": len(msgs),
                "started_at": s["created_at"],
                "ended_at": s["updated_at"],
                "messages": msgs,
            }


def _rel_time(ts: Optional[float]) -> str:
    """Human relative time, e.g. '3m ago', matching the old sessions UI."""
    if not ts:
        return ""
    delta = max(0, time.time() - float(ts))
    if delta < 60:
        return "just now"
    if delta < 3600:
        return f"{int(delta // 60)}m ago"
    if delta < 86400:
        return f"{int(delta // 3600)}h ago"
    return f"{int(delta // 86400)}d ago"
