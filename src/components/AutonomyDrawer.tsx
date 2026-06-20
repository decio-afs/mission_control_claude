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
//
// Run #53: a SCHEDULER-DAEMON health chip in the surface header. Mission Control runs two
// sibling autonomy daemons that tick in lockstep every 30s — the DISPATCHER (fires claude
// turns for ready tasks) and the SCHEDULER (fires due cron jobs). The dispatcher's health is
// now richly surfaced (the ▶ RUN STATE panel in ⚡ DISPATCHABLE + the run #51 ✕N tab chip),
// but the scheduler daemon — its enabled/running/ticks/fired/errors/last_error block from
// /api/mc/cron — had NO UI surface anywhere: an operator glancing at ⊙ AUTONOMY could see the
// dispatcher had faulted but was blind to whether the cron daemon was even alive, how many
// jobs it held, whether it had ever fired, or whether it had errored. This adds a glance-level
// "⏱ SCHED" chip next to the ● LIVE toggle, mirroring the dispatcher signal: RED "OFF" when the
// daemon isn't running/enabled (due jobs will never fire), RED "✕N" when it has logged fire
// errors (last_error in the tooltip), EMERALD "●N" when alive with N jobs registered, and a dim
// "idle" when alive but holding zero jobs (the honest drained-scheduler steady state — alive,
// nothing to fire). Zero new endpoint — it rides getMcCron() (already in HEAD's api.ts, returns
// jobs[] + the scheduler{} liveness block) on the SAME poll cycle as the tab badges, with the
// same graceful degrade (a failed/absent scheduler block suppresses the chip, never a wrong
// signal). Read-only — seeding/fixing cron jobs is the operator's action in the ⏱ CRON modal.
//
// Run #54: a ⏱ SCHEDULER tab — the cron daemon's full RUN-STATE panel, the sibling of the
// dispatcher's ▶ RUN STATE panel (in ⚡ DISPATCHABLE). Run #53's header chip is glance-only and,
// crucially, reads `running` as a BOOLEAN FLAG set at daemon start — it cannot tell a healthy
// ticking daemon from one whose tick thread has WEDGED (still reports running:true, but its
// last_tick froze). The scheduler block carries `last_tick`/`ticks`/`started_at`/`tick_seconds`
// that NO UI surfaced. This tab renders them: a LIVENESS row computing last_tick age and flagging
// it AMBER once it exceeds 2× the tick interval (the wedge signal the boolean can't give), plus
// uptime, tick count, fired history (+last_fired_id), error detail (+last_error), and the
// registered-jobs list (honest empty when the daemon holds nothing to fire). Zero new endpoint —
// it reuses the same getMcCron() poll the run #53 chip already runs; the extra scheduler fields
// (ticks/last_tick/started_at/tick_seconds) and the jobs[] array are folded into the existing
// `sched` state. Read-only — seeding jobs stays the operator's action in the ⏱ CRON modal.
import { useState, useEffect, useMemo } from 'react';
import EventFeedDrawer from './EventFeedDrawer';
import BlockedTasksDrawer from './BlockedTasksDrawer';
import WebAccessDrawer from './WebAccessDrawer';
import DispatchableDrawer from './DispatchableDrawer';
import { getWebAccessAudit, getMcTasks, getDispatcher, getMcCron, getMaintenanceActions, type McCronJob } from '../lib/api';

type Tab = 'activity' | 'blocked' | 'webaccess' | 'dispatch' | 'scheduler';

// Run #54: format an elapsed-seconds span as a compact human age ("42s", "3m 7s", "5h 12m",
// "2d 4h"). Used by the ⏱ SCHEDULER panel for uptime and last-tick age. Module-level (no
// per-render allocation); seconds-domain (the scheduler's epoch fields are in SECONDS).
function fmtDuration(secs: number): string {
  if (secs < 1) return 'just now';
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
}

