// Board-wide ⚡ DISPATCHABLE / readiness glance — make the autonomy queue legible
// BEFORE the first watched dispatch (run #27).
//
// The dispatcher is LIVE-but-OFF and already FED: /api/mc/dispatcher returns the
// ready queue best-first (the exact order the dispatcher would fire), each row
// carrying its assignee, agent model, MCPs, and a web_gap flag. But that readiness
// list had no UI home — the operator couldn't see *what would run next* (and which
// of those would hit the web-gap) without curling the endpoint. This read-only
// drawer surfaces it directly: the dispatch queue in fire order, each row with its
// assignee + model + an amber web-gap ⚠ marker (reusing run #26's idiom) + a
// deep-link to the task, plus a header showing the dispatcher's enabled/running
// state so the autonomy posture is honest at a glance.
//
// Honest + LIVE-backed: read-only (it shows the queue, it does NOT dispatch — firing
// a task is an operator-watched, side-effecting action, TO-DO #1), no demo rows,
// honest empty/OFF/error states.
//
// Run #28 extends this with a ▶ RUN STATE panel: the dispatcher's live in_flight[]
// (ids resolved to titles + deep-links), the last-dispatch outcome
// (last_dispatched_id → title + last_error), and the run counters
// (ticks/dispatched/errors). DispatcherStatus already carries all of these — this
// is purely a readout so the autonomy loop is observable end-to-end once the operator
// does the first watched dispatch (TO-DO #1). In-flight/last-dispatched ids are
// resolved to titles via getMcTasks (already in HEAD), since an in-flight task has
// left the dispatchable queue and isn't in `plan`.
//
// Run #29 — the drawer now LIVE-POLLS while open (the run #23 EventFeedDrawer idiom):
// it re-fetches /api/mc/dispatcher every 5s so the ▶ RUN STATE panel (in_flight /
// last_dispatched / counters) and the queue update in real time during a watched
// dispatch — no close+reopen needed. A ● LIVE/⏸ PAUSED header toggle controls it.
// The poll is kept cheap: getMcTasks is only re-fetched when an in-flight or
// last-dispatched id appears that we can't already name (the steady state skips it),
// since the queue rows carry their own titles and only the RUN STATE ids leave the
// queue. The `live` guard drops in-flight responses after close/unmount.
//
// Run #31 — cross-link the WEB-GAP chip to the ⚿ WEB-ACCESS audit (the symmetric move
// to run #26, which made the ⊘ BLOCKED drawer's WEB-GAP chip jump to the same audit).
// This drawer already counts how many queued tasks would fire into a web-gap ("N
// WEB-GAP"), but that chip was a dead label — the operator could see *how many* would
// hit the gap without being able to pivot to *which agents are missing what* and how to
// provision them. With the new optional `onOpenAudit` prop wired, the chip becomes a
// button (↗) that closes this drawer and opens the per-agent ⚿ WEB-ACCESS audit,
// closing the "see the fire queue → see the web-gap → see the systemic fix" loop. The
// prop is optional, so the drawer still renders standalone (plain chip) without it.
//
// Run #30 — a ⚙ AUTONOMY GATES panel. The dispatcher being LIVE-but-OFF and the cron
// store being empty are the two operator switches that keep the whole pipeline idle,
// but nothing in the UI named them together or said how to flip them — the operator
// could see *what would run* (the queue) without seeing *why nothing runs on its own*.
// This panel reads both live gates side by side: ① the dispatcher's enabled state
// (+ concurrency · tick cadence when ON, since DispatcherStatus already carries them
// but the RUN STATE counters never surfaced them) and ② the cron schedule (job count
// + scheduler-daemon liveness), each with a precise one-line remediation when amber.
// When both are green it collapses to a single "autonomy is live" line. Cron is read
// via getMcCron (already in HEAD) and fetched in parallel with the dispatcher each
// poll — both payloads are small, so the cheap-poll posture (no getMcTasks unless an
// unnamed RUN-STATE id appears) is unchanged. Read-only — it explains the gates, it
// never flips them (both are operator-gated, side-effecting actions).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getDispatcher,
  getMcCron,
  getMcTasks,
  errMessage,
  type DispatcherStatus,
  type DispatchablePlan,
  type CronSchedulerStatus,
} from '../lib/api';

