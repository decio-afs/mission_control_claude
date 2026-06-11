// ShortcutsHelp — a global "?" cheat-sheet overlay for Mission Control.
//
// The topbar + War Room + the task drawers have grown a fair number of keyboard
// shortcuts and one-glyph affordances (⌘K palette, ⌘F task search, DIAG, the 🔔
// notification center, ⊞ dependency map, ▶ live log tail, the STATUS/FLOW/BURN &
// LOAD/PERF toggles…). This is the one-stop legend for all of them.
//
// Opens on a bare "?" (Shift+/) from anywhere except a text field, or from the
// topbar "?" button (which dispatches the same key event). Esc / backdrop close.
// Pure static — no stores, no bridge endpoint.
import { useEffect, useState } from 'react';
import { Label, Pill } from './cyberpunk/ui';

interface Shortcut {
  keys: string[];        // rendered as <kbd> chips
  label: string;
  where?: string;        // optional context hint
}

interface Group {
  title: string;
  items: Shortcut[];
}

const GROUPS: Group[] = [
  {
    title: 'Global',
    items: [
      { keys: ['⌘', 'K'], label: 'Command palette — jump to a module, agent, or task' },
      { keys: ['Ctrl', 'K'], label: 'Command palette (Windows / Linux)' },
      { keys: ['⌘', 'F'], label: 'Task search — fuzzy-filter the whole Hermes queue', where: 'jumps to Operations' },
      { keys: ['Ctrl', 'F'], label: 'Task search (Windows / Linux)' },
      { keys: ['?'], label: 'This shortcuts cheat-sheet' },
      { keys: ['Esc'], label: 'Close any overlay, drawer, or modal' },
      { keys: ['↑', '↓'], label: 'Move the selection in the palette / search' },
      { keys: ['↵'], label: 'Open the highlighted result' },
    ],
  },
  {
    title: 'Topbar affordances',
    items: [
      { keys: ['☰'], label: 'Collapse / expand the navigation rail' },
      { keys: ['🔔'], label: 'Notification center — completed / failed task feed + desktop-toast toggle' },
      { keys: ['DIAG'], label: 'Bridge diagnostics — per-endpoint health & latency' },
      { keys: ['⌕ ⌘F'], label: 'Open task search (same as the ⌘F shortcut)' },
      { keys: ['⌘K'], label: 'Open the command palette' },
    ],
  },
  {
    title: 'War Room',
    items: [
      { keys: ['STATUS', 'FLOW', 'BURN'], label: 'Task panel: status breakdown ↔ throughput histogram ↔ backlog burn-down' },
      { keys: ['12H', '24H', '48H'], label: 'Trailing window (in FLOW / BURN view)' },
      { keys: ['LOAD', 'PERF'], label: 'Agent panel: live load ↔ performance leaderboard' },
      { keys: ['Agent', 'Done', '…'], label: 'Click a leaderboard column header to sort by it' },
      { keys: ['TASKS', 'SIGNAL'], label: 'Bottom feed: kanban task log ↔ live agent signal' },
    ],
  },
  {
    title: 'Operations — task drawer',
    items: [
      { keys: ['⊞ MAP'], label: 'Open the task dependency map', where: 'shown when a task has links' },
      { keys: ['▶ LIVE', '⏸ PAUSE'], label: 'Start / stop the live worker-log tail' },
      { keys: ['⟳'], label: 'One-shot refresh of the worker log (while paused)' },
      { keys: ['+ NEW'], label: 'Create a scheduled cron job (SCHEDULED JOBS panel)' },
    ],
  },
];

export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        return;
      }
      // Open on a bare "?" (Shift+/). Ignore it while typing into a field so the
      // character still reaches inputs / textareas / the contenteditable chat box.
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[6000] flex items-start justify-center bg-black/70 backdrop-blur-sm pt-[10vh] px-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl bg-[#0A0A0A] border border-white/10 shadow-2xl flex flex-col max-h-[80vh]"
        style={{ boxShadow: '0 0 0 1px rgba(246,78,110,0.18), 0 24px 80px rgba(0,0,0,0.6)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-3 h-[44px] border-b border-white/10 bg-[#080808] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[#f64e6e] font-mono text-[13px]">?</span>
            <Label className="text-[#b8b8b8] truncate">KEYBOARD SHORTCUTS</Label>
          </div>
          <span className="text-[9px] font-mono text-[#363636] border border-white/10 px-1.5 py-0.5 rounded-sm shrink-0">ESC</span>
        </div>

        {/* Groups */}
        <div className="overflow-auto p-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          {GROUPS.map((g) => (
            <section key={g.title} className="min-w-0">
              <div className="mb-1.5 pb-1 border-b border-white/[0.06]">
                <Pill tone="brand">{g.title}</Pill>
              </div>
              <ul className="flex flex-col">
                {g.items.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 py-1 border-b border-white/[0.03] last:border-0">
                    <span className="flex items-center gap-1 shrink-0 pt-0.5">
                      {s.keys.map((k, ki) => (
                        <span key={ki} className="inline-flex items-center">
                          {ki > 0 && <span className="text-[#363636] text-[9px] mx-0.5 font-mono">/</span>}
                          <kbd className="font-mono text-[9px] text-[#e8e8e8] bg-white/[0.04] border border-white/15 rounded-sm px-1.5 py-0.5 leading-none whitespace-nowrap">
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </span>
                    <span className="min-w-0 text-[11px] text-[#b8b8b8] leading-snug">
                      {s.label}
                      {s.where && <span className="text-[#545454] font-mono text-[10px]"> · {s.where}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between px-3 h-[28px] border-t border-white/10 bg-[#080808] shrink-0">
          <Label className="text-[#363636]">MISSION CONTROL · LEGEND</Label>
          <div className="flex items-center gap-3 text-[9px] font-mono text-[#545454]">
            <span>press <span className="text-[#b8b8b8]">?</span> to toggle</span>
            <span>Esc to close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
