import { create } from 'zustand';
import { getMcActivity, errMessage, type McActivity } from '../lib/api';

interface ActivityStore {
  activities: McActivity[];
  isLoading: boolean;
  error: string | null;
  lastSync: Date | null;
  fetchActivities: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

// Interval handle lives outside the store state so it never triggers a re-render.
let pollTimer: ReturnType<typeof setInterval> | null = null;
const POLL_MS = 10000;

export const useActivityStore = create<ActivityStore>((set, get) => ({
  activities: [],
  isLoading: false,
  error: null,
  lastSync: null,

  fetchActivities: async () => {
    set({ isLoading: true });
    try {
      const { activities } = await getMcActivity();
      set({
        activities: activities || [],
        error: null,
        isLoading: false,
        lastSync: new Date(),
      });
    } catch (err) {
      const msg = errMessage(err);
      console.error('[ActivityStore] fetchActivities failed:', msg);
      set({ isLoading: false, error: msg });
    }
  },

  startPolling: () => {
    if (pollTimer) return; // already polling
    void get().fetchActivities(); // immediate first paint
    pollTimer = setInterval(() => void get().fetchActivities(), POLL_MS);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },
}));
