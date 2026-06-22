import { create } from 'zustand';
import {
  getMcBriefing,
  getSentinelDigest,
  bridgeDetail,
  type McBriefing,
  type SentinelDigest,
} from '../lib/api';

interface BriefingStore {
  briefing: McBriefing | null;
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
      const data = await getMcBriefing();
      set({
        briefing: data,
        error: null,
        loading: false,
        lastSync: new Date(),
      });
    } catch (err) {
      // bridgeDetail (not errMessage) so the operator sees the bridge's real
      // reason — e.g. "No digest available. Run the Sentinel cron…" — instead
      // of a meaningless "Request failed with status code 404".
      const msg = bridgeDetail(err);
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
      const msg = bridgeDetail(err);
      console.error('[BriefingStore] sentinel refresh failed:', msg);
      set({ sentinelLoading: false, sentinelError: msg });
    }
  },
}));
