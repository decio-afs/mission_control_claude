// Broadcast Uplink — channel stats + publishing queue. Ported from the zip.
// NOTE: static demo data (no Hermes source).
import { Panel, Pill, Sparkline } from '../components/cyberpunk/ui';
import { DEMO_NOTE } from '../lib/legionData';
import DemoBadge from '../components/DemoBadge';

const channels = [
  { p: 'INSTAGRAM', handle: '@daoss', reach: '84.2k', eng: '4.1%', c: '#f64e6e' },
  { p: 'X / TWITTER', handle: '@daoss_agency', reach: '31.7k', eng: '2.8%', c: '#38bdf8' },
  { p: 'TIKTOK', handle: '@ghostlegion', reach: '247k', eng: '6.7%', c: '#a855f7' },
  { p: 'LINKEDIN', handle: 'DA Agency', reach: '12.1k', eng: '5.2%', c: '#10b981' },
];

const queue: { ch: string; t: string; title: string; status: string; tone: 'good' | 'info' | 'warn' | 'neutral' }[] = [
  { ch: 'IG', t: '09:00', title: 'micro-SaaS speedrun · carousel', status: 'READY', tone: 'good' },
  { ch: 'X', t: '09:12', title: 'trend thread · agent memory', status: 'READY', tone: 'good' },
  { ch: 'TT', t: '14:00', title: 'speedrun reel · 00:43', status: 'RENDERING', tone: 'info' },
  { ch: 'LI', t: '17:00', title: 'longform · local LLMs', status: 'REVIEW', tone: 'warn' },
  { ch: 'IG', t: '19:30', title: 'story · mainframe glitch', status: 'QUEUED', tone: 'neutral' },
  { ch: 'X', t: '21:00', title: 'nightcap · briefing excerpt', status: 'QUEUED', tone: 'neutral' },
];

const toneColor: Record<string, string> = { good: '#10b981', warn: '#f59e0b', info: '#38bdf8', neutral: '#b8b8b8' };

export default function BroadcastUplink() {
  return (
    <div className="h-full grid grid-cols-2 lg:grid-cols-4 gap-2 p-2 overflow-auto relative">
      {channels.map((ch, i) => (
        <Panel key={ch.p} label={ch.p} right={<span style={{ color: ch.c }}>●</span>}>
          <div className="flex flex-col h-full">
            <div className="text-[10px] font-mono text-[#545454]">{ch.handle}</div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <div className="text-[9px] font-mono text-[#545454]">REACH</div>
                <div className="text-lg font-mono font-bold text-white tabular-nums">{ch.reach}</div>
              </div>
              <div>
                <div className="text-[9px] font-mono text-[#545454]">ENG</div>
                <div className="text-lg font-mono font-bold tabular-nums" style={{ color: ch.c }}>{ch.eng}</div>
              </div>
            </div>
            <div className="mt-2">
              <Sparkline data={Array.from({ length: 30 }, (_, k) => 50 + Math.sin(k / 3 + i) * 20 + (k % 4))} color={ch.c} height={32} />
            </div>
            <div className="mt-auto pt-2 border-t border-white/10 text-[10px] font-mono">
              <div className="flex justify-between"><span className="text-[#545454]">queued</span><span className="text-white tabular-nums">{[2, 2, 1, 1][i]}</span></div>
              <div className="flex justify-between"><span className="text-[#545454]">24h posts</span><span className="text-white tabular-nums">{[7, 11, 4, 2][i]}</span></div>
            </div>
          </div>
        </Panel>
      ))}

      <Panel label="PUBLISHING QUEUE · NEXT 24H" className="col-span-2 lg:col-span-4" right={<span className="text-emerald-400">● GATEWAY SYNCED</span>}>
        <div className="flex flex-col gap-1">
          {queue.map((q, i) => (
            <div key={i} className="grid grid-cols-[60px_50px_1fr_auto_120px] items-center gap-3 px-3 py-2 border border-white/5 hover:border-white/15 bg-[#080808]">
              <span className="text-[10px] font-mono text-[#545454]">{q.t}</span>
              <Pill tone={q.tone}>{q.ch}</Pill>
              <span className="text-[11px] text-white">{q.title}</span>
              <span className="text-[10px] font-mono" style={{ color: toneColor[q.tone] }}>{q.status}</span>
              <div className="flex gap-1 justify-end">
                <button className="text-[9px] font-mono border border-white/10 px-2 py-0.5 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e]">EDIT</button>
                <button className="text-[9px] font-mono border border-white/10 px-2 py-0.5 text-[#b8b8b8] hover:border-emerald-400 hover:text-emerald-400">▸ SEND</button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <DemoBadge label={DEMO_NOTE} />
    </div>
  );
}
