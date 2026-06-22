// backlogTrend — pure, client-side queue-health aggregation.
//
// Run #11's throughput view answers "how many tasks finished each hour" (a raw
// per-hour histogram). This answers the *operational* question one level up: is
// the queue keeping up, or falling behind? It folds the already-polled Mc
// task list (`useTaskStore.mcTasks`) into a trailing window and accumulates
// arrivals (created) and completions (done) into two cumulative series — the gap
// between them is the net backlog the window added or burned down. Plus the live,
// window-independent count of still-open work (instantaneous WIP). No new bridge
// endpoint: a pure fold over the queue, same source as the leaderboard/throughput.
import type { McTask } from './api';

const DONE = new Set(['done', 'complete', 'completed']);
// Statuses that are "closed" (no longer outstanding work) for the open-backlog
// count. Everything else (triage/todo/ready/running/blocked/pending/review/…)
// counts as open WIP. Kept in lock-step with agingWip's TERMINAL set so the two
// queue views (this burn-down's `openBacklog` and the Aging-WIP panel's
// `openCount`, shown together in the War Room) agree on what's still in-flight —
// `error` is closed here too (a failed run is resolved, not outstanding WIP).
const CLOSED = new Set(['done', 'complete', 'completed', 'failed', 'cancelled', 'canceled', 'archived', 'error']);
const HOUR_SEC = 3600;

export interface BacklogPoint {
  /** epoch-ms of the start of this hour bucket. */
  startMs: number;
  /** short hour label, e.g. "14h" (UTC, matching the topbar ZULU clock). */
  label: string;
  /** tasks created within this hour. */
  created: number;
  /** tasks completed within this hour. */
  done: number;
  /** cumulative created since the window start (running total). */
  cumCreated: number;
  /** cumulative done since the window start (running total). */
  cumDone: number;
  /** net backlog change since window start (cumCreated − cumDone). */
  net: number;
  /** true for the bucket containing `nowMs` (the in-progress, partial hour). */
  current: boolean;
}

export interface BacklogTrend {
  points: BacklogPoint[];
  /** total created within the window. */
  totalCreated: number;
  /** total completed within the window. */
  totalDone: number;
  /** net backlog Δ over the whole window (created − done). >0 grew, <0 burned down. */
  netDelta: number;
  /** live count of still-open tasks (window-independent instantaneous WIP). */
  openBacklog: number;
  /** direction the window's net backlog moved. */
  trend: 'growing' | 'shrinking' | 'flat';
  /** the window length actually charted, in hours. */
  hours: number;
}

/**
 * Fold the task list into `hours` trailing one-hour windows ending at `nowMs`,
 * accumulating created/done into cumulative series. `nowMs` is passed in (never
 * read via Date.now) so callers stay render-pure; supply 0 for an inert result.
 */
export function computeBacklogTrend(tasks: McTask[], nowMs = 0, hours = 24): BacklogTrend {
  // Open backlog is window-independent — count it even with no window seeded yet.
  let openBacklog = 0;
  for (const t of tasks) {
    if (!CLOSED.has((t.status || '').toLowerCase())) openBacklog++;
  }

  const empty: BacklogTrend = {
    points: [], totalCreated: 0, totalDone: 0, netDelta: 0, openBacklog, trend: 'flat', hours,
  };
  if (nowMs <= 0 || hours <= 0) return empty;

  const nowSec = nowMs / 1000;
  // Align to whole UTC hours so bucket boundaries are stable between polls.
  const currentHourStart = Math.floor(nowSec / HOUR_SEC) * HOUR_SEC;
  const windowStart = currentHourStart - (hours - 1) * HOUR_SEC;

  // Per-hour tallies first, then accumulate into the cumulative series.
  const created = new Array(hours).fill(0);
  const done = new Array(hours).fill(0);

  const idxOf = (sec: number): number => {
    if (sec < windowStart || sec >= currentHourStart + HOUR_SEC) return -1;
    return Math.floor((sec - windowStart) / HOUR_SEC);
  };

  let totalCreated = 0;
  let totalDone = 0;
  for (const t of tasks) {
    if (t.created_at) {
      const i = idxOf(t.created_at);
      if (i >= 0) { created[i]++; totalCreated++; }
    }
    if (DONE.has((t.status || '').toLowerCase()) && t.completed_at) {
      const i = idxOf(t.completed_at);
      if (i >= 0) { done[i]++; totalDone++; }
    }
  }

  const points: BacklogPoint[] = [];
  let cumCreated = 0;
  let cumDone = 0;
  for (let i = 0; i < hours; i++) {
    const startSec = windowStart + i * HOUR_SEC;
    cumCreated += created[i];
    cumDone += done[i];
    points.push({
      startMs: startSec * 1000,
      label: `${new Date(startSec * 1000).getUTCHours().toString().padStart(2, '0')}h`,
      created: created[i],
      done: done[i],
      cumCreated,
      cumDone,
      net: cumCreated - cumDone,
      current: startSec === currentHourStart,
    });
  }

  const netDelta = totalCreated - totalDone;
  const trend: BacklogTrend['trend'] = netDelta > 0 ? 'growing' : netDelta < 0 ? 'shrinking' : 'flat';

  return { points, totalCreated, totalDone, netDelta, openBacklog, trend, hours };
}
