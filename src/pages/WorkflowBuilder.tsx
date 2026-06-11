// Workflow Builder — live task dependency flow. Renders the real Hermes kanban
// (useTaskStore.hermesTasks) as a status-grouped column flow in the original
// node-graph visual style. TaskDependencyGraph stays drawer-scoped (it is a
// modal that needs a single root task); this is the whole-board view.
import { useEffect, useMemo } from 'react';
import { Panel, Label } from '../components/cyberpunk/ui';
import { useTaskStore } from '../stores/useTaskStore';
import type { HermesTask } from '../lib/api';

const accent = '#f64e6e';

const STATUS_COLOR: Record<string, string> = {
  running: '#f59e0b',
  ready: '#38bdf8',
  blocked: '#ef4444',
  done: '#10b981',
};
const colorOf = (s: string) => STATUS_COLOR[s] ?? '#8a8a8a';

// canonical pipeline order; unknown statuses are appended after these
const STATUS_ORDER = ['triage', 'pending', 'scheduled', 'ready', 'running', 'review', 'blocked', 'done', 'failed'];

// layout geometry (svg units) — mirrors the original demo graph
const NODE_W = 160;
const NODE_H = 48;
const COL_GAP = 56;
const ROW_GAP = 14;
const HEADER_H = 34;
const MAX_PER_COL = 8;

interface Column { status: string; tasks: HermesTask[]; overflow: number }

