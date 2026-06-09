// Ghost Network — pixel-art ops room with walking agents, ambient life, director
// presence, hover/declutter and glitch drama on agent state changes.
//
// Faithful port of the design's ghost_network.jsx, wired to LIVE Hermes agents:
// the curated room/sprite layout is the visual; real agents from the Hermes
// bridge are bound onto the slots so online/busy/names reflect reality.
/* eslint-disable react-hooks/refs -- this is an imperative requestAnimationFrame
   animation: walker positions are intentionally read from a ref during render and
   repainted via a per-frame setState tick. React Compiler is not enabled, so this
   is safe; rewriting positions into state would regress animation performance. */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useGhostStore, type GhostNode } from '../stores/useGhostStore';
import { hRand } from '../components/cyberpunk/util';

const asset = (p: string) => import.meta.env.BASE_URL + p;

interface Slot {
  id: string;
  codename: string;
  squad: string;
  role: string;
  sprite: string;
  x: number;
  y: number;
  h: number;
}

// Director + fixers + runners with their curated sprite + home position.
const SLOTS: Slot[] = [
  { id: 'dir-01', codename: 'KATE', squad: 'CORE', role: 'Director', sprite: 'assets/sprites/s1_08.png', x: 72.0, y: 81.5, h: 13.8 },
  { id: 'fx-01', codename: 'BLACKWATCH', squad: 'SEC', role: 'Sentinel', sprite: 'assets/sprites/s1_03.png', x: 80.0, y: 83.0, h: 12.4 },
  { id: 'fx-02', codename: 'MNEMOSYNE', squad: 'INTEL', role: 'Archivist', sprite: 'assets/sprites/s2_10.png', x: 67.5, y: 74.5, h: 11.2 },
  { id: 'fx-03', codename: 'SWITCHBOARD', squad: 'INFRA', role: 'Relay', sprite: 'assets/sprites/s1_02.png', x: 47.0, y: 80.0, h: 12.2 },
  { id: 'fx-04', codename: 'OVERWATCH', squad: 'SEC', role: 'Warden', sprite: 'assets/sprites/s1_10.png', x: 19.5, y: 81.0, h: 12.2 },
  { id: 'fx-05', codename: 'CLOCKWORK', squad: 'INFRA', role: 'Scheduler', sprite: 'assets/sprites/s3_01.png', x: 52.5, y: 85.0, h: 12.4 },
  { id: 'fx-06', codename: 'THE WEAVER', squad: 'CONT', role: 'Composer', sprite: 'assets/sprites/s2_00.png', x: 32.0, y: 75.5, h: 11.2 },
  { id: 'fx-07', codename: 'MORNINGSTAR', squad: 'INTEL', role: 'Herald', sprite: 'assets/sprites/s1_07.png', x: 10.0, y: 73.0, h: 11.0 },
  { id: 'fx-08', codename: 'ARGUS', squad: 'SEC', role: 'Monitor', sprite: 'assets/sprites/s2_05.png', x: 85.0, y: 73.5, h: 11.2 },
  { id: 'rn-01', codename: 'SILICON-SAMURAI', squad: 'DEV', role: 'Edge', sprite: 'assets/sprites/s1_01.png', x: 76.0, y: 88.5, h: 13.2 },
  { id: 'rn-02', codename: 'WORD-SMITH', squad: 'CONT', role: 'Copy', sprite: 'assets/sprites/s4_00.png', x: 37.0, y: 82.5, h: 12.2 },
  { id: 'rn-03', codename: 'THE HOOK', squad: 'CONT', role: 'Scripter', sprite: 'assets/sprites/s4_08.png', x: 31.0, y: 89.0, h: 13.2 },
  { id: 'rn-04', codename: 'VJ-RIPPER', squad: 'CONT', role: 'Video', sprite: 'assets/sprites/s1_06.png', x: 6.5, y: 82.0, h: 12.2 },
  { id: 'rn-05', codename: 'CHROME-RUNNER', squad: 'INTEL', role: 'Scraper', sprite: 'assets/sprites/s1_04.png', x: 44.5, y: 90.0, h: 13.2 },
  { id: 'rn-06', codename: 'THE PROPHET', squad: 'INTEL', role: 'Trend', sprite: 'assets/sprites/s4_01.png', x: 61.5, y: 71.0, h: 11.5 },
  { id: 'rn-07', codename: 'THE RED PEN', squad: 'CONT', role: 'Editor', sprite: 'assets/sprites/s4_02.png', x: 39.5, y: 73.0, h: 11.0 },
  { id: 'rn-08', codename: 'THE ARCHITECT', squad: 'DEV', role: 'Planner', sprite: 'assets/sprites/s2_02.png', x: 83.0, y: 91.0, h: 13.2 },
  { id: 'rn-09', codename: 'DROPKICK', squad: 'CONT', role: 'Publisher', sprite: 'assets/sprites/s2_08.png', x: 37.5, y: 92.0, h: 13.2 },
  { id: 'rn-10', codename: 'SCOUT', squad: 'INTEL', role: 'Crawler', sprite: 'assets/sprites/s3_07.png', x: 50.5, y: 93.0, h: 13.2 },
  { id: 'rn-11', codename: 'HUNTER', squad: 'INTEL', role: 'Match', sprite: 'assets/sprites/s4_07.png', x: 58.5, y: 90.0, h: 13.2 },
  { id: 'rn-12', codename: 'PHANTOM', squad: 'SEC', role: 'Stealth', sprite: 'assets/sprites/s1_11.png', x: 13.5, y: 88.5, h: 13.2 },
  { id: 'rn-13', codename: 'NIGHTINGALE', squad: 'INTEL', role: 'Summary', sprite: 'assets/sprites/s1_09.png', x: 24.0, y: 91.0, h: 13.2 },
  { id: 'rn-14', codename: 'TALLY', squad: 'INFRA', role: 'Finance', sprite: 'assets/sprites/s4_06.png', x: 57.5, y: 81.0, h: 12.2 },
  { id: 'rn-15', codename: 'SIGNAL', squad: 'CONT', role: 'Social', sprite: 'assets/sprites/s4_09.png', x: 65.5, y: 92.0, h: 13.2 },
  { id: 'rn-16', codename: 'GHOSTWRITER', squad: 'CONT', role: 'Longform', sprite: 'assets/sprites/s3_02.png', x: 16.5, y: 75.5, h: 11.0 },
  { id: 'rn-17', codename: 'KILOVOLT', squad: 'DEV', role: 'Burst', sprite: 'assets/sprites/s3_11.png', x: 88.0, y: 82.0, h: 12.4 },
];

