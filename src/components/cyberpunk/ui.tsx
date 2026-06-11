// Shared UI primitives for Mission Control — Cyberpunk Edition
// Non-component helpers (useTick, hRand, useTypewriter, h) live in ./util.ts.
import { useState, useEffect, useRef, useLayoutEffect } from 'react';

// Label — uppercase letterspaced
export function Label({ children, className = '', style = {} }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <span className={`font-mono text-[10px] tracking-[0.2em] uppercase font-bold ${className}`} style={style}>{children}</span>;
}

// Pill
export function Pill({ children, tone = 'neutral', className = '' }: { children: React.ReactNode; tone?: 'neutral' | 'brand' | 'good' | 'warn' | 'info' | 'bad'; className?: string }) {
  const tones: Record<string, string> = {
    neutral: 'border-white/15 text-[#b8b8b8]',
    brand:   'border-[#f64e6e]/40 text-[#f64e6e] bg-[#f64e6e]/5',
    good:    'border-emerald-400/40 text-emerald-400 bg-emerald-400/5',
    warn:    'border-amber-400/40 text-amber-400 bg-amber-400/5',
    info:    'border-sky-400/40 text-sky-400 bg-sky-400/5',
    bad:     'border-red-400/40 text-red-400 bg-red-400/5',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border font-mono text-[10px] tracking-[0.2em] uppercase ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

// Panel
export function Panel({ children, label, right, className = '', bodyClass = '', noPad = false }: { children: React.ReactNode; label?: string; right?: React.ReactNode; className?: string; bodyClass?: string; noPad?: boolean }) {
  return (
    <div className={`bg-[#0A0A0A] border border-white/[0.08] flex flex-col relative ${className}`}>
      {label && (
        <div className="px-3 h-[26px] flex items-center justify-between gap-2 border-b border-white/10 shrink-0 bg-[#080808]">
          {/* min-w-0 lets the label truncate instead of pushing the controls past
              the panel edge when a header has both a long label and a busy `right`
              slot (e.g. War Room's STATUS/FLOW + LIVE toggle on a narrow column). */}
          <Label className="text-[#b8b8b8] truncate min-w-0">{label}</Label>
          <div className="flex items-center gap-2 text-[10px] text-[#545454] font-mono shrink-0">{right}</div>
        </div>
      )}
      <div className={`${noPad ? '' : 'p-3'} ${bodyClass} relative flex-1 min-h-0`}>
        {children}
      </div>
    </div>
  );
}

// Corner brackets — subtle cyberpunk frame accents
export function CornerBrackets({ color = 'rgba(255,255,255,0.3)' }: { color?: string }) {
  const s = 10;
  const st = { stroke: color, strokeWidth: 1, fill: 'none' };
  return (
    <svg className="absolute inset-0 pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
      <path d={`M 0 ${s} L 0 0 L ${s} 0`} {...st} />
      <path d={`M ${100-s} 0 L 100 0 L 100 ${s}`} {...st} />
      <path d={`M 100 ${100-s} L 100 100 L ${100-s} 100`} {...st} />
      <path d={`M ${s} 100 L 0 100 L 0 ${100-s}`} {...st} />
    </svg>
  );
}

// Sparkline
export function Sparkline({ data, color = '#f64e6e', height = 28, strokeW = 1.2, fill = true }: { data: number[]; color?: string; height?: number; strokeW?: number; fill?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(100);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(() => setW(ref.current!.offsetWidth));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  if (!data || data.length < 2) return <div ref={ref} style={{ height }} />;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => [
    (i / (data.length - 1)) * w,
    height - ((v - min) / range) * (height - 2) - 1,
  ]);
  const d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${(x as number).toFixed(1)} ${(y as number).toFixed(1)}`).join(' ');
  const fillD = `${d} L ${w} ${height} L 0 ${height} Z`;
  return (
    <div ref={ref} style={{ width: '100%', height }}>
      <svg width={w} height={height} style={{ display: 'block' }}>
        {fill && <path d={fillD} fill={color} opacity="0.12" />}
        <path d={d} stroke={color} strokeWidth={strokeW} fill="none" />
      </svg>
    </div>
  );
}

// Monospace stat card
export function Stat({ label, value, sub, tone = 'white', big = false }: { label: string; value: React.ReactNode; sub?: string; tone?: 'white' | 'brand' | 'good' | 'warn' | 'info'; big?: boolean }) {
  const tones: Record<string, string> = {
    white: 'text-white',
    brand: 'text-[#f64e6e]',
    good: 'text-emerald-400',
    warn: 'text-amber-400',
    info: 'text-sky-400',
  };
  return (
    <div className="flex flex-col gap-0.5">
      <Label className="text-[#545454]">{label}</Label>
      <div className={`${big ? 'text-2xl' : 'text-base'} font-mono font-bold tabular-nums ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-[10px] font-mono text-[#545454]">{sub}</div>}
    </div>
  );
}

// Scrolling log tail — auto-follows the newest line, but stays scrollable so
// earlier history can be read back. Previously `overflow-hidden` clipped any
// line above the fold with no way to reach it; now it scrolls, and the
// auto-follow only re-pins to the bottom when the reader is already parked there
// (so a poll of fresh lines doesn't yank someone scrolling up — mirrors the
// WorkerLogStream tail pattern).
export function LogTail({ lines, height = 180 }: { lines: { t: string; tag?: string; color?: string; msg: string }[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const onScroll = () => {
    const el = containerRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  useEffect(() => {
    const el = containerRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div ref={containerRef} onScroll={onScroll} className="font-mono text-[10px] leading-[1.5] overflow-y-auto overflow-x-hidden relative" style={{ height }}>
      {lines.map((l, i) => (
        <div key={i} className="flex gap-2">
          <span className="text-[#363636] shrink-0">{l.t}</span>
          <span className="text-[#545454] shrink-0">{l.tag || '>>'}</span>
          <span style={{ color: l.color || '#b8b8b8' }} className="truncate">{l.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ring gauge
export function Ring({ value, max = 100, size = 56, stroke = 4, color = '#f64e6e', label, track = 'rgba(255,255,255,0.08)' }: { value: number; max?: number; size?: number; stroke?: number; color?: string; label?: string; track?: string }) {
  const pct = Math.max(0, Math.min(1, value / max));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 400ms linear', filter: `drop-shadow(0 0 6px ${color}80)` }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-mono text-sm font-bold text-white tabular-nums">{Math.round(value)}</div>
        {label && <div className="text-[10px] font-mono text-[#545454] uppercase tracking-widest">{label}</div>}
      </div>
    </div>
  );
}
