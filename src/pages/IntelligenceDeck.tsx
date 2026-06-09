// Intel Deck — trend signal analysis. Design module ported from the zip.
// NOTE: static demo data (Hermes has no trend source). Marked DEMO in the UI.
import { Panel, Label } from '../components/cyberpunk/ui';
import { useTick, hRand } from '../components/cyberpunk/util';
import { TRENDS, DEMO_NOTE } from '../lib/legionData';
import DemoBadge from '../components/DemoBadge';

const accent = '#f64e6e';

export default function IntelligenceDeck() {
  const t = useTick(1200);
  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-2 p-2 relative">
      <div className="flex flex-col gap-2 min-h-0">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 shrink-0">
          {[
            { k: 'CAPTURED', v: 2847 + (t % 4), c: '#b8b8b8' },
            { k: 'VIABLE', v: 147 + (t % 3), c: accent },
            { k: 'INGESTED', v: 23, c: '#10b981' },
            { k: 'REJECTED', v: 2677 + (t % 4), c: '#545454' },
          ].map((s) => (
            <Panel key={s.k} label={s.k} className="h-[70px]">
              <div className="text-2xl font-mono font-bold tabular-nums" style={{ color: s.c }}>{s.v.toLocaleString()}</div>
              <div className="text-[9px] font-mono text-[#545454]">last 24h</div>
            </Panel>
          ))}
        </div>

        <Panel label="TREND SIGNAL · VIABILITY ≥ 60" right="auto-refresh 15m">
          <div className="overflow-auto h-full">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-[#545454] text-left">
                  <th className="font-normal py-1 pr-2">PLATFORM</th>
                  <th className="font-normal py-1 pr-2">TOPIC</th>
                  <th className="font-normal py-1 pr-2 text-right">VIABILITY</th>
                  <th className="font-normal py-1 pr-2">SENTIMENT</th>
                  <th className="font-normal py-1 pr-2 text-right">DELTA</th>
                  <th className="font-normal py-1 pr-2">CAPTURED</th>
                  <th className="font-normal py-1"></th>
                </tr>
              </thead>
              <tbody>
                {TRENDS.map((r) => (
                  <tr key={r.id} className="border-t border-white/5 hover:bg-white/5">
                    <td className="py-2 pr-2 text-[#b8b8b8]">{r.platform}</td>
                    <td className="py-2 pr-2 text-white">{r.topic}</td>
                    <td className="py-2 pr-2 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <div className="w-20 h-1.5 bg-white/10 relative">
                          <div className="absolute inset-y-0 left-0" style={{ width: `${r.viability}%`, background: r.viability > 85 ? accent : r.viability > 70 ? '#f59e0b' : '#545454' }} />
                        </div>
                        <span className="tabular-nums text-white w-8 text-right">{r.viability}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      <span style={{ color: r.sentiment > 0.3 ? '#10b981' : r.sentiment < 0 ? '#ef4444' : '#f59e0b' }}>
                        {r.sentiment > 0 ? '+' : ''}{r.sentiment.toFixed(2)}
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-right" style={{ color: r.delta.startsWith('+') ? '#10b981' : '#ef4444' }}>{r.delta}</td>
                    <td className="py-2 pr-2 text-[#545454]">{r.captured}</td>
                    <td className="py-2">
                      <button className="text-[9px] border border-white/10 px-1.5 py-0.5 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e]">INGEST ▸</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel label="PLATFORM MIX">
        <div className="flex flex-col gap-3">
          {['TIKTOK', 'X / TWITTER', 'REDDIT', 'YOUTUBE', 'NEWS RSS'].map((p, i) => {
            const v = [42, 31, 18, 7, 2][i];
            return (
              <div key={p}>
                <div className="flex justify-between text-[10px] font-mono mb-1">
                  <span className="text-[#b8b8b8]">{p}</span>
                  <span className="tabular-nums text-white">{v}%</span>
                </div>
                <div className="h-2 bg-white/5 relative">
                  <div className="absolute inset-y-0 left-0" style={{ width: `${v}%`, background: accent }} />
                </div>
              </div>
            );
          })}
          <div className="mt-4 pt-3 border-t border-white/10">
            <Label className="text-[#545454]">SENTIMENT HEAT</Label>
            <div className="grid grid-cols-7 gap-0.5 mt-2">
              {Array.from({ length: 49 }).map((_, i) => {
                const v = hRand(`h${i}`) * 2 - 1;
                const c = v > 0.3 ? '#10b981' : v < -0.2 ? '#ef4444' : '#f59e0b';
                return <div key={i} className="aspect-square" style={{ background: c, opacity: 0.2 + Math.abs(v) * 0.6 }} />;
              })}
            </div>
            <div className="flex justify-between text-[9px] font-mono text-[#545454] mt-1">
              <span>-1.0</span><span>+1.0</span>
            </div>
          </div>
        </div>
      </Panel>
      <DemoBadge label={DEMO_NOTE} />
    </div>
  );
}