const SQUAD_META: Record<string, { color: string; label: string }> = {
  CORE: { color: '#f64e6e', label: 'CORE' },
  SEC: { color: '#ef4444', label: 'SECURITY' },
  INTEL: { color: '#a855f7', label: 'INTEL' },
  INFRA: { color: '#10b981', label: 'INFRA' },
  CONT: { color: '#f59e0b', label: 'CONTENT' },
  DEV: { color: '#38bdf8', label: 'DEV' },
};

const ASPECTS: Record<string, number> = {
  s1_08: 0.683, s1_03: 0.612, s2_10: 0.593, s1_02: 0.734, s1_10: 0.599, s3_01: 0.715,
  s2_00: 0.550, s1_07: 0.728, s2_05: 0.502, s1_01: 0.692, s4_00: 0.577, s4_08: 0.718,
  s1_06: 0.622, s1_04: 0.667, s4_01: 0.596, s4_02: 0.718, s2_02: 0.728, s2_08: 0.724,
  s3_07: 0.683, s4_07: 0.715, s1_11: 0.596, s1_09: 0.689, s4_06: 0.712, s4_09: 0.724,
  s3_02: 0.696, s3_11: 0.616,
};

const spriteKey = (p: string) => p.replace('assets/sprites/', '').replace('.png', '');
const isDir = (id: string) => id === 'dir-01';

// Occlusion zones — clip an agent's lower body when standing behind furniture.
const OCCLUDERS = [
  { id: 'coffeeTable', x0: 5, x1: 22, topY: 64, baseY: 74 },
  { id: 'deskRow', x0: 56, x1: 91, topY: 75, baseY: 86 },
  { id: 'tableBC', x0: 25, x1: 43, topY: 85, baseY: 99 },
  { id: 'binC', x0: 48, x1: 60, topY: 84, baseY: 97 },
  { id: 'crateBL', x0: 8, x1: 26, topY: 87, baseY: 99 },
];

