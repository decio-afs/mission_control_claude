// Full task control slide-over — the dashboard equivalent of `mc kanban show`
// + the lifecycle verbs. Fetches live detail (comments, events, runs, deps) and
// exposes every relevant action, gated by the task's current status.
import { useState, useEffect, useCallback } from 'react';
import { useTaskStore } from '../stores/useTaskStore';
import { Pill } from './cyberpunk/ui';
import TaskDependencyGraph from './TaskDependencyGraph';
import WorkerLogStream from './WorkerLogStream';
import {
  getMcTaskContext, getMcTaskLog, getTaskNotifications, subscribeTaskNotify, unsubscribeTaskNotify,
  getMcTaskWorkspace, getMcTaskWorkspaceFile,
  type TaskDetail, type NotifySubscription, type TaskWorkspace, type TaskWorkspaceFile,
} from '../lib/api';

const NOTIFY_PLATFORMS = ['telegram', 'discord', 'signal', 'whatsapp'];

// Lightweight markdown for task descriptions: bold heading lines + render
// `[ ]` / `[x]` as checkboxes, the way the official kanban renders specs.
function MarkdownLite({ text }: { text: string }) {
  return (
    <div className="text-[11px] text-[#b8b8b8] leading-relaxed flex flex-col">
      {text.split('\n').map((raw, i) => {
        const trimmed = raw.trim();
        if (!trimmed) return <div key={i} className="h-1.5" />;
        const line = raw.replace(/\[\s\]/g, '☐').replace(/\[[xX]\]/g, '☑');
        const isHeading = /^[A-Z][\w /&-]+$/.test(trimmed) && trimmed.length < 34 && !trimmed.includes('.');
        if (isHeading) return <div key={i} className="text-[#f64e6e] font-bold mt-1.5">{trimmed}</div>;
        return <div key={i} className="whitespace-pre-wrap">{line}</div>;
      })}
    </div>
  );
}

const STATUS_TONE: Record<string, 'good' | 'info' | 'bad' | 'warn' | 'neutral'> = {
  done: 'good', running: 'warn', ready: 'info', review: 'info',
  blocked: 'bad', failed: 'bad', scheduled: 'neutral', todo: 'neutral', triage: 'neutral',
};

// Which verbs make sense for a given status.
const ALLOW: Record<string, string[]> = {
  claim: ['ready'],
  complete: ['running', 'review'],
  reclaim: ['running'],
  promote: ['todo', 'triage', 'blocked'],
  unblock: ['blocked', 'scheduled'],
  block: ['todo', 'ready', 'running', 'review', 'triage'],
  schedule: ['todo', 'ready', 'blocked', 'triage'],
  archive: ['todo', 'ready', 'running', 'review', 'blocked', 'scheduled', 'done', 'triage'],
  edit: ['done'],
};

