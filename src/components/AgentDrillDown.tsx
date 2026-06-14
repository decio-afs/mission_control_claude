import { useEffect, useMemo } from 'react';
import { useAgentDrilldownStore } from '../stores/useAgentDrilldownStore';
import { useGhostStore } from '../stores/useGhostStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useActivityStore } from '../stores/useActivityStore';
import { Label, Pill } from './cyberpunk/ui';

const SQUAD_COLORS: Record<string, string> = {
  CORE: '#f64e6e', SEC: '#ef4444', INTEL: '#ff795e', INFRA: '#10b981', CONT: '#f59e0b', DEV: '#38bdf8',
};

function statusTone(status?: string): 'good' | 'warn' | 'neutral' | 'bad' | 'info' {
  if (status === 'active' || status === 'online' || status === 'done' || status === 'completed') return 'good';
  if (status === 'running') return 'warn';
  if (status === 'idle' || status === 'ready' || status === 'pending') return 'info';
  if (status === 'offline' || status === 'failed' || status === 'blocked') return 'bad';
  return 'neutral';
}

function ago(ts: number): string {
  // Mc activity timestamps are unix seconds.
  const ms = ts > 1e12 ? ts : ts * 1000;
  const diff = Date.now() - ms;
  if (diff < 0 || !Number.isFinite(diff)) return '—';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Agent Drill-Down — a right-side slide-over that aggregates everything Mc
 * knows about a single agent: live status / queue, its assigned tasks (from
 * /api/mc/tasks) and its recent activity rows (from /api/mc/activity).
 * Opened from any roster surface via useAgentDrilldownStore.open(name). Mounted
 * once globally in Layout.tsx, so it overlays whatever route is active.
 */
export default function AgentDrillDown() {
  const { agentName, close } = useAgentDrilldownStore();
  const { nodes } = useGhostStore();
  const { mcTasks } = useTaskStore();
  const { activities, fetchActivities } = useActivityStore();

  // Pull fresh activity when the panel opens; close on Escape.
  useEffect(() => {
    if (!agentName) return;
    void fetchActivities();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agentName, fetchActivities, close]);

  const node = useMemo(
    () => nodes.find((n) => n.name.toLowerCase() === (agentName || '').toLowerCase()),
    [nodes, agentName],
  );

  const agentTasks = useMemo(() => {
    if (!agentName) return [];
    const q = agentName.toLowerCase();
    return mcTasks
      .filter((t) => (t.assignee || '').toLowerCase() === q)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }, [mcTasks, agentName]);

  const agentActivity = useMemo(() => {
    if (!agentName) return [];
    const q = agentName.toLowerCase();
    return activities
      .filter((a) => (a.agent || '').toLowerCase() === q)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 40);
  }, [activities, agentName]);

  if (!agentName) return null;

  const squad = node?.squad || 'DEV';
  const color = SQUAD_COLORS[squad] || SQUAD_COLORS.DEV;
  const online = !!node && (node.status === 'active' || node.status === 'online');

  const taskCounts = agentTasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-[6000] flex justify-end bg-black/60 backdrop-blur-sm" onClick={close}>
      <div
        className="h-full w-full max-w-[460px] bg-[#0A0A0A] border-l border-white/10 flex flex-col shadow-2xl"
        style={{ animation: 'slideIn 180ms ease-out' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 h-[44px] flex items-center justify-between border-b border-white/10 bg-[#080808] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 shrink-0" style={{ background: online ? color : '#1a1a1a', boxShadow: online ? `0 0 8px ${color}` : 'none' }} />
            <span className="text-[13px] font-bold tracking-[0.12em] uppercase text-white truncate">{agentName}</span>
          </div>
          <button onClick={close} className="text-[#545454] hover:text-white text-[13px] px-1" title="Close (Esc)">✕</button>
        </div>

        <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
          {/* Status strip */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { k: 'STATUS', v: (node?.status || 'unknown').toUpperCase(), tone: statusTone(node?.status) },
              { k: 'TYPE', v: (node?.type || '—').toUpperCase(), tone: 'neutral' as const },
              { k: 'RUNNING', v: node?.tasks_running ?? 0, tone: 'warn' as const },
              { k: 'QUEUE', v: node?.queue_depth ?? 0, tone: 'info' as const },
            ].map((s) => (
              <div key={s.k} className="border border-white/[0.08] bg-[#080808] p-2 flex flex-col gap-1">
                <Label className="text-[#545454]">{s.k}</Label>
                <span className={`text-[13px] font-mono font-bold tabular-nums ${
                  s.tone === 'good' ? 'text-emerald-400' : s.tone === 'warn' ? 'text-amber-400'
                  : s.tone === 'info' ? 'text-sky-400' : s.tone === 'bad' ? 'text-red-400' : 'text-white'
                }`}>{s.v}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone="brand">{squad}</Pill>
            {node?.model && <Pill tone="info">{String(node.model).toUpperCase()}</Pill>}
            <span className="text-[10px] font-mono text-[#545454]">{agentTasks.length} task{agentTasks.length !== 1 ? 's' : ''} · {agentActivity.length} event{agentActivity.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Topology hint — the clicked agent isn't in the live mesh right now
              (e.g. opened from a stale palette/search entry); status strip above
              falls back to UNKNOWN, so explain why rather than look broken. */}
          {!node && (
            <div className="flex items-center gap-2 border border-amber-400/20 bg-amber-400/[0.04] px-2 py-1.5">
              <span className="text-amber-400 text-[11px] shrink-0">⚠</span>
              <span className="text-[10px] font-mono text-[#b8b8b8] leading-snug">
                Agent not in the current topology — showing its tasks &amp; activity only. Live status, queue and squad are unavailable.
              </span>
            </div>
          )}

          {/* Assigned tasks */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-[#b8b8b8]">ASSIGNED TASKS</Label>
              <div className="flex gap-1.5">
                {Object.entries(taskCounts).map(([st, n]) => (
                  <span key={st} className="text-[10px] font-mono text-[#545454]">{st} {n}</span>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {agentTasks.map((t) => (
                <div key={t.id} className="border border-white/[0.06] bg-[#080808] px-2 py-1.5 flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono text-[#545454] shrink-0">{t.id}</span>
                    <Pill tone={statusTone(t.status)}>{t.status.toUpperCase()}</Pill>
                  </div>
                  <div className="text-[11px] text-white leading-snug break-words min-w-0">{t.title}</div>
                  <div className="text-[10px] font-mono text-[#545454]">
                    priority {t.priority}
                    {t.created_at ? ` · created ${ago(t.created_at)}` : ''}
                  </div>
                </div>
              ))}
              {agentTasks.length === 0 && (
                <div className="text-[10px] font-mono text-[#545454] py-2">No tasks assigned to this agent.</div>
              )}
            </div>
          </div>

          {/* Recent activity */}
          <div className="flex flex-col gap-2">
            <Label className="text-[#b8b8b8]">RECENT ACTIVITY</Label>
            <div className="flex flex-col gap-0.5">
              {agentActivity.map((a) => (
                <div key={a.id} className="flex items-center gap-2 px-2 py-1 border-b border-white/[0.04] text-[10px] font-mono">
                  <span className="text-[#363636] shrink-0 w-14">{ago(a.timestamp)}</span>
                  <span className="text-[#b8b8b8] flex-1 truncate">{a.action}</span>
                  <Pill tone={statusTone(a.status)}>{(a.status || '—').toUpperCase()}</Pill>
                </div>
              ))}
              {agentActivity.length === 0 && (
                <div className="text-[10px] font-mono text-[#545454] py-2">No recent activity for this agent.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
