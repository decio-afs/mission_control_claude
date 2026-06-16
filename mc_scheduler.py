"""mc_scheduler — the missing cron *engine* for Mission Control.

Mission Control's UI (``src/lib/cronSchedule.ts``) renders next-fire countdowns
for every job in the native cron store and its comment even claims "the mc daemon
runs on this machine and fires on its local clock" — but after the Hermes excision
there was **no daemon**: nothing actually fired due jobs. This module is that
daemon's brain.

It is deliberately a *pure* schedule-matcher (no threads, no I/O) so it can be
unit-tested in isolation; the bridge owns the wall-clock loop and the ``run_claude``
side effects. The parsing semantics are kept in lock-step with the TypeScript
parser so the operator's countdown and the actual fire agree:

* 5-field Vixie cron (``0 7 * * *``), evaluated in **local** time.
* Named macros (``@daily``, ``@hourly`` …).
* Interval shorthand (``30m``, ``every 2h``) with units s/m/h/d.
* Standard day rule: when BOTH day-of-month and day-of-week are restricted the
  job fires if EITHER matches; otherwise only the restricted field applies.
* Cron day-of-week 0 and 7 both mean Sunday.
"""

from __future__ import annotations

import re
import time
from datetime import datetime
from typing import Optional

NAMED = {
    "@yearly": "0 0 1 1 *",
    "@annually": "0 0 1 1 *",
    "@monthly": "0 0 1 * *",
    "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *",
    "@midnight": "0 0 * * *",
    "@hourly": "0 * * * *",
}

_INTERVAL_RE = re.compile(
    r"^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|"
    r"h|hr|hrs|hour|hours|d|day|days)$"
)


class CronFields:
    __slots__ = ("minute", "hour", "dom", "month", "dow", "dom_restricted", "dow_restricted")

    def __init__(self, minute, hour, dom, month, dow, dom_restricted, dow_restricted):
        self.minute = minute
        self.hour = hour
        self.dom = dom
        self.month = month
        self.dow = dow
        self.dom_restricted = dom_restricted
        self.dow_restricted = dow_restricted


def _expand_field(field: str, lo_min: int, hi_max: int) -> Optional[set]:
    """Expand "*", "5", "1-5", "*/15", "1-10/2", "0,30" → concrete value set.

    Returns None for malformed / unsupported tokens (L, W, ?, names) — the caller
    treats None as unparseable, matching the TS parser.
    """
    out: set = set()
    for part in field.split(","):
        if not part:
            return None
        slash = part.split("/")
        if len(slash) > 2:
            return None
        rng = slash[0]
        step_str = slash[1] if len(slash) == 2 else None
        try:
            step = 1 if step_str is None else int(step_str)
        except ValueError:
            return None
        if step < 1:
            return None
        if rng == "*":
            lo, hi = lo_min, hi_max
        elif "-" in rng:
            a, _, b = rng.partition("-")
            try:
                lo, hi = int(a), int(b)
            except ValueError:
                return None
        else:
            try:
                lo = int(rng)
            except ValueError:
                return None
            # "5/2" → 5,7,9,… up to max; a bare "5" matches only 5.
            hi = lo if step_str is None else hi_max
        if lo < lo_min or hi > hi_max or lo > hi:
            return None
        v = lo
        while v <= hi:
            out.add(v)
            v += step
    return out or None


def parse_cron(text: str) -> Optional[CronFields]:
    expr = text
    if expr.startswith("@"):
        named = NAMED.get(expr.lower())
        if not named:
            return None
        expr = named
    parts = expr.split()
    if len(parts) != 5:
        return None
    minute = _expand_field(parts[0], 0, 59)
    hour = _expand_field(parts[1], 0, 23)
    dom = _expand_field(parts[2], 1, 31)
    month = _expand_field(parts[3], 1, 12)
    dow = _expand_field(parts[4], 0, 7)
    if not (minute and hour and dom and month and dow):
        return None
    if 7 in dow:  # cron Sunday is 0 or 7
        dow.discard(7)
        dow.add(0)
    return CronFields(
        minute, hour, dom, month, dow,
        dom_restricted=parts[2] != "*",
        dow_restricted=parts[4] != "*",
    )


def parse_interval_seconds(text: str) -> Optional[int]:
    m = _INTERVAL_RE.match(text.lower().removeprefix("every").strip())
    if not m:
        return None
    n = int(m.group(1))
    if n < 1:
        return None
    unit = m.group(2)[0]  # s | m | h | d — distinct first letters
    mult = {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]
    return n * mult


def _cron_matches(f: CronFields, dt: datetime) -> bool:
    if (dt.month not in f.month) or (dt.minute not in f.minute) or (dt.hour not in f.hour):
        return False
    # Python weekday(): Mon=0..Sun=6 → cron Sun=0..Sat=6
    dow = (dt.weekday() + 1) % 7
    dom_hit = dt.day in f.dom
    dow_hit = dow in f.dow
    if f.dom_restricted and f.dow_restricted:
        return dom_hit or dow_hit
    if f.dom_restricted:
        return dom_hit
    if f.dow_restricted:
        return dow_hit
    return True


def schedule_kind(schedule: str) -> str:
    """'cron' | 'interval' | 'unknown' — mirrors parseSchedule().kind."""
    text = (schedule or "").strip()
    if not text:
        return "unknown"
    if parse_interval_seconds(text) is not None:
        return "interval"
    if parse_cron(text) is not None:
        return "cron"
    return "unknown"


