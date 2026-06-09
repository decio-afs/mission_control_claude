import { useEffect, useState } from 'react';
import { useGhostStore } from '../stores/useGhostStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useSystemStore } from '../stores/useSystemStore';
import { getHermesAgents, getHermesCron, runHermesCron, spawnHermesAgent, errMessage, type HermesAgent, type HermesCronJob } from '../lib/api';

/**
 * Cyberpunk Mission Control — Hermes-powered dashboard
 *
 * Displays real agents, tasks, and cron jobs from the Hermes CLI bridge.
 * Visual style matches the cyberpunk-ui zip aesthetic.
 */

const SQUAD_COLORS: Record<string, string> = {
  CORE: '#f64e6e',
  SEC: '#ef4444',
  INTEL: '#a855f7',
  INFRA: '#10b981',
  CONT: '#f59e0b',
  DEV: '#38bdf8',
};

const STATUS_PILL: Record<string, { bg: string; text: string }> = {
  ready:    { bg: 'bg-sky-500/10',    text: 'text-sky-400' },
  running:  { bg: 'bg-amber-500/10',  text: 'text-amber-400' },
  blocked:  { bg: 'bg-red-500/10',    text: 'text-red-400' },
  done:     { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  pending:  { bg: 'bg-white/5',       text: 'text-[#b8b8b8]' },
};

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    neutral: 'border-white/15 text-[#b8b8b8]',
    brand:   'border-[#f64e6e]/40 text-[#f64e6e] bg-[#f64e6e]/5',
    good:    'border-emerald-400/40 text-emerald-400 bg-emerald-400/5',
    warn:    'border-amber-400/40 text-amber-400 bg-amber-400/5',
    info:    'border-sky-400/40 text-sky-400 bg-sky-400/5',
    bad:     'border-red-400/40 text-red-400 bg-red-400/5',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border font-mono text-[10px] tracking-[0.2em] uppercase ${tones[tone] || tones.neutral}`}>
      {children}
    </span>
  );
}

function Panel({ label, children, right }: { label?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="bg-[#0A0A0A] border border-white/[0.08] flex flex-col">
      {label && (
        <div className="px-3 h-[26px] flex items-center justify-between border-b border-white/10 shrink-0 bg-[#080808]">
          <span className="text-[10px] font-mono tracking-[0.2em] uppercase font-bold text-[#b8b8b8]">{label}</span>
          <div className="text-[10px] text-[#545454] font-mono">{right}</div>
        </div>
      )}
      <div className="p-3 flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}

function Stat({ label, value, sub, tone = 'white' }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) {
  const tones: Record<string, string> = { white: 'text-white', brand: 'text-[#f64e6e]', good: 'text-emerald-400', warn: 'text-amber-400', info: 'text-sky-400' };
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-mono tracking-[0.2em] uppercase font-bold text-[#545454]">{label}</span>
      <div className={`text-2xl font-mono font-bold tabular-nums ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-[10px] font-mono text-[#545454]">{sub}</div>}
    </div>
  );
}

