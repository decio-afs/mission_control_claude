import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTaskStore } from '../stores/useTaskStore';
import { useTaskFocusStore } from '../stores/useTaskFocusStore';
import { useNotifyStore } from '../stores/useNotifyStore';
import type { McTask } from '../lib/api';

// Watches the globally-polled Mc task store (Layout polls every 7s) and fires
// an OS desktop notification whenever a task crosses from a non-terminal status
// into a terminal one (done / completed / failed). Pairs with the live worker-log
// tail: clicking the notification jumps straight into the task in Operations.
//
// Pure client logic — no new bridge endpoint. Mounted once in Layout.

const TERMINAL = new Set(['done', 'completed', 'failed']);
const isTerminal = (s: string) => TERMINAL.has(s);

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
      // Act only on a genuine transition: we saw it before in a non-terminal
      // state and it is now terminal. New tasks that appear already-terminal,
      // or tasks staying terminal across polls, are ignored.
      if (before && !isTerminal(before) && isTerminal(t.status)) {
        // Always record into the in-app Notification Center history, even when
        // OS toasts are muted — the operator can still review what finished.
        record({
          key: `${t.id}:${t.status}`,
          taskId: t.id,
          title: t.title,
          assignee: t.assignee,
          outcome: t.status === 'failed' ? 'failed' : 'done',
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
  const failed = t.status === 'failed';
  const title = failed ? '✕ Task failed' : '✓ Task complete';
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