export default function WorkflowBuilder() {
  const hermesTasks = useTaskStore((s) => s.hermesTasks);
  const isLoading = useTaskStore((s) => s.isLoading);
  const error = useTaskStore((s) => s.error);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);

  useEffect(() => { void fetchTasks(); }, [fetchTasks]);

  const columns = useMemo<Column[]>(() => {
    const by = new Map<string, HermesTask[]>();
    hermesTasks.forEach((t) => {
      const s = t.status || 'unknown';
      if (!by.has(s)) by.set(s, []);
      by.get(s)!.push(t);
    });
    const statuses = [...by.keys()].sort((a, b) => {
      const ia = STATUS_ORDER.indexOf(a), ib = STATUS_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return statuses.map((status) => {
      const all = by.get(status)!;
      return { status, tasks: all.slice(0, MAX_PER_COL), overflow: Math.max(0, all.length - MAX_PER_COL) };
    });
  }, [hermesTasks]);

  const maxRows = columns.reduce((m, c) => Math.max(m, c.tasks.length + (c.overflow ? 1 : 0)), 1);
  const width = Math.max(1, columns.length) * (NODE_W + COL_GAP) - COL_GAP + 8;
  const height = HEADER_H + maxRows * (NODE_H + ROW_GAP) + 8;

  const assignees = useMemo(() => {
    const m = new Map<string, number>();
    hermesTasks.forEach((t) => {
      const a = t.assignee || 'unassigned';
      m.set(a, (m.get(a) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [hermesTasks]);

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-2 p-2 relative">
      <Panel label="TASK FLOW · LIVE KANBAN" right={`${hermesTasks.length} tasks · ${columns.length} stages`}>
        <div className="h-full relative overflow-auto bg-[#030306] min-h-[340px]"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
          {isLoading && hermesTasks.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-[11px] font-mono text-[#545454]">
              loading kanban…
            </div>
          )}
          {!isLoading && error && hermesTasks.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-[11px] font-mono text-red-400">
              bridge error · {error}
            </div>
          )}
          {!isLoading && !error && hermesTasks.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[11px] font-mono text-[#545454]">
              <span className="text-[13px] opacity-40">⊘</span>
              <span>no tasks on the board yet</span>
              <span className="text-[10px] text-[#363636]">create one from the Operations kanban to see it flow here</span>
            </div>
          )}
          {hermesTasks.length > 0 && (
            <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block">
              {/* stage→stage flow edges with the original animated pulse */}
              {columns.slice(0, -1).map((col, i) => {
                const x1 = i * (NODE_W + COL_GAP) + NODE_W;
                const x2 = (i + 1) * (NODE_W + COL_GAP);
                const y = HEADER_H / 2 + 4;
                const mid = (x1 + x2) / 2;
                const d = `M ${x1} ${y} C ${mid} ${y}, ${mid} ${y}, ${x2} ${y}`;
                return (
                  <g key={`e-${col.status}`}>
                    <path d={d} stroke="rgba(255,255,255,0.15)" strokeWidth="1" fill="none" />
                    <circle r="2" fill={accent}>
                      <animateMotion dur={`${2 + (i % 3)}s`} repeatCount="indefinite" path={d} />
                    </circle>
                  </g>
                );
              })}

              {columns.map((col, ci) => {
                const cx = ci * (NODE_W + COL_GAP);
                const c = colorOf(col.status);
                return (
                  <g key={col.status} transform={`translate(${cx}, 0)`}>
                    {/* stage header */}
                    <text x="0" y="12" fontFamily="monospace" fontSize="10" fill={c} fontWeight="700" letterSpacing="2">
                      {col.status.toUpperCase()}
                    </text>
                    <text x={NODE_W} y="12" fontFamily="monospace" fontSize="10" fill="#545454" textAnchor="end">
                      {col.tasks.length + col.overflow}
                    </text>
                    <rect y="18" width={NODE_W} height="2" fill={c} opacity="0.6" />

                    {/* task nodes */}
                    {col.tasks.map((t, ri) => {
                      const y = HEADER_H + ri * (NODE_H + ROW_GAP);
                      const title = t.title.length > 22 ? `${t.title.slice(0, 21)}…` : t.title;
                      const sub = (t.assignee || 'unassigned').toUpperCase();
                      return (
                        <g key={t.id} transform={`translate(0, ${y})`}>
                          <rect width={NODE_W} height={NODE_H} fill="#0a0a0a" stroke={c} strokeWidth="1" />
                          <rect width={NODE_W} height="2" fill={c} />
                          <rect width="3" height={NODE_H} fill={c} opacity="0.5" />
                          <title>{`${t.id} · ${t.title} · ${sub}`}</title>
                          <text x="8" y="18" fontFamily="monospace" fontSize="10" fill="#fff" fontWeight="700">{title}</text>
                          <text x="8" y="34" fontFamily="monospace" fontSize="10" fill="#b8b8b8">
                            {sub.length > 20 ? `${sub.slice(0, 19)}…` : sub}
                          </text>
                          {col.status === 'running' && (
                            <circle cx={NODE_W - 8} cy="8" r="2" fill={c}>
                              <animate attributeName="opacity" values="0.3;1;0.3" dur="1.4s" repeatCount="indefinite" />
                            </circle>
                          )}
                        </g>
                      );
                    })}
                    {col.overflow > 0 && (
                      <text x="8" y={HEADER_H + col.tasks.length * (NODE_H + ROW_GAP) + 14}
                        fontFamily="monospace" fontSize="10" fill="#545454">
                        + {col.overflow} more…
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </Panel>

      <Panel label="BOARD TELEMETRY">
        <div className="flex flex-col gap-1 overflow-auto h-full">
          <Label className="text-[#545454] mb-1">STAGES</Label>
          {columns.length === 0 && <div className="text-[10px] font-mono text-[#545454]">no stages yet</div>}
          {columns.map((col) => (
            <div key={col.status} className="px-2 py-1.5 border border-white/8 text-[10px] font-mono flex justify-between items-center">
              <span className="flex items-center gap-1.5 text-[#b8b8b8]">
                <span className="w-2 h-2 inline-block" style={{ background: colorOf(col.status) }} />
                {col.status.toUpperCase()}
              </span>
              <span className="text-white tabular-nums">{col.tasks.length + col.overflow}</span>
            </div>
          ))}
          <Label className="text-[#545454] mt-3 mb-1">ASSIGNEE LOAD</Label>
          {assignees.length === 0 && <div className="text-[10px] font-mono text-[#545454]">no assignees yet</div>}
          {assignees.map(([name, n]) => (
            <div key={name} className="px-2 py-1.5 border border-white/8 text-[10px] font-mono flex justify-between items-center text-[#b8b8b8]">
              <span className="truncate">◈ {name}</span>
              <span className="text-white tabular-nums shrink-0">{n}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
