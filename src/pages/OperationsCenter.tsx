import { useState, useEffect, useRef } from 'react';
import { useTaskStore } from '../stores/useTaskStore';
import { useTaskFocusStore } from '../stores/useTaskFocusStore';
import { getHermesCron, runHermesCron, createHermesCron, decomposeTask, errMessage, type HermesCronJob } from '../lib/api';
import { Panel, Pill } from '../components/cyberpunk/ui';

const FILTERS = ['ALL', 'READY', 'RUNNING', 'BLOCKED', 'DONE', 'FAILED'] as const;

function toneFor(status: string): 'good' | 'info' | 'bad' | 'warn' | 'neutral' {
  if (status === 'running') return 'warn';
  if (status === 'done') return 'good';
  if (status === 'ready') return 'info';
  if (status === 'failed' || status === 'blocked') return 'bad';
  return 'neutral';
}

export default function OperationsCenter() {
  const [filter, setFilter] = useState<string>('ALL');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [cron, setCron] = useState<HermesCronJob[]>([]);
  const [decomposeOpen, setDecomposeOpen] = useState(false);
  const [decomposeText, setDecomposeText] = useState('');
  const [decomposeLoading, setDecomposeLoading] = useState(false);
  const [decomposeResult, setDecomposeResult] = useState<{ title: string; body?: string; assignee?: string }[] | null>(null);

  // Cron-creation modal state.
  const [cronOpen, setCronOpen] = useState(false);
  const [cronSchedule, setCronSchedule] = useState('');
  const [cronPrompt, setCronPrompt] = useState('');
  const [cronName, setCronName] = useState('');
  const [cronLoading, setCronLoading] = useState(false);
  const [cronError, setCronError] = useState<string | null>(null);

  const {
    tasks, summary, error, lastSync,
    fetchTasks, addHermesTask, claimHermesTaskById, completeHermesTaskById, blockHermesTaskById,
  } = useTaskStore();

  // Task Search (⌘F) hands a task id here; scroll it into view + flash-highlight it.
  const { focusId, nonce, clear: clearFocus } = useTaskFocusStore();
  const [flashId, setFlashId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const loadCron = () => getHermesCron().then((d) => setCron(d.jobs || [])).catch(() => {});

  // Tasks are refreshed globally by Layout (and after each mutation); poll only cron here.
  useEffect(() => {
    fetchTasks();   // immediate first paint
    loadCron();
    const id = setInterval(loadCron, 8000);
    return () => clearInterval(id);
  }, [fetchTasks]);

  // When Task Search focuses a task, reset the filter so it's guaranteed visible,
  // then scroll + flash it once the row is in the DOM. `nonce` re-fires even when
  // the same task is chosen twice; the flash clears itself after 2.4s.
  useEffect(() => {
    if (!focusId) return;
    setFilter('ALL');
    setFlashId(focusId);
    const raf = requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(focusId)}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    const t = setTimeout(() => setFlashId(null), 2400);
    clearFocus();
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, nonce]);

  const filtered = tasks.filter((t) => filter === 'ALL' || t.status.toUpperCase() === filter);

  const handleCreate = async () => {
    if (!title.trim()) return;
    const t = await addHermesTask(title.trim(), body.trim() || undefined);
    if (t) { setTitle(''); setBody(''); }
  };

  const handleCreateCron = async () => {
    if (!cronSchedule.trim()) return;
    setCronLoading(true);
    setCronError(null);
    try {
      const data = await createHermesCron({
        schedule: cronSchedule.trim(),
        prompt: cronPrompt.trim() || undefined,
        name: cronName.trim() || undefined,
      });
      setCron(data.jobs || []);
      setCronOpen(false);
      setCronSchedule('');
      setCronPrompt('');
      setCronName('');
    } catch (err) {
      setCronError(errMessage(err));
    } finally {
      setCronLoading(false);
    }
  };

  const handleDecompose = async () => {
    if (!decomposeText.trim()) return;
    setDecomposeLoading(true);
    setDecomposeResult(null);
    try {
      const data = await decomposeTask({ task: decomposeText.trim() });
      const subs = data?.subtasks || [];
      setDecomposeResult(subs);
      // Auto-create subtasks in kanban
      for (const sub of subs) {
        await addHermesTask(sub.title, sub.body, sub.assignee);
      }
      await fetchTasks();
    } catch (err) {
      console.error('Decompose failed:', err);
    } finally {
      setDecomposeLoading(false);
    }
  };

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-2 p-2 overflow-auto">
      {/* Task queue */}
      <Panel label="MISSION QUEUE" right={<span className="text-[#545454]">{filtered.length} / {tasks.length}</span>} bodyClass="flex flex-col">
        <div className="flex flex-wrap gap-1 mb-2 text-[10px] font-mono shrink-0">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2 py-1 border ${filter === f ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#b8b8b8] hover:border-white/30'}`}>
              {f}
            </button>
          ))}
        </div>
        <div ref={listRef} className="flex flex-col gap-1 overflow-auto flex-1 min-h-0">
          {filtered.map((task) => (
            <div key={task.id} data-task-id={task.id}
              className={`p-2 border bg-[#080808] transition-colors ${flashId === task.id ? 'border-[#f64e6e] ring-1 ring-[#f64e6e]/60 bg-[#f64e6e]/[0.06]' : 'border-white/[0.08] hover:border-white/20'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono text-[#545454]">{task.id}</span>
                <Pill tone={toneFor(task.status)}>{task.status.toUpperCase()}</Pill>
              </div>
              <div className="text-[12px] text-white mb-1 leading-tight">{task.name}</div>
              <div className="flex justify-between text-[10px] font-mono mb-1.5">
                <span className="text-[#b8b8b8]">{task.agentName}</span>
                <span className="text-[#545454]">P{String(task.priority).toUpperCase()}</span>
              </div>
              <div className="flex gap-1">
                {task.status === 'ready' && (
                  <button onClick={() => void claimHermesTaskById(task.id)} className="flex-1 text-[9px] font-mono border border-white/10 py-1 hover:border-amber-400 hover:text-amber-400">CLAIM</button>
                )}
                {task.status === 'running' && (
                  <button onClick={() => void completeHermesTaskById(task.id)} className="flex-1 text-[9px] font-mono border border-white/10 py-1 hover:border-emerald-400 hover:text-emerald-400">COMPLETE</button>
                )}
                {task.status !== 'done' && task.status !== 'blocked' && (
                  <button onClick={() => void blockHermesTaskById(task.id, 'blocked from Mission Control')} className="flex-1 text-[9px] font-mono border border-white/10 py-1 hover:border-red-400 hover:text-red-400">BLOCK</button>
                )}
              </div>
              {task.status === 'running' && (
                <div className="mt-1.5 h-0.5 bg-white/5 relative overflow-hidden">
                  <div className="absolute inset-y-0 w-1/3 bg-[#f64e6e]" style={{ animation: 'slide 2s linear infinite' }} />
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && <div className="text-[10px] font-mono text-[#545454] p-2">No tasks match filter</div>}
        </div>

        {/* Create task */}
        <div className="mt-2 flex flex-col gap-1.5 border-t border-white/10 pt-2 shrink-0">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task title..."
            className="bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none" />
          <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body (optional)..."
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
            className="bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none" />
          <button onClick={() => void handleCreate()} className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] py-1.5 hover:bg-[#f64e6e]/20">
            + CREATE HERMES TASK
          </button>
          <button onClick={() => { setDecomposeOpen(true); setDecomposeText(''); setDecomposeResult(null); }} className="text-[10px] font-mono border border-white/10 text-[#b8b8b8] py-1.5 hover:border-[#f64e6e] hover:text-[#f64e6e]">
            ⚡ DECOMPOSE TASK
          </button>
        </div>
      </Panel>

      {/* Right: summary + cron + decompose */}
      <div className="flex flex-col gap-2 min-h-0">
        {error && (
          <div className="shrink-0 px-2 py-1 border border-red-400/40 bg-[#050505]/80 text-red-400 font-mono text-[10px]">
            ⚠ {error}
          </div>
        )}
        <Panel label="KANBAN SUMMARY" right={<span className="text-[#545454]">{lastSync ? `synced ${lastSync.toLocaleTimeString()}` : '—'}</span>} className="shrink-0">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {[
              { k: 'TOTAL', v: summary?.total ?? 0, c: 'text-white' },
              { k: 'READY', v: summary?.ready ?? 0, c: 'text-sky-400' },
              { k: 'RUNNING', v: summary?.running ?? 0, c: 'text-amber-400' },
              { k: 'BLOCKED', v: summary?.blocked ?? 0, c: 'text-red-400' },
              { k: 'DONE', v: summary?.completed ?? 0, c: 'text-emerald-400' },
              { k: 'FAILED', v: summary?.failed ?? 0, c: 'text-red-400' },
            ].map((s) => (
              <div key={s.k} className="flex flex-col gap-0.5">
                <span className="text-[9px] font-mono tracking-[0.2em] uppercase text-[#545454]">{s.k}</span>
                <span className={`text-2xl font-mono font-bold tabular-nums ${s.c}`}>{s.v}</span>
              </div>
            ))}
          </div>
          {error && <div className="mt-2 text-[10px] font-mono text-red-400">⚠ {error}</div>}
        </Panel>

        <Panel
          label="SCHEDULED JOBS · hermes cron"
          right={(
            <span className="flex items-center gap-2">
              <button
                onClick={() => { setCronOpen(true); setCronError(null); }}
                className="border border-[#f64e6e]/40 text-[#f64e6e] px-2 py-0.5 hover:bg-[#f64e6e]/10"
              >+ NEW</button>
              <span>{cron.length} jobs</span>
            </span>
          )}
          className="flex-1 min-h-0"
        >
          <div className="flex flex-col gap-1 overflow-auto h-full">
            {cron.map((j) => (
              <div key={j.id} className="flex items-center justify-between px-2 py-1.5 border border-white/[0.06] bg-[#080808]">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-1.5 h-1.5 shrink-0" style={{ background: j.status === 'active' ? '#10b981' : '#545454' }} />
                  <div className="min-w-0">
                    <div className="text-[11px] text-white truncate">{j.name || j.id.slice(0, 12)}</div>
                    <div className="text-[9px] font-mono text-[#545454] truncate">{j.schedule || j.repeat || '—'}</div>
                  </div>
                </div>
                <button onClick={() => void runHermesCron(j.id)} className="text-[9px] font-mono border border-white/10 px-2 py-1 hover:border-[#f64e6e] hover:text-[#f64e6e] shrink-0">RUN</button>
              </div>
            ))}
            {cron.length === 0 && <div className="text-[10px] font-mono text-[#545454] p-2">No scheduled jobs. Add one with `hermes cron add`.</div>}
          </div>
        </Panel>
      </div>

      {/* Decompose Modal */}
      {decomposeOpen && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#0A0A0A] border border-white/10 w-full max-w-lg mx-4">
            <div className="px-3 h-[26px] flex items-center justify-between border-b border-white/10 bg-[#080808]">
              <span className="font-mono text-[10px] tracking-[0.2em] uppercase font-bold text-[#b8b8b8]">DECOMPOSE TASK</span>
              <button onClick={() => setDecomposeOpen(false)} className="text-[#545454] hover:text-white text-[11px]">✕</button>
            </div>
            <div className="p-3 flex flex-col gap-2">
              <textarea
                value={decomposeText}
                onChange={(e) => setDecomposeText(e.target.value)}
                placeholder="Describe the complex task to decompose..."
                rows={4}
                className="bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none resize-none"
              />
              <button
                onClick={() => void handleDecompose()}
                disabled={decomposeLoading || !decomposeText.trim()}
                className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] py-1.5 hover:bg-[#f64e6e]/20 disabled:opacity-30"
              >
                {decomposeLoading ? 'DECOMPOSING…' : '⚡ DECOMPOSE'}
              </button>
              {decomposeResult && (
                <div className="flex flex-col gap-1 mt-1">
                  <div className="text-[10px] font-mono text-emerald-400">✓ {decomposeResult.length} sub-tasks created</div>
                  {decomposeResult.map((sub, i) => (
                    <div key={i} className="px-2 py-1 border border-white/[0.06] bg-[#080808] text-[10px] font-mono text-[#b8b8b8]">
                      <span className="text-white">{sub.title}</span>
                      {sub.assignee && <span className="text-[#545454] ml-2">→ {sub.assignee}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cron-creation Modal */}
      {cronOpen && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#0A0A0A] border border-white/10 w-full max-w-lg mx-4">
            <div className="px-3 h-[26px] flex items-center justify-between border-b border-white/10 bg-[#080808]">
              <span className="font-mono text-[10px] tracking-[0.2em] uppercase font-bold text-[#b8b8b8]">SCHEDULE CRON JOB</span>
              <button onClick={() => setCronOpen(false)} className="text-[#545454] hover:text-white text-[11px]">✕</button>
            </div>
            <div className="p-3 flex flex-col gap-2">
              <label className="text-[9px] font-mono tracking-[0.2em] uppercase text-[#545454]">SCHEDULE</label>
              <input
                value={cronSchedule}
                onChange={(e) => setCronSchedule(e.target.value)}
                placeholder="30m · every 2h · 0 9 * * *"
                className="bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] font-mono text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none"
              />
              <label className="text-[9px] font-mono tracking-[0.2em] uppercase text-[#545454]">NAME <span className="text-[#363636]">(optional)</span></label>
              <input
                value={cronName}
                onChange={(e) => setCronName(e.target.value)}
                placeholder="morning-brief"
                className="bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none"
              />
              <label className="text-[9px] font-mono tracking-[0.2em] uppercase text-[#545454]">PROMPT <span className="text-[#363636]">(optional)</span></label>
              <textarea
                value={cronPrompt}
                onChange={(e) => setCronPrompt(e.target.value)}
                placeholder="Self-contained instruction the agent runs on schedule…"
                rows={3}
                className="bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none resize-none"
              />
              {cronError && <div className="text-[10px] font-mono text-red-400">⚠ {cronError}</div>}
              <button
                onClick={() => void handleCreateCron()}
                disabled={cronLoading || !cronSchedule.trim()}
                className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] py-1.5 hover:bg-[#f64e6e]/20 disabled:opacity-30"
              >
                {cronLoading ? 'SCHEDULING…' : '+ SCHEDULE JOB'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
