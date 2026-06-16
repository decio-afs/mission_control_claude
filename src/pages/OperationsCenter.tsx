// Operations Center — full Mc kanban board.
//
// A column-per-status board backed live by `mc kanban`, with a per-task
// detail/control slide-over (TaskDetailDrawer) exposing the full verb set:
// claim / complete / block / unblock / promote / schedule / archive / reassign /
// reclaim / comment / edit / link / unlink. Plus task creation (full fields),
// AI decompose, and cron management.
import { useState, useEffect, useMemo } from 'react';
import { useTaskStore } from '../stores/useTaskStore';
import { useGhostStore } from '../stores/useGhostStore';
import { useTaskFocusStore } from '../stores/useTaskFocusStore';
import { getMcCron, runMcCron, createMcCron, decomposeTask, errMessage, type McCronJob, type CronSchedulerStatus, type McTask } from '../lib/api';
import { parseSchedule, formatCountdown, fireLabel, type ParsedSchedule } from '../lib/cronSchedule';
import TaskDetailDrawer from '../components/TaskDetailDrawer';
import CronTimeline from '../components/CronTimeline';

const COLUMNS: { key: string; label: string; tone: string }[] = [
  { key: 'triage', label: 'TRIAGE', tone: '#6b7280' },
  { key: 'todo', label: 'TODO', tone: '#9aa3b5' },
  { key: 'ready', label: 'READY', tone: '#38bdf8' },
  { key: 'running', label: 'RUNNING', tone: '#f59e0b' },
  { key: 'review', label: 'REVIEW', tone: '#ff795e' },
  { key: 'blocked', label: 'BLOCKED', tone: '#ef4444' },
  { key: 'failed', label: 'FAILED', tone: '#b91c1c' },
  { key: 'scheduled', label: 'SCHEDULED', tone: '#6b7280' },
  { key: 'done', label: 'DONE', tone: '#10b981' },
];

// Normalize any Mc status string to one of our columns.
function colOf(status: string): string {
  if (status === 'completed') return 'done';
  if (status === 'pending') return 'todo';
  return COLUMNS.some((c) => c.key === status) ? status : 'todo';
}

