// Intel Deck — creator/trend intel. Live data from the Apify creator pipeline
// (/api/creators): watchlist + scraped post feed ranked by viral score.
import { useEffect, useMemo, useState } from 'react';
import { Panel, Label } from '../components/cyberpunk/ui';
import { getCreators, errMessage, type CreatorsResponse, type CreatorPost } from '../lib/api';

const accent = '#f64e6e';

const fmtNum = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

interface CreatorAgg {
  creator: string;
  platform: string;
  posts: number;
  topScore: number;
  views: number;
}

export default function IntelligenceDeck() {
  const [data, setData] = useState<CreatorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getCreators()
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(errMessage(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const feed = useMemo<CreatorPost[]>(
    () => [...(data?.feed?.items ?? [])].sort((a, b) => b.viral_score - a.viral_score),
    [data],
  );

  const byCreator = useMemo<CreatorAgg[]>(() => {
    const m = new Map<string, CreatorAgg>();
    feed.forEach((p) => {
      const k = `${p.platform}:${p.creator}`;
      const cur = m.get(k) ?? { creator: p.creator, platform: p.platform, posts: 0, topScore: 0, views: 0 };
      cur.posts += 1;
      cur.topScore = Math.max(cur.topScore, p.viral_score);
      cur.views += p.views || 0;
      m.set(k, cur);
    });
    return [...m.values()].sort((a, b) => b.topScore - a.topScore);
  }, [feed]);

  const platformMix = useMemo(() => {
    const m = new Map<string, number>();
    feed.forEach((p) => m.set(p.platform, (m.get(p.platform) ?? 0) + 1));
    return [...m.entries()]
      .map(([platform, n]) => ({ platform, pct: feed.length ? Math.round((n / feed.length) * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct);
  }, [feed]);

  const topScore = feed.length ? Math.max(...feed.map((p) => p.viral_score)) : 0;
  const totalViews = feed.reduce((s, p) => s + (p.views || 0), 0);
  // Persisted scrape errors (per-platform Apify failures / dropped-old counts).
  // Without surfacing these, a failed or partial scrape is indistinguishable
  // from a never-run one — the empty state below would tell the operator to
  // "run a scrape" they already ran.
  const scrapeErrors = data?.feed?.errors ?? [];

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-2 p-2 relative">
      <div className="flex flex-col gap-2 min-h-0">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 shrink-0">
          {[
            { k: 'POSTS CAPTURED', v: feed.length.toLocaleString(), c: '#b8b8b8' },
            { k: 'TOP VIRAL SCORE', v: topScore ? topScore.toFixed(1) : '—', c: accent },
            { k: 'WATCHLIST', v: (data?.watchlist?.length ?? 0).toLocaleString(), c: '#10b981' },
            { k: 'TOTAL VIEWS', v: totalViews ? fmtNum(totalViews) : '—', c: '#38bdf8' },
          ].map((s) => (
            <Panel key={s.k} label={s.k} className="h-[70px]">
              <div className="text-2xl font-mono font-bold tabular-nums" style={{ color: s.c }}>{s.v}</div>
              <div className="text-[10px] font-mono text-[#545454]">
                {data?.feed?.scraped_at ? `scraped ${data.feed.scraped_at}` : 'last scrape'}
              </div>
            </Panel>
          ))}
        </div>

        <Panel label="VIRAL FEED · RANKED BY SCORE" right={data?.feed?.scraped_at ? `scraped ${data.feed.scraped_at}` : undefined}>
          <div className="overflow-auto h-full">
            {!loading && !error && scrapeErrors.length > 0 && (
              <div className="mb-2 border border-[#f59e0b]/40 bg-[#f59e0b]/5 px-2 py-1.5 text-[10px] font-mono text-[#f59e0b]">
                <div className="font-bold mb-0.5">
                  ⚠ LAST SCRAPE REPORTED {scrapeErrors.length} ISSUE{scrapeErrors.length === 1 ? '' : 'S'}
                </div>
                {scrapeErrors.map((e, i) => (
                  <div key={i} className="text-[#f59e0b]/80 truncate" title={e}>· {e}</div>
                ))}
              </div>
            )}
            {loading && (
              <div className="h-full flex items-center justify-center text-[11px] font-mono text-[#545454]">
                loading creator intel…
              </div>
            )}
            {!loading && error && (
              <div className="h-full flex items-center justify-center text-[11px] font-mono text-red-400">
                bridge error · {error}
              </div>
            )}
            {!loading && !error && feed.length === 0 && scrapeErrors.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-[11px] font-mono text-[#545454]">
                <span className="text-[13px] opacity-40">⊘</span>
                <span>no creator intel yet</span>
                <span className="text-[10px] text-[#363636]">
                  add creators to the watchlist in Content Factory's VIRAL SIGNALS panel, then run a scrape
                </span>
              </div>
            )}
            {!loading && !error && feed.length > 0 && (
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="text-[#545454] text-left">
                    <th className="font-normal py-1 pr-2">PLATFORM</th>
                    <th className="font-normal py-1 pr-2">CREATOR</th>
                    <th className="font-normal py-1 pr-2">CAPTION</th>
                    <th className="font-normal py-1 pr-2 text-right">SCORE</th>
                    <th className="font-normal py-1 pr-2 text-right">LIKES</th>
                    <th className="font-normal py-1 pr-2 text-right">CMNT</th>
                    <th className="font-normal py-1 pr-2 text-right">VIEWS</th>
                    <th className="font-normal py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {feed.map((p, i) => (
                    <tr key={`${p.url}-${i}`} className="border-t border-white/5 hover:bg-white/5">
                      <td className="py-2 pr-2 text-[#b8b8b8] uppercase">{p.platform}</td>
                      <td className="py-2 pr-2 text-white whitespace-nowrap">@{p.creator}</td>
                      <td className="py-2 pr-2 text-[#b8b8b8] max-w-[280px] truncate" title={p.caption}>{p.caption || '—'}</td>
                      <td className="py-2 pr-2 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <div className="w-20 h-1.5 bg-white/10 relative">
                            <div
                              className="absolute inset-y-0 left-0"
                              style={{
                                width: `${topScore ? Math.min(100, (p.viral_score / topScore) * 100) : 0}%`,
                                background: p.viral_score >= topScore * 0.85 ? accent : p.viral_score >= topScore * 0.5 ? '#f59e0b' : '#545454',
                              }}
                            />
                          </div>
                          <span className="tabular-nums text-white w-10 text-right">{p.viral_score.toFixed(1)}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums text-[#b8b8b8]">{fmtNum(p.likes || 0)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-[#b8b8b8]">{fmtNum(p.comments || 0)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-[#b8b8b8]">{fmtNum(p.views || 0)}</td>
                      <td className="py-2">
                        {p.url ? (
                          <a
                            href={p.url} target="_blank" rel="noreferrer"
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

      <Panel label="CREATOR BREAKDOWN">
        <div className="flex flex-col gap-3 overflow-auto h-full">
          {byCreator.length === 0 && !loading && (
            <div className="text-[10px] font-mono text-[#545454]">
              {data?.watchlist?.length
                ? 'watchlist set — no scraped posts yet'
                : 'watchlist empty — add creators in Content Factory'}
            </div>
          )}
          {byCreator.map((c) => {
            const pct = topScore ? Math.min(100, Math.round((c.topScore / topScore) * 100)) : 0;
            return (
              <div key={`${c.platform}:${c.creator}`}>
                <div className="flex justify-between text-[10px] font-mono mb-1">
                  <span className="text-[#b8b8b8] truncate">@{c.creator} · {c.platform.toUpperCase()}</span>
                  <span className="tabular-nums text-white shrink-0">{c.topScore.toFixed(1)}</span>
                </div>
                <div className="h-2 bg-white/5 relative">
                  <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: accent }} />
                </div>
                <div className="text-[10px] font-mono text-[#545454] mt-0.5">
                  {c.posts} post{c.posts === 1 ? '' : 's'} · {fmtNum(c.views)} views
                </div>
              </div>
            );
          })}

          {platformMix.length > 0 && (
            <div className="mt-2 pt-3 border-t border-white/10">
              <Label className="text-[#545454]">PLATFORM MIX</Label>
              <div className="flex flex-col gap-2 mt-2">
                {platformMix.map((p) => (
                  <div key={p.platform}>
                    <div className="flex justify-between text-[10px] font-mono mb-1">
                      <span className="text-[#b8b8b8] uppercase">{p.platform}</span>
                      <span className="tabular-nums text-white">{p.pct}%</span>
                    </div>
                    <div className="h-2 bg-white/5 relative">
                      <div className="absolute inset-y-0 left-0" style={{ width: `${p.pct}%`, background: '#38bdf8' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(data?.watchlist?.length ?? 0) > 0 && (
            <div className="mt-2 pt-3 border-t border-white/10">
              <Label className="text-[#545454]">WATCHLIST</Label>
              <div className="mt-2 flex flex-col gap-1">
                {data!.watchlist.map((w) => (
                  <div key={`${w.platform}:${w.handle}`} className="text-[10px] font-mono text-[#b8b8b8] flex items-center gap-1">
                    <span className="w-1 h-1 bg-[#ff795e]" />@{w.handle} · {w.platform.toUpperCase()}{w.niche ? ` · ${w.niche}` : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
