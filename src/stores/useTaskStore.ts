import { create } from 'zustand';
import {
  getMcTasks,
  createMcTask,
  claimMcTask,
  completeMcTask,
  blockMcTask,
  failMcTask,
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
  cascadeDependencies,
  reassignDeadAgent,
  sweepBoard as runSweepBoard,
  promoteReady as runPromoteReady,
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
  type CascadeResult,
  type ReassignResult,
  type SweepResult,
  type PromoteReadyResult,
} from '../lib/api';

export interface OpTask {
  id: string;
  projectId: string;
  name: string;
  agentId: string;
  agentName: string;
  status: 'running' | 'pending' | 'failed' | 'complete' | 'ready' | 'blocked' | 'done'
    | 'todo' | 'triage' | 'review' | 'scheduled' | 'archived';
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
  cascadeDeps: (opts?: { dryRun?: boolean }) => Promise<CascadeResult | null>;
  reassignDead: (opts?: { fromAgent?: string; dryRun?: boolean }) => Promise<ReassignResult | null>;
  sweepBoard: (opts?: { dryRun?: boolean }) => Promise<SweepResult | null>;
  promoteReady: (opts?: { taskId?: string; dryRun?: boolean }) => Promise<PromoteReadyResult | null>;
  specifyTask: (taskId: string) => Promise<boolean>;
  fetchTaskDetail: (taskId: string) => Promise<TaskDetail | null>;
  addMcTask: (title: string, body?: string, assignee?: string, priority?: number) => Promise<McTask | null>;
  createTask: (input: CreateTaskInput) => Promise<McTask | null>;
  claimMcTaskById: (taskId: string) => Promise<boolean>;
  completeMcTaskById: (taskId: string) => Promise<boolean>;
  blockMcTaskById: (taskId: string, reason: string) => Promise<boolean>;
  failMcTaskById: (taskId: string, reason: string) => Promise<boolean>;
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
  // Faithful status projection. mc_store's lifecycle states (todo/triage/review/
  // scheduled/archived) used to all collapse to 'pending', so a consumer that
  // renders tasks[].status — e.g. useAgentCrud's "spawn agent on task" dropdown,
  // which prints [{status}] per option — mislabeled a real `todo`/`review` task
  // as [PENDING]. Pass each known status through; only a genuinely unknown status
  // falls back to 'pending'. (completed → done is the one canonical normalization.)
  status:
    t.status === 'done' || t.status === 'completed' ? 'done'
    : t.status === 'running' ? 'running'
    : t.status === 'blocked' ? 'blocked'
    : t.status === 'failed' ? 'failed'
    : t.status === 'ready' ? 'ready'
    : t.status === 'todo' ? 'todo'
    : t.status === 'triage' ? 'triage'
    : t.status === 'review' ? 'review'
    : t.status === 'scheduled' ? 'scheduled'
    : t.status === 'archived' ? 'archived'
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
    // Backlog work waiting to be promoted to `ready`. mc_store's canonical
    // backlog status is `todo` (OperationsCenter's `colOf` treats `pending` as a
    // legacy alias of `todo`); count BOTH so post-migration `todo` tasks aren't
    // dropped — they used to vanish from the topbar QUEUE entirely (the live board
    // is `todo`-only, so QUEUE read 0 while real work sat queued). Still disjoint
    // from `ready` — also tallying the ready state here would double-count every
    // ready task. The topbar QUEUE sums `pending + ready` (see Layout.tsx).
    pending: ht.filter((t) => t.status === 'pending' || t.status === 'todo').length,
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

    // Enforce parent→child dependency ordering: hold workable children with open
    // parents, promote held children whose parents are all done, then refresh so
    // the board + diagnostics reflect the new states. Returns the full plan
    // (held + promoted + waiting) for the UI, or null on error. `dryRun` previews.
    cascadeDeps: async (opts) => {
      try {
        const res = await cascadeDependencies(opts);
        if (!opts?.dryRun && (res.held.length > 0 || res.promoted.length > 0)) {
          await get().fetchTasks();
          await get().fetchStats();
        }
        await get().fetchDiagnostics();
        return res;
      } catch (err) {
        const msg = errMessage(err);
        console.error('[TaskStore] cascadeDeps failed:', msg);
        set({ error: msg });
        return null;
      }
    },

    // Reassign a dead/idle agent's open work to a live best-fit owner: detects
    // off-roster / stale-claim agents and moves their workable tasks to another
    // agent by skill match, then refreshes so the board + diagnostics reflect the
    // new owners. Returns the full plan (reassigned + skipped + dead_agents) for
    // the UI, or null on error. `dryRun` previews without mutating.
    reassignDead: async (opts) => {
      try {
        const res = await reassignDeadAgent(opts);
        if (!opts?.dryRun && res.reassigned.length > 0) {
          await get().fetchTasks();
          await get().fetchStats();
        }
        await get().fetchDiagnostics();
        return res;
      } catch (err) {
        const msg = errMessage(err);
        console.error('[TaskStore] reassignDead failed:', msg);
        set({ error: msg });
        return null;
      }
    },

    // One-call self-manage macro: run reconcile → cascade → reassign → escalate in
    // order (the four self-heal verbs in one shot), then refresh the board +
    // diagnostics so every remediated state reflects at once. Returns the full
    // aggregate plan (each sub-result + counts/total), or null on error. `dryRun`
    // previews the whole plan without mutating.
    sweepBoard: async (opts) => {
      try {
        const res = await runSweepBoard(opts);
        if (!opts?.dryRun && res.total > 0) {
          await get().fetchTasks();
          await get().fetchStats();
        }
        await get().fetchDiagnostics();
        return res;
      } catch (err) {
        const msg = errMessage(err);
        console.error('[TaskStore] sweepBoard failed:', msg);
        set({ error: msg });
        return null;
      }
    },

    // Board-wide promotion gate: promote actionable todo → ready so the
    // dispatcher (which only fires `ready` work) has something to run. Promotes
    // every todo task with a live assignee and no open parent dependency, leaving
    // unassigned/off-roster/dep-blocked tasks honestly in todo. Refreshes the
    // board + diagnostics on a real change. Returns the plan, or null on error.
    promoteReady: async (opts) => {
      try {
        const res = await runPromoteReady(opts);
        if (!opts?.dryRun && res.promoted.length > 0) {
          await get().fetchTasks();
          await get().fetchStats();
        }
        await get().fetchDiagnostics();
        return res;
      } catch (err) {
        const msg = errMessage(err);
        console.error('[TaskStore] promoteReady failed:', msg);
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
    failMcTaskById: (taskId, reason) => mutate('fail', () => failMcTask(taskId, reason)),
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
