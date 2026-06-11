// Archives — Sentinel digest archive browser. Live data from the bridge:
// /api/sentinel/archive (index) + /api/sentinel/digest/<date> (stories).
import { useEffect, useState } from 'react';
import { Panel, Label } from '../components/cyberpunk/ui';
import {
  getSentinelArchive, getSentinelDigestByDate, errMessage,
  type SentinelArchiveEntry, type SentinelDigest,
} from '../lib/api';

const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;

export default function Archives() {
  const [entries, setEntries] = useState<SentinelArchiveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  // Keyed by date so "loading" is derived (selected !== loaded date) instead of
  // a synchronous setState in the fetch effect (react-hooks/set-state-in-effect).
  const [loaded, setLoaded] = useState<{ date: string; digest: SentinelDigest | null; error: string | null } | null>(null);

  useEffect(() => {
    let alive = true;
    getSentinelArchive()
      .then((a) => {
        if (!alive) return;
        const list = a.digests ?? [];
        setEntries(list);
        setError(null);
        if (list.length > 0) setSelected(list[0].date);
      })
      .catch((e) => { if (alive) setError(errMessage(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    getSentinelDigestByDate(selected)
      .then((d) => { if (alive) setLoaded({ date: selected, digest: d, error: null }); })
      .catch((e) => { if (alive) setLoaded({ date: selected, digest: null, error: errMessage(e) }); });
    return () => { alive = false; };
  }, [selected]);

  const digestLoading = !!selected && loaded?.date !== selected;
  const digest = !digestLoading ? loaded?.digest ?? null : null;
  const digestError = !digestLoading ? loaded?.error ?? null : null;
  const stories = digest?.stories ?? [];
  const maxScore = stories.length ? Math.max(...stories.map((s) => s.score)) : 0;

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-2 p-2 relative">
      <Panel label="ARCHIVE INDEX" right={`${entries.length} digests`}>
        <div className="flex flex-col gap-0.5 text-[10px] font-mono overflow-auto h-full">
          {loading && <div className="px-2 py-1 text-[#545454]">loading archive…</div>}
          {!loading && error && <div className="px-2 py-1 text-red-400">bridge error · {error}</div>}
          {!loading && !error && entries.length === 0 && (
            <div className="px-2 py-1 text-[#545454]">
              no archived digests yet — Sentinel writes one per day after its first run
            </div>
          )}
          {entries.map((e) => {
            const is = e.date === selected;
            return (
              <button
                key={e.date}
                onClick={() => setSelected(e.date)}
                className={`flex justify-between px-2 py-1 text-left cursor-pointer ${
                  is ? 'bg-[#f64e6e]/10 text-[#f64e6e]' : 'hover:bg-white/5 text-[#b8b8b8] hover:text-white'
                }`}
              >
                <span>{is ? '▸ ' : '  '}{e.date}</span>
                <span className={`tabular-nums ${is ? 'text-[#f64e6e]/70' : 'text-[#545454]'}`}>{fmtSize(e.size)}</span>
              </button>
            );
          })}
        </div>
      </Panel>

      <div className="flex flex-col gap-2 min-h-0">
        <Panel label="DIGEST META" className="h-[100px] shrink-0" right={selected ?? undefined}>
          {!selected && <div className="text-[10px] font-mono text-[#545454]">select a digest from the archive index</div>}
          {selected && (
            <div className="grid grid-cols-3 gap-3 h-full">
              <div>
                <Label className="text-[#545454]">STORIES</Label>
                <div className="text-[13px] font-mono font-bold text-white tabular-nums mt-1">
                  {digestLoading ? '…' : digest?.total_stories ?? stories.length}
                </div>
              </div>
              <div>
                <Label className="text-[#545454]">SOURCES</Label>
                <div className="text-[13px] font-mono font-bold text-white tabular-nums mt-1">
                  {digestLoading ? '…' : digest?.sources?.length ?? '—'}
                </div>
              </div>
              <div className="min-w-0">
                <Label className="text-[#545454]">GENERATED</Label>
                <div className="text-[11px] font-mono text-[#b8b8b8] mt-1 truncate">
                  {digestLoading ? '…' : digest?.generated_at ?? '—'}
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel label={selected ? `STORIES · ${selected}` : 'STORIES'} right={stories.length ? `${stories.length} rows` : undefined}>
          <div className="overflow-auto h-full">
            {digestLoading && (
              <div className="h-full flex items-center justify-center text-[11px] font-mono text-[#545454]">
                loading digest…
              </div>
            )}
            {!digestLoading && digestError && (
              <div className="h-full flex items-center justify-center text-[11px] font-mono text-red-400">
                failed to load digest · {digestError}
              </div>
            )}
            {!digestLoading && !digestError && !selected && (
              <div className="h-full flex items-center justify-center text-[11px] font-mono text-[#545454]">
                no digest selected
              </div>
            )}
            {!digestLoading && !digestError && selected && stories.length === 0 && (
              <div className="h-full flex items-center justify-center text-[11px] font-mono text-[#545454]">
                digest has no stories
              </div>
            )}
            {!digestLoading && !digestError && stories.length > 0 && (
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="text-[#545454] text-left">
                    <th className="font-normal py-1 pr-3">#</th>
                    <th className="font-normal py-1 pr-3">TITLE</th>
                    <th className="font-normal py-1 pr-3">SOURCE</th>
                    <th className="font-normal py-1 pr-3 text-right">SCORE</th>
                    <th className="font-normal py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {stories.map((s, i) => (
                    <tr key={`${s.url}-${i}`} className="border-t border-white/5 hover:bg-white/5">
                      <td className="py-1.5 pr-3 text-[#545454] tabular-nums">{i + 1}</td>
                      <td className="py-1.5 pr-3 text-white">
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-[#f64e6e]">{s.title}</a>
                        ) : s.title}
                      </td>
                      <td className="py-1.5 pr-3 text-[#b8b8b8]">{s.source}</td>
                      <td className="py-1.5 pr-3 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <div className="w-16 h-1.5 bg-white/10 relative">
                            <div
                              className="absolute inset-y-0 left-0"
                              style={{
                                width: `${maxScore ? Math.min(100, (s.score / maxScore) * 100) : 0}%`,
                                background: s.score >= maxScore * 0.85 ? '#f64e6e' : s.score >= maxScore * 0.5 ? '#f59e0b' : '#545454',
                              }}
                            />
                          </div>
                          <span className="tabular-nums text-white w-8 text-right">{Math.round(s.score)}</span>
                        </div>
                      </td>
                      <td className="py-1.5">
                        {s.url ? (
                          <a
                            href={s.url} target="_blank" rel="noreferrer"
                            className="text-[10px] border border-white/10 px-1.5 py-0.5 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e]"
                          >OPEN ▸</a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
