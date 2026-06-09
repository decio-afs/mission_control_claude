import { create } from 'zustand';
import {
  getHermesAgents,
  createHermesAgent,
  updateHermesAgent,
  deleteHermesAgent,
  spawnAgentOnTask,
  errMessage,
  type HermesAgent,
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

interface GhostStore {
  nodes: GhostNode[];
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  lastSync: Date | null;
  agentActivity: AgentActivity[];
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
const CORE_NAMES = new Set(['kate', 'director', 'core', 'orchestrator', 'hermes']);

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

/**
 * Map the live Hermes assignee list into Ghost Network nodes: one node per real
 * agent, with a deterministic squad/role for coloring. No synthetic nodes are
 * added, so counts always reflect the real agent roster.
 */
export function mapAgentsToTopology(agents: HermesAgent[]): GhostNode[] {
  return agents.map((a) => {
    const lc = a.name.toLowerCase();
    const isCore = CORE_NAMES.has(lc);
    const running = num(a.counts, 'running', 'in_progress', 'active', 'started');
    const queue = num(a.counts, 'ready', 'queued', 'pending', 'todo', 'blocked');
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

  fetchTopology: async () => {
    set({ isLoading: true });
    try {
      const { agents } = await getHermesAgents();
      set({
        nodes: mapAgentsToTopology(agents || []),
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
      await createHermesAgent(payload);
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
      const msg = errMessage(err);
      console.error('[GhostStore] createAgent failed:', msg);
      set({ isLoading: false, error: msg });
      return false;
    }
  },

  updateAgent: async (id, payload) => {
    set({ isLoading: true, error: null });
    try {
      await updateHermesAgent(id, payload);
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
      const msg = errMessage(err);
      console.error('[GhostStore] updateAgent failed:', msg);
      set({ isLoading: false, error: msg });
      return false;
    }
  },

  deleteAgent: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await deleteHermesAgent(id);
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
      const msg = errMessage(err);
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
      const msg = errMessage(err);
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
