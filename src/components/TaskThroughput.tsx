// TaskThroughput — a completions-per-hour histogram for the War Room.
//
// Renders the temporal throughput produced by computeThroughput() (pure fold of
// the live Hermes task queue, bucketed by `completed_at`): one bar per trailing
// hour, with a faint "created" demand overlay, a selectable window (12/24/48h),
// and a peak / total / avg summary. No bridge endpoint of its own — it consumes
// the already-polled task store, the same source as the agent leaderboard.
import { useMemo, useState } from 'react';
import type { HermesTask } from '../lib/api';
import { computeThroughput } from '../lib/taskThroughput';

const WINDOWS = [12, 24, 48] as const;

export default function TaskThroughput({ tasks, nowMs }: { tasks: HermesTask[]; nowMs: number }) {
  const [hours, setHours] = useState<(typeof WINDOWS)[number]>(12);
  const tp = useMemo(() => computeThroughput(tasks, nowMs, hours), [tasks, nowMs, hours]);

  // Scale bars to the busiest hour (completed or created) so both series read.
  const scaleMax = Math.max(1, tp.peak, ...tp.buckets.map((b) => b.created));
  // Label every Nth bucket so the x-axis stays legible as the window widens.
  const tickEvery = hours <= 12 ? 2 : hours <= 24 ? 4 : 8;

  if (nowMs <= 0) {
    return <div className="text-[10px] font-mono text-[#545454] p-1">Initializing throughput window…</div>;
  }

  return (
    <div className="h-full flex flex-col gap-2">
      {/* Summary row + window selector */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="text-[#545454]">DONE <span className="text-emerald-400 tabular-nums">{tp.totalDone}</span></span>
          <span className="text-[#545454]">PEAK <span className="text-[#f64e6e] tabular-nums">{tp.peak}</span>{tp.peakLabel && <span className="text-[#363636]">/{tp.peakLabel}</span>}</span>
          <span className="text-[#545454]">AVG <span className="text-white tabular-nums">{tp.avgPerHour.toFixed(1)}</span>/h</span>
        </div>
        <div className="flex items-center gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setHours(w)}
              className={`px-1.5 py-0.5 border text-[10px] tracking-[0.12em] tabular-nums ${hours === w ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#545454] hover:border-white/30'}`}
            >{w}H</button>
          ))}
        </div>
      </div>

      {/* Histogram */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 flex items-end gap-[3px]">
          {tp.buckets.map((b) => {
            const doneH = (b.done / scaleMax) * 100;
            const createdH = (b.created / scaleMax) * 100;
            return (
              <div
                key={b.startMs}
                className="flex-1 h-full flex items-end relative group"
                title={`${b.label}:00 — ${b.done} done · ${b.created} created${b.current ? ' (current hour)' : ''}`}
              >
                {/* faint "created" demand backdrop */}
                <div className="absolute inset-x-0 bottom-0 bg-sky-400/15" style={{ height: `${createdH}%` }} />
                {/* completed bar */}
                <div
                  className="w-full relative transition-[height] duration-300"
                  style={{
                    height: `${doneH}%`,
                    minHeight: b.done > 0 ? 2 : 0,
                    background: b.current ? 'repeating-linear-gradient(45deg,#f64e6e,#f64e6e 3px,#ff795e 3px,#ff795e 6px)' : '#f64e6e',
                    opacity: b.current ? 0.85 : 0.8,
                  }}
                />
                {/* hover count */}
                <div className="absolute -top-3 inset-x-0 text-center text-[10px] font-mono text-white opacity-0 group-hover:opacity-100 transition-opacity tabular-nums pointer-events-none">
                  {b.done}
                </div>
              </div>
            );
          })}
        </div>
        {/* x-axis hour ticks */}
        <div className="flex gap-[3px] mt-1 shrink-0">
          {tp.buckets.map((b, i) => (
            <div key={b.startMs} className="flex-1 text-center text-[10px] font-mono text-[#363636] tabular-nums overflow-hidden">
              {i % tickEvery === 0 ? b.label : ''}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px] font-mono text-[#545454] shrink-0">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-[#f64e6e]" /> COMPLETED</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-sky-400/30" /> CREATED</span>
        <span className="ml-auto text-[#363636]">{tp.totalCreated} created · UTC hours</span>
      </div>
    </div>
  );
}
