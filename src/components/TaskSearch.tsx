// TaskSearch — global ⌘F / Ctrl+F task finder for Mission Control.
//
// Distinct from the ⌘K Command Palette (which jumps to nav modules / agents):
// this is a deep, task-only filter across the entire Hermes queue by title, id,
// assignee or status. Selecting a task routes to Operations and focuses it
// (scroll-into-view + highlight) via useTaskFocusStore. Reads useTaskStore's
// already-globally-polled hermesTasks — no new bridge endpoint.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTaskStore } from '../stores/useTaskStore';
import { useTaskFocusStore } from '../stores/useTaskFocusStore';
import { Label, Pill } from './cyberpunk/ui';
import type { HermesTask } from '../lib/api';

const STATUS_FILTERS = ['ALL', 'READY', 'RUNNING', 'BLOCKED', 'DONE', 'FAILED'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function statusTone(status: string): 'good' | 'warn' | 'info' | 'bad' | 'neutral' {
  const s = status.toLowerCase();
  if (s === 'done' || s === 'completed') return 'good';
  if (s === 'running') return 'warn';
  if (s === 'ready') return 'info';
  if (s === 'failed' || s === 'blocked') return 'bad';
  return 'neutral';
}

// Subsequence fuzzy score: every query char must appear in order; lower = better.
function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let ti = 0;
  let score = 0;
  let lastHit = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return -1;
    score += found;
    if (lastHit !== -1) score += (found - lastHit) * 2;
    lastHit = found;
    ti = found + 1;
  }
  return score;
}

function matchesFilter(status: string, f: StatusFilter): boolean {
  if (f === 'ALL') return true;
  const s = status.toLowerCase();
  if (f === 'DONE') return s === 'done' || s === 'completed';
  return s === f.toLowerCase();
}

export default function TaskSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { hermesTasks } = useTaskStore();
  const focus = useTaskFocusStore((s) => s.focus);

  const close = () => { setOpen(false); setQuery(''); setActive(0); setStatusFilter('ALL'); };

  // Toggle on ⌘F / Ctrl+F from anywhere. preventDefault so the browser's native
  // find bar never steals it (Electron + dev browser).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (open) close(); else { setQuery(''); setActive(0); setStatusFilter('ALL'); setOpen(true); }
      } else if (e.key === 'Escape' && open) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  const results = useMemo<HermesTask[]>(() => {
    const byStatus = hermesTasks.filter((t) => matchesFilter(t.status, statusFilter));
    if (!query.trim()) {
      return [...byStatus].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 50);
    }
    const scored: { task: HermesTask; score: number }[] = [];
    for (const t of byStatus) {
      const hay = `${t.title} ${t.id} ${t.assignee || ''} ${t.status}`;
      const s = fuzzyScore(query, hay);
      if (s >= 0) scored.push({ task: t, score: s });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 50).map((s) => s.task);
  }, [hermesTasks, query, statusFilter]);

  const safeActive = results.length ? Math.min(active, results.length - 1) : 0;

  const choose = (task: HermesTask | undefined) => {
    if (!task) return;
    close();
    focus(task.id);
    navigate('/operations');
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[safeActive]);
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${safeActive}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [safeActive]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[6000] flex items-start justify-center bg-black/70 backdrop-blur-sm pt-[12vh] px-4"
      onClick={close}
    >
      <div
        className="w-full max-w-xl bg-[#0A0A0A] border border-white/10 shadow-2xl"
        style={{ boxShadow: '0 0 0 1px rgba(246,78,110,0.18), 0 24px 80px rgba(0,0,0,0.6)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search row */}
        <div className="flex items-center gap-2 px-3 h-[44px] border-b border-white/10 bg-[#080808]">
          <span className="text-[#f64e6e] font-mono text-[11px]">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onInputKey}
            placeholder="Find a task by title, id, assignee, or status…"
            className="flex-1 bg-transparent outline-none text-[13px] text-white placeholder:text-[#545454] font-mono"
          />
          <span className="text-[10px] font-mono text-[#363636] border border-white/10 px-1.5 py-0.5 rounded-sm">ESC</span>
        </div>

        {/* Status filter chips */}
        <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-white/10 bg-[#060606]">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => { setStatusFilter(f); setActive(0); }}
              className={`px-2 py-0.5 text-[10px] font-mono tracking-[0.15em] border ${
                statusFilter === f ? 'border-[#f64e6e] text-[#f64e6e] bg-[#f64e6e]/5' : 'border-white/10 text-[#b8b8b8] hover:border-white/30'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[46vh] overflow-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-[11px] font-mono text-[#545454]">
              {hermesTasks.length === 0 ? 'No tasks in the queue yet.' : `No tasks match${query ? ` “${query}”` : ''}.`}
            </div>
          )}
          {results.map((t, idx) => {
            const is = idx === safeActive;
            return (
              <button
                key={t.id}
                data-idx={idx}
                onMouseEnter={() => setActive(idx)}
                onClick={() => choose(t)}
                className={`w-full text-left px-3 py-2 flex items-center gap-3 border-l-2 transition-colors ${is ? 'bg-white/[0.04] border-[#f64e6e]' : 'border-transparent hover:bg-white/[0.02]'}`}
              >
                <Pill tone={statusTone(t.status)} className="shrink-0">{t.status.toUpperCase()}</Pill>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-white truncate">{t.title}</div>
                  <div className="text-[10px] font-mono text-[#545454] truncate">
                    {t.id} · {t.assignee || 'unassigned'} · P{t.priority}
                  </div>
                </div>
                {is && <span className="text-[10px] font-mono text-[#f64e6e] shrink-0">↵</span>}
              </button>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between px-3 h-[28px] border-t border-white/10 bg-[#080808]">
          <Label className="text-[#363636]">TASK SEARCH · ⌘F</Label>
          <div className="flex items-center gap-3 text-[10px] font-mono text-[#545454]">
            <span>↑↓ navigate</span>
            <span>↵ open in ops</span>
            <span>{results.length} results</span>
          </div>
        </div>
      </div>
    </div>
  );
}
