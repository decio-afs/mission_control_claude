// Consolidated ⊙ AUTONOMY surface — one tabbed drawer over the four autonomy-
// observability views (run #32).
//
// Runs #22–#31 built four separate Operations toolbar drawers that together tell a
// single coherent story about the autonomy loop:
//   ▦ ACTIVITY      — what just happened across the board (recent events)
//   ⊘ BLOCKED       — what's stuck, and why (blocked-task triage)
//   ⚿ WEB-ACCESS    — which agents can't reach the live web (the systemic gap)
//   ⚡ DISPATCHABLE  — what the dispatcher would fire next + run state + autonomy gates
// …and they were even cross-linked (⊘ BLOCKED → ⚿ WEB-ACCESS in run #26, ⚡
// DISPATCHABLE → ⚿ WEB-ACCESS in run #31). But each was still its own toolbar button +
// its own full-screen modal, so the operator had to close one and open another to pivot
// between views — four buttons of toolbar clutter and a close+reopen for every hop.
//
// This wrapper collapses them into ONE tabbed surface. It owns the active tab and renders
// the existing drawer bodies in `embedded` mode (no inner backdrop / close — this shell
// provides the single backdrop + close + tab bar). The cross-link hand-offs become in-
// wrapper tab switches (⊘ BLOCKED / ⚡ DISPATCHABLE "WEB-GAP" chip → the ⚿ WEB-ACCESS
// tab) instead of close+reopen. Only the active tab is mounted, so switching tabs mounts
// the target drawer fresh — it re-fetches (and the live-polling drawers restart their
// poll) exactly as they did standalone, and an inactive tab's poll is torn down.
//
// Pure-frontend, read-only: every behavior (deep-links, live polling, honest empty/amber
// states) is inherited unchanged from the four drawers; this file adds no data fetching of
// its own. Each child still reaches its own LIVE bridge endpoints.
//
// Run #34: the last-open tab is persisted to localStorage so reopening the surface lands
// the operator back on the view they were last working in (instead of always ▦ ACTIVITY).
//
// Run #38: each tab button now carries a live numeric badge so the operator sees where
// attention is needed BEFORE opening a tab. On open the wrapper fetches the three cheap
// summaries once — the web-access audit (→ ⚿ WEB-ACCESS "MISSING" agent count), the task
// list (→ ⊘ BLOCKED count), and the dispatcher (→ ⚡ DISPATCHABLE ready count) — in parallel
// with a graceful degrade (a failed fetch just suppresses that one badge). Badges render
// only when count>0: amber for the two attention-gaps (MISSING / BLOCKED), emerald for
// dispatchable-ready. ▦ ACTIVITY carries none (a feed has no single "needs attention" count).
//
// Run #39: the badges now LIVE-REFRESH instead of being a fetch-once-on-open snapshot. The
// child drawers already live-poll their own bodies, but the tab-bar badges were frozen at
// open — so a count that changed while the surface stayed open (a task unblocked in another
// view, a research agent provisioned) went stale until close+reopen. The fetch is now a poll
// keyed [open, paused] (the run #29 DispatchableDrawer idiom): fetch immediately, then every
// REFRESH_MS until torn down, with a ● LIVE / ⏸ PAUSED header toggle to stop the interval.
// On a transient poll failure a field keeps its LAST GOOD value (the badge stays steady
// rather than flickering to absent); only the very first load can leave a field null.
//
// Run #40: the ⚡ DISPATCHABLE badge now carries the web-gap SPLIT, not just a flat ready
// count. The dispatcher poll already returns the full dispatchable[] list, every row tagged
// web_gap (it needs a web MCP its agent lacks). The badge showed only the total (e.g. "8"),
// hiding that 4 of those next-to-fire tasks would hit a web gap — exactly the thing TO-DO #1
// warns about ("pick a NON-web_gap task first"). The badge now reads "8 · 4⚠": the emerald
// ready count plus an amber web-gap segment, so the operator sees the queue's risk before
// opening the tab. Zero new dep — derived from the same getDispatcher poll (web_gap is on
// DispatchablePlan in HEAD's api.ts).
//
// Run #41: a STALE-SINCE freshness affordance on the badge poll. The badges live-refresh
// (run #39) and can be PAUSED — but a frozen count looks identical whether it's 1s or 10min
// old, and a silently-wedged poll would leave the operator trusting stale numbers with no
// signal. Each poll cycle now stamps `lastRefresh` (after all three fetches settle, via
// Promise.all), and a 1s ticker drives a small "↻ Ns" age chip next to the ● LIVE toggle:
// dim when fresh, AMBER once the data is older than 2× the refresh interval (the badge is
// provably stale — paused, or the poll stopped). Pure-frontend, no new dep, no new endpoint;
// it reads only the timing of the existing run #39 poll. The designated (b') increment — the
// in_flight pulse (a) stays gated until the dispatcher fires (dispatched:0, TO-DO #1 unrun).
//
// Run #51: a DISPATCHER-ERROR attention marker on the ⚡ DISPATCHABLE tab. The dispatcher is
// now LIVE and ON (run #50) and genuinely firing real claude turns — which means it can FAIL
// (a task that times out increments status.errors and stamps last_error). Runs #38–#40 gave
// the tab badge a ready-count + web-gap split, but a *fault* in the autonomous loop was
// invisible at the tab bar: the operator only saw it after opening ⚡ DISPATCHABLE and reading
// the ▶ RUN STATE panel. And the existing emerald count pill is suppressed when the queue is
// empty (the drained-board steady state), so it couldn't carry the signal even if it tried.
// This adds a SEPARATE red "✕N" chip on the ⚡ DISPATCHABLE tab button, rendered whenever
// status.errors > 0 — decoupled from the ready-count gate so it shows even with an empty queue
// — with the live last_error in its tooltip. Zero new dep / endpoint: status.errors and
// last_error ride the SAME getDispatcher poll the badge already runs (both are on
// DispatcherStatus in HEAD's api.ts). Read-only — it surfaces the fault; clearing/retrying a
// timed-out dispatch is the operator's action inside the RUN STATE panel.
import { useState, useEffect } from 'react';
import EventFeedDrawer from './EventFeedDrawer';
import BlockedTasksDrawer from './BlockedTasksDrawer';
import WebAccessDrawer from './WebAccessDrawer';
import DispatchableDrawer from './DispatchableDrawer';
import { getWebAccessAudit, getMcTasks, getDispatcher } from '../lib/api';

