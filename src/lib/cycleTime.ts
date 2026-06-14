// cycleTime — pure, client-side cycle-time / lead-time SLA aggregation.
//
// Runs #11/#15 answered "how much work flows" (throughput) and "is the queue
// keeping up" (backlog burn-down). This answers a third, orthogonal question:
// *how long does work take*? It folds completed tasks (those with a completed_at
// inside the trailing window) into two duration distributions —
//   • lead time:  created_at → completed_at  (total time in the system)
//   • cycle time: started_at → completed_at  (active working time)
// — and reports p50/p90/p95 percentiles + min/max/mean plus a human-bucketed
// histogram, so an operator sees the SLA *shape*, not just a count. No bridge
// endpoint: a pure fold over the already-polled task store, the same source as
// the throughput histogram, backlog burn-down, and agent leaderboard.
import type { McTask } from './api';

const DONE = new Set(['done', 'complete', 'completed']);
const HOUR_SEC = 3600;

// Human-friendly, log-ish duration buckets (seconds). `hi` is the exclusive
// upper bound; the final bucket is open-ended (`hi: null`). Exported so the
// aging-WIP heatmap (which buckets *open* work's age into the same bands) reads
// from one grammar instead of duplicating the boundaries.
export const BUCKET_BOUNDS: Array<{ label: string; lo: number; hi: number | null }> = [
  { label: '<5m', lo: 0, hi: 5 * 60 },
  { label: '5–15m', lo: 5 * 60, hi: 15 * 60 },
  { label: '15–60m', lo: 15 * 60, hi: 60 * 60 },
  { label: '1–4h', lo: 60 * 60, hi: 4 * 3600 },
  { label: '4–12h', lo: 4 * 3600, hi: 12 * 3600 },
  { label: '12–24h', lo: 12 * 3600, hi: 24 * 3600 },
  { label: '1–3d', lo: 24 * 3600, hi: 3 * 86400 },
  { label: '>3d', lo: 3 * 86400, hi: null },
];

export interface DurationStats {
  /** samples with a valid (strictly positive) duration. */
  count: number;
  /** median duration, seconds. */
  p50: number;
  p90: number;
  p95: number;
  min: number;
  max: number;
  mean: number;
}

export interface DurationBucket {
  label: string;
  /** inclusive lower bound, seconds. */
  loSec: number;
  /** exclusive upper bound, seconds; null = open-ended. */
  hiSec: number | null;
  count: number;
}

export interface CycleStats {
  /** created_at → completed_at distribution (total time in system). */
  lead: DurationStats;
  /** started_at → completed_at distribution (active working time). */
  cycle: DurationStats;
  leadBuckets: DurationBucket[];
  cycleBuckets: DurationBucket[];
  /** done tasks whose completed_at fell inside the window (the sample base). */
  completedInWindow: number;
  /** the window length actually measured, in hours. */
  hours: number;
}

const EMPTY_STATS: DurationStats = { count: 0, p50: 0, p90: 0, p95: 0, min: 0, max: 0, mean: 0 };

// Linear-interpolation percentile (Excel PERCENTILE.INC / NumPy "linear"):
// rank = p·(n−1), interpolate between the bracketing sorted samples.
function percentile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const rank = p * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

function statsFrom(samples: number[]): DurationStats {
  const n = samples.length;
  if (n === 0) return { ...EMPTY_STATS };
  const sorted = [...samples].sort((a, b) => a - b);
  let sum = 0;
  for (const v of sorted) sum += v;
  return {
    count: n,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    min: sorted[0],
    max: sorted[n - 1],
    mean: sum / n,
  };
}

function bucketize(samples: number[]): DurationBucket[] {
  const buckets: DurationBucket[] = BUCKET_BOUNDS.map((b) => ({ label: b.label, loSec: b.lo, hiSec: b.hi, count: 0 }));
  for (const s of samples) {
    for (const b of buckets) {
      if (s >= b.loSec && (b.hiSec === null || s < b.hiSec)) { b.count++; break; }
    }
  }
  return buckets;
}

/**
 * Fold the task list into lead/cycle-time distributions over the trailing
 * `hours` window ending at `nowMs`. Selection is keyed on `completed_at` (a task
 * counts when it *finished* in-window), aligned to whole UTC hours so the sample
 * set is stable between polls — matching computeThroughput / computeBacklogTrend.
 * `nowMs` is passed in (never Date.now during render); supply 0 for an inert
 * result. Durations are clamped to strictly-positive (a stamp pair that is zero
 * or inverted — clock skew / missing start — is dropped from that distribution).
 */
export function computeCycleStats(tasks: McTask[], nowMs = 0, hours = 24): CycleStats {
  const empty: CycleStats = {
    lead: { ...EMPTY_STATS }, cycle: { ...EMPTY_STATS },
    leadBuckets: bucketize([]), cycleBuckets: bucketize([]),
    completedInWindow: 0, hours,
  };
  if (nowMs <= 0 || hours <= 0) return empty;

  const nowSec = nowMs / 1000;
  const currentHourStart = Math.floor(nowSec / HOUR_SEC) * HOUR_SEC;
  const windowStart = currentHourStart - (hours - 1) * HOUR_SEC;
  const windowEnd = currentHourStart + HOUR_SEC; // exclusive upper edge

  const leadSamples: number[] = [];
  const cycleSamples: number[] = [];
  let completedInWindow = 0;

  for (const t of tasks) {
    if (!DONE.has((t.status || '').toLowerCase())) continue;
    const done = t.completed_at;
    if (!done || done < windowStart || done >= windowEnd) continue;
    completedInWindow++;
    if (t.created_at && done > t.created_at) leadSamples.push(done - t.created_at);
    if (t.started_at && done > t.started_at) cycleSamples.push(done - t.started_at);
  }

  return {
    lead: statsFrom(leadSamples),
    cycle: statsFrom(cycleSamples),
    leadBuckets: bucketize(leadSamples),
    cycleBuckets: bucketize(cycleSamples),
    completedInWindow,
    hours,
  };
}