// Run #54: one labelled stat cell in the ⏱ SCHEDULER run-state grid.
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'dim' }) {
  const v = tone === 'emerald' ? 'text-emerald-300' : tone === 'dim' ? 'text-[#777]' : 'text-white';
  return (
    <div className="border border-white/10 bg-white/[0.02] px-3 py-2 rounded-sm">
      <div className="text-[#888] tracking-[0.12em] text-[9px]">{label}</div>
      <div className={`mt-0.5 tabular-nums break-words ${v}`}>{value}</div>
    </div>
  );
}

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
const TAB_KEYS: Tab[] = ['activity', 'blocked', 'webaccess', 'dispatch', 'scheduler'];

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
  { key: 'scheduler', label: '⏱ SCHEDULER', hover: 'hover:border-emerald-400 hover:text-emerald-400' },
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
  // Run #60: the id of the dispatcher's most recent dispatch (status.last_dispatched_id) and a
  // baseline of the cumulative error count captured the first poll after this cockpit opened.
  // Together they let the ⚡ DISPATCHABLE fault chip tell a LIVE fault (errors rose since you
  // opened the view, or the latest dispatch is itself the errored one) apart from a STALE
  // historical error the dispatcher has already self-healed (a later, different dispatch
  // succeeded) — so the chip stops crying wolf red forever after one old timeout.
  const [lastDispatchedId, setLastDispatchedId] = useState<string | null>(null);
  const [errorsBaseline, setErrorsBaseline] = useState<number | null>(null);
  // Run #53: scheduler-daemon liveness for the header ⏱ SCHED chip. null = not yet loaded /
  // fetch failed / no scheduler block in the response (chip suppressed — never a wrong signal).
  // `jobs` is the count of registered cron jobs; the rest mirror /api/mc/cron's scheduler{}.
  // Run #54: extended to carry the full run-state the ⏱ SCHEDULER panel needs — ticks/lastTick/
  // startedAt/tickSeconds (for uptime + the wedge-detecting liveness age) and the raw jobList.
  type Sched = {
    running: boolean; enabled: boolean; jobs: number; fired: number; errors: number;
    lastError: string | null; lastFiredId: string | null;
    ticks: number; lastTick: number | null; startedAt: number | null; tickSeconds: number;
    jobList: McCronJob[];
  };
  const [sched, setSched] = useState<Sched | null>(null);
  // Run #55: the maintenance actions the *running* bridge can fire (e.g. ['sweep'] or
  // ['reconcile','sweep']), read off the live process via getMaintenanceActions. null =
  // not yet loaded / the bridge predates the endpoint (404) / the fetch failed — in every
  // case the SCHEDULER panel's "FIREABLE ACTIONS" row is suppressed (never a wrong claim).
  // Fetched once per open (it only changes on a bridge restart), not on the 5s badge poll,
  // so an old bridge 404s at most once instead of every cycle.
  const [maintActions, setMaintActions] = useState<string[] | null>(null);
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
          if (!cancelled) {
            setLastError(d.status.last_error);
            setLastDispatchedId(d.status.last_dispatched_id ?? null);
            // Run #60: latch the error count seen on the first poll after open as the
            // "already-known" baseline. Any later increase = a NEW fault while watching.
            setErrorsBaseline((b) => (b == null ? d.status.errors : b));
          }
        })
        .catch(() => { /* keep prior dispatchable / webGap / errors */ });
      // Run #53: the scheduler daemon's liveness for the header ⏱ SCHED chip. Same graceful
      // degrade — a rejected fetch or an absent scheduler block keeps the prior value (steady
      // chip), and the FIRST load leaving it null simply suppresses the chip (never a wrong signal).
      const p4 = getMcCron()
        .then((c) => {
          if (cancelled) return;
          const s = c.scheduler;
          if (!s) { setSched(null); return; }
          setSched({
            running: s.running, enabled: s.enabled, jobs: c.jobs.length,
            fired: s.fired, errors: s.errors,
            lastError: s.last_error ?? null, lastFiredId: s.last_fired_id ?? null,
            // Run #54: run-state for the ⏱ SCHEDULER panel.
            ticks: s.ticks, lastTick: s.last_tick ?? null, startedAt: s.started_at ?? null,
            tickSeconds: s.tick_seconds, jobList: c.jobs,
          });
        })
        .catch(() => { /* keep prior sched */ });
      // Stamp freshness once the whole cycle has settled (each leg's .catch resolves, so
      // allSettled-equivalent — a fully-failed cycle still stamps, marking "we tried just now"
      // while the badges honestly keep their last good values).
      Promise.all([p1, p2, p3, p4]).then(() => { if (!cancelled) setLastRefresh(Date.now()); });
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

  // Run #55: read the running bridge's fireable maintenance actions ONCE per open. It only
  // changes when the bridge restarts, so it doesn't belong on the 5s poll — fetching it once
  // means a bridge that predates the endpoint 404s at most once (silently caught) rather than
  // every cycle. A failure leaves maintActions null → the panel row is suppressed.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getMaintenanceActions()
      .then((a) => { if (!cancelled) setMaintActions(a); })
      .catch(() => { if (!cancelled) setMaintActions(null); });
    return () => { cancelled = true; };
  }, [open]);

  // Relative age of the last poll cycle + whether it's provably stale (older than two refresh
  // intervals → the poll is paused or has wedged). null before the first cycle settles.
  const ageSeconds = lastRefresh == null ? null : Math.max(0, Math.round((now - lastRefresh) / 1000));
  const ageLabel = ageSeconds == null ? null
    : ageSeconds < 1 ? 'now'
    : ageSeconds < 60 ? `${ageSeconds}s`
    : `${Math.floor(ageSeconds / 60)}m${ageSeconds % 60}s`;
  const stale = ageSeconds != null && now - (lastRefresh ?? 0) > REFRESH_MS * 2;

  // Run #60: resolve the ⚡ DISPATCHABLE fault chip. The run #51 chip went hard red on the
  // dispatcher's CUMULATIVE `errors` counter and stayed red forever after a single timeout —
  // so a fully self-healed loop (e.g. 1 historical 900s timeout, then 18 clean dispatches)
  // glowed a permanent ✕1, training the operator to ignore the one signal meant to catch a
  // genuine fault. This splits the chip into two honest states:
  //   • LIVE (alarm red)  — errors ROSE since this cockpit opened (a fault while you watch),
  //     OR the most recent dispatch is itself the errored task (no recovery dispatch yet).
  //   • STALE (muted grey) — errors > 0 but unchanged since open AND a later, *different*
  //     dispatch has since succeeded → the dispatcher recovered; surfaced, not alarmed.
  // Pure derivation off the existing poll (no new fetch); null = clean loop or not yet loaded.
  const faultChip = useMemo<{ label: string; tone: string; title: string } | null>(() => {
    const errs = badges.errors;
    if (errs == null || errs <= 0) return null;
    const fresh = errorsBaseline != null && errs > errorsBaseline;
    // `last_error` is formatted "<task_id>: <message>" — the leading token is the errored task.
    const erroredId = lastError ? lastError.split(':')[0].trim() : null;
    const recovered = !!lastDispatchedId && lastDispatchedId !== erroredId;
    if (fresh || !recovered) {
      return {
        label: `✕${errs}`,
        tone: 'border-red-400/40 bg-red-400/15 text-red-300',
        title: `dispatcher has logged ${errs} run error${errs === 1 ? '' : 's'}${fresh ? ' — a NEW error since you opened this view' : ' — the latest dispatch is the errored one (no recovery yet)'}${lastError ? ` — last: ${lastError}` : ''} — open ⚡ DISPATCHABLE → ▶ RUN STATE`,
      };
    }
    return {
      label: `✕${errs}`,
      tone: 'border-white/15 bg-white/[0.04] text-[#7a7a7a]',
      title: `${errs} historical run error${errs === 1 ? '' : 's'} — the dispatcher has since recovered (later dispatch ${lastDispatchedId} succeeded${erroredId ? `; the error was ${erroredId}` : ''}); no new errors since you opened this view — open ⚡ DISPATCHABLE → ▶ RUN STATE for detail`,
    };
  }, [badges.errors, errorsBaseline, lastError, lastDispatchedId]);

  // Run #53: resolve the header ⏱ SCHED chip — a glance-level health signal for the cron
  // scheduler daemon, mirroring the dispatcher's fault chip. null suppresses the chip (status
  // not yet loaded / no scheduler block). Priority: OFF (down — due jobs can't fire) > ✕N
  // (fired-error) > ●N (alive, N jobs) > idle (alive, zero jobs registered — honest steady state).
  const schedChip: { label: string; tone: string; title: string } | null = (() => {
    if (!sched) return null;
    const red = 'border-red-400/40 bg-red-400/15 text-red-300';
    const emerald = 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300';
    const dim = 'border-white/10 bg-white/[0.04] text-[#888]';
    const firedNote = `${sched.fired} fired${sched.lastFiredId ? ` (last ${sched.lastFiredId})` : ''}`;
    if (!sched.running || !sched.enabled)
      return { label: '⏱ SCHED OFF', tone: red, title: `cron scheduler daemon is ${sched.enabled ? 'enabled but not running' : 'disabled'} — due jobs will not fire (${sched.jobs} job${sched.jobs === 1 ? '' : 's'} registered)` };
    if (sched.errors > 0)
      return { label: `⏱ SCHED ✕${sched.errors}`, tone: red, title: `cron scheduler logged ${sched.errors} fire error${sched.errors === 1 ? '' : 's'}${sched.lastError ? ` — last: ${sched.lastError}` : ''} — ${sched.jobs} job${sched.jobs === 1 ? '' : 's'}, ${firedNote}` };
    if (sched.jobs > 0)
      return { label: `⏱ SCHED ●${sched.jobs}`, tone: emerald, title: `cron scheduler LIVE — ${sched.jobs} job${sched.jobs === 1 ? '' : 's'} registered, ${firedNote}` };
    return { label: '⏱ SCHED · idle', tone: dim, title: `cron scheduler LIVE but holding 0 jobs (nothing to fire) — seed one in the ⏱ CRON modal; ${firedNote}` };
  })();

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
                      at the tab bar even when nothing is queued. last_error in the tooltip.
                      run #60: red only for a LIVE fault; muted grey once recovered/historical
                      (see faultChip) so a self-healed loop no longer glows a permanent alarm. */}
                  {t.key === 'dispatch' && faultChip && (
                    <span
                      title={faultChip.title}
                      className={`ml-0.5 px-1 rounded-sm border text-[9px] leading-none tabular-nums ${faultChip.tone}`}>
                      {faultChip.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            {/* run #53: scheduler-daemon health chip — the cron daemon's liveness at a glance,
                the sibling signal to the dispatcher's ✕N tab chip. Suppressed until the first
                poll resolves a scheduler block. */}
            {schedChip && (
              <span
                title={schedChip.title}
                className={`px-1 rounded-sm border text-[9px] leading-none tracking-[0.1em] tabular-nums ${schedChip.tone}`}>
                {schedChip.label}
              </span>
            )}
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
          {/* run #54: ⏱ SCHEDULER — the cron daemon's full run-state, the scheduler twin of the
              dispatcher's ▶ RUN STATE panel. Reads the run #53 `sched` state (now extended). The
              IIFE mirrors schedChip's pattern. */}
          {tab === 'scheduler' && (() => {
            const s = sched;
            if (!s) {
              return (
                <div className="h-full flex items-center justify-center text-[#666] text-[11px] px-8 text-center leading-relaxed">
                  cron scheduler status unavailable — the bridge returned no <code className="text-[#999]">scheduler</code> block (older bridge, or the <code className="text-[#999]">/api/mc/cron</code> poll failed). The daemon may still be running; this view needs that block to report on it.
                </div>
              );
            }
            const nowS = now / 1000;
            const tickAge = s.lastTick != null ? Math.max(0, nowS - s.lastTick) : null;
            // A daemon flagged running:true whose last tick is older than 2× its interval is almost
            // certainly wedged (tick thread died) — the boolean can't show that, this age can.
            const tickStale = tickAge != null && tickAge > s.tickSeconds * 2;
            const down = !s.running || !s.enabled;
            return (
              <div className="h-full overflow-y-auto p-4 space-y-3 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="tracking-[0.2em] text-white font-bold">⏱ CRON SCHEDULER — RUN STATE</span>
                  <span className={`px-1.5 py-0.5 rounded-sm border text-[10px] tracking-[0.12em] ${
                    down ? 'border-red-400/40 bg-red-400/15 text-red-300'
                         : 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300'}`}>
                    {s.enabled ? (s.running ? '● RUNNING' : '⏸ STOPPED') : '⊘ DISABLED'}
                  </span>
                </div>

                {/* LIVENESS — the signature signal: last-tick age catches a wedged daemon that
                    still reports running:true (which the run #53 chip cannot). */}
                <div className={`border px-3 py-2 rounded-sm ${tickStale ? 'border-amber-400/40 bg-amber-400/[0.07]' : 'border-white/10 bg-white/[0.02]'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[#888] tracking-[0.12em] text-[9px]">LIVENESS</span>
                    <span className={`tabular-nums ${tickStale ? 'text-amber-300' : tickAge == null ? 'text-[#777]' : 'text-emerald-300'}`}>
                      {tickAge == null ? 'never ticked' : `⟳ ticked ${fmtDuration(tickAge)} ago`}
                    </span>
                  </div>
                  {tickStale && (
                    <div className="mt-1 text-amber-300/80 text-[10px] leading-snug">
                      ⚠ last tick is older than 2× the {s.tickSeconds}s interval — the scheduler thread may be wedged even though it still reports {s.running ? 'running' : 'stopped'}.
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Stat label="UPTIME" value={s.startedAt != null ? fmtDuration(nowS - s.startedAt) : '—'} />
                  <Stat label="TICKS" value={`${s.ticks.toLocaleString()} @ ${s.tickSeconds}s`} />
                  <Stat label="JOBS REGISTERED" value={`${s.jobs}`} tone={s.jobs > 0 ? 'emerald' : 'dim'} />
                  <Stat label="FIRED" value={`${s.fired}${s.lastFiredId ? ` · ${s.lastFiredId}` : ''}`} />
                </div>

                {s.errors > 0 ? (
                  <div className="border border-red-400/40 bg-red-400/10 px-3 py-2 rounded-sm text-red-300 leading-snug">
                    ✕ {s.errors} fire error{s.errors === 1 ? '' : 's'}{s.lastError ? ` — last: ${s.lastError}` : ''}
                  </div>
                ) : (
                  <div className="text-[#666] text-[10px] px-1">no fire errors logged</div>
                )}

                {/* run #55: the maintenance actions THIS running process can fire, read off the
                    live bridge (not the source). Suppressed when unknown (bridge predates the
                    endpoint / fetch failed) so it never makes a wrong claim. When `reconcile` is
                    absent it surfaces the recurring operator gap — the live process can't fire the
                    terminal-safe board self-heal until the bridge is restarted on a build with it. */}
                {maintActions && maintActions.length > 0 && (
                  <div className="border border-white/10 bg-white/[0.02] px-3 py-2 rounded-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#888] tracking-[0.12em] text-[9px]">FIREABLE ACTIONS</span>
                      <div className="flex items-center gap-1 flex-wrap justify-end">
                        {maintActions.map((a) => (
                          <span key={a}
                            className={`px-1.5 py-0.5 rounded-sm border text-[10px] tracking-[0.1em] tabular-nums ${
                              a === 'reconcile'
                                ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                                : 'border-white/15 bg-white/[0.04] text-[#bbb]'}`}>
                            {a}
                          </span>
                        ))}
                      </div>
                    </div>
                    {!maintActions.includes('reconcile') && (
                      <div className="mt-1 text-amber-300/80 text-[10px] leading-snug">
                        ⚠ the terminal-safe <code className="text-[#999]">reconcile</code> board self-heal is NOT fireable on this process — seeding a reconcile cron here would fault. Restart the bridge on a build that ships it to enable, then seed.
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <div className="text-[#888] tracking-[0.12em] text-[9px] mb-1">REGISTERED JOBS ({s.jobs})</div>
                  {s.jobList.length === 0 ? (
                    <div className="border border-white/10 bg-white/[0.02] px-3 py-3 rounded-sm text-[#777] text-[10px] leading-snug">
                      the scheduler is holding 0 jobs — nothing will fire on its own. Seed a job (a <code className="text-[#999]">maintenance</code> hygiene job or a <code className="text-[#999]">claude</code> prompt) in the ⏱ CRON modal; a registered job appears here and the daemon fires it on schedule.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {s.jobList.map((j) => (
                        <div key={j.id} className="border border-white/10 bg-white/[0.02] px-2 py-1.5 rounded-sm flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-white truncate">{j.name || j.id}</div>
                            <div className="text-[#777] text-[10px] truncate">
                              {j.schedule || j.repeat || 'unscheduled'}{j.deliver ? ` → ${j.deliver}` : ''}
                            </div>
                          </div>
                          <span className="shrink-0 text-[10px] text-[#999] tracking-[0.1em]">{j.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