function ago(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// A done task "has a deliverable" when it produced something retrievable. The
// authoritative signal is `has_deliverable`, computed once per list by the bridge
// (mc_store) — true for a written result, a git branch, ANY run summary (i.e. a
// non-empty latest_summary), OR a non-empty workspace dir (the common case here,
// where the deliverable is a file the agent wrote). Computing it server-side
// catches summary-only / file-only deliverables that the list payload's raw
// fields miss, with no per-card fetch (BUGHUNT DONE-CARD-2). We still OR in the
// raw result/branch fields as a defensive fallback for older payloads that
// predate the server flag. workspace_path itself is intentionally NOT used: it
// is set on virtually every task even when empty (BUGHUNT iter #10/#12).
function hasDeliverable(t: McTask): boolean {
  return Boolean(t.has_deliverable || t.result?.trim() || t.branch_name?.trim());
}

export default function OperationsCenter() {
  const { mcTasks, summary, stats, boards, diagnostics, error, lastSync, fetchTasks, fetchStats, fetchBoards, switchBoard, createBoard, fetchDiagnostics, reconcileBoard, createTask, claimMcTaskById, completeMcTaskById } = useTaskStore();
  const nodes = useGhostStore((s) => s.nodes);

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState('ALL');
  const [diagOpen, setDiagOpen] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMsg, setReconcileMsg] = useState<string | null>(null);
  const [boardModal, setBoardModal] = useState(false);
  const [newBoardSlug, setNewBoardSlug] = useState('');
  const [newBoardName, setNewBoardName] = useState('');

  // create-task modal
  const [createOpen, setCreateOpen] = useState(false);
  const [cTitle, setCTitle] = useState('');
  const [cBody, setCBody] = useState('');
  const [cAssignee, setCAssignee] = useState('');
  const [cPriority, setCPriority] = useState('');
  const [cSkills, setCSkills] = useState('');
  const [cTriage, setCTriage] = useState(false);

  // decompose modal
  const [decomposeOpen, setDecomposeOpen] = useState(false);
  const [decomposeText, setDecomposeText] = useState('');
  const [decomposeLoading, setDecomposeLoading] = useState(false);
  const [decomposeResult, setDecomposeResult] = useState<{ title: string; body?: string; assignee?: string }[] | null>(null);

  // cron modal
  const [cronOpen, setCronOpen] = useState(false);
  const [cron, setCron] = useState<McCronJob[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<CronSchedulerStatus | null>(null);
  const [cronSchedule, setCronSchedule] = useState('');
  const [cronPrompt, setCronPrompt] = useState('');
  const [cronName, setCronName] = useState('');
  const [cronLoading, setCronLoading] = useState(false);
  const [cronError, setCronError] = useState<string | null>(null);
  // Live clock for the cron next-fire countdowns — ticks only while the modal
  // is open (seeded once, never read via Date.now() inside render).
  const [cronNow, setCronNow] = useState(0);

  const loadCron = () => getMcCron().then((d) => { setCron(d.jobs || []); setSchedulerStatus(d.scheduler || null); }).catch(() => {});

  useEffect(() => { fetchTasks(); fetchStats(); fetchBoards(); fetchDiagnostics(); loadCron(); }, [fetchTasks, fetchStats, fetchBoards, fetchDiagnostics]);

  // While the cron modal is open, keep a 1s clock so the next-fire countdowns
  // tick live. Seed immediately, then interval; torn down on close.
  useEffect(() => {
    if (!cronOpen) return;
    setCronNow(Date.now());
    const t = setInterval(() => setCronNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [cronOpen]);

  // Parse each job's schedule and sort soonest-fire first; intervals and
  // unparseable schedules (no anchorable next fire) sink to the bottom.
  const cronView = useMemo(() => {
    const now = cronNow || 0;
    return cron
      .map((job) => ({ job, sched: parseSchedule(job.schedule || job.repeat, now) }))
      .sort((a, b) => {
        const an = a.sched.nextMs ?? Infinity;
        const bn = b.sched.nextMs ?? Infinity;
        if (an !== bn) return an - bn;
        return (a.job.name || a.job.id).localeCompare(b.job.name || b.job.id);
      });
  }, [cron, cronNow]);

  const currentBoard = boards.find((b) => b.is_current);
  const diagCount = diagnostics.reduce((n, d) => n + (d.diagnostics?.length || 0), 0);
  const allTasks = useMemo(() => mcTasks.map((t) => ({ id: t.id, title: t.title })), [mcTasks]);

  // Task Search (⌘F) → open that task's drawer directly.
  const { focusId, nonce, clear: clearFocus } = useTaskFocusStore();
  useEffect(() => {
    if (!focusId) return;
    setOpenTaskId(focusId);
    clearFocus();
  }, [focusId, nonce, clearFocus]);

  // Profiles for assignee dropdowns: live agents ∪ assignees already on tasks.
  const profiles = useMemo(() => {
    const set = new Set<string>();
    nodes.filter((n) => n.type !== 'squad').forEach((n) => set.add(n.name));
    mcTasks.forEach((t) => { if (t.assignee) set.add(t.assignee); });
    return [...set].sort();
  }, [nodes, mcTasks]);

  const visibleTasks = useMemo(
    () => mcTasks.filter((t) => assigneeFilter === 'ALL' || (t.assignee || 'unassigned') === assigneeFilter),
    [mcTasks, assigneeFilter],
  );

  const byColumn = useMemo(() => {
    const map: Record<string, McTask[]> = {};
    COLUMNS.forEach((c) => (map[c.key] = []));
    visibleTasks.forEach((t) => { (map[colOf(t.status)] ||= []).push(t); });
    // priority desc within a column, then newest first
    Object.values(map).forEach((arr) => arr.sort((a, b) => (b.priority - a.priority) || (b.created_at - a.created_at)));
    return map;
  }, [visibleTasks]);

  const oldestReady = stats?.oldest_ready_age_seconds;

  const handleCreate = async () => {
    if (!cTitle.trim()) return;
    const t = await createTask({
      title: cTitle.trim(),
      body: cBody.trim() || undefined,
      assignee: cAssignee || undefined,
      priority: cPriority.trim() ? Number(cPriority) : undefined,
      skills: cSkills.trim() ? cSkills.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      triage: cTriage || undefined,
    });
    if (t) { setCreateOpen(false); setCTitle(''); setCBody(''); setCAssignee(''); setCPriority(''); setCSkills(''); setCTriage(false); }
  };

  const handleCreateCron = async () => {
    if (!cronSchedule.trim()) return;
    setCronLoading(true); setCronError(null);
    try {
      const data = await createMcCron({ schedule: cronSchedule.trim(), prompt: cronPrompt.trim() || undefined, name: cronName.trim() || undefined });
      setCron(data.jobs || []); setCronSchedule(''); setCronPrompt(''); setCronName('');
    } catch (err) { setCronError(errMessage(err)); } finally { setCronLoading(false); }
  };

  const handleDecompose = async () => {
    if (!decomposeText.trim()) return;
    setDecomposeLoading(true); setDecomposeResult(null);
    try {
      const data = await decomposeTask({ task: decomposeText.trim() });
      const subs = data?.subtasks || [];
      setDecomposeResult(subs);
      for (const sub of subs) await createTask({ title: sub.title, body: sub.body, assignee: sub.assignee });
    } catch (err) { console.error('Decompose failed:', err); } finally { setDecomposeLoading(false); }
  };

  return (
    <div className="h-full flex flex-col gap-2 p-2 min-h-0">
      {/* HEADER */}
      <div className="shrink-0 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] tracking-[0.2em] text-white font-bold">MISSION KANBAN</span>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <Chip k="TOTAL" v={summary?.total ?? mcTasks.length} c="text-white" />
          <Chip k="READY" v={stats?.by_status?.ready ?? summary?.ready ?? 0} c="text-sky-400" />
          <Chip k="RUNNING" v={stats?.by_status?.running ?? summary?.running ?? 0} c="text-amber-400" />
          <Chip k="BLOCKED" v={stats?.by_status?.blocked ?? summary?.blocked ?? 0} c="text-red-400" />
          <Chip k="FAILED" v={stats?.by_status?.failed ?? summary?.failed ?? 0} c="text-red-500" />
          <Chip k="DONE" v={stats?.by_status?.done ?? summary?.completed ?? 0} c="text-emerald-400" />
          {oldestReady != null && <Chip k="OLDEST READY" v={`${ago(Math.floor(Date.now() / 1000) - oldestReady)}`} c="text-[#b8b8b8]" />}
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] font-mono">
          {boards.length > 0 && (
            <select value={currentBoard?.slug || ''} onChange={(e) => { if (e.target.value === '__new__') setBoardModal(true); else void switchBoard(e.target.value); }}
              title="Active board" className="bg-[#080808] border border-white/10 px-2 py-1 text-white focus:border-[#f64e6e] outline-none">
              {boards.map((b) => <option key={b.slug} value={b.slug}>▣ {b.name || b.slug}</option>)}
              <option value="__new__">+ new board…</option>
            </select>
          )}
          <button onClick={() => { void fetchDiagnostics(); setDiagOpen(true); }} title="Board diagnostics"
            className={`border px-2 py-1 ${diagCount > 0 ? 'border-amber-400/50 text-amber-400' : 'border-white/10 text-[#b8b8b8] hover:border-white/30'}`}>
            ⚠ {diagCount}
          </button>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}
            className="bg-[#080808] border border-white/10 px-2 py-1 text-white focus:border-[#f64e6e] outline-none">
            <option value="ALL">ALL ASSIGNEES</option>
            {profiles.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={() => setCreateOpen(true)} className="border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] px-2 py-1 hover:bg-[#f64e6e]/20">+ TASK</button>
          <button onClick={() => { setDecomposeOpen(true); setDecomposeText(''); setDecomposeResult(null); }} className="border border-white/10 text-[#b8b8b8] px-2 py-1 hover:border-[#f64e6e] hover:text-[#f64e6e]">⚡ DECOMPOSE</button>
          <button onClick={() => { setCronOpen(true); setCronError(null); loadCron(); }} className="border border-white/10 text-[#b8b8b8] px-2 py-1 hover:border-[#f64e6e] hover:text-[#f64e6e]">⏱ CRON</button>
          <span className="text-[#545454] hidden xl:inline">{lastSync ? `synced ${lastSync.toLocaleTimeString()}` : '—'}</span>
        </div>
      </div>

      {error && <div className="shrink-0 px-2 py-1 border border-red-400/40 bg-[#050505]/80 text-red-400 font-mono text-[10px]">⚠ {error}</div>}

      {/* BOARD */}
      <div className="flex-1 min-h-0 flex gap-2 overflow-x-auto pb-1">
        {COLUMNS.map((col) => {
          const items = byColumn[col.key] || [];
          return (
            <div key={col.key} className="flex flex-col min-h-0 w-[230px] shrink-0 border border-white/[0.07] bg-[#070707]">
              <div className="shrink-0 flex items-center justify-between px-2 py-1.5 border-b border-white/10" style={{ boxShadow: `inset 3px 0 0 ${col.tone}` }}>
                <span className="text-[10px] font-mono tracking-[0.16em] font-bold" style={{ color: col.tone }}>{col.label}</span>
                <span className="text-[10px] font-mono text-[#545454]">{items.length}</span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-1.5 flex flex-col gap-1.5">
                {items.map((t) => (
                  <button key={t.id} data-task-id={t.id} onClick={() => setOpenTaskId(t.id)}
                    className={`text-left p-2 border bg-[#0b0b0b] hover:border-white/25 transition-colors ${openTaskId === t.id ? 'border-[#f64e6e]' : 'border-white/[0.08]'}`}>
                    <div className="flex items-start gap-1.5 mb-1">
                      <span className="mt-1 w-1.5 h-1.5 shrink-0" style={{ background: col.tone }} />
                      <span className="text-[11px] text-white leading-tight line-clamp-3">{t.title}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-[#545454]">
                      <span className="text-[#b8b8b8] truncate">{t.assignee || 'unassigned'}</span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {col.key === 'done' && hasDeliverable(t) && <span title="Deliverable available — open to view the result/branch" className="text-emerald-400">◆</span>}
                        {t.priority !== 0 && <span title="priority">P{t.priority}</span>}
                        {t.skills?.length > 0 && <span title="skills">⚙{t.skills.length}</span>}
                        <span>{ago(t.created_at)}</span>
                      </span>
                    </div>
                    {(col.key === 'ready' || col.key === 'running') && (
                      <div className="mt-1.5 flex">
                        {col.key === 'ready' && <span onClick={(e) => { e.stopPropagation(); void claimMcTaskById(t.id); }} className="flex-1 text-center text-[10px] font-mono border border-white/10 py-0.5 hover:border-amber-400 hover:text-amber-400 cursor-pointer">CLAIM</span>}
                        {col.key === 'running' && <span onClick={(e) => { e.stopPropagation(); void completeMcTaskById(t.id); }} className="flex-1 text-center text-[10px] font-mono border border-white/10 py-0.5 hover:border-emerald-400 hover:text-emerald-400 cursor-pointer">COMPLETE</span>}
                      </div>
                    )}
                  </button>
                ))}
                {items.length === 0 && <div className="text-[10px] font-mono text-[#363636] px-1 py-2 text-center">empty</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* DETAIL DRAWER */}
      <TaskDetailDrawer key={openTaskId ?? 'none'} taskId={openTaskId} profiles={profiles} allTasks={allTasks} onClose={() => setOpenTaskId(null)} onOpenTask={(id) => setOpenTaskId(id)} />

      {/* DIAGNOSTICS MODAL */}
      {diagOpen && (
        <Modal title={`BOARD DIAGNOSTICS · ${diagCount}`} onClose={() => setDiagOpen(false)}>
          {(() => {
            const staleCount = diagnostics.reduce((n, d) => n + (d.diagnostics?.filter((x) => x.kind === 'stale_claim').length || 0), 0);
            return (
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/[0.06]">
                <button
                  disabled={reconciling || staleCount === 0}
                  onClick={async () => {
                    setReconciling(true); setReconcileMsg(null);
                    const n = await reconcileBoard();
                    setReconcileMsg(n > 0 ? `✓ reclaimed ${n} stale claim${n === 1 ? '' : 's'} → ready` : 'no stale claims to reclaim');
                    setReconciling(false);
                  }}
                  title={staleCount === 0 ? 'No stale running claims to reclaim' : `Reclaim ${staleCount} stale running claim(s) back to ready`}
                  className={`text-[10px] font-mono border px-2 py-1 ${staleCount > 0 && !reconciling ? 'border-amber-400/50 text-amber-400 hover:bg-amber-400/10' : 'border-white/10 text-[#545454] cursor-default'}`}>
                  {reconciling ? '… reconciling' : `⟳ RECONCILE STALE${staleCount > 0 ? ` (${staleCount})` : ''}`}
                </button>
                {reconcileMsg && <span className="text-[10px] font-mono text-[#b8b8b8]">{reconcileMsg}</span>}
              </div>
            );
          })()}
          <div className="flex flex-col gap-1.5 max-h-[360px] overflow-auto">
            {diagnostics.length === 0 && <div className="text-[10px] font-mono text-emerald-400">✓ no active diagnostics — board healthy</div>}
            {diagnostics.map((d) => (
              <div key={d.task_id} className="border border-white/[0.06] bg-[#080808] p-2">
                <button onClick={() => { setOpenTaskId(d.task_id); setDiagOpen(false); }} className="flex items-center gap-2 text-left w-full mb-1 hover:text-[#f64e6e]">
                  <span className="text-[10px] font-mono text-[#545454]">{d.task_id}</span>
                  <span className="text-[11px] text-white truncate">{d.title}</span>
                </button>
                {d.diagnostics?.map((x, i) => (
                  <div key={i} className="text-[10px] font-mono flex items-start gap-1.5">
                    <span className={x.severity === 'critical' || x.severity === 'error' ? 'text-red-400' : 'text-amber-400'}>● {x.severity || x.kind}</span>
                    <span className="text-[#b8b8b8]">{x.message || x.kind}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* CREATE BOARD MODAL */}
      {boardModal && (
        <Modal title="CREATE BOARD" onClose={() => setBoardModal(false)}>
          <Field label="SLUG (kebab-case)"><input autoFocus value={newBoardSlug} onChange={(e) => setNewBoardSlug(e.target.value)} placeholder="client-acme" className={inputCls} /></Field>
          <Field label="NAME (optional)"><input value={newBoardName} onChange={(e) => setNewBoardName(e.target.value)} placeholder="Client Acme" className={inputCls} /></Field>
          <button onClick={async () => { if (!newBoardSlug.trim()) return; const ok = await createBoard(newBoardSlug.trim(), newBoardName.trim() || undefined, undefined, true); if (ok) { setBoardModal(false); setNewBoardSlug(''); setNewBoardName(''); await fetchTasks(); await fetchStats(); } }}
            disabled={!newBoardSlug.trim()} className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] py-1.5 hover:bg-[#f64e6e]/20 disabled:opacity-30">+ CREATE & SWITCH</button>
        </Modal>
      )}

      {/* CREATE MODAL */}
      {createOpen && (
        <Modal title="CREATE TASK" onClose={() => setCreateOpen(false)}>
          <Field label="TITLE">
            <input autoFocus value={cTitle} onChange={(e) => setCTitle(e.target.value)} placeholder="Task title…" className={inputCls} />
          </Field>
          <Field label="BODY (optional)">
            <textarea value={cBody} onChange={(e) => setCBody(e.target.value)} rows={3} placeholder="Opening post / context…" className={`${inputCls} resize-none`} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="ASSIGNEE">
              <select value={cAssignee} onChange={(e) => setCAssignee(e.target.value)} className={inputCls}>
                <option value="">unassigned</option>
                {profiles.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="PRIORITY">
              <input value={cPriority} onChange={(e) => setCPriority(e.target.value)} placeholder="0" inputMode="numeric" className={inputCls} />
            </Field>
          </div>
          <Field label="SKILLS (comma-separated)">
            <input value={cSkills} onChange={(e) => setCSkills(e.target.value)} placeholder="research, copy, sql" className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 text-[10px] font-mono text-[#b8b8b8]">
            <input type="checkbox" checked={cTriage} onChange={(e) => setCTriage(e.target.checked)} />
            Park in TRIAGE (a specifier fleshes out the spec before promotion)
          </label>
          <button onClick={() => void handleCreate()} disabled={!cTitle.trim()} className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] py-1.5 hover:bg-[#f64e6e]/20 disabled:opacity-30">+ CREATE CLAUDE TASK</button>
        </Modal>
      )}

      {/* DECOMPOSE MODAL */}
      {decomposeOpen && (
        <Modal title="DECOMPOSE TASK" onClose={() => setDecomposeOpen(false)}>
          <textarea value={decomposeText} onChange={(e) => setDecomposeText(e.target.value)} placeholder="Describe the complex task to decompose…" rows={4} className={`${inputCls} resize-none`} />
          <button onClick={() => void handleDecompose()} disabled={decomposeLoading || !decomposeText.trim()} className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] py-1.5 hover:bg-[#f64e6e]/20 disabled:opacity-30">
            {decomposeLoading ? 'DECOMPOSING…' : '⚡ DECOMPOSE & CREATE SUBTASKS'}
          </button>
          {decomposeResult && (
            <div className="flex flex-col gap-1 mt-1">
              <div className="text-[10px] font-mono text-emerald-400">✓ {decomposeResult.length} sub-tasks created</div>
              {decomposeResult.map((sub, i) => (
                <div key={i} className="px-2 py-1 border border-white/[0.06] bg-[#080808] text-[10px] font-mono text-[#b8b8b8]">
                  <span className="text-white">{sub.title}</span>{sub.assignee && <span className="text-[#545454] ml-2">→ {sub.assignee}</span>}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* CRON MODAL */}
      {cronOpen && (
        <Modal title="SCHEDULED JOBS · mc cron" onClose={() => setCronOpen(false)}>
          <SchedulerStatusBar sched={schedulerStatus} />
          {cron.length > 0 && <CronTimeline jobs={cron} nowMs={cronNow} />}
          {cron.length > 0 && (
            <div className="flex items-center justify-between px-2 text-[10px] font-mono tracking-[0.2em] uppercase text-[#545454]">
              <span>JOB · SCHEDULE</span><span>NEXT FIRE ▾</span>
            </div>
          )}
          <div className="flex flex-col gap-1 max-h-[220px] overflow-auto">
            {cronView.map(({ job: j, sched }) => (
              <div key={j.id} className="flex items-center justify-between gap-2 px-2 py-1.5 border border-white/[0.06] bg-[#080808]">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-1.5 h-1.5 shrink-0" style={{ background: j.status === 'active' ? '#10b981' : '#545454' }} />
                  <div className="min-w-0">
                    <div className="text-[11px] text-white truncate">{j.name || j.id.slice(0, 12)}</div>
                    <div className="text-[10px] font-mono text-[#545454] truncate">{sched.label}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {j.last_status && (
                    <span
                      title={`last ${j.last_trigger || ''} fire: ${j.last_status}${j.last_detail ? ` — ${j.last_detail}` : ''}`}
                      className={`text-[9px] font-mono ${j.last_status === 'ok' ? 'text-[#10b981]' : 'text-red-400'}`}
                    >
                      {j.last_status === 'ok' ? '✓' : '⚠'}
                    </span>
                  )}
                  <CronNextFire sched={sched} nowMs={cronNow} />
                  <button onClick={() => void runMcCron(j.id)} className="text-[10px] font-mono border border-white/10 px-2 py-1 hover:border-[#f64e6e] hover:text-[#f64e6e]">RUN</button>
                </div>
              </div>
            ))}
            {cron.length === 0 && <div className="text-[10px] font-mono text-[#545454] p-2">No scheduled jobs.</div>}
          </div>
          <div className="border-t border-white/10 pt-2 flex flex-col gap-1.5">
            <Field label="SCHEDULE"><input value={cronSchedule} onChange={(e) => setCronSchedule(e.target.value)} placeholder="30m · every 2h · 0 9 * * *" className={inputCls} /></Field>
            <Field label="NAME (optional)"><input value={cronName} onChange={(e) => setCronName(e.target.value)} placeholder="morning-brief" className={inputCls} /></Field>
            <Field label="PROMPT (optional)"><textarea value={cronPrompt} onChange={(e) => setCronPrompt(e.target.value)} rows={2} placeholder="Self-contained instruction…" className={`${inputCls} resize-none`} /></Field>
            {cronError && <div className="text-[10px] font-mono text-red-400">⚠ {cronError}</div>}
            <button onClick={() => void handleCreateCron()} disabled={cronLoading || !cronSchedule.trim()} className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] py-1.5 hover:bg-[#f64e6e]/20 disabled:opacity-30">{cronLoading ? 'SCHEDULING…' : '+ SCHEDULE JOB'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const inputCls = 'bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none w-full';

function Chip({ k, v, c }: { k: string; v: number | string; c: string }) {
  return (
    <span className="flex items-center gap-1.5 px-2 py-1 border border-white/10 bg-[#080808]">
      <span className="text-[#545454] tracking-[0.1em]">{k}</span><span className={`font-bold tabular-nums ${c}`}>{v}</span>
    </span>
  );
}

// Honest liveness banner for the in-bridge cron daemon. Without it, the
// next-fire countdowns below are aspirational — this says whether anything is
// actually firing them. Older bridges (pre-scheduler) return no scheduler field.
function SchedulerStatusBar({ sched }: { sched: CronSchedulerStatus | null }) {
  if (!sched) {
    return (
      <div className="mb-2 px-2 py-1.5 border border-amber-500/30 bg-amber-500/5 text-[10px] font-mono text-amber-400">
        ⚠ SCHEDULER STATUS UNKNOWN — bridge predates the cron daemon (restart to enable). Countdowns below will not fire on their own.
      </div>
    );
  }
  const live = sched.enabled && sched.running;
  return (
    <div className={`mb-2 px-2 py-1.5 border text-[10px] font-mono flex items-center justify-between gap-2 ${live ? 'border-[#10b981]/30 bg-[#10b981]/5 text-[#10b981]' : 'border-amber-500/30 bg-amber-500/5 text-amber-400'}`}>
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5" style={{ background: live ? '#10b981' : '#f59e0b' }} />
        {live ? `DAEMON LIVE · tick ${sched.tick_seconds}s` : sched.enabled ? 'DAEMON STARTING…' : 'DAEMON DISABLED (MC_SCHEDULER_ENABLED=0)'}
      </span>
      <span className="text-[#545454]">fired {sched.fired} · err {sched.errors}</span>
    </div>
  );
}

// Compact next-fire badge for a cron row. Cron expressions show a live
// "in 3h 12m" countdown (+ the absolute fire time as a tooltip); interval
// jobs have no anchorable next fire, so they show "↻ repeats"; anything
// unparseable shows a muted dash.
function CronNextFire({ sched, nowMs }: { sched: ParsedSchedule; nowMs: number }) {
  if (sched.kind === 'cron' && sched.nextMs !== null) {
    const delta = sched.nextMs - nowMs;
    const soon = delta <= 60000; // < 1 min away → coral
    return (
      <span
        title={`Next fire: ${fireLabel(sched.nextMs)} (local)`}
        className={`text-[10px] font-mono tabular-nums px-1.5 py-1 border whitespace-nowrap ${soon ? 'border-[#f64e6e]/40 text-[#f64e6e] bg-[#f64e6e]/10' : 'border-white/10 text-[#b8b8b8]'}`}
      >
        ▸ {formatCountdown(delta)}
      </span>
    );
  }
  if (sched.kind === 'interval') {
    return <span title="Interval job — fires on a fixed period" className="text-[10px] font-mono text-[#545454] px-1.5 py-1 whitespace-nowrap">↻ repeats</span>;
  }
  return <span className="text-[10px] font-mono text-[#545454] px-1.5 py-1">—</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-mono tracking-[0.2em] uppercase text-[#545454]">{label}</label>
      {children}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0A0A0A] border border-white/10 w-full max-w-lg mx-4 max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-3 h-[26px] shrink-0 flex items-center justify-between border-b border-white/10 bg-[#080808]">
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase font-bold text-[#b8b8b8] truncate">{title}</span>
          <button onClick={onClose} className="text-[#545454] hover:text-white text-[11px] shrink-0 ml-2">✕</button>
        </div>
        <div className="p-3 flex flex-col gap-2 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
