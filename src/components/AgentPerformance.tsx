// AgentPerformance — a per-agent operational leaderboard for the War Room.
//
// Renders the analytics produced by computeAgentMetrics() (pure aggregation of
// the live Mc task queue): throughput (done), in-flight load, failure count,
// success rate, average task duration and 24h completions — ranked best-first.
// No bridge endpoint of its own; it consumes the already-polled task store.
// Column headers are click-to-sort; the default (null) preserves the upstream
// composite rank (done → success → activity) from computeAgentMetrics.
import { useMemo, useState } from 'react';
import type { AgentMetric } from '../lib/agentMetrics';
import { fmtDuration } from '../lib/agentMetrics';

function rateTone(rate: number | null): string {
  if (rate == null) return 'text-[#545454]';
  if (rate >= 0.85) return 'text-emerald-400';
  if (rate >= 0.6) return 'text-amber-400';
  return 'text-red-400';
}

// Sortable columns. `agent` sorts alphabetically; the rest are numeric metrics.
type SortKey = 'agent' | 'done' | 'running' | 'failed' | 'successRate' | 'avgDurationSec' | 'last24h';

export default function AgentPerformance({ metrics }: { metrics: AgentMetric[] }) {
  // null sortKey = keep computeAgentMetrics' composite ranking (default view).
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  // Click a header: first click sorts that column (desc for metrics, asc for the
  // agent name); clicking the active column again flips direction.
  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setDir(key === 'agent' ? 'asc' : 'desc');
    }
  };

  const rows = useMemo(() => {
    if (!sortKey) return metrics; // default composite rank, untouched
    const sign = dir === 'asc' ? 1 : -1;
    const copy = [...metrics];
    copy.sort((a, b) => {
      if (sortKey === 'agent') return sign * a.agent.localeCompare(b.agent);
      const av = a[sortKey];
      const bv = b[sortKey];
      // null metrics (no resolved tasks / no duration) always sink to the bottom.
      if (av == null && bv == null) return a.agent.localeCompare(b.agent);
      if (av == null) return 1;
      if (bv == null) return -1;
      return sign * (av - bv) || a.agent.localeCompare(b.agent);
    });
    return copy;
  }, [metrics, sortKey, dir]);

  if (metrics.length === 0) {
    return <div className="text-[10px] font-mono text-[#545454] p-1">No assigned tasks yet — performance accrues as agents claim and complete work.</div>;
  }

  // Scale the throughput bar to the busiest agent so the ranking reads at a glance.
  const maxDone = Math.max(1, ...metrics.map((m) => m.done));

  const arrow = (key: SortKey) => (sortKey === key ? (dir === 'desc' ? ' ▼' : ' ▲') : '');
  const thCls = (key: SortKey, extra = '') =>
    `font-normal tracking-[0.12em] uppercase py-1 cursor-pointer select-none hover:text-[#f64e6e] ${sortKey === key ? 'text-[#f64e6e]' : ''} ${extra}`;

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-[10px] font-mono border-collapse">
        <thead className="sticky top-0 bg-[#0A0A0A] z-10">
          <tr className="text-[#545454] text-left">
            <th className={thCls('agent', 'pr-2')} onClick={() => onSort('agent')}>Agent{arrow('agent')}</th>
            <th className={thCls('done', 'px-2 text-right')} onClick={() => onSort('done')}>Done{arrow('done')}</th>
            <th className={thCls('running', 'px-2 text-right hidden sm:table-cell')} onClick={() => onSort('running')}>Run{arrow('running')}</th>
            <th className={thCls('failed', 'px-2 text-right hidden sm:table-cell')} onClick={() => onSort('failed')}>Fail{arrow('failed')}</th>
            <th className={thCls('successRate', 'px-2 text-right')} onClick={() => onSort('successRate')}>Rate{arrow('successRate')}</th>
            <th className={thCls('avgDurationSec', 'px-2 text-right')} onClick={() => onSort('avgDurationSec')}>Avg{arrow('avgDurationSec')}</th>
            <th className={thCls('last24h', 'pl-2 text-right hidden md:table-cell')} onClick={() => onSort('last24h')}>24h{arrow('last24h')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.agent} className="border-t border-white/5 hover:bg-white/[0.02]">
              <td className="py-1 pr-2 max-w-0">
                <div className="text-[#b8b8b8] truncate" title={m.agent}>{m.agent}</div>
                <div className="h-1 mt-0.5 bg-[#080808] relative">
                  <div className="absolute inset-y-0 left-0 bg-[#f64e6e]/70" style={{ width: `${(m.done / maxDone) * 100}%` }} />
                </div>
              </td>
              <td className="py-1 px-2 text-right tabular-nums text-white">{m.done}</td>
              <td className="py-1 px-2 text-right tabular-nums text-amber-400 hidden sm:table-cell">{m.running}</td>
              <td className="py-1 px-2 text-right tabular-nums text-[#545454] hidden sm:table-cell">{m.failed}</td>
              <td className={`py-1 px-2 text-right tabular-nums ${rateTone(m.successRate)}`}>
                {m.successRate == null ? '—' : `${Math.round(m.successRate * 100)}%`}
              </td>
              <td className="py-1 px-2 text-right tabular-nums text-[#b8b8b8]">{fmtDuration(m.avgDurationSec)}</td>
              <td className="py-1 pl-2 text-right tabular-nums text-sky-400 hidden md:table-cell">{m.last24h || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