type MotionMode = 'low' | 'med' | 'high';
const MOTION: Record<MotionMode, { speed: number; range: number; idle: [number, number]; roam: number }> = {
  low: { speed: 0, range: 0, idle: [9, 9], roam: 0 },
  med: { speed: 3.8, range: 8, idle: [1.4, 3.2], roam: 0.03 },
  high: { speed: 6.2, range: 12, idle: [0.5, 1.6], roam: 0.06 },
};

interface Walker {
  x: number; y: number; hx: number; hy: number; tx: number; ty: number;
  facing: number; moving: boolean; idleUntil: number; bobT: number;
}

const isOnline = (n?: GhostNode) => !!n && (n.status === 'active' || n.status === 'online');

export default function GhostNetwork() {
  const { nodes, fetchTopology } = useGhostStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 900, h: 500 });
  const [, setFrame] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ id: string; left: number; top: number } | null>(null);
  const [motion, setMotion] = useState<MotionMode>('high');
  const [showTopology, setShowTopology] = useState(false);
  const [fx, setFx] = useState<Record<string, 'in' | 'out' | null>>({});

  const motionCfg = MOTION[motion];

  // ── Bind live Hermes agents onto the curated slots ──
  const binding = useMemo(() => {
    const live = nodes.filter((n) => n.type !== 'squad');
    const core = live.find((n) => n.type === 'core');
    const nonCore = live.filter((n) => n.id !== core?.id).sort((a, b) => a.name.localeCompare(b.name));
    const map: Record<string, GhostNode | undefined> = {};
    map['dir-01'] = core;
    const rest = SLOTS.filter((s) => !isDir(s.id));
    rest.forEach((s, i) => { map[s.id] = nonCore[i]; });
    return map;
  }, [nodes]);

  // Derived per-slot live view.
  const view = useMemo(() => {
    return SLOTS.map((s) => {
      const agent = binding[s.id];
      const dir = isDir(s.id);
      const online = agent ? isOnline(agent) : dir; // director shown present even without a core agent
      const busy = !!agent && (agent.tasks_running ?? 0) > 0;
      const name = agent ? agent.name.toUpperCase() : s.codename;
      const squad = agent?.squad || s.squad;
      const task = !online ? 'dormant' : busy ? `${agent?.tasks_running ?? 0} RUNNING` : 'online';
      return { slot: s, agent, dir, online, busy, name, squad, task, bound: !!agent, queue: agent?.queue_depth ?? 0 };
    });
  }, [binding]);

  const viewById = useMemo(() => Object.fromEntries(view.map((v) => [v.slot.id, v])), [view]);

  // ── resize ──
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      const r = containerRef.current!.getBoundingClientRect();
      setDims({ w: r.width, h: r.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Topology is kept fresh globally by Layout's poller; just ensure an initial load.
  useEffect(() => {
    fetchTopology();
  }, [fetchTopology]);

  const { error, isLoading } = useGhostStore();

  const toX = (p: number) => (p / 100) * dims.w;
  const toY = (p: number) => (p / 100) * dims.h;
  const toH = (p: number) => (p / 100) * dims.h;

  // ── walkers (positions in %) ──
  const walkersRef = useRef<Record<string, Walker> | null>(null);
  if (!walkersRef.current) {
    const w: Record<string, Walker> = {};
    SLOTS.forEach((a) => {
      w[a.id] = {
        x: a.x, y: a.y, hx: a.x, hy: a.y, tx: a.x, ty: a.y,
        facing: hRand(a.id) > 0.5 ? 1 : -1, moving: false, idleUntil: 0, bobT: hRand(a.id, 3) * 10,
      };
    });
    walkersRef.current = w;
  }

  // ── glitch drama tied to real online transitions ──
  const prevOnlineRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const prev = prevOnlineRef.current;
    const next: Record<string, boolean> = {};
    const fxUpdates: Record<string, 'in' | 'out'> = {};
    view.forEach((v) => {
      next[v.slot.id] = v.online;
      if (v.slot.id in prev && prev[v.slot.id] !== v.online) {
        fxUpdates[v.slot.id] = v.online ? 'in' : 'out';
        if (v.online) {
          const wk = walkersRef.current![v.slot.id];
          wk.x = v.slot.x; wk.y = v.slot.y; wk.tx = v.slot.x; wk.ty = v.slot.y; wk.idleUntil = 0;
        }
      }
    });
    prevOnlineRef.current = next;
    if (Object.keys(fxUpdates).length) {
      setFx((p) => ({ ...p, ...fxUpdates }));
      const ids = Object.keys(fxUpdates);
      setTimeout(() => setFx((p) => { const n = { ...p }; ids.forEach((i) => (n[i] = null)); return n; }), 760);
    }
  }, [view]);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const pickTarget = useCallback((id: string) => {
    const w = walkersRef.current![id];
    if (isDir(id)) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 5;
      return { x: clamp(w.hx + Math.cos(a) * r, 66, 84), y: clamp(w.hy + Math.sin(a) * r * 0.5, 78, 88) };
    }
    const roam = Math.random() < motionCfg.roam;
    const rng = roam ? motionCfg.range * 2.2 : motionCfg.range;
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * rng;
    return {
      x: clamp(w.hx + Math.cos(ang) * rad, 4, 92),
      y: clamp(w.hy + Math.sin(ang) * rad * 0.45, 70, 94),
    };
  }, [motionCfg]);

  // ── animation loop ──
  useEffect(() => {
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const walkers = walkersRef.current!;
      SLOTS.forEach((a) => {
        const w = walkers[a.id];
        const live = viewById[a.id]?.online;
        if (motionCfg.speed === 0 || !live) { w.moving = false; return; }
        if (now / 1000 < w.idleUntil) { w.moving = false; return; }
        const dx = w.tx - w.x, dy = w.ty - w.y;
        const d = Math.hypot(dx, dy * 1.6);
        if (d < 0.5) {
          if (w.moving || w.idleUntil === 0) {
            w.moving = false;
            const [lo, hi] = motionCfg.idle;
            w.idleUntil = now / 1000 + lo + Math.random() * (hi - lo);
            const t = pickTarget(a.id);
            w.tx = t.x; w.ty = t.y;
          }
          return;
        }
        const step = motionCfg.speed * dt;
        w.x += (dx / d) * step;
        w.y += (dy / d) * step * 1.6;
        if (Math.abs(dx) > 0.05) w.facing = dx < 0 ? -1 : 1;
        w.moving = true;
        w.bobT += dt * 12;
      });
      setFrame((f) => (f + 1) % 1000000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [motionCfg, pickTarget, viewById]);

  // ── derived render data ──
  const kateSlot = SLOTS[0];
  const kw = walkersRef.current['dir-01'];
  const kateX = toX(kw.x), kateY = toY(kw.y) - toH(kateSlot.h) * 0.55;

  const busyAgents = view.filter((v) => v.busy && v.online && !v.dir);
  const zOrder = [...SLOTS].sort((a, b) => walkersRef.current![a.id].y - walkersRef.current![b.id].y);
  const showName = (id: string) => isDir(id) || hoveredId === id || selectedId === id;
  const onlineCount = view.filter((v) => v.online).length;

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden"
      style={{ backgroundImage: `url(${asset('assets/room.jpg')})`, backgroundSize: '100% 100%', backgroundPosition: '0 0', isolation: 'isolate' }}>

      <GhostStyles />
      <AmbientLayer />

      {/* Vignette */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, transparent 38%, rgba(2,2,7,0.55) 100%)' }} />

      {/* KATE spotlight */}
      <div className="absolute pointer-events-none" style={{
        left: kateX, top: toY(kw.y),
        width: toH(kateSlot.h) * 3.4, height: toH(kateSlot.h) * 2.2,
        transform: 'translate(-50%, -78%)',
        background: 'radial-gradient(ellipse at center bottom, rgba(246,78,110,0.22), rgba(255,121,94,0.08) 45%, transparent 70%)',
        mixBlendMode: 'screen',
      }} />

      {/* Toolbar */}
      <div className="absolute top-3 right-3 z-[2500] flex items-center gap-2 font-mono text-[10px]">
        <span className="px-2 py-1 border border-white/10 bg-[#050505]/80 text-[#b8b8b8]">
          <span className="text-emerald-400">●</span> {onlineCount}/{view.length} ONLINE
        </span>
        <button onClick={() => setShowTopology((s) => !s)}
          className={`px-2 py-1 border bg-[#050505]/80 ${showTopology ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#b8b8b8] hover:border-white/30'}`}>
          TOPOLOGY
        </button>
        <button onClick={() => setMotion((m) => (m === 'high' ? 'med' : m === 'med' ? 'low' : 'high'))}
          className="px-2 py-1 border border-white/10 bg-[#050505]/80 text-[#b8b8b8] hover:border-white/30">
          MOTION · {motion.toUpperCase()}
        </button>
      </div>

      {/* SVG overlay: topology + KATE command beams */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
        <defs>
          <filter id="lineGlow"><feGaussianBlur stdDeviation="2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>

        {showTopology && view.filter((v) => !v.dir && v.online).map((v) => {
          const w = walkersRef.current![v.slot.id];
          const color = SQUAD_META[v.squad]?.color || '#f64e6e';
          const tx = toX(w.x), ty = toY(w.y) - toH(v.slot.h) * 0.5;
          return <line key={v.slot.id} x1={kateX} y1={kateY} x2={tx} y2={ty} stroke={color} strokeWidth="0.5" opacity="0.14" />;
        })}

        {busyAgents.map((v, i) => {
          const w = walkersRef.current![v.slot.id];
          const color = SQUAD_META[v.squad]?.color || '#f64e6e';
          const tx = toX(w.x), ty = toY(w.y) - toH(v.slot.h) * 0.5;
          return (
            <g key={v.slot.id}>
              <line x1={kateX} y1={kateY} x2={tx} y2={ty} stroke={color} strokeWidth="0.6" opacity="0.18" />
              <circle r="2.2" fill={color} filter="url(#lineGlow)">
                <animateMotion dur={`${1.6 + (i % 6) * 0.35}s`} repeatCount="indefinite" path={`M ${kateX} ${kateY} L ${tx} ${ty}`} />
                <animate attributeName="opacity" values="0;1;1;0" dur={`${1.6 + (i % 6) * 0.35}s`} repeatCount="indefinite" />
              </circle>
            </g>
          );
        })}
      </svg>

      {/* Agents */}
      {zOrder.map((slot) => {
        const v = viewById[slot.id];
        const w = walkersRef.current![slot.id];
        const online = v.online;
        const sk = spriteKey(slot.sprite);
        const aspect = ASPECTS[sk] || 0.6;
        const dispH = toH(slot.h);
        const dispW = dispH * aspect;
        const bob = w.moving ? Math.abs(Math.sin(w.bobT)) * (dispH * 0.025) : 0;
        const legA = w.moving ? Math.sin(w.bobT) * 11 : 0;
        const cx = toX(w.x);
        const cy = toY(w.y) - bob;
        const left = cx - dispW / 2;
        const top = cy - dispH;
        const dir = v.dir;
        const isSel = selectedId === slot.id;
        const isHov = hoveredId === slot.id;
        const sq = SQUAD_META[v.squad] || SQUAD_META.CORE;
        const dimmed = hoveredId && !isHov && !dir;
        const statusColor = !online ? '#545454' : v.busy ? '#f64e6e' : '#00ff41';
        const glitch = fx[slot.id];
        const glitchClass = glitch === 'in' ? 'gn-glitch-in' : glitch === 'out' ? 'gn-glitch-out' : '';
        const glowFilter = dir ? 'drop-shadow(0 0 7px rgba(246,78,110,0.85))'
          : v.busy && online ? `drop-shadow(0 0 5px ${sq.color}cc)`
          : isHov ? `drop-shadow(0 0 5px ${sq.color}aa) brightness(1.12)` : 'none';

        let clipBottom = 0;
        if (!isHov && !isSel && !dir) {
          for (const z of OCCLUDERS) {
            if (w.x >= z.x0 && w.x <= z.x1 && w.y > z.topY && w.y <= z.baseY + 1.5) {
              const lineLocal = toY(z.topY) - top;
              clipBottom = Math.max(clipBottom, Math.max(0, Math.min(dispH, dispH - lineLocal)));
            }
          }
        }

        return (
          <div key={slot.id} className="absolute"
            style={{
              left, top, width: dispW, height: dispH + 24,
              cursor: 'pointer', zIndex: (isHov || isSel) ? 2000 : Math.round(w.y * 10),
              opacity: dimmed ? 0.35 : 1, transition: 'opacity 0.25s',
            }}
            onMouseEnter={() => { setHoveredId(slot.id); setTooltip({ id: slot.id, left: cx, top: top - 6 }); }}
            onMouseLeave={() => { setHoveredId(null); setTooltip(null); }}
            onClick={() => setSelectedId((cur) => (cur === slot.id ? null : slot.id))}>

            {online && (
              <div className="absolute pointer-events-none" style={{
                bottom: 24, left: '50%', transform: 'translateX(-50%)',
                width: dispW * (v.busy ? 1.1 : 0.85), height: 7,
                background: dir ? '#f64e6e' : sq.color, borderRadius: '50%',
                filter: 'blur(6px)', opacity: v.busy ? 0.7 : isHov ? 0.5 : 0.22, transition: 'opacity 0.2s',
              }} />
            )}

            {(isSel || isHov) && (
              <div className="absolute pointer-events-none" style={{
                top: -2, left: -3, right: -3, bottom: 22,
                border: `1.5px ${isSel ? 'dashed' : 'solid'} ${isSel ? '#f64e6e' : sq.color}`,
                boxShadow: `0 0 10px ${isSel ? 'rgba(246,78,110,0.6)' : sq.color + '88'}`,
                animation: isSel ? 'gn-dash 0.6s linear infinite' : 'none',
              }} />
            )}

            {dir && (
              <div className="absolute flex pointer-events-none"
                style={{ bottom: dispH + 24, left: '50%', transform: 'translateX(-50%)', gap: 3 }}>
                {[0, 1, 0].map((tall, i) => (
                  <div key={i} style={{ width: 4, height: tall ? 8 : 5, background: '#ff795e', boxShadow: '0 0 6px #ff795e', animation: `gn-pulse ${0.8 + i * 0.2}s ease-in-out infinite` }} />
                ))}
              </div>
            )}

            <div className={glitchClass} style={{
              position: 'relative', width: dispW, height: dispH,
              transform: `scaleX(${w.facing})`, filter: glowFilter, opacity: online ? 1 : 0.3,
              transition: 'filter 0.2s', clipPath: clipBottom > 0 ? `inset(0 0 ${clipBottom}px 0)` : undefined,
            }}>
              {w.moving ? (
                <>
                  <img src={asset(slot.sprite)} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: dispW, height: dispH, imageRendering: 'pixelated', clipPath: 'inset(65% 50% 0 0)', transformOrigin: '50% 66%', transform: `rotate(${legA}deg)` }} />
                  <img src={asset(slot.sprite)} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: dispW, height: dispH, imageRendering: 'pixelated', clipPath: 'inset(65% 0 0 50%)', transformOrigin: '50% 66%', transform: `rotate(${-legA}deg)` }} />
                  <img src={asset(slot.sprite)} alt={v.name} draggable={false} style={{ position: 'absolute', inset: 0, width: dispW, height: dispH, imageRendering: 'pixelated', clipPath: 'inset(0 0 34% 0)' }} />
                </>
              ) : (
                <img src={asset(slot.sprite)} alt={v.name} draggable={false} style={{ width: dispW, height: dispH, imageRendering: 'pixelated', display: 'block' }} />
              )}
            </div>

            <div className="absolute pointer-events-none" style={{
              top: -4, left: '50%', transform: 'translateX(-50%)', width: 6, height: 6, borderRadius: '50%',
              background: statusColor, boxShadow: `0 0 6px ${statusColor}`,
              animation: (v.busy && online) || dir ? 'gn-pulse 1s ease-in-out infinite' : 'none',
            }} />

            {showName(slot.id) && (
              <div className="absolute text-center pointer-events-none" style={{
                bottom: 4, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap',
                fontSize: Math.max(8, dispW * 0.17) + 'px', fontFamily: 'ui-monospace,monospace',
                color: dir ? '#f64e6e' : '#fff', fontWeight: dir ? 700 : 500,
                textShadow: '0 1px 3px #000, 0 0 8px rgba(0,0,0,0.9)',
              }}>
                {v.name.length > 13 ? v.name.slice(0, 12) + '…' : v.name}
              </div>
            )}
          </div>
        );
      })}

      {/* Hover tooltip */}
      {tooltip && (() => {
        const v = viewById[tooltip.id];
        if (!v) return null;
        const sq = SQUAD_META[v.squad] || SQUAD_META.CORE;
        const tier = v.dir ? 'DIRECTOR' : v.slot.id.startsWith('fx') ? 'FIXER' : 'RUNNER';
        const left = Math.max(80, Math.min(dims.w - 80, tooltip.left));
        return (
          <div className="absolute pointer-events-none" style={{
            zIndex: 3000, left, top: tooltip.top, transform: 'translate(-50%, -100%)',
            background: 'rgba(5,5,8,0.94)', border: `1px solid ${sq.color}88`,
            boxShadow: `0 0 16px ${sq.color}44`, padding: '5px 8px', minWidth: 120,
          }}>
            <div className="flex items-center gap-1.5 mb-0.5">
              <div style={{ width: 6, height: 6, background: sq.color }} />
              <span className="font-mono text-[10px] font-bold" style={{ color: v.online ? '#fff' : '#777' }}>{v.name}</span>
            </div>
            <div className="font-mono text-[8px] text-[#888] leading-relaxed">
              {tier} · {sq.label}{v.bound ? '' : ' · UNASSIGNED'}<br />
              <span style={{ color: v.online ? (v.busy ? '#f64e6e' : '#00ff41') : '#545454' }}>
                {v.online ? '● ' + v.task : '○ DORMANT'}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Selected agent detail card */}
      {selectedId && (() => {
        const v = viewById[selectedId];
        if (!v) return null;
        const sq = SQUAD_META[v.squad] || SQUAD_META.CORE;
        const tier = v.dir ? 'DIRECTOR' : v.slot.id.startsWith('fx') ? 'FIXER' : 'RUNNER';
        return (
          <div className="absolute bottom-3 left-3 z-[3000] w-[230px] bg-[#050505]/95 border" style={{ borderColor: sq.color + '66' }}>
            <div className="px-3 h-[26px] flex items-center justify-between border-b" style={{ borderColor: sq.color + '33' }}>
              <span className="font-mono text-[10px] tracking-[0.2em] uppercase font-bold" style={{ color: sq.color }}>{v.name}</span>
              <button onClick={() => setSelectedId(null)} className="text-[#545454] hover:text-white text-[11px]">✕</button>
            </div>
            <div className="p-3 font-mono text-[10px] text-[#b8b8b8] flex flex-col gap-1">
              <Row k="TIER" val={tier} />
              <Row k="SQUAD" val={sq.label} />
              <Row k="STATUS" val={v.online ? (v.busy ? 'BUSY' : 'ONLINE') : 'DORMANT'} color={v.online ? (v.busy ? '#f64e6e' : '#00ff41') : '#545454'} />
              <Row k="RUNNING" val={String(v.agent?.tasks_running ?? 0)} />
              <Row k="QUEUE" val={String(v.queue)} />
              <Row k="SOURCE" val={v.bound ? 'hermes' : 'unassigned slot'} />
            </div>
          </div>
        );
      })()}

      {/* Zone labels */}
      {error && (
        <div className="absolute top-3 left-3 z-[2500] px-2 py-1 border border-red-400/40 bg-[#050505]/80 text-red-400 font-mono text-[10px]">
          ⚠ {error}
        </div>
      )}
      {isLoading && (
        <div className="absolute top-3 left-3 z-[2500] px-2 py-1 border border-white/10 bg-[#050505]/80 text-[#b8b8b8] font-mono text-[10px]">
          syncing…
        </div>
      )}
      {([['CHILL', 8], ['CAFÉ', 28], ['RECHARGE', 47], ['MAINFRAME', 70]] as [string, number][]).map(([lbl, x]) => (
        <div key={lbl} className="absolute pointer-events-none" style={{ bottom: '11%', left: `${x}%` }}>
          <span className="font-mono tracking-[0.3em] text-white/25" style={{ fontSize: 10 }}>[ {lbl} ]</span>
        </div>
      ))}
    </div>
  );
}

function Row({ k, val, color }: { k: string; val: string; color?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[#545454]">{k}</span>
      <span style={{ color: color || '#fff' }}>{val}</span>
    </div>
  );
}

function AmbientLayer() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div className="absolute" style={{ left: '33%', top: '48%' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ position: 'absolute', left: i * 6, width: 3, height: 22, borderRadius: 3, background: 'linear-gradient(to top, rgba(255,255,255,0.0), rgba(255,255,255,0.28))', animation: `gn-steam 2.6s ease-in ${i * 0.5}s infinite` }} />
        ))}
      </div>
      {[49.5, 56.5, 63].map((x, i) => (
        <div key={i} className="absolute" style={{ left: `${x}%`, top: '40%', width: 26, height: 46, transform: 'translate(-50%,-50%)', background: 'radial-gradient(ellipse at center, rgba(56,189,248,0.30), transparent 70%)', animation: `gn-pod 2.4s ease-in-out ${i * 0.5}s infinite` }} />
      ))}
      {([[82, 26], [90, 31], [86, 39]] as [number, number][]).map(([x, y], i) => (
        <div key={i} className="absolute overflow-hidden" style={{ left: `${x}%`, top: `${y}%`, width: 22, height: 28, opacity: 0.5 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 7, lineHeight: '7px', color: '#00ff41', textShadow: '0 0 4px #00ff41', whiteSpace: 'pre', animation: `gn-rain 1.8s linear ${i * 0.4}s infinite` }}>{'10\n01\n11\n00\n10\n01\n11\n01\n00\n10'}</div>
        </div>
      ))}
      {([['#ec4899', 16, 35], ['#f59e0b', 40, 30], ['#38bdf8', 61, 29]] as [string, number, number][]).map(([c, x, y], i) => (
        <div key={i} className="absolute" style={{ left: `${x}%`, top: `${y}%`, width: 40, height: 16, transform: 'translate(-50%,-50%)', background: `radial-gradient(ellipse, ${c}33, transparent 70%)`, animation: `gn-flicker ${3 + i}s steps(1) ${i * 0.7}s infinite` }} />
      ))}
    </div>
  );
}