type Tab = 'activity' | 'blocked' | 'webaccess' | 'dispatch';

// Live attention badges, fetched once per open. null = not yet loaded / fetch failed for
// that field (badge suppressed). Each field is independently degradable. `webGap` is the
// subset of `dispatchable` whose next-to-fire row needs a web MCP its agent lacks (run #40).
// `errors` is the dispatcher's cumulative run-error count (status.errors) — surfaced as a red
// "✕N" fault chip on the ⚡ DISPATCHABLE tab, independent of the ready-count gate (run #51).
type Badges = { missing: number | null; blocked: number | null; dispatchable: number | null; webGap: number | null; errors: number | null };

// Persist the operator's last-open tab across sessions (run #34). The parent keys this
// component on `open`, so every open is a fresh mount — without this the surface always
// snapped back to ▦ ACTIVITY, discarding wherever the operator was last working. We store
// only the tab (not the transient per-agent web-focus, which is tied to a specific gap
// that may no longer exist on the next session).
const TAB_STORAGE_KEY = 'mc.autonomy.tab';
const TAB_KEYS: Tab[] = ['activity', 'blocked', 'webaccess', 'dispatch'];

function readStoredTab(fallback: Tab): Tab {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY);
    if (v && (TAB_KEYS as string[]).includes(v)) return v as Tab;
  } catch { /* localStorage unavailable (private mode / disabled) — use the fallback */ }
  return fallback;
}

