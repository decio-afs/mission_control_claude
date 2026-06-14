#!/usr/bin/env python3
"""
Hermes local-patch manager for Mission Control.

The Hermes install at %LOCALAPPDATA%/hermes/hermes-agent carries local patches
(applied 2026-06-11) that fix the Kimi quota-burn loop on Windows: the
dispatcher can't reap worker exit codes there (waitpid is POSIX-only), so
rate-limited workers were classified as crashes and retried until the quota
died. `hermes update` does a git pull and may drop these patches (stash
conflicts) — this script detects and re-applies them.

Each patch is defined by three exact strings:
  marker — present only in the PATCHED file (cheap "is it applied?" probe)
  old    — the exact pristine upstream block the patch replaces
  new    — the replacement (always contains the marker)

Statuses:
  applied      marker found — nothing to do
  applicable   marker absent, `old` found exactly once — safe to apply
  conflict     marker absent and `old` not found (or ambiguous) — upstream
               changed the surrounding code; the patch must be re-ported by
               hand (see memory/hermes-kimi-quota-burn.md for intent)
  file-missing target file not found (wrong HERMES_AGENT_SRC?)

Usage:
  python hermes_patches.py --check          # JSON status report
  python hermes_patches.py --apply          # apply whatever is applicable
"""

from __future__ import annotations

import argparse
import json
import os
import py_compile
import shutil
import sys
import time
from pathlib import Path

HERMES_DIR = Path(os.environ.get(
    "HERMES_AGENT_SRC",
    Path.home() / "AppData" / "Local" / "hermes" / "hermes-agent",
))

# ---------------------------------------------------------------------------
# Patch manifest. The old/new blocks must byte-match the real files — they were
# captured from the working patches. Keep them in sync with any manual edits.
# ---------------------------------------------------------------------------

_P1_OLD = '''    # Same side-channel for rate-limited requeues — these did NOT count a
    # failure and are NOT crashes, so they stay out of the ``crashed`` return.
    detect_crashed_workers._last_rate_limited = rate_limited  # type: ignore[attr-defined]
    return crashed
'''

_P1_NEW = '''    # Same side-channel for rate-limited requeues — these did NOT count a
    # failure and are NOT crashes, so they stay out of the ``crashed`` return.
    detect_crashed_workers._last_rate_limited = rate_limited  # type: ignore[attr-defined]
    return crashed


def requeue_rate_limited_task(
    conn: sqlite3.Connection,
    task_id: str,
    error: str,
) -> bool:
    """Worker-side rate-limit requeue: release ``task_id`` back to ``ready``
    WITHOUT counting a failure, mirroring the dispatcher's EX_TEMPFAIL branch
    in ``detect_crashed_workers``.

    On POSIX the dispatcher learns about a quota wall from the worker's
    ``KANBAN_RATE_LIMIT_EXIT_CODE`` exit via the ``reap_worker_zombies``
    registry. On Windows that registry is never populated (``waitpid`` /
    ``WIFEXITED`` are POSIX-only), so every worker exit — including the
    rate-limit sentinel — was classified as a generic crash: the failure
    counter incremented, the breaker tripped, and unblock/retry cycles
    burned the remaining provider quota (LOCAL PATCH 2026-06-11).

    The worker calls this directly before ``sys.exit(75)`` so the run is
    recorded as ``rate_limited`` on every platform, which arms the
    ``rate_limit_cooldown`` respawn guard instead of the crash path.

    Returns True when the task was transitioned (it was ``running``),
    False otherwise (already moved by someone else — nothing to do).
    """
    error_text = (error or "rate-limited (quota wall)")[:500]
    with write_txn(conn):
        cur = conn.execute(
            "UPDATE tasks SET status = 'ready', claim_lock = NULL, "
            "claim_expires = NULL, worker_pid = NULL "
            "WHERE id = ? AND status = 'running'",
            (task_id,),
        )
        if cur.rowcount != 1:
            return False
        run_id = _end_run(
            conn, task_id,
            outcome="rate_limited", status="rate_limited",
            error=error_text,
            metadata={"source": "worker_self_report"},
        )
        _append_event(
            conn, task_id, "rate_limited",
            {"source": "worker_self_report", "error": error_text},
            run_id=run_id,
        )
        # Stamp the failure-error column so ``check_respawn_guard``
        # recognizes the quota blocker — WITHOUT touching
        # ``consecutive_failures`` (no breaker trip on a throttle).
        conn.execute(
            "UPDATE tasks SET last_failure_error = ? WHERE id = ?",
            (error_text, task_id),
        )
    return True
'''

