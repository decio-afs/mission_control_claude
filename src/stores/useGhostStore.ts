import { create } from 'zustand';
import {
  getMcAgents,
  createMcAgent,
  bridgeDetail,
  updateMcAgent,
  deleteMcAgent,
  spawnAgentOnTask,
  errMessage,
  type McAgent,
  type AgentCreateRequest,
  type AgentUpdateRequest,
} from '../lib/api';

export interface GhostNode {
  id: string;
  name: string;
  type: 'core' | 'fixer' | 'runner' | 'squad';
  model?: 'cyan' | 'purple' | 'green' | string;
  val: number;
  squad?: string;
  tasks_running?: number;
  queue_depth?: number;
  has_active_work?: boolean;
  status?: 'active' | 'idle' | 'online' | 'offline' | string;
  last_active?: Date | null;
}

export interface AgentActivity {
  id: string;
  agentId: string;
  agentName: string;
  action: 'created' | 'updated' | 'deleted' | 'spawned' | 'status_change';
  timestamp: Date;
  detail?: string;
}

/** Rolling fleet telemetry — one sample per successful topology poll. */
export interface FleetHistory {
  running: number[];
  queue: number[];
  online: number[];
}

/** Synthetic-but-derived load score in [5,98] — shared by the deck UI and the
 * history sampler so the sparkline plots exactly what the gauges show. */
export function agentLoad(n: GhostNode): number {
  const online = n.status === 'active' || n.status === 'online';
  const r = n.tasks_running ?? 0, q = n.queue_depth ?? 0;
  const load = 0.1 + r * 0.22 + q * 0.04 + (online ? 0.08 : 0);
  return Math.round(Math.max(0.05, Math.min(0.98, load)) * 100);
}

const HISTORY_CAP = 48;
const pushCapped = (arr: number[], v: number) => {
  arr.push(v);
  if (arr.length > HISTORY_CAP) arr.shift();
};

interface GhostStore {
  nodes: GhostNode[];
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  lastSync: Date | null;
  agentActivity: AgentActivity[];
  /** Real sampled history (per topology poll) for fleet + per-agent sparklines. */
  history: FleetHistory;
  agentLoadHistory: Record<string, number[]>;
  fetchTopology: () => Promise<void>;
  createAgent: (payload: AgentCreateRequest) => Promise<boolean>;
  updateAgent: (id: string, payload: AgentUpdateRequest) => Promise<boolean>;
  deleteAgent: (id: string) => Promise<boolean>;
  spawnAgentOnTask: (agentId: string, taskId: string) => Promise<boolean>;
  logActivity: (activity: Omit<AgentActivity, 'id' | 'timestamp'>) => void;
}

// Squads used purely for visual grouping/coloring of the legion.
const SQUADS = ['SEC', 'INTEL', 'INFRA', 'CONT', 'DEV'] as const;
// Agent names treated as the orchestrator / director core node.
const CORE_NAMES = new Set(['kate', 'director', 'core', 'orchestrator', 'mc']);

function hash(s: string): number {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(x);
}

// Sum every present count across the given status keys. `counts` is keyed by a
// task's single canonical status (mc_store `assignees()`), so a task is counted
// under exactly one key — summing a set of DISTINCT statuses can never
// double-count; it yields the number of tasks currently in any of those states.
// (A first-match return would silently DROP co-occurring statuses, e.g. an
// agent's `blocked` tasks hidden behind its `ready` count — narratrix's 5
// blocked vanishing behind ready:2 — under-reporting queue depth.)
function sumKeys(counts: Record<string, number>, ...keys: string[]): number {
  let total = 0;
  for (const k of keys) {
    const v = counts?.[k];
    if (typeof v === 'number') total += v;
  }
  return total;
}

/**
 * Map the live Mc assignee list into Agent Network nodes: one node per real
 * agent, with a deterministic squad/role for coloring. No synthetic nodes are
 * added, so counts always reflect the real agent roster.
 */
export function mapAgentsToTopology(agents: McAgent[]): GhostNode[] {
  return agents.map((a) => {
    const lc = a.name.toLowerCase();
    const isCore = CORE_NAMES.has(lc);
    const running = sumKeys(a.counts, 'running', 'in_progress', 'active', 'started');
    // Queue depth = every NON-terminal, non-running task the agent holds. The mc
    // canonical non-running/non-terminal statuses are ready/todo/blocked/review/
    // scheduled/triage (see OperationsCenter COLUMNS); `done`/`archived`/`failed`
    // are terminal/adverse and excluded. `review`+`scheduled`+`triage` were
    // missing — an operator SCHEDULE-ing an assigned task (TaskDetailDrawer verb)
    // left it `scheduled` yet invisible in its agent's queue depth, the same
    // bucket-completeness under-count #62/#63 fixed for `blocked` (queued/pending
    // kept as defensive legacy aliases).
    const queue = sumKeys(a.counts, 'ready', 'queued', 'pending', 'todo', 'blocked', 'review', 'scheduled', 'triage');
    const squad = isCore ? 'CORE' : SQUADS[hash(a.name) % SQUADS.length];
    const type: GhostNode['type'] = isCore ? 'core' : hash(a.name) % 3 === 0 ? 'fixer' : 'runner';
    const status = !a.on_disk ? 'offline' : running > 0 ? 'active' : 'online';

    return {
      id: a.name,
      name: a.name,
      type,
      squad,
      val: isCore ? 6 : type === 'fixer' ? 4 : 3,
      tasks_running: running,
      queue_depth: queue,
      has_active_work: running > 0,
      status,
      last_active: null,
    };
  });
}

