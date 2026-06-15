"""
mc_store.py
-----------
Mission Control's native data layer. The kanban / profile / cron
CLI: tasks, agents, cron jobs and boards now live in local JSON the bridge owns
directly. No external process is involved.

Files (under the project root):
  * kanban.json            — canonical task array (McTask schema)
  * .mc/data/kanban-meta.json — comments, events, links, boards, notifications
  * .mc/data/agents.json      — agent roster (name, role, skills, model)
  * .mc/data/cron.json        — scheduled jobs

Every method returns the exact dict shape the existing API endpoints emitted, so
the bridge calls `STORE.method(...)` directly.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

# Statuses that count as "open" backlog the board surfaces.
TERMINAL = {"done", "archived"}
STALE_CLAIM_SECONDS = 2 * 3600


def _now() -> float:
    return time.time()


def _new_id(prefix: str = "t_") -> str:
    return prefix + uuid.uuid4().hex[:8]


class MCStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.tasks_file = self.root / "kanban.json"
        self.data_dir = self.root / ".mc" / "data"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.meta_file = self.data_dir / "kanban-meta.json"
        self.agents_file = self.data_dir / "agents.json"
        self.cron_file = self.data_dir / "cron.json"
        self._lock = threading.RLock()

    # -- low-level IO ------------------------------------------------------
    def _read(self, path: Path, default: Any) -> Any:
        try:
            if path.exists():
                # utf-8-sig tolerates a BOM — Windows editors / PowerShell
                # Set-Content add one, and a bare utf-8 read would then fail and
                # silently drop the whole store to its default (empty board).
                return json.loads(path.read_text(encoding="utf-8-sig"))
        except (json.JSONDecodeError, OSError):
            pass
        return default

    def _write(self, path: Path, data: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    def _tasks(self) -> list[dict[str, Any]]:
        data = self._read(self.tasks_file, [])
        return data if isinstance(data, list) else []

    def _save_tasks(self, tasks: list[dict[str, Any]]) -> None:
        self._write(self.tasks_file, tasks)

    def _meta(self) -> dict[str, Any]:
        m = self._read(self.meta_file, {})
        if not isinstance(m, dict):
            m = {}
        m.setdefault("comments", {})
        m.setdefault("events", {})
        m.setdefault("runs", {})
        m.setdefault("links", [])          # list of [parent_id, child_id]
        m.setdefault("notifications", {})  # task_id -> [subscription, ...]
        m.setdefault("boards", [{"slug": "main", "name": "Main", "description": "",
                                  "is_current": True, "archived": False}])
        m.setdefault("current_board", "main")
        return m

    def _save_meta(self, m: dict[str, Any]) -> None:
        self._write(self.meta_file, m)

    # ----------------------------------------------------------------- tasks
    def _blank_task(self, title: str, **kw) -> dict[str, Any]:
        return {
            "id": _new_id(),
            "title": title,
            "body": kw.get("body"),
            "assignee": kw.get("assignee"),
            "status": kw.get("status", "todo"),
            "priority": kw.get("priority", 0),
            "tenant": None,
            "workspace_kind": "scratch",
            "workspace_path": None,
            "branch_name": None,
            "created_by": kw.get("created_by", "dashboard"),
            "created_at": _now(),
            "started_at": None,
            "completed_at": None,
            "result": None,
            "skills": kw.get("skills", []) or [],
            "max_retries": kw.get("max_retries"),
            "session_id": None,
            "workflow_template_id": None,
            "current_step_key": None,
        }

    @staticmethod
    def _has_deliverable(task: dict[str, Any], runs: list[dict[str, Any]]) -> bool:
        """Whether a task produced a retrievable deliverable.

        Computed server-side so the board can show a "has deliverable" marker on
        done cards WITHOUT a per-card fetch (BUGHUNT DONE-CARD-2). True when:
          * the task has a written `result`, or
          * a git `branch_name`, or
          * any run wrote a `summary` (this is exactly what feeds the drawer's
            `latest_summary`, so the marker lights precisely when RESULT/SUMMARY
            will show real content), or
          * the workspace dir holds at least one real (non-hidden) file/dir — the
            common case here, where the deliverable is a file the agent wrote
            (e.g. competitor_analysis.md) rather than an in-store field.

        Deliberately NOT used: the synthesized worker log (in the native store it
        is derived from the event timeline, so every task — having at least a
        'created' event — would falsely qualify), and bare `workspace_path` (set
        on virtually every task even when the dir is empty, BUGHUNT iter #10/#12).
        """
        if (task.get("result") or "").strip():
            return True
        if (task.get("branch_name") or "").strip():
            return True
        if any(isinstance(r, dict) and (r.get("summary") or "").strip() for r in runs):
            return True
        ws = (task.get("workspace_path") or "").strip()
        if ws:
            try:
                with os.scandir(ws) as it:
                    for e in it:
                        if not e.name.startswith("."):
                            return True
            except OSError:
                pass
        return False

    def list_tasks(self) -> dict[str, Any]:
        tasks = self._tasks()
        runs = self._meta().get("runs", {})
        for t in tasks:
            if isinstance(t, dict):
                t["has_deliverable"] = self._has_deliverable(
                    t, runs.get(str(t.get("id")), []) or []
                )
        return {"tasks": tasks}

    def _find(self, tasks: list[dict[str, Any]], task_id: str) -> dict[str, Any]:
        for t in tasks:
            if str(t.get("id")) == str(task_id):
                return t
        raise KeyError(task_id)

    def _event(self, m: dict[str, Any], task_id: str, kind: str,
               payload: Optional[dict] = None) -> None:
        m["events"].setdefault(task_id, []).append({
            "kind": kind, "payload": payload, "created_at": _now(), "run_id": None,
        })

    def create_task(self, payload) -> dict[str, Any]:
        with self._lock:
            tasks = self._tasks()
            status = "triage" if getattr(payload, "triage", False) else "todo"
            t = self._blank_task(
                payload.title,
                body=payload.body,
                assignee=payload.assignee,
                priority=payload.priority if payload.priority is not None else 0,
                skills=payload.skills or [],
                max_retries=payload.max_retries,
                status=status,
            )
            tasks.append(t)
            self._save_tasks(tasks)
            m = self._meta()
            self._event(m, t["id"], "created", {"by": t["created_by"]})
            for parent in getattr(payload, "parents", None) or []:
                m["links"].append([parent, t["id"]])
            self._save_meta(m)
            return {"task": t}

    def show_task(self, task_id: str) -> dict[str, Any]:
        with self._lock:
            tasks = self._tasks()
            task = self._find(tasks, task_id)
            m = self._meta()
            parents = [p for p, c in m["links"] if str(c) == str(task_id)]
            children = [c for p, c in m["links"] if str(p) == str(task_id)]
            comments = m["comments"].get(task_id, [])
            events = m["events"].get(task_id, [])
            runs = m["runs"].get(task_id, [])
            latest_summary = task.get("result")
            for r in reversed(runs):
                if r.get("summary"):
                    latest_summary = r["summary"]
                    break
            return {
                "task": task,
                "latest_summary": latest_summary,
                "parents": parents,
                "children": children,
                "comments": comments,
                "events": events,
                "runs": runs,
            }

    def _mutate(self, task_id: str, fn, *, event: str,
                payload: Optional[dict] = None) -> dict[str, Any]:
        with self._lock:
            tasks = self._tasks()
            task = self._find(tasks, task_id)
            fn(task)
            self._save_tasks(tasks)
            m = self._meta()
            self._event(m, task_id, event, payload)
            self._save_meta(m)
            return {"message": f"task {task_id}: {event}", "task": task}

    def claim_task(self, task_id):
        def f(t):
            t["status"] = "running"; t["started_at"] = _now()
        return self._mutate(task_id, f, event="claimed")

    def complete_task(self, task_id):
        def f(t):
            t["status"] = "done"; t["completed_at"] = _now()
        return self._mutate(task_id, f, event="completed")

    def block_task(self, task_id, reason):
        def f(t):
            t["status"] = "blocked"; t["completed_at"] = _now()
        return self._mutate(task_id, f, event="blocked", payload={"reason": reason})

    def unblock_task(self, task_id, reason=None):
        def f(t):
            t["status"] = "ready"; t["completed_at"] = None
        return self._mutate(task_id, f, event="unblocked", payload={"reason": reason})

    def promote_task(self, task_id, reason=None, force=False):
        def f(t):
            t["status"] = "ready"
        return self._mutate(task_id, f, event="promoted", payload={"reason": reason, "force": force})

    def schedule_task(self, task_id, reason=None):
        def f(t):
            t["status"] = "scheduled"
        return self._mutate(task_id, f, event="scheduled", payload={"reason": reason})

    def archive_task(self, task_id):
        def f(t):
            t["status"] = "archived"
        return self._mutate(task_id, f, event="archived")

    def assign_task(self, task_id, profile):
        prof = None if profile.lower() in ("none", "unassign", "") else profile
        def f(t):
            t["assignee"] = prof
        return self._mutate(task_id, f, event="assigned", payload={"profile": prof})

    def reassign_task(self, task_id, profile, reclaim=False, reason=None):
        def f(t):
            t["assignee"] = profile
            if reclaim and t.get("status") == "running":
                t["status"] = "ready"; t["started_at"] = None
        return self._mutate(task_id, f, event="reassigned",
                            payload={"profile": profile, "reclaim": reclaim, "reason": reason})

    def reclaim_task(self, task_id):
        def f(t):
            if t.get("status") == "running":
                t["status"] = "ready"; t["started_at"] = None
        return self._mutate(task_id, f, event="reclaimed")

    def edit_task(self, task_id, result, summary=None, metadata=None):
        def f(t):
            t["result"] = result
        out = self._mutate(task_id, f, event="edited", payload={"summary": summary, "metadata": metadata})
        if summary:
            with self._lock:
                m = self._meta()
                m["runs"].setdefault(task_id, []).append({"summary": summary, "outcome": "edit", "created_at": _now()})
                self._save_meta(m)
        return out

    def comment_task(self, task_id, text, author=None):
        with self._lock:
            tasks = self._tasks()
            self._find(tasks, task_id)  # existence check
            m = self._meta()
            m["comments"].setdefault(task_id, []).append({
                "author": author or "operator", "body": text, "created_at": _now(),
            })
            self._event(m, task_id, "comment", {"author": author or "operator"})
            self._save_meta(m)
            return {"message": "comment added"}

    def link(self, parent_id, child_id):
        with self._lock:
            m = self._meta()
            pair = [parent_id, child_id]
            if pair not in m["links"]:
                m["links"].append(pair)
            self._save_meta(m)
            return {"message": f"linked {parent_id} -> {child_id}"}

    def unlink(self, parent_id, child_id):
        with self._lock:
            m = self._meta()
            m["links"] = [l for l in m["links"] if l != [parent_id, child_id]]
            self._save_meta(m)
            return {"message": f"unlinked {parent_id} -> {child_id}"}

    # ----------------------------------------------------------- aggregates
    def assignees(self) -> list[dict[str, Any]]:
        """[{name, on_disk, counts:{status:count}}] over all task assignees."""
        tasks = self._tasks()
        by: dict[str, dict[str, int]] = {}
        for t in tasks:
            name = t.get("assignee")
            if not name:
                continue
            counts = by.setdefault(name, {})
            st = t.get("status", "todo")
            counts[st] = counts.get(st, 0) + 1
        return [{"name": n, "on_disk": True, "counts": c} for n, c in by.items()]

    def stats(self) -> dict[str, Any]:
        tasks = self._tasks()
        by_status: dict[str, int] = {}
        by_assignee: dict[str, dict[str, int]] = {}
        oldest_ready: Optional[float] = None
        now = _now()
        for t in tasks:
            st = t.get("status", "todo")
            by_status[st] = by_status.get(st, 0) + 1
            who = t.get("assignee") or "unassigned"
            by_assignee.setdefault(who, {})
            by_assignee[who][st] = by_assignee[who].get(st, 0) + 1
            if st == "ready":
                ca = t.get("created_at")
                if isinstance(ca, (int, float)):
                    age = now - ca
                    oldest_ready = age if oldest_ready is None else max(oldest_ready, age)
        return {
            "by_status": by_status,
            "by_assignee": by_assignee,
            "oldest_ready_age_seconds": oldest_ready,
            "now": now,
        }

    def diagnostics(self) -> list[dict[str, Any]]:
        tasks = self._tasks()
        ids = {str(t.get("id")) for t in tasks}
        m = self._meta()
        now = _now()
        out: list[dict[str, Any]] = []
        for t in tasks:
            diags: list[dict[str, Any]] = []
            tid = str(t.get("id"))
            if t.get("status") == "running":
                started = t.get("started_at")
                if isinstance(started, (int, float)) and now - started > STALE_CLAIM_SECONDS:
                    hrs = int((now - started) // 3600)
                    diags.append({"kind": "stale_claim", "severity": "warn",
                                  "message": f"claimed {hrs}h ago and still running"})
            if t.get("status") == "blocked":
                evs = m["events"].get(tid, [])
                if not any(e.get("kind") == "blocked" and (e.get("payload") or {}).get("reason") for e in evs):
                    diags.append({"kind": "blocked_no_reason", "severity": "info",
                                  "message": "blocked without a recorded reason"})
            if diags:
                out.append({"task_id": tid, "title": t.get("title"), "status": t.get("status"),
                            "assignee": t.get("assignee"), "diagnostics": diags})
        # dangling dependency links
        for p, c in m["links"]:
            if str(p) not in ids or str(c) not in ids:
                out.append({"task_id": str(c), "title": None, "status": None, "assignee": None,
                            "diagnostics": [{"kind": "missing_dependency", "severity": "warn",
                                             "message": f"link {p} -> {c} references a missing task"}]})
        return out

    # --------------------------------------------------------------- boards
    def boards(self) -> list[dict[str, Any]]:
        m = self._meta()
        tasks = self._tasks()
        counts: dict[str, int] = {}
        for t in tasks:
            counts[t.get("status", "todo")] = counts.get(t.get("status", "todo"), 0) + 1
        out = []
        for b in m["boards"]:
            b = dict(b)
            b["is_current"] = (b["slug"] == m["current_board"])
            b["counts"] = counts if b["is_current"] else {}
            out.append(b)
        return out

    def create_board(self, slug, name=None, description=None, switch=False):
        with self._lock:
            m = self._meta()
            if not any(b["slug"] == slug for b in m["boards"]):
                m["boards"].append({"slug": slug, "name": name or slug,
                                    "description": description or "", "archived": False})
            if switch:
                m["current_board"] = slug
            self._save_meta(m)
            return {"message": f"board {slug} created"}

    def switch_board(self, slug):
        with self._lock:
            m = self._meta()
            m["current_board"] = slug
            self._save_meta(m)
            return {"message": f"switched to {slug}"}

    # -------------------------------------------------------- notifications
    def notify_list(self, task_id):
        return self._meta()["notifications"].get(task_id, [])

    def notify_subscribe(self, task_id, sub: dict):
        with self._lock:
            m = self._meta()
            m["notifications"].setdefault(task_id, []).append(sub)
            self._save_meta(m)
            return {"message": "subscribed"}

    def notify_unsubscribe(self, task_id, platform, chat_id, thread_id=None):
        with self._lock:
            m = self._meta()
            subs = m["notifications"].get(task_id, [])
            m["notifications"][task_id] = [
                s for s in subs
                if not (s.get("platform") == platform and s.get("chat_id") == chat_id
                        and (thread_id is None or s.get("thread_id") == thread_id))
            ]
            self._save_meta(m)
            return {"message": "unsubscribed"}

    # --------------------------------------------------------------- agents
    def list_agents(self) -> list[dict[str, Any]]:
        data = self._read(self.agents_file, [])
        return data if isinstance(data, list) else []

    def _save_agents(self, agents):
        self._write(self.agents_file, agents)

    def agents_with_counts(self) -> list[dict[str, Any]]:
        """Roster (agents.json) merged with live kanban counts — the get_agents shape."""
        roster = self.list_agents()
        counts = {a["name"]: a["counts"] for a in self.assignees()}
        names = {a["name"] for a in roster}
        out = [{"name": a["name"], "on_disk": True, "counts": counts.get(a["name"], {}),
                "role": a.get("role"), "skills": a.get("skills", []),
                "model": a.get("model"), "mcps": a.get("mcps", [])}
               for a in roster]
        # assignees present on tasks but not in the roster (legacy) still show up
        for a in self.assignees():
            if a["name"] not in names:
                out.append(a)
        return out

    def get_agent(self, name: str) -> Optional[dict[str, Any]]:
        return next((a for a in self.list_agents() if a["name"] == name), None)

    def create_agent(self, name, role=None, skills=None, model=None, mcps=None):
        with self._lock:
            agents = self.list_agents()
            if any(a["name"] == name for a in agents):
                return {"message": f"agent {name} already exists", "agent": {"name": name}}
            agent = {"name": name, "role": role, "skills": skills or [], "model": model,
                     "mcps": mcps or [], "created_at": _now()}
            agents.append(agent)
            self._save_agents(agents)
            return {"message": f"agent {name} created", "agent": agent}

    def update_agent(self, agent_id, name=None, role=None, skills=None, model=None):
        with self._lock:
            agents = self.list_agents()
            agent = next((a for a in agents if a["name"] == agent_id), None)
            if agent is None:
                raise KeyError(agent_id)
            if name and name != agent_id:
                agent["name"] = name
                # carry the rename onto any tasks assigned to the old name
                tasks = self._tasks()
                changed = False
                for t in tasks:
                    if t.get("assignee") == agent_id:
                        t["assignee"] = name; changed = True
                if changed:
                    self._save_tasks(tasks)
            if role is not None:
                agent["role"] = role
            if skills is not None:
                agent["skills"] = skills
            if model is not None:
                agent["model"] = model
            self._save_agents(agents)
            return {"message": "agent updated", "agent": agent}

    def delete_agent(self, agent_id):
        with self._lock:
            agents = self.list_agents()
            agents = [a for a in agents if a["name"] != agent_id]
            self._save_agents(agents)
            return {"message": f"agent {agent_id} deleted"}

    # ----------------------------------------------------------------- cron
    def _cron(self) -> list[dict[str, Any]]:
        data = self._read(self.cron_file, [])
        return data if isinstance(data, list) else []

    def _save_cron(self, jobs):
        self._write(self.cron_file, jobs)

    def list_cron(self) -> dict[str, Any]:
        jobs = self._cron()
        raw_lines = ["Scheduled Jobs"]
        for j in jobs:
            raw_lines.append(f"  {j['id']} [{j.get('status', 'active')}]")
            raw_lines.append(f"    Name: {j.get('name', '')}")
            raw_lines.append(f"    Schedule: {j.get('schedule', '')}")
            if j.get("next_run"):
                raw_lines.append(f"    Next run: {j['next_run']}")
        return {"jobs": jobs, "raw": "\n".join(raw_lines)}

    def create_cron(self, schedule, prompt=None, name=None, deliver=None,
                    repeat=None, skills=None) -> dict[str, Any]:
        with self._lock:
            jobs = self._cron()
            job = {
                "id": uuid.uuid4().hex[:12],
                "status": "active",
                "name": name or (prompt[:40] if prompt else schedule),
                "schedule": schedule,
                "prompt": prompt,
                "deliver": deliver or "origin",
                "repeat": repeat,
                "skills": skills or [],
                "created_at": _now(),
                "next_run": _next_run(schedule),
                "last_run": None,
            }
            jobs.append(job)
            self._save_cron(jobs)
            return {"message": f"cron job {job['id']} created", "jobs": jobs}

    def get_cron_job(self, job_id) -> Optional[dict[str, Any]]:
        return next((j for j in self._cron() if j["id"] == job_id), None)

    def mark_cron_run(self, job_id) -> None:
        with self._lock:
            jobs = self._cron()
            for j in jobs:
                if j["id"] == job_id:
                    j["last_run"] = _now()
                    j["next_run"] = _next_run(j.get("schedule", ""))
            self._save_cron(jobs)


def _next_run(schedule: str) -> Optional[str]:
    """Best-effort next-run display from a simple interval like '30m' / '2h' / '1d'.
    Cron expressions and natural phrases just show the raw schedule."""
    m = re.fullmatch(r"\s*(?:every\s+)?(\d+)\s*([mhd])\s*", (schedule or "").lower())
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2)
    secs = n * {"m": 60, "h": 3600, "d": 86400}[unit]
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(_now() + secs))