_P2_OLD = '''        new_status = "todo" if undone_parents else "ready"
        cur = conn.execute(
            "UPDATE tasks SET status = ?, current_run_id = NULL, "
            "consecutive_failures = 0, last_failure_error = NULL "
            "WHERE id = ? AND status IN ('blocked', 'scheduled')",
            (new_status, task_id),
        )
'''

_P2_NEW = '''        new_status = "todo" if undone_parents else "ready"
        # LOCAL PATCH 2026-06-11: do NOT reset ``consecutive_failures`` here.
        # Resetting on unblock let an agent/operator unblock-retry cycle
        # disarm the circuit breaker indefinitely — observed burning an
        # entire provider quota window (t_db3e97f0: 13 runs in one day).
        # Preserving the counter makes each explicit unblock grant exactly
        # ONE retry: the task runs once, and the next failure trips the
        # breaker again immediately. ``reassign`` keeps its full reset —
        # switching profiles is a genuinely fresh start. We still clear
        # ``last_failure_error`` so the respawn guard's blocker regex
        # doesn't defer the explicitly-requested retry.
        cur = conn.execute(
            "UPDATE tasks SET status = ?, current_run_id = NULL, "
            "last_failure_error = NULL "
            "WHERE id = ? AND status IN ('blocked', 'scheduled')",
            (new_status, task_id),
        )
'''

_P3_OLD = '''                        _exit_code = 0
                        if isinstance(result, dict) and result.get("failed"):
                            _exit_code = 1
                            if os.environ.get("HERMES_KANBAN_TASK") and result.get(
                                "failure_reason"
                            ) in ("rate_limit", "billing"):
                                try:
                                    from hermes_cli.kanban_db import (
                                        KANBAN_RATE_LIMIT_EXIT_CODE as _RL_CODE,
                                    )
                                    _exit_code = _RL_CODE
                                except Exception:
                                    _exit_code = 1
                        sys.exit(_exit_code)
'''

_P3_NEW = '''                        _exit_code = 0
                        if isinstance(result, dict) and result.get("failed"):
                            _exit_code = 1
                            if os.environ.get("HERMES_KANBAN_TASK") and result.get(
                                "failure_reason"
                            ) in ("rate_limit", "billing"):
                                try:
                                    from hermes_cli.kanban_db import (
                                        KANBAN_RATE_LIMIT_EXIT_CODE as _RL_CODE,
                                    )
                                    _exit_code = _RL_CODE
                                except Exception:
                                    _exit_code = 1
                                # Self-report the rate-limit requeue in the DB.
                                # On Windows the dispatcher can't reap exit
                                # codes (waitpid is POSIX-only), so without
                                # this the EX_TEMPFAIL exit below is classified
                                # as a generic crash: the failure counter
                                # trips the breaker and retries burn the
                                # remaining quota (LOCAL PATCH 2026-06-11).
                                if _exit_code != 1:
                                    try:
                                        from hermes_cli import kanban_db as _kb
                                        with _kb.connect_closing() as _conn:
                                            _kb.requeue_rate_limited_task(
                                                _conn,
                                                os.environ["HERMES_KANBAN_TASK"],
                                                str(result.get("error") or ""),
                                            )
                                    except Exception as _rl_exc:
                                        logger.debug(
                                            "kanban rate-limit self-requeue failed: %s",
                                            _rl_exc,
                                        )
                        sys.exit(_exit_code)
'''

_P4_OLD = '''                    return {
                        "final_response": None,
                        "messages": messages,
                        "api_calls": api_call_count,
                        "completed": False,
                        "failed": True,
                        "error": str(api_error),
                    }

                if retry_count >= max_retries:
'''

