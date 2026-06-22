import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useGhostStore } from '../stores/useGhostStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useSystemStore } from '../stores/useSystemStore';
import { useTaskStore } from '../stores/useTaskStore';
import { MODULES } from '../lib/nav';
import { BRIDGE_BASE_URL } from '../lib/api';
import ErrorBoundary from './ErrorBoundary';
import CommandPalette from './CommandPalette';
import TaskSearch from './TaskSearch';
import BridgeDiagnostics from './BridgeDiagnostics';
import PatchNotes from './PatchNotes';
import AgentDrillDown from './AgentDrillDown';
import TaskNotifier from './TaskNotifier';
import NotifyCenter from './NotifyCenter';
import ShortcutsHelp from './ShortcutsHelp';

// Port shown in the topbar bridge status line — derived from the real bridge
// URL (api.ts, VITE_BRIDGE_URL || :8767) so it stays accurate when the bridge
// runs elsewhere, instead of a hardcoded ":8767" literal.
const BRIDGE_PORT = (() => {
  try {
    return new URL(BRIDGE_BASE_URL).port || '8767';
  } catch {
    return '8767';
  }
})();

// const ACCENT_OPTIONS: Record<string, string> = {
//   coral:  '#f64e6e',
//   amber:  '#f59e0b',
//   emerald:'#10b981',
//   sky:    '#38bdf8',
//   violet: '#ff795e',
// };

const DEFAULT_TWEAKS = { accent: '#f64e6e', density: 'cozy', scanlines: 'soft', motion: 'high' };

function loadTweaks(): typeof DEFAULT_TWEAKS {
  try {
    const saved = localStorage.getItem('mc-tweaks');
    if (saved) return { ...DEFAULT_TWEAKS, ...JSON.parse(saved) };
  } catch { /* ignore bad cache */ }
  return DEFAULT_TWEAKS;
}

