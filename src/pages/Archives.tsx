// Archives — mission history browser + query editor. Ported from the zip design.
// NOTE: static demo data (no Hermes source).
import { useState } from 'react';
import { Panel, Label } from '../components/cyberpunk/ui';
import { SQUAD_META, DEMO_NOTE } from '../lib/legionData';
import DemoBadge from '../components/DemoBadge';

const rows: string[][] = [
  ['M-18422', 'carousel · micro-SaaS', 'DROPKICK', 'CONT', '04:21:11', 'ok', '184 eng', '$0.42'],
  ['M-18421', 'archive · Q2 briefs', 'MNEMOSYNE', 'INFRA', '04:18:09', 'ok', '2104 rows', '$0.08'],
  ['M-18420', 'trend-ingest · neural-CAD', 'PROPHET', 'INTEL', '04:17:55', 'ok', '3 drafts', '$0.31'],
  ['M-18419', 'security-scan · gateway', 'OVERWATCH', 'SEC', '04:15:02', 'ok', '0 flags', '$0.04'],
  ['M-18418', 'script · speedrun reel', 'THE HOOK', 'CONT', '04:12:44', 'ok', '3 variants', '$0.22'],
  ['M-18417', 'relay · event-bridge', 'SWITCHBOARD', 'INFRA', '04:10:01', 'ok', '47/s', '$0.01'],
  ['M-18416', 'longform draft · local-LLMs', 'GHOSTWRITER', 'CONT', '04:04:30', 'ok', '2800 words', '$0.94'],
  ['M-18415', 'sentiment · EU AI Act', 'MORNINGSTAR', 'INTEL', '04:01:12', 'warn', 'mixed', '$0.18'],
];

const nav: [string, string][] = [
  ['▸ missions', '18,422'], ['  closed', '17,041'], ['  active', '    12'],
  ['▸ trends', ' 9,284'], ['▸ briefings', '   184'], ['▸ content', ' 3,920'],
  ['▸ archives', '12,841'], ['▸ mnemosyne', 'learning'],
];

export default function Archives() {
  const [query, setQuery] = useState('SELECT * FROM missions WHERE status = "closed" ORDER BY closed_at DESC LIMIT 50;');

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-2 p-2 relative">
      <Panel label="NAVIGATOR">
        <div className="flex flex-col gap-0.5 text-[10px] font-mono">
          {nav.map(([k, v]) => (
            <div key={k} className="flex justify-between px-2 py-1 hover:bg-white/5 cursor-pointer text-[#b8b8b8] hover:text-white">
              <span>{k}</span><span className="text-[#545454] tabular-nums">{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 border-t border-white/10 pt-2">
          <Label className="text-[#545454]">MNEMOSYNE · LEARNING</Label>
          <div className="mt-2 flex flex-col gap-1">
            {['prompt-tuning · 72% → 81%', 'retrieval-k · 5 → 8', 'voice · weaver++', 'reject-rate · 93%'].map((x) => (
              <div key={x} className="text-[10px] font-mono text-[#b8b8b8] flex items-center gap-1">
                <span className="w-1 h-1 bg-[#a855f7]" />{x}
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <div className="flex flex-col gap-2 min-h-0">
        <Panel label="QUERY EDITOR" className="h-[100px] shrink-0" right={<div className="flex gap-2"><span className="text-[#545454]">postgres · ops</span><button className="text-[#f64e6e]">▸ RUN</button></div>}>
          <textarea value={query} onChange={(e) => setQuery(e.target.value)}
            className="w-full h-full bg-[#030306] border border-white/5 text-[11px] font-mono text-white p-2 resize-none focus:outline-none focus:border-[#f64e6e]"
            spellCheck={false} />
        </Panel>
        <Panel label="RESULTS · 8 of 17,041">
          <div className="overflow-auto h-full">
            <table className="w-full text-[10px] font-mono">
              <thead>
                <tr className="text-[#545454] text-left">
                  {['ID', 'MISSION', 'AGENT', 'SQUAD', 'CLOSED', 'ST', 'OUTPUT', 'COST'].map((h) => (
                    <th key={h} className="font-normal py-1 pr-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-white/5 hover:bg-white/5">
                    {r.map((c, j) => (
                      <td key={j}
                        className={`py-1.5 pr-3 ${j === 5 ? (c === 'ok' ? 'text-emerald-400' : 'text-amber-400') : j === 0 ? 'text-[#545454]' : j === 1 ? 'text-white' : j === 3 ? '' : 'text-[#b8b8b8]'}`}
                        style={j === 3 ? { color: SQUAD_META[c]?.color } : {}}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <DemoBadge label={DEMO_NOTE} />
    </div>
  );
}
