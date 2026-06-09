import { create } from 'zustand';
import {
  getHermesHealth,
  probeEndpoint,
  BRIDGE_ENDPOINTS,
  errMessage,
  type HermesHealth,
} from '../lib/api';

export interface EndpointHealth {
  key: string;
  label: string;
  path: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  error: string | null;
  lastSuccess: number | null; // epoch ms of the last 2xx response
  checkedAt: number | null;
}

interface HealthStore {
  meta: HermesHealth | null;
  endpoints: EndpointHealth[];
  probing: boolean;
  error: string | null;
  lastRun: number | null;
  runDiagnostics: () => Promise<void>;
}

const initialEndpoints: EndpointHealth[] = BRIDGE_ENDPOINTS.map((e) => ({
  key: e.key,
  label: e.label,
  path: e.path,
  ok: false,
  status: 0,
  latencyMs: 0,
  error: null,
  lastSuccess: null,
  checkedAt: null,
}));

export const useHealthStore = create<HealthStore>((set, get) => ({
  meta: null,
  endpoints: initialEndpoints,
  probing: false,
  error: null,
  lastRun: null,

  runDiagnostics: async () => {
    set({ probing: true, error: null });

    // Pull bridge meta (uptime, CLI version) — non-fatal if it fails.
    let meta: HermesHealth | null = get().meta;
    try {
      meta = await getHermesHealth();
    } catch (e) {
      set({ error: errMessage(e) });
    }

    // Probe every endpoint in parallel; merge into the existing rows so a single
    // failed probe preserves the prior lastSuccess timestamp.
    const prev = get().endpoints;
    const results = await Promise.all(
      BRIDGE_ENDPOINTS.map(async (e) => {
        const r = await probeEndpoint(e.path);
        const before = prev.find((p) => p.key === e.key);
        const now = Date.now();
        return {
          key: e.key,
          label: e.label,
          path: e.path,
          ok: r.ok,
          status: r.status,
          latencyMs: r.latencyMs,
          error: r.error,
          lastSuccess: r.ok ? now : before?.lastSuccess ?? null,
          checkedAt: now,
        } as EndpointHealth;
      }),
    );

    set({ meta, endpoints: results, probing: false, lastRun: Date.now() });
  },
}));
