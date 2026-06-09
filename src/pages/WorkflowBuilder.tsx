// Workflow Builder — node graph editor. Ported from the zip design.
// NOTE: static demo graph (no Hermes source).
import { Panel, Label } from '../components/cyberpunk/ui';
import { DEMO_NOTE } from '../lib/legionData';
import DemoBadge from '../components/DemoBadge';

const accent = '#f64e6e';

interface WfNode { id: string; x: number; y: number; label: string; sub: string; color: string; }

const nodes: WfNode[] = [
  { id: 'n1', x: 60, y: 100, label: 'TREND DETECT', sub: 'THE PROPHET', color: '#a855f7' },
  { id: 'n2', x: 260, y: 60, label: 'SCORE VIAB.', sub: '≥60', color: '#38bdf8' },
  { id: 'n3', x: 260, y: 160, label: 'SENTIMENT', sub: 'MORNINGSTAR', color: '#38bdf8' },
  { id: 'n4', x: 460, y: 110, label: 'COMPOSE', sub: 'THE WEAVER', color: '#f64e6e' },
  { id: 'n5', x: 660, y: 60, label: 'CAROUSEL', sub: '7 slides', color: '#f59e0b' },
  { id: 'n6', x: 660, y: 160, label: 'SCRIPT', sub: 'THE HOOK', color: '#f59e0b' },
  { id: 'n7', x: 860, y: 110, label: 'PUBLISH', sub: 'DROPKICK', color: '#10b981' },
  { id: 'n8', x: 460, y: 260, label: 'ARCHIVE', sub: 'MNEMOSYNE', color: '#545454' },
];
const edges: [string, string][] = [
  ['n1', 'n2'], ['n1', 'n3'], ['n2', 'n4'], ['n3', 'n4'],
  ['n4', 'n5'], ['n4', 'n6'], ['n5', 'n7'], ['n6', 'n7'], ['n4', 'n8'],
];

const nBy = (id: string) => nodes.find((n) => n.id === id)!;

export default function WorkflowBuilder() {
  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-2 p-2 relative">
      <Panel label="WORKFLOW · trend-to-publish-v3" right="drag to pan · scroll to zoom">
        <div className="h-full relative overflow-hidden bg-[#030306] min-h-[340px]"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
          <svg viewBox="0 0 960 340" preserveAspectRatio="xMidYMid meet" className="w-full h-full">
            {edges.map(([a, b], i) => {
              const na = nBy(a), nb = nBy(b);
              const x1 = na.x + 80, y1 = na.y + 24;
              const x2 = nb.x, y2 = nb.y + 24;
              const mid = (x1 + x2) / 2;
              const d = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
              return (
                <g key={i}>
                  <path d={d} stroke="rgba(255,255,255,0.15)" strokeWidth="1" fill="none" />
                  <circle r="2" fill={accent}>
                    <animateMotion dur={`${2 + (i % 3)}s`} repeatCount="indefinite" path={d} />
                  </circle>
                </g>
              );
            })}
            {nodes.map((n) => (
              <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
                <rect width="160" height="48" fill="#0a0a0a" stroke={n.color} strokeWidth="1" />
                <rect width="160" height="2" fill={n.color} />
                <rect width="3" height="48" fill={n.color} opacity="0.5" />
                <text x="8" y="18" fontFamily="monospace" fontSize="10" fill="#fff" fontWeight="700">{n.label}</text>
                <text x="8" y="34" fontFamily="monospace" fontSize="9" fill="#b8b8b8">{n.sub}</text>
                <circle cx="155" cy="8" r="2" fill={n.color}>
                  <animate attributeName="opacity" values="0.3;1;0.3" dur="1.4s" repeatCount="indefinite" />
                </circle>
              </g>
            ))}
          </svg>
        </div>
      </Panel>

      <Panel label="NODE PALETTE">
        <div className="flex flex-col gap-1">
          <Label className="text-[#545454] mb-1">TRIGGERS</Label>
          {['cron', 'webhook', 'trend-watch', 'ws-event'].map((x) => (
            <div key={x} className="px-2 py-1.5 border border-white/8 text-[10px] font-mono text-[#b8b8b8] hover:border-[#f64e6e] hover:text-white cursor-grab">◈ {x}</div>
          ))}
          <Label className="text-[#545454] mt-2 mb-1">TRANSFORMS</Label>
          {['score', 'filter', 'rewrite', 'extract', 'merge'].map((x) => (
            <div key={x} className="px-2 py-1.5 border border-white/8 text-[10px] font-mono text-[#b8b8b8] hover:border-[#f64e6e] hover:text-white cursor-grab">◇ {x}</div>
          ))}
          <Label className="text-[#545454] mt-2 mb-1">SINKS</Label>
          {['notion', 'publish', 'slack', 'archive'].map((x) => (
            <div key={x} className="px-2 py-1.5 border border-white/8 text-[10px] font-mono text-[#b8b8b8] hover:border-[#f64e6e] hover:text-white cursor-grab">▣ {x}</div>
          ))}
        </div>
      </Panel>
      <DemoBadge label={DEMO_NOTE} />
    </div>
  );
}
