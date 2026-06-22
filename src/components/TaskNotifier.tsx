import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTaskStore } from '../stores/useTaskStore';
import { useTaskFocusStore } from '../stores/useTaskFocusStore';
import { useNotifyStore } from '../stores/useNotifyStore';
import type { McTask } from '../lib/api';

// Watches the globally-polled Mc task store (Layout polls every 7s) and fires
// an OS desktop notification whenever a task crosses from a quiet status into a
// notable one — a completion (done / completed) OR an adverse dead-end. Pairs
// with the live worker-log tail: clicking the notification jumps straight into
// the task in Operations.
//
// Pure client logic — no new bridge endpoint. Mounted once in Layout.

// Statuses that warrant a notification. `failed` is kept for forward-compat, but
// the live mc_store NEVER sets it: a task that fails or dead-ends is recorded as
// `blocked` (block_task — including the retry circuit-breaker), so `blocked` is
// the real adverse-outcome sink and MUST be notified, or failures go unseen and
// the operator only learns of them by manually scanning the BLOCKED column.
const NOTIFY_ON = new Set(['done', 'completed', 'failed', 'blocked']);
const isNotify = (s: string) => NOTIFY_ON.has(s);

function outcomeOf(status: string): 'done' | 'failed' | 'blocked' {
  if (status === 'blocked') return 'blocked';
  if (status === 'failed') return 'failed';
  return 'done';
}

export default function TaskNotifier() {
  const mcTasks = useTaskStore((s) => s.mcTasks);
  const enabled = useNotifyStore((s) => s.enabled);
  const bumpSent = useNotifyStore((s) => s.bumpSent);
  const record = useNotifyStore((s) => s.record);
  const focus = useTaskFocusStore((s) => s.focus);
  const navigate = useNavigate();

  // taskId -> last observed status. `null` until the first poll so we can seed
  // without firing a burst for tasks that were already terminal on startup.
  const prev = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    const cur = new Map<string, string>();
    for (const t of mcTasks) cur.set(t.id, t.status);

    const seen = prev.current;
    prev.current = cur;

    // First observation — seed only, never notify for pre-existing tasks.
    if (seen === null) return;

    const canFireOs =
      enabled && typeof Notification !== 'undefined' && Notification.permission === 'granted';

    for (const t of mcTasks) {
      const before = seen.get(t.id);
      // Act only on a genuine transition: we saw it before in a quiet state and
      // it just crossed into a notable one (a completion or an adverse block).
      // New tasks that appear already-notable, or tasks staying in that state
      // across polls, are ignored.
      if (before && !isNotify(before) && isNotify(t.status)) {
        // Always record into the in-app Notification Center history, even when
        // OS toasts are muted — the operator can still review what finished
        // (or what got blocked) later.
        record({
          key: `${t.id}:${t.status}`,
          taskId: t.id,
          title: t.title,
          assignee: t.assignee,
          outcome: outcomeOf(t.status),
          at: Date.now(),
        });
        // Only the desktop toast is gated on the toggle + OS permission.
        if (canFireOs) {
          fire(t, () => {
            focus(t.id);
            navigate('/operations');
          });
          bumpSent();
        }
      }
    }
  }, [mcTasks, enabled, focus, navigate, bumpSent, record]);

  return null;
}

function fire(t: McTask, onClick: () => void) {
  const title =
    t.status === 'blocked' ? '⚠ Task blocked'
      : t.status === 'failed' ? '✕ Task failed'
        : '✓ Task complete';
  const who = t.assignee ? ` · ${t.assignee}` : '';
  const body = `${t.title}${who}`;
  try {
    const n = new Notification(title, {
      body,
      tag: `mc-task-${t.id}`, // collapse repeat notifications for the same task
      silent: false,
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignore — renderer may not allow focus */
      }
      onClick();
      n.close();
    };
  } catch {
    /* Notification constructor can throw in some sandboxes — fail quietly */
  }
}
