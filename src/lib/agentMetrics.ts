// agentMetrics — pure, client-side performance aggregation over the Mc queue.
//
// Mission Control already polls the full kanban task list into useTaskStore
// (`mcTasks`). Each task carries `assignee`, `status`, and epoch-second
// timestamps (`created_at` / `started_at` / `completed_at`). That's enough to
// derive per-agent operational analytics — throughput, success rate, average
// task duration and recent activity — without any new bridge endpoint. This is
// the data source for the War Room "AGENT PERFORMANCE" leaderboard.
import type { McTask } from './api';

export interface AgentMetric {
  agent: string;
  total: number;
  done: number;
  running: number;
  /** failed + blocked — the "did not (yet) succeed" bucket. */
  failed: number;
  ready: number;
  /** done / (done + failed); null when nothing has resolved yet. */
  successRate: number | null;
  /** mean(completed_at − started_at) in seconds over done tasks with both stamps. */
  avgDurationSec: number | null;
  /** tasks completed within the trailing 24h window. */
  last24h: number;
}

const DONE = new Set(['done', 'complete', 'completed']);
const FAILED = new Set(['failed', 'blocked', 'error', 'cancelled', 'canceled']);
const RUNNING = new Set(['running', 'in_progress', 'active']);
const READY = new Set(['ready', 'pending', 'queued', 'todo']);

/**
 * Aggregate per-assignee metrics from the live task list, ranked by throughput
 * (most-completed first, then success rate). `nowMs` is passed in (not read via
 * Date.now) so callers stay render-pure — supply 0 to disable the 24h window.
 */
export function computeAgentMetrics(tasks: McTask[], nowMs = 0): AgentMetric[] {
  const cutoffSec = nowMs > 0 ? nowMs / 1000 - 24 * 3600 : 0;
  const byAgent = new Map<string, { m: AgentMetric; durTotal: number; durCount: number }>();

  for (const t of tasks) {
    const agent = (t.assignee || '').trim();
    if (!agent) continue; // unassigned tasks have no owner to credit
    let entry = byAgent.get(agent);
    if (!entry) {
      entry = {
        m: { agent, total: 0, done: 0, running: 0, failed: 0, ready: 0, successRate: null, avgDurationSec: null, last24h: 0 },
        durTotal: 0,
        durCount: 0,
      };
      byAgent.set(agent, entry);
    }
    const { m } = entry;
    m.total++;
    const status = (t.status || '').toLowerCase();
    if (DONE.has(status)) {
      m.done++;
      if (cutoffSec && t.completed_at && t.completed_at >= cutoffSec) m.last24h++;
      if (t.started_at && t.completed_at && t.completed_at >= t.started_at) {
        entry.durTotal += t.completed_at - t.started_at;
        entry.durCount++;
      }
    } else if (FAILED.has(status)) {
      m.failed++;
    } else if (RUNNING.has(status)) {
      m.running++;
    } else if (READY.has(status)) {
      m.ready++;
    }
  }

  const out: AgentMetric[] = [];
  for (const { m, durTotal, durCount } of byAgent.values()) {
    const resolved = m.done + m.failed;
    m.successRate = resolved > 0 ? m.done / resolved : null;
    m.avgDurationSec = durCount > 0 ? durTotal / durCount : null;
    out.push(m);
  }

  // Rank: most completed, then highest success rate, then most active.
  out.sort((a, b) =>
    b.done - a.done ||
    (b.successRate ?? -1) - (a.successRate ?? -1) ||
    (b.running + b.ready) - (a.running + a.ready) ||
    a.agent.localeCompare(b.agent),
  );
  return out;
}

/** Compact human duration from seconds: 42s · 5m · 1.4h · 2.1d. */
export function fmtDuration(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}
