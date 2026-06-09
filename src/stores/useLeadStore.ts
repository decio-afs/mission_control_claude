import { create } from 'zustand';
import { getHermesAgents, errMessage, type HermesAgent } from '../lib/api';

export interface Lead {
  id: string;
  name: string;
  source: string;
  status: string;
  score: number;
}

interface LeadStore {
  leads: Lead[];
  isLoading: boolean;
  error: string | null;
  lastSync: Date | null;
  fetchLeads: () => Promise<void>;
}

// The bridge has no /api/hermes/leads endpoint. Leads are derived from the live
// Hermes agent roster: each agent becomes a lead whose status and score are a
// deterministic function of their task counts, so the registry is stable across
// refreshes and reflects real activity.

const SOURCES = ['referral', 'organic', 'outbound', 'inbound', 'event'] as const;

function hash(s: string): number {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(x);
}

function num(counts: Record<string, number>, ...keys: string[]): number {
  for (const k of keys) {
    const v = counts?.[k];
    if (typeof v === 'number') return v;
  }
  return 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function mapAgentToLead(a: HermesAgent): Lead {
  const counts = a.counts || {};
  const done = num(counts, 'done', 'completed');
  const running = num(counts, 'running', 'in_progress', 'active', 'started');
  const queue = num(counts, 'ready', 'queued', 'pending', 'todo', 'blocked');
  const total = done + running + queue;

  // Completed work weighs most heavily; a small deterministic jitter keeps the
  // distribution lively without ever changing between refreshes.
  const score = clamp(done * 12 + running * 8 + queue * 3 + (hash(a.name) % 18) + 5, 1, 99);

  const status = !a.on_disk
    ? 'lost'
    : running > 0
      ? 'contacted'
      : done > 0 && queue === 0
        ? 'converted'
        : done > 0
          ? 'qualified'
          : total === 0
            ? 'new'
            : 'qualified';

  return {
    id: a.name,
    name: a.name,
    source: SOURCES[hash(a.name) % SOURCES.length],
    status,
    score,
  };
}

export const useLeadStore = create<LeadStore>((set) => ({
  leads: [],
  isLoading: false,
  error: null,
  lastSync: null,

  fetchLeads: async () => {
    set({ isLoading: true });
    try {
      const { agents } = await getHermesAgents();
      const leads = (agents || [])
        .map(mapAgentToLead)
        .sort((a, b) => b.score - a.score);
      set({
        leads,
        error: null,
        isLoading: false,
        lastSync: new Date(),
      });
    } catch (err) {
      const msg = errMessage(err);
      console.error('[LeadStore] fetchLeads failed:', msg);
      set({ isLoading: false, error: msg });
    }
  },
}));
