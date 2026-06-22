import { useEffect, useMemo, useState } from 'react';
import { useSystemStore } from '../stores/useSystemStore';
import { useGhostStore } from '../stores/useGhostStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useActivityStore } from '../stores/useActivityStore';
import { getMcCron, type McCronJob } from '../lib/api';
import { Panel, Sparkline, Ring, LogTail } from '../components/cyberpunk/ui';
import AgentPerformance from '../components/AgentPerformance';
import TaskThroughput from '../components/TaskThroughput';
import BacklogBurndown from '../components/BacklogBurndown';
import CycleTimeSLA from '../components/CycleTimeSLA';
import AgingWip from '../components/AgingWip';
import { computeAgentMetrics } from '../lib/agentMetrics';

const STATUS_COLORS: Record<string, string> = {
  running: '#f59e0b',
  ready: '#38bdf8',
  blocked: '#ef4444',
  done: '#10b981',
  failed: '#ef4444',
  pending: '#b8b8b8',
  // Activity-feed display vocabulary: /api/mc/activity emits `created`/`complete`
  // (distinct from task statuses). Without these keys the signal feed (below)
  // greys out a completed-task signal instead of showing it green, and a new-task
  // signal loses its colour — `complete` mirrors `done`, `created` reads as
  // incoming/queued. (BUGHUNT CF-COLOR)
  complete: '#10b981',
  created: '#38bdf8',
};

