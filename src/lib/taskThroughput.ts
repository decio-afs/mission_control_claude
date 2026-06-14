// taskThroughput — pure, client-side completion-velocity aggregation.
//
// Mission Control already polls the full kanban task list into useTaskStore
// (`mcTasks`). Each task carries `status` and epoch-second timestamps
// (`created_at` / `started_at` / `completed_at`). Bucketing completed tasks by
// `completed_at` into fixed hourly windows yields a temporal throughput view —
// "how many tasks finished each hour" — that complements the War Room agent
// leaderboard (which is a per-agent total, with no time axis). No new bridge
// endpoint: this is a pure fold over the already-polled queue.
import type { McTask } from './api';

const DONE = new Set(['done', 'complete', 'completed']);
const HOUR_SEC = 3600;

export interface ThroughputBucket {
  /** epoch-ms of the start of this hour bucket. */
  startMs: number;
  /** tasks that completed within this hour. */
  done: number;
  /** tasks created within this hour (context series — demand vs. throughput). */
  created: number;
  /** short hour label, e.g. "14h" (UTC, matching the topbar ZULU clock). */
  label: string;
  /** true for the bucket containing `nowMs` (the in-progress, partial hour). */
  current: boolean;
}

export interface Throughput {
  buckets: ThroughputBucket[];
  /** total completed within the window. */
  totalDone: number;
  /** total created within the window. */
  totalCreated: number;
  /** busiest single hour (completions). */
  peak: number;
  /** label of the peak hour, or null when the window is empty. */
  peakLabel: string | null;
  /** mean completions per hour across the window. */
  avgPerHour: number;
  /** the window length actually charted, in hours. */
  hours: number;
}

/**
 * Bucket the task list into `hours` trailing one-hour windows ending at `nowMs`.
 * `nowMs` is passed in (never read via Date.now) so callers stay render-pure;
 * supply 0 and you get an empty, inert result (no window to bucket into).
 */
export function computeThroughput(tasks: McTask[], nowMs = 0, hours = 12): Throughput {
  const empty: Throughput = { buckets: [], totalDone: 0, totalCreated: 0, peak: 0, peakLabel: null, avgPerHour: 0, hours };
  if (nowMs <= 0 || hours <= 0) return empty;

  const nowSec = nowMs / 1000;
  // Align the window to whole UTC hours so bucket boundaries are stable between
  // polls (a task doesn't drift between buckets just because `nowMs` advanced).
  const currentHourStart = Math.floor(nowSec / HOUR_SEC) * HOUR_SEC;
  const windowStart = currentHourStart - (hours - 1) * HOUR_SEC;

  const buckets: ThroughputBucket[] = [];
  for (let i = 0; i < hours; i++) {
    const startSec = windowStart + i * HOUR_SEC;
    buckets.push({
      startMs: startSec * 1000,
      done: 0,
      created: 0,
      label: `${new Date(startSec * 1000).getUTCHours().toString().padStart(2, '0')}h`,
      current: startSec === currentHourStart,
    });
  }

  const bucketOf = (sec: number): ThroughputBucket | null => {
    if (sec < windowStart || sec >= currentHourStart + HOUR_SEC) return null;
    const idx = Math.floor((sec - windowStart) / HOUR_SEC);
    return buckets[idx] ?? null;
  };

  let totalDone = 0;
  let totalCreated = 0;
  for (const t of tasks) {
    if (t.created_at) {
      const cb = bucketOf(t.created_at);
      if (cb) { cb.created++; totalCreated++; }
    }
    if (DONE.has((t.status || '').toLowerCase()) && t.completed_at) {
      const db = bucketOf(t.completed_at);
      if (db) { db.done++; totalDone++; }
    }
  }

  let peak = 0;
  let peakLabel: string | null = null;
  for (const b of buckets) {
    if (b.done > peak) { peak = b.done; peakLabel = b.label; }
  }

  return {
    buckets,
    totalDone,
    totalCreated,
    peak,
    peakLabel,
    avgPerHour: hours > 0 ? totalDone / hours : 0,
    hours,
  };
}
