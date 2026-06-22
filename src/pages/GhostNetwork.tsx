// Agent Network — "NEXUS // Orchestration Deck".
//
// Ported from the Claude Design "jarvis" handoff bundle and wired to LIVE Mc
// data: the agent roster, orbital mesh, grid cards and detail panel all render
// real agents from useGhostStore; the activity stream is the live Mc feed;
// and the command bar issues real directives to the orchestrator via sendMcChat.
import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGhostStore, agentLoad, type GhostNode } from '../stores/useGhostStore';
import { useActivityStore } from '../stores/useActivityStore';
import { useAgentDrilldownStore } from '../stores/useAgentDrilldownStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useTaskFocusStore } from '../stores/useTaskFocusStore';
import { useAgentCrud } from '../components/useAgentCrud';
import { useChatStore } from '../stores/useChatStore';
import { useVoiceLink, type VoicePhase } from '../components/useVoiceLink';
import OrbCore3D, { type OrbState } from '../components/OrbCore3D';
import { useSettingsStore } from '../stores/useSettingsStore';
import ModelPicker from '../components/ModelPicker';
import './ghostNexus.css';

// Rich-mode pixel tower (CLAUDE Agent Tower) — code-split so the lightweight
// deck never pays for the canvas engine unless the setting is on.
const GhostOffice = lazy(() => import('../components/office/GhostOffice'));

// ── static lookups ─────────────────────────────────────────────────────────
type Status = 'working' | 'active' | 'idle' | 'warn';
const STLABEL: Record<Status, string> = { working: 'EXEC', active: 'LIVE', idle: 'IDLE', warn: 'WARN' };

// Squad identity hues. Brand coral is reserved for the orchestrator core (the
// page's focal point) and global accents; squads get clearly-separated hues so
// none of them collides with the warn/danger status colors (amber/red).
const SQUAD_TONE: Record<string, string> = {
  CORE: '#f64e6e', SEC: '#a78bfa', INTEL: '#22d3ee', INFRA: '#10b981', CONT: '#f59e0b', DEV: '#38bdf8',
};
const SQUAD_ROLE: Record<string, { role: string; domain: string }> = {
  CORE: { role: 'Orchestrator', domain: 'Coordination · Routing' },
  SEC: { role: 'Security', domain: 'Monitor · Guardrails' },
  INTEL: { role: 'Intelligence', domain: 'Research · Synthesis' },
  INFRA: { role: 'Infrastructure', domain: 'Scheduling · Pipelines' },
  CONT: { role: 'Content', domain: 'Drafting · Media' },
  DEV: { role: 'Engineering', domain: 'Code · Review · Deploy' },
};
const SQUAD_GLYPH: Record<string, string> = {
  CORE: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  SEC: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z',
  INTEL: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
  INFRA: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4',
  CONT: 'M4 20l4-1L18 9l-3-3L5 16zM14 6l3 3',
  DEV: 'M8 6l-5 6 5 6M16 6l5 6-5 6M13 4l-2 16',
};
const DEFAULT_GLYPH = 'M3 5h18M3 12h18M3 19h12';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const pad = (n: number) => String(n).padStart(2, '0');

export interface NexAgent {
  id: string; name: string; role: string; domain: string;
  status: Status; online: boolean; color: string; ring: 0 | 1;
  load: number; task: string; running: number; queue: number;
  squad: string; tags: string[]; glyph: string;
}

export interface FeedLine { id: string; ts: number; ag: string; kind: string; text: string; jarvis: boolean; fresh: boolean; stuck?: boolean; }

function deriveStatus(n: GhostNode): Status {
  const online = n.status === 'active' || n.status === 'online';
  if (!online) return 'idle';
  const q = n.queue_depth ?? 0, r = n.tasks_running ?? 0;
  if (q >= 8) return 'warn';
  if (r > 0) return 'working';
  return 'active';
}