const POLL_MS = 5000;

export default function DispatchableDrawer({
  open,
  onClose,
  onOpenTask,
  onOpenAudit,
  embedded,
}: {
  open: boolean;
  onClose: () => void;
  onOpenTask: (id: string) => void;
  // Optional cross-link: when provided, the WEB-GAP chip becomes a button that opens
  // the ⚿ WEB-ACCESS audit (run #31). Run #33 extends it with an optional agent arg —
  // each web-gap queue row's assignee becomes a button that opens the audit focused on
  // exactly that agent (the header chip still calls it with no arg for the whole list).
  // Optional so the drawer still renders standalone.
  onOpenAudit?: (agent?: string) => void;
  // When true, render without the modal backdrop/close chrome so the consolidated
  // ⊙ AUTONOMY surface (run #32) can mount this body inside its own shell.
  embedded?: boolean;
}) {
  const [status, setStatus] = useState<DispatcherStatus | null>(null);
  const [plan, setPlan] = useState<DispatchablePlan[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  // Autonomy gate ②: the cron schedule. We only need the job count + daemon liveness,
  // not the full job list, so we keep just those two derived bits of state.
  const [cronJobs, setCronJobs] = useState<number | null>(null);
  const [scheduler, setScheduler] = useState<CronSchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  // Holds the latest resolved titles so the polling closure can decide whether a
  // task-list re-fetch is needed without re-subscribing the effect on every change.
  const titlesRef = useRef<Record<string, string>>({});

  // LIVE polling: while open (and not paused) re-fetch the dispatcher every POLL_MS
  // so the ▶ RUN STATE panel + queue track a running dispatch in real time. Pausing
  // tears the interval down; resuming re-runs the effect (immediate refetch). The
  // `live` guard drops in-flight results after close/unmount.
  useEffect(() => {
    if (!open || paused) return;
    let live = true;
    const fetchOnce = async () => {
      try {
        // Fetch the dispatcher and the cron schedule together — both payloads are
        // small, so this keeps the cheap-poll posture (the only round-trip we gate is
        // getMcTasks, below). Cron feeds autonomy gate ②.
        const [info, cron] = await Promise.all([getDispatcher(), getMcCron()]);
        if (!live) return;
        setStatus(info.status);
        setCronJobs(cron.jobs.length);
        setScheduler(cron.scheduler ?? null);
        // Preserve the endpoint's order — it is already best-first (the exact
        // sequence the dispatcher would fire), so row 1 is literally "next to run".
        setPlan(info.dispatchable);
        // Resolve in_flight[]/last_dispatched_id (which have left the queue) to
        // titles. Keep the poll cheap: only re-fetch the task list when an id we
        // can't already name appears — the steady state (no new in-flight/dispatch)
        // skips the getMcTasks round-trip entirely.
        const needed = [...info.status.in_flight];
        if (info.status.last_dispatched_id) needed.push(info.status.last_dispatched_id);
        if (needed.some((id) => !(id in titlesRef.current))) {
          const taskResp = await getMcTasks();
          if (!live) return;
          const map: Record<string, string> = { ...titlesRef.current };
          for (const t of taskResp.tasks) map[t.id] = t.title;
          titlesRef.current = map;
          setTitles(map);
        }
        setError(null);
      } catch (e) {
        if (live) setError(errMessage(e));
      } finally {
        if (live) setLoading(false);
      }
    };
    fetchOnce();
    const id = setInterval(fetchOnce, POLL_MS);
    return () => { live = false; clearInterval(id); };
  }, [open, paused]);

  const webGaps = useMemo(() => plan.filter((p) => p.web_gap).length, [plan]);
  // Resolve an id to its title (falling back to the raw id if the task is gone).
  const titleOf = (id: string) => titles[id] || id;

  // Autonomy gates — the two operator switches between this queue and hands-free
  // operation. Each is "green" only when fully live; otherwise it carries a precise
  // remediation. `cronGreen` requires BOTH ≥1 job AND a running daemon (a job with a
  // dead scheduler never fires). Both green ⇒ ready work runs on its own.
  const schedulerLive = scheduler?.running === true;
  const dispatcherGreen = status?.enabled === true;
  const cronGreen = (cronJobs ?? 0) > 0 && schedulerLive;
  const autonomyLive = dispatcherGreen && cronGreen;

  if (!open) return null;

  const panel = (
    <div onClick={(e) => e.stopPropagation()}
      className={embedded
        ? 'w-full h-full flex flex-col font-mono text-[11px]'
        : 'w-full max-w-3xl h-[80vh] flex flex-col border border-white/15 bg-[#070707] font-mono text-[11px]'}>
        {/* header */}
        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="tracking-[0.2em] text-white font-bold">⚡ DISPATCHABLE</span>
            {/* live/paused indicator — also the toggle (mirrors the ▦ ACTIVITY feed) */}
            <button
              onClick={() => setPaused((p) => !p)}
              title={paused ? 'feed paused — click to resume live polling' : 'live — polling the dispatcher every 5s; click to pause'}
              className={`flex items-center gap-1 border px-1.5 py-0.5 rounded-sm text-[9px] tracking-[0.15em] ${paused
                ? 'border-amber-400/30 text-amber-300/90 hover:border-amber-400/60'
                : 'border-emerald-400/30 text-emerald-300/90 hover:border-emerald-400/60'}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${paused ? 'bg-amber-400/80' : 'bg-emerald-400 animate-pulse'}`} />
              {paused ? 'PAUSED' : 'LIVE'}
            </button>
            {status != null && (
              <span
                title={status.enabled
                  ? `dispatcher autonomous mode is ON${status.running ? ' and running' : ' (idle)'}`
                  : 'dispatcher is OFF — ready work only fires on a watched manual dispatch'}
                className={`border px-1.5 py-0.5 rounded-sm text-[9px] tracking-[0.15em] ${
                  status.enabled
                    ? 'border-emerald-400/40 text-emerald-300/90'
                    : 'border-white/15 text-[#888]'
                }`}>
                {status.enabled ? (status.running ? '● ON · RUNNING' : '● ON · IDLE') : '○ OFF'}
              </span>
            )}
            {webGaps > 0 && (
              onOpenAudit ? (
                <button
                  onClick={() => onOpenAudit()}
                  title="queued tasks whose assignee needs the live web but has no web MCP — open the ⚿ WEB-ACCESS audit"
                  className="border border-amber-400/30 text-amber-300/90 px-1.5 py-0.5 rounded-sm text-[9px] tracking-[0.15em] hover:border-amber-400/70 hover:text-amber-200">
                  {webGaps} WEB-GAP ↗
                </button>
              ) : (
                <span
                  title="queued tasks whose assignee needs the live web but has no web MCP"
                  className="border border-amber-400/30 text-amber-300/90 px-1.5 py-0.5 rounded-sm text-[9px] tracking-[0.15em]">
                  {webGaps} WEB-GAP
                </span>
              )
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[#777]">
            <span>{plan.length} ready to fire</span>
            {!embedded && <button onClick={onClose} className="ml-2 border border-white/10 px-2 py-0.5 text-[#b8b8b8] hover:border-white/30">✕ CLOSE</button>}
          </div>
        </div>

        {/* ⚙ AUTONOMY GATES — the two operator switches that keep ready work from firing
            on its own: ① the dispatcher env flag, ② the cron schedule. Read-only: it
            names each gate's LIVE state and exactly how to flip it. When both are green,
            collapses to a single "autonomy is live" affirmation. */}
        {!loading && !error && status != null && (
          <div className="shrink-0 px-3 py-2 border-b border-white/10 bg-white/[0.02]">
            <div className="flex items-center gap-2 mb-1">
              <span className="tracking-[0.18em] text-[#9a9a9a] text-[9px] font-bold">⚙ AUTONOMY GATES</span>
              {autonomyLive && (
                <span className="text-[9px] text-emerald-300/85" title="dispatcher ON + a live cron schedule — ready work runs without an operator">
                  ✓ live — ready work fires on its own
                </span>
              )}
            </div>
            {/* ① dispatcher */}
            <div className="flex items-baseline gap-2 text-[10px] leading-relaxed">
              <span className="shrink-0 w-3 text-center" style={{ color: dispatcherGreen ? '#4ade80' : '#fbbf24' }}>{dispatcherGreen ? '●' : '○'}</span>
              <span className="shrink-0 w-[74px] text-[#7f7f7f] tracking-[0.05em]">① DISPATCHER</span>
              {dispatcherGreen ? (
                <span className="text-[#bbb]">
                  ON · concurrency {status.concurrency} · checks every {status.tick_seconds}s{status.running ? '' : ' · idle'}
                </span>
              ) : (
                <span className="text-[#8a8a8a]">
                  OFF — set <span className="text-amber-300/90">MC_DISPATCHER_ENABLED=1</span> on bridge start to auto-fire ready work
                </span>
              )}
            </div>
            {/* ② schedule */}
            <div className="flex items-baseline gap-2 text-[10px] leading-relaxed mt-0.5">
              <span className="shrink-0 w-3 text-center" style={{ color: cronGreen ? '#4ade80' : '#fbbf24' }}>{cronGreen ? '●' : '○'}</span>
              <span className="shrink-0 w-[74px] text-[#7f7f7f] tracking-[0.05em]">② SCHEDULE</span>
              {(cronJobs ?? 0) > 0 ? (
                <span className="text-[#bbb]">
                  {cronJobs} cron job{cronJobs === 1 ? '' : 's'}
                  {schedulerLive
                    ? <span className="text-[#7f7f7f]"> · daemon live</span>
                    : <span className="text-amber-300/90"> · daemon DOWN — jobs won't fire</span>}
                </span>
              ) : (
                <span className="text-[#8a8a8a]">
                  0 jobs{schedulerLive ? '' : ' · daemon down'} — seed <span className="text-[#bbb]">sentinel</span> (0 7 * * *) + <span className="text-[#bbb]">content-engine</span> (30 7 * * *) via the ⏱ CRON modal
                </span>
              )}
            </div>
          </div>
        )}

        {/* dispatcher posture banner — honest about why nothing is firing on its own */}
        {status != null && !status.enabled && (
          <div className="shrink-0 px-3 py-1.5 border-b border-white/10 bg-white/[0.02] text-[#8a8a8a] text-[10px] leading-relaxed">
            Dispatcher is <span className="text-[#bbb]">OFF</span> — these {plan.length} task{plan.length === 1 ? '' : 's'} are
            staged in fire order but nothing runs until a watched manual dispatch (Operations → ⚠ diagnostics → ▶ DISPATCH NEXT)
            or autonomous mode is enabled. The top row is what fires first.
          </div>
        )}

        {/* ▶ RUN STATE — the dispatcher's live activity: what's in flight now, the last
            dispatch outcome, and the run counters. Makes the autonomy loop observable
            end-to-end once the operator does the first watched dispatch (TO-DO #1). */}
        {!loading && !error && status != null && (
          <div className="shrink-0 px-3 py-2 border-b border-white/10 bg-white/[0.015]">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="tracking-[0.18em] text-[#9a9a9a] text-[9px] font-bold">▶ RUN STATE</span>
              <span className="text-[9px] text-[#666]">
                {status.ticks} tick{status.ticks === 1 ? '' : 's'} · dispatched {status.dispatched} · errors {status.errors}
              </span>
            </div>

            {/* in-flight: tasks running right now */}
            {status.in_flight.length === 0 ? (
              <div className="text-[10px] text-[#6a6a6a]">
                <span className="text-[#555]">●</span> Nothing in flight — no task is running right now.
              </div>
            ) : (
              <div className="space-y-0.5">
                {status.in_flight.map((id) => (
                  <button key={id} onClick={() => onOpenTask(id)}
                    className="w-full text-left flex items-baseline gap-2 text-[10px] hover:bg-white/[0.03] px-1 py-0.5 rounded-sm">
                    <span className="shrink-0 text-emerald-400 animate-pulse" title="running now">▶</span>
                    <span className="flex-1 min-w-0 truncate text-[#d8d8d8]" title={titleOf(id)}>{titleOf(id)}</span>
                    <span className="shrink-0 text-[#555] text-[9px]">{id}</span>
                  </button>
                ))}
              </div>
            )}

            {/* last dispatch outcome */}
            <div className="mt-1.5 text-[10px] leading-relaxed">
              {status.last_dispatched_id == null ? (
                <span className="text-[#6a6a6a]"><span className="text-[#555]">◷</span> No dispatch yet — nothing has been fired this session.</span>
              ) : (
                <button onClick={() => onOpenTask(status.last_dispatched_id!)}
                  className="text-left w-full hover:bg-white/[0.03] px-1 py-0.5 rounded-sm">
                  <span className="text-[#777]">last fired:</span>{' '}
                  <span className="text-[#c8c8c8]">{titleOf(status.last_dispatched_id)}</span>
                  {status.last_error && (
                    <span className="block text-red-400/90 mt-0.5" title={status.last_error}>⚠ {status.last_error}</span>
                  )}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && <div className="p-3 text-[#777]">loading…</div>}
          {error && <div className="p-3 text-red-400">⚠ {error}</div>}
          {!loading && !error && plan.length === 0 && (
            <div className="p-3 text-[#777] leading-relaxed">
              No task is ready to dispatch — the dispatcher queue is empty. Promote
              actionable todo → ready (▲ PROMOTE READY) or route triage work to feed it.
            </div>
          )}
          {plan.map((p, i) => (
            // Row is a flex container (not a single <button>) so a web-gap assignee can
            // carry its own focus deep-link alongside the task deep-link — nesting two
            // buttons in one button is invalid, so the title and assignee are separate.
            <div key={p.id}
              className="flex items-baseline gap-2 px-3 py-1.5 border-b border-white/[0.05] hover:bg-white/[0.03]">
              <span className="shrink-0 w-6 text-right text-[#545454]" title="dispatch order — lower fires first">{i + 1}</span>
              <span className="shrink-0 w-4 text-center" style={{ color: p.web_gap ? '#fbbf24' : '#4ade80' }}
                title={p.web_gap ? 'assignee needs the live web but has no web MCP' : 'ready — no web gap'}>{p.web_gap ? '⚠' : '✓'}</span>
              <button onClick={() => onOpenTask(p.id)}
                className="flex-1 min-w-0 truncate text-left text-white hover:underline" title={p.title}>{p.title}</button>
              {p.web_gap && onOpenAudit ? (
                // Per-row cross-link (run #33): open the ⚿ WEB-ACCESS audit focused on
                // exactly this assignee — go from "which queued task hits the gap" to
                // "this agent's audit row" in one click.
                <button onClick={() => onOpenAudit(p.assignee)}
                  className="shrink-0 w-[90px] text-right truncate text-amber-300/90 hover:text-amber-200 hover:underline"
                  title={`${p.assignee} needs the live web but has no web MCP — open the ⚿ WEB-ACCESS audit focused on this agent`}>
                  {p.assignee} ↗
                </button>
              ) : (
                <span className="shrink-0 w-[90px] text-right truncate text-[#8a8a8a]" title={`assignee: ${p.assignee}`}>{p.assignee}</span>
              )}
              <span className="shrink-0 w-[120px] text-right truncate text-[#6f6f6f]"
                title={p.agent_model ? `model: ${p.agent_model}${p.agent_mcps.length ? ` · MCPs: ${p.agent_mcps.join(', ')}` : ''}` : 'no model resolved'}>
                {p.agent_model ? p.agent_model.replace(/^claude-/, '') : '—'}
              </span>
            </div>
          ))}
        </div>

        {/* honest footer: queue summary + read-only posture */}
        {!loading && !error && status != null && (
          <div className="shrink-0 px-3 py-1.5 border-t border-white/10 text-[10px] text-[#666] leading-relaxed">
            {plan.length} ready to fire · {webGaps} blocked on a web MCP · dispatched {status.dispatched} · errors {status.errors}.
            Read-only — this lists the queue; firing a task is a watched operator action.
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