_P4_NEW = '''                    return {
                        "final_response": None,
                        "messages": messages,
                        "api_calls": api_call_count,
                        "completed": False,
                        "failed": True,
                        "error": str(api_error),
                        # Surface the classified reason so the kanban worker
                        # path in cli.py can exit with the EX_TEMPFAIL
                        # sentinel for billing/quota walls instead of the
                        # generic 1 (which counts as a task failure and
                        # feeds the retry loop). Mirrors the max-retries
                        # terminal return below (LOCAL PATCH 2026-06-11).
                        "failure_reason": classified.reason.value,
                    }

                if retry_count >= max_retries:
'''

PATCHES = [
    {
        "id": "requeue-helper",
        "file": "hermes_cli/kanban_db.py",
        "description": "Worker-side rate-limit requeue helper (Windows can't reap exit codes)",
        "marker": "def requeue_rate_limited_task(",
        "old": _P1_OLD,
        "new": _P1_NEW,
    },
    {
        "id": "unblock-one-retry",
        "file": "hermes_cli/kanban_db.py",
        "description": "unblock_task keeps the failure counter — one retry per unblock",
        "marker": "do NOT reset ``consecutive_failures`` here",
        "old": _P2_OLD,
        "new": _P2_NEW,
    },
    {
        "id": "worker-self-report",
        "file": "cli.py",
        "description": "Kanban worker records rate_limited run before exit 75",
        "marker": "kanban rate-limit self-requeue failed",
        "old": _P3_OLD,
        "new": _P3_NEW,
    },
    {
        "id": "failure-reason-terminal",
        "file": "agent/conversation_loop.py",
        "description": "failure_reason on non-retryable terminal errors (billing exits 75)",
        "marker": "terminal return below (LOCAL PATCH 2026-06-11)",
        "old": _P4_OLD,
        "new": _P4_NEW,
    },
]


def _read(path: Path) -> str:
    # Universal-newline read: CRLF sources normalize to \n so the manifest
    # anchors (written with \n) match regardless of checkout settings.
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _write(path: Path, text: str) -> None:
    # newline="" disables the default \n -> os.linesep translation, which on
    # Windows would silently rewrite the whole (LF) hermes checkout as CRLF.
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def check_patch(patch: dict) -> str:
    path = HERMES_DIR / patch["file"]
    if not path.exists():
        return "file-missing"
    text = _read(path)
    if patch["marker"] in text:
        return "applied"
    if text.count(patch["old"]) == 1:
        return "applicable"
    return "conflict"


def apply_patch(patch: dict) -> str:
    """Apply one patch. Returns the resulting status."""
    status = check_patch(patch)
    if status != "applicable":
        return status
    path = HERMES_DIR / patch["file"]
    text = _read(path)
    backup = path.with_suffix(path.suffix + f".bak-{int(time.time())}")
    shutil.copy2(path, backup)
    _write(path, text.replace(patch["old"], patch["new"], 1))
    try:
        py_compile.compile(str(path), doraise=True)
    except py_compile.PyCompileError:
        shutil.copy2(backup, path)  # roll back
        backup.unlink(missing_ok=True)
        return "compile-failed-rolled-back"
    backup.unlink(missing_ok=True)
    return "applied"


def main() -> int:
    parser = argparse.ArgumentParser(description="Check/apply Hermes local patches")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    results = []
    for patch in PATCHES:
        before = check_patch(patch)
        if args.apply:
            status = apply_patch(patch)
        else:
            status = before
        results.append({
            "id": patch["id"],
            "file": patch["file"],
            "description": patch["description"],
            "status": status,
            # True only when THIS run transitioned the patch into place —
            # callers use it to suggest a gateway restart.
            "changed": args.apply and before == "applicable" and status == "applied",
        })

    statuses = [r["status"] for r in results]
    report = {
        "hermes_dir": str(HERMES_DIR),
        "mode": "apply" if args.apply else "check",
        "patches": results,
        "all_applied": all(s == "applied" for s in statuses),
        "applicable": sum(1 for s in statuses if s == "applicable"),
        "conflicts": sum(1 for s in statuses if s not in ("applied", "applicable")),
        "changed": sum(1 for r in results if r["changed"]),
    }
    print(json.dumps(report, indent=2))
    return 0 if report["all_applied"] else 1


if __name__ == "__main__":
    sys.exit(main())
