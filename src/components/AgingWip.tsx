// AgingWip — an aging / stale-WIP heatmap for the War Room.
//
// The dual of the cycle-time SLA view (Run #16): instead of how long *finished*
// work took, it shows how long *open* work has been waiting. Renders the
// distribution from computeAgingWip() — a count-per-age-band histogram (hotter
// = older) plus an actionable "oldest open" list whose rows jump straight to the
// task in Operations (reusing the ⌘F focus plumbing). No bridge endpoint of its
// own; it consumes the already-polled task store.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { McTask } from '../lib/api';
import { computeAgingWip, STALE_SEC, type AgingBucket } from '../lib/agingWip';
import { fmtDuration } from '../lib/agentMetrics';
import { useTaskFocusStore } from '../stores/useTaskFocusStore';

const STATUS_DOT: Record<string, string> = {
  running: '#f59e0b',
  ready: '#38bdf8',
  pending: '#38bdf8',
  queued: '#38bdf8',
  todo: '#38bdf8',
  blocked: '#ef4444',
};

// Hotter bars = older work. Anchored on the bucket's lower bound so the ramp
// tracks the duration grammar, not the bucket index: <1h cool, 1–24h warm,
// ≥1d hot.
function bucketColor(loSec: number): string {
  if (loSec < 3600) return '#38bdf8'; // < 1h — fresh
  if (loSec < STALE_SEC) return '#f59e0b'; // 1–24h — warming
  return '#ef4444'; // ≥ 1d — stale
}

export default function AgingWip({ tasks, nowMs }: { tasks: McTask[]; nowMs: number }) {
  const navigate = useNavigate();
  const focus = useTaskFocusStore((s) => s.focus);
  const ag = useMemo(() => computeAgingWip(tasks, nowMs), [tasks, nowMs]);

  if (nowMs <= 0) {
    return <div className="text-[10px] font-mono text-[#545454] p-1">Initializing aging window…</div>;
  }

  if (ag.openCount === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[10px] font-mono text-[#545454] text-center px-2">
        No open tasks — the queue is clear.
      </div>
    );
  }

  const barMax = Math.max(1, ...ag.buckets.map((b) => b.count));
  const agedCount = ag.buckets.reduce((s, b) => s + b.count, 0); // open tasks with a usable timestamp

  const openTask = (id: string) => { focus(id); navigate('/operations'); };

  return (
    <div className="h-full flex flex-col gap-2">
      {/* Headline: open / stale / oldest */}
      <div className="flex items-center gap-3 text-[10px] font-mono shrink-0">
        <span className="text-[#545454]">OPEN <span className="text-white tabular-nums">{ag.openCount}</span></span>
        <span className="text-[#545454]">STALE <span className={`tabular-nums ${ag.staleCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{ag.staleCount}</span><span className="text-[#363636]"> ≥24h</span></span>
        <span className="hidden sm:inline text-[#545454]">OLDEST <span className="text-amber-400 tabular-nums">{ag.maxAgeSec > 0 ? fmtDuration(ag.maxAgeSec) : '—'}</span></span>
      </div>

      {/* Age histogram (hotter = older) */}
      <div className="shrink-0 flex flex-col">
        <div className="h-12 flex items-end gap-[3px]">
          {ag.buckets.map((b: AgingBucket) => {
            const h = (b.count / barMax) * 100;
            return (
              <div
                key={b.label}
                className="flex-1 h-full flex items-end relative group"
                title={`${b.label} — ${b.count} open task${b.count === 1 ? '' : 's'}`}
              >
                <div
                  className="w-full transition-[height] duration-300"
                  style={{ height: `${h}%`, minHeight: b.count > 0 ? 2 : 0, background: bucketColor(b.loSec), opacity: 0.8 }}
                />
                <div className="absolute -top-3 inset-x-0 text-center text-[10px] font-mono text-white opacity-0 group-hover:opacity-100 transition-opacity tabular-nums pointer-events-none">
                  {b.count}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-[3px] mt-1">
          {ag.buckets.map((b) => (
            <div key={b.label} className="flex-1 text-center text-[10px] font-mono text-[#363636] overflow-hidden whitespace-nowrap">
              {b.label}
            </div>
          ))}
        </div>
      </div>

      {/* Oldest open offenders — click to open in Operations */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="text-[10px] font-mono text-[#545454] tracking-[0.15em] mb-1 shrink-0">OLDEST OPEN · click to open</div>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-0.5">
          {ag.oldest.map((t) => {
            const stale = t.ageSec >= STALE_SEC;
            return (
              <button
                key={t.id}
                onClick={() => openTask(t.id)}
                title={`${t.title} — ${t.status}${t.assignee ? ` · ${t.assignee}` : ''}${t.neverStarted ? ' · never started' : ''}`}
                className="w-full flex items-center gap-2 px-1.5 py-1 border-b border-white/[0.04] hover:bg-white/[0.03] text-left"
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_DOT[t.status] || '#b8b8b8' }} />
                <span className="text-[10px] font-mono text-[#b8b8b8] truncate min-w-0 flex-1">{t.title}</span>
                {t.assignee && <span className="hidden md:inline text-[10px] font-mono text-[#545454] truncate max-w-[90px] shrink-0">{t.assignee}</span>}
                <span className={`text-[10px] font-mono tabular-nums shrink-0 ${stale ? 'text-red-400' : 'text-amber-400'}`}>{fmtDuration(t.ageSec)}</span>
              </button>
            );
          })}
          {ag.oldest.length === 0 && (
            <div className="text-[10px] font-mono text-[#545454] py-2">{agedCount === 0 ? `${ag.openCount} open, but none carry a usable timestamp to age.` : 'No aged tasks.'}</div>
          )}
        </div>
      </div>
    </div>
  );
}
