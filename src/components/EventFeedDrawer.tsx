// Board-wide event feed — the operator's "what just happened" pulse.
//
// The per-task EVENT TIMELINE (TaskDetailDrawer, run #21) made a single task's
// events legible, but to see recent claims/completions/blocks/promotions/
// dependency-edges ACROSS the whole board an operator had to open each task
// drawer one by one. This drawer fixes that: it pulls /api/mc/events (the full
// per-task event taxonomy merged newest-first — distinct from the 3-entry
// synthesized /api/mc/activity feed) and lists every recorded state change with
// an icon + readable label (reusing run #21's labelFor/eventParent), the owning
// task's title (clickable → its detail drawer), the assignee, and the
// dependency-edge parent for dep rows. Read-only, honest-empty, LIVE-backed.
//
// Run #23 — the feed is now LIVE: while open it re-polls /api/mc/events every
// 5s (mirroring useActivityStore's narrow-feed polling) so the operator sees
// new events without close+reopen, with a ● LIVE pulse + pause/resume toggle and
// a kind-filter chip row (all / lifecycle / dependency / orchestration), since
// the full event taxonomy can get noisy.
//
// Run #24 — graceful coarse-feed fallback so the drawer WORKS against a bridge
// that predates /api/mc/events (run #22's endpoint). When that endpoint 404s,
// the drawer degrades to the always-present /api/mc/activity feed (3 synthesized
// created/claimed/completed entries per task) instead of showing a bare error —
// real board activity now, auto-upgrading to the full taxonomy once the bridge
// is restarted. A small BASIC chip marks the degraded mode honestly.
import { useEffect, useMemo, useState } from 'react';
import { getRecentEvents, getMcActivity, errMessage, type McEvent, type McActivity } from '../lib/api';
import { labelFor, eventParent } from '../lib/eventLabels';

const POLL_MS = 5000;

// Coarse categories layered over the fine-grained event `kind` taxonomy so the
// operator can filter a noisy board. Kept local (not in eventLabels.ts) so this
// drawer stays a single self-contained surface; unknown kinds match only "all".
type Category = 'lifecycle' | 'dependency' | 'orchestration';
const CATEGORY_OF: Record<string, Category> = {
  created: 'lifecycle', claimed: 'lifecycle', started: 'lifecycle', completed: 'lifecycle',
  blocked: 'lifecycle', unblocked: 'lifecycle', failed: 'lifecycle', archived: 'lifecycle',
  comment: 'lifecycle', edited: 'lifecycle', specified: 'lifecycle',
  dependency_hold: 'dependency', dependency_clear: 'dependency',
  dependency_link: 'dependency', dependency_unlink: 'dependency',
  assigned: 'orchestration', reassigned: 'orchestration', reclaimed: 'orchestration',
  reconciled: 'orchestration', requeued: 'orchestration', routed: 'orchestration',
  promoted: 'orchestration', escalated: 'orchestration', scheduled: 'orchestration',
  workspace_ready: 'orchestration',
};
const FILTERS: Array<{ key: Category | 'all'; label: string }> = [
  { key: 'all', label: 'all' },
  { key: 'lifecycle', label: 'lifecycle' },
  { key: 'dependency', label: 'dependency' },
  { key: 'orchestration', label: 'orchestration' },
];