function ago(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const fmt = (u?: number | null) => (u ? new Date(u * 1000).toLocaleString() : '—');

// The "why" of a lifecycle event (block / fail / unblock reason, error text)
// lives in the event payload under one of several keys depending on the verb.
// Mc writes the human-readable reason here; without surfacing it the real
// "output" of a blocked/failed task is invisible (DELIV-2).
const DETAIL_KEYS = ['reason', 'message', 'error', 'detail', 'note'];
function eventDetail(payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  for (const k of DETAIL_KEYS) {
    const v = payload[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export default function TaskDetailDrawer({ taskId, profiles, allTasks, onClose, onOpenTask }: {
  taskId: string | null;
  profiles: string[];
  allTasks: { id: string; title: string }[];
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const {
    fetchTaskDetail, claimMcTaskById, completeMcTaskById, blockMcTaskById,
    unblockTask, promoteTask, scheduleTask, archiveTask, reassignTask, reclaimTask,
    commentTask, editTask, linkTasks, unlinkTasks, specifyTask,
  } = useTaskStore();

  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // LIFE-1: the reason the last action failed — store mutations resolve to
  // `false` (never throw) and stash the reason in the store's `error`, but the
  // drawer never read it, so a failed verb looked like a silent no-op.
  const [actError, setActError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [linkChild, setLinkChild] = useState('');
  const [linkParent, setLinkParent] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [editResult, setEditResult] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  // notify
  const [notifySubs, setNotifySubs] = useState<NotifySubscription[]>([]);
  const [nPlatform, setNPlatform] = useState('telegram');
  const [nChatId, setNChatId] = useState('');
  // context (worker log is self-contained in <WorkerLogStream/>)
  const [context, setContext] = useState<string | null>(null);
  // DELIV-3: raw worker-log tail used as the RESULT fallback for a finished
  // task that never wrote a summary/result (otherwise zero-visibility).
  const [rawOutput, setRawOutput] = useState<string | null>(null);
  // DELIV-4 slice b: lazily reveal the read-only workspace file browser.
  const [showWs, setShowWs] = useState(false);

  const load = useCallback(async () => {
    if (!taskId) return;
    const d = await fetchTaskDetail(taskId);
    setDetail(d);
    // DELIV-3: a finished task with no written summary/result is otherwise
    // zero-visibility — its only output lives in the raw worker log. Fall back
    // to the log tail so a done task is never blank. Reuses the existing
    // getMcTaskLog fetch (same endpoint <WorkerLogStream/> uses).
    const st = d?.task?.status ?? '';
    const hasSummary = !!((d?.latest_summary || d?.task?.result || '').trim());
    if ((st === 'done' || st === 'completed') && !hasSummary) {
      const r = await getMcTaskLog(taskId, 4000).catch(() => ({ log: '' }));
      setRawOutput((r.log || '').trim() || null);
    } else {
      setRawOutput(null);
    }
    const subs = await getTaskNotifications(taskId).then((r) => r.subscriptions).catch(() => []);
    setNotifySubs(subs);
    setLoaded(true);
  }, [taskId, fetchTaskDetail]);

  // The parent remounts this via `key={taskId}`, so a fresh mount already has
  // clean state — we just need to load the detail once. (setState inside `load`
  // only runs after the awaited fetch, so it isn't a synchronous effect update.)
  useEffect(() => { void load(); }, [load]);

  // Esc to close
  useEffect(() => {
    if (!taskId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [taskId, onClose]);

  if (!taskId) return null;

  const t = detail?.task;
  const status = t?.status ?? '';
  const allow = (verb: string) => ALLOW[verb]?.includes(status);

  // DELIV-2: the latest block/fail reason is the real deliverable of a stuck
  // task. Pull it from the most recent block/fail event payload and show it up
  // top so the operator never has to dig the timeline for *why* it's stuck.
  const blockFailReason = (status === 'blocked' || status === 'failed')
    ? [...(detail?.events ?? [])]
        .sort((a, b) => b.created_at - a.created_at)
        .map((e) => {
          const s = String(e.payload?.status ?? '').toLowerCase();
          const k = e.kind.toLowerCase();
          const isBF = s === 'blocked' || s === 'failed' || k.includes('block') || k.includes('fail');
          return isBF ? eventDetail(e.payload) : '';
        })
        .find((d) => d) ?? ''
    : '';

  // Run an action then refresh this drawer's detail. Store mutations resolve to
  // `false` (never throw) and stash the reason in the store's `error`; surface it
  // inline so a failed verb isn't a silent no-op (LIFE-1).
  const act = async (key: string, fn: () => Promise<boolean>) => {
    setBusy(key);
    setActError(null);
    try {
      const ok = await fn();
      if (!ok) setActError(useTaskStore.getState().error || `${key} failed`);
      await load();
    } catch (err) {
      setActError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[6000] bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-[6001] w-full max-w-[460px] bg-[#0A0A0A] border-l border-white/10 flex flex-col shadow-2xl">
        {/* header */}
        <div className="h-[40px] shrink-0 px-3 flex items-center justify-between border-b border-white/10 bg-[#080808]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[10px] text-[#545454]">{taskId}</span>
            {status && <Pill tone={STATUS_TONE[status] || 'neutral'}>{status.toUpperCase()}</Pill>}
          </div>
          <button onClick={onClose} className="text-[#545454] hover:text-white text-[11px]">✕ ESC</button>
        </div>

        {!loaded && <div className="p-4 font-mono text-[11px] text-[#545454]">loading task…</div>}

        {t && (
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
            {/* title + body */}
            <div>
              <div className="text-[13px] text-white leading-snug mb-1">{t.title}</div>
              {t.body && <div className="border-l-2 border-white/10 pl-2"><MarkdownLite text={t.body} /></div>}
            </div>

            {/* block / fail reason — the "why" of a stuck task, surfaced up top */}
            {blockFailReason && (
              <div className={`border px-2 py-1.5 ${status === 'failed' ? 'border-red-400/40 bg-red-400/[0.06]' : 'border-amber-400/40 bg-amber-400/[0.06]'}`}>
                <div className={`text-[10px] font-mono tracking-[0.16em] uppercase mb-0.5 ${status === 'failed' ? 'text-red-400' : 'text-amber-400'}`}>
                  {status === 'failed' ? '⚠ FAILED · REASON' : '⛔ BLOCKED · REASON'}
                </div>
                <div className="text-[11px] text-[#cdd3df] whitespace-pre-wrap leading-relaxed">{blockFailReason}</div>
              </div>
            )}

            {/* meta grid */}
            <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
              <Meta k="ASSIGNEE" v={t.assignee || 'unassigned'} accent={!!t.assignee} />
              <Meta k="PRIORITY" v={String(t.priority)} />
              <Meta k="WORKSPACE" v={t.workspace_kind || '—'} />
              <Meta k="CREATED BY" v={t.created_by || '—'} />
              <Meta k="CREATED" v={fmt(t.created_at)} />
              <Meta k="STARTED" v={fmt(t.started_at)} />
              <Meta k="COMPLETED" v={fmt(t.completed_at)} />
            </div>

            {/* file / branch artifacts — DELIV-4: where a task's deliverable
                physically lives. workspace_path was never surfaced and branch_name
                was only a bare, truncated, uncopyable meta cell — so a file/branch
                deliverable had no retrievable home. Copyable rows fix that. */}
            {(t.workspace_path || t.branch_name) && (
              <Section title="ARTIFACTS"
                right={t.workspace_path && (
                  <button onClick={() => setShowWs((s) => !s)}
                    className="text-[10px] font-mono tracking-[0.1em] px-1.5 py-0.5 border border-white/15 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e]">
                    {showWs ? '▾ HIDE FILES' : '⊞ BROWSE FILES'}
                  </button>
                )}>
                {t.workspace_path && <Artifact k="WORKSPACE PATH" v={t.workspace_path} />}
                {t.branch_name && <Artifact k="BRANCH" v={t.branch_name} />}
                {showWs && t.workspace_path && <WorkspaceBrowser taskId={taskId} />}
              </Section>
            )}

            {t.skills?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {t.skills.map((s) => <span key={s} className="text-[10px] font-mono px-1.5 py-0.5 border border-white/10 text-[#b8b8b8]">#{s}</span>)}
              </div>
            )}

            {/* result / summary — DELIV-3: a done task with no written summary
                falls back to the raw worker-log tail so finished work is never
                blank/zero-visibility. */}
            {(detail.latest_summary || t.result) ? (
              <Section title="RESULT / SUMMARY">
                <div className="text-[11px] text-[#cdd3df] whitespace-pre-wrap leading-relaxed">{detail.latest_summary || t.result}</div>
              </Section>
            ) : (status === 'done' || status === 'completed') && rawOutput ? (
              <Section title="RESULT / SUMMARY · RAW OUTPUT">
                <div className="text-[10px] font-mono text-[#545454] mb-1">no summary was written — showing the tail of the worker log</div>
                <pre className="text-[10px] font-mono text-[#9aa3b5] whitespace-pre-wrap max-h-52 overflow-auto bg-[#050505] border border-white/10 p-2">{rawOutput}</pre>
              </Section>
            ) : null}

            {/* actions */}
            <Section title="ACTIONS">
              <div className="grid grid-cols-3 gap-1.5">
                {status === 'triage' && <Btn busy={busy} id="specify" label="SPECIFY" cls="border-violet-400/40 text-violet-300 hover:bg-violet-400/10" onClick={() => act('specify', () => specifyTask(taskId))} />}
                {allow('claim') && <Btn busy={busy} id="claim" label="CLAIM" cls="border-amber-400/40 text-amber-400 hover:bg-amber-400/10" onClick={() => act('claim', () => claimMcTaskById(taskId))} />}
                {allow('complete') && <Btn busy={busy} id="complete" label="COMPLETE" cls="border-emerald-400/40 text-emerald-400 hover:bg-emerald-400/10" onClick={() => act('complete', () => completeMcTaskById(taskId))} />}
                {allow('promote') && <Btn busy={busy} id="promote" label="PROMOTE" cls="border-sky-400/40 text-sky-400 hover:bg-sky-400/10" onClick={() => act('promote', () => promoteTask(taskId, reason || undefined))} />}
                {allow('unblock') && <Btn busy={busy} id="unblock" label="UNBLOCK" cls="border-sky-400/40 text-sky-400 hover:bg-sky-400/10" onClick={() => act('unblock', () => unblockTask(taskId, reason || undefined))} />}
                {allow('schedule') && <Btn busy={busy} id="schedule" label="SCHEDULE" cls="border-white/15 text-[#b8b8b8] hover:border-white/30" onClick={() => act('schedule', () => scheduleTask(taskId, reason || undefined))} />}
                {allow('block') && <Btn busy={busy} id="block" label="BLOCK" cls="border-red-400/40 text-red-400 hover:bg-red-400/10" onClick={() => act('block', () => blockMcTaskById(taskId, reason || 'blocked from Mission Control'))} />}
                {allow('reclaim') && <Btn busy={busy} id="reclaim" label="RECLAIM" cls="border-white/15 text-[#b8b8b8] hover:border-white/30" onClick={() => act('reclaim', () => reclaimTask(taskId))} />}
                {allow('edit') && <Btn busy={busy} id="edit" label="EDIT RESULT" cls="border-white/15 text-[#b8b8b8] hover:border-white/30" onClick={() => setShowEdit((s) => !s)} />}
                <Btn busy={busy} id="archive" label="ARCHIVE" cls="border-white/15 text-[#545454] hover:border-red-400/40 hover:text-red-400" onClick={() => act('archive', async () => { const ok = await archiveTask(taskId); if (ok) onClose(); return ok; })} />
              </div>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="optional reason / note for the action above…"
                className="mt-1.5 w-full bg-[#080808] border border-white/10 px-2 py-1.5 text-[10px] font-mono text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none" />

              {/* LIFE-1: a failed action now shows why, instead of silently no-op'ing */}
              {actError && (
                <div className="mt-1.5 flex items-start justify-between gap-2 border border-red-400/40 bg-red-400/[0.06] px-2 py-1.5">
                  <div className="text-[10px] font-mono text-red-400 whitespace-pre-wrap leading-snug">⚠ {actError}</div>
                  <button onClick={() => setActError(null)} className="shrink-0 text-[#545454] hover:text-white text-[11px]">✕</button>
                </div>
              )}

              {showEdit && (
                <div className="mt-1.5 flex flex-col gap-1.5">
                  <textarea value={editResult} onChange={(e) => setEditResult(e.target.value)} rows={3} placeholder="Backfilled result text for this done task…"
                    className="w-full bg-[#080808] border border-white/10 px-2 py-1.5 text-[10px] font-mono text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none resize-none" />
                  <Btn busy={busy} id="editsave" label="SAVE RESULT" cls="border-[#f64e6e]/40 text-[#f64e6e] hover:bg-[#f64e6e]/10" disabled={!editResult.trim()} onClick={() => act('editsave', async () => { const ok = await editTask(taskId, editResult.trim()); if (ok) setShowEdit(false); return ok; })} />
                </div>
              )}
            </Section>

            {/* reassign */}
            <Section title="REASSIGN">
              <div className="flex gap-1.5">
                <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}
                  className="flex-1 bg-[#080808] border border-white/10 px-2 py-1.5 text-[10px] font-mono text-white focus:border-[#f64e6e] outline-none">
                  <option value="">select profile…</option>
                  <option value="none">⊘ unassign</option>
                  {profiles.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <Btn busy={busy} id="reassign" label="APPLY" cls="border-[#f64e6e]/40 text-[#f64e6e] hover:bg-[#f64e6e]/10" disabled={!reassignTo} onClick={() => act('reassign', () => reassignTask(taskId, reassignTo, status === 'running', reason || undefined))} />
              </div>
            </Section>

            {/* dependencies */}
            <Section title={`DEPENDENCIES · ${detail.parents.length}↑ ${detail.children.length}↓`}
              right={(detail.parents.length > 0 || detail.children.length > 0) && (
                <button onClick={() => setShowGraph(true)}
                  className="text-[10px] font-mono tracking-[0.1em] px-1.5 py-0.5 border border-white/15 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e]">⊞ MAP</button>
              )}>
              {detail.parents.length === 0 && detail.children.length === 0 && <div className="text-[10px] font-mono text-[#545454] mb-1">no dependencies</div>}
              {detail.parents.map((p) => <DepRow key={p} id={p} title={titleOf(allTasks, p)} dir="parent" onOpen={() => onOpenTask(p)} onUnlink={() => act('unlink', () => unlinkTasks(p, taskId))} />)}
              {detail.children.map((c) => <DepRow key={c} id={c} title={titleOf(allTasks, c)} dir="child" onOpen={() => onOpenTask(c)} onUnlink={() => act('unlink', () => unlinkTasks(taskId, c))} />)}
              <div className="flex gap-1.5 mt-1">
                <DepPicker value={linkParent} setValue={setLinkParent} placeholder="add parent…" options={allTasks.filter((o) => o.id !== taskId && !detail.parents.includes(o.id))} />
                <Btn busy={busy} id="linkp" label="+ PARENT" cls="border-white/15 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e]" disabled={!linkParent} onClick={() => act('linkp', async () => { const ok = await linkTasks(linkParent, taskId); if (ok) setLinkParent(''); return ok; })} />
              </div>
              <div className="flex gap-1.5 mt-1">
                <DepPicker value={linkChild} setValue={setLinkChild} placeholder="add child…" options={allTasks.filter((o) => o.id !== taskId && !detail.children.includes(o.id))} />
                <Btn busy={busy} id="linkc" label="+ CHILD" cls="border-white/15 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e]" disabled={!linkChild} onClick={() => act('linkc', async () => { const ok = await linkTasks(taskId, linkChild); if (ok) setLinkChild(''); return ok; })} />
              </div>
            </Section>

            {/* notify channels */}
            <Section title={`NOTIFY CHANNELS · ${notifySubs.length}`}>
              {notifySubs.map((s, i) => (
                <div key={i} className="flex items-center justify-between border border-white/[0.06] bg-[#080808] px-2 py-1 mb-1">
                  <span className="text-[10px] font-mono text-[#b8b8b8] truncate">{String(s.platform)} · {String(s.chat_id)}{s.thread_id ? `/${String(s.thread_id)}` : ''}</span>
                  <button disabled={!!busy} onClick={async () => { setBusy('noff'); try { await unsubscribeTaskNotify(taskId, { platform: String(s.platform), chat_id: String(s.chat_id), thread_id: s.thread_id ? String(s.thread_id) : undefined }); setNotifySubs(await getTaskNotifications(taskId).then((r) => r.subscriptions).catch(() => [])); } finally { setBusy(null); } }} className="text-[#545454] hover:text-red-400 text-[11px] shrink-0">✕</button>
                </div>
              ))}
              {notifySubs.length === 0 && <div className="text-[10px] font-mono text-[#545454] mb-1">no subscriptions</div>}
              <div className="flex gap-1.5 mt-1">
                <select value={nPlatform} onChange={(e) => setNPlatform(e.target.value)} className="bg-[#080808] border border-white/10 px-2 py-1.5 text-[10px] font-mono text-white focus:border-[#f64e6e] outline-none">
                  {NOTIFY_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input value={nChatId} onChange={(e) => setNChatId(e.target.value)} placeholder="chat id…" className="flex-1 bg-[#080808] border border-white/10 px-2 py-1.5 text-[10px] font-mono text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none" />
                <Btn busy={busy} id="non" label="+ SUB" cls="border-white/15 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e]" disabled={!nChatId.trim()} onClick={async () => { setBusy('non'); try { await subscribeTaskNotify(taskId, { platform: nPlatform, chat_id: nChatId.trim() }); setNChatId(''); setNotifySubs(await getTaskNotifications(taskId).then((r) => r.subscriptions).catch(() => [])); } finally { setBusy(null); } }} />
              </div>
            </Section>

            {/* comments */}
            <Section title={`COMMENTS · ${detail.comments.length}`}>
              <div className="flex flex-col gap-1.5 mb-1.5">
                {detail.comments.map((c, i) => (
                  <div key={i} className="border border-white/[0.06] bg-[#080808] p-1.5">
                    <div className="flex justify-between text-[10px] font-mono text-[#545454] mb-0.5">
                      <span className="text-[#b8b8b8]">{c.author}</span><span>{ago(c.created_at)}</span>
                    </div>
                    <div className="text-[10px] text-[#cdd3df] whitespace-pre-wrap leading-snug">{c.body}</div>
                  </div>
                ))}
                {detail.comments.length === 0 && <div className="text-[10px] font-mono text-[#545454]">no comments</div>}
              </div>
              <div className="flex gap-1.5">
                <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="add a comment…"
                  onKeyDown={(e) => { if (e.key === 'Enter' && comment.trim()) act('comment', async () => { const ok = await commentTask(taskId, comment.trim()); if (ok) setComment(''); return ok; }); }}
                  className="flex-1 bg-[#080808] border border-white/10 px-2 py-1.5 text-[10px] font-mono text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none" />
                <Btn busy={busy} id="comment" label="POST" cls="border-[#f64e6e]/40 text-[#f64e6e] hover:bg-[#f64e6e]/10" disabled={!comment.trim()} onClick={() => act('comment', async () => { const ok = await commentTask(taskId, comment.trim()); if (ok) setComment(''); return ok; })} />
              </div>
            </Section>

            {/* runs */}
            {detail.runs.length > 0 && (
              <Section title={`RUNS · ${detail.runs.length}`}>
                {detail.runs.map((r, i) => (
                  <div key={i} className="border border-white/[0.06] bg-[#080808] p-1.5 text-[10px] font-mono text-[#b8b8b8] mb-1">
                    <div className="flex justify-between"><span className="text-white">{r.profile || '—'}</span><span className={r.outcome === 'done' ? 'text-emerald-400' : 'text-[#545454]'}>{r.outcome || '—'}</span></div>
                    {r.summary != null && <div className="text-[#cdd3df] mt-0.5 whitespace-pre-wrap">{String(r.summary)}</div>}
                  </div>
                ))}
              </Section>
            )}

            {/* events */}
            <Section title={`EVENT TIMELINE · ${detail.events.length}`}>
              <div className="flex flex-col gap-1">
                {[...detail.events].reverse().map((e, i) => {
                  const d = eventDetail(e.payload);
                  return (
                    <div key={i} className="text-[10px] font-mono">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[#545454] shrink-0">{ago(e.created_at)}</span>
                        <span className="text-[#f64e6e] shrink-0">{e.kind}</span>
                        <span className="text-[#545454] truncate">{e.payload?.status ? `→ ${String(e.payload.status)}` : ''}</span>
                      </div>
                      {d && <div className="text-[#cdd3df] ml-2 mt-0.5 border-l border-white/10 pl-2 whitespace-pre-wrap leading-snug">{d}</div>}
                    </div>
                  );
                })}
              </div>
            </Section>

            {/* worker log — live-tailable (▶ LIVE re-polls every 2s while running) */}
            <Section title="WORKER LOG">
              <WorkerLogStream taskId={taskId} isRunning={status === 'running'} />
            </Section>

            {/* assembled context (lazy) */}
            <Section title="ASSEMBLED CONTEXT">
              {context === null
                ? <Btn busy={busy} id="ctx" label="LOAD CONTEXT" cls="border-white/15 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e] w-full" onClick={async () => { setBusy('ctx'); const r = await getMcTaskContext(taskId).catch(() => ({ context: '(no context available)' })); setContext(r.context || '(empty)'); setBusy(null); }} />
                : <pre className="text-[10px] font-mono text-[#9aa3b5] whitespace-pre-wrap max-h-52 overflow-auto bg-[#050505] border border-white/10 p-2">{context}</pre>}
            </Section>
          </div>
        )}
      </aside>

      {/* Full dependency-DAG map, opened from the DEPENDENCIES section. */}
      <TaskDependencyGraph
        rootId={showGraph ? taskId : null}
        onClose={() => setShowGraph(false)}
        onOpenTask={(id) => { setShowGraph(false); onOpenTask(id); }}
      />
    </>
  );
}

function Btn({ id, label, cls, onClick, disabled, busy }: { id: string; label: string; cls: string; onClick: () => void; disabled?: boolean; busy: string | null }) {
  return (
    <button onClick={onClick} disabled={!!busy || disabled}
      className={`text-[10px] font-mono border py-1.5 px-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${cls}`}>
      {busy === id ? '…' : label}
    </button>
  );
}

function Meta({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="border border-white/[0.06] bg-[#080808] px-2 py-1">
      <div className="text-[10px] tracking-[0.16em] text-[#545454]">{k}</div>
      <div className={`text-[10px] truncate ${accent ? 'text-[#f64e6e]' : 'text-[#cdd3df]'}`}>{v}</div>
    </div>
  );
}

// A full, untruncated, copyable artifact location (workspace path / branch) so
// the operator can actually retrieve a file/branch deliverable (DELIV-4).
function Artifact({ k, v }: { k: string; v: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start justify-between gap-2 border border-white/[0.06] bg-[#080808] px-2 py-1 mb-1">
      <div className="min-w-0">
        <div className="text-[10px] font-mono tracking-[0.16em] text-[#545454]">{k}</div>
        <div className="text-[10px] font-mono text-[#cdd3df] break-all leading-snug">{v}</div>
      </div>
      <button
        onClick={async () => { try { await navigator.clipboard.writeText(v); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard unavailable */ } }}
        title="Copy to clipboard"
        className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 border border-white/15 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e]">
        {copied ? '✓ COPIED' : '⧉ COPY'}
      </button>
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

// DELIV-4 slice b: a read-only browser for a task's workspace — lists the files
// the worker actually wrote (the deliverable), opens any text file inline, and
// shows git commits / diff --stat when the workspace is a repo. Self-contained
// (fetches on mount, like <WorkerLogStream/>); the bridge confines all reads to
// the workspace and only runs read-only git.
function WorkspaceBrowser({ taskId }: { taskId: string }) {
  const [ws, setWs] = useState<TaskWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<TaskWorkspaceFile | null>(null);
  const [fileLoading, setFileLoading] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getMcTaskWorkspace(taskId)
      .then((r) => { if (alive) setWs(r); })
      .catch(() => { if (alive) setWs(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [taskId]);

  if (loading) return <div className="text-[10px] font-mono text-[#545454] mt-1">loading workspace…</div>;
  if (!ws) return <div className="text-[10px] font-mono text-[#545454] mt-1">could not read workspace</div>;

  const openFile = async (rel: string) => {
    setFileLoading(rel);
    const r = await getMcTaskWorkspaceFile(taskId, rel).catch(() => null);
    if (r) setOpen(r);
    setFileLoading(null);
  };

  return (
    <div className="mt-1 flex flex-col gap-1">
      {ws.note && <div className="text-[10px] font-mono text-[#545454]">{ws.note}</div>}
      {ws.files.map((f) => (
        <div key={f.rel} className="flex items-center justify-between border border-white/[0.06] bg-[#080808] px-2 py-1">
          {f.is_dir ? (
            <span className="text-[10px] font-mono text-[#b8b8b8] truncate">📁 {f.name}/</span>
          ) : (
            <button onClick={() => openFile(f.rel)} disabled={!!fileLoading}
              className="text-[10px] font-mono text-[#cdd3df] hover:text-[#f64e6e] truncate text-left disabled:opacity-40">
              {fileLoading === f.rel ? '… ' : '📄 '}{f.name}
            </button>
          )}
          {f.size != null && <span className="text-[10px] font-mono text-[#545454] shrink-0 ml-2">{fmtBytes(f.size)}</span>}
        </div>
      ))}
      {ws.is_git && ws.log && (
        <div className="mt-1">
          <div className="text-[10px] font-mono tracking-[0.16em] text-[#545454] mb-0.5">COMMITS</div>
          <pre className="text-[10px] font-mono text-[#9aa3b5] whitespace-pre-wrap max-h-40 overflow-auto bg-[#050505] border border-white/10 p-2">{ws.log}</pre>
        </div>
      )}
      {ws.is_git && ws.diffstat && (
        <div className="mt-1">
          <div className="text-[10px] font-mono tracking-[0.16em] text-[#545454] mb-0.5">UNCOMMITTED CHANGES</div>
          <pre className="text-[10px] font-mono text-[#9aa3b5] whitespace-pre-wrap max-h-40 overflow-auto bg-[#050505] border border-white/10 p-2">{ws.diffstat}</pre>
        </div>
      )}
      {open && (
        <div className="mt-1 border border-white/10 bg-[#050505]">
          <div className="flex items-center justify-between px-2 py-1 border-b border-white/10">
            <span className="text-[10px] font-mono text-[#f64e6e] truncate">{open.file}{open.truncated ? ' · truncated' : ''}</span>
            <button onClick={() => setOpen(null)} className="text-[#545454] hover:text-white text-[11px] shrink-0">✕</button>
          </div>
          <pre className="text-[10px] font-mono text-[#9aa3b5] whitespace-pre-wrap max-h-72 overflow-auto p-2">{open.binary ? (open.note || 'binary file') : open.content}</pre>
        </div>
      )}
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="border-t border-white/10 pt-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] font-mono tracking-[0.2em] uppercase text-[#545454]">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function titleOf(all: { id: string; title: string }[], id: string): string {
  return all.find((t) => t.id === id)?.title ?? '';
}

function DepRow({ id, title, dir, onOpen, onUnlink }: { id: string; title: string; dir: 'parent' | 'child'; onOpen: () => void; onUnlink: () => void }) {
  return (
    <div className="flex items-center justify-between border border-white/[0.06] bg-[#080808] px-2 py-1 mb-1">
      <button onClick={onOpen} className="flex items-center gap-1.5 min-w-0 text-left hover:text-[#f64e6e]">
        <span className="text-[10px] text-[#545454] shrink-0">{dir === 'parent' ? '↑' : '↓'}</span>
        <span className="text-[10px] font-mono text-[#b8b8b8] shrink-0">{id}</span>
        {title && <span className="text-[10px] text-[#545454] truncate">{title}</span>}
      </button>
      <button onClick={onUnlink} title="Unlink" className="text-[#545454] hover:text-red-400 text-[11px] shrink-0">✕</button>
    </div>
  );
}

function DepPicker({ value, setValue, placeholder, options }: { value: string; setValue: (v: string) => void; placeholder: string; options: { id: string; title: string }[] }) {
  return (
    <select value={value} onChange={(e) => setValue(e.target.value)}
      className="flex-1 min-w-0 bg-[#080808] border border-white/10 px-2 py-1.5 text-[10px] font-mono text-white focus:border-[#f64e6e] outline-none">
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.id} · {o.title.slice(0, 40)}</option>)}
    </select>
  );
}
