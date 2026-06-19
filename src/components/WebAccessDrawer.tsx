// Board-wide WEB-ACCESS AUDIT glance — close the "see the rot → see the systemic
// fix" loop (run #26).
//
// The ⊘ BLOCKED drawer (run #25) names the systemic cause of the 6 long-blocked
// research tasks — "N WEB-GAP" — but the operator still can't see the *full*
// per-agent audit (which agents need the live web, what MCPs they actually carry,
// how many tasks each one is blocking) without opening the ⚠ diagnostics modal.
// This drawer surfaces /api/mc/agents/web-access directly: every agent that needs
// web access, gap-first (most-blocking first), each with its blocked-task count,
// the MCPs it has, the web-leaning skills that flagged it, and the one-line
// provisioning hint. It is the cross-link target of the ⊘ BLOCKED "WEB-GAP" chip.
//
// Honest + LIVE-backed: read-only (it surfaces the gap, it does NOT provision —
// adding a web MCP is operator config), no demo rows, honest empty/amber/error
// states, and a graceful message if the audit endpoint is unavailable.
import { useEffect, useMemo, useRef, useState } from 'react';
import { getWebAccessAudit, getMcTasks, errMessage, type WebAccessRow, type McTask } from '../lib/api';

export default function WebAccessDrawer({ open, onClose, embedded, focusAgent, onOpenTask }: {
  open: boolean;
  onClose: () => void;
  embedded?: boolean;
  // Optional: when the operator arrives here via a per-row cross-link (run #33), scroll
  // to and highlight this agent's audit row so the pivot lands on exactly the agent that
  // was blocking the queued task — not the whole list. Absent → unfocused full list.
  focusAgent?: string;
  // Optional deep-link: open a specific blocked task in the TaskDetailDrawer (run #37).
  // The expanded detail lists the agent's actual blocked tasks; each title hands off here.
  onOpenTask?: (taskId: string) => void;
}) {
  const [agents, setAgents] = useState<WebAccessRow[]>([]);
  const [summary, setSummary] = useState<{ total: number; needs_web: number; missing_web: number; blocked_due_to_web: number } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  // Live blocked tasks (run #37): the audit row carries a blocked COUNT but not *which*
  // tasks — cross-referencing the live task list lets the expanded detail name the exact
  // tasks each gap agent is blocking, as deep-links into the TaskDetailDrawer.
  const [blockedTasks, setBlockedTasks] = useState<McTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // Fetch the audit and the live task list together; the tasks back the per-agent
        // blocked-task deep-links. A task-list failure must NOT blank the audit (the audit
        // is the primary view) — degrade to "no deep-links" rather than erroring the panel.
        const [audit, tasks] = await Promise.all([
          getWebAccessAudit(),
          getMcTasks().catch(() => ({ tasks: [] as McTask[] })),
        ]);
        if (!live) return;
        setAgents(audit.agents);
        setSummary(audit.summary);
        setHint(audit.hint);
        setBlockedTasks(tasks.tasks.filter((t) => t.status === 'blocked'));
      } catch (e) {
        if (live) setError(errMessage(e));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [open]);

  // Group the live blocked tasks by assignee so each gap agent's expanded detail can list
  // the exact tasks it is blocking (oldest-first — the longest-stuck task is the priority).
  const blockedByAgent = useMemo(() => {
    const m = new Map<string, McTask[]>();
    for (const t of blockedTasks) {
      if (!t.assignee) continue;
      const arr = m.get(t.assignee) ?? [];
      arr.push(t);
      m.set(t.assignee, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.created_at - b.created_at);
    return m;
  }, [blockedTasks]);

  // Only the agents that actually need the live web are relevant to this audit.
  // Gap-first (an agent that needs web but has none), then by how many tasks it is
  // blocking (the most-blocking agent is the biggest lever), then by name.
  const needWeb = useMemo(
    () =>
      agents
        .filter((a) => a.needs_web)
        .sort((a, b) => Number(b.gap) - Number(a.gap) || b.blocked_tasks - a.blocked_tasks || a.name.localeCompare(b.name)),
    [agents],
  );
  // Agents that don't need web at all — surfaced only as an honest footer count so
  // the operator knows the audit covered the whole roster, not a filtered slice.
  const okCount = useMemo(() => agents.filter((a) => !a.needs_web).length, [agents]);

  // Per-agent expand state (run #36): the row shows a web-skills COUNT; clicking it
  // reveals the actionable detail — the specific web-leaning skills that flagged the
  // agent, the MCPs it already has, and the explicit missing piece (a web-search MCP).
  // So the provisioning fix is readable from the row itself, not just the tooltip.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // When focused via a cross-link, scroll the focused agent's row into view once the
  // audit has loaded. If the agent isn't in the audit (rare — the queue's web_gap and
  // the audit's gap set can drift), the ref stays null and we simply show the full list.
  // Also auto-expand the focused agent so the operator lands directly on its actionable
  // provisioning detail (the whole reason they cross-linked to this exact agent).
  const focusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!loading && focusAgent && focusRef.current) {
      focusRef.current.scrollIntoView({ block: 'center' });
    }
  }, [loading, focusAgent, needWeb]);
  useEffect(() => {
    if (!loading && focusAgent) setExpanded((prev) => new Set(prev).add(focusAgent));
  }, [loading, focusAgent]);

  if (!open) return null;

  const panel = (
    <div onClick={(e) => e.stopPropagation()}
      className={embedded
        ? 'w-full h-full flex flex-col font-mono text-[11px]'
        : 'w-full max-w-3xl h-[80vh] flex flex-col border border-white/15 bg-[#070707] font-mono text-[11px]'}>
        {/* header */}
        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="tracking-[0.2em] text-white font-bold">⚿ WEB-ACCESS</span>
            {summary != null && summary.missing_web > 0 && (
              <span
                title="agents that need the live web but have no web-search MCP"
                className="border border-amber-400/30 text-amber-300/90 px-1.5 py-0.5 rounded-sm text-[9px] tracking-[0.15em]">
                {summary.missing_web} MISSING
              </span>
            )}
            {summary != null && summary.blocked_due_to_web > 0 && (
              <span
                title="board tasks currently blocked because their assignee has no web MCP"
                className="border border-red-400/30 text-red-300/90 px-1.5 py-0.5 rounded-sm text-[9px] tracking-[0.15em]">
                {summary.blocked_due_to_web} BLOCKED
              </span>
            )}
            {focusAgent && (
              <span
                title={`focused on ${focusAgent} from the ⚡ DISPATCHABLE queue`}
                className="border border-amber-400/40 text-amber-200/90 px-1.5 py-0.5 rounded-sm text-[9px] tracking-[0.15em]">
                ▸ {focusAgent}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[#777]">
            <span>{needWeb.length} need web{okCount ? ` · ${okCount} ok` : ''}</span>
            {!embedded && <button onClick={onClose} className="ml-2 border border-white/10 px-2 py-0.5 text-[#b8b8b8] hover:border-white/30">✕ CLOSE</button>}
          </div>
        </div>

        {/* operator provisioning hint (from the audit) */}
        {hint && (
          <div className="shrink-0 px-3 py-1.5 border-b border-amber-400/15 bg-amber-400/[0.04] text-amber-300/80 text-[10px] leading-relaxed">
            ⚠ {hint}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && <div className="p-3 text-[#777]">loading…</div>}
          {error && <div className="p-3 text-red-400">⚠ {error}</div>}
          {!loading && !error && needWeb.length === 0 && (
            <div className="p-3 text-[#777] leading-relaxed">
              No agent needs live web access — every agent's skills are satisfied by
              its current tools. If a web-leaning skill is later assigned to an agent
              with no web MCP, it appears here with a provisioning hint.
            </div>
          )}
          {needWeb.map((a) => {
            const isOpen = expanded.has(a.name);
            const canExpand = a.web_skills.length > 0 || a.mcps.length > 0 || a.gap;
            return (
            <div key={a.name} ref={a.name === focusAgent ? focusRef : undefined}>
              <div
                role={canExpand ? 'button' : undefined}
                tabIndex={canExpand ? 0 : undefined}
                onClick={canExpand ? () => toggle(a.name) : undefined}
                onKeyDown={canExpand ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(a.name); } } : undefined}
                className={`flex items-baseline gap-2 px-3 py-1.5 border-b border-white/[0.05] ${canExpand ? 'cursor-pointer' : ''} ${
                  a.name === focusAgent ? 'bg-amber-400/[0.08] ring-1 ring-amber-400/30' : 'hover:bg-white/[0.03]'
                }`}>
                <span className="shrink-0 w-4 text-center" style={{ color: a.gap ? '#fbbf24' : '#4ade80' }}
                  title={a.gap ? 'needs web, has no web MCP' : 'needs web, has a web MCP'}>{a.gap ? '⚠' : '✓'}</span>
                <span className="shrink-0 w-[110px] text-left truncate text-white" title={a.name}>{a.name}</span>
                <span className={`shrink-0 w-[64px] text-right ${a.blocked_tasks > 0 ? 'text-red-300/90' : 'text-[#545454]'}`}
                  title="board tasks this agent is currently blocking">
                  {a.blocked_tasks > 0 ? `${a.blocked_tasks} blk` : '—'}
                </span>
                <span className="flex-1 min-w-0 truncate text-[#8a8a8a]" title={a.mcps.length ? `MCPs: ${a.mcps.join(', ')}` : 'no MCPs'}>
                  {a.mcps.length ? a.mcps.join(' · ') : <span className="text-[#545454]">no MCPs</span>}
                </span>
                <span className="shrink-0 truncate max-w-[150px] text-[#6f6f6f]"
                  title={a.web_skills.length ? `web-leaning skills: ${a.web_skills.join(', ')}` : 'flagged by role/profile'}>
                  {a.web_skills.length ? `${a.web_skills.length} web-skill${a.web_skills.length > 1 ? 's' : ''}` : '—'}
                  {canExpand && <span className="ml-1 text-[#545454]">{isOpen ? '▾' : '▸'}</span>}
                </span>
              </div>

              {/* actionable provisioning detail (run #36): the concrete why + fix, inline */}
              {isOpen && (
                <div className="px-3 py-2 border-b border-white/[0.05] bg-white/[0.015] leading-relaxed">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-[9px] tracking-[0.15em] text-[#666] w-[88px] shrink-0">WEB-LEANING</span>
                    {a.web_skills.length ? a.web_skills.map((s) => (
                      <span key={s} className="border border-white/10 text-[#9a9a9a] px-1.5 py-0.5 rounded-sm text-[9px]">{s}</span>
                    )) : <span className="text-[#545454] text-[10px]">flagged by role/profile (no explicit web skill)</span>}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-1.5 mt-1.5">
                    <span className="text-[9px] tracking-[0.15em] text-[#666] w-[88px] shrink-0">HAS MCPs</span>
                    {a.mcps.length ? a.mcps.map((m) => (
                      <span key={m} className="border border-white/10 text-[#8a8a8a] px-1.5 py-0.5 rounded-sm text-[9px]">{m}</span>
                    )) : <span className="text-[#545454] text-[10px]">none</span>}
                  </div>
                  {a.gap && (
                    <div className="flex flex-wrap items-baseline gap-1.5 mt-1.5">
                      <span className="text-[9px] tracking-[0.15em] text-amber-400/70 w-[88px] shrink-0">MISSING</span>
                      <span className="border border-amber-400/30 text-amber-300/90 px-1.5 py-0.5 rounded-sm text-[9px]">web-search MCP</span>
                      <span className="text-[10px] text-amber-300/60">→ add <code className="text-amber-300/90">web-brave-free</code> to <code className="text-amber-300/90">{a.name}</code>'s <code className="text-amber-300/90">mcps</code></span>
                    </div>
                  )}
                  {/* which tasks this agent is blocking (run #37) — the audit's blocked COUNT
                      made concrete: the actual task titles, deep-linked into the TaskDetailDrawer.
                      Closes "this agent needs web → because of THESE skills → which block THESE
                      specific tasks → open them." */}
                  {(() => {
                    const blocking = blockedByAgent.get(a.name) ?? [];
                    if (blocking.length === 0) return null;
                    return (
                      <div className="flex flex-wrap items-baseline gap-1.5 mt-1.5">
                        <span className="text-[9px] tracking-[0.15em] text-red-400/70 w-[88px] shrink-0">BLOCKS</span>
                        {blocking.map((t) => (
                          <button
                            key={t.id}
                            onClick={onOpenTask ? (e) => { e.stopPropagation(); onClose(); onOpenTask(t.id); } : undefined}
                            disabled={!onOpenTask}
                            title={onOpenTask ? `open blocked task ${t.id}` : t.id}
                            className={`border border-red-400/25 text-red-300/90 px-1.5 py-0.5 rounded-sm text-[9px] max-w-[230px] truncate text-left ${onOpenTask ? 'cursor-pointer hover:border-red-400/60 hover:text-red-200' : ''}`}>
                            {t.title}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
            );
          })}
        </div>

        {/* honest footer: the audit covered the whole roster */}
        {!loading && !error && summary != null && (
          <div className="shrink-0 px-3 py-1.5 border-t border-white/10 text-[10px] text-[#666] leading-relaxed">
            Audited {summary.total} agents · {summary.needs_web} need web · {summary.missing_web} missing a web MCP ·
            {' '}{summary.blocked_due_to_web} board task{summary.blocked_due_to_web === 1 ? '' : 's'} blocked by the gap.
            Read-only — provisioning a web MCP is operator config.
          </div>
        )}
      </div>
  );

  if (embedded) return panel;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      {panel}
    </div>
  );
}