// ── real-history sparkline — plots the sampled telemetry from useGhostStore
//    (one point per topology poll). No noise, no fake motion: if the line moves,
//    the fleet moved. ───────────────────────────────────────────────────────
function HistorySpark({ data, color, w, h, className }: { data: number[]; color: string; w: number; h: number; className: string }) {
  if (!data || data.length < 2) {
    // One poll in: show a flat baseline rather than an empty box.
    return (
      <svg className={className} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <line x1="0" y1={h - 1} x2={w} y2={h - 1} stroke={color} strokeWidth="1" opacity="0.4" />
      </svg>
    );
  }
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * (h - 2) - 1).toFixed(1)}`);
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polygon fill={color} opacity="0.12" points={`0,${h} ${pts.join(' ')} ${w},${h}`} />
      <polyline fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={pts.join(' ')} />
    </svg>
  );
}

// Status colors for the open-task list in the detail panel (status ≠ identity).
const TASK_STATUS_TONE: Record<string, string> = {
  running: '#f59e0b', ready: '#38bdf8', review: '#38bdf8',
  blocked: '#ef4444', failed: '#ef4444',
  todo: '#8a8a8a', triage: '#8a8a8a', scheduled: '#8a8a8a',
};
const OPEN_STATUSES = new Set(['running', 'review', 'ready', 'todo', 'triage', 'scheduled', 'blocked']);
const REROUTABLE = new Set(['todo', 'ready', 'triage', 'scheduled']);

const cssVars = (o: Record<string, string>) => o as React.CSSProperties;

export default function GhostNetwork() {
  const { nodes, fetchTopology, history, agentLoadHistory } = useGhostStore();
  const { activities, startPolling, stopPolling } = useActivityStore();
  const { mcTasks, reassignTask, fetchTasks } = useTaskStore();
  const focusTask = useTaskFocusStore((s) => s.focus);
  const navigate = useNavigate();
  const openDrilldown = useAgentDrilldownStore((s) => s.open);
  // Agent CRUD (create / edit / delete / spawn) — lives in the detail panel now
  // that the orbital roster + detail panel replace the old Registry table.
  const crud = useAgentCrud();
  // Shared chat/session store — the command bar drives the active Mc session
  // (persisted + resumable), so the conversation survives tab switches and is the
  // same session you see in Claude Chat.
  const {
    init: initChat, send: sendChat, sending, activeMessages,
    sessions: chatSessions, activeId: chatActiveId, isDraft: chatIsDraft,
    selectSession, newSession,
  } = useChatStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [paused, setPaused] = useState(false);
  const [zoomLabel, setZoomLabel] = useState('100%');
  // ORBIT = the hero mesh; GRID = the dense card view (scales past ~20 agents);
  // OFFICE = the rich pixel cutaway, only offered while the settings toggle is on.
  const richUI = useSettingsStore((s) => s.richNetworkUI);
  const [layout, setLayout] = useState<'orbital' | 'grid' | 'office'>(
    () => (useSettingsStore.getState().richNetworkUI ? 'office' : 'orbital'),
  );
  // Follow the settings toggle: turning rich UI on lands you in the office,
  // turning it off always falls back to the lightweight mesh.
  useEffect(() => { setLayout(richUI ? 'office' : 'orbital'); }, [richUI]);
  // Reroute-queue control in the detail panel (real kanban reassign verb).
  const [rerouteTo, setRerouteTo] = useState('');
  const [rerouting, setRerouting] = useState(false);
  const [rerouteMsg, setRerouteMsg] = useState<string | null>(null);
  // Voice Link — the core orb is the voice interface; turns ride the same
  // chat session as the command bar, so they land in the feed.
  const voice = useVoiceLink();
  // WebGL orb with CSS-layer fallback if context creation fails.
  const [glFailed, setGlFailed] = useState(false);

  useEffect(() => { initChat(); }, [initChat]);

  const stageBodyRef = useRef<HTMLDivElement>(null);
  const orbitSpaceRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef({ z: 1, px: 0, py: 0 });

  // live data lifecycle
  useEffect(() => { fetchTopology(); startPolling(); return () => stopPolling(); }, [fetchTopology, startPolling, stopPolling]);
  // Pause all the deck's CSS animations when the window is hidden/backgrounded —
  // saves continuous GPU compositing + CPU while the user isn't looking.
  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // map live agents → nexus agents
  const agents = useMemo<NexAgent[]>(() => {
    const live = nodes.filter((n) => n.type !== 'squad');
    const nonCore = live.filter((n) => n.type !== 'core').sort((a, b) => a.name.localeCompare(b.name));
    const innerCount = Math.min(6, Math.ceil(nonCore.length * 0.4));
    return nonCore.map((n, i) => {
      const squad = n.squad || 'DEV';
      const status = deriveStatus(n);
      const online = status !== 'idle';
      const r = n.tasks_running ?? 0, q = n.queue_depth ?? 0;
      const task = !online ? 'Offline — not on the wire'
        : r > 0 ? `${r} task${r > 1 ? 's' : ''} running${q ? ` · ${q} queued` : ''}`
        : q > 0 ? `${q} job${q > 1 ? 's' : ''} queued — standing by`
        : 'Idle — awaiting directive';
      const rl = SQUAD_ROLE[squad] || { role: 'Agent', domain: 'General' };
      return {
        id: n.id, name: n.name.toUpperCase(), role: rl.role, domain: rl.domain,
        status, online, color: SQUAD_TONE[squad] || '#f64e6e', ring: i < innerCount ? 0 : 1,
        load: agentLoad(n) / 100,
        task, running: r, queue: q, squad,
        tags: [squad.toLowerCase(), n.type, ...(r > 0 ? ['active'] : [])],
        glyph: SQUAD_GLYPH[squad] || DEFAULT_GLYPH,
      };
    });
  }, [nodes]);

  const coreNode = useMemo(() => nodes.find((n) => n.type === 'core'), [nodes]);
  const byId = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);
  const selected = selectedId ? byId[selectedId] : null;

  // The selected agent's real open tasks (live kanban data) — running first,
  // then by recency. This is what "Current Directive" now shows.
  const selectedTasks = useMemo(() => {
    if (!selected) return [];
    const name = selected.name.toLowerCase();
    return mcTasks
      .filter((t) => (t.assignee || '').toLowerCase() === name && OPEN_STATUSES.has(t.status))
      .sort((a, b) => (a.status === 'running' ? -1 : 0) - (b.status === 'running' ? -1 : 0) || b.created_at - a.created_at);
  }, [mcTasks, selected]);
  const runningTask = selectedTasks.find((t) => t.status === 'running');
  const reroutable = selectedTasks.filter((t) => REROUTABLE.has(t.status));

  // Jump to a task on the Operations kanban (same focus path ⌘F search uses).
  const jumpToTask = useCallback((id: string) => {
    focusTask(id);
    navigate('/operations');
  }, [focusTask, navigate]);

  // Reroute the agent's pending queue to another profile — the real kanban
  // `reassign` verb per task, not a natural-language request to the LLM.
  const handleReroute = async () => {
    if (!selected || !rerouteTo || rerouting || !reroutable.length) return;
    setRerouting(true);
    setRerouteMsg(null);
    let moved = 0, failed = 0;
    for (const t of reroutable) {
      const ok = await reassignTask(t.id, rerouteTo);
      if (ok) moved++; else failed++;
    }
    await fetchTasks();
    setRerouteMsg(`${moved} task${moved === 1 ? '' : 's'} → ${rerouteTo}${failed ? ` · ${failed} failed` : ''}`);
    setRerouting(false);
  };

  // live aggregates
  const total = agents.length;
  const onlineCount = agents.filter((a) => a.online).length;
  const busyCount = agents.filter((a) => a.running > 0).length;
  const running = agents.reduce((s, a) => s + a.running, 0);
  const queue = agents.reduce((s, a) => s + a.queue, 0);
  const onlinePct = total ? Math.round((onlineCount / total) * 100) : 0;

  // ── selection helpers ──
  // Select an agent (toggle off if it's already selected). Resetting the reroute
  // control here keeps a target/confirmation chosen for one agent from carrying
  // over to the next — rerouting is a real kanban reassign, so a stale target
  // could silently misroute the new agent's pending queue.
  const select = useCallback((id: string | null) => {
    setSelectedId((cur) => (cur === id ? null : id));
    setRerouteTo('');
    setRerouteMsg(null);
  }, []);

  // ── command directive → shared Mc chat session ──
  const runDirective = useCallback((textRaw: string) => {
    const text = textRaw.trim();
    if (!text || sending) return;
    void sendChat(text);
  }, [sending, sendChat]);

  const submit = () => { const v = input.trim(); if (!v) return; runDirective(v); setInput(''); };

  const chatMessages = activeMessages();

  // "On air" = visibly lit. Agents light up in their squad color only while
  // they're actually executing (or warning); everything else sits gray, so a
  // glance at the mesh shows exactly who is working. The core brightens while
  // it's thinking (directive in flight) or while the fleet is executing.
  const isLit = (a: NexAgent) => a.running > 0 || a.status === 'warn';
  const coreLit = sending || running > 0 || voice.active;

  // Voice-aware core status — the orb wears the conversation state.
  const VOICE_STATUS: Record<VoicePhase, string | null> = {
    off: null, listening: 'LISTENING', transcribing: 'TRANSCRIBING', thinking: 'THINKING', speaking: 'SPEAKING',
  };
  const coreStatus = VOICE_STATUS[voice.phase] || (sending ? 'THINKING' : coreLit ? 'ACTIVE' : 'STANDBY');
  const orbState: OrbState =
    voice.phase === 'listening' || voice.phase === 'transcribing' || voice.phase === 'speaking' ? voice.phase
    : sending || voice.phase === 'thinking' ? 'thinking'
    : coreLit ? 'active' : 'standby';

  // ── merged feed (live activity + the active chat conversation) ──
  const feed = useMemo<FeedLine[]>(() => {
    const norm = (t: number) => (t < 1e12 ? t * 1000 : t);
    const acts: FeedLine[] = activities.map((a) => {
      const s = (a.status || '').toLowerCase(), act = (a.action || '').toLowerCase();
      // Classify on the STRUCTURED status first (the /api/mc/activity vocabulary:
      // created / running / complete / blocked / failed) — the same field War Room's
      // STATUS_COLORS keys on, so the two surfaces colour the same event identically
      // by construction. The action-TEXT keywords are only a fallback for an
      // unknown/missing status: matching `action` first mis-coloured any row whose
      // TITLE contained a verb substring — e.g. a *completed* "…blocking queue…" task
      // hit `act.includes('block')` and rendered as a red error. (BUGHUNT GN-FEEDCOLOR)
      const kind =
          s.includes('fail') || s.includes('error') || s.includes('block') ? 'warn'
        : s.includes('complete') || s.includes('done') ? 'ok'
        : s.includes('run') || s.includes('claim') ? 'exec'
        : s.includes('creat') ? 'data'
        : act.includes('block') || act.includes('fail') || act.includes('error') ? 'warn'
        : act.includes('complete') || act.includes('done') ? 'ok'
        : act.includes('spawn') || act.includes('start') || act.includes('claim') ? 'exec'
        : act.includes('creat') || act.includes('updat') ? 'data'
        : 'info';
      // An operator-critical stuck row (blocked/failed) carries its OLD
      // blocked/started timestamp, so the newest-CAP slice below can evict it
      // behind a burst of recent chat/activity — silently re-dropping the very
      // rows the backend's cap-priority partition (iter #58) reserved budget to
      // keep, and hiding the "needs attention now" signal from the operator's
      // main Activity Stream. Flag them so the merge preserves them, mirroring
      // War Room's signalLog (iter #60). (BUGHUNT GN-FEEDCAP, iter #61)
      const stuck = s === 'blocked' || s === 'failed';
      return { id: a.id, ts: norm(a.timestamp), ag: (a.agent || 'SYS').toUpperCase().slice(0, 10), kind, text: a.action + (a.status ? ` · ${a.status}` : ''), jarvis: false, fresh: false, stuck };
    });
    const chat: FeedLine[] = chatMessages.map((m) => ({
      id: m.id,
      ts: Date.parse(m.timestamp) || 0,
      ag: m.role === 'user' ? 'OPERATOR' : m.role === 'assistant' ? 'ARCAN' : 'SYSTEM',
      kind: m.error ? 'warn' : 'jarvis',
      text: m.role === 'user' ? `“${m.content}”` : m.content,
      jarvis: m.role !== 'system',
      fresh: false,
    }));
    // Reserve the CAP budget for every stuck row first, then fill with the
    // most-recent others, and finally re-sort ascending for the scroll-to-bottom
    // feed. Sort newest-first for the partition so `slice(0, N)` keeps the newest
    // and never hits the `slice(-0)===whole-array` trap. (BUGHUNT GN-FEEDCAP)
    const CAP = 80;
    const merged = [...acts, ...chat].sort((x, y) => y.ts - x.ts);
    const critical = merged.filter((l) => l.stuck);
    const rest = merged.filter((l) => !l.stuck);
    return [...critical.slice(0, CAP), ...rest.slice(0, Math.max(0, CAP - critical.length))]
      .sort((x, y) => x.ts - y.ts);
  }, [activities, chatMessages]);

  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [feed.length, sending]);

  // ── zoom + pan (orbital) ──
  const applyZoom = useCallback((smooth: boolean) => {
    const s = orbitSpaceRef.current; if (!s) return;
    const { z, px, py } = zoomRef.current;
    s.style.transition = smooth ? 'transform .26s cubic-bezier(.2,.8,.2,1)' : 'none';
    s.style.transform = `translate(${px}px, ${py}px) scale(${z})`;
    setZoomLabel(Math.round(z * 100) + '%');
  }, []);
  const setZoom = useCallback((z: number, smooth: boolean) => { zoomRef.current.z = clamp(z, 0.45, 2.6); applyZoom(smooth); }, [applyZoom]);

  useEffect(() => {
    const stage = stageBodyRef.current; if (!stage) return;
    // Office view scrolls natively — no wheel-zoom / drag-pan hijacking.
    if (layout === 'office') return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = orbitSpaceRef.current; if (!s) return;
      const r = s.getBoundingClientRect();
      const cX = r.left + r.width / 2, cY = r.top + r.height / 2;
      const z = zoomRef.current;
      const nz = clamp(z.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.45, 2.6);
      const k = nz / z.z;
      z.px -= (e.clientX - cX) * (k - 1); z.py -= (e.clientY - cY) * (k - 1); z.z = nz;
      applyZoom(false);
    };
    let drag = false, sx = 0, sy = 0;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.agent-node') || t.closest('.zoomctl') || t.closest('.core')) return;
      drag = true; sx = e.clientX - zoomRef.current.px; sy = e.clientY - zoomRef.current.py;
      stage.classList.add('grabbing'); stage.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => { if (!drag) return; zoomRef.current.px = e.clientX - sx; zoomRef.current.py = e.clientY - sy; applyZoom(false); };
    const onUp = () => { drag = false; stage.classList.remove('grabbing'); };
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    return () => {
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
    };
  }, [applyZoom, layout]);

  // rings for orbital
  const rings = useMemo(() => {
    const inner = agents.filter((a) => a.ring === 0);
    const outer = agents.filter((a) => a.ring === 1);
    return [
      { cls: 'inner', rad: 0.34, off: -45, items: inner },
      { cls: 'outer', rad: 0.52, off: -90, items: outer },
    ];
  }, [agents]);

  // rail bars (real fleet %)
  const bars = [
    { k: 'ONLINE', v: onlinePct },
    { k: 'BUSY', v: total ? Math.round((busyCount / total) * 100) : 0 },
    { k: 'IDLE', v: total ? Math.round(((onlineCount - busyCount) / total) * 100) : 0 },
    { k: 'QUEUE', v: Math.min(98, Math.round((queue / Math.max(20, total * 3)) * 100)) },
  ];

  // vitals — values AND sparkline history are real sampled telemetry.
  const vitals = [
    { id: 'agents', label: 'Agents Online', unit: `/ ${total}`, value: String(onlineCount), data: history.online, up: true },
    { id: 'run', label: 'Running', unit: 'jobs', value: String(running), data: history.running, up: false },
    { id: 'queue', label: 'Queue Depth', unit: 'jobs', value: String(queue), data: history.queue, up: false },
    { id: 'online', label: 'Fleet Online', unit: '%', value: String(onlinePct), data: history.online.map((v) => (total ? Math.round((v / total) * 100) : 0)), up: true },
  ];

  const ghostError = useGhostStore((s) => s.error);

  return (
    <div className={`nexus${paused ? ' paused' : ''}`} data-layout={layout}>
      <div className="fx fx-grid" />
      <div className="fx fx-scan" />

      <div className="main">
        {/* LEFT RAIL — roster */}
        <aside className="col rail">
          <div className="col-head"><span>Agents</span><span className="n">// {total}</span></div>
          <div className="col-body">
            <ul className="roster">
              {agents.map((a) => (
                <li key={a.id} className={`ragent${isLit(a) ? '' : ' dim'}${selectedId === a.id ? ' sel' : ''}`} style={cssVars({ '--c': a.color })}
                  role="button" tabIndex={0} aria-label={`Select agent ${a.name}`}
                  onClick={() => select(a.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(a.id); } }}>
                  <div className="ico"><svg viewBox="0 0 24 24"><path d={a.glyph} /></svg></div>
                  <div className="meta">
                    <div className="nm">{a.name}</div>
                    <div className="rl">{a.role.toUpperCase()} · {a.domain}</div>
                  </div>
                  <div className="stat">
                    <div className="s-badge">{STLABEL[a.status]}</div>
                    <div className="load">{Math.round(a.load * 100)}%</div>
                  </div>
                </li>
              ))}
              {total === 0 && <li className="rl" style={{ padding: 12, fontFamily: 'var(--font-mono)', color: 'var(--txt-dim)' }}>No agents on the wire.</li>}
            </ul>
          </div>
          <div className="rail-foot">
            <div className="mini-label">Cluster Load</div>
            <div className="bars">
              {bars.map((b) => (
                <div className="bar" key={b.k}>
                  <span>{b.k}</span>
                  <div className="track"><div className="fill" style={{ width: `${b.v}%` }} /></div>
                  <span className="v">{b.v}%</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* CENTER STAGE */}
        <section className="col stage">
          <div className="stage-head">
            <div className="stage-title"><b>{layout === 'office' ? 'AGENT TOWER' : 'AGENT MESH'}</b><span>// {coreNode ? coreNode.name : 'arcan'} core · {total} nodes</span></div>
            <div className="stage-stats">
              <div className="chip"><span className="dot" /><span className="k">AGENTS</span><b>{onlineCount}/{total}</b></div>
              <div className="chip"><span className="dot cyan" /><span className="k">RUNNING</span><b>{running}</b></div>
              <div className="chip"><span className={`dot ${queue ? 'amber' : ''}`} /><span className="k">QUEUE</span><b>{queue}</b></div>
              <ModelPicker />
            </div>
            <div className="view-toggle">
              <button className={layout === 'orbital' ? 'on' : ''} onClick={() => setLayout('orbital')} title="Orbital mesh view">Orbit</button>
              <button className={layout === 'grid' ? 'on' : ''} onClick={() => setLayout('grid')} title="Dense card grid view">Grid</button>
              {richUI && <button className={layout === 'office' ? 'on' : ''} onClick={() => setLayout('office')} title="Pixel office view (rich UI)">Office</button>}
              <button onClick={() => crud.openCreate()} title="Create a new agent">+ Agent</button>
            </div>
          </div>

          <div className="stage-body" ref={stageBodyRef}>
            {/* OFFICE VIEW — rich pixel cutaway; mounted only in office layout so
                the lazy chunk is fetched on first use and idle otherwise. */}
            {layout === 'office' && (
              <Suspense fallback={<div className="office-fallback">BOOTING OFFICE FLOOR…</div>}>
                <GhostOffice
                  agents={agents}
                  selectedId={selectedId}
                  onSelect={select}
                  coreName={coreNode ? coreNode.name.toUpperCase() : 'ARCAN'}
                  coreStatus={coreStatus}
                  coreLit={coreLit}
                  feed={feed}
                  running={running}
                  queue={queue}
                  onlineCount={onlineCount}
                  total={total}
                />
              </Suspense>
            )}
            <div className="orbital">
              <div className="orbit-space" ref={orbitSpaceRef}>
                {rings.map((r) => (
                  <div className={`ring ${r.cls}`} key={r.cls}>
                    {r.items.map((a, i) => {
                      const ang = (360 / Math.max(r.items.length, 1)) * i + r.off;
                      // Packets only ride spokes of agents that are actually
                      // executing; spokes of powered-down agents fade to gray.
                      return (
                        <div className={`spoke${a.running > 0 ? ' live' : ' dimmed'}`} key={`sp-${a.id}`} style={cssVars({ '--a': `${ang}deg`, '--c': a.color, '--pdur': a.running > 1 ? '2.1s' : '3.2s' }) as React.CSSProperties} />
                      );
                    })}
                    {r.items.map((a, i) => {
                      const ang = (360 / Math.max(r.items.length, 1)) * i + r.off;
                      return (
                        <div className="node" key={a.id} style={{ ...cssVars({ '--a': `${ang}deg` }), transform: `rotate(${ang}deg) translateX(calc(var(--orbit) * ${r.rad}))` }}>
                          <div className="spin"><div className="upr">
                            <div className={`agent-node st-${a.status}${isLit(a) ? ' on-air' : ' dim'}${selectedId === a.id ? ' sel' : ''}`} style={cssVars({ '--c': a.color })} onClick={(e) => { e.stopPropagation(); select(a.id); }}>
                              <div className="orb"><svg viewBox="0 0 24 24"><path d={a.glyph} /></svg></div>
                              <div className="lab"><b className="glitch" data-t={a.name}>{a.name}</b><span>{a.role.toUpperCase()}</span></div>
                            </div>
                          </div></div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div
                  className={`core${coreLit ? '' : ' standby'}${sending || voice.phase === 'thinking' ? ' thinking' : ''}${voice.active ? ` voice-${voice.phase}` : ''}`}
                  style={cssVars({ '--vlvl': voice.level.toFixed(3) })}
                  role="button"
                  title={voice.phase === 'off' ? 'Tap to open a voice link with the orchestrator'
                    : voice.phase === 'listening' ? 'Listening — pause to send, tap to send now'
                    : voice.phase === 'speaking' ? 'Speaking — tap to interrupt' : 'Working…'}
                  onClick={(e) => { e.stopPropagation(); voice.tapOrb(); }}
                >
                  {!glFailed ? (
                    <>
                      {/* WebGL heart + the CSS dial/sweep HUD chrome on top */}
                      <OrbCore3D state={orbState} level={voice.level} paused={paused} onFallback={() => setGlFailed(true)} />
                      <div className="layer orb-dial" /><div className="layer orb-sweep" />
                    </>
                  ) : (
                    <>
                      {/* CSS fallback orb (no WebGL on this machine) */}
                      <div className="layer orb-halo" /><div className="layer orb-dial" /><div className="layer orb-ring-o" />
                      <div className="layer orb-ring-r" /><div className="layer orb-ring-i" /><div className="layer orb-sweep" />
                      <div className="layer orb-gyro" /><div className="layer orb-gyro2" />
                      <div className="layer orb-motes">
                        {[
                          { mx: '5%', ms: '3px', dur: '8s', del: '0s', dir: 'normal' },
                          { mx: '10%', ms: '2px', dur: '13s', del: '-4s', dir: 'reverse' },
                          { mx: '2.5%', ms: '2px', dur: '19s', del: '-9s', dir: 'normal' },
                          { mx: '7.5%', ms: '3px', dur: '11s', del: '-2s', dir: 'reverse' },
                          { mx: '13%', ms: '2px', dur: '23s', del: '-12s', dir: 'normal' },
                        ].map((m, i) => (
                          <i key={i} style={{ ...cssVars({ '--mx': m.mx, '--ms': m.ms }), animationDuration: m.dur, animationDelay: m.del, animationDirection: m.dir as 'normal' | 'reverse' }} />
                        ))}
                      </div>
                      <div className="layer orb-sphere" />
                      <div className="layer orb-hot"><span className="flare-h" /><span className="flare-v" /></div>
                    </>
                  )}
                  <div className="core-stat cs-top">{running} RUNNING</div>
                  <div className="core-stat cs-bl">{queue} QUEUED</div>
                  <div className="core-stat cs-br">{onlineCount}/{total} ACTIVE</div>
                  <div className="core-label">
                    <b>{coreNode ? coreNode.name.toUpperCase() : 'ARCAN'}</b>
                    <span>ORCHESTRATOR · {coreStatus}</span>
                    {voice.active && <i className="vhint">{voice.engine === 'elevenlabs' ? 'ELEVENLABS' : 'BROWSER VOICE'} · ESC ENDS</i>}
                    {voice.error && <i className="verr">▸ {voice.error}</i>}
                  </div>
                </div>
              </div>
            </div>

            {/* GRID VIEW — dense card layout; scales past what the orbit can hold.
                Sparklines are the agent's real sampled load history. */}
            <div className="gridview">
              <div className="cards">
                {agents.map((a) => (
                  <div key={a.id} className={`acard${isLit(a) ? '' : ' dim'}${selectedId === a.id ? ' sel' : ''}`} style={cssVars({ '--c': a.color })} onClick={() => select(a.id)}>
                    <div className="ch">
                      <div className="ci"><svg viewBox="0 0 24 24"><path d={a.glyph} /></svg></div>
                      <div className="cn"><b>{a.name}</b><span>{a.role.toUpperCase()} · {a.squad}</span></div>
                      <span className="s-badge" style={{ marginLeft: 'auto' }}>{STLABEL[a.status]}</span>
                    </div>
                    <HistorySpark data={agentLoadHistory[a.id] ?? []} color={a.color} w={220} h={30} className="spark" />
                    <div className="ctask">{a.task}</div>
                    <div className="cfoot">
                      <span className="lo">{Math.round(a.load * 100)}% load</span>
                      <span>{a.running} run · {a.queue} queued</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="zoomctl">
              <button title="Zoom in" onClick={() => setZoom(zoomRef.current.z * 1.2, true)}>+</button>
              <button title="Zoom out" onClick={() => setZoom(zoomRef.current.z / 1.2, true)}>−</button>
              <button className="zreset" title="Reset view" onClick={() => { zoomRef.current = { z: 1, px: 0, py: 0 }; applyZoom(true); }}>◎</button>
              <div className="zlvl">{zoomLabel}</div>
            </div>

            <div className="stage-foot">
              <span>MESH&nbsp;<b>{ghostError ? 'DEGRADED' : 'STABLE'}</b></span>
              <span>AGENTS&nbsp;<b>{onlineCount}/{total}</b></span>
              <span>RUNNING&nbsp;<b>{running}</b></span>
              <span>QUEUE&nbsp;<b>{queue}</b></span>
            </div>
          </div>
        </section>

        {/* RIGHT PANEL */}
        <aside className="col panel">
          <div className="panel-detail">
            <div className="col-head"><span>{selected ? 'Agent Detail' : 'System Telemetry'}</span><span className="n">// {selected ? 'live' : 'realtime'}</span></div>
            {!selected && (
              <div className="vitals">
                {vitals.map((v) => (
                  <div className={`vital${v.up ? ' up' : ''}`} key={v.id}>
                    <div className="vl">{v.label}</div>
                    <div className="vv">{v.value}<small>{v.unit}</small></div>
                    <HistorySpark data={v.data} color={v.up ? '#10b981' : '#f64e6e'} w={60} h={22} className="vspark" />
                  </div>
                ))}
              </div>
            )}
            {selected && (
              <div className="detail" style={cssVars({ '--c': selected.color })}>
                <div className="dh">
                  <div className="di" style={cssVars({ '--c': selected.color })}><svg viewBox="0 0 24 24"><path d={selected.glyph} /></svg></div>
                  <div className="dt"><b>{selected.name}</b><span>{selected.role.toUpperCase()} · {selected.squad}</span></div>
                  <button className="dclose" onClick={() => openDrilldown(selected.name)} title="Open full agent drill-down">▦ INSPECT</button>
                  <button className="dclose" onClick={() => select(null)}>▢ CLOSE</button>
                </div>
                <div className="dtask">
                  <div className="tl">Current Directive · {STLABEL[selected.status]}</div>
                  <div className="tx">{runningTask ? runningTask.title : selected.task}</div>
                  <div className="prog"><i style={{ width: `${Math.round(selected.load * 100)}%` }} /></div>
                </div>
                {/* The agent's real open tasks (live kanban) — click to jump to
                    the board with the task highlighted. */}
                {selectedTasks.length > 0 && (
                  <div className="dtask-list">
                    {selectedTasks.slice(0, 4).map((t) => (
                      <button key={t.id} className="dtask-row" title={`${t.title} — open on the board`} onClick={() => jumpToTask(t.id)}>
                        <span className="tk" style={{ color: TASK_STATUS_TONE[t.status] || 'var(--txt-dim)' }}>{t.status.toUpperCase()}</span>
                        <span className="tt">{t.title}</span>
                      </button>
                    ))}
                    {selectedTasks.length > 4 && (
                      <div className="dtask-more">+ {selectedTasks.length - 4} more — INSPECT for the full dossier</div>
                    )}
                  </div>
                )}
                <div className="dstats">
                  <div className="dstat"><div className="l">Load</div><div className="v" style={{ color: selected.color }}>{Math.round(selected.load * 100)}%</div></div>
                  <div className="dstat"><div className="l">Queue</div><div className="v">{selected.queue}</div></div>
                  <div className="dstat"><div className="l">Running</div><div className="v">{selected.running}</div></div>
                </div>
                <div className="dtags">{selected.tags.map((t) => <span className="dtag" key={t}>#{t}</span>)}</div>
                {/* Reroute queue — the real kanban reassign verb, per pending task.
                    (The old Pause/Reassign buttons were natural-language requests
                    to the LLM dressed up as switches.) */}
                <div className="dctrl reroute" style={cssVars({ '--accent': selected.color })}>
                  <button className="dbtn" disabled={sending} title="Ask the orchestrator for a status report (goes to the feed)" onClick={() => runDirective(`Give me a status report on ${selected.name}`)}>Status</button>
                  <select className="dsel" value={rerouteTo} onChange={(e) => setRerouteTo(e.target.value)} title="Reroute this agent's pending queue to…">
                    <option value="">reroute to…</option>
                    {agents.filter((x) => x.id !== selected.id).map((x) => (
                      <option key={x.id} value={x.id}>{x.id}</option>
                    ))}
                  </select>
                  <button
                    className="dbtn warn"
                    disabled={rerouting || !rerouteTo || !reroutable.length}
                    title={reroutable.length ? `Reassign ${reroutable.length} pending task(s) via the kanban` : 'No pending tasks to reroute'}
                    onClick={() => void handleReroute()}
                  >
                    {rerouting ? 'MOVING…' : `Reroute ${reroutable.length || ''}`}
                  </button>
                </div>
                {rerouteMsg && <div className="dnote">▸ {rerouteMsg}</div>}
                {/* Agent management — the CRUD that used to live in the Registry tab. */}
                <div className="dctrl" style={cssVars({ '--accent': selected.color })}>
                  <button className="dbtn" onClick={() => { const n = nodes.find((x) => x.id === selected.id); if (n) crud.openSpawn(n); }}>Spawn</button>
                  <button className="dbtn" onClick={() => { const n = nodes.find((x) => x.id === selected.id); if (n) crud.openEdit(n); }}>Edit</button>
                  <button className="dbtn danger" onClick={() => { const n = nodes.find((x) => x.id === selected.id); if (n) crud.openDelete(n); }}>Delete</button>
                </div>
              </div>
            )}
          </div>

          <div className="feed-wrap">
            <div className="feed-head"><span>Activity Stream</span><span className="live"><span className="dot red" />LIVE</span></div>
            <div className="feed" ref={feedRef}>
              {feed.length === 0 && <div className="fline"><span className="tx" style={{ color: 'var(--txt-dim)' }}>Awaiting activity from the bridge…</span></div>}
              {feed.map((l) => (
                <div className={`fline${l.fresh ? ' fresh' : ''}${l.jarvis ? ' jarvis' : ''}`} key={l.id}>
                  <span className="ts">{(() => { const d = new Date(l.ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; })()}</span>
                  <span className="ag">{l.ag}</span>
                  <span className={`kk ${l.jarvis ? 'jarvis' : l.kind}`}>{l.jarvis ? 'CORE' : l.kind.toUpperCase()}</span>
                  <span className="tx">{l.text}</span>
                </div>
              ))}
              {sending && (
                <div className="fline jarvis nx-thinking">
                  <span className="ts">··:··:··</span>
                  <span className="ag">ARCAN</span>
                  <span className="kk jarvis">CORE</span>
                  <span className="tx">orchestrator is thinking<span className="nx-ellipsis" /></span>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* COMMAND BAR — real directives to the orchestrator */}
      <footer className="commandbar">
        {/* Session control — the active session is shared with Claude Chat and
            persists across tabs. Switch, start fresh, or pop out to the full
            workspace for history + projects. */}
        <div className="flex items-center gap-1 mr-1 shrink-0">
          <select
            value={chatIsDraft ? '' : (chatActiveId || '')}
            onChange={(e) => { const v = e.target.value; if (v) void selectSession(v); }}
            title="Active session"
            className="max-w-[150px] bg-[#0b0b0b] border border-white/15 text-[10px] font-mono text-[#b8b8b8] px-1.5 py-1 outline-none focus:border-[#f64e6e]"
          >
            {chatIsDraft && <option value="">◆ New Session</option>}
            {chatSessions.slice(0, 30).map((s) => (
              <option key={s.id} value={s.id}>{(s.title || s.preview || s.id).slice(0, 40)}</option>
            ))}
          </select>
          <button
            onClick={() => newSession()}
            title="New session"
            className="h-[26px] w-[26px] shrink-0 flex items-center justify-center border border-white/15 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e] text-[13px]"
          >+</button>
          <Link
            to="/chat"
            title="Open in Claude Chat — full history, rename & projects"
            className="h-[26px] w-[26px] shrink-0 flex items-center justify-center border border-white/15 text-[#b8b8b8] hover:border-sky-400 hover:text-sky-400 text-[11px]"
          >⤢</Link>
          <button
            onClick={() => (voice.active ? voice.end() : voice.start())}
            title={voice.active ? 'End the voice link (Esc)' : 'Voice Link — or just tap the core orb'}
            className={`h-[26px] px-2 shrink-0 flex items-center justify-center gap-1 border text-[10px] font-mono ${
              voice.active
                ? 'border-[#f64e6e] text-[#f64e6e] bg-[#f64e6e]/10 animate-pulse'
                : 'border-white/15 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e]'
            }`}
          >◉ {voice.active ? 'LIVE' : 'VOICE'}</button>
        </div>
        <div className="cmd-pre"><span className="pr">ARCAN</span><span>▷</span></div>
        <input
          className="cmd-input" type="text" autoComplete="off" spellCheck={false}
          value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder={sending ? 'Orchestrator is thinking…' : 'Issue a directive to the orchestrator —  e.g.  “give me a status report”'}
          disabled={sending}
        />
        <div className="chips">
          <button className="qchip" onClick={() => setInput('Give me a status report')}>status report</button>
          <button className="qchip" onClick={() => setInput('List all active agents and what they are working on')}>list agents</button>
          <button className="qchip" onClick={() => setInput('What tasks are queued right now?')}>queue</button>
        </div>
        <button className="cmd-send" onClick={submit} disabled={sending || !input.trim()}>{sending ? '···' : 'Execute'}</button>
      </footer>

      {/* Agent CRUD modals (create / edit / delete / spawn) */}
      {crud.modals}
    </div>
  );
}