def is_fireable(job: dict) -> bool:
    """Does ``job`` have something to fire?

    A ``claude`` job (the default ``kind``) needs a ``prompt``; a ``maintenance``
    job runs an internal verb so it needs an ``action`` instead and is exempt from
    the prompt requirement. Keeping this in the scheduler (vs the bridge) means the
    UI's next-fire countdown and the actual fire agree on which jobs are inert.
    """
    if (job.get("kind") or "claude") == "maintenance":
        return bool(job.get("action"))
    return bool(job.get("prompt"))


def is_due(job: dict, now_ts: Optional[float] = None) -> bool:
    """True if ``job`` should fire at ``now_ts`` (epoch seconds, local clock).

    * cron — current local minute matches the expression AND it hasn't already
      fired during this same minute (guards the sub-minute poll from double-firing).
    * interval — at least one period has elapsed since the last fire; an unfired
      job is anchored at ``created_at`` so it doesn't fire the instant it is made.
    * unparseable / inactive / un-fireable (claude job with no prompt, maintenance
      job with no action) jobs never fire.
    """
    if (job.get("status") or "active") != "active":
        return False
    if not is_fireable(job):
        return False
    now_ts = time.time() if now_ts is None else now_ts
    schedule = (job.get("schedule") or job.get("repeat") or "").strip()
    if not schedule:
        return False
    last_run = job.get("last_run")
    last_run = last_run if isinstance(last_run, (int, float)) else None

    secs = parse_interval_seconds(schedule)
    if secs is not None:
        anchor = last_run
        if anchor is None:
            created = job.get("created_at")
            anchor = created if isinstance(created, (int, float)) else now_ts
        return now_ts - anchor >= secs

    fields = parse_cron(schedule)
    if fields is None:
        return False
    dt = datetime.fromtimestamp(now_ts)
    if not _cron_matches(fields, dt):
        return False
    # Already fired this minute?
    if last_run is not None and int(last_run // 60) == int(now_ts // 60):
        return False
    return True


def due_jobs(jobs, now_ts: Optional[float] = None) -> list:
    now_ts = time.time() if now_ts is None else now_ts
    return [j for j in jobs if is_due(j, now_ts)]


if __name__ == "__main__":  # lightweight self-test (no API cost)
    import calendar

    def ts(y, mo, d, h, mi):
        return time.mktime((y, mo, d, h, mi, 0, 0, 0, -1))

    # 07:00 daily cron
    daily7 = {"status": "active", "prompt": "x", "schedule": "0 7 * * *"}
    assert is_due(daily7, ts(2026, 6, 15, 7, 0)), "daily fires at 07:00"
    assert not is_due(daily7, ts(2026, 6, 15, 7, 1)), "no fire at 07:01"
    assert not is_due(daily7, ts(2026, 6, 15, 6, 0)), "no fire at 06:00"
    fired = dict(daily7, last_run=ts(2026, 6, 15, 7, 0) + 5)
    assert not is_due(fired, ts(2026, 6, 15, 7, 0) + 20), "no double-fire same minute"

    # 07:30 daily
    daily730 = {"status": "active", "prompt": "x", "schedule": "30 7 * * *"}
    assert is_due(daily730, ts(2026, 6, 15, 7, 30)), "30 7 fires at 07:30"
    assert not is_due(daily730, ts(2026, 6, 15, 7, 0)), "30 7 not at 07:00"

    # interval anchored at created_at
    iv = {"status": "active", "prompt": "x", "schedule": "2h", "created_at": 1000.0}
    assert not is_due(iv, 1000.0 + 3600), "interval not due before one period"
    assert is_due(iv, 1000.0 + 7200), "interval due after one period"
    iv2 = dict(iv, last_run=10000.0)
    assert not is_due(iv2, 10000.0 + 3600), "interval not due 1h after last_run"
    assert is_due(iv2, 10000.0 + 7200), "interval due 2h after last_run"

    # every 30m form
    assert parse_interval_seconds("every 30m") == 1800
    assert parse_interval_seconds("45 min") == 2700

    # guards
    assert not is_due({"status": "paused", "prompt": "x", "schedule": "0 7 * * *"}, ts(2026, 6, 15, 7, 0))
    assert not is_due({"status": "active", "schedule": "0 7 * * *"}, ts(2026, 6, 15, 7, 0)), "no prompt → no fire"
    assert not is_due({"status": "active", "prompt": "x", "schedule": "garbage"}, ts(2026, 6, 15, 7, 0))

    # maintenance jobs fire on an action (no prompt needed); actionless never fire
    maint = {"status": "active", "kind": "maintenance", "action": "sweep", "schedule": "0 7 * * *"}
    assert is_due(maint, ts(2026, 6, 15, 7, 0)), "maintenance job fires on action, no prompt"
    assert not is_due({"status": "active", "kind": "maintenance", "schedule": "0 7 * * *"}, ts(2026, 6, 15, 7, 0)), \
        "maintenance job with no action → no fire"

    # macros + DOM/DOW OR rule
    assert is_due({"status": "active", "prompt": "x", "schedule": "@hourly"}, ts(2026, 6, 15, 9, 0))
    # "0 0 13 * 5" → fires on the 13th OR any Friday at 00:00. 2026-06-15 is a Monday, the 15th.
    mon15 = {"status": "active", "prompt": "x", "schedule": "0 0 13 * 5"}
    assert not is_due(mon15, ts(2026, 6, 15, 0, 0)), "Mon the 15th matches neither DOM(13) nor DOW(Fri)"
    assert is_due(mon15, ts(2026, 6, 13, 0, 0)), "the 13th matches DOM"
    assert is_due(mon15, ts(2026, 6, 19, 0, 0)), "Fri the 19th matches DOW"

    print("mc_scheduler self-test: ALL PASS")
