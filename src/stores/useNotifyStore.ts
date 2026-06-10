import { create } from 'zustand';

// Global state for completed-task notifications. The watcher lives in
// TaskNotifier.tsx (mounted once in Layout); this store owns the on/off
// preference (persisted to localStorage), the current Notification permission,
// AND the in-app session history of task-complete/fail events (the Notification
// Center dropdown off the topbar bell). The history is recorded for every
// terminal transition regardless of the OS-notification toggle, so the operator
// can always review what finished even with desktop toasts muted.
const LS_KEY = 'mc-notify-enabled';
const HISTORY_CAP = 60;

export type NotifyPermission = NotificationPermission | 'unsupported';

export interface NotifyEvent {
  /** taskId:status — de-dupes a task that re-reports the same terminal status. */
  key: string;
  taskId: string;
  title: string;
  assignee: string | null;
  /** Normalized outcome for display tinting. */
  outcome: 'done' | 'failed';
  /** epoch ms when the transition was observed. */
  at: number;
}

function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
}

interface NotifyStore {
  enabled: boolean;
  permission: NotifyPermission;
  /** Number of OS notifications fired this session (for the tooltip). */
  sentCount: number;
  /** In-app history of terminal task events this session (newest first). */
  history: NotifyEvent[];
  /** History entries not yet seen in the Notification Center (badge count). */
  unseen: number;
  setEnabled: (v: boolean) => void;
  /** Flip the toggle; when enabling, request OS permission first. */
  toggle: () => Promise<void>;
  bumpSent: () => void;
  /** Record a terminal task event into the session history (de-duped by key). */
  record: (evt: NotifyEvent) => void;
  /** Clear the unseen badge (Notification Center opened). */
  markSeen: () => void;
  /** Wipe the session history. */
  clearHistory: () => void;
}

export const useNotifyStore = create<NotifyStore>((set, get) => ({
  // Only honor a persisted "on" if the browser still reports permission granted —
  // otherwise we'd show an enabled bell that can never actually fire.
  enabled: loadEnabled() && notificationsSupported() && Notification.permission === 'granted',
  permission: notificationsSupported() ? Notification.permission : 'unsupported',
  sentCount: 0,
  history: [],
  unseen: 0,

  setEnabled: (v) => {
    try {
      localStorage.setItem(LS_KEY, v ? '1' : '0');
    } catch {
      /* ignore quota / private-mode failures */
    }
    set({ enabled: v });
  },

  toggle: async () => {
    const { enabled, setEnabled } = get();
    if (enabled) {
      setEnabled(false);
      return;
    }
    if (!notificationsSupported()) {
      set({ permission: 'unsupported' });
      return;
    }
    let perm = Notification.permission;
    if (perm === 'default') {
      try {
        perm = await Notification.requestPermission();
      } catch {
        /* some environments reject the prompt — treat as denied */
      }
    }
    set({ permission: perm });
    if (perm === 'granted') setEnabled(true);
  },

  bumpSent: () => set((s) => ({ sentCount: s.sentCount + 1 })),

  record: (evt) =>
    set((s) => {
      // Skip an exact duplicate already at the head (same task + outcome).
      if (s.history[0]?.key === evt.key) return s;
      return {
        history: [evt, ...s.history].slice(0, HISTORY_CAP),
        unseen: s.unseen + 1,
      };
    }),

  markSeen: () => set({ unseen: 0 }),

  clearHistory: () => set({ history: [], unseen: 0 }),
}));
