// Content Factory — live content pipeline fed from Mc kanban tasks, the
// planned-post calendar (Metricool auto-posting via its MCP), and Apify
// creator viral signals.
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Panel, Pill, CornerBrackets, Stat } from '../components/cyberpunk/ui';
import { useContentStore } from '../stores/useContentStore';
import { useGhostStore } from '../stores/useGhostStore';
import TaskDetailDrawer from '../components/TaskDetailDrawer';
import {
  addCalendarItem, getCreators, watchCreator, scrapeCreators, errMessage,
  getContentIdeas, generateContentIdeas, createMcTask,
  consumeContentIdea, skipContentIdea,
  uploadContentMedia, attachCalendarMedia, scheduleCalendarItem,
  predictCalendarVirality, getMetricoolBrands, syncMetricoolBrands,
  getContentChannels, setContentChannels,
  type CreatorsResponse, type ContentIdeas, type MetricoolBrands, type ContentChannels,
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
  const nodes = useGhostStore((s) => s.nodes);

  useEffect(() => {
    refresh();
    const id = setInterval(() => refresh(), 30000);
    return () => clearInterval(id);
  }, [refresh]);

  // A content card IS a kanban task — clicking it opens the same detail/control
  // slide-over the Operations Center uses, so a finished task's deliverable
  // (result / summary / runs / worker log) is finally readable from the Factory.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const profiles = useMemo(() => {
    const set = new Set<string>();
    nodes.filter((n) => n.type !== 'squad').forEach((n) => set.add(n.name));
    campaigns.forEach((c) => { if (c.assignee && c.assignee !== 'unassigned') set.add(c.assignee); });
    return [...set].sort();
  }, [nodes, campaigns]);
  const allTasks = useMemo(() => campaigns.map((c) => ({ id: c.id, title: c.title })), [campaigns]);

  const summary = useMemo(() => {
    const total = campaigns.length;
    const done = campaigns.filter((c) => c.status === 'done').length;
    const running = campaigns.filter((c) => c.status === 'running').length;
    const ready = campaigns.filter((c) => c.status === 'ready').length;
    const blocked = campaigns.filter((c) => c.status === 'blocked').length;
    // FAILED is a real campaign status (the backend normalizes a `failed` task to
    // it, and the operator-facing FAIL button — iter #31 — can now drive a content
    // task there). Without this bucket a failed campaign was invisible in the
    // summary AND the breakdown stats stopped summing to `total` (e.g. 27 shown but
    // only 26 across done/running/ready/blocked). (BUGHUNT bucket-completeness lens)
    const failed = campaigns.filter((c) => c.status === 'failed').length;
    return { total, done, running, ready, blocked, failed };
  }, [campaigns]);

  const upcoming = useMemo(() => {
    // LOCAL today, not UTC. Every `c.date` is a LOCAL calendar date — the bridge
    // derives them with datetime.fromtimestamp/now() (local), and formatDate()
    // renders them local (`+ 'T00:00:00'`). `toISOString().slice(0,10)` gave the
    // UTC date instead, so for a negative-offset operator (UTC-7) every evening
    // after UTC ticked past midnight, today's planned posts were filtered out of
    // the UPCOMING list ~7h early — a hidden deliverable on the very surface meant
    // to show imminent content. Build the local YMD to match.
    const n = new Date();
    const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    // Explicitly planned posts outrank kanban-derived dates for the 7 slots.
    return [...calendar]
      .filter((c) => c.date >= today)
      .sort((a, b) => Number(Boolean((b as { planned?: boolean }).planned)) - Number(Boolean((a as { planned?: boolean }).planned)) || a.date.localeCompare(b.date))
      .slice(0, 7);
  }, [calendar]);

  // ── Plan-post form (local calendar store; Metricool scheduling on publish) ──
  const [pTitle, setPTitle] = useState('');
  const [pDate, setPDate] = useState('');
  const [pPlatform, setPPlatform] = useState('instagram');
  const [planBusy, setPlanBusy] = useState(false);
  const [planMsg, setPlanMsg] = useState<string | null>(null);

  // Connected Metricool profiles — constrains where posts can actually go.
  const [brands, setBrands] = useState<MetricoolBrands | null>(null);
  useEffect(() => { getMetricoolBrands().then(setBrands).catch(() => setBrands(null)); }, []);
  const handleSyncBrands = async () => {
    setPlanMsg('syncing connected accounts from Metricool… (LLM, ~1 min)');
    try {
      setBrands(await syncMetricoolBrands());
      setPlanMsg('Metricool accounts synced ✓');
    } catch (e) {
      setPlanMsg(errMessage(e));
    }
  };
  const connectedNetworks = useMemo(
    () => Object.keys(brands?.brands?.[0]?.networks ?? {}),
    [brands],
  );

  const handlePlan = async (publish: boolean) => {
    if (!pTitle.trim() || !pDate || planBusy) return;
    setPlanBusy(true);
    setPlanMsg(null);
    try {
      const r = await addCalendarItem({ title: pTitle.trim(), date: pDate, platform: pPlatform, publish });
      setPTitle('');
      setPlanMsg(publish ? `scheduled on Metricool ✓ (${r.item.scheduled_for ?? r.item.date}) — auto-publishes` : 'planned ✓');
      await refresh();
    } catch (e) {
      setPlanMsg(`failed: ${errMessage(e)}`);
    } finally {
      setPlanBusy(false);
    }
  };

  // ── Idea Engine — news × viral patterns × brand doc → ranked ideas ──
  const [ideas, setIdeas] = useState<ContentIdeas | null>(null);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [ideasMsg, setIdeasMsg] = useState<string | null>(null);
  const [ideaActionBusy, setIdeaActionBusy] = useState<string | null>(null);
  // Operator-selectable channels the Idea Engine targets (so it stops suggesting
  // platforms you don't use). Persisted via the bridge; REGENERATE applies them.
  const [channels, setChannels] = useState<ContentChannels | null>(null);

  useEffect(() => { getContentIdeas().then(setIdeas).catch(() => setIdeas(null)); }, []);
  useEffect(() => { getContentChannels().then(setChannels).catch(() => setChannels(null)); }, []);

  const toggleChannel = async (ch: string) => {
    if (!channels) return;
    const has = channels.enabled.includes(ch);
    const next = has ? channels.enabled.filter((c) => c !== ch) : [...channels.enabled, ch];
    if (next.length === 0) return; // keep at least one channel enabled
    const prev = channels;
    setChannels({ ...channels, enabled: next }); // optimistic
    try { setChannels(await setContentChannels(next)); }
    catch { setChannels(prev); }
  };

  const handleGenerateIdeas = async () => {
    if (ideasBusy) return;
    setIdeasBusy(true);
    setIdeasMsg(null);
    try {
      setIdeas(await generateContentIdeas());
    } catch (e) {
      setIdeasMsg(errMessage(e));
    } finally {
      setIdeasBusy(false);
    }
  };

  // Per-idea actions: plan it, schedule it on Metricool, or hand it to an agent.
  const ideaToCalendar = async (idea: { title: string; platform: string; hook: string }, publish: boolean) => {
    const key = `${idea.title}|${publish ? 'pub' : 'plan'}`;
    setIdeaActionBusy(key);
    try {
      const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      await addCalendarItem({ title: idea.title, date, platform: idea.platform || 'instagram', body: idea.hook, publish });
      const left = await consumeIdea(idea.title);
      setIdeasMsg((publish ? `"${idea.title.slice(0, 40)}" → scheduled on Metricool ✓` : `"${idea.title.slice(0, 40)}" planned for ${date} ✓`) + (left !== null ? ` · ${left} left in deck` : ''));
      await refresh();
    } catch (e) {
      setIdeasMsg(errMessage(e));
    } finally {
      setIdeaActionBusy(null);
    }
  };

  // Acting on an idea consumes it — the card leaves the deck (non-fatal if the
  // consume call itself hiccups; the action already succeeded).
  const consumeIdea = async (title: string): Promise<number | null> => {
    try {
      const r = await consumeContentIdea(title);
      setIdeas(r.deck);
      return r.deck.ideas?.length ?? 0;
    } catch {
      return null;
    }
  };

  // Skip = dislike. Card leaves instantly; the engine remembers the taste and
  // deals ONE fresh replacement idea from today's data (LLM, ~30-90s).
  const [dealing, setDealing] = useState(false);
  const skipIdea = async (title: string) => {
    if (dealing) return;
    // optimistic removal so the disliked card is gone immediately
    setIdeas((prev) => prev ? { ...prev, ideas: (prev.ideas ?? []).filter((i) => i.title !== title) } : prev);
    setDealing(true);
    setIdeasMsg('skipped — dealing a replacement idea from today\'s data…');
    try {
      const r = await skipContentIdea(title);
      setIdeas(r.deck);
      setIdeasMsg(`replacement dealt: "${r.replacement.title.slice(0, 50)}" ✓`);
    } catch (e) {
      setIdeasMsg(`skip saved, but replacement failed: ${errMessage(e)}`);
    } finally {
      setDealing(false);
    }
  };

  const ideaToTask = async (idea: { title: string; platform: string; format: string; hook: string; why_now: string; pattern_source: string }) => {
    const key = `${idea.title}|task`;
    setIdeaActionBusy(key);
    try {
      await createMcTask({
        title: `Produce content: ${idea.title}`,
        body: `Platform: ${idea.platform} · Format: ${idea.format}\nHook: ${idea.hook}\nWhy now: ${idea.why_now}\nPattern source: ${idea.pattern_source}\n\nDeliverable: final caption + script/copy ready to post, in the DA Agency / Agent Legion brand voice (see BRAND_STRATEGY.md).`,
        triage: true,
      });
      const left = await consumeIdea(idea.title);
      setIdeasMsg(`"${idea.title.slice(0, 40)}" → agent task created ✓ (triage)${left !== null ? ` · ${left} left in deck` : ''}`);
    } catch (e) {
      setIdeasMsg(errMessage(e));
    } finally {
      setIdeaActionBusy(null);
    }
  };

  // ── Calendar production flow: attach media in-dashboard, then book the
  //    post on Metricool (auto-publishes at the planned time). ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mediaFor, setMediaFor] = useState<string | null>(null);
  const [calBusy, setCalBusy] = useState<string | null>(null);
  const [calMsg, setCalMsg] = useState<string | null>(null);

  const onPickMedia = (itemId: string) => {
    setMediaFor(itemId);
    fileInputRef.current?.click();
  };

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !mediaFor) return;
    if (file.size > 120 * 1024 * 1024) { setCalMsg('file exceeds the 120 MB cap'); return; }
    setCalBusy(mediaFor);
    setCalMsg(`uploading ${file.name} (${Math.round(file.size / 1024 / 1024)} MB)…`);
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error('file read failed'));
        r.readAsDataURL(file);
      });
      const up = await uploadContentMedia(file.name, b64);
      await attachCalendarMedia(mediaFor, [up.media_id]);
      setCalMsg(`${file.name} attached ✓`);
      await refresh();
    } catch (err) {
      setCalMsg(errMessage(err));
    } finally {
      setCalBusy(null);
      setMediaFor(null);
    }
  };

  const scheduleItem = async (itemId: string) => {
    setCalBusy(itemId);
    setCalMsg('booking post on Metricool… (LLM hop, ~1 min)');
    try {
      const { item } = await scheduleCalendarItem(itemId);
      setCalMsg(`scheduled ✓ — auto-publishes ${item.scheduled_for ?? item.date}`);
      await refresh();
    } catch (err) {
      setCalMsg(errMessage(err)); // surfaces "brands not synced" / "platform not connected" guidance
    } finally {
      setCalBusy(null);
    }
  };

  const predictItem = async (itemId: string) => {
    setCalBusy(itemId);
    setCalMsg('running media through the Higgsfield virality predictor… (1-3 min)');
    try {
      const { item } = await predictCalendarVirality(itemId);
      const v = item.virality;
      setCalMsg(v ? `virality ${v.score ?? '?'}/100 · ${v.verdict} — ${v.hook_strength}` : 'prediction returned no data');
      await refresh();
    } catch (err) {
      setCalMsg(errMessage(err));
    } finally {
      setCalBusy(null);
    }
  };

  // 🎨 Carousel pipeline: agent writes copy AND generates slide images via the
  // Higgsfield MCP, then files the finished package on the calendar itself.
  const ideaToCarousel = async (idea: { title: string; platform: string; hook: string; why_now: string; pattern_source: string }) => {
    const key = `${idea.title}|car`;
    setIdeaActionBusy(key);
    try {
      const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      await createMcTask({
        title: `Produce carousel: ${idea.title}`,
        body: `Create a complete Instagram carousel for the DA Agency / Agent Legion brand (voice + positioning in BRAND_STRATEGY.md at the Mission Control repo root).\n\nIdea: ${idea.title}\nHook: ${idea.hook}\nWhy now: ${idea.why_now}\nPattern source: ${idea.pattern_source}\n\nSteps:\n1. Write the final caption (hook, body, CTA, hashtags) and slide-by-slide copy for 5-7 slides.\n2. Generate ONE image per slide with the Higgsfield MCP image tools — consistent style: premium cyberpunk, coral #f64e6e on near-black, bold typographic slides using the slide copy. Collect every hosted image URL.\n3. File the finished package on the Mission Control calendar by running exactly this in your terminal (fill in the real values, JSON-escape the caption):\n   curl -s -X POST http://localhost:8767/api/content/calendar -H "Content-Type: application/json" -d "{\\"title\\":\\"${idea.title.replace(/"/g, '')}\\",\\"date\\":\\"${date}\\",\\"platform\\":\\"instagram\\",\\"body\\":\\"<FINAL CAPTION>\\",\\"media_urls\\":[<IMAGE URLS>]}"\n4. Report the caption, the slide copy, and the calendar item id.`,
        triage: true,
      });
      const left = await consumeIdea(idea.title);
      setIdeasMsg(`"${idea.title.slice(0, 40)}" → carousel agent task created ✓ (copy + Higgsfield slides + auto-filed on calendar)${left !== null ? ` · ${left} left in deck` : ''}`);
    } catch (e) {
      setIdeasMsg(errMessage(e));
    } finally {
      setIdeaActionBusy(null);
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
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
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
          <Panel noPad className="p-2">
            <Stat label="FAILED" value={summary.failed} tone="bad" big />
          </Panel>
        </div>

        {/* IDEA ENGINE — the synthesis step: trending news × competitor viral
            patterns × BRAND_STRATEGY.md → this week's content strategy. */}
        <Panel
          label="IDEA ENGINE · NEWS × VIRAL × BRAND"
          className="shrink-0"
          right={
            <button onClick={() => void handleGenerateIdeas()} disabled={ideasBusy}
              className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] px-2 py-0.5 hover:bg-[#f64e6e]/20 disabled:opacity-40">
              {ideasBusy ? 'SYNTHESIZING…' : ideas?.available ? '↻ REGENERATE' : '▷ GENERATE STRATEGY'}
            </button>
          }
        >
          {channels && (
            <div className="flex flex-wrap items-center gap-1 mb-2">
              <span className="text-[10px] font-mono text-[#545454] mr-1">MY CHANNELS:</span>
              {channels.available.map((ch) => {
                const on = channels.enabled.includes(ch);
                return (
                  <button key={ch} onClick={() => void toggleChannel(ch)}
                    title={on ? `Ideas target ${ch} — click to drop it` : `Click to include ${ch} in idea generation`}
                    className={`text-[10px] font-mono px-1.5 py-0.5 border transition-colors ${on ? 'border-[#f64e6e]/50 bg-[#f64e6e]/10 text-[#f64e6e]' : 'border-white/10 text-[#545454] hover:border-white/30'}`}>
                    {on ? '✓ ' : ''}{ch}
                  </button>
                );
              })}
              <span className="text-[10px] font-mono text-[#545454] ml-1">— applies on REGENERATE</span>
            </div>
          )}
          {ideasBusy && (
            <div className="font-mono text-[11px] text-[#707070]">
              {'>'} fusing {ideas?.inputs?.viral_posts ?? 'scraped'} viral signals + trending AI news + brand strategy — 1-3 min…
            </div>
          )}
          {ideasMsg && <div className="font-mono text-[10px] text-sky-400 mb-2">▸ {ideasMsg}</div>}
          {!ideasBusy && !ideas?.available && (
            <div className="font-mono text-[11px] text-[#707070]">
              {'>'} This is where your content strategy gets made: GENERATE feeds the scraped viral
              signals (below), today's Sentinel AI news, and BRAND_STRATEGY.md into Mc and
              returns ranked ideas — each one can be planned, scheduled on Metricool, or handed to an agent.
            </div>
          )}
          {!ideasBusy && ideas?.available && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-[#707070]">
                  {ideas.generated_at ? new Date(ideas.generated_at).toLocaleString() : ''} · inputs: {ideas.inputs?.viral_posts ?? 0} viral · {ideas.inputs?.news_stories ?? 0} news · {ideas.inputs?.brand_doc ? 'brand doc ✓' : 'no brand doc'}
                </span>
              </div>
              {ideas.strategy_note && (
                <p className="text-[11px] text-[#b8b8b8] leading-relaxed border-l-2 border-[#f64e6e]/50 pl-3">{ideas.strategy_note}</p>
              )}
              {dealing && (
                <div className="font-mono text-[10px] text-amber-400 animate-pulse">↻ dealing a replacement idea from today's signals…</div>
              )}
              {(ideas.ideas?.length ?? 0) === 0 && !dealing && (
                <div className="font-mono text-[11px] text-[#707070]">
                  {'>'} deck empty — every idea was planned, produced, or skipped. ↻ REGENERATE deals a
                  fresh deck from today's signals (your skips are remembered as taste).
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {(ideas.ideas ?? []).map((idea, i) => (
                  <div key={i} className="p-2.5 border border-white/[0.07] bg-[#0b0b0d] flex flex-col gap-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[11px] text-white font-medium leading-snug">{idea.title}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Pill tone="brand">{idea.format}</Pill>
                        <button onClick={() => void skipIdea(idea.title)} disabled={dealing || ideaActionBusy !== null}
                          title="Skip — not my taste. The engine remembers and deals a fresh replacement idea."
                          className="text-[#707070] hover:text-red-400 text-[11px] font-mono leading-none disabled:opacity-30">✕</button>
                      </div>
                    </div>
                    <div className="text-[11px] text-[#b8b8b8]"><span className="font-mono text-[10px] text-[#f64e6e]">HOOK</span> {idea.hook}</div>
                    <div className="text-[10px] text-[#707070]"><span className="font-mono text-amber-400">NOW</span> {idea.why_now}</div>
                    <div className="text-[10px] text-[#707070] font-mono truncate" title={idea.pattern_source}>↻ {idea.pattern_source} · {idea.platform}</div>
                    <div className="grid grid-cols-2 gap-1.5 mt-1">
                      <button onClick={() => void ideaToCalendar(idea, false)} disabled={ideaActionBusy !== null}
                        className="text-[10px] font-mono border border-white/10 text-[#b8b8b8] py-1 hover:border-[#f64e6e] hover:text-[#f64e6e] disabled:opacity-30">
                        {ideaActionBusy === `${idea.title}|plan` ? '…' : '+ PLAN'}
                      </button>
                      <button onClick={() => void ideaToCalendar(idea, true)} disabled={ideaActionBusy !== null}
                        title="Schedule the raw idea on Metricool now (auto-publishes at the planned time)"
                        className="text-[10px] font-mono border border-white/10 text-[#b8b8b8] py-1 hover:border-[#f64e6e] hover:text-[#f64e6e] disabled:opacity-30">
                        {ideaActionBusy === `${idea.title}|pub` ? '…' : '→ METRICOOL'}
                      </button>
                      <button onClick={() => void ideaToTask(idea)} disabled={ideaActionBusy !== null}
                        title="Create a kanban task — an agent produces the final caption/script"
                        className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] py-1 hover:bg-[#f64e6e]/20 disabled:opacity-30">
                        {ideaActionBusy === `${idea.title}|task` ? '…' : '⚡ AGENT'}
                      </button>
                      <button onClick={() => void ideaToCarousel(idea)} disabled={ideaActionBusy !== null}
                        title="Agent writes the copy AND generates the slide images via Higgsfield, then files the finished package on the calendar"
                        className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] py-1 hover:bg-[#f64e6e]/20 disabled:opacity-30">
                        {ideaActionBusy === `${idea.title}|car` ? '…' : '🎨 SLIDES'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        {/* Campaigns — capped height with internal scrolling: all content stays
            reachable without the page growing 1000px+ tall. */}
        <Panel
          className="shrink-0 max-h-[58vh]"
          bodyClass="overflow-y-auto"
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
            <div className="text-[#545454] font-mono text-xs">No content campaigns found in Mc tasks.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {campaigns.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setOpenTaskId(c.id)}
                  title="Open task detail — read/copy the deliverable, runs, and worker log"
                  className={`text-left w-full p-3 border bg-[#080808] relative overflow-hidden transition-colors hover:border-[#f64e6e]/40 ${openTaskId === c.id ? 'border-[#f64e6e]' : 'border-white/10'}`}
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
                </button>
              ))}
            </div>
          )}
        </Panel>

        {/* Draft Queue — capped + self-scrolling, same as campaigns */}
        <Panel label="DRAFT QUEUE" className="shrink-0 max-h-[42vh]" bodyClass="overflow-y-auto">
          {drafts.length === 0 ? (
            <div className="text-[#545454] font-mono text-xs">No drafts in queue.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {drafts.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setOpenTaskId(d.id)}
                  title="Open task detail — read/copy the deliverable, runs, and worker log"
                  className={`w-full text-left flex items-center justify-between p-2 border bg-[#080808] transition-colors hover:border-[#f64e6e]/30 ${openTaskId === d.id ? 'border-[#f64e6e]' : 'border-white/5'}`}
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
                </button>
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
          className="shrink-0"
          right={<span className="text-[#545454]">UPCOMING</span>}
        >
          {/* Connected Metricool profiles — the only networks posts can go to */}
          {brands?.available && brands.brands?.[0] ? (
            <div className="font-mono text-[10px] text-[#707070] mb-2 flex items-center gap-2 flex-wrap">
              <span className="text-emerald-400">● {brands.brands[0].name}</span>
              {Object.entries(brands.brands[0].networks).map(([net, handle]) => (
                <span key={net} title={`@${handle}`}>{net}: <span className="text-[#b8b8b8]">@{handle}</span></span>
              ))}
            </div>
          ) : (
            <button onClick={() => void handleSyncBrands()}
              className="font-mono text-[10px] text-amber-400 border border-amber-400/30 bg-amber-400/5 px-2 py-1.5 mb-2 text-left hover:bg-amber-400/10 w-full">
              ⚠ Metricool accounts not synced — click to pull connected profiles via the MCP (~1 min)
            </button>
          )}
          {/* Plan a post — stored locally; → METRICOOL books it for auto-publishing */}
          <div className="flex flex-col gap-1.5 mb-3">
            <input value={pTitle} onChange={(e) => setPTitle(e.target.value)} placeholder="plan a post — title / hook…"
              className="bg-[#050505] border border-white/10 px-2 py-1.5 text-[11px] font-mono text-white focus:border-[#f64e6e]/50 outline-none" />
            <div className="flex gap-1.5">
              <input type="date" value={pDate} onChange={(e) => setPDate(e.target.value)}
                className="flex-1 bg-[#050505] border border-white/10 px-2 py-1 text-[10px] font-mono text-[#b8b8b8] outline-none" />
              <select value={pPlatform} onChange={(e) => setPPlatform(e.target.value)}
                className="bg-[#050505] border border-white/10 px-1 py-1 text-[10px] font-mono text-[#b8b8b8] outline-none">
                {(connectedNetworks.length ? connectedNetworks : ['instagram', 'threads', 'tiktok']).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button onClick={() => void handlePlan(false)} disabled={planBusy || !pTitle.trim() || !pDate}
                className="text-[10px] font-mono border border-white/10 text-[#b8b8b8] px-2 py-1 hover:border-[#f64e6e] hover:text-[#f64e6e] disabled:opacity-30">
                {planBusy ? '…' : '+ PLAN'}
              </button>
              <button onClick={() => void handlePlan(true)} disabled={planBusy || !pTitle.trim() || !pDate}
                title="Plan locally AND schedule on Metricool (auto-publishes at the planned time)"
                className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] px-2 py-1 hover:bg-[#f64e6e]/20 disabled:opacity-30">
                {planBusy ? '…' : '→ METRICOOL'}
              </button>
            </div>
            {planMsg && <div className="font-mono text-[10px] text-sky-400">▸ {planMsg}</div>}
            {calMsg && <div className="font-mono text-[10px] text-sky-400">▸ {calMsg}</div>}
            {/* shared hidden file input for per-item media attach */}
            <input ref={fileInputRef} type="file" accept="video/*,image/*" className="hidden" onChange={(e) => void onFileChosen(e)} />
          </div>

          {upcoming.length === 0 ? (
            <div className="text-[#545454] font-mono text-xs">No upcoming items — plan one above.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {upcoming.map((item) => (
                <div key={item.id} className="border border-white/5 bg-[#080808]">
                  <div className="flex items-center gap-2 p-2">
                  <div className="w-12 text-center shrink-0">
                    <div className="text-[10px] font-mono text-[#545454]">{formatDate(item.date)}</div>
                  </div>
                  <div className="w-px h-6 bg-white/10" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white truncate">{item.title}</div>
                    <div className="text-[10px] font-mono text-[#707070]">{item.status}</div>
                  </div>
                  {item.virality && (
                    <span
                      title={`${item.virality.verdict} · hook: ${item.virality.hook_strength} · risk: ${item.virality.retention_risk}`}
                      className={`font-mono text-[10px] shrink-0 ${(item.virality.score ?? 0) >= 70 ? 'text-emerald-400' : (item.virality.score ?? 0) >= 40 ? 'text-amber-400' : 'text-[#f64e6e]'}`}>
                      🔮 {item.virality.score ?? '?'}
                    </span>
                  )}
                  <Pill tone={statusTone[item.status] || 'neutral'}>{item.platform}</Pill>
                  {(item as { planned?: boolean }).planned && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => void predictItem(item.id)} disabled={calBusy !== null}
                        title="Predict virality of the attached media (Higgsfield) — advisory, does not block scheduling"
                        className="text-[10px] font-mono border border-white/10 text-[#b8b8b8] px-1.5 py-0.5 hover:border-violet-400 hover:text-violet-400 disabled:opacity-30">
                        {calBusy === item.id ? '…' : '🔮'}
                      </button>
                      <button onClick={() => onPickMedia(item.id)} disabled={calBusy !== null}
                        title="Attach the video/image for this post (staged in the dashboard)"
                        className="text-[10px] font-mono border border-white/10 text-[#b8b8b8] px-1.5 py-0.5 hover:border-[#f64e6e] hover:text-[#f64e6e] disabled:opacity-30">
                        {calBusy === item.id && mediaFor === item.id ? '…' : '📎'}
                      </button>
                      <button onClick={() => void scheduleItem(item.id)} disabled={calBusy !== null}
                        title="Book the post on Metricool — auto-publishes at the planned time"
                        className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] px-1.5 py-0.5 hover:bg-[#f64e6e]/20 disabled:opacity-30">
                        ⏱
                      </button>
                    </div>
                  )}
                  </div>
                  {item.virality && (item.virality.suggestions?.length ?? 0) > 0 && (
                    <div className="px-2 pb-2 pt-1.5 flex flex-col gap-0.5 border-t border-white/5">
                      <div className="text-[9px] font-mono text-violet-400/70 uppercase tracking-wider">
                        🔮 virality suggestions{item.virality.verdict ? ` · verdict: ${item.virality.verdict}` : ''}
                      </div>
                      {item.virality.suggestions.map((s, i) => (
                        <div key={i} className="text-[10px] font-mono text-[#9aa3b5] leading-snug pl-2 border-l border-violet-400/30">
                          • {s}
                        </div>
                      ))}
                    </div>
                  )}
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
              title={creators?.configured === false ? 'Set APIFY_API_TOKEN in ~/.mc/.env first' : 'Scrape the watchlist now'}
              className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] px-2 py-0.5 hover:bg-[#f64e6e]/20 disabled:opacity-30">
              {scraping ? 'SCRAPING…' : '▷ SCRAPE'}
            </button>
          }
          bodyClass="overflow-y-auto"
        >
          {creators?.configured === false && (
            <div className="font-mono text-[10px] text-amber-400 border border-amber-400/30 bg-amber-400/5 px-2 py-1.5 mb-2">
              ⚠ APIFY_API_TOKEN not set — add it to ~/.mc/.env, restart the bridge, and scraping goes live.
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
                    <span className="font-mono text-[10px] text-amber-400 shrink-0">
                      ⚡ {p.viral_score.toLocaleString()}{p.age_days != null ? <span className="text-[#545454]"> · {Math.round(p.age_days)}d</span> : null}
                    </span>
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

      <TaskDetailDrawer
        key={openTaskId ?? 'none'}
        taskId={openTaskId}
        profiles={profiles}
        allTasks={allTasks}
        onClose={() => setOpenTaskId(null)}
        onOpenTask={(id) => setOpenTaskId(id)}
      />
    </div>
  );
}
