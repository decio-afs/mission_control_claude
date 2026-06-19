// Board-wide BLOCKED-TASKS triage glance — make the board's single biggest rot
// visible without hunting (run #25).
//
// The board has carried 6 long-blocked research tasks for ~200h. Each is flagged
// `blocked_no_reason` by /api/mc/kanban/diagnostics, but the *real* cause is the
// web-access gap (their assignees have no web MCP — run #3's audit), and the only
// place to learn that today is the per-row diagnostics modal one task at a time.
// This drawer pulls the three live endpoints — /api/mc/tasks (the blocked set +
// age), /api/mc/kanban/diagnostics (the recorded "why", if any), and
// /api/mc/agents/web-access (the systemic web-gap cause) — and lists every blocked
// task oldest-first with its assignee, age, a one-line resolved reason, and a
// clickable deep-link to its detail drawer.
//
// Honest + LIVE-backed: no demo rows; an empty board shows an honest empty state;
// and if the web-access audit endpoint is unavailable (older bridge → 404) the
// drawer degrades to the recorded diagnostic reason rather than erroring (same
// coarse-fallback discipline as the ▦ ACTIVITY feed, run #24).
import { useEffect, useMemo, useState } from 'react';
import {
  getMcTasks,
  getKanbanDiagnostics,
  getWebAccessAudit,
  errMessage,
  type McTask,
  type BoardDiagnostic,
} from '../lib/api';

