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

# Internal maintenance verbs a `kind:"maintenance"` cron job can fire directly
# (no Claude turn). `sweep` runs the full board self-heal macro. This is the
# post-Hermes "board self-heals on a timer" path — see run_maintenance().
MAINTENANCE_ACTIONS = {"sweep"}

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
            # Append parent links through the same cycle guard. A fresh task has
            # no children yet, so the only edge a single parent can close is a
            # self-link (parent == new id); routing every parent through
            # `_would_cycle` against the running link set keeps create_task and
            # link() consistent and defends against bad parent ids.
            for parent in getattr(payload, "parents", None) or []:
                if self._would_cycle(m["links"], parent, t["id"]):
                    continue
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

    def complete_task(self, task_id, result=None):
        def f(t):
            t["status"] = "done"; t["completed_at"] = _now()
            if result is not None:
                t["result"] = result
        payload = {"result_excerpt": str(result)[:200]} if result else None
        return self._mutate(task_id, f, event="completed", payload=payload)

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
            # Refuse self-links and any edge that would close a dependency
            # cycle — otherwise the cascade gate's "all parents done" becomes
            # unreachable and the child waits forever, silently.
            if self._would_cycle(m["links"], parent_id, child_id):
                if str(parent_id) == str(child_id):
                    raise ValueError(
                        f"refusing self-link {parent_id} -> {child_id}: "
                        f"a task cannot depend on itself")
                raise ValueError(
                    f"refusing link {parent_id} -> {child_id}: "
                    f"would create a dependency cycle")
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
        # Pre-existing dependency cycles (self-links or longer loops) that slipped
        # in before the `_would_cycle` guard — a cycle makes the cascade gate's
        # "all parents done" unreachable, so a child waits forever, silently.
        cycle_nodes = self._cycle_nodes(m["links"])
        # Dead/idle assignees (off-roster or sitting on a stale running claim) —
        # used to flag their reassignable open work for the reassign verb.
        roster_names = {a.get("name") for a in self.list_agents()}
        dead = self._dead_agents(tasks, roster_names, now)
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
            # Dependency cycle: this task is part of a directed loop in the link
            # graph (self-link or longer). The cascade gate can never clear it,
            # so it would wait forever — surface it for an unlink remediation.
            if tid in cycle_nodes:
                parents = parents_of.get(tid, [])
                diags.append({"kind": "dependency_cycle", "severity": "warn",
                              "message": ("part of a dependency cycle — "
                                          "the gate can never clear it; "
                                          f"parent(s): {', '.join(parents) or 'self'}")})
            # Dead/idle assignee: an off-roster or stale-claim agent still holds
            # workable open work (todo/ready or a stale running claim). Surfaces
            # the gate the `reassign` verb remediates — move the work to a live
            # best-fit owner instead of letting it rot on an absent agent. Blocked
            # tasks are intentionally NOT flagged (they are blocked for a recorded
            # reason; reassigning would hide it, not help).
            who = t.get("assignee")
            if who in dead and (t.get("status") in ("todo", "ready")
                                or self._is_stale_running(t, now)):
                diags.append({"kind": "dead_agent_task", "severity": "warn",
                              "message": (f"assignee '{who}' appears dead/idle "
                                          f"({dead[who]['reason']}) — reassignable")})
            # Promotable: a `todo` task with a live assignee and no open parent
            # dependency is ready to run, but the dispatcher only fires `ready`
            # work — so it sits idle until promoted. Surfaces the gate the
            # `promote_ready` verb (todo→ready) closes: the dispatcher's feeder.
            if (t.get("status") == "todo" and who and who in roster_names
                    and who not in dead and tid not in cycle_nodes):
                open_parents = [p for p in parents_of.get(tid, [])
                                if p in ids and status_by_id.get(p) not in TERMINAL]
                if not open_parents:
                    diags.append({"kind": "promotable", "severity": "info",
                                  "message": ("assigned & unblocked but still in "
                                              "todo — promote → ready so the "
                                              "dispatcher can run it")})
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

    @staticmethod
    def _is_stale_running(task: dict[str, Any], now: float) -> bool:
        """Whether a task is a stale running claim (running past the threshold)."""
        if task.get("status") != "running":
            return False
        started = task.get("started_at")
        return (isinstance(started, (int, float))
                and now - started > STALE_CLAIM_SECONDS)

    @staticmethod
    def _dead_agents(tasks: list[dict[str, Any]], roster_names: set,
                     now: float) -> dict[str, dict[str, Any]]:
        """Assignees that appear dead/idle while still holding open work.

        An agent is considered dead/idle when, holding at least one non-terminal
        task, it is EITHER off the live roster (a deleted/legacy assignee whose
        worker is gone) OR sitting on a stale running claim (its claimed task has
        been "running" past ``STALE_CLAIM_SECONDS`` with no progress — the worker
        is unresponsive). An agent that is merely busy, or whose tasks are blocked
        for a *recorded* reason, is NOT dead — so this never mistakes the
        web-access-blocked research tasks for a dead agent. Returns
        ``{name: {off_roster, stale_running, reason}}``.
        """
        open_assignees: set = set()
        stale_by: dict[str, int] = {}
        for t in tasks:
            who = t.get("assignee")
            if not who:
                continue
            if t.get("status") not in TERMINAL:
                open_assignees.add(who)
            if MCStore._is_stale_running(t, now):
                stale_by[who] = stale_by.get(who, 0) + 1
        dead: dict[str, dict[str, Any]] = {}
        for who in open_assignees:
            off = who not in roster_names
            stale = stale_by.get(who, 0)
            if not (off or stale):
                continue
            reasons: list[str] = []
            if off:
                reasons.append("off the live roster")
            if stale:
                reasons.append(f"{stale} stale running claim(s)")
            dead[who] = {"off_roster": off, "stale_running": stale,
                         "reason": " + ".join(reasons)}
        return dead

    def reassign_dead_agent(self, from_agent: Optional[str] = None,
                            dry_run: bool = False) -> dict[str, Any]:
        """Reassign a dead/idle agent's open work to the best-fit live agent.

        ``reconcile_board`` reclaims a stale running claim back to ``ready`` but
        leaves it on the same dead assignee, so the next claim re-fails on the
        same gone worker; and an off-roster (deleted) agent's backlog has no owner
        who will ever run it. This is the missing orchestration path: it detects
        dead/idle agents (``_dead_agents`` — off-roster, or holding a stale running
        claim) and moves each of their *workable* tasks (``todo``/``ready``, or a
        stale ``running`` claim which is also reclaimed to ``ready``) to the
        best-fit *other* agent by skill match — reusing the run#4 ``_route_score``
        scorer, requiring a skill-token match for confidence, breaking ties toward
        the least-loaded agent. A task with no confident match on another agent is
        honestly **left in place** (never dumped on a random owner). Other dead
        agents are excluded as targets. ``blocked`` tasks are never touched (they
        are blocked for a recorded reason — reassigning would hide it). Records a
        ``reassigned`` event per move; ``dry_run`` returns the same plan without
        mutating. Honest by construction: no dead agents → nothing reassigned.
        """
        with self._lock:
            tasks = self._tasks()
            now = _now()
            roster = self.agents_with_counts()  # scoring data (skills/role/counts)
            # The RAW roster is the off-roster truth — agents_with_counts folds
            # legacy task-only assignees back in, which would mask an off-roster
            # (deleted) agent. Use the same source `diagnostics()` does so the
            # button count and the verb agree exactly.
            roster_names = {a.get("name") for a in self.list_agents()}
            auto_dead = self._dead_agents(tasks, roster_names, now)
            # `act_on` = agents whose tasks we reassign this call; `auto_dead` is
            # kept separate so even in single-agent mode we never reassign onto
            # ANOTHER dead agent.
            if from_agent is not None:
                if from_agent in auto_dead:
                    act_on = {from_agent: auto_dead[from_agent]}
                else:
                    # Operator explicitly names an agent: honor it iff it actually
                    # holds reassignable work, else skip honestly.
                    has_open = any(
                        t.get("assignee") == from_agent
                        and (t.get("status") in ("todo", "ready")
                             or self._is_stale_running(t, now))
                        for t in tasks)
                    if not has_open:
                        return {"reassigned": [], "skipped": [], "dead_agents": [],
                                "dry_run": dry_run,
                                "message": (f"reassign: agent '{from_agent}' has no "
                                            f"reassignable open work")}
                    act_on = {from_agent: {
                        "off_roster": from_agent not in roster_names,
                        "stale_running": 0, "reason": "operator-specified"}}
            else:
                act_on = auto_dead

            # Current open (non-terminal) load per agent — the tie-break weight.
            load: dict[str, int] = {}
            for t in tasks:
                who = t.get("assignee")
                if who and t.get("status") not in TERMINAL:
                    load[who] = load.get(who, 0) + 1
            # Eligible targets: agents on the LIVE roster that are neither a source
            # nor themselves dead/idle (never reassign onto an off-roster or
            # stale-claim agent, nor back onto the agent we're draining).
            exclude = set(auto_dead) | set(act_on)
            targets = [a for a in roster
                       if a.get("name") in roster_names and a.get("name") not in exclude]

            m = self._meta()
            reassigned: list[dict[str, Any]] = []
            skipped: list[dict[str, Any]] = []
            changed = False
            for t in tasks:
                who = t.get("assignee")
                if who not in act_on:
                    continue
                workable = (t.get("status") in ("todo", "ready")
                            or self._is_stale_running(t, now))
                if not workable:
                    continue
                task_tokens = set(self._route_tokens(
                    f"{t.get('title') or ''} {t.get('body') or ''}"))
                scored = []
                for a in targets:
                    sc, matched, skill_matched = self._route_score(task_tokens, a)
                    if sc > 0:
                        scored.append((sc, a, matched, skill_matched))
                scored.sort(key=lambda x: (-x[0], load.get(x[1].get("name"), 0),
                                           x[1].get("name") or ""))
                best = next((s for s in scored if s[3]), None)
                if best is None:
                    skipped.append({"id": str(t.get("id")), "title": t.get("title"),
                                    "from": who,
                                    "reason": ("no confident skill match on another "
                                               "agent — left in place")})
                    continue
                sc, agent, matched, skill_matched = best
                to = agent.get("name")
                was_stale = self._is_stale_running(t, now)
                entry = {"id": str(t.get("id")), "title": t.get("title"),
                         "from": who, "to": to, "score": sc,
                         "matched": sorted(matched),
                         "skill_match": sorted(skill_matched),
                         "reclaimed": was_stale, "prev_status": t.get("status")}
                if not dry_run:
                    t["assignee"] = to
                    if was_stale:
                        t["status"] = "ready"
                        t["started_at"] = None
                    reason = (f"dead-agent reassign: {who} → {to} "
                              f"({act_on[who]['reason']}; score {sc}, matched "
                              f"{', '.join(sorted(skill_matched))})")
                    self._event(m, str(t.get("id")), "reassigned", {
                        "from": who, "to": to, "profile": to, "score": sc,
                        "matched": sorted(matched),
                        "skill_match": sorted(skill_matched),
                        "reclaimed": was_stale, "reason": reason})
                    load[who] = max(0, load.get(who, 1) - 1)
                    load[to] = load.get(to, 0) + 1
                    changed = True
                reassigned.append(entry)
            if changed and not dry_run:
                self._save_tasks(tasks)
                self._save_meta(m)
            dead_list = [{"name": n, **info} for n, info in act_on.items()]
            n = len(reassigned)
            verb = "would reassign" if dry_run else "reassigned"
            if n > 0:
                msg = (f"reassign: {verb} {n} task(s) off "
                       f"{len(act_on)} dead/idle agent(s)")
            elif act_on:
                msg = (f"reassign: {len(act_on)} dead/idle agent(s), nothing "
                       f"reassignable" + (f" ({len(skipped)} skipped)" if skipped else ""))
            else:
                msg = "reassign: no dead/idle agents"
            return {"reassigned": reassigned, "skipped": skipped,
                    "dead_agents": dead_list, "dry_run": dry_run, "message": msg}

    def reconcile_board(self, threshold_seconds: Optional[float] = None,
                        dry_run: bool = False) -> dict[str, Any]:
        """Self-heal the board: reclaim running tasks whose claim has gone stale.

        A claim is stale when its ``started_at`` is older than ``threshold_seconds``
        (default ``STALE_CLAIM_SECONDS``). Stale-running tasks are returned to
        ``ready`` with ``started_at`` cleared and a ``reconciled`` event recording
        why — the fleet's auto-recovery from a dead/abandoned agent. The
        ``stale_claim`` diagnostic surfaces these; before this verb the only fix
        was a manual per-task reclaim, so a single dead agent could freeze the
        whole board indefinitely. ``dry_run`` returns the same plan without
        mutating — so the ``sweep_board`` macro can preview reconcile alongside the
        other self-heal verbs.
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
                reason = (f"stale claim auto-reclaimed after {hrs}h "
                          f"(assignee {t.get('assignee') or 'unassigned'} unresponsive)")
                reclaimed.append({"id": str(t.get("id")), "title": t.get("title"),
                                  "assignee": t.get("assignee"), "stale_hours": hrs})
                if not dry_run:
                    t["status"] = "ready"
                    t["started_at"] = None
                    self._event(m, str(t.get("id")), "reconciled",
                                {"reason": reason, "stale_hours": hrs})
            if reclaimed and not dry_run:
                self._save_tasks(tasks)
                self._save_meta(m)
            verb = "would reclaim" if dry_run else "reclaimed"
            return {
                "reclaimed": reclaimed,
                "threshold_hours": round(thr / 3600, 2),
                "dry_run": dry_run,
                "message": (f"reconcile: {verb} {len(reclaimed)} stale claim(s)"
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
    def _would_cycle(links: list[Any], parent: Any, child: Any) -> bool:
        """Whether adding the edge ``parent -> child`` would create a cycle.

        Links are ``[parent, child]`` pairs (a parent must finish before its
        child). Adding ``parent -> child`` closes a cycle iff ``child`` can
        already reach ``parent`` by following existing edges — or the edge is a
        self-link (``parent == child``). Pure DFS over the current link set; the
        proposed edge is NOT added first (we look for an existing child→parent
    # ------------------------------------------------- dispatch (run tasks)
    def dispatchable_tasks(self, limit: Optional[int] = None) -> list[dict[str, Any]]:
        """Tasks the dispatcher could fire right now, best-first (read-only).

        A task is dispatchable iff status==`ready`, it has an `assignee` on the
        live roster (an off-roster owner would never run it — that is the
        reassign verb's job), and it is not already `running`/`done`. Conservative
        on purpose: only `ready` (explicitly-promoted "go" work), never raw `todo`
        backlog — an operator / the cascade gate promotes todo→ready when a task
        is genuinely ready to execute. Sorted priority desc then oldest-first so
        the most important, longest-waiting work goes first. Returns a light plan
        row per task and mutates nothing — this is also the dry-run preview the
        dispatcher daemon and the manual endpoint share.
        """
        with self._lock:
            agents_by_name = {a.get("name"): a for a in self.list_agents()}
            out: list[dict[str, Any]] = []
            for t in self._tasks():
                if not isinstance(t, dict) or t.get("status") != "ready":
                    continue
                assignee = t.get("assignee")
                agent = agents_by_name.get(assignee)
                if not assignee or agent is None:
                    continue  # unassigned / off-roster → not dispatchable here
                mcps = agent.get("mcps") or []
                askills = agent.get("skills") or []
                has_web = any(any(mk in str(mm).lower() for mk in WEB_MCP_MARKERS)
                              for mm in mcps)
                needs_web = any(any(mk in str(s).lower() for mk in WEB_SKILL_MARKERS)
                                for s in askills)
                out.append({
                    "id": str(t.get("id")),
                    "title": t.get("title"),
                    "assignee": assignee,
                    "priority": t.get("priority", 0) or 0,
                    "created_at": t.get("created_at"),
                    "agent_model": agent.get("model"),
                    "agent_mcps": mcps,
                    "web_gap": needs_web and not has_web,
                })
            out.sort(key=lambda r: (-(r["priority"] or 0), r.get("created_at") or 0))
            return out[:limit] if limit else out

    def record_task_run(self, task_id: str, *, status: str, summary: Optional[str] = None,
                        session_id: Optional[str] = None, cost_usd: Optional[float] = None,
                        error: Optional[str] = None, trigger: str = "dispatch") -> dict[str, Any]:
        """Append a run record to a task's history (``meta['runs'][task_id]``).

        Runs feed ``has_deliverable``, the drawer's ``latest_summary``, and the
        retry-exhaustion counter (``_failed_attempts`` counts runs whose
        ``outcome`` ∈ FAILED_OUTCOMES) — so a recorded failed run flows straight
        into the escalate verb. No public run-writer existed before the dispatcher
        needed one. Also stamps the task's resumable ``session_id`` when given.
        Raises ``KeyError`` for an unknown id.
        """
        with self._lock:
            tasks = self._tasks()
            task = self._find(tasks, task_id)
            run = {
                "id": uuid.uuid4().hex[:12],
                "outcome": status,
                "summary": ((summary or "")[:4000] or None),
                "error": error,
                "session_id": session_id,
                "cost_usd": cost_usd,
                "trigger": trigger,
                "created_at": _now(),
            }
            m = self._meta()
            m["runs"].setdefault(str(task_id), []).append(run)
            if session_id:
                task["session_id"] = session_id
                self._save_tasks(tasks)
            self._save_meta(m)
            return run

    def requeue_task(self, task_id, reason=None):
        """Return a (failed/aborted) running task to ``ready`` for another attempt.

        The dispatcher uses this on a failed run so the task is retryable rather
        than left stuck `running` (a stale claim only reconcile would later free);
        repeated failures still accrue runs, so the escalate verb eventually blocks
        a task whose assignee keeps failing it.
        """
        def f(t):
            t["status"] = "ready"; t["started_at"] = None
        return self._mutate(task_id, f, event="requeued", payload={"reason": reason})

        path). Used as the guard at both `link()` and `create_task`'s
        parent-append loop so a cycle can never be persisted in the first place.
        """
        parent, child = str(parent), str(child)
        if parent == child:
            return True
        adj: dict[str, list[str]] = {}
        for p, c in links:
            adj.setdefault(str(p), []).append(str(c))
        stack = [child]
        seen: set[str] = set()
        while stack:
            n = stack.pop()
            if n == parent:
                return True
            if n in seen:
                continue
            seen.add(n)
            stack.extend(adj.get(n, []))
        return False

    @staticmethod
    def _cycle_nodes(links: list[Any]) -> set[str]:
        """The set of node ids that participate in ≥1 directed cycle.

        Catches pre-existing bad data that slipped in before the `_would_cycle`
        guard existed (self-links and longer cycles). A node is in a cycle iff,
        following ``parent -> child`` edges, it can return to itself via ≥1 edge.
        Self-loops (``A -> A``) are included. O(V·(V+E)) — fine for a board.
        """
        adj: dict[str, list[str]] = {}
        nodes: set[str] = set()
        for p, c in links:
            adj.setdefault(str(p), []).append(str(c))
            nodes.add(str(p))
            nodes.add(str(c))
        in_cycle: set[str] = set()
        for start in nodes:
            stack = list(adj.get(start, []))
            seen: set[str] = set()
            while stack:
                n = stack.pop()
                if n == start:
                    in_cycle.add(start)
                    break
                if n in seen:
                    continue
                seen.add(n)
                stack.extend(adj.get(n, []))
        return in_cycle

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

    def promote_ready(self, task_id: Optional[str] = None,
                      dry_run: bool = False) -> dict[str, Any]:
        """Promote actionable ``todo`` tasks to ``ready`` — the dispatcher's feeder.

        The dispatcher (and ``dispatchable_tasks``) is conservative on purpose: it
        only fires ``ready`` work, never raw ``todo`` backlog. Post-Hermes nothing
        moved todo→ready in bulk, so a freshly-routed/assigned task sat in ``todo``
        forever and the dispatcher stayed starved (0 ready ⇒ nothing to run). This
        is the missing board-wide promotion gate — distinct from the per-task,
        ungated ``promote_task`` (the drawer's manual "move this one to ready"):
        it scans the whole board and promotes every task that is genuinely ready.

        A ``todo`` task is promotable iff it has an ``assignee`` on the live roster
        (an off-roster owner is the *reassign* verb's job) AND it has NO open
        (existing, non-terminal) parent dependency (an open parent is the *cascade*
        verb's job — that gate HOLDS the task, it does not promote it). Promotion
        moves the task to ``ready`` with a ``promoted`` event recording the reason.
        Honest by construction: a task that is unassigned, off-roster, or
        dependency-blocked is **left in todo** with a skip reason (never
        force-promoted — that is what the manual ``promote_task`` is for).
        Conservative — only touches ``todo`` (never resurrects a blocked/triage
        task), idempotent (a second pass finds nothing — promoted tasks are now
        ``ready``), and ``dry_run`` previews without mutating. Moving to ``ready``
        fires no worker on its own; the dispatcher (gated off by default) executes.
        """
        with self._lock:
            tasks = self._tasks()
            m = self._meta()
            ids = {str(t.get("id")) for t in tasks}
            status_by_id = {str(t.get("id")): t.get("status") for t in tasks}
            parents_of: dict[str, list[str]] = {}
            for p, c in m["links"]:
                parents_of.setdefault(str(c), []).append(str(p))
            roster_names = {a.get("name") for a in self.list_agents()}

            if task_id is not None:
                cand = [t for t in tasks if str(t.get("id")) == str(task_id)]
                if not cand:
                    raise KeyError(task_id)
                cands = cand
            else:
                cands = [t for t in tasks if t.get("status") == "todo"]

            promoted: list[dict[str, Any]] = []
            skipped: list[dict[str, Any]] = []
            changed = False
            for t in cands:
                tid = str(t.get("id"))
                if t.get("status") != "todo":
                    skipped.append({"id": tid, "title": t.get("title"),
                                    "reason": f"not in todo (status={t.get('status')})"})
                    continue
                who = t.get("assignee")
                if not who or who not in roster_names:
                    skipped.append({"id": tid, "title": t.get("title"),
                                    "reason": ("unassigned — route/assign first" if not who
                                               else f"off-roster assignee '{who}' — reassign first")})
                    continue
                open_parents = [p for p in parents_of.get(tid, [])
                                if p in ids and status_by_id.get(p) not in TERMINAL]
                if open_parents:
                    skipped.append({"id": tid, "title": t.get("title"),
                                    "reason": (f"waiting on {len(open_parents)} open "
                                               f"dependency task(s) — cascade first")})
                    continue
                reason = (f"promoted todo→ready (assignee '{who}' live, "
                          f"no open dependencies)")
                entry = {"id": tid, "title": t.get("title"),
                         "assignee": who, "reason": reason}
                if not dry_run:
                    t["status"] = "ready"
                    self._event(m, tid, "promoted",
                                {"assignee": who, "reason": reason, "gate": "promote_ready"})
                    changed = True
                promoted.append(entry)
            if changed and not dry_run:
                self._save_tasks(tasks)
                self._save_meta(m)
            n = len(promoted)
            verb = "would promote" if dry_run else "promoted"
            if n:
                msg = f"promote: {verb} {n} task(s) todo→ready"
                if skipped and task_id is None:
                    msg += f", {len(skipped)} left in todo (blocked/unassigned)"
            elif skipped and task_id is not None:
                msg = f"promote: {skipped[0]['reason']}"
            elif skipped:
                msg = f"promote: nothing promotable ({len(skipped)} todo blocked/unassigned)"
            else:
                msg = "promote: no actionable todo tasks"
            return {"promoted": promoted, "skipped": skipped,
                    "dry_run": dry_run, "message": msg}

    def sweep_board(self, dry_run: bool = False) -> dict[str, Any]:
        """One-call board self-manage macro — run the four self-heal verbs in order.

        Each self-heal verb (reconcile / cascade / reassign / escalate) had its own
        button and call, but there was no single entry point that ran them in the
        right order in one shot — the "self-manage the board" macro an operator (or
        a future cron sweep) actually wants. The order is fixed and matters:

          1. ``reconcile_board``      — reclaim stale running claims → ``ready``
             FIRST, so the now-idle agent is visible to step 3.
          2. ``cascade_dependencies`` — hold/promote on parent→child deps BEFORE
             reassign, so a task about to be dependency-held is not moved to a new
             owner first.
          3. ``reassign_dead_agent``  — move a dead/idle agent's workable tasks to
             a live best-fit owner.
          4. ``escalate_exhausted``   — block retry-burned tasks LAST, the final
             safety net once the earlier verbs have had their chance to recover the
             task.
          5. ``promote_ready``        — promote the now-clean ``todo`` tasks (live
             assignee, no open deps) → ``ready`` AFTER all holds/blocks settle, so
             the dispatcher actually has work to run. This is what makes the
             recurring maintenance sweep flow work end-to-end (promote → dispatch)
             rather than just self-heal a static board.

        Every sub-verb is idempotent and ``dry_run``-able, so the macro is low-risk
        and a second pass is a no-op. ``dry_run`` threads through to every sub-call
        (note: in dry-run each verb plans against the *current* board, so a later
        verb does not see an earlier verb's planned-but-unapplied change — the live,
        non-dry sweep applies them in sequence so each verb sees the prior's result).
        Returns each sub-result plus an aggregate ``counts``/``total`` and a one-line
        ``message``.
        """
        reconciled = self.reconcile_board(dry_run=dry_run)
        cascade = self.cascade_dependencies(dry_run=dry_run)
        reassigned = self.reassign_dead_agent(dry_run=dry_run)
        escalated = self.escalate_exhausted(dry_run=dry_run)
        promoted = self.promote_ready(dry_run=dry_run)
        counts = {
            "reconciled": len(reconciled.get("reclaimed", [])),
            "held": len(cascade.get("held", [])),
            "promoted": len(cascade.get("promoted", [])),
            "reassigned": len(reassigned.get("reassigned", [])),
            "escalated": len(escalated.get("escalated", [])),
            "promoted_ready": len(promoted.get("promoted", [])),
        }
        total = sum(counts.values())
        verb = "would change" if dry_run else "changed"
        if total > 0:
            bits = [f"{k} {v}" for k, v in counts.items() if v]
            msg = f"sweep: {verb} {total} ({', '.join(bits)})"
        else:
            msg = "sweep: board already healthy — nothing to do"
        return {
            "reconciled": reconciled,
            "cascade": cascade,
            "reassigned": reassigned,
            "escalated": escalated,
            "counts": counts,
            "total": total,
            "dry_run": dry_run,
            "message": msg,
        }

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
            if (j.get("kind") or "claude") == "maintenance":
                raw_lines.append(f"    Kind: maintenance ({j.get('action', '')})")
            raw_lines.append(f"    Schedule: {j.get('schedule', '')}")
            if j.get("next_run"):
                raw_lines.append(f"    Next run: {j['next_run']}")
        return {"jobs": jobs, "raw": "\n".join(raw_lines)}

    def create_cron(self, schedule, prompt=None, name=None, deliver=None,
                    repeat=None, skills=None, kind=None, action=None) -> dict[str, Any]:
        """Create a scheduled job.

        ``kind`` defaults to ``"claude"`` (the job fires its ``prompt`` through a
        Claude turn). ``kind="maintenance"`` fires an internal ``action`` directly
        (no Claude turn) — e.g. ``action="sweep"`` runs the board self-heal macro
        on the local clock, the post-Hermes hands-free autonomy path. A maintenance
        job must name a known ``action``; a claude job needs a ``prompt`` to be
        fireable (an actionless/promptless job is created but stays inert).
        """
        kind = (kind or "claude").strip().lower()
        if kind not in ("claude", "maintenance"):
            raise ValueError(f"unknown cron kind: {kind!r} (expected claude|maintenance)")
        if kind == "maintenance":
            action = (action or "").strip().lower()
            if action not in MAINTENANCE_ACTIONS:
                raise ValueError(
                    f"unknown maintenance action: {action!r} "
                    f"(expected one of {sorted(MAINTENANCE_ACTIONS)})"
                )
        else:
            action = None
        with self._lock:
            jobs = self._cron()
            default_name = (
                f"{action} (maintenance)" if kind == "maintenance"
                else (prompt[:40] if prompt else schedule)
            )
            job = {
                "id": uuid.uuid4().hex[:12],
                "status": "active",
                "kind": kind,
                "action": action,
                "name": name or default_name,
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

    def run_maintenance(self, action: str) -> dict[str, Any]:
        """Execute an internal maintenance ``action`` by name (cron kind=maintenance).

        Returns ``{ok, action, detail, result}`` — ``detail`` is the human-readable
        outcome line the scheduler stamps onto the job via ``record_cron_result``.
        Raises ``ValueError`` for an unknown action.
        """
        action = (action or "").strip().lower()
        if action == "sweep":
            res = self.sweep_board(dry_run=False)
            return {"ok": True, "action": "sweep", "detail": res["message"], "result": res}
        raise ValueError(f"unknown maintenance action: {action!r}")

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