export default function Cyberpunk() {
  const { nodes, error: ghostError, isLoading: ghostLoading } = useGhostStore();
  const { tasks, summary, hermesTasks, addHermesTask, claimHermesTaskById, completeHermesTaskById } = useTaskStore();
  const { vitals, error: systemError } = useSystemStore();

  const [agents, setAgents] = useState<HermesAgent[]>([]);
  const [cronJobs, setCronJobs] = useState<HermesCronJob[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskBody, setNewTaskBody] = useState('');
  const [spawnGoal, setSpawnGoal] = useState('');
  const [logs, setLogs] = useState<{ t: string; msg: string; color?: string }[]>([]);
  const [loading, setLoading] = useState(false);

  function pushLog(msg: string, color?: string) {
    const t = new Date().toISOString().slice(11, 19);
    setLogs((prev) => [...prev.slice(-50), { t, msg, color }]);
  }

  async function loadHermesData() {
    setLoading(true);
    pushLog('connecting to Hermes bridge...');
    try {
      const [agentsData, cronData] = await Promise.all([
        getHermesAgents(),
        getHermesCron(),
      ]);
      setAgents(agentsData.agents || []);
      setCronJobs(cronData.jobs || []);
      pushLog(`loaded ${agentsData.agents?.length || 0} agents, ${cronData.jobs?.length || 0} cron jobs`, '#10b981');
    } catch (err) {
      pushLog(`load failed: ${errMessage(err)}`, '#ef4444');
      console.error('Hermes bridge error:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Tasks/status/topology are polled globally by Layout; here we only load the
    // agent roster + cron jobs that this page shows.
    void loadHermesData();
    const id = setInterval(() => void loadHermesData(), 10000);
    return () => clearInterval(id);
    // Mount-once: store actions are stable; intentionally not re-subscribing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    pushLog(`creating task: ${newTaskTitle}`);
    const task = await addHermesTask(newTaskTitle, newTaskBody || undefined);
    if (task) {
      pushLog(`created ${task.id}`, '#10b981');
      setNewTaskTitle('');
      setNewTaskBody('');
    } else {
      pushLog('create failed', '#ef4444');
    }
  }

  async function handleClaim(id: string) {
    pushLog(`claiming ${id}`);
    const ok = await claimHermesTaskById(id);
    pushLog(ok ? `claimed ${id}` : `claim failed ${id}`, ok ? '#10b981' : '#ef4444');
  }

  async function handleComplete(id: string) {
    pushLog(`completing ${id}`);
    const ok = await completeHermesTaskById(id);
    pushLog(ok ? `completed ${id}` : `complete failed ${id}`, ok ? '#10b981' : '#ef4444');
  }

  async function handleRunCron(id: string) {
    pushLog(`triggering cron ${id}`);
    try {
      await runHermesCron(id);
      pushLog(`cron ${id} triggered`, '#10b981');
    } catch (err) {
      pushLog(`cron failed: ${errMessage(err)}`, '#ef4444');
    }
  }

  async function handleSpawn() {
    if (!spawnGoal.trim()) return;
    pushLog(`spawning agent: ${spawnGoal.slice(0, 40)}...`);
    try {
      const res = await spawnHermesAgent({ goal: spawnGoal });
      pushLog(`agent spawned: ${res.message?.slice(0, 120) || 'ok'}`, '#10b981');
      setSpawnGoal('');
    } catch (err) {
      pushLog(`spawn failed: ${errMessage(err)}`, '#ef4444');
    }
  }

  const onlineCount = nodes.filter((n) => n.status === 'active' || n.status === 'online').length;
  const busyCount = nodes.filter((n) => (n.tasks_running ?? 0) > 0).length;

  return (
    <div className="h-full w-full bg-[#050505] text-white overflow-auto p-4">
      <style>{`
        .mc-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .mc-scroll::-webkit-scrollbar-track { background: transparent; }
        .mc-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Pill tone="brand">HERMES BRIDGE</Pill>
          <span className="text-[10px] font-mono text-[#545454]">
            {vitals.hermesOnline ? (
              <><span className="text-emerald-400">●</span> ONLINE — {vitals.hermesVersion}</>
            ) : (
              <><span className="text-red-400">●</span> OFFLINE</>
            )}
          </span>
          {ghostLoading && <span className="text-[10px] font-mono text-[#b8b8b8]">syncing…</span>}
        </div>
        <div className="flex items-center gap-2">
          {(systemError || ghostError) && (
            <span className="text-[10px] font-mono text-red-400">
              {systemError && `⚠ ${systemError}`}
              {ghostError && `⚠ ${ghostError}`}
            </span>
          )}
          <button
            onClick={() => void loadHermesData()}
            disabled={loading}
            className="text-[10px] font-mono border border-white/10 px-3 py-1.5 hover:border-[#f64e6e] hover:text-[#f64e6e] disabled:opacity-50"
          >
            {loading ? 'SYNCING...' : 'SYNC HERMES'}
          </button>
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
        <Panel><Stat label="AGENTS" value={agents.length} tone="info" /></Panel>
        <Panel><Stat label="ONLINE" value={onlineCount} tone="good" /></Panel>
        <Panel><Stat label="BUSY" value={busyCount} tone="warn" /></Panel>
        <Panel><Stat label="TASKS" value={summary?.total ?? tasks.length} tone="white" /></Panel>
        <Panel><Stat label="READY" value={summary?.ready ?? 0} tone="info" /></Panel>
        <Panel><Stat label="RUNNING" value={summary?.running ?? 0} tone="warn" /></Panel>
        <Panel><Stat label="DONE" value={summary?.completed ?? 0} tone="good" /></Panel>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Agents */}
        <Panel label="GHOST LEGION" right={<span>{agents.length} PROFILES</span>}>
          <div className="flex flex-col gap-2 mc-scroll max-h-[300px] overflow-auto">
            {agents.map((a) => {
              const node = nodes.find((n) => n.name.toLowerCase() === a.name.toLowerCase());
              // Color by the squad the topology store assigns (real Hermes names
              // don't match codename-based keys), with a sane fallback.
              const color = (node?.squad && SQUAD_COLORS[node.squad]) || SQUAD_COLORS.DEV || '#38bdf8';
              const isOnline = !!node && (node.status === 'active' || node.status === 'online');
              return (
                <div key={a.name} className="flex items-center gap-3 border border-white/5 bg-[#080808] px-2 py-1.5">
                  <div className="w-2 h-8" style={{ background: isOnline ? color : '#1a1a1a' }} />
                  <div className="flex-1">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-white">{a.name}</div>
                    <div className="text-[9px] font-mono text-[#545454]">
                      {isOnline ? 'ONLINE' : 'DORMANT'} · tasks {node?.tasks_running ?? 0} · queue {node?.queue_depth ?? 0}
                    </div>
                  </div>
                </div>
              );
            })}
            {agents.length === 0 && <div className="text-[10px] font-mono text-[#545454]">No agents loaded. Click SYNC HERMES.</div>}
          </div>
        </Panel>

        {/* Tasks */}
        <Panel label="KANBAN TASKS" right={<span>LIVE FROM HERMES</span>}>
          <div className="flex flex-col gap-2 mc-scroll max-h-[300px] overflow-auto">
            {hermesTasks.map((t) => {
              const pill = STATUS_PILL[t.status] || STATUS_PILL.pending;
              return (
                <div key={t.id} className="flex flex-col gap-1 border border-white/5 bg-[#080808] px-2 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-[#545454]">{t.id}</span>
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 ${pill.bg} ${pill.text}`}>{t.status}</span>
                  </div>
                  <div className="text-[11px] text-white truncate">{t.title}</div>
                  <div className="text-[9px] font-mono text-[#545454]">
                    priority {t.priority} · {t.assignee || 'unassigned'}
                  </div>
                  <div className="flex gap-1 mt-1">
                    {t.status === 'ready' && (
                      <button
                        onClick={() => void handleClaim(t.id)}
                        className="flex-1 text-[9px] font-mono border border-white/10 py-1 hover:border-amber-400 hover:text-amber-400"
                      >
                        CLAIM
                      </button>
                    )}
                    {t.status === 'running' && (
                      <button
                        onClick={() => void handleComplete(t.id)}
                        className="flex-1 text-[9px] font-mono border border-white/10 py-1 hover:border-emerald-400 hover:text-emerald-400"
                      >
                        COMPLETE
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {hermesTasks.length === 0 && <div className="text-[10px] font-mono text-[#545454]">No tasks loaded.</div>}
          </div>
        </Panel>

        {/* Cron + Actions */}
        <div className="flex flex-col gap-4">
          <Panel label="CRON JOBS" right={<span>SCHEDULED</span>}>
            <div className="flex flex-col gap-2 mc-scroll max-h-[180px] overflow-auto">
              {cronJobs.map((j) => (
                <div key={j.id} className="flex flex-col gap-1 border border-white/5 bg-[#080808] px-2 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-[#545454]">{j.id.slice(0, 12)}</span>
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 ${j.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-[#b8b8b8]'}`}>
                      {j.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-white truncate">{j.name || 'Unnamed Job'}</div>
                  <div className="text-[9px] font-mono text-[#545454]">{j.schedule}</div>
                  <button
                    onClick={() => void handleRunCron(j.id)}
                    className="mt-1 text-[9px] font-mono border border-white/10 py-1 hover:border-[#f64e6e] hover:text-[#f64e6e]"
                  >
                    RUN NOW
                  </button>
                </div>
              ))}
              {cronJobs.length === 0 && <div className="text-[10px] font-mono text-[#545454]">No cron jobs loaded.</div>}
            </div>
          </Panel>

          <Panel label="DISPATCH AGENT">
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={spawnGoal}
                onChange={(e) => setSpawnGoal(e.target.value)}
                placeholder="Enter agent goal..."
                className="bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none"
              />
              <button
                onClick={() => void handleSpawn()}
                className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] py-1.5 hover:bg-[#f64e6e]/20"
              >
                SPAWN HERMES AGENT
              </button>
            </div>
          </Panel>

          <Panel label="CREATE TASK">
            <form onSubmit={handleCreateTask} className="flex flex-col gap-2">
              <input
                type="text"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="Task title..."
                className="bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none"
              />
              <input
                type="text"
                value={newTaskBody}
                onChange={(e) => setNewTaskBody(e.target.value)}
                placeholder="Body (optional)..."
                className="bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none"
              />
              <button
                type="submit"
                className="text-[10px] font-mono border border-white/10 py-1.5 hover:border-sky-400 hover:text-sky-400"
              >
                CREATE HERMES TASK
              </button>
            </form>
          </Panel>
        </div>
      </div>

      {/* Log tail */}
      <Panel label="BRIDGE LOG" right={<span>LIVE</span>}>
        <div className="font-mono text-[10px] leading-[1.5] h-[140px] overflow-auto mc-scroll">
          {logs.map((l, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-[#363636] shrink-0">{l.t}</span>
              <span style={{ color: l.color || '#b8b8b8' }} className="truncate">{l.msg}</span>
            </div>
          ))}
          {logs.length === 0 && <div className="text-[#545454]">Waiting for events...</div>}
        </div>
      </Panel>
    </div>
  );
}