function ago(unixSeconds: number | null): string {
  if (!unixSeconds) return '—';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

interface BlockedRow {
  id: string;
  title: string;
  assignee: string | null;
  created_at: number | null;
  // Resolved one-line cause + how it should be cleared.
  reason: string;
  // Visual tone: web-gap (the systemic operator-config cause) reads amber so it
  // stands out from a generic "no recorded reason" (grey).
  tone: 'web' | 'reason' | 'none';
}

export default function BlockedTasksDrawer({ open, onClose, onOpenTask, onOpenAudit, embedded }: { open: boolean; onClose: () => void; onOpenTask?: (taskId: string) => void; onOpenAudit?: (agent?: string) => void; embedded?: boolean }) {
  const [rows, setRows] = useState<BlockedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // How many of the blocked set are blocked by the web-access gap (from the
  // audit summary) — surfaced in the header so the systemic cause is one glance.
  const [webBlocked, setWebBlocked] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // Tasks + diagnostics are core (must succeed). The web-access audit is a
        // best-effort enrichment: degrade to the recorded diagnostic reason if it
        // 404s on an older bridge.
        const [tasksRes, diagRes] = await Promise.all([getMcTasks(), getKanbanDiagnostics()]);
        let gapAgents = new Set<string>();
        let blockedDueToWeb: number | null = null;
        let auditHint: string | null = null;
        try {
          const audit = await getWebAccessAudit();
          gapAgents = new Set(audit.agents.filter((a) => a.gap).map((a) => a.name));
          blockedDueToWeb = audit.summary?.blocked_due_to_web ?? null;
          auditHint = audit.hint ?? null;
        } catch {
          // older bridge — fall back to recorded reasons only
        }

        // Index the diagnostics by task so we can read each task's recorded "why".
        const diagByTask = new Map<string, BoardDiagnostic>();
        for (const d of diagRes.diagnostics) diagByTask.set(d.task_id, d);

        const blocked = tasksRes.tasks.filter((t: McTask) => t.status === 'blocked');
        const built: BlockedRow[] = blocked.map((t) => {
          const diag = diagByTask.get(t.id);
          const recorded = diag?.diagnostics?.find((x) => x.kind && x.kind !== 'blocked_no_reason' && x.message)?.message;
          const noReason = diag?.diagnostics?.some((x) => x.kind === 'blocked_no_reason');
          const assignee = t.assignee || null;
          const hasWebGap = assignee != null && gapAgents.has(assignee);

          let reason: string;
          let tone: BlockedRow['tone'];
          if (recorded) {
            reason = recorded;
            tone = 'reason';
          } else if (hasWebGap) {
            // The systemic cause: the assignee can't run because it has no web MCP.
            reason = `needs web access — ${assignee} has no web-search MCP`;
            tone = 'web';
          } else if (noReason) {
            reason = 'blocked without a recorded reason';
            tone = 'none';
          } else {
            reason = 'blocked';
            tone = 'none';
          }
          return { id: t.id, title: t.title, assignee, created_at: t.created_at ?? null, reason, tone };
        });
        // Oldest first — the longest-blocked task is the biggest rot.
        built.sort((a, b) => (a.created_at ?? Infinity) - (b.created_at ?? Infinity));

        if (live) {
          setRows(built);
          setWebBlocked(blockedDueToWeb);
          setHint(auditHint);
        }
      } catch (e) {
        if (live) setError(errMessage(e));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [open]);

  const oldest = useMemo(() => (rows.length ? rows[0].created_at : null), [rows]);

  if (!open) return null;

  const panel = (
    <div onClick={(e) => e.stopPropagation()}
      className={embedded
        ? 'w-full h-full flex flex-col font-mono text-[11px]'
        : 'w-full max-w-3xl h-[80vh] flex flex-col border border-white/15 bg-[#070707] font-mono text-[11px]'}>
        {/* header */}
        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="tracking-[0.2em] text-white font-bold">⊘ BLOCKED</span>
            {webBlocked != null && webBlocked > 0 && (
              onOpenAudit ? (
                <button
                  onClick={() => onOpenAudit()}
                  title="open the full WEB-ACCESS audit — which agents need web, what MCPs they have, the provisioning fix"
                  className="border border-amber-400/30 text-amber-300/90 px-1.5 py-0.5 rounded-sm text-[9px] tracking-[0.15em] hover:border-amber-300 hover:text-amber-200 cursor-pointer">
                  {webBlocked} WEB-GAP ↗
                </button>
              ) : (
                <span
                  title="blocked because the assignee has no web-search MCP (operator config — see hint below)"
                  className="border border-amber-400/30 text-amber-300/90 px-1.5 py-0.5 rounded-sm text-[9px] tracking-[0.15em]">
                  {webBlocked} WEB-GAP
                </span>
              )
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[#777]">
            <span>{rows.length} blocked{oldest ? ` · oldest ${ago(oldest)}` : ''}</span>
            {!embedded && <button onClick={onClose} className="ml-2 border border-white/10 px-2 py-0.5 text-[#b8b8b8] hover:border-white/30">✕ CLOSE</button>}
          </div>
        </div>

        {/* operator hint for the systemic web-gap cause (from the audit) */}
        {hint && rows.some((r) => r.tone === 'web') && (
          <div className="shrink-0 px-3 py-1.5 border-b border-amber-400/15 bg-amber-400/[0.04] text-amber-300/80 text-[10px] leading-relaxed">
            ⚠ {hint}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && <div className="p-3 text-[#777]">loading…</div>}
          {error && <div className="p-3 text-red-400">⚠ {error}</div>}
          {!loading && !error && rows.length === 0 && (
            <div className="p-3 text-[#777] leading-relaxed">
              No blocked tasks — the board is clear. Tasks held by a dependency,
              an escalation, or a missing capability appear here with their reason
              and age the moment they're blocked.
            </div>
          )}
          {rows.map((r) => (
            <div key={r.id}
              className="flex items-baseline gap-2 px-3 py-1.5 border-b border-white/[0.05] hover:bg-white/[0.03]">
              <span className="shrink-0 w-4 text-center" style={{ color: r.tone === 'web' ? '#fbbf24' : r.tone === 'reason' ? '#f87171' : '#666' }} title={r.tone === 'web' ? 'web-access gap' : r.tone === 'reason' ? 'recorded reason' : 'no recorded reason'}>⊘</span>
              <button
                onClick={onOpenTask ? () => { onClose(); onOpenTask(r.id); } : undefined}
                disabled={!onOpenTask}
                title={onOpenTask ? `open task ${r.id}` : r.id}
                className={`shrink-0 w-[150px] text-left truncate text-white ${onOpenTask ? 'cursor-pointer hover:text-[#f64e6e]' : ''}`}>
                {r.title}
              </button>
              <span className={`flex-1 min-w-0 truncate ${r.tone === 'web' ? 'text-amber-300/80' : r.tone === 'reason' ? 'text-red-300/80' : 'text-[#777]'}`} title={r.reason}>
                {r.reason}
              </span>
              {r.assignee && (
                r.tone === 'web' && onOpenAudit ? (
                  // Per-row cross-link (run #35, symmetric to run #33's ⚡ DISPATCHABLE):
                  // open the ⚿ WEB-ACCESS audit focused on exactly this blocked task's
                  // assignee — go from "this task is stuck on the web gap" to "this agent's
                  // audit row" in one click, instead of the whole-list header chip.
                  <button onClick={() => onOpenAudit(r.assignee!)}
                    className="shrink-0 text-right truncate max-w-[90px] text-amber-300/90 hover:text-amber-200 hover:underline"
                    title={`${r.assignee} has no web-search MCP — open the ⚿ WEB-ACCESS audit focused on this agent`}>
                    {r.assignee} ↗
                  </button>
                ) : (
                  <span className="shrink-0 text-[#b8b8b8] truncate max-w-[90px]" title="assignee">{r.assignee}</span>
                )
              )}
              <span className="shrink-0 text-[#545454] w-[44px] text-right" title="blocked age (since created)">{ago(r.created_at)}</span>
            </div>
          ))}
        </div>
      </div>
  );

  if (embedded) return panel;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      {panel}
    </div>
  );
}
