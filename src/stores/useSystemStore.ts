import { create } from 'zustand';
import { getMcStatus, errMessage } from '../lib/api';

interface SystemVitals {
  mcOnline: boolean;
  mcVersion: string;
  connectionLatencyMs: number;
  activeRunners: number;
}

interface SystemStore {
  vitals: SystemVitals;
  latencyHistory: number[];
  error: string | null;
  lastSync: Date | null;
  updateVitals: (vitals: Partial<SystemVitals>) => void;
  fetchMcStatus: () => Promise<void>;
}

const MAX_HISTORY = 40;

export const useSystemStore = create<SystemStore>((set) => ({
  vitals: {
    mcOnline: false,
    mcVersion: 'unknown',
    connectionLatencyMs: 0,
    activeRunners: 0,
  },
  latencyHistory: [],
  error: null,
  lastSync: null,

  updateVitals: (newVitals) => set((state) => ({ vitals: { ...state.vitals, ...newVitals } })),

  fetchMcStatus: async () => {
    const start = performance.now();
    try {
      const data = await getMcStatus();
      const latency = Math.round(performance.now() - start);
      set((state) => ({
        vitals: {
          ...state.vitals,
          mcOnline: true,
          mcVersion: data.mc_version?.split('\n')[0] || 'connected',
          connectionLatencyMs: latency,
        },
        latencyHistory: [...state.latencyHistory, latency].slice(-MAX_HISTORY),
        error: null,
        lastSync: new Date(),
      }));
    } catch (err) {
      set((state) => ({
        vitals: { ...state.vitals, mcOnline: false, mcVersion: 'disconnected' },
        error: errMessage(err) || 'Mc bridge unreachable',
      }));
    }
  },
}));