function persistTab(t: Tab): void {
  try { localStorage.setItem(TAB_STORAGE_KEY, t); } catch { /* non-fatal — persistence is best-effort */ }
}

const TABS: Array<{ key: Tab; label: string; hover: string }> = [
  { key: 'activity', label: '▦ ACTIVITY', hover: 'hover:border-white/40 hover:text-white' },
  { key: 'blocked', label: '⊘ BLOCKED', hover: 'hover:border-amber-400 hover:text-amber-400' },
  { key: 'webaccess', label: '⚿ WEB-ACCESS', hover: 'hover:border-amber-400 hover:text-amber-400' },
  { key: 'dispatch', label: '⚡ DISPATCHABLE', hover: 'hover:border-emerald-400 hover:text-emerald-400' },
];

export default function AutonomyDrawer({
  open,
  onClose,
  onOpenTask,
  initialTab = 'activity',
}: {
  open: boolean;
  onClose: () => void;
  onOpenTask: (id: string) => void;
  // Fallback view when nothing is persisted yet. The parent keys this component on `open`,
  // so each open is a fresh mount — but the last-open tab now wins over this default
  // (see readStoredTab), so the operator reopens where they left off.
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(() => readStoredTab(initialTab));

  // Run #38/#39: live attention badges, now LIVE-POLLED (run #39). The children own their
  // own body polling once mounted; this is the at-a-glance summary on the tab bar. Each of
  // the three fetches degrades independently — on the FIRST load a failure leaves that field
  // null so its badge simply doesn't render (never a wrong number); on a LATER poll a failure
  // leaves the prior value untouched (the badge stays steady rather than flickering to absent).
  const [badges, setBadges] = useState<Badges>({ missing: null, blocked: null, dispatchable: null, webGap: null, errors: null });
  // Run #51: the dispatcher's most recent run error (status.last_error), shown in the ⚡
  // DISPATCHABLE fault chip's tooltip. null when the loop is clean or not yet loaded.
  const [lastError, setLastError] = useState<string | null>(null);
  // ● LIVE (default) vs ⏸ PAUSED — the operator can stop the badge poll (e.g. to stop the
  // network churn while reading). Pausing keeps the last-fetched counts on screen.
  const [paused, setPaused] = useState(false);
  // Run #41: epoch-ms of the last completed poll cycle (null until the first cycle settles).
  // Drives the "↻ Ns" freshness chip so a frozen count carries an honest age.
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const REFRESH_MS = 5000;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const set = (patch: Partial<Badges>) => { if (!cancelled) setBadges((b) => ({ ...b, ...patch })); };
    // One poll cycle: re-fetch all three summaries in parallel. A rejected fetch is swallowed
    // so the field keeps its last good value (steady badge across a transient blip).
    const fetchOnce = () => {
      const p1 = getWebAccessAudit()
        .then((a) => set({ missing: a.summary?.missing_web ?? a.agents.filter((r) => r.gap).length }))
        .catch(() => { /* keep prior missing */ });
      const p2 = getMcTasks()
        .then((r) => set({ blocked: r.tasks.filter((t) => t.status === 'blocked').length }))
        .catch(() => { /* keep prior blocked */ });
      const p3 = getDispatcher()
        .then((d) => {
          set({
            dispatchable: d.dispatchable.length,
            webGap: d.dispatchable.filter((r) => r.web_gap).length,
            // Run #51: cumulative run-error count for the ⚡ DISPATCHABLE fault chip.
            errors: d.status.errors,
          });
          if (!cancelled) setLastError(d.status.last_error);
        })
        .catch(() => { /* keep prior dispatchable / webGap / errors */ });
      // Stamp freshness once the whole cycle has settled (each leg's .catch resolves, so
      // allSettled-equivalent — a fully-failed cycle still stamps, marking "we tried just now"
      // while the badges honestly keep their last good values).
      Promise.all([p1, p2, p3]).then(() => { if (!cancelled) setLastRefresh(Date.now()); });
    };
    fetchOnce(); // immediate snapshot on open / resume
    // Only spin the interval when live; pausing tears it down (keyed on `paused` below).
    const id = paused ? null : setInterval(fetchOnce, REFRESH_MS);
    return () => { cancelled = true; if (id) clearInterval(id); };
  }, [open, paused]);

  // Run #41: a 1s ticker so the "↻ Ns" age advances (and crosses into stale-amber) between
  // poll cycles and while PAUSED — without it the age would only update when a badge changed.
  // Render-only; it touches no network and is torn down on close.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  // Relative age of the last poll cycle + whether it's provably stale (older than two refresh
  // intervals → the poll is paused or has wedged). null before the first cycle settles.
  const ageSeconds = lastRefresh == null ? null : Math.max(0, Math.round((now - lastRefresh) / 1000));
  const ageLabel = ageSeconds == null ? null
    : ageSeconds < 1 ? 'now'
    : ageSeconds < 60 ? `${ageSeconds}s`
    : `${Math.floor(ageSeconds / 60)}m${ageSeconds % 60}s`;
  const stale = ageSeconds != null && now - (lastRefresh ?? 0) > REFRESH_MS * 2;

  // Resolve a tab's badge: a count + tone (+ an optional amber `warn` segment), or null to
  // render no badge. Suppressed when the count is unknown (fetch pending/failed) or zero
  // (nothing needs attention there). The ⚡ DISPATCHABLE badge carries `warn` = the web-gap
  // subset of the ready queue (run #40), shown as "· N⚠" inside the emerald pill.
  const badgeFor = (key: Tab): { count: number; tone: string; warn?: number } | null => {
    const amber = 'border-amber-400/40 bg-amber-400/15 text-amber-300';
    const emerald = 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300';
    const pick = (count: number | null, tone: string) =>
      count && count > 0 ? { count, tone } : null;
    if (key === 'webaccess') return pick(badges.missing, amber);
    if (key === 'blocked') return pick(badges.blocked, amber);
    if (key === 'dispatch') {
      const b = pick(badges.dispatchable, emerald);
      // Attach the web-gap subset only when known and > 0 (else no amber segment).
      return b && badges.webGap && badges.webGap > 0 ? { ...b, warn: badges.webGap } : b;
    }
    return null; // ▦ ACTIVITY — no single attention count
  };

  // Switch tab AND persist it for next session. Used by the tab bar and the WEB-GAP
  // cross-link hand-off.
  const selectTab = (t: Tab) => {
    setTab(t);
    persistTab(t);
  };
  // Which agent the ⚿ WEB-ACCESS tab should focus on. Set by a per-row ⚡ DISPATCHABLE
  // cross-link (run #33); cleared on any manual tab click so clicking ⚿ WEB-ACCESS
  // directly shows the unfocused full list.
  const [webFocus, setWebFocus] = useState<string | undefined>(undefined);

  // Cross-link hand-off → the ⚿ WEB-ACCESS tab. The header WEB-GAP chips call it with
  // no arg (whole list); a per-row assignee passes its agent so the audit lands focused.
  const openAudit = (agent?: string) => {
    setWebFocus(agent);
    selectTab('webaccess');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl h-[85vh] flex flex-col border border-white/15 bg-[#070707] font-mono text-[11px]">
        {/* tab bar — the single header for all four views */}
        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="tracking-[0.2em] text-white font-bold mr-1">⊙ AUTONOMY</span>
            {TABS.map((t) => {
              const badge = badgeFor(t.key);
              return (
                <button key={t.key} onClick={() => { setWebFocus(undefined); selectTab(t.key); }}
                  title={badge
                    ? (badge.warn
                        ? `switch to the ${t.label} view — ${badge.count} ready, ${badge.warn} blocked on a web MCP`
                        : `switch to the ${t.label} view — ${badge.count} ${t.key === 'dispatch' ? 'ready to fire' : 'need attention'}`)
                    : `switch to the ${t.label} view`}
                  className={`inline-flex items-center gap-1 border px-2 py-0.5 rounded-sm text-[10px] tracking-[0.12em] ${
                    tab === t.key
                      ? 'border-white/45 text-white bg-white/[0.06]'
                      : `border-white/10 text-[#888] ${t.hover}`
                  }`}>
                  {t.label}
                  {badge && (
                    <span className={`ml-0.5 px-1 rounded-sm border text-[9px] leading-none tabular-nums ${badge.tone}`}>
                      {badge.count}
                      {badge.warn ? <span className="ml-0.5 text-amber-300">· {badge.warn}⚠</span> : null}
                    </span>
                  )}
                  {/* run #51: dispatcher-fault chip — separate from the ready-count pill (which
                      is suppressed on an empty queue) so an errored autonomous loop is visible
                      at the tab bar even when nothing is queued. last_error in the tooltip. */}
                  {t.key === 'dispatch' && badges.errors != null && badges.errors > 0 && (
                    <span
                      title={`dispatcher has logged ${badges.errors} run error${badges.errors === 1 ? '' : 's'}${lastError ? ` — last: ${lastError}` : ''} — open ⚡ DISPATCHABLE → ▶ RUN STATE`}
                      className="ml-0.5 px-1 rounded-sm border text-[9px] leading-none tabular-nums border-red-400/40 bg-red-400/15 text-red-300">
                      ✕{badges.errors}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            {/* run #41: freshness chip — age of the last completed poll cycle. Dim when
                fresh; amber once provably stale (paused or the poll wedged). */}
            {ageLabel && (
              <span
                title={`badge counts last refreshed ${ageLabel} ago${stale ? ' — STALE' : ''}${paused ? ' (poll paused)' : ''}`}
                className={`text-[9px] tracking-[0.1em] tabular-nums ${stale ? 'text-amber-300' : 'text-[#666]'}`}>
                ↻ {ageLabel}
              </span>
            )}
            {/* run #39: pause/resume the tab-badge live poll */}
            <button onClick={() => setPaused((p) => !p)}
              title={paused ? 'badge counts paused — click to resume live refresh' : 'badge counts refreshing live — click to pause'}
              className={`border px-2 py-0.5 text-[10px] tracking-[0.12em] rounded-sm ${
                paused
                  ? 'border-white/10 text-[#888] hover:border-white/30'
                  : 'border-emerald-400/40 text-emerald-300 bg-emerald-400/10'
              }`}>
              {paused ? '⏸ PAUSED' : '● LIVE'}
            </button>
            <button onClick={onClose} className="border border-white/10 px-2 py-0.5 text-[#b8b8b8] hover:border-white/30">✕ CLOSE</button>
          </div>
        </div>

        {/* active view — mounted fresh on tab switch (re-fetch / restart poll). Only the
            active tab is mounted, so an inactive drawer's live poll is torn down. The
            "WEB-GAP" cross-links become tab switches to the ⚿ WEB-ACCESS view. */}
        <div className="flex-1 min-h-0">
          {tab === 'activity' && (
            <EventFeedDrawer embedded open onClose={onClose} onOpenTask={onOpenTask} />
          )}
          {tab === 'blocked' && (
            <BlockedTasksDrawer embedded open onClose={onClose} onOpenTask={onOpenTask}
              onOpenAudit={openAudit} />
          )}
          {tab === 'webaccess' && (
            <WebAccessDrawer embedded open onClose={onClose} focusAgent={webFocus} onOpenTask={onOpenTask} />
          )}
          {tab === 'dispatch' && (
            <DispatchableDrawer embedded open onClose={onClose} onOpenTask={onOpenTask}
              onOpenAudit={openAudit} />
          )}
        </div>
      </div>
    </div>
  );
}
