import { create } from 'zustand';
import { getMcAgents, errMessage, type McAgent } from '../lib/api';

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

// The bridge has no /api/mc/leads endpoint. Leads are derived from the live
// Mc agent roster: each agent becomes a lead whose status and score are a
// deterministic function of their task counts, so the registry is stable across
// refreshes and reflects real activity.

const SOURCES = ['referral', 'organic', 'outbound', 'inbound', 'event'] as const;

function hash(s: string): number {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(x);
}

// Sum every present count across the given status keys. `counts` is keyed by a
// task's single canonical status (mc_store `assignees()`), so a task is counted
// under exactly one key — summing a set of DISTINCT statuses can never
// double-count. A first-match return would silently DROP co-occurring statuses
// (e.g. an agent's `blocked` tasks hidden behind its `ready` count — narratrix's
// 5 blocked vanishing behind ready:2 — understating queue depth and lead score).
// Mirrors useGhostStore.sumKeys (iter #63).
function sumKeys(counts: Record<string, number>, ...keys: string[]): number {
  let total = 0;
  for (const k of keys) {
    const v = counts?.[k];
    if (typeof v === 'number') total += v;
  }
  return total;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function mapAgentToLead(a: McAgent): Lead {
  const counts = a.counts || {};
  const done = sumKeys(counts, 'done', 'completed');
  const running = sumKeys(counts, 'running', 'in_progress', 'active', 'started');
  // Queue = every NON-terminal, non-running task the agent holds. The mc canonical
  // non-running/non-terminal statuses are ready/todo/blocked/review/scheduled/triage
  // (see OperationsCenter COLUMNS); done/completed/archived/failed are terminal/adverse
  // and excluded. `review`+`scheduled`+`triage` were missing here (this only had
  // `blocked` added iter #64) — so an agent still holding scheduled/review/triage work
  // computed queue===0 and got mislabeled 'converted' (lead closed) instead of
  // 'qualified', with its score undercounted. Mirrors useGhostStore.mapAgentsToTopology
  // (iter #79); queued/pending kept as defensive legacy aliases.
  const queue = sumKeys(counts, 'ready', 'queued', 'pending', 'todo', 'blocked', 'review', 'scheduled', 'triage');
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
      const { agents } = await getMcAgents();
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