// Render an epoch-SECONDS instant as LOCAL wall-clock HH:MM:SS — the same
// convention the Ghost Network Activity Stream / Chat use for these very same
// mc-activity events. (The feeds previously used `toISOString().slice(11,19)`,
// which prints UTC, so War Room showed the same events at a different time than
// Ghost Network — shifted by the operator's timezone offset — and threw a
// RangeError, crashing the whole panel, on any non-finite stamp. The topbar
// clock is intentionally UTC, but it is explicitly labelled ZULU; these
// unlabelled per-event rows are not.)
const hms = (sec: number): string => {
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export default function WarRoom() {
  const { vitals, latencyHistory, error: systemError } = useSystemStore();
  const { nodes, error: ghostError } = useGhostStore();
  const { tasks, summary, mcTasks, error: taskError } = useTaskStore();
  const { activities, startPolling, stopPolling } = useActivityStore();
  const [cron, setCron] = useState<McCronJob[]>([]);
  // Bottom feed toggles between the kanban task log and the live agent signal
  // feed (formerly the standalone Signal Intelligence tab, now consolidated here).
  const [feed, setFeed] = useState<'tasks' | 'signal'>('tasks');
  // AGENT LOAD panel toggles between current load (running·queue) and the
  // historical performance leaderboard (throughput / success rate / avg duration).
  const [agentView, setAgentView] = useState<'load' | 'perf'>('load');
  // TASK STATUS panel cycles: current status breakdown (bars) → throughput
  // histogram (completions/hour) → backlog burn-down (cumulative created vs done,
  // "is the queue keeping up?") → cycle/lead-time SLA distribution ("how long does
  // work take?") → aging WIP heatmap ("how long has open work been waiting?").
  const [taskView, setTaskView] = useState<'status' | 'flow' | 'burn' | 'sla' | 'aging'>('status');
  // `nowMs` drives the leaderboard's trailing-24h window; set in an effect (never
  // Date.now() during render) so the component stays render-pure for react-hooks.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    // Seed via a 0ms timeout (not a synchronous setState in the effect body, and
    // never Date.now() during render) so both react-hooks purity rules stay happy.
    const seed = setTimeout(() => setNowMs(Date.now()), 0);
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => { clearTimeout(seed); clearInterval(id); };
  }, []);

  // Status/topology/tasks are polled globally by Layout; here we only poll cron.
  useEffect(() => {
    const loadCron = () => getMcCron().then((d) => setCron(d.jobs || [])).catch(() => {});
    loadCron();
    const id = setInterval(loadCron, 8000);
    return () => clearInterval(id);
  }, []);

  // Poll the Mc agent-activity feed while War Room is mounted.
  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  const agents = nodes.filter((n) => n.type !== 'squad');
  const onlineAgents = agents.filter((n) => n.status === 'active' || n.status === 'online');
  const busyAgents = agents.filter((n) => (n.tasks_running ?? 0) > 0);
  const queueDepth = agents.reduce((s, n) => s + (n.queue_depth ?? 0), 0);
  const onlinePct = agents.length ? Math.round((onlineAgents.length / agents.length) * 100) : 0;

  const total = summary?.total ?? 0;
  const completePct = total ? Math.round(((summary?.completed ?? 0) / total) * 100) : 0;

  const statusBars = useMemo(() => {
    if (!summary) return [];
    return [
      // Backlog bar. mc_store's canonical backlog status is `todo`; `summarize()`
      // tallies it into `summary.pending` (incl. the legacy `pending` alias). This
      // bar was missing entirely, so the whole queued backlog (8/32 tasks on the
      // live board) was invisible in the status breakdown — the entire START of the
      // lifecycle dropped off the "watch everything" chart. (BUGHUNT vocabulary lens)
      { name: 'queued', v: summary.pending, c: STATUS_COLORS.pending },
      { name: 'running', v: summary.running, c: STATUS_COLORS.running },
      { name: 'ready', v: summary.ready, c: STATUS_COLORS.ready },
      { name: 'blocked', v: summary.blocked, c: STATUS_COLORS.blocked },
      { name: 'done', v: summary.completed, c: STATUS_COLORS.done },
      { name: 'failed', v: summary.failed, c: STATUS_COLORS.failed },
    ];
  }, [summary]);
  const barMax = Math.max(1, ...statusBars.map((b) => b.v));

  const topAgents = useMemo(
    () => [...agents].sort((a, b) =>
      ((b.tasks_running ?? 0) + (b.queue_depth ?? 0)) - ((a.tasks_running ?? 0) + (a.queue_depth ?? 0))
    ).slice(0, 8),
    [agents],
  );

  // Per-agent performance leaderboard — pure aggregation of the live task queue.
  const agentMetrics = useMemo(() => computeAgentMetrics(mcTasks, nowMs), [mcTasks, nowMs]);

  const log = useMemo(
    () => [...mcTasks]
      .sort((a, b) => (b.started_at ?? b.created_at) - (a.started_at ?? a.created_at))
      .slice(0, 14)
      .map((t) => ({
        t: hms(t.started_at ?? t.created_at),
        tag: (t.assignee || 'unassigned').slice(0, 12),
        color: STATUS_COLORS[t.status] || '#b8b8b8',
        msg: `[${t.status}] ${t.title}`,
      })),
    [mcTasks],
  );

  // Live agent-activity feed (consolidated from the old Signal Intelligence tab).
  // Mirror the backend's cap-priority partition (iter #58): a still-stuck
  // blocked/failed signal carries its OLD blocked/started timestamp, so a naive
  // newest-N slice can push it off the tail behind a burst of recent routine
  // events — silently re-dropping the very stuck rows the backend reserved cap
  // budget to keep, and hiding the "this task needs attention now" signal this
  // feed exists to surface. Reserve the 40-row budget for every stuck row first,
  // fill the rest with the most-recent others, then re-sort by time.
  const signalLog = useMemo(
    () => {
      const CAP = 40;
      const isStuck = (a: (typeof activities)[number]) => {
        const s = (a.status || '').toLowerCase();
        return s === 'blocked' || s === 'failed';
      };
      const sorted = [...activities].sort((a, b) => b.timestamp - a.timestamp);
      const critical = sorted.filter(isStuck);
      const rest = sorted.filter((a) => !isStuck(a));
      return [...critical.slice(0, CAP), ...rest.slice(0, Math.max(0, CAP - critical.length))]
        .sort((a, b) => b.timestamp - a.timestamp)
        .map((a) => ({
          t: hms(a.timestamp),
          tag: (a.agent || 'agent').slice(0, 12),
          color: STATUS_COLORS[(a.status || '').toLowerCase()] || '#b8b8b8',
          msg: a.action,
        }));
    },
    [activities],
  );

  return (
    <div className="h-full flex flex-col gap-2 p-2 overflow-auto">
      {/* Top row: gauges */}
      {(systemError || ghostError || taskError) && (
        <div className="shrink-0 px-2 py-1 border border-red-400/40 bg-[#050505]/80 text-red-400 font-mono text-[10px]">
          {systemError && <span className="mr-2">⚠ SYSTEM: {systemError}</span>}
          {ghostError && <span className="mr-2">⚠ AGENTS: {ghostError}</span>}
          {taskError && <span>⚠ TASKS: {taskError}</span>}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 shrink-0">
        <Panel label="LEGION ONLINE" className="min-h-[118px]">
          <div className="flex items-center gap-3 h-full">
            <Ring value={onlinePct} label="%" color="#10b981" size={64} />
            <div className="flex flex-col gap-0.5 text-[10px] font-mono">
              <div className="text-white">{onlineAgents.length} / {agents.length}</div>
              <div className="text-[#545454]">agents</div>
            </div>
          </div>
        </Panel>
        <Panel label="TASK PROGRESS" className="min-h-[118px]">
          <div className="flex items-center gap-3 h-full">
            <Ring value={completePct} label="%" color="#f64e6e" size={64} />
            <div className="text-[10px] font-mono text-[#545454]">{summary?.completed ?? 0} done<br/>{total} total</div>
          </div>
        </Panel>
        <Panel label="CLAUDE BRIDGE" className="min-h-[118px]">
          <div className="flex flex-col justify-between h-full">
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-mono font-bold tabular-nums ${vitals.mcOnline ? 'text-emerald-400' : 'text-red-400'}`}>{vitals.connectionLatencyMs}</span>
              <span className="text-[10px] text-[#545454]">ms</span>
            </div>
            <Sparkline data={latencyHistory.length > 1 ? latencyHistory : [0, 0]} color="#10b981" height={36} />
            <div className="text-[10px] font-mono text-[#545454] truncate">{vitals.mcVersion}</div>
          </div>
        </Panel>
        <Panel label="QUEUE DEPTH" className="min-h-[118px]">
          <div className="flex flex-col justify-between h-full">
            <div className="flex items-baseline gap-1"><span className="text-2xl font-mono font-bold text-white tabular-nums">{queueDepth}</span><span className="text-[10px] text-[#545454]">queued</span></div>
            <div className="text-[10px] font-mono text-amber-400">{summary?.running ?? 0} running</div>
            <div className="text-[10px] font-mono text-[#545454]">{summary?.blocked ?? 0} blocked</div>
          </div>
        </Panel>
        <Panel label="BUSY AGENTS" className="min-h-[118px]">
          <div className="flex flex-col gap-1 h-full justify-between">
            <div className="text-2xl font-mono font-bold text-white tabular-nums">{busyAgents.length}<span className="text-[#545454] text-sm">/{agents.length}</span></div>
            <div className="flex flex-wrap gap-0.5">
              {agents.slice(0, 24).map((a) => (
                <div key={a.id} className="w-2 h-6" title={a.name} style={{ background: (a.tasks_running ?? 0) > 0 ? '#f64e6e' : a.status === 'online' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.05)' }} />
              ))}
            </div>
            <div className="text-[10px] font-mono text-[#545454]">{onlineAgents.length} online</div>
          </div>
        </Panel>
        <Panel label="SCHEDULED" className="min-h-[118px]">
          <div className="flex flex-col gap-1.5 text-[10px] font-mono">
            <div className="flex justify-between"><span className="text-emerald-400">CRON</span><span className="tabular-nums">{cron.length}</span></div>
            <div className="flex justify-between"><span className="text-amber-400">ACTIVE</span><span className="tabular-nums">{cron.filter((c) => c.status === 'active').length}</span></div>
            <div className="flex justify-between"><span className="text-sky-400">TASKS</span><span className="tabular-nums">{tasks.length}</span></div>
            <div className="border-t border-white/10 pt-1 flex justify-between"><span className="text-[#545454]">FAILED</span><span className="tabular-nums text-red-400">{summary?.failed ?? 0}</span></div>
          </div>
        </Panel>
      </div>

      {/* Middle: task status + agent load */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 flex-1 min-h-0">
        <Panel
          label={taskView === 'status' ? 'TASK STATUS BREAKDOWN' : taskView === 'flow' ? 'TASK THROUGHPUT · per hour' : taskView === 'burn' ? 'BACKLOG BURN-DOWN · queue health' : taskView === 'sla' ? 'CYCLE-TIME SLA · how long work takes' : 'AGING WIP · how long open work waits'}
          right={(
            <span className="flex items-center gap-1">
              <button
                onClick={() => setTaskView('status')}
                className={`px-1.5 py-0.5 border text-[10px] tracking-[0.15em] ${taskView === 'status' ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#545454] hover:border-white/30'}`}
              >STATUS</button>
              <button
                onClick={() => setTaskView('flow')}
                className={`px-1.5 py-0.5 border text-[10px] tracking-[0.15em] ${taskView === 'flow' ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#545454] hover:border-white/30'}`}
              >FLOW</button>
              <button
                onClick={() => setTaskView('burn')}
                className={`px-1.5 py-0.5 border text-[10px] tracking-[0.15em] ${taskView === 'burn' ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#545454] hover:border-white/30'}`}
              >BURN</button>
              <button
                onClick={() => setTaskView('sla')}
                className={`px-1.5 py-0.5 border text-[10px] tracking-[0.15em] ${taskView === 'sla' ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#545454] hover:border-white/30'}`}
              >SLA</button>
              <button
                onClick={() => setTaskView('aging')}
                className={`px-1.5 py-0.5 border text-[10px] tracking-[0.15em] ${taskView === 'aging' ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#545454] hover:border-white/30'}`}
              >AGE</button>
              <span className={`hidden xl:inline ${vitals.mcOnline ? 'text-emerald-400' : 'text-red-400'}`}>● {vitals.mcOnline ? 'LIVE' : 'OFFLINE'}</span>
            </span>
          )}
        >
          {taskView === 'status' ? (
            <div className="h-full flex flex-col gap-2">
              {statusBars.map((b) => (
                <div key={b.name} className="flex items-center gap-2">
                  <span className="w-20 text-[10px] font-mono text-[#b8b8b8] uppercase">{b.name}</span>
                  <div className="flex-1 h-5 bg-[#080808] border border-white/5 relative">
                    <div className="absolute inset-y-0 left-0" style={{ width: `${(b.v / barMax) * 100}%`, background: b.c, opacity: 0.75 }} />
                  </div>
                  <span className="w-10 text-right text-[10px] font-mono tabular-nums text-white">{b.v}</span>
                </div>
              ))}
              {statusBars.length === 0 && <div className="text-[10px] font-mono text-[#545454]">No task data from Mc.</div>}
            </div>
          ) : taskView === 'flow' ? (
            <TaskThroughput tasks={mcTasks} nowMs={nowMs} />
          ) : taskView === 'burn' ? (
            <BacklogBurndown tasks={mcTasks} nowMs={nowMs} />
          ) : taskView === 'sla' ? (
            <CycleTimeSLA tasks={mcTasks} nowMs={nowMs} />
          ) : (
            <AgingWip tasks={mcTasks} nowMs={nowMs} />
          )}
        </Panel>

        <Panel
          label={agentView === 'load' ? 'AGENT LOAD' : 'AGENT PERFORMANCE'}
          right={(
            <span className="flex items-center gap-2">
              <button
                onClick={() => setAgentView('load')}
                className={`px-1.5 py-0.5 border text-[10px] tracking-[0.15em] ${agentView === 'load' ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#545454] hover:border-white/30'}`}
              >LOAD</button>
              <button
                onClick={() => setAgentView('perf')}
                className={`px-1.5 py-0.5 border text-[10px] tracking-[0.15em] ${agentView === 'perf' ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#545454] hover:border-white/30'}`}
              >PERF</button>
              <span className="hidden sm:inline">{agentView === 'load' ? 'running · queue' : `${agentMetrics.length} ranked`}</span>
            </span>
          )}
        >
          {agentView === 'load' ? (
            <div className="h-full flex flex-col gap-2 overflow-auto">
              {topAgents.map((a) => {
                const load = (a.tasks_running ?? 0) + (a.queue_depth ?? 0);
                return (
                  <div key={a.id} className="flex items-center gap-2">
                    <span className="w-28 text-[10px] font-mono text-[#b8b8b8] truncate">{a.name}</span>
                    <div className="flex-1 h-4 bg-[#080808] relative border border-white/5">
                      <div className="absolute inset-y-0 left-0" style={{ width: `${Math.min(load * 20, 100)}%`, background: (a.tasks_running ?? 0) > 0 ? '#f64e6e' : '#38bdf8', opacity: 0.8 }} />
                    </div>
                    <span className="w-16 text-right text-[10px] font-mono tabular-nums text-white">{a.tasks_running ?? 0}·{a.queue_depth ?? 0}</span>
                  </div>
                );
              })}
              {topAgents.length === 0 && <div className="text-[10px] font-mono text-[#545454]">No agents online.</div>}
            </div>
          ) : (
            <AgentPerformance metrics={agentMetrics} />
          )}
        </Panel>
      </div>

      {/* Bottom: activity log — toggles between kanban task log and live agent signal */}
      <Panel
        label={feed === 'tasks' ? 'TASK ACTIVITY · mc kanban' : 'AGENT SIGNAL · mc activity'}
        className="h-[160px] shrink-0"
        right={(
          <span className="flex items-center gap-2">
            <button
              onClick={() => setFeed('tasks')}
              className={`px-1.5 py-0.5 border text-[10px] tracking-[0.15em] ${feed === 'tasks' ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#545454] hover:border-white/30'}`}
            >TASKS</button>
            <button
              onClick={() => setFeed('signal')}
              className={`px-1.5 py-0.5 border text-[10px] tracking-[0.15em] ${feed === 'signal' ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#545454] hover:border-white/30'}`}
            >SIGNAL</button>
            <span>{feed === 'tasks' ? `${mcTasks.length} tasks` : `${activities.length} signals`}</span>
          </span>
        )}
      >
        {feed === 'tasks'
          ? (log.length > 0
              ? <LogTail height={130} lines={log} />
              : <div className="text-[10px] font-mono text-[#545454] p-2">No task activity. Create one in Operations or via `mc kanban create`.</div>)
          : (signalLog.length > 0
              ? <LogTail height={130} lines={signalLog} />
              : <div className="text-[10px] font-mono text-[#545454] p-2">No agent activity on the wire.</div>)}
      </Panel>
    </div>
  );
}
