"""
ensure_bridge.py — idempotent Mission Control bridge watchdog.

Run on a short timer (Windows Scheduled Task, every ~2 min). One-shot:
  * If the bridge answers GET /api/ping on :8767 → do nothing, exit 0.
  * If it's down → relaunch `python mission-control-bridge.py` from the repo
    root, detached and console-less (CREATE_NO_WINDOW), logging to .mc/bridge.log.

This is the durability anchor: the bridge (and its in-process cron scheduler +
kanban dispatcher) keeps running 24/7 regardless of any app window or Claude
session. Idempotent — it only starts a bridge when one isn't already answering,
so it never double-binds :8767 and is safe to run alongside the Electron app's
own reuse-if-up supervision.
"""

import os
import subprocess
import sys
import urllib.request
from pathlib import Path

PORT = int(os.environ.get("BRIDGE_PORT", "8767"))
ROOT = Path(__file__).resolve().parent.parent
BRIDGE = ROOT / "mission-control-bridge.py"
LOG = ROOT / ".mc" / "bridge.log"


def bridge_up() -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/ping", timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def start_bridge() -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    # CREATE_NO_WINDOW (0x08000000) + DETACHED_PROCESS (0x00000008) so the bridge
    # outlives this watchdog process and never flashes a console.
    flags = 0x08000000 | 0x00000008
    # Production autonomous config: the supervised bridge always comes up with the
    # cron scheduler AND the kanban dispatcher running, so autonomy survives a
    # crash/reboot instead of reverting to off. Override via real env vars if set.
    env = dict(os.environ)
    env.setdefault("MC_SCHEDULER_ENABLED", "1")
    env.setdefault("MC_DISPATCHER_ENABLED", "1")
    env.setdefault("MC_DISPATCH_CONCURRENCY", "2")
    with open(LOG, "ab") as logf:
        subprocess.Popen(
            [sys.executable, str(BRIDGE)],
            cwd=str(ROOT),
            env=env,
            stdout=logf,
            stderr=logf,
            stdin=subprocess.DEVNULL,
            creationflags=flags,
            close_fds=True,
        )


if __name__ == "__main__":
    if bridge_up():
        print("bridge up — ok")
    else:
        print("bridge down — relaunching")
        start_bridge()
