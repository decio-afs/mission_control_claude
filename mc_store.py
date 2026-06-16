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

# Run-outcome strings that count as a failed attempt against a task's retry
# budget. Matched case-insensitively. `max_retries` is the budget; a task has
# exhausted it when its failed-attempt count reaches that number.
FAILED_OUTCOMES = {"error", "failed", "failure", "timeout", "timed_out", "crashed"}

# Substrings that identify a web-capable MCP plugin on an agent's `mcps` list.
# Matched case-insensitively — covers the common web-search/scrape providers.
WEB_MCP_MARKERS = ("brave", "tavily", "serper", "exa", "perplexity",
                   "websearch", "web-search", "web_search", "firecrawl", "fetch")
# Skill substrings that imply an agent must reach the live web to do its job
# (competitor/market research, SEO, performance pulls, brand/user discovery).
WEB_SKILL_MARKERS = ("competitive-brief", "synthesize-research", "discover-brand",
                     "seo-audit", "performance-report", "brand-review", "user-research")

# Generic English / ultra-common task verbs that carry no routing signal — they
# would otherwise spuriously match many agents' role text. Domain nouns
# (content, competitor, calendar, brand, growth, instagram, …) are kept.
ROUTE_STOPWORDS = frozenset({
    "the", "and", "for", "with", "all", "you", "your", "our", "into", "from",
    "that", "this", "are", "was", "will", "can", "get", "use", "via", "per",
    "new", "one", "two", "any", "each", "its", "has", "have", "not", "but",
    "out", "who", "how", "what", "when", "then", "than", "they", "them", "their",
    "across", "about", "over", "under", "more", "most", "some", "few",
})


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

    @staticmethod
    def _failed_attempts(task: dict[str, Any], runs: list[dict[str, Any]]) -> int:
        """How many attempts at a task have failed (against its retry budget).

        The signal is the task's run history: each run carries an ``outcome``,
        and any outcome in ``FAILED_OUTCOMES`` is a failed attempt. An explicit
        ``retries`` / ``attempts`` counter on the task (if a future worker writes
        one) is honored as a floor so the count is never under-reported. Used by
        both the ``retry_exhausted`` diagnostic and the escalation verb.
        """
        failed = sum(
            1 for r in runs
            if isinstance(r, dict) and str(r.get("outcome", "")).lower() in FAILED_OUTCOMES
        )
        explicit = task.get("retries")
        if not isinstance(explicit, (int, float)):
            explicit = task.get("attempts")
        if isinstance(explicit, (int, float)):
            failed = max(failed, int(explicit))
        return failed

    @staticmethod
    def _retry_budget(task: dict[str, Any]) -> Optional[int]:
        """Positive retry budget for a task, or None when it has no budget set."""
        mr = task.get("max_retries")
        if isinstance(mr, (int, float)) and int(mr) > 0:
            return int(mr)
        return None

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
        # Parent-link + status lookup for the dependency-ordering diagnostic.
        status_by_id = {str(t.get("id")): t.get("status") for t in tasks}
        parents_of: dict[str, list[str]] = {}
        for p, c in m["links"]:
            parents_of.setdefault(str(c), []).append(str(p))
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
            # Retry budget exhausted but never escalated — the task keeps
            # failing/re-queuing with no human in the loop. Only flag while it is
            # still open and not yet escalated (the escalate verb clears it).
            if t.get("status") not in TERMINAL:
                budget = self._retry_budget(t)
                if budget is not None:
                    attempts = self._failed_attempts(t, m["runs"].get(tid, []) or [])
                    already = any(e.get("kind") == "escalated" for e in m["events"].get(tid, []))
                    if attempts >= budget and not already:
                        diags.append({"kind": "retry_exhausted", "severity": "warn",
                                      "message": (f"exhausted retry budget "
                                                  f"({attempts}/{budget} attempts failed) "
                                                  f"— not yet escalated")})
            # Dependency ordering: a non-terminal task whose parent task(s) are
            # still open should not be worked yet. Surfaces the gate the cascade
            # verb enforces. Only counts existing-but-non-terminal parents
            # (dangling links are the separate `missing_dependency` diagnostic).
            if t.get("status") not in TERMINAL:
                open_parents = [p for p in parents_of.get(tid, [])
                                if p in ids and status_by_id.get(p) not in TERMINAL]
                if open_parents:
                    diags.append({"kind": "blocked_by_dependency", "severity": "warn",
                                  "message": (f"waiting on {len(open_parents)} open "
                                              f"dependency task(s): {', '.join(open_parents)}")})
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

    def web_access_audit(self) -> dict[str, Any]:
        """Audit which agents need live web access but lack a web-capable MCP.

        Research/intel agents (those with web-dependent skills) silently block
        when they have no web plugin — the root cause behind the board's
        `blocked_no_reason` research tasks. This turns that invisible config
        gap into a visible, per-agent report with the exact provisioning hint.
        It is a *diagnostic* surface only: it never provisions a key (that is
        operator config). `gap` rows (need web, lack it) sort first, then by
        most-blocked, so the operator sees the highest-impact misses on top.
        """
        agents = self.agents_with_counts()
        rows: list[dict[str, Any]] = []
        blocked_due_to_web = 0
        for a in agents:
            mcps = a.get("mcps") or []
            skills = a.get("skills") or []
            counts = a.get("counts") or {}
            blocked = int(counts.get("blocked", 0) or 0)
            has_web = any(any(mk in str(m).lower() for mk in WEB_MCP_MARKERS) for m in mcps)
            web_skills = [s for s in skills
                          if any(mk in str(s).lower() for mk in WEB_SKILL_MARKERS)]
            # An agent sitting on blocked tasks is empirically stuck — surface it
            # even if its skill list didn't trip the heuristic.
            needs_web = bool(web_skills) or blocked > 0
            gap = needs_web and not has_web
            if gap:
                blocked_due_to_web += blocked
            rows.append({
                "name": a.get("name"),
                "needs_web": needs_web,
                "has_web": has_web,
                "gap": gap,
                "blocked_tasks": blocked,
                "mcps": mcps,
                "web_skills": web_skills,
            })
        rows.sort(key=lambda r: (not r["gap"], -r["blocked_tasks"], r["name"] or ""))
        missing = [r for r in rows if r["gap"]]
        return {
            "agents": rows,
            "summary": {
                "total": len(rows),
                "needs_web": sum(1 for r in rows if r["needs_web"]),
                "missing_web": len(missing),
                "blocked_due_to_web": blocked_due_to_web,
            },
            "hint": ("Provision a web-search MCP for the flagged agents: install the "
                     "`web-brave-free` plugin (or set BRAVE_SEARCH_API_KEY) and add it to "
                     "each agent's `mcps`. Operator config — no key is created here."),
        }

    def reconcile_board(self, threshold_seconds: Optional[float] = None) -> dict[str, Any]:
        """Self-heal the board: reclaim running tasks whose claim has gone stale.

        A claim is stale when its ``started_at`` is older than ``threshold_seconds``
        (default ``STALE_CLAIM_SECONDS``). Stale-running tasks are returned to
        ``ready`` with ``started_at`` cleared and a ``reconciled`` event recording
        why — the fleet's auto-recovery from a dead/abandoned agent. The
        ``stale_claim`` diagnostic surfaces these; before this verb the only fix
        was a manual per-task reclaim, so a single dead agent could freeze the
        whole board indefinitely.
        """
        thr = STALE_CLAIM_SECONDS if threshold_seconds is None else float(threshold_seconds)
        with self._lock:
            tasks = self._tasks()
            now = _now()
            m = self._meta()
            reclaimed: list[dict[str, Any]] = []
            for t in tasks:
                if t.get("status") != "running":
                    continue
                started = t.get("started_at")
                if not isinstance(started, (int, float)):
                    continue
                age = now - started
                if age <= thr:
                    continue
                hrs = int(age // 3600)
                t["status"] = "ready"
                t["started_at"] = None
                reason = (f"stale claim auto-reclaimed after {hrs}h "
                          f"(assignee {t.get('assignee') or 'unassigned'} unresponsive)")
                self._event(m, str(t.get("id")), "reconciled",
                            {"reason": reason, "stale_hours": hrs})
                reclaimed.append({"id": str(t.get("id")), "title": t.get("title"),
                                  "assignee": t.get("assignee"), "stale_hours": hrs})
            if reclaimed:
                self._save_tasks(tasks)
                self._save_meta(m)
            return {
                "reclaimed": reclaimed,
                "threshold_hours": round(thr / 3600, 2),
                "message": (f"reconcile: {len(reclaimed)} stale claim(s) reclaimed"
                            if reclaimed else "reconcile: no stale claims found"),
            }

    def escalate_exhausted(self, task_id: Optional[str] = None,
                           dry_run: bool = False) -> dict[str, Any]:
        """Escalate tasks that have exhausted their retry budget.

        ``max_retries`` exists on every task but, post-Hermes, nothing acted on
        it — a task whose assignee kept failing would silently loop or sit with
        no human in the loop. This is the missing self-management path: for each
        open task whose failed-attempt count has reached its budget (and which
        hasn't already been escalated), it transitions the task to ``blocked``
        with a *recorded reason* (so it never shows as ``blocked_no_reason``) and
        an ``escalated`` event capturing attempts/budget/assignee. Blocking — not
        silent reassignment — is the safe default: the same agent would likely
        fail again, so a human (or the route verb) decides the next owner. The
        action is fully reversible (unblock / reassign / route). ``dry_run``
        returns the same plan without mutating. Honest by construction: with no
        failed runs recorded, nothing is escalated.
        """
        with self._lock:
            tasks = self._tasks()
            m = self._meta()
            if task_id is not None:
                cand = [t for t in tasks if str(t.get("id")) == str(task_id)]
                if not cand:
                    raise KeyError(task_id)
                pool = cand
            else:
                pool = list(tasks)

            escalated: list[dict[str, Any]] = []
            skipped: list[dict[str, Any]] = []
            changed = False
            for t in pool:
                tid = str(t.get("id"))
                budget = self._retry_budget(t)
                already = any(e.get("kind") == "escalated"
                              for e in m["events"].get(tid, []))
                attempts = self._failed_attempts(t, m["runs"].get(tid, []) or [])
                exhausted = (budget is not None and t.get("status") not in TERMINAL
                             and attempts >= budget and not already)
                if not exhausted:
                    # Only explain the skip for an explicitly-named task.
                    if task_id is not None:
                        if budget is None:
                            why = "no retry budget (max_retries unset)"
                        elif t.get("status") in TERMINAL:
                            why = f"terminal status ({t.get('status')})"
                        elif already:
                            why = "already escalated"
                        else:
                            why = f"budget not exhausted ({attempts}/{budget})"
                        skipped.append({"id": tid, "title": t.get("title"),
                                        "reason": why})
                    continue
                assignee = t.get("assignee") or "unassigned"
                reason = (f"retry budget exhausted: {attempts}/{budget} attempts "
                          f"failed (assignee {assignee}) — escalated for human review")
                entry = {"id": tid, "title": t.get("title"), "assignee": t.get("assignee"),
                         "attempts": attempts, "max_retries": budget,
                         "prev_status": t.get("status"), "reason": reason}
                if not dry_run:
                    t["status"] = "blocked"
                    self._event(m, tid, "escalated", {
                        "attempts": attempts, "max_retries": budget,
                        "assignee": t.get("assignee"),
                        "prev_status": entry["prev_status"], "reason": reason})
                    # Also record a `blocked` reason so the blocked card never
                    # shows up as `blocked_no_reason`.
                    self._event(m, tid, "blocked", {"reason": reason})
                    changed = True
                escalated.append(entry)
            if changed and not dry_run:
                self._save_tasks(tasks)
                self._save_meta(m)
            n = len(escalated)
            verb = "would escalate" if dry_run else "escalated"
            if n > 0:
                msg = f"escalate: {verb} {n} retry-exhausted task(s)"
            elif skipped:
                msg = f"escalate: nothing to escalate ({len(skipped)} skipped)"
            else:
                msg = "escalate: no retry-exhausted tasks"
            return {"escalated": escalated, "skipped": skipped,
                    "dry_run": dry_run, "message": msg}

    # ------------------------------------------------------- triage routing
    @staticmethod
    def _route_tokens(text: str) -> list[str]:
        """Lowercase word tokens (len>=3) with routing stopwords removed."""
        return [tok for tok in re.findall(r"[a-z0-9]+", str(text).lower())
                if len(tok) >= 3 and tok not in ROUTE_STOPWORDS]

    @classmethod
    def _route_score(cls, task_tokens: set[str], agent: dict[str, Any]):
        """Skill-match score of one agent against a task's token set.

        Skill slugs are split on non-alphanumerics and weighted x3 (the strong
        capability signal); role-text tokens weight x1. Multiplicity counts — an
        agent that lists a matching token across several skills scores higher,
        a fair proxy for depth in that area. Returns (score, matched_tokens,
        skill_matched_tokens) where ``skill_matched`` (task tokens that hit a
        *skill* token) gates routing confidence.
        """
        score = 0
        matched: set[str] = set()
        skill_matched: set[str] = set()
        for skill in agent.get("skills") or []:
            for tok in re.split(r"[^a-z0-9]+", str(skill).lower()):
                if len(tok) >= 3 and tok not in ROUTE_STOPWORDS and tok in task_tokens:
                    score += 3
                    matched.add(tok)
                    skill_matched.add(tok)
        for tok in cls._route_tokens(agent.get("role") or ""):
            if tok in task_tokens:
                score += 1
                matched.add(tok)
        return score, matched, skill_matched

    def route_triage(self, task_id: Optional[str] = None,
                     dry_run: bool = False) -> dict[str, Any]:
        """Auto-route triage tasks to the best-fit agent by skill match.

        The post-Hermes board has no dispatcher, so a triage task sits unassigned
        until a human picks an owner. This is the deterministic *assign-by-skill*
        half of the "triage → specify → assign" flow (the Claude ``specify``
        flesh-out stays a separate, opt-in step). For each triage task it scores
        every rostered agent (``_route_score``), requires at least one *skill*
        token match for confidence, breaks ties toward the *least-loaded* agent
        (so work spreads), assigns the winner and de-triages the task to ``todo``
        with a ``routed`` event recording the match. No skill match → the task is
        honestly **left in triage** (never force-assigned). ``dry_run`` returns the
        same plan without mutating — safe to preview. Moving to ``todo`` does not
        fire any worker (there is no in-process dispatcher), so this never starts
        a Claude run on its own.
        """
        with self._lock:
            tasks = self._tasks()
            roster = self.agents_with_counts()
            # Current open (non-terminal) load per agent — the tie-break weight.
            load: dict[str, int] = {}
            for t in tasks:
                who = t.get("assignee")
                if who and t.get("status") not in TERMINAL:
                    load[who] = load.get(who, 0) + 1
            if task_id is not None:
                cand = [t for t in tasks if str(t.get("id")) == str(task_id)]
                if not cand:
                    raise KeyError(task_id)
                if cand[0].get("status") != "triage":
                    return {"routed": [], "skipped": [{
                        "id": str(task_id), "title": cand[0].get("title"),
                        "reason": f"not in triage (status={cand[0].get('status')})"}],
                        "dry_run": dry_run, "message": "route: task not in triage"}
                cands = cand
            else:
                cands = [t for t in tasks if t.get("status") == "triage"]

            m = self._meta()
            routed: list[dict[str, Any]] = []
            skipped: list[dict[str, Any]] = []
            changed = False
            for t in cands:
                task_tokens = set(self._route_tokens(
                    f"{t.get('title') or ''} {t.get('body') or ''}"))
                scored = []
                for a in roster:
                    sc, matched, skill_matched = self._route_score(task_tokens, a)
                    if sc > 0:
                        scored.append((sc, a, matched, skill_matched))
                # score desc, then least-loaded, then name (fully deterministic)
                scored.sort(key=lambda x: (-x[0], load.get(x[1].get("name"), 0),
                                           x[1].get("name") or ""))
                best = next((s for s in scored if s[3]), None)
                if best is None:
                    skipped.append({"id": str(t.get("id")), "title": t.get("title"),
                                    "reason": "no confident skill match — left in triage"})
                    continue
                sc, agent, matched, skill_matched = best
                name = agent.get("name")
                runner = next((s[1].get("name") for s in scored
                               if s[1].get("name") != name), None)
                mcps = agent.get("mcps") or []
                askills = agent.get("skills") or []
                has_web = any(any(mk in str(mm).lower() for mk in WEB_MCP_MARKERS)
                              for mm in mcps)
                needs_web = any(any(mk in str(s).lower() for mk in WEB_SKILL_MARKERS)
                                for s in askills)
                web_gap = needs_web and not has_web
                entry = {"id": str(t.get("id")), "title": t.get("title"),
                         "assignee": name, "score": sc,
                         "matched": sorted(matched),
                         "skill_match": sorted(skill_matched),
                         "runner_up": runner, "web_gap": web_gap}
                if not dry_run:
                    t["assignee"] = name
                    t["status"] = "todo"
                    self._event(m, str(t.get("id")), "routed", {
                        **{k: entry[k] for k in
                           ("assignee", "score", "matched", "skill_match",
                            "runner_up", "web_gap")},
                        "reason": (f"skill-match auto-route → {name} (score {sc}, "
                                   f"matched {', '.join(sorted(skill_matched))})")})
                    load[name] = load.get(name, 0) + 1
                    changed = True
                routed.append(entry)
            if changed and not dry_run:
                self._save_tasks(tasks)
                self._save_meta(m)
            n = len(routed)
            verb = "would route" if dry_run else "routed"
            msg = (f"route: {verb} {n} task(s)"
                   + (f", {len(skipped)} left in triage" if skipped else "")) \
                if (routed or skipped) else "route: no triage tasks"
            return {"routed": routed, "skipped": skipped,
                    "dry_run": dry_run, "message": msg}

    # ------------------------------------------------- dependency ordering
    @staticmethod
    def _dep_held(events: list[dict[str, Any]]) -> bool:
        """Whether a task is currently held by the dependency gate.

        Tracked purely from its event timeline: a `dependency_hold` sets the
        held state, a later `dependency_clear` lifts it. This lets the cascade
        verb promote ONLY tasks it itself held — a task blocked for any other
        reason (e.g. missing web access) is never disturbed.
        """
        held = False
        for e in events:
            k = e.get("kind")
            if k == "dependency_hold":
                held = True
            elif k == "dependency_clear":
                held = False
        return held

    def cascade_dependencies(self, dry_run: bool = False) -> dict[str, Any]:
        """Enforce parent→child dependency ordering across the board.

        Parent→child links exist (`kanban-meta.json["links"]`, surfaced as
        parents/children on a task and via the `missing_dependency` diagnostic)
        but post-Hermes nothing enforced ordering: a child could be claimed
        while its parents were still open, and nothing re-promoted a child once
        its last parent finished. This is the missing orchestration sweep. In
        one pass it:
          * HOLDS a workable child (status ``todo``/``ready``) that still has
            open (existing, non-terminal) parents → moves it to ``blocked`` with
            a ``dependency_hold`` event + a ``blocked`` reason (so it never shows
            ``blocked_no_reason``), keeping it from being worked out of order;
          * PROMOTES a child this gate previously held (status ``blocked``, last
            dependency event a hold) once ALL its parents are terminal → back to
            ``ready`` with a ``dependency_clear`` event;
          * surfaces children still WAITING (held, parents not all done yet).
        Conservative by construction: it only promotes tasks it held, so a task
        blocked for another reason is never touched. Idempotent — a second pass
        finds nothing new. ``dry_run`` returns the same plan without mutating.
        Moving a child to ``ready`` fires no worker (no in-process dispatcher).
        """
        with self._lock:
            tasks = self._tasks()
            m = self._meta()
            ids = {str(t.get("id")) for t in tasks}
            status_by_id = {str(t.get("id")): t.get("status") for t in tasks}
            parents_of: dict[str, list[str]] = {}
            for p, c in m["links"]:
                parents_of.setdefault(str(c), []).append(str(p))

            held: list[dict[str, Any]] = []
            promoted: list[dict[str, Any]] = []
            waiting: list[dict[str, Any]] = []
            changed = False
            for t in tasks:
                tid = str(t.get("id"))
                parents = parents_of.get(tid)
                if not parents:
                    continue
                open_parents = [p for p in parents
                                if p in ids and status_by_id.get(p) not in TERMINAL]
                status = t.get("status")
                is_held = self._dep_held(m["events"].get(tid, []))
                if open_parents and status in ("todo", "ready"):
                    reason = (f"held: waiting on {len(open_parents)} open "
                              f"dependency task(s) ({', '.join(open_parents)})")
                    held.append({"id": tid, "title": t.get("title"),
                                 "open_parents": open_parents,
                                 "prev_status": status, "reason": reason})
                    if not dry_run:
                        t["status"] = "blocked"
                        self._event(m, tid, "dependency_hold",
                                    {"open_parents": open_parents,
                                     "prev_status": status, "reason": reason})
                        self._event(m, tid, "blocked", {"reason": reason})
                        changed = True
                elif is_held and status == "blocked" and not open_parents:
                    reason = "promoted: all dependency task(s) complete"
                    promoted.append({"id": tid, "title": t.get("title"),
                                     "parents": parents, "reason": reason})
                    if not dry_run:
                        t["status"] = "ready"
                        self._event(m, tid, "dependency_clear",
                                    {"parents": parents, "reason": reason})
                        changed = True
                elif is_held and status == "blocked" and open_parents:
                    waiting.append({"id": tid, "title": t.get("title"),
                                    "open_parents": open_parents})
            if changed and not dry_run:
                self._save_tasks(tasks)
                self._save_meta(m)
            verb_h = "would hold" if dry_run else "held"
            verb_p = "would promote" if dry_run else "promoted"
            parts: list[str] = []
            if held:
                parts.append(f"{verb_h} {len(held)}")
            if promoted:
                parts.append(f"{verb_p} {len(promoted)}")
            if waiting:
                parts.append(f"{len(waiting)} still waiting")
            msg = "cascade: " + (", ".join(parts) if parts
                                 else "no dependency changes")
            return {"held": held, "promoted": promoted, "waiting": waiting,
                    "dry_run": dry_run, "message": msg}

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

    def record_cron_result(self, job_id, ok: bool, detail: str = "",
                           trigger: str = "manual") -> None:
        """Stamp a job's outcome after a fire (scheduled or manual).

        Records ``last_run`` (epoch), ``last_status`` (ok|error), the trigger that
        fired it, and a short ``last_detail`` excerpt — so the UI can show whether a
        scheduled job is actually executing instead of silently never firing."""
        with self._lock:
            jobs = self._cron()
            for j in jobs:
                if j["id"] == job_id:
                    j["last_run"] = _now()
                    j["last_status"] = "ok" if ok else "error"
                    j["last_trigger"] = trigger
                    j["last_detail"] = (detail or "")[:280]
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
