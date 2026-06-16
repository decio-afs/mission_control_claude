import { create } from 'zustand';
import {
  getMcTasks,
  createMcTask,
  claimMcTask,
  completeMcTask,
  blockMcTask,
  unblockMcTask,
  promoteMcTask,
  scheduleMcTask,
  archiveMcTask,
  assignMcTask,
  reassignMcTask,
  reclaimMcTask,
  commentMcTask,
  editMcTask,
  linkMcTasks,
  unlinkMcTasks,
  specifyMcTask,
  getMcTaskDetail,
  getKanbanStats,
  getKanbanDiagnostics,
  reconcileKanban,
  routeTriage,
  escalateExhausted,
  getMcBoards,
  createMcBoard,
  switchMcBoard,
  errMessage,
  bridgeDetail,
  type McTask,
  type TaskDetail,
  type KanbanStats,
  type KanbanBoard,
  type BoardDiagnostic,
  type RouteResult,
  type EscalateResult,
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
  mcTasks: McTask[];
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
  reconcileBoard: (thresholdHours?: number) => Promise<number>;
  routeTriageTasks: (opts?: { taskId?: string; dryRun?: boolean }) => Promise<RouteResult | null>;
  escalateExhaustedTasks: (opts?: { taskId?: string; dryRun?: boolean }) => Promise<EscalateResult | null>;
  specifyTask: (taskId: string) => Promise<boolean>;
  fetchTaskDetail: (taskId: string) => Promise<TaskDetail | null>;
  addMcTask: (title: string, body?: string, assignee?: string, priority?: number) => Promise<McTask | null>;
  createTask: (input: CreateTaskInput) => Promise<McTask | null>;
  claimMcTaskById: (taskId: string) => Promise<boolean>;
  completeMcTaskById: (taskId: string) => Promise<boolean>;
  blockMcTaskById: (taskId: string, reason: string) => Promise<boolean>;
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

const mapMcToOp = (t: McTask): OpTask => ({
  id: t.id,
  projectId: t.tenant || 'mc',
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

function summarize(ht: McTask[]): TaskSummary {
  const is = (s: string) => (t: McTask) => t.status === s;
  return {
    total: ht.length,
    completed: ht.filter((t) => t.status === 'done' || t.status === 'completed').length,
    running: ht.filter(is('running')).length,
    // Disjoint from `ready` — counting both states here double-counted every ready
    // task (it's also tallied in `ready` below). Consumers that want total queued
    // work add `pending + ready` themselves (see the topbar QUEUE in Layout.tsx).
    pending: ht.filter(is('pending')).length,
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
      // Surface the bridge's real reason (FastAPI `detail` / CLI stderr), not
      // axios's generic "Request failed with status code N" — TaskDetailDrawer
      // and WorkflowBuilder render this `error` to the operator (LIFE-1).
      const msg = bridgeDetail(err);
      console.error(`[TaskStore] ${label} failed:`, msg);
      set({ error: msg });
      return false;
    }
  };

  return {
    tasks: [],
    mcTasks: [],
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
        const { tasks } = await getMcTasks();
        const ht = tasks || [];
        set({
          mcTasks: ht,
          tasks: ht.map(mapMcToOp),
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

    fetchSummary: () => set({ summary: summarize(get().mcTasks) }),

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
        const { boards } = await getMcBoards();
        set({ boards: boards || [] });
      } catch (err) {
        console.error('[TaskStore] fetchBoards failed:', errMessage(err));
      }
    },

    switchBoard: async (slug) => {
      const ok = await mutate('switchBoard', () => switchMcBoard(slug));
      if (ok) await get().fetchBoards();
      return ok;
    },

    createBoard: async (slug, name, description, switchTo) => {
      const ok = await mutate('createBoard', () => createMcBoard({ slug, name, description, switch: switchTo }));
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

    // Self-heal: reclaim stale running claims, then refresh the board so the
    // freed tasks reappear as ready and the stale_claim diagnostics clear.
    // Returns the number of tasks reclaimed.
    reconcileBoard: async (thresholdHours) => {
      try {
        const res = await reconcileKanban(thresholdHours);
        const n = res.reclaimed?.length || 0;
        if (n > 0) {
          await get().fetchTasks();
          await get().fetchStats();
        }
        await get().fetchDiagnostics();
        return n;
      } catch (err) {
        const msg = errMessage(err);
        console.error('[TaskStore] reconcileBoard failed:', msg);
        set({ error: msg });
        return 0;
      }
    },

    // Auto-route triage tasks to best-fit agents by skill match, then refresh so
    // routed tasks leave the triage column. Returns the full plan (routed +
    // skipped) for the UI, or null on error. `dryRun` previews without mutating.
    routeTriageTasks: async (opts) => {
      try {
        const res = await routeTriage(opts);
        if (!opts?.dryRun && res.routed.length > 0) {
          await get().fetchTasks();
          await get().fetchStats();
        }
        return res;
      } catch (err) {
        const msg = errMessage(err);
        console.error('[TaskStore] routeTriageTasks failed:', msg);
        set({ error: msg });
        return null;
      }
    },

    // Escalate retry-exhausted tasks (blocked-with-reason), then refresh so the
    // board reflects the new blocked state + diagnostics clear. Returns the full
    // plan (escalated + skipped) for the UI, or null on error. `dryRun` previews.
    escalateExhaustedTasks: async (opts) => {
      try {
        const res = await escalateExhausted(opts);
        if (!opts?.dryRun && res.escalated.length > 0) {
          await get().fetchTasks();
          await get().fetchStats();
        }
        await get().fetchDiagnostics();
        return res;
      } catch (err) {
        const msg = errMessage(err);
        console.error('[TaskStore] escalateExhaustedTasks failed:', msg);
        set({ error: msg });
        return null;
      }
    },

    specifyTask: (taskId) => mutate('specify', () => specifyMcTask(taskId)),

    fetchTaskDetail: async (taskId) => {
      try {
        return await getMcTaskDetail(taskId);
      } catch (err) {
        console.error('[TaskStore] fetchTaskDetail failed:', errMessage(err));
        return null;
      }
    },

    createTask: async (input) => {
      try {
        const data = await createMcTask(input);
        await get().fetchTasks();
        void get().fetchStats();
        return (data?.task as McTask) ?? null;
      } catch (err) {
        const msg = errMessage(err);
        console.error('[TaskStore] createTask failed:', msg);
        set({ error: msg });
        return null;
      }
    },

    addMcTask: async (title, body, assignee, priority) =>
      get().createTask({ title, body, assignee, priority }),

    claimMcTaskById: (taskId) => mutate('claim', () => claimMcTask(taskId)),
    completeMcTaskById: (taskId) => mutate('complete', () => completeMcTask(taskId)),
    blockMcTaskById: (taskId, reason) => mutate('block', () => blockMcTask(taskId, reason)),
    unblockTask: (taskId, reason) => mutate('unblock', () => unblockMcTask(taskId, reason)),
    promoteTask: (taskId, reason, force) => mutate('promote', () => promoteMcTask(taskId, reason, force)),
    scheduleTask: (taskId, reason) => mutate('schedule', () => scheduleMcTask(taskId, reason)),
    archiveTask: (taskId) => mutate('archive', () => archiveMcTask(taskId)),
    assignTask: (taskId, profile) => mutate('assign', () => assignMcTask(taskId, profile)),
    reassignTask: (taskId, profile, reclaim, reason) => mutate('reassign', () => reassignMcTask(taskId, profile, reclaim, reason)),
    reclaimTask: (taskId) => mutate('reclaim', () => reclaimMcTask(taskId)),
    commentTask: (taskId, text, author) => mutate('comment', () => commentMcTask(taskId, text, author)),
    editTask: (taskId, result, summary, metadata) => mutate('edit', () => editMcTask(taskId, result, summary, metadata)),
    linkTasks: (parentId, childId) => mutate('link', () => linkMcTasks(parentId, childId)),
    unlinkTasks: (parentId, childId) => mutate('unlink', () => unlinkMcTasks(parentId, childId)),
  };
});
