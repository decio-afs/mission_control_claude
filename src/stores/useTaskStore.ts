import { create } from 'zustand';
import {
  getHermesTasks,
  createHermesTask,
  claimHermesTask,
  completeHermesTask,
  blockHermesTask,
  unblockHermesTask,
  promoteHermesTask,
  scheduleHermesTask,
  archiveHermesTask,
  assignHermesTask,
  reassignHermesTask,
  reclaimHermesTask,
  commentHermesTask,
  editHermesTask,
  linkHermesTasks,
  unlinkHermesTasks,
  specifyHermesTask,
  getHermesTaskDetail,
  getKanbanStats,
  getKanbanDiagnostics,
  getHermesBoards,
  createHermesBoard,
  switchHermesBoard,
  errMessage,
  type HermesTask,
  type TaskDetail,
  type KanbanStats,
  type KanbanBoard,
  type BoardDiagnostic,
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

export interface CreateTaskInput {
  title: string;
  body?: string;
  assignee?: string;
  priority?: number;
  skills?: string[];
  parents?: string[];
  triage?: boolean;
}

interface TaskStore {
  tasks: OpTask[];
  hermesTasks: HermesTask[];
  summary: TaskSummary | null;
  stats: KanbanStats | null;
  boards: KanbanBoard[];
  diagnostics: BoardDiagnostic[];
  isLoading: boolean;
  error: string | null;
  lastSync: Date | null;
  fetchTasks: () => Promise<void>;
  fetchSummary: () => void;
  fetchStats: () => Promise<void>;
  fetchBoards: () => Promise<void>;
  switchBoard: (slug: string) => Promise<boolean>;
  createBoard: (slug: string, name?: string, description?: string, switchTo?: boolean) => Promise<boolean>;
  fetchDiagnostics: () => Promise<void>;
  specifyTask: (taskId: string) => Promise<boolean>;
  fetchTaskDetail: (taskId: string) => Promise<TaskDetail | null>;
  addHermesTask: (title: string, body?: string, assignee?: string, priority?: number) => Promise<HermesTask | null>;
  createTask: (input: CreateTaskInput) => Promise<HermesTask | null>;
  claimHermesTaskById: (taskId: string) => Promise<boolean>;
  completeHermesTaskById: (taskId: string) => Promise<boolean>;
  blockHermesTaskById: (taskId: string, reason: string) => Promise<boolean>;
  unblockTask: (taskId: string, reason?: string) => Promise<boolean>;
  promoteTask: (taskId: string, reason?: string, force?: boolean) => Promise<boolean>;
  scheduleTask: (taskId: string, reason?: string) => Promise<boolean>;
  archiveTask: (taskId: string) => Promise<boolean>;
  assignTask: (taskId: string, profile: string) => Promise<boolean>;
  reassignTask: (taskId: string, profile: string, reclaim?: boolean, reason?: string) => Promise<boolean>;
  reclaimTask: (taskId: string) => Promise<boolean>;
  commentTask: (taskId: string, text: string, author?: string) => Promise<boolean>;
  editTask: (taskId: string, result: string, summary?: string, metadata?: string) => Promise<boolean>;
  linkTasks: (parentId: string, childId: string) => Promise<boolean>;
  unlinkTasks: (parentId: string, childId: string) => Promise<boolean>;
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

export const useTaskStore = create<TaskStore>((set, get) => {
  // Run a mutation, then refresh the board + stats. Surfaces errors to `error`.
  const mutate = async (label: string, fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn();
      await get().fetchTasks();
      void get().fetchStats();
      return true;
    } catch (err) {
      const msg = errMessage(err);
      console.error(`[TaskStore] ${label} failed:`, msg);
      set({ error: msg });
      return false;
    }
  };

  return {
    tasks: [],
    hermesTasks: [],
    summary: null,
    stats: null,
    boards: [],
    diagnostics: [],
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

    fetchStats: async () => {
      try {
        const stats = await getKanbanStats();
        set({ stats });
      } catch (err) {
        console.error('[TaskStore] fetchStats failed:', errMessage(err));
      }
    },

    fetchBoards: async () => {
      try {
        const { boards } = await getHermesBoards();
        set({ boards: boards || [] });
      } catch (err) {
        console.error('[TaskStore] fetchBoards failed:', errMessage(err));
      }
    },

    switchBoard: async (slug) => {
      const ok = await mutate('switchBoard', () => switchHermesBoard(slug));
      if (ok) await get().fetchBoards();
      return ok;
    },

    createBoard: async (slug, name, description, switchTo) => {
      const ok = await mutate('createBoard', () => createHermesBoard({ slug, name, description, switch: switchTo }));
      if (ok) await get().fetchBoards();
      return ok;
    },

    fetchDiagnostics: async () => {
      try {
        const { diagnostics } = await getKanbanDiagnostics();
        set({ diagnostics: diagnostics || [] });
      } catch (err) {
        console.error('[TaskStore] fetchDiagnostics failed:', errMessage(err));
      }
    },

    specifyTask: (taskId) => mutate('specify', () => specifyHermesTask(taskId)),

    fetchTaskDetail: async (taskId) => {
      try {
        return await getHermesTaskDetail(taskId);
      } catch (err) {
        console.error('[TaskStore] fetchTaskDetail failed:', errMessage(err));
        return null;
      }
    },

    createTask: async (input) => {
      try {
        const data = await createHermesTask(input);
        await get().fetchTasks();
        void get().fetchStats();
        return (data?.task as HermesTask) ?? null;
      } catch (err) {
        const msg = errMessage(err);
        console.error('[TaskStore] createTask failed:', msg);
        set({ error: msg });
        return null;
      }
    },

    addHermesTask: async (title, body, assignee, priority) =>
      get().createTask({ title, body, assignee, priority }),

    claimHermesTaskById: (taskId) => mutate('claim', () => claimHermesTask(taskId)),
    completeHermesTaskById: (taskId) => mutate('complete', () => completeHermesTask(taskId)),
    blockHermesTaskById: (taskId, reason) => mutate('block', () => blockHermesTask(taskId, reason)),
    unblockTask: (taskId, reason) => mutate('unblock', () => unblockHermesTask(taskId, reason)),
    promoteTask: (taskId, reason, force) => mutate('promote', () => promoteHermesTask(taskId, reason, force)),
    scheduleTask: (taskId, reason) => mutate('schedule', () => scheduleHermesTask(taskId, reason)),
    archiveTask: (taskId) => mutate('archive', () => archiveHermesTask(taskId)),
    assignTask: (taskId, profile) => mutate('assign', () => assignHermesTask(taskId, profile)),
    reassignTask: (taskId, profile, reclaim, reason) => mutate('reassign', () => reassignHermesTask(taskId, profile, reclaim, reason)),
    reclaimTask: (taskId) => mutate('reclaim', () => reclaimHermesTask(taskId)),
    commentTask: (taskId, text, author) => mutate('comment', () => commentHermesTask(taskId, text, author)),
    editTask: (taskId, result, summary, metadata) => mutate('edit', () => editHermesTask(taskId, result, summary, metadata)),
    linkTasks: (parentId, childId) => mutate('link', () => linkHermesTasks(parentId, childId)),
    unlinkTasks: (parentId, childId) => mutate('unlink', () => unlinkHermesTasks(parentId, childId)),
  };
});
