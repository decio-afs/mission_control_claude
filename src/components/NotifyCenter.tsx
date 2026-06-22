import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifyStore } from '../stores/useNotifyStore';
import { useTaskFocusStore } from '../stores/useTaskFocusStore';

// Notification Center — a dropdown anchored to the topbar bell. Lists the
// task-complete / task-fail events recorded this session (by TaskNotifier, which
// records EVERY terminal transition regardless of the OS-toast toggle), so the
// operator can review what finished even if they muted desktop notifications or
// missed an OS toast. Clicking an event jumps to that task in Operations.
//
// The bell also still owns the OS-notification on/off toggle (folded into the
// dropdown header), and shows an unseen-count badge. Pure client — no bridge.

// Per-outcome glyph + label + tint. `blocked` is the live adverse state (the
// store never emits `failed`); render it distinctly from a completion so the
// operator can tell at a glance that delegated work dead-ended.
const OUTCOME_TONE: Record<string, { glyph: string; label: string; cls: string; sub: string }> = {
  done:    { glyph: '✓', label: 'DONE',    cls: 'text-emerald-400', sub: 'text-emerald-400/80' },
  failed:  { glyph: '✕', label: 'FAILED',  cls: 'text-red-400',     sub: 'text-red-400/80' },
  blocked: { glyph: '⚠', label: 'BLOCKED', cls: 'text-amber-400',   sub: 'text-amber-400/80' },
};

function ago(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0 || !Number.isFinite(diff)) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NotifyCenter({ accent }: { accent: string }) {
  const {
    enabled,
    permission,
    history,
    unseen,
    toggle,
    markSeen,
    clearHistory,
  } = useNotifyStore();
  const focus = useTaskFocusStore((s) => s.focus);
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  // Re-render once a minute so the relative timestamps stay fresh while open.
  const [, setTick] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Clear the unseen badge whenever the panel is opened.
  useEffect(() => {
    if (open) markSeen();
  }, [open, markSeen]);

  // Tick relative timestamps only while the dropdown is open.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [open]);

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openEvent = (taskId: string) => {
    focus(taskId);
    navigate('/operations');
    setOpen(false);
  };

  const badge = unseen > 0 ? (unseen > 9 ? '9+' : String(unseen)) : null;
  const toggleDisabled = permission === 'unsupported';

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Notification center — recent task completions"
        className={`relative flex items-center gap-1 border rounded-sm px-1.5 py-0.5 transition-colors ${
          enabled ? 'border-white/30 text-white' : 'text-[#545454] hover:text-white border-white/10 hover:border-white/30'
        }`}
        style={enabled ? { color: accent, borderColor: accent } : undefined}
      >
        <span className="text-[11px] leading-none">{enabled ? '🔔' : '🔕'}</span>
        <span className="text-[10px] hidden md:inline">{enabled ? 'NOTIFY' : 'MUTED'}</span>
        {badge && (
          <span
            className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-1 flex items-center justify-center rounded-full text-[10px] font-bold leading-none text-[#050505]"
            style={{ background: accent }}
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-[60] w-[320px] max-w-[90vw] bg-[#0A0A0A] border border-white/12 rounded-sm shadow-2xl shadow-black/60 flex flex-col"
          role="dialog"
        >
          {/* Header — title + OS-toast toggle */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase font-bold text-[#b8b8b8]">
              Notifications
            </span>
            {history.length > 0 && (
              <span className="font-mono text-[10px] text-[#545454]">{history.length}</span>
            )}
            <button
              onClick={() => { void toggle(); }}
              disabled={toggleDisabled}
              title={
                permission === 'unsupported'
                  ? 'Desktop notifications not supported here'
                  : permission === 'denied'
                    ? 'Blocked by the OS — enable in system settings'
                    : enabled
                      ? 'Desktop toasts ON — click to mute'
                      : 'Desktop toasts OFF — click to enable'
              }
              className={`ml-auto font-mono text-[10px] tracking-[0.12em] uppercase border rounded-sm px-1.5 py-0.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                enabled ? 'text-white' : 'text-[#545454] hover:text-white border-white/10 hover:border-white/30'
              }`}
              style={enabled ? { color: accent, borderColor: accent } : undefined}
            >
              {enabled ? '🔔 ON' : '🔕 OFF'}
            </button>
          </div>

          {/* Permission hint */}
          {(permission === 'denied' || permission === 'unsupported') && (
            <div className="px-3 py-1.5 border-b border-white/10 text-[10px] font-mono text-amber-400/80 leading-relaxed">
              {permission === 'unsupported'
                ? 'Desktop toasts unavailable here — in-app history still records completions.'
                : 'Desktop toasts blocked by the OS — in-app history still records completions.'}
            </div>
          )}

          {/* Event list */}
          <div className="max-h-[340px] overflow-y-auto">
            {history.length === 0 ? (
              <div className="px-3 py-6 text-center text-[10px] font-mono text-[#545454]">
                No completed tasks yet this session.
                <div className="mt-1 text-[10px] text-[#363636]">
                  Finished &amp; blocked tasks will appear here.
                </div>
              </div>
            ) : (
              history.map((e) => {
                const t = OUTCOME_TONE[e.outcome] ?? OUTCOME_TONE.done;
                return (
                  <button
                    key={`${e.key}-${e.at}`}
                    onClick={() => openEvent(e.taskId)}
                    className="w-full text-left px-3 py-2 flex items-start gap-2.5 border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
                  >
                    <span className={`mt-0.5 text-[11px] leading-none ${t.cls}`}>
                      {t.glyph}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] text-white truncate">{e.title}</span>
                      <span className="block mt-0.5 font-mono text-[10px] text-[#545454] tracking-[0.06em]">
                        <span className={t.sub}>{t.label}</span>
                        {e.assignee && <span className="text-[#777]"> · {e.assignee}</span>}
                        <span> · {ago(e.at)}</span>
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          {history.length > 0 && (
            <div className="flex items-center px-3 py-1.5 border-t border-white/10">
              <span className="font-mono text-[10px] text-[#363636] tracking-[0.1em]">
                SESSION LOG
              </span>
              <button
                onClick={clearHistory}
                className="ml-auto font-mono text-[10px] tracking-[0.1em] uppercase text-[#545454] hover:text-white transition-colors"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
