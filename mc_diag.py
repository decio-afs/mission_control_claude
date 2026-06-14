"""
mc_diag.py
----------
Claude-native diagnostics for Mission Control's Arsenal / Uplink / Systems
pages. Replaces the Hermes `status / skills / mcp / doctor / model / auth …`
CLI surface: real data where Claude has an equivalent (MCP servers, skills,
models, version), and clean "not applicable under Claude" shapes for the
Hermes-only concepts (gateway, curator, checkpoints, pairing, fallback pools)
so the UI degrades gracefully instead of erroring.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any, Optional

CLAUDE_CMD = os.environ.get("CLAUDE_CMD", "claude")
CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

# Curated Claude model catalog — the only provider now is Anthropic via the
# subscription-authed claude CLI, so every model is "enabled".
CLAUDE_MODELS = [
    {"id": "claude-opus-4-8",   "label": "Claude Opus 4.8",   "provider": "anthropic",
     "base_url": None, "key_env": "", "ctx_k": 200, "tags": ["powerful", "default"]},
    {"id": "claude-sonnet-4-6", "label": "Claude Sonnet 4.6", "provider": "anthropic",
     "base_url": None, "key_env": "", "ctx_k": 200, "tags": ["balanced"]},
    {"id": "claude-haiku-4-5",  "label": "Claude Haiku 4.5",  "provider": "anthropic",
     "base_url": None, "key_env": "", "ctx_k": 200, "tags": ["fast", "cheap"]},
    {"id": "claude-fable-5",    "label": "Fable 5",           "provider": "anthropic",
     "base_url": None, "key_env": "", "ctx_k": 200, "tags": ["creative"]},
]
DEFAULT_MODEL = "claude-opus-4-8"


def _run(*args: str, timeout: int = 60) -> str:
    """Run a claude CLI command, returning stdout ('' on failure)."""
    try:
        r = subprocess.run(
            [CLAUDE_CMD, *args],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout, creationflags=CREATE_NO_WINDOW, stdin=subprocess.DEVNULL,
        )
    except (subprocess.SubprocessError, OSError):
        return ""
    return (r.stdout or "").strip()


def claude_version() -> str:
    return _run("--version", timeout=10) or "Claude Code"


# --------------------------------------------------------------------- MCP
_MCP_LINE = re.compile(r"^(?P<name>[^:]+?):\s*(?P<rest>.+?)\s*-\s*(?P<status>.+)$")


def mcp_servers() -> dict[str, Any]:
    """Parse `claude mcp list` into the {name, transport, tools, enabled} shape."""
    raw = _run("mcp", "list", timeout=60)
    servers = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.lower().startswith(("checking mcp", "no mcp")):
            continue
        m = _MCP_LINE.match(line)
        if not m:
            continue
        endpoint = m.group("rest").strip()
        status = m.group("status").strip()
        connected = "connected" in status.lower() or "✓" in status or "√" in status
        transport = "http" if endpoint.startswith("http") else "stdio"
        servers.append({
            "name": m.group("name").strip(),
            "transport": transport,
            "tools": status,           # health string ("Connected" / "Needs authentication")
            "enabled": connected,
        })
    return {"servers": servers, "raw": raw}


def mcp_test(name: str) -> dict[str, Any]:
    raw = _run("mcp", "get", name, timeout=60)
    ok = bool(raw) and "not found" not in raw.lower()
    return {"message": raw or f"No details for MCP server '{name}'", "ok": ok}


# ------------------------------------------------------------------ skills
def skills(skills_roots: list[Path]) -> dict[str, Any]:
    """Scan Claude skill directories for SKILL.md files → installed skills."""
    found = []
    for root in skills_roots:
        if not root.is_dir():
            continue
        source = "plugin" if "plugin" in str(root).lower() else "local"
        for skill_md in root.glob("*/SKILL.md"):
            name = skill_md.parent.name
            category = source
            # pull a description from frontmatter if present
            desc = ""
            try:
                head = skill_md.read_text(encoding="utf-8", errors="replace")[:600]
                dm = re.search(r"description:\s*(.+)", head)
                if dm:
                    desc = dm.group(1).strip().strip('"')[:60]
            except OSError:
                pass
            found.append({
                "name": name, "category": category or desc or "skill",
                "source": source, "trust": "local", "enabled": True,
            })
    found.sort(key=lambda s: s["name"])
    summary = {
        "hub": 0,
        "builtin": sum(1 for s in found if s["source"] == "plugin"),
        "local": sum(1 for s in found if s["source"] == "local"),
        "enabled": len(found),
        "disabled": 0,
    }
    return {"skills": found, "summary": summary, "raw": f"{len(found)} skills installed"}


# ------------------------------------------------------------------ models
def _model_file(data_dir: Path) -> Path:
    return data_dir / "model.json"


def current_model(data_dir: Path) -> str:
    f = _model_file(data_dir)
    try:
        if f.exists():
            return json.loads(f.read_text(encoding="utf-8")).get("model", DEFAULT_MODEL)
    except (json.JSONDecodeError, OSError):
        pass
    return DEFAULT_MODEL


def models(data_dir: Path) -> dict[str, Any]:
    cur = current_model(data_dir)
    out = []
    for m in CLAUDE_MODELS:
        out.append({**m, "enabled": True, "current": m["id"] == cur})
    return {"current_model": cur, "current_provider": "anthropic", "models": out}


def set_model(data_dir: Path, model: str) -> dict[str, Any]:
    known = {m["id"] for m in CLAUDE_MODELS}
    if model not in known:
        raise ValueError(f"Unknown model id: {model!r}")
    f = _model_file(data_dir)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps({"model": model}), encoding="utf-8")
    return {"model": model, "provider": "anthropic"}


def model_info(data_dir: Path) -> dict[str, Any]:
    cur = current_model(data_dir)
    return {"model": cur, "provider": "anthropic", "fallbacks": [],
            "raw": "Claude Code — single provider (Anthropic), no fallback pool."}


def overview(data_dir: Path) -> dict[str, Any]:
    mcp = mcp_servers()["servers"]
    platforms = [{"name": s["name"], "configured": s["enabled"], "home": None} for s in mcp]
    return {
        "model": current_model(data_dir),
        "provider": "anthropic",
        "platforms": platforms,
        "gateway": {"running": False, "pids": []},
        "jobs": None,
        "sessions": None,
        "api_keys": [{"name": "Claude (subscription)", "set": True}],
        "raw": claude_version(),
    }


# ------------------------------------------------------------------ doctor
def doctor(data_dir: Path, project_root: Path) -> dict[str, Any]:
    checks = []

    def add(ok, text, warn=False):
        checks.append({"level": "ok" if ok else ("warn" if warn else "fail"), "text": text})

    ver = claude_version()
    add(bool(ver and "Claude" in ver or re.search(r"\d", ver or "")), f"claude CLI: {ver or 'not found'}")
    mcp = mcp_servers()["servers"]
    connected = sum(1 for s in mcp if s["enabled"])
    add(True, f"MCP servers: {connected}/{len(mcp)} connected")
    if connected < len(mcp):
        for s in mcp:
            if not s["enabled"]:
                checks.append({"level": "warn", "text": f"MCP '{s['name']}': {s['tools']}"})
    writable = os.access(data_dir, os.W_OK)
    add(writable, f"data store writable: {data_dir}")
    add((project_root / "kanban.json").exists(), "kanban store present")
    counts = {lvl: sum(1 for c in checks if c["level"] == lvl) for lvl in ("ok", "warn", "fail")}
    return {"checks": checks, "counts": counts, "raw": "\n".join(c["text"] for c in checks)}


def auth() -> dict[str, Any]:
    return {
        "providers": [{
            "provider": "anthropic", "count": 1,
            "credentials": [{"index": 1, "label": "Claude subscription",
                             "kind": "oauth", "source": "claude-code"}],
        }],
        "raw": "Authenticated via the Claude Code subscription.",
    }


def insights(days: int, session_count: int, message_count: int, model: str) -> dict[str, Any]:
    return {
        "days": days,
        "overview": {"sessions": session_count, "messages": message_count},
        "models": [{"model": model, "sessions": session_count, "tokens": 0}] if session_count else [],
        "platforms": [{"platform": "mission-control", "sessions": session_count,
                       "messages": message_count, "tokens": 0}] if session_count else [],
        "top_tools": [],
        "weekday_activity": [],
        "peak_hours": None,
        "raw": f"{session_count} sessions, {message_count} messages over the last {days} days.",
    }


# ---------------------------------------------------- Hermes-only → graceful
def gateway() -> dict[str, Any]:
    return {
        "service": {"running": False, "api_listening": False, "manager": None, "pids": []},
        "gateways": [],
        "raw": "No gateway under Claude — Mission Control talks to Claude directly via the bridge.",
    }


def gateway_action(action: str) -> dict[str, Any]:
    return {"message": f"gateway {action}: not applicable under Claude", "running": False, "pending": False}


def plugins() -> dict[str, Any]:
    return {"plugins": [], "raw": "Plugins are managed by Claude Code (/plugin)."}


def send_targets() -> dict[str, Any]:
    return {"platforms": [], "raw": "Direct platform send is handled by MCP connectors (e.g. Twilio, Metricool)."}


def webhooks() -> dict[str, Any]:
    return {"enabled": False, "subscriptions": [], "raw": "Webhooks are not used under Claude."}


def memory(memory_dir: Path) -> dict[str, Any]:
    available = memory_dir.is_dir()
    return {
        "provider": "claude-memory" if available else None,
        "plugin_installed": available,
        "available": available,
        "providers": [{"name": "claude-memory", "auth": "local", "active": available}] if available else [],
        "raw": f"Claude memory: {memory_dir}" if available else "No memory directory found.",
    }


def curator() -> dict[str, Any]:
    return {"enabled": False, "runs": None, "last_run": None, "interval": None,
            "skills_total": None, "active": None, "stale": None, "archived": None,
            "most_active": [], "raw": "Skill curation is managed by Claude Code."}


def simple_raw(msg: str) -> dict[str, Any]:
    return {"raw": msg}