function ago(unixSeconds: number | null): string {
  if (!unixSeconds) return '—';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Coarse-feed fallback (run #24): the bridge's /api/mc/activity synthesizes one
// row per task lifecycle moment (status created/running/complete). Map each onto
// the McEvent shape the row renderer already speaks so the drawer can show real
// activity when the full /api/mc/events taxonomy isn't available yet. The coarse
// feed has no dependency-edge payloads, so these all land in the `lifecycle`
// category (dependency/orchestration chips honestly read 0 in fallback mode).
const ACTIVITY_KIND: Record<string, string> = { created: 'created', running: 'claimed', complete: 'completed' };
function activityToEvents(activities: McActivity[]): McEvent[] {
  return activities.map((a) => {
    const dot = a.action.indexOf('·'); // action is "<verb> · <task title>"
    return {
      task_id: a.id.replace(/-[a-z]$/, ''), // strip the -c/-s/-d lifecycle suffix
      title: (dot >= 0 ? a.action.slice(dot + 1) : a.action).trim(),
      assignee: a.agent || null,
      task_status: a.status || null,
      kind: ACTIVITY_KIND[a.status] || a.status || 'edited',
      payload: null,
      created_at: a.timestamp ?? null,
      run_id: null,
    };
  });
}

export default function EventFeedDrawer({ open, onClose, onOpenTask, embedded }: { open: boolean; onClose: () => void; onOpenTask?: (taskId: string) => void; embedded?: boolean }) {
  const [events, setEvents] = useState<McEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<Category | 'all'>('all');
  // Free-text search (run #66): isolate one task's / one agent's events out of a
  // 100+ row feed when the coarse category chips are too broad.
  const [query, setQuery] = useState('');
  // True while showing the coarse /api/mc/activity fallback (older bridge).
  const [fallback, setFallback] = useState(false);

  // LIVE polling: mounted fresh each time the drawer opens (parent keys on
  // `open`). Fetch immediately, then re-poll every POLL_MS so the feed reflects
  // new board activity without a close+reopen. Pausing tears the interval down;
  // resuming re-runs the effect (immediate refetch). The `live` guard drops
  // in-flight results after unmount/close so we never set state on a dead view.
  useEffect(() => {
    if (!open || paused) return;
    let live = true;
    const fetchOnce = () => {
      getRecentEvents(100)
        .then((r) => { if (live) { setEvents(r.events); setTotal(r.total); setFallback(false); setError(null); } })
        .catch(() =>
          // Full taxonomy endpoint unavailable (bridge predates /api/mc/events →
          // 404, or a transient error): degrade to the live coarse feed rather
          // than leaving the operator with a bare error. Auto-upgrades next poll
          // once the endpoint is reachable.
          getMcActivity()
            .then((r) => { if (live) { const ev = activityToEvents(r.activities); setEvents(ev); setTotal(ev.length); setFallback(true); setError(null); } })
            .catch((e) => { if (live) setError(errMessage(e)); }),
        )
        .finally(() => { if (live) setLoading(false); });
    };
    fetchOnce();
    const id = setInterval(fetchOnce, POLL_MS);
    return () => { live = false; clearInterval(id); };
  }, [open, paused]);

  // Free-text search applied FIRST, then the coarse category filter (AND), so
  // the chip counts below reflect the searched subset (not the whole feed). A
  // case-insensitive substring over each event's title + assignee + task_id +
  // kind — pure view state over the already-fetched events, no new endpoint/poll.
  const needle = query.trim().toLowerCase();
  const searched = useMemo(
    () => (needle === ''
      ? events
      : events.filter((e) => `${e.title} ${e.assignee ?? ''} ${e.task_id} ${e.kind}`.toLowerCase().includes(needle))),
    [events, needle],
  );
  // Per-category counts (for the chip badges) + the filtered slice, recomputed
  // only when the searched list or active filter changes.
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: searched.length, lifecycle: 0, dependency: 0, orchestration: 0 };
    for (const e of searched) { const cat = CATEGORY_OF[e.kind]; if (cat) c[cat] += 1; }
    return c;
  }, [searched]);
  const shown = useMemo(
    () => (filter === 'all' ? searched : searched.filter((e) => CATEGORY_OF[e.kind] === filter)),
    [searched, filter],
  );

  if (!open) return null;

  const panel = (
    <div onClick={(e) => e.stopPropagation()}
      className={embedded
        ? 'w-full h-full flex flex-col font-mono text-[11px]'
        : 'w-full max-w-3xl h-[80vh] flex flex-col border border-white/15 bg-[#070707] font-mono text-[11px]'}>
        {/* header */}
        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="tracking-[0.2em] text-white font-bold">▦ ACTIVITY</span>
            {/* live/paused indicator — also the toggle */}
            <button
              onClick={() => setPaused((p) => !p)}
              title={paused ? 'feed paused — click to resume live polling' : 'live — polling every 5s; click to pause'}
              className={`flex items-center gap-1 border px-1.5 py-0.5 rounded-sm text-[9px] tracking-[0.15em] ${paused
                ? 'border-amber-400/30 text-amber-300/90 hover:border-amber-400/60'
                : 'border-emerald-400/30 text-emerald-300/90 hover:border-emerald-400/60'}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${paused ? 'bg-amber-400/80' : 'bg-emerald-400 animate-pulse'}`} />
              {paused ? 'PAUSED' : 'LIVE'}
            </button>
            {/* honest degraded-mode marker: the full event taxonomy isn't live
                on this bridge, so we're showing the coarse lifecycle feed */}
            {fallback && (
              <span
                title="coarse lifecycle feed (/api/mc/activity) — the full event taxonomy (/api/mc/events) loads on bridge restart"
                className="border border-amber-400/30 text-amber-300/90 px-1.5 py-0.5 rounded-sm text-[9px] tracking-[0.15em]">
                BASIC
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[#777]">
            <span>{shown.length}{total > shown.length ? ` of ${total}` : ''} event{total === 1 ? '' : 's'}</span>
            {!embedded && <button onClick={onClose} className="ml-2 border border-white/10 px-2 py-0.5 text-[#b8b8b8] hover:border-white/30">✕ CLOSE</button>}
          </div>
        </div>

        {/* free-text search over title · assignee · task_id · kind (run #66) */}
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b border-white/[0.07]">
          <span className="text-[#666] text-[11px]">⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search title · assignee · task · kind…"
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-[11px] text-white placeholder:text-[#555]" />
          {query && (
            <button
              onClick={() => setQuery('')}
              title="clear search"
              className="shrink-0 border border-white/10 text-[#888] hover:border-white/30 hover:text-[#b8b8b8] px-1 rounded-sm text-[10px]">
              ✕
            </button>
          )}
        </div>

        {/* filter chips — coarse categories over the fine event taxonomy */}
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b border-white/[0.07] text-[10px]">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`border px-1.5 py-0.5 rounded-sm tracking-[0.1em] ${filter === f.key
                ? 'border-white/40 text-white bg-white/[0.06]'
                : 'border-white/10 text-[#888] hover:border-white/25 hover:text-[#b8b8b8]'}`}>
              {f.label} <span className="text-[#555]">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && <div className="p-3 text-[#777]">loading…</div>}
          {error && <div className="p-3 text-red-400">⚠ {error}</div>}
          {!loading && !error && events.length === 0 && (
            <div className="p-3 text-[#777] leading-relaxed">
              No board activity yet. Task lifecycle events (claim / complete / block /
              route / promote / dependency edges …) appear here as they're recorded.
            </div>
          )}
          {!loading && !error && events.length > 0 && shown.length === 0 && (
            <div className="p-3 text-[#777]">
              No {filter === 'all' ? '' : `${filter} `}events{needle ? <> match <span className="text-[#b8b8b8]">"{query.trim()}"</span></> : ` in the last ${events.length}`}.
              {(needle || filter !== 'all') && (
                <button
                  onClick={() => { setQuery(''); setFilter('all'); }}
                  className="ml-2 border border-white/10 px-1.5 py-0.5 rounded-sm text-[10px] text-[#888] hover:border-white/30 hover:text-[#b8b8b8]">
                  ✕ clear
                </button>
              )}
            </div>
          )}
          {shown.map((e, i) => {
            const { label, icon } = labelFor(e.kind);
            const parent = eventParent(e.payload);
            return (
              <div key={`${e.task_id}-${e.kind}-${e.created_at}-${i}`}
                className="flex items-baseline gap-2 px-3 py-1.5 border-b border-white/[0.05] hover:bg-white/[0.03]">
                <span className="text-[#777] shrink-0 w-4 text-center" title={e.kind}>{icon}</span>
                <span className="text-[#cfcfcf] shrink-0 w-[88px]" title={e.kind}>{label}</span>
                {/* task title — clickable deep-link to the producing task's drawer */}
                <button
                  onClick={onOpenTask ? () => { onClose(); onOpenTask(e.task_id); } : undefined}
                  disabled={!onOpenTask}
                  title={onOpenTask ? `open task ${e.task_id}` : e.task_id}
                  className={`flex-1 min-w-0 text-left truncate text-white ${onOpenTask ? 'cursor-pointer hover:text-[#f64e6e]' : ''}`}>
                  {e.title}
                </button>
                {parent && (
                  <button
                    onClick={onOpenTask ? () => { onClose(); onOpenTask(parent); } : undefined}
                    disabled={!onOpenTask}
                    title={onOpenTask ? `open parent ${parent}` : `parent ${parent}`}
                    className={`shrink-0 text-emerald-400/80 border border-emerald-400/25 px-1 rounded-sm ${onOpenTask ? 'cursor-pointer hover:bg-emerald-400/15 hover:text-emerald-300' : ''}`}>
                    ↳ {parent}
                  </button>
                )}
                {e.assignee && <span className="shrink-0 text-[#b8b8b8] truncate max-w-[90px]">{e.assignee}</span>}
                <span className="shrink-0 text-[#545454] w-[56px] text-right">{ago(e.created_at)}</span>
              </div>
            );
          })}
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
