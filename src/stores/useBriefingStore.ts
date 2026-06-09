import { create } from 'zustand';
import {
  getHermesBriefing,
  getSentinelDigest,
  errMessage,
  type HermesBriefing,
  type SentinelDigest,
} from '../lib/api';

interface BriefingStore {
  briefing: HermesBriefing | null;
  sentinel: SentinelDigest | null;
  loading: boolean;
  sentinelLoading: boolean;
  error: string | null;
  sentinelError: string | null;
  lastSync: Date | null;
  refresh: () => Promise<void>;
  refreshSentinel: () => Promise<void>;
}

export const useBriefingStore = create<BriefingStore>((set) => ({
  briefing: null,
  sentinel: null,
  loading: false,
  sentinelLoading: false,
  error: null,
  sentinelError: null,
  lastSync: null,

  refresh: async () => {
    set({ loading: true });
    try {
      const data = await getHermesBriefing();
      set({
        briefing: data,
        error: null,
        loading: false,
        lastSync: new Date(),
      });
    } catch (err) {
      const msg = errMessage(err);
      console.error('[BriefingStore] refresh failed:', msg);
      set({ loading: false, error: msg });
    }
  },

  refreshSentinel: async () => {
    set({ sentinelLoading: true });
    try {
      const data = await getSentinelDigest();
      set({
        sentinel: data,
        sentinelError: null,
        sentinelLoading: false,
        lastSync: new Date(),
      });
    } catch (err) {
      const msg = errMessage(err);
      console.error('[BriefingStore] sentinel refresh failed:', msg);
      set({ sentinelLoading: false, sentinelError: msg });
    }
  },
}));