function GhostStyles() {
  return (
    <style>{`
      @keyframes gn-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
      @keyframes gn-dash { to { background-position: 12px 0; } }
      @keyframes gn-steam { 0% { opacity: 0; transform: translateY(0) scaleX(1); } 30% { opacity: 0.6; } 100% { opacity: 0; transform: translateY(-26px) scaleX(1.6); } }
      @keyframes gn-pod { 0%,100%{opacity:0.4; transform:translate(-50%,-50%) scale(0.92);} 50%{opacity:0.9; transform:translate(-50%,-50%) scale(1.08);} }
      @keyframes gn-rain { from { transform: translateY(-50%); } to { transform: translateY(0%); } }
      @keyframes gn-flicker { 0%,100%{opacity:0.8} 47%{opacity:0.8} 48%{opacity:0.25} 49%{opacity:0.8} 70%{opacity:0.8} 71%{opacity:0.3} 72%{opacity:0.8} }
      @keyframes gn-glitch-in { 0% { opacity:0; clip-path: inset(46% 0 46% 0); filter: brightness(2.4) hue-rotate(110deg); transform: translateX(7px); } 20% { opacity:1; clip-path: inset(0 0 62% 0); transform: translateX(-6px); filter: brightness(2) hue-rotate(-70deg); } 40% { clip-path: inset(54% 0 0 0); transform: translateX(5px); } 60% { clip-path: inset(12% 0 12% 0); transform: translateX(-3px); filter: brightness(1.6); } 80% { clip-path: inset(0); transform: translateX(2px); } 100% { opacity:1; clip-path: inset(0); transform: none; filter: none; } }
      @keyframes gn-glitch-out { 0% { opacity:1; clip-path: inset(0); filter:none; transform: none; } 25% { clip-path: inset(0 0 55% 0); transform: translateX(5px); filter: brightness(2) hue-rotate(80deg); } 50% { clip-path: inset(40% 0 0 0); transform: translateX(-6px); } 75% { clip-path: inset(20% 0 30% 0); transform: translateX(4px); filter: brightness(2.6) hue-rotate(-90deg); } 100% { opacity:0; clip-path: inset(48% 0 48% 0); transform: translateX(8px); } }
      .gn-glitch-in { animation: gn-glitch-in 0.74s steps(1,end) both; }
      .gn-glitch-out { animation: gn-glitch-out 0.74s steps(1,end) both; }
    `}</style>
  );
}
