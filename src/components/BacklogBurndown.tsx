// BacklogBurndown — a queue-health (burn-up) view for the War Room.
//
// Plots the cumulative arrivals (created) vs completions (done) produced by
// computeBacklogTrend() over a trailing window. The widening or closing gap
// between the two lines is the net backlog the window added or burned down —
// answering "is the queue keeping up?" rather than Run #11's "how many finished
// this hour". Headline stats: live open WIP, net Δ, and the trend direction.
// No bridge endpoint of its own — it consumes the already-polled task store.
import { useMemo, useState } from 'react';
import type { HermesTask } from '../lib/api';
import { computeBacklogTrend } from '../lib/backlogTrend';

const WINDOWS = [12, 24, 48] as const;
const W = 300; // SVG user-space width (stretched to 100% via preserveAspectRatio)
const H = 100; // SVG user-space height
const PAD_TOP = 4;

export default function BacklogBurndown({ tasks, nowMs }: { tasks: HermesTask[]; nowMs: number }) {
  const [hours, setHours] = useState<(typeof WINDOWS)[number]>(24);
  const bt = useMemo(() => computeBacklogTrend(tasks, nowMs, hours), [tasks, nowMs, hours]);

  const pts = bt.points;
  const scaleMax = Math.max(1, ...pts.map((p) => Math.max(p.cumCreated, p.cumDone)));
  const tickEvery = hours <= 12 ? 2 : hours <= 24 ? 4 : 8;

  // Map a bucket index + cumulative value into SVG user-space coordinates.
  const x = (i: number) => (pts.length <= 1 ? 0 : (i / (pts.length - 1)) * W);
  const y = (v: number) => H - (v / scaleMax) * (H - PAD_TOP);

  const { createdLine, doneLine, band } = useMemo(() => {
    if (pts.length === 0) return { createdLine: '', doneLine: '', band: '' };
    const cPts = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.cumCreated).toFixed(1)}`);
    const dPts = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.cumDone).toFixed(1)}`);
    // Band: created line forward, done line back — the area between the two series.
    const bandPath = `M ${cPts.join(' L ')} L ${[...dPts].reverse().join(' L ')} Z`;
    return { createdLine: cPts.join(' '), doneLine: dPts.join(' '), band: bandPath };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, scaleMax]);

  if (nowMs <= 0) {
    return <div className="text-[10px] font-mono text-[#545454] p-1">Initializing backlog window…</div>;
  }

  // Net Δ > 0 means the queue grew (more created than completed) → coral warning.
  const netTone = bt.netDelta > 0 ? 'text-[#f64e6e]' : bt.netDelta < 0 ? 'text-emerald-400' : 'text-[#b8b8b8]';
  const netSign = bt.netDelta > 0 ? '+' : '';
  const trendGlyph = bt.trend === 'growing' ? '▲ GROWING' : bt.trend === 'shrinking' ? '▼ BURNING DOWN' : '■ FLAT';
  // The shaded band reads coral when arrivals lead, emerald when completions lead.
  const bandFill = bt.netDelta > 0 ? '#f64e6e' : bt.netDelta < 0 ? '#10b981' : '#b8b8b8';

  return (
    <div className="h-full flex flex-col gap-2">
      {/* Summary row + window selector */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="text-[#545454]">OPEN <span className="text-white tabular-nums">{bt.openBacklog}</span></span>
          <span className="text-[#545454]">NET <span className={`tabular-nums ${netTone}`}>{netSign}{bt.netDelta}</span></span>
          <span className={`hidden sm:inline tabular-nums ${netTone}`}>{trendGlyph}</span>
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

      {/* Cumulative chart */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 relative">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full block" style={{ overflow: 'visible' }}>
            {/* horizontal gridlines at 0/50/100% */}
            {[0, 0.5, 1].map((g) => (
              <line key={g} x1={0} x2={W} y1={H - g * (H - PAD_TOP)} y2={H - g * (H - PAD_TOP)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {/* net-backlog band between the two cumulative series */}
            {band && <path d={band} fill={bandFill} opacity={0.12} />}
            {/* cumulative created (demand) */}
            {createdLine && <polyline points={createdLine} fill="none" stroke="#38bdf8" strokeWidth={1.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
            {/* cumulative done (throughput) */}
            {doneLine && <polyline points={doneLine} fill="none" stroke="#10b981" strokeWidth={1.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
          </svg>
          {/* per-bucket hover overlay (SVG hit-testing is awkward under non-uniform scale) */}
          <div className="absolute inset-0 flex">
            {pts.map((p) => (
              <div
                key={p.startMs}
                className="flex-1 h-full hover:bg-white/[0.03]"
                title={`${p.label}:00 — created ${p.cumCreated} · done ${p.cumDone} · net ${p.net >= 0 ? '+' : ''}${p.net}${p.current ? ' (current hour)' : ''}`}
              />
            ))}
          </div>
        </div>
        {/* x-axis hour ticks */}
        <div className="flex mt-1 shrink-0">
          {pts.map((p, i) => (
            <div key={p.startMs} className="flex-1 text-center text-[10px] font-mono text-[#363636] tabular-nums overflow-hidden">
              {i % tickEvery === 0 ? p.label : ''}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px] font-mono text-[#545454] shrink-0">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-0.5 bg-sky-400" /> CREATED Σ {bt.totalCreated}</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-0.5 bg-emerald-400" /> DONE Σ {bt.totalDone}</span>
        <span className="ml-auto text-[#363636]">cumulative · UTC hours</span>
      </div>
    </div>
  );
}
