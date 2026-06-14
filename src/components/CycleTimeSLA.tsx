// CycleTimeSLA — a cycle-time / lead-time distribution view for the War Room.
//
// Renders the SLA shape produced by computeCycleStats() (pure fold of the live
// Mc task queue): a p50/p90/p95 readout plus a human-bucketed duration
// histogram, over a selectable trailing window (12/24/48h) and a LEAD ↔ CYCLE
// metric toggle. Where FLOW (Run #11) counts completions and BURN (Run #15)
// tracks net WIP, this answers "how long does work take?". No bridge endpoint of
// its own — it consumes the already-polled task store.
import { useMemo, useState } from 'react';
import type { McTask } from '../lib/api';
import { computeCycleStats } from '../lib/cycleTime';
import { fmtDuration } from '../lib/agentMetrics';

const WINDOWS = [12, 24, 48] as const;
type Metric = 'lead' | 'cycle';

export default function CycleTimeSLA({ tasks, nowMs }: { tasks: McTask[]; nowMs: number }) {
  const [hours, setHours] = useState<(typeof WINDOWS)[number]>(24);
  // Lead time (created→done) is the customer-facing SLA; cycle time
  // (started→done) is the working-time SLA. Default to lead.
  const [metric, setMetric] = useState<Metric>('lead');
  const cs = useMemo(() => computeCycleStats(tasks, nowMs, hours), [tasks, nowMs, hours]);

  if (nowMs <= 0) {
    return <div className="text-[10px] font-mono text-[#545454] p-1">Initializing SLA window…</div>;
  }

  const stats = metric === 'lead' ? cs.lead : cs.cycle;
  const buckets = metric === 'lead' ? cs.leadBuckets : cs.cycleBuckets;
  const barMax = Math.max(1, ...buckets.map((b) => b.count));
  // The percentile that p50/p90/p95 land in — highlighted in the histogram so the
  // distribution shape and the headline numbers read as the same thing.
  const p50Bucket = bucketIndexOf(buckets, stats.p50);
  const p90Bucket = bucketIndexOf(buckets, stats.p90);

  return (
    <div className="h-full flex flex-col gap-2">
      {/* Summary row: percentiles + window/metric selectors */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="text-[#545454]">P50 <span className="text-emerald-400 tabular-nums">{stats.count ? fmtDuration(stats.p50) : '—'}</span></span>
          <span className="text-[#545454]">P90 <span className="text-amber-400 tabular-nums">{stats.count ? fmtDuration(stats.p90) : '—'}</span></span>
          <span className="hidden sm:inline text-[#545454]">P95 <span className="text-[#f64e6e] tabular-nums">{stats.count ? fmtDuration(stats.p95) : '—'}</span></span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMetric('lead')}
            title="Lead time: created → completed (total time in system)"
            className={`px-1.5 py-0.5 border text-[10px] tracking-[0.12em] ${metric === 'lead' ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#545454] hover:border-white/30'}`}
          >LEAD</button>
          <button
            onClick={() => setMetric('cycle')}
            title="Cycle time: started → completed (active working time)"
            className={`px-1.5 py-0.5 border text-[10px] tracking-[0.12em] ${metric === 'cycle' ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#545454] hover:border-white/30'}`}
          >CYCLE</button>
          <span className="w-px h-3 bg-white/10 mx-0.5" />
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setHours(w)}
              className={`px-1.5 py-0.5 border text-[10px] tracking-[0.12em] tabular-nums ${hours === w ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#545454] hover:border-white/30'}`}
            >{w}H</button>
          ))}
        </div>
      </div>

      {/* Duration histogram */}
      <div className="flex-1 min-h-0 flex flex-col">
        {stats.count === 0 ? (
          <div className="flex-1 min-h-0 flex items-center justify-center text-[10px] font-mono text-[#545454] text-center px-2">
            {cs.completedInWindow === 0
              ? `No tasks completed in the last ${hours}h.`
              : metric === 'cycle'
                ? `${cs.completedInWindow} completed, but none carry a start stamp for cycle time — try LEAD.`
                : `${cs.completedInWindow} completed, but none carry usable timestamps.`}
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 flex items-end gap-[3px]">
              {buckets.map((b, i) => {
                const h = (b.count / barMax) * 100;
                const isP = i === p50Bucket || i === p90Bucket;
                return (
                  <div
                    key={b.label}
                    className="flex-1 h-full flex items-end relative group"
                    title={`${b.label} — ${b.count} task${b.count === 1 ? '' : 's'}${i === p50Bucket ? ' · contains P50' : ''}${i === p90Bucket ? ' · contains P90' : ''}`}
                  >
                    <div
                      className="w-full relative transition-[height] duration-300"
                      style={{
                        height: `${h}%`,
                        minHeight: b.count > 0 ? 2 : 0,
                        background: isP ? '#f64e6e' : 'rgba(246,78,110,0.45)',
                        opacity: 0.85,
                      }}
                    />
                    <div className="absolute -top-3 inset-x-0 text-center text-[10px] font-mono text-white opacity-0 group-hover:opacity-100 transition-opacity tabular-nums pointer-events-none">
                      {b.count}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* x-axis duration-bucket labels */}
            <div className="flex gap-[3px] mt-1 shrink-0">
              {buckets.map((b) => (
                <div key={b.label} className="flex-1 text-center text-[10px] font-mono text-[#363636] overflow-hidden whitespace-nowrap">
                  {b.label}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px] font-mono text-[#545454] shrink-0">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-[#f64e6e]" /> {metric === 'lead' ? 'LEAD created→done' : 'CYCLE started→done'}</span>
        <span className="tabular-nums">n={stats.count}</span>
        {stats.count > 0 && <span className="hidden sm:inline tabular-nums">mean {fmtDuration(stats.mean)} · max {fmtDuration(stats.max)}</span>}
        <span className="ml-auto text-[#363636] tabular-nums">{cs.completedInWindow} done · {hours}h</span>
      </div>
    </div>
  );
}

// Index of the histogram bucket a duration falls into (for percentile highlight).
function bucketIndexOf(buckets: { loSec: number; hiSec: number | null }[], sec: number): number {
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    if (sec >= b.loSec && (b.hiSec === null || sec < b.hiSec)) return i;
  }
  return -1;
}