export default function Layout() {
  // Lazy initializer reads persisted tweaks once — no setState-in-effect needed.
  const [tweaks] = useState(loadTweaks);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop sidebar collapse (slides the nav off to the left), persisted.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('mc-nav-collapsed') === '1'; } catch { return false; }
  });
  const [diagOpen, setDiagOpen] = useState(false);
  const [patchOpen, setPatchOpen] = useState(false);
  // Interface settings popover (gear in the topbar) — holds the rich/lightweight
  // UI switch; closes on any click outside it.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const richNetworkUI = useSettingsStore((s) => s.richNetworkUI);
  const setRichNetworkUI = useSettingsStore((s) => s.setRichNetworkUI);
  const [now, setNow] = useState(() => new Date());
  const location = useLocation();
  const activeModule = MODULES.find(m => location.pathname.startsWith(m.path))?.id || 'network';

  const { nodes, fetchTopology } = useGhostStore();
  const { vitals, fetchMcStatus } = useSystemStore();
  const { summary, fetchTasks } = useTaskStore();

  // Keep the shell (topbar, roster, status) live on every route.
  useEffect(() => {
    const poll = () => {
      void fetchMcStatus();
      void fetchTopology();
      void fetchTasks();
    };
    poll();
    const id = setInterval(poll, 7000);
    return () => clearInterval(id);
  }, [fetchMcStatus, fetchTopology, fetchTasks]);

  // Tick the ZULU clock once a second so it stays live between the 7s data polls.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!settingsRef.current?.contains(e.target as Node)) setSettingsOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [settingsOpen]);

  const { error: ghostError } = useGhostStore();
  const { error: taskError } = useTaskStore();
  const { error: systemError } = useSystemStore();

  const accent = tweaks.accent;
  const agents = nodes.filter(n => n.type !== 'squad');
  const isOnline = (n: typeof nodes[number]) => n.status === 'active' || n.status === 'online';
  const onlineCount = agents.filter(isOnline).length;
  const busyCount = agents.filter(n => (n.tasks_running ?? 0) > 0).length;
  const runnersOnline = agents.filter(n => n.type === 'runner' && isOnline(n)).length;
  const runnersTotal = agents.filter(n => n.type === 'runner').length;
  const fixersOnline = agents.filter(n => n.type === 'fixer' && isOnline(n)).length;
  const fixersTotal = agents.filter(n => n.type === 'fixer').length;

  useEffect(() => {
    localStorage.setItem('mc-tweaks', JSON.stringify(tweaks));
  }, [tweaks]);

  useEffect(() => {
    try { localStorage.setItem('mc-nav-collapsed', collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  const scanClass = tweaks.scanlines === 'off' ? '' : tweaks.scanlines === 'hard' ? 'scan-hard' : 'scan-soft';

  return (
    <div className={`h-screen w-screen flex bg-[#050505] text-white overflow-hidden ${tweaks.density === 'compact' ? 'density-compact' : ''}`}>
      <style>{`
        :root { --accent: ${accent}; }
        .mc-panel { background: #0A0A0A; border: 1px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; }
        .density-compact .mc-panel { background: #080808; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes blink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }
        .scan-soft::after { content:''; position:absolute; inset:0; pointer-events:none; z-index:50;
          background-image: repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0px, transparent 1px, transparent 2px, rgba(0,0,0,0.08) 3px); mix-blend-mode: overlay; }
        .scan-hard::after { content:''; position:absolute; inset:0; pointer-events:none; z-index:50;
          background-image: repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0px, transparent 1px, transparent 2px, rgba(0,0,0,0.15) 3px); mix-blend-mode: overlay; }
      `}</style>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[220px] shrink-0 border-r border-white/[0.07] flex flex-col transition-all duration-300 lg:relative ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} ${collapsed ? 'lg:w-0 lg:-translate-x-full lg:border-r-0 lg:overflow-hidden' : 'lg:w-[220px] lg:translate-x-0'}`}
        style={{ background: 'linear-gradient(180deg, #0b0b0e 0%, #060608 55%, #050507 100%)', boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.03)' }}>
        {/* Logo */}
        <div className="h-[50px] px-3 flex items-center gap-2 border-b border-white/10 shrink-0">
          <div className="w-7 h-7 relative" style={{ background: `linear-gradient(135deg, ${accent}, #ff795e)`, clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }}>
            <div className="absolute inset-[3px]" style={{ background: '#050505', clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }} />
            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-bold" style={{ color: accent }}>G01</div>
          </div>
          <div className="flex flex-col">
            <div className="text-[11px] font-black tracking-[0.18em] text-white leading-tight">MISSION CTL</div>
            <div className="text-[10px] font-mono text-[#545454] tracking-[0.3em]">CLAUDE-FLEET</div>
          </div>
          <button onClick={() => setMobileOpen(false)} className="lg:hidden ml-auto text-[#545454] hover:text-white text-xs">✕</button>
          <button onClick={() => setCollapsed(true)} title="Collapse navigation" className="hidden lg:block ml-auto text-[#545454] hover:text-white text-sm leading-none">‹</button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2">
          {MODULES.map((m) => {
            const is = activeModule === m.id;
            return (
              <NavLink key={m.id} to={m.path} onClick={() => setMobileOpen(false)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 border-l-2 transition-all group ${is ? '' : 'border-transparent hover:bg-white/[0.03]'}`}
                style={{
                  borderLeftColor: is ? accent : 'transparent',
                  background: is ? `linear-gradient(90deg, ${accent}1f 0%, ${accent}08 45%, transparent 100%)` : undefined,
                  boxShadow: is ? `inset 0 1px 0 rgba(255,255,255,0.04)` : undefined,
                }}>
                <span className="text-[10px] font-mono text-[#363636] w-5">{m.num}</span>
                <span className={`text-[11px] font-bold tracking-[0.12em] uppercase ${is ? 'text-white' : 'text-[#b8b8b8] group-hover:text-white'}`}>
                  {m.label}
                </span>
                {is && <span className="ml-auto text-[10px]" style={{ color: accent }}>▸</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Legion roster strip */}
        <div className="border-t border-white/10 p-3 shrink-0">
          <div className="font-mono text-[10px] tracking-[0.2em] uppercase font-bold text-[#545454] mb-2">FLEET STATUS</div>
          <div className="grid grid-cols-5 gap-1 mb-2">
            {agents.slice(0, 25).map(a => {
              const squadColor = a.squad ? {
                CORE: '#f64e6e', SEC: '#a78bfa', INTEL: '#22d3ee', INFRA: '#10b981', CONT: '#f59e0b', DEV: '#38bdf8'
              }[a.squad] || '#1a1a1a' : '#1a1a1a';
              const isOnline = a.status === 'active' || a.status === 'online';
              const isBusy = (a.tasks_running ?? 0) > 0;
              return (
                <div key={a.id} className="w-full aspect-square relative" title={a.name}
                  style={{
                    background: isOnline ? (isBusy ? accent : squadColor) : '#1a1a1a',
                    opacity: isOnline ? (isBusy ? 1 : 0.5) : 0.3,
                  }} />
              );
            })}
            {agents.length === 0 && Array.from({ length: 25 }).map((_, i) => (
              <div key={i} className="w-full aspect-square relative" style={{ background: '#1a1a1a', opacity: 0.3 }} />
            ))}
          </div>
          <div className="flex justify-between text-[10px] font-mono text-[#545454]">
            <span><span className="text-emerald-400">●</span> {onlineCount}</span>
            <span><span style={{ color: accent }}>●</span> {busyCount} busy</span>
            <span>{agents.length} total</span>
          </div>
        </div>

        <div className="border-t border-white/10 px-3 py-2 shrink-0 text-[10px] font-mono text-[#363636] leading-relaxed">
          claude bridge<br/>
          {vitals.mcVersion}<br/>
          <span className={vitals.mcOnline ? 'text-emerald-400' : 'text-red-400'}>● BRIDGE :{BRIDGE_PORT}</span>
          {(systemError || ghostError || taskError) && (
            <div className="mt-1 text-red-400 truncate">
              {systemError && `⚠ ${systemError}`}
              {ghostError && ` ⚠ ${ghostError}`}
              {taskError && ` ⚠ ${taskError}`}
            </div>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* TopBar */}
        {/* relative z-40: backdrop-blur creates a stacking context, which traps
            the NotifyCenter dropdown's z-index inside the header — without
            lifting the header itself, page content paints over the dropdown. */}
        <header
          className="relative z-40 h-[40px] shrink-0 border-b border-white/[0.07] flex items-center px-4 gap-6 text-[10px] font-mono backdrop-blur-md"
          style={{ background: 'linear-gradient(180deg, rgba(13,13,16,0.92), rgba(7,7,9,0.88))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px -18px rgba(0,0,0,0.9)' }}>
          <button onClick={() => setMobileOpen(true)} className="lg:hidden text-[#b8b8b8] hover:text-white mr-2">☰</button>
          <button onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Show navigation' : 'Hide navigation'} className="hidden lg:inline-flex items-center text-[#b8b8b8] hover:text-white mr-1">☰</button>
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${vitals.mcOnline ? 'bg-emerald-400' : 'bg-red-400'}`} style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
            <span className="text-[#b8b8b8] tracking-[0.2em]">CLAUDE {vitals.mcOnline ? 'ONLINE' : 'OFFLINE'}</span>
          </div>
          <div className="h-4 w-px bg-white/10 hidden sm:block" />
          <div className="hidden sm:flex items-center gap-4 text-[#545454]">
            <span>RUNNERS <span className="text-white tabular-nums">{runnersOnline}/{runnersTotal}</span></span>
            <span>FIXERS <span className="text-emerald-400 tabular-nums">{fixersOnline}/{fixersTotal}</span></span>
            <span>QUEUE <span className="text-white tabular-nums">{summary ? summary.pending + summary.ready : 0}</span></span>
            <span>LAT <span className="text-emerald-400 tabular-nums">{vitals.connectionLatencyMs}ms</span></span>
            <span>TASKS <span style={{ color: accent }}>{summary?.total ?? 0}</span></span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <NotifyCenter accent={accent} />
            <div className="relative" ref={settingsRef}>
              <button
                onClick={() => setSettingsOpen((o) => !o)}
                title="Interface settings — rich vs lightweight UI"
                className={`flex items-center gap-1.5 border rounded-sm px-1.5 py-0.5 transition-colors ${settingsOpen ? 'text-white border-white/30' : 'text-[#545454] hover:text-white border-white/10 hover:border-white/30'}`}
              >
                <span className="text-[10px]">⚙ UI</span>
              </button>
              {settingsOpen && (
                <div
                  className="absolute right-0 top-[28px] w-[272px] border border-white/15 p-3"
                  style={{ background: 'linear-gradient(180deg, #0d0d10, #070709)', boxShadow: '0 16px 40px -12px rgba(0,0,0,0.9)' }}
                >
                  <div className="text-[10px] tracking-[0.2em] font-bold text-[#545454] mb-3">INTERFACE SETTINGS</div>
                  <div className="flex items-start gap-2.5">
                    <button
                      role="switch"
                      aria-checked={richNetworkUI}
                      aria-label="Rich network UI"
                      onClick={() => setRichNetworkUI(!richNetworkUI)}
                      className="relative w-8 h-[16px] shrink-0 border transition-colors mt-[1px]"
                      style={{
                        borderColor: richNetworkUI ? accent : 'rgba(255,255,255,0.2)',
                        background: richNetworkUI ? `${accent}33` : 'transparent',
                      }}
                    >
                      <span
                        className="absolute top-[2px] w-[10px] h-[10px] transition-all"
                        style={{ left: richNetworkUI ? 18 : 2, background: richNetworkUI ? accent : '#545454' }}
                      />
                    </button>
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold tracking-[0.15em] text-white">RICH NETWORK UI</div>
                      <div className="text-[10px] text-[#737373] leading-relaxed mt-1">
                        16-bit office scene on the NETWORK deck. Heavier on CPU/GPU — leave off for the lightweight mesh.
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <button
                      onClick={() => { setPatchOpen(true); setSettingsOpen(false); }}
                      className="w-full flex items-center justify-between text-[10px] tracking-[0.15em] font-bold text-[#b8b8b8] hover:text-white border border-white/10 hover:border-white/30 px-2 py-1.5 transition-colors"
                    >
                      <span>⊞ PATCH NOTES</span>
                      <span className="text-[#545454]">›</span>
                    </button>
                    <div className="text-[10px] text-[#737373] leading-relaxed mt-1.5">
                      What the autonomous bug-hunt routine has fixed, newest first.
                    </div>
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => setDiagOpen(true)}
              title="Bridge diagnostics — endpoint health & latency"
              className="flex items-center gap-1.5 text-[#545454] hover:text-white border border-white/10 hover:border-white/30 rounded-sm px-1.5 py-0.5 transition-colors"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${vitals.mcOnline ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <span className="text-[10px] hidden sm:inline">DIAG</span>
            </button>
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }))}
              title="Search tasks (Ctrl/⌘ F)"
              className="hidden sm:flex items-center gap-1 text-[#545454] hover:text-white border border-white/10 hover:border-white/30 rounded-sm px-1.5 py-0.5 transition-colors"
            >
              <span className="text-[10px]">⌕ ⌘F</span>
            </button>
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
              title="Command palette (Ctrl/⌘ K)"
              className="hidden sm:flex items-center gap-1 text-[#545454] hover:text-white border border-white/10 hover:border-white/30 rounded-sm px-1.5 py-0.5 transition-colors"
            >
              <span className="text-[10px]">⌘K</span>
            </button>
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}
              title="Keyboard shortcuts (?)"
              className="hidden sm:flex items-center gap-1 text-[#545454] hover:text-white border border-white/10 hover:border-white/30 rounded-sm px-1.5 py-0.5 transition-colors"
            >
              <span className="text-[10px]">?</span>
            </button>
            <span className="text-[#545454] hidden sm:inline">ZULU</span>
            <span className="text-white tabular-nums text-[11px] tracking-[0.15em]">
              {now.toISOString().slice(11, 19)}
            </span>
            <span className="text-[#545454] hidden sm:inline">· {now.toISOString().slice(0, 10).replace(/-/g, '.')}</span>
          </div>
        </header>

        <main className="flex-1 relative overflow-hidden">
          {/* Keyed on pathname so a crashed route resets to a fresh mount when
              the operator navigates elsewhere — see ErrorBoundary header. */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
          {scanClass && (
            <div className={`pointer-events-none absolute inset-0 z-50 ${scanClass}`} style={{
              backgroundImage: `repeating-linear-gradient(0deg, rgba(255,255,255,${tweaks.scanlines === 'hard' ? 0.05 : 0.02}) 0px, transparent 1px, transparent 2px, rgba(0,0,0,${tweaks.scanlines === 'hard' ? 0.15 : 0.08}) 3px)`,
              mixBlendMode: 'overlay',
            }} />
          )}
        </main>
      </div>

      {/* Global ⌘K / Ctrl+K command palette — available on every route. */}
      <CommandPalette />

      {/* Global ⌘F / Ctrl+F task search — deep filter across the Mc queue. */}
      <TaskSearch />

      {/* Bridge health diagnostics — opened from the topbar DIAG button. */}
      {diagOpen && <BridgeDiagnostics onClose={() => setDiagOpen(false)} />}

      {/* Patch notes — changelog of the bug-hunt routine, opened from ⚙ UI settings. */}
      {patchOpen && <PatchNotes onClose={() => setPatchOpen(false)} />}

      {/* Agent drill-down slide-over — opened by clicking any agent in a roster. */}
      <AgentDrillDown />

      {/* Headless watcher — fires desktop notifications on task-complete/fail. */}
      <TaskNotifier />

      {/* Global "?" keyboard-shortcuts cheat-sheet — available on every route. */}
      <ShortcutsHelp />
    </div>
  );
}
