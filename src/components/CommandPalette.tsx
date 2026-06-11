// CommandPalette — global ⌘K / Ctrl+K launcher for Mission Control.
//
// A keyboard-first jump-to for an ops dashboard: fuzzy-search across every
// navigation module plus LIVE Hermes entities (agents from useGhostStore,
// tasks from useTaskStore — both already polled by Layout). Selecting a result
// routes to the relevant screen. No new bridge endpoint needed: it reads the
// same live stores the rest of the app subscribes to.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MODULES } from '../lib/nav';
import { useGhostStore } from '../stores/useGhostStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useAgentDrilldownStore } from '../stores/useAgentDrilldownStore';
import { Label, Pill } from './cyberpunk/ui';

type Kind = 'module' | 'agent' | 'task' | 'action';

interface Item {
  kind: Kind;
  id: string;
  title: string;
  sub: string;
  path: string;
  keywords: string;
}

const KIND_META: Record<Kind, { tone: 'brand' | 'good' | 'info' | 'warn'; tag: string }> = {
  module: { tone: 'brand', tag: 'NAV' },
  agent:  { tone: 'good',  tag: 'AGENT' },
  task:   { tone: 'info',  tag: 'TASK' },
  action: { tone: 'warn',  tag: 'ACTION' },
};

// Lightweight subsequence fuzzy score: every query char must appear in order.
// Returns a rank (lower = better) or -1 for no match. Contiguous + early hits win.
function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let ti = 0;
  let score = 0;
  let lastHit = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const found = t.indexOf(c, ti);
    if (found === -1) return -1;
    score += found;                                   // earlier matches rank better
    if (lastHit !== -1) score += (found - lastHit) * 2; // reward contiguity
    lastHit = found;
    ti = found + 1;
  }
  return score;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { nodes } = useGhostStore();
  const { hermesTasks } = useTaskStore();
  const openDrilldown = useAgentDrilldownStore((s) => s.open);

  const close = () => { setOpen(false); setQuery(''); setActive(0); };

  // Toggle on ⌘K / Ctrl+K from anywhere in the app. Re-registered on `open` so
  // the handler reads the current state without resetting state inside an effect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (open) close(); else { setQuery(''); setActive(0); setOpen(true); }
      } else if (e.key === 'Escape' && open) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus the input when the palette opens (no state writes here).
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const mods: Item[] = MODULES.map((m) => ({
      kind: 'module',
      id: `mod-${m.id}`,
      title: m.label,
      sub: `Module ${m.num} · ${m.path}`,
      path: m.path,
      keywords: `${m.label} ${m.short} ${m.id}`,
    }));

    const agents: Item[] = nodes
      .filter((n) => n.type !== 'squad')
      .map((n) => ({
        kind: 'agent',
        id: `agent-${n.id}`,
        title: n.name,
        sub: `${(n.type || 'agent').toUpperCase()}${n.squad ? ` · ${n.squad}` : ''} · ${(n.status || 'unknown').toUpperCase()}`,
        path: '/network',
        keywords: `${n.name} ${n.squad || ''} ${n.type} agent`,
      }));

    const tsk: Item[] = hermesTasks.slice(0, 60).map((t) => ({
      kind: 'task',
      id: `task-${t.id}`,
      title: t.title,
      sub: `${String(t.status).toUpperCase()} · ${t.assignee || 'unassigned'}`,
      path: '/operations',
      keywords: `${t.title} ${t.assignee || ''} ${t.status} task`,
    }));

    const actions: Item[] = [
      { kind: 'action', id: 'act-new-task', title: 'New Task', sub: 'Open Operations queue', path: '/operations', keywords: 'new task create operations queue' },
      { kind: 'action', id: 'act-new-agent', title: 'New Agent', sub: 'Open Ghost Network', path: '/network', keywords: 'new agent create registry hub' },
      { kind: 'action', id: 'act-chat', title: 'Ghost Comms', sub: 'Talk to Hermes', path: '/chat', keywords: 'chat ask hermes comms talk' },
    ];

    return [...mods, ...actions, ...agents, ...tsk];
  }, [nodes, hermesTasks]);

  const results = useMemo(() => {
    if (!query.trim()) {
      // Default view: modules + quick actions, no live-entity noise.
      return items.filter((i) => i.kind === 'module' || i.kind === 'action').slice(0, 12);
    }
    const scored: { item: Item; score: number }[] = [];
    for (const item of items) {
      const s = fuzzyScore(query, item.keywords);
      if (s >= 0) scored.push({ item, score: s });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 40).map((s) => s.item);
  }, [items, query]);

  // Clamp the highlighted index in render so a shrinking result set never points
  // out of bounds — avoids writing state from an effect.
  const safeActive = results.length ? Math.min(active, results.length - 1) : 0;

  const choose = (item: Item | undefined) => {
    if (!item) return;
    close();
    // Agents open the shared drill-down slide-over in place (same surface the
    // Agent Hub / Command / Nexus rosters use) rather than just navigating.
    if (item.kind === 'agent') {
      openDrilldown(item.title);
      return;
    }
    navigate(item.path);
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

  // Scroll the active row into view.
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
          <span className="text-[#f64e6e] font-mono text-[11px]">▸</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onInputKey}
            placeholder="Jump to module, agent, or task…"
            className="flex-1 bg-transparent outline-none text-[13px] text-white placeholder:text-[#545454] font-mono"
          />
          <span className="text-[10px] font-mono text-[#363636] border border-white/10 px-1.5 py-0.5 rounded-sm">ESC</span>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-[11px] font-mono text-[#545454]">
              No matches for “{query}”.
            </div>
          )}
          {results.map((item, idx) => {
            const meta = KIND_META[item.kind];
            const is = idx === safeActive;
            return (
              <button
                key={item.id}
                data-idx={idx}
                onMouseEnter={() => setActive(idx)}
                onClick={() => choose(item)}
                className={`w-full text-left px-3 py-2 flex items-center gap-3 border-l-2 transition-colors ${is ? 'bg-white/[0.04] border-[#f64e6e]' : 'border-transparent hover:bg-white/[0.02]'}`}
              >
                <Pill tone={meta.tone} className="shrink-0">{meta.tag}</Pill>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-white truncate">{item.title}</div>
                  <div className="text-[10px] font-mono text-[#545454] truncate">{item.sub}</div>
                </div>
                {is && <span className="text-[10px] font-mono text-[#f64e6e] shrink-0">↵</span>}
              </button>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between px-3 h-[28px] border-t border-white/10 bg-[#080808]">
          <Label className="text-[#363636]">COMMAND PALETTE</Label>
          <div className="flex items-center gap-3 text-[10px] font-mono text-[#545454]">
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>{results.length} results</span>
          </div>
        </div>
      </div>
    </div>
  );
}
