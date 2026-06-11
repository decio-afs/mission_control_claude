// Content Factory — live content pipeline fed from Hermes kanban tasks, the
// planned-post calendar (Ayrshare-ready), and Apify creator viral signals.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Panel, Pill, CornerBrackets, Stat } from '../components/cyberpunk/ui';
import { useContentStore } from '../stores/useContentStore';
import {
  addCalendarItem, getCreators, watchCreator, scrapeCreators, errMessage,
  type CreatorsResponse,
} from '../lib/api';

const statusTone: Record<string, 'good' | 'warn' | 'info' | 'neutral' | 'bad'> = {
  ready: 'good',
  running: 'info',
  done: 'neutral',
  blocked: 'warn',
  failed: 'bad',
};

const statusColor: Record<string, string> = {
  ready: '#10b981',
  running: '#38bdf8',
  done: '#b8b8b8',
  blocked: '#f59e0b',
  failed: '#ef4444',
};

function formatDate(d: string) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ContentFactory() {
  const { campaigns, drafts, calendar, isLoading, error, lastSync, refresh } = useContentStore();

  useEffect(() => {
    refresh();
    const id = setInterval(() => refresh(), 30000);
    return () => clearInterval(id);
  }, [refresh]);

  const summary = useMemo(() => {
    const total = campaigns.length;
    const done = campaigns.filter((c) => c.status === 'done').length;
    const running = campaigns.filter((c) => c.status === 'running').length;
    const ready = campaigns.filter((c) => c.status === 'ready').length;
    const blocked = campaigns.filter((c) => c.status === 'blocked').length;
    return { total, done, running, ready, blocked };
  }, [campaigns]);

  const upcoming = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    // Explicitly planned posts outrank kanban-derived dates for the 7 slots.
    return [...calendar]
      .filter((c) => c.date >= today)
      .sort((a, b) => Number(Boolean((b as { planned?: boolean }).planned)) - Number(Boolean((a as { planned?: boolean }).planned)) || a.date.localeCompare(b.date))
      .slice(0, 7);
  }, [calendar]);

  // ── Plan-post form (local calendar store; Ayrshare scheduling when keyed) ──
  const [pTitle, setPTitle] = useState('');
  const [pDate, setPDate] = useState('');
  const [pPlatform, setPPlatform] = useState('instagram');
  const [planBusy, setPlanBusy] = useState(false);
  const [planMsg, setPlanMsg] = useState<string | null>(null);

  const handlePlan = async (publish: boolean) => {
    if (!pTitle.trim() || !pDate || planBusy) return;
    setPlanBusy(true);
    setPlanMsg(null);
    try {
      const r = await addCalendarItem({ title: pTitle.trim(), date: pDate, platform: pPlatform, publish });
      setPTitle('');
      setPlanMsg(publish ? `pushed to Buffer Ideas ✓ (${r.item.buffer_id ?? r.item.status})` : 'planned ✓');
      await refresh();
    } catch (e) {
      setPlanMsg(`failed: ${errMessage(e)}`);
    } finally {
      setPlanBusy(false);
    }
  };

  // ── Viral signals — Apify creator watchlist + ranked feed ──
  const [creators, setCreators] = useState<CreatorsResponse | null>(null);
  const [wHandle, setWHandle] = useState('');
  const [wPlatform, setWPlatform] = useState('instagram');
  const [scraping, setScraping] = useState(false);
  const [creatorMsg, setCreatorMsg] = useState<string | null>(null);

  const loadCreators = useCallback(() => {
    getCreators().then(setCreators).catch(() => setCreators(null));
  }, []);
  useEffect(() => { loadCreators(); }, [loadCreators]);

  const handleWatch = async () => {
    if (!wHandle.trim()) return;
    try {
      await watchCreator(wHandle.trim(), wPlatform);
      setWHandle('');
      loadCreators();
    } catch (e) {
      setCreatorMsg(errMessage(e));
    }
  };

  const handleScrape = async () => {
    if (scraping) return;
    setScraping(true);
    setCreatorMsg('Apify actors running — this takes 1-4 min…');
    try {
      const feed = await scrapeCreators();
      setCreatorMsg(feed.errors?.length ? `done with errors: ${feed.errors[0]}` : `scraped ${feed.items.length} posts ✓`);
      loadCreators();
    } catch (e) {
      setCreatorMsg(errMessage(e));
    } finally {
      setScraping(false);
    }
  };

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-2 p-2 relative overflow-y-auto">
      {/* Main column */}
      <div className="flex flex-col gap-2 min-h-0">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Panel noPad className="p-2">
            <Stat label="CAMPAIGNS" value={summary.total} tone="brand" big />
          </Panel>
          <Panel noPad className="p-2">
            <Stat label="READY" value={summary.ready} tone="good" big />
          </Panel>
          <Panel noPad className="p-2">
            <Stat label="RUNNING" value={summary.running} tone="info" big />
          </Panel>
          <Panel noPad className="p-2">
            <Stat label="DONE" value={summary.done} tone="white" big />
          </Panel>
          <Panel noPad className="p-2">
            <Stat label="BLOCKED" value={summary.blocked} tone="warn" big />
          </Panel>
        </div>

        {/* Campaigns */}
        <Panel
          label="ACTIVE CAMPAIGNS"
          right={
            <div className="flex items-center gap-2">
              {isLoading && <span className="text-sky-400 animate-pulse">● SYNCING</span>}
              {lastSync && (
                <span className="text-[#545454]">
                  {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              )}
              <button
                onClick={() => refresh()}
                className="text-[10px] font-mono text-[#b8b8b8] border border-white/10 px-2 py-0.5 hover:text-white hover:border-white/30 transition-colors"
              >
                REFRESH
              </button>
            </div>
          }
        >
          {error ? (
            <div className="text-red-400 font-mono text-xs">{error}</div>
          ) : campaigns.length === 0 ? (
            <div className="text-[#545454] font-mono text-xs">No content campaigns found in Hermes tasks.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {campaigns.map((c) => (
                <div
                  key={c.id}
                  className="p-3 border border-white/10 bg-[#080808] relative overflow-hidden"
                >
                  <div className="flex justify-between items-start mb-2">
                    <Pill tone={statusTone[c.status] || 'neutral'}>{c.platform}</Pill>
                    <span
                      className="text-[10px] font-mono uppercase tracking-widest"
                      style={{ color: statusColor[c.status] || '#b8b8b8' }}
                    >
                      {c.status}
                    </span>
                  </div>
                  <div className="text-sm text-white font-medium truncate">{c.title}</div>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-[10px] font-mono text-[#545454]">{c.assignee}</span>
                    <span className="text-[10px] font-mono text-[#545454]">P{c.priority}</span>
                  </div>
                  <CornerBrackets color="rgba(246,78,110,0.15)" />
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Draft Queue */}
        <Panel label="DRAFT QUEUE">
          {drafts.length === 0 ? (
            <div className="text-[#545454] font-mono text-xs">No drafts in queue.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {drafts.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between p-2 border border-white/5 bg-[#080808] hover:border-white/10 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: statusColor[d.status] || '#b8b8b8', boxShadow: `0 0 6px ${statusColor[d.status] || '#b8b8b8'}` }}
                    />
                    <span className="text-xs text-white truncate">{d.title}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] font-mono text-[#545454]">{d.assignee}</span>
                    <Pill tone={statusTone[d.status] || 'neutral'}>{d.platform}</Pill>
                    <span className="text-[10px] font-mono text-[#545454]">P{d.priority}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Sidebar */}
      <div className="flex flex-col gap-2 min-h-0">
        {/* Calendar */}
        <Panel
          label="CONTENT CALENDAR"
          right={<span className="text-[#545454]">UPCOMING</span>}
        >
          {/* Plan a post — stored locally; scheduled to socials via Buffer once BUFFER_ACCESS_TOKEN is set */}
          <div className="flex flex-col gap-1.5 mb-3">
            <input value={pTitle} onChange={(e) => setPTitle(e.target.value)} placeholder="plan a post — title / hook…"
              className="bg-[#050505] border border-white/10 px-2 py-1.5 text-[11px] font-mono text-white focus:border-[#f64e6e]/50 outline-none" />
            <div className="flex gap-1.5">
              <input type="date" value={pDate} onChange={(e) => setPDate(e.target.value)}
                className="flex-1 bg-[#050505] border border-white/10 px-2 py-1 text-[10px] font-mono text-[#b8b8b8] outline-none" />
              <select value={pPlatform} onChange={(e) => setPPlatform(e.target.value)}
                className="bg-[#050505] border border-white/10 px-1 py-1 text-[10px] font-mono text-[#b8b8b8] outline-none">
                {['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button onClick={() => void handlePlan(false)} disabled={planBusy || !pTitle.trim() || !pDate}
                className="text-[10px] font-mono border border-white/10 text-[#b8b8b8] px-2 py-1 hover:border-[#f64e6e] hover:text-[#f64e6e] disabled:opacity-30">
                {planBusy ? '…' : '+ PLAN'}
              </button>
              <button onClick={() => void handlePlan(true)} disabled={planBusy || !pTitle.trim() || !pDate}
                title="Plan locally AND push to Buffer Ideas"
                className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] px-2 py-1 hover:bg-[#f64e6e]/20 disabled:opacity-30">
                {planBusy ? '…' : '→ BUFFER'}
              </button>
            </div>
            {planMsg && <div className="font-mono text-[10px] text-sky-400">▸ {planMsg}</div>}
          </div>

          {upcoming.length === 0 ? (
            <div className="text-[#545454] font-mono text-xs">No upcoming items — plan one above.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {upcoming.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-2 border border-white/5 bg-[#080808]"
                >
                  <div className="w-12 text-center shrink-0">
                    <div className="text-[10px] font-mono text-[#545454]">{formatDate(item.date)}</div>
                  </div>
                  <div className="w-px h-6 bg-white/10" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white truncate">{item.title}</div>
                  </div>
                  <Pill tone={statusTone[item.status] || 'neutral'}>{item.platform}</Pill>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Viral signals — niche creators scraped via Apify, ranked by engagement */}
        <Panel
          label="VIRAL SIGNALS · CREATOR INTEL"
          className="flex-1 min-h-[260px]"
          right={
            <button onClick={() => void handleScrape()} disabled={scraping || !creators?.watchlist.length}
              title={creators?.configured === false ? 'Set APIFY_API_TOKEN in ~/.hermes/.env first' : 'Scrape the watchlist now'}
              className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] px-2 py-0.5 hover:bg-[#f64e6e]/20 disabled:opacity-30">
              {scraping ? 'SCRAPING…' : '▷ SCRAPE'}
            </button>
          }
          bodyClass="overflow-y-auto"
        >
          {creators?.configured === false && (
            <div className="font-mono text-[10px] text-amber-400 border border-amber-400/30 bg-amber-400/5 px-2 py-1.5 mb-2">
              ⚠ APIFY_API_TOKEN not set — add it to ~/.hermes/.env, restart the bridge, and scraping goes live.
            </div>
          )}
          <div className="flex gap-1.5 mb-2">
            <input value={wHandle} onChange={(e) => setWHandle(e.target.value)} placeholder="@creator to watch…"
              onKeyDown={(e) => { if (e.key === 'Enter') void handleWatch(); }}
              className="flex-1 min-w-0 bg-[#050505] border border-white/10 px-2 py-1 text-[10px] font-mono text-white focus:border-[#f64e6e]/50 outline-none" />
            <select value={wPlatform} onChange={(e) => setWPlatform(e.target.value)}
              className="bg-[#050505] border border-white/10 px-1 py-1 text-[10px] font-mono text-[#b8b8b8] outline-none">
              <option value="instagram">IG</option>
              <option value="tiktok">TT</option>
            </select>
            <button onClick={() => void handleWatch()} disabled={!wHandle.trim()}
              className="text-[10px] font-mono border border-white/10 text-[#b8b8b8] px-2 hover:border-[#f64e6e] hover:text-[#f64e6e] disabled:opacity-30">+ WATCH</button>
          </div>
          {creators && creators.watchlist.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {creators.watchlist.map((w) => (
                <span key={`${w.platform}/${w.handle}`} className="font-mono text-[10px] px-1.5 py-0.5 border border-white/10 text-[#b8b8b8]">
                  @{w.handle} · {w.platform === 'instagram' ? 'IG' : 'TT'}
                </span>
              ))}
            </div>
          )}
          {creatorMsg && <div className="font-mono text-[10px] text-sky-400 mb-2">▸ {creatorMsg}</div>}
          {!creators?.feed.items.length ? (
            <div className="text-[#545454] font-mono text-xs">
              No signals yet — watch creators in your niche, then SCRAPE. Top engagement posts land here
              for the agents to remix into tailored content.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {creators.feed.scraped_at && (
                <div className="font-mono text-[10px] text-[#545454]">scraped {new Date(creators.feed.scraped_at).toLocaleString()}</div>
              )}
              {creators.feed.items.slice(0, 12).map((p, i) => (
                <a key={i} href={p.url} target="_blank" rel="noreferrer"
                  className="block p-2 border border-white/5 bg-[#080808] hover:border-[#f64e6e]/40 transition-colors">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-mono text-[10px] text-[#f64e6e]">@{p.creator} · {p.platform === 'instagram' ? 'IG' : 'TT'}</span>
                    <span className="font-mono text-[10px] text-amber-400 shrink-0">⚡ {p.viral_score.toLocaleString()}</span>
                  </div>
                  <div className="text-[11px] text-[#b8b8b8] line-clamp-2">{p.caption || '(no caption)'}</div>
                  <div className="font-mono text-[10px] text-[#545454] mt-1">
                    {p.likes.toLocaleString()} likes · {p.comments.toLocaleString()} comments{p.views ? ` · ${p.views.toLocaleString()} views` : ''}
                  </div>
                </a>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
