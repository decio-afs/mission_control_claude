import { create } from 'zustand';
import { getHermesStatus, errMessage } from '../lib/api';

interface SystemVitals {
  hermesOnline: boolean;
  hermesVersion: string;
  connectionLatencyMs: number;
  activeRunners: number;
}

interface SystemStore {
  vitals: SystemVitals;
  latencyHistory: number[];
  error: string | null;
  lastSync: Date | null;
  updateVitals: (vitals: Partial<SystemVitals>) => void;
  fetchHermesStatus: () => Promise<void>;
}

const MAX_HISTORY = 40;

export const useSystemStore = create<SystemStore>((set) => ({
  vitals: {
    hermesOnline: false,
    hermesVersion: 'unknown',
    connectionLatencyMs: 0,
    activeRunners: 0,
  },
  latencyHistory: [],
  error: null,
  lastSync: null,

  updateVitals: (newVitals) => set((state) => ({ vitals: { ...state.vitals, ...newVitals } })),

  fetchHermesStatus: async () => {
    const start = performance.now();
    try {
      const data = await getHermesStatus();
      const latency = Math.round(performance.now() - start);
      set((state) => ({
        vitals: {
          ...state.vitals,
          hermesOnline: true,
          hermesVersion: data.hermes_version?.split('\n')[0] || 'connected',
          connectionLatencyMs: latency,
        },
        latencyHistory: [...state.latencyHistory, latency].slice(-MAX_HISTORY),
        error: null,
        lastSync: new Date(),
      }));
    } catch (err) {
      set((state) => ({
        vitals: { ...state.vitals, hermesOnline: false, hermesVersion: 'disconnected' },
        error: errMessage(err) || 'Hermes bridge unreachable',
      }));
    }
  },
}));