let _activityId = 0;

export const useGhostStore = create<GhostStore>((set, get) => ({
  nodes: [],
  isConnected: false,
  isLoading: false,
  error: null,
  lastSync: null,
  agentActivity: [],
  history: { running: [], queue: [], online: [] },
  agentLoadHistory: {},

  fetchTopology: async () => {
    set({ isLoading: true });
    try {
      const { agents } = await getMcAgents();
      const nodes = mapAgentsToTopology(agents || []);

      // Sample real telemetry once per poll so the deck's sparklines plot
      // actual history instead of decorative noise.
      const live = nodes.filter((n) => n.type !== 'squad' && n.type !== 'core');
      const history = { ...get().history };
      pushCapped(history.running, live.reduce((s, n) => s + (n.tasks_running ?? 0), 0));
      pushCapped(history.queue, live.reduce((s, n) => s + (n.queue_depth ?? 0), 0));
      pushCapped(history.online, live.filter((n) => n.status === 'active' || n.status === 'online').length);
      const agentLoadHistory = { ...get().agentLoadHistory };
      for (const n of live) {
        const arr = [...(agentLoadHistory[n.id] ?? [])];
        pushCapped(arr, agentLoad(n));
        agentLoadHistory[n.id] = arr;
      }

      set({
        nodes,
        history,
        agentLoadHistory,
        isConnected: true,
        error: null,
        isLoading: false,
        lastSync: new Date(),
      });
    } catch (err) {
      const msg = errMessage(err);
      console.error('[GhostStore] fetchTopology failed:', msg);
      set({ isConnected: false, isLoading: false, error: msg });
    }
  },

  createAgent: async (payload) => {
    set({ isLoading: true, error: null });
    try {
      await createMcAgent(payload);
      await get().fetchTopology();
      get().logActivity({
        agentId: payload.name,
        agentName: payload.name,
        action: 'created',
        detail: `Created as ${payload.role}`,
      });
      set({ isLoading: false });
      return true;
    } catch (err) {
      const msg = bridgeDetail(err);
      console.error('[GhostStore] createAgent failed:', msg);
      set({ isLoading: false, error: msg });
      return false;
    }
  },

  updateAgent: async (id, payload) => {
    set({ isLoading: true, error: null });
    try {
      await updateMcAgent(id, payload);
      await get().fetchTopology();
      get().logActivity({
        agentId: id,
        agentName: payload.name || id,
        action: 'updated',
        detail: `Updated properties`,
      });
      set({ isLoading: false });
      return true;
    } catch (err) {
      const msg = bridgeDetail(err);
      console.error('[GhostStore] updateAgent failed:', msg);
      set({ isLoading: false, error: msg });
      return false;
    }
  },

  deleteAgent: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await deleteMcAgent(id);
      await get().fetchTopology();
      get().logActivity({
        agentId: id,
        agentName: id,
        action: 'deleted',
        detail: `Agent removed from registry`,
      });
      set({ isLoading: false });
      return true;
    } catch (err) {
      const msg = bridgeDetail(err);
      console.error('[GhostStore] deleteAgent failed:', msg);
      set({ isLoading: false, error: msg });
      return false;
    }
  },

  spawnAgentOnTask: async (agentId, taskId) => {
    set({ isLoading: true, error: null });
    try {
      await spawnAgentOnTask(agentId, taskId);
      await get().fetchTopology();
      get().logActivity({
        agentId,
        agentName: agentId,
        action: 'spawned',
        detail: `Spawned on task ${taskId}`,
      });
      set({ isLoading: false });
      return true;
    } catch (err) {
      const msg = bridgeDetail(err);
      console.error('[GhostStore] spawnAgentOnTask failed:', msg);
      set({ isLoading: false, error: msg });
      return false;
    }
  },

  logActivity: (activity) => {
    const entry: AgentActivity = {
      ...activity,
      id: `act-${++_activityId}`,
      timestamp: new Date(),
    };
    set((state) => ({
      agentActivity: [entry, ...state.agentActivity].slice(0, 200),
    }));
  },
}));
