import { create } from 'zustand';
import {
  getHermesTasks,
  createHermesTask,
  claimHermesTask,
  completeHermesTask,
  blockHermesTask,
  errMessage,
  type HermesTask,
} from '../lib/api';

export interface OpTask {
  id: string;
  projectId: string;
  name: string;
  agentId: string;
  agentName: string;
  status: 'running' | 'pending' | 'failed' | 'complete' | 'ready' | 'blocked' | 'done';
  priority: 'critical' | 'high' | 'normal' | number;
  createdAt: Date;
}

export interface TaskSummary {
  total: number;
  completed: number;
  running: number;
  pending: number;
  failed: number;
  ready: number;
  blocked: number;
}

interface TaskStore {
  tasks: OpTask[];
  hermesTasks: HermesTask[];
  summary: TaskSummary | null;
  isLoading: boolean;
  error: string | null;
  lastSync: Date | null;
  fetchTasks: () => Promise<void>;
  fetchSummary: () => void;
  addHermesTask: (title: string, body?: string, assignee?: string, priority?: number) => Promise<HermesTask | null>;
  claimHermesTaskById: (taskId: string) => Promise<boolean>;
  completeHermesTaskById: (taskId: string) => Promise<boolean>;
  blockHermesTaskById: (taskId: string, reason: string) => Promise<boolean>;
}

const mapHermesToOp = (t: HermesTask): OpTask => ({
  id: t.id,
  projectId: t.tenant || 'hermes',
  name: t.title,
  agentId: t.assignee || 'unassigned',
  agentName: t.assignee || 'Unassigned',
  status:
    t.status === 'done' || t.status === 'completed' ? 'done'
    : t.status === 'running' ? 'running'
    : t.status === 'blocked' ? 'blocked'
    : t.status === 'failed' ? 'failed'
    : t.status === 'ready' ? 'ready'
    : 'pending',
  priority: t.priority,
  createdAt: new Date(t.created_at * 1000),
});

function summarize(ht: HermesTask[]): TaskSummary {
  const is = (s: string) => (t: HermesTask) => t.status === s;
  return {
    total: ht.length,
    completed: ht.filter((t) => t.status === 'done' || t.status === 'completed').length,
    running: ht.filter(is('running')).length,
    pending: ht.filter((t) => t.status === 'pending' || t.status === 'ready').length,
    failed: ht.filter(is('failed')).length,
    ready: ht.filter(is('ready')).length,
    blocked: ht.filter(is('blocked')).length,
  };
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  hermesTasks: [],
  summary: null,
  isLoading: false,
  error: null,
  lastSync: null,

  fetchTasks: async () => {
    set({ isLoading: true });
    try {
      const { tasks } = await getHermesTasks();
      const ht = tasks || [];
      set({
        hermesTasks: ht,
        tasks: ht.map(mapHermesToOp),
        summary: summarize(ht),
        error: null,
        isLoading: false,
        lastSync: new Date(),
      });
    } catch (err) {
      const msg = errMessage(err);
      console.error('[TaskStore] fetchTasks failed:', msg);
      set({ isLoading: false, error: msg });
    }
  },

  fetchSummary: () => set({ summary: summarize(get().hermesTasks) }),

  addHermesTask: async (title, body, assignee, priority) => {
    try {
      const data = await createHermesTask({ title, body, assignee, priority });
      await get().fetchTasks();
      return (data?.task as HermesTask) ?? null;
    } catch (err) {
      const msg = errMessage(err);
      console.error('[TaskStore] addHermesTask failed:', msg);
      set({ error: msg });
      return null;
    }
  },

  claimHermesTaskById: async (taskId) => {
    try {
      await claimHermesTask(taskId);
      await get().fetchTasks();
      return true;
    } catch (err) {
      console.error('[TaskStore] claim failed:', errMessage(err));
      return false;
    }
  },

  completeHermesTaskById: async (taskId) => {
    try {
      await completeHermesTask(taskId);
      await get().fetchTasks();
      return true;
    } catch (err) {
      console.error('[TaskStore] complete failed:', errMessage(err));
      return false;
    }
  },

  blockHermesTaskById: async (taskId, reason) => {
    try {
      await blockHermesTask(taskId, reason);
      await get().fetchTasks();
      return true;
    } catch (err) {
      console.error('[TaskStore] block failed:', errMessage(err));
      return false;
    }
  },
}));
