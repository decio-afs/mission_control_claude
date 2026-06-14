// agingWip — pure, client-side aging analysis of still-open work.
//
// Run #16 (cycleTime) measures how long *finished* work took. This is its dual:
// how long *unfinished* work has been sitting. It selects every still-open task
// (anything not in a terminal state) and buckets each by its age —
//   now − (started_at ?? created_at)
// — into the SAME human duration bands as the cycle-time histogram (imported
// from cycleTime, not re-declared), so an operator can spot tasks silently
// rotting in the queue at a glance and jump straight to the oldest offenders.
// No bridge endpoint: a pure fold over the already-polled task store.
import type { McTask } from './api';
import { BUCKET_BOUNDS } from './cycleTime';

// A task is "open" (work-in-progress) unless it has reached a terminal state.
// Mirrors the closed-set used by computeBacklogTrend's openBacklog so the two
// queue views agree on what counts as still-in-flight.
const TERMINAL = new Set([
  'done', 'complete', 'completed', 'failed', 'cancelled', 'canceled', 'archived', 'error',
]);

// Work older than this is flagged "stale" in the headline (1 day).
export const STALE_SEC = 24 * 3600;

export interface AgingTask {
  id: string;
  title: string;
  assignee: string;
  status: string;
  /** age in seconds: now − (started_at ?? created_at), clamped ≥ 0. */
  ageSec: number;
  /** true when the task has never started (aged off created_at, not started_at). */
  neverStarted: boolean;
}

export interface AgingBucket {
  label: string;
  /** inclusive lower bound, seconds. */
  loSec: number;
  /** exclusive upper bound, seconds; null = open-ended. */
  hiSec: number | null;
  count: number;
}

export interface AgingStats {
  buckets: AgingBucket[];
  /** the N oldest open tasks, oldest first (for the actionable list). */
  oldest: AgingTask[];
  /** total still-open tasks (every open task, regardless of usable timestamp). */
  openCount: number;
  /** open tasks whose age ≥ STALE_SEC. */
  staleCount: number;
  /** oldest open task's age in seconds (0 when none). */
  maxAgeSec: number;
}

/**
 * Fold the task list into an aging distribution of still-open work as of
 * `nowMs`. Unlike the completed-work views this is *not* windowed — every open
 * task counts, since the whole point is to surface old ones. `nowMs` is passed
 * in (never Date.now during render); supply 0 for an inert result. `topN` caps
 * the oldest-offenders list.
 */
export function computeAgingWip(tasks: McTask[], nowMs = 0, topN = 8): AgingStats {
  const buckets: AgingBucket[] = BUCKET_BOUNDS.map((b) => ({ label: b.label, loSec: b.lo, hiSec: b.hi, count: 0 }));
  const empty: AgingStats = { buckets, oldest: [], openCount: 0, staleCount: 0, maxAgeSec: 0 };
  if (nowMs <= 0) return empty;

  const nowSec = nowMs / 1000;
  const open: AgingTask[] = [];
  let openCount = 0;
  let staleCount = 0;
  let maxAgeSec = 0;

  for (const t of tasks) {
    if (TERMINAL.has((t.status || '').toLowerCase())) continue;
    openCount++;
    const anchor = t.started_at ?? t.created_at;
    if (!anchor) continue; // no usable timestamp — counted as open, but not aged
    const ageSec = Math.max(0, nowSec - anchor);
    if (ageSec >= STALE_SEC) staleCount++;
    if (ageSec > maxAgeSec) maxAgeSec = ageSec;
    // place into its age bucket
    for (const b of buckets) {
      if (ageSec >= b.loSec && (b.hiSec === null || ageSec < b.hiSec)) { b.count++; break; }
    }
    open.push({
      id: t.id,
      title: t.title,
      assignee: (t.assignee || '').trim(),
      status: (t.status || '').toLowerCase(),
      ageSec,
      neverStarted: !t.started_at,
    });
  }

  open.sort((a, b) => b.ageSec - a.ageSec);
  return { buckets, oldest: open.slice(0, topN), openCount, staleCount, maxAgeSec };
}
