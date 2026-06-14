// Briefing Terminal — live Mc data via useBriefingStore, plus the
// consolidated AI digest (LLM-synthesized from Sentinel, ranked for virality).
import { useEffect, useMemo, useState } from 'react';
import { Panel, Pill } from '../components/cyberpunk/ui';
import { useBriefingStore } from '../stores/useBriefingStore';
import { getAiDigest, generateAiDigest, errMessage, type AiDigest } from '../lib/api';

const sevTone: Record<string, 'brand' | 'warn' | 'info'> = { HIGH: 'brand', WARN: 'warn', INFO: 'info' };
const sevColor: Record<string, string> = { HIGH: '#f64e6e', WARN: '#f59e0b', INFO: '#38bdf8' };

function useTypewriterLines(lineCount: number, speed = 60) {
  const [revealed, setRevealed] = useState(0);
  useEffect(() => {
    if (lineCount === 0) return;
    const id = setInterval(() => setRevealed((v) => (v < lineCount ? v + 1 : v)), speed);
    return () => clearInterval(id);
  }, [lineCount, speed]);
  return Math.min(revealed, lineCount);
}

function SentinelFeed() {
  const { sentinel, sentinelLoading, sentinelError, refreshSentinel } = useBriefingStore();

  useEffect(() => {
    refreshSentinel();
    const id = setInterval(() => refreshSentinel(), 60000);
    return () => clearInterval(id);
  }, [refreshSentinel]);

  return (
    <Panel label="SENTINEL FEED · /tty8" right={<span className="text-[#38bdf8]">◉ LIVE</span>}>
      <div className="h-full bg-[#03030a] p-3 overflow-auto relative" style={{ fontFamily: '"JetBrains Mono",ui-monospace,monospace' }}>
        {sentinelLoading && !sentinel && (
          <div className="text-[#545454] text-[11px] font-mono">{'>'} syncing with Sentinel…</div>
        )}
        {sentinelError && (
          <div className="text-[#f64e6e] text-[11px] font-mono">{'>'} sentinel error: {sentinelError}</div>
        )}
        {!sentinelLoading && !sentinelError && !sentinel && (
          <div className="text-[#545454] text-[11px] font-mono">{'>'} no sentinel data available</div>
        )}
        {sentinel && (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono text-[#545454]">
                {sentinel.generated_at ? new Date(sentinel.generated_at).toISOString().slice(0, 10).replace(/-/g, '.') : '—'} · {sentinel.total_stories} STORIES
              </span>
              <span className="text-[10px] font-mono text-[#38bdf8]">
                {sentinel.sources.length} SOURCES
              </span>
            </div>
            <div className="flex flex-wrap gap-1 mb-3">
              {sentinel.sources.map((s) => (
                <Pill key={s} tone="info">{s}</Pill>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {sentinel.stories.map((story, i) => (
                <a
                  key={i}
                  href={story.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block border border-white/[0.06] bg-[#0a0a12] hover:border-[#f64e6e]/30 hover:bg-[#f64e6e]/[0.03] transition-colors p-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    {/* min-w-0 + break-words lets an arbitrary RSS title wrap inside
                        its flex cell instead of overflowing and shoving the score
                        off the right edge. */}
                    <span className="min-w-0 break-words text-[11px] text-[#b8b8b8] leading-tight group-hover:text-white transition-colors">
                      {story.title}
                    </span>
                    <span className="shrink-0 text-[10px] font-mono text-[#f64e6e] tabular-nums">
                      {story.score}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 min-w-0">
                    <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-[#545454]">{story.source}</span>
                    <span className="min-w-0 truncate text-[10px] font-mono text-[#363636]">{new URL(story.url).hostname.replace(/^www\./, '')}</span>
                  </div>
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

// Consolidated AI digest — ONE narrative + ranked viral content ideas, instead
// of a raw link list. Generated on demand (or by a cron POSTing the endpoint).
function AiDigestPanel() {
  const [digest, setDigest] = useState<AiDigest | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);

  useEffect(() => { getAiDigest().then(setDigest).catch(() => setDigest(null)); }, []);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setGenErr(null);
    try {
      setDigest(await generateAiDigest());
    } catch (e) {
      setGenErr(errMessage(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Panel
      label="AI DIGEST · CONSOLIDATED"
      right={
        <button onClick={() => void handleGenerate()} disabled={generating}
          className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] px-2 py-0.5 hover:bg-[#f64e6e]/20 disabled:opacity-40">
          {generating ? 'SYNTHESIZING…' : digest?.available ? '↻ REGENERATE' : '▷ GENERATE'}
        </button>
      }
    >
      {generating && (
        <div className="font-mono text-[11px] text-[#545454]">{'>'} arcan is reading {digest?.story_count ?? 'the'} sentinel stories and ranking viral potential — 1-3 min…</div>
      )}
      {genErr && <div className="font-mono text-[10px] text-red-400 mb-2">⚠ {genErr}</div>}
      {!generating && !digest?.available && !genErr && (
        <div className="font-mono text-[11px] text-[#545454]">
          {'>'} no digest yet — GENERATE turns today's Sentinel links into one consolidated
          AI-news narrative plus viral content ideas for your niche.
        </div>
      )}
      {!generating && digest?.available && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-[#545454]">
              synthesized {digest.generated_at ? new Date(digest.generated_at).toLocaleString() : '—'} · {digest.story_count} stories in
            </span>
          </div>
          <p className="text-[11px] text-[#b8b8b8] leading-relaxed border-l-2 border-[#f64e6e]/50 pl-3">
            {digest.summary}
          </p>
          <div className="font-mono text-[10px] text-[#545454] tracking-[0.15em] uppercase">viral content ideas</div>
          <div className="flex flex-col gap-2">
            {(digest.ideas ?? []).map((idea, i) => (
              <div key={i} className="border border-white/[0.06] bg-[#0a0a12] p-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] text-white font-medium break-words">{idea.title}</span>
                  {idea.source_url && (
                    <a href={idea.source_url} target="_blank" rel="noreferrer"
                      className="shrink-0 font-mono text-[10px] text-[#38bdf8] hover:text-white">src ↗</a>
                  )}
                </div>
                <div className="text-[11px] text-[#b8b8b8] mt-1"><span className="text-[#f64e6e] font-mono text-[10px]">ANGLE</span> {idea.angle}</div>
                <div className="text-[11px] text-[#707070] mt-0.5"><span className="text-amber-400 font-mono text-[10px]">WHY</span> {idea.why_viral}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

export default function BriefingTerminal() {
  const { briefing, loading, error, refresh } = useBriefingStore();

  useEffect(() => {
    refresh();
    const id = setInterval(() => refresh(), 30000);
    return () => clearInterval(id);
  }, [refresh]);

  const typewriterLines = useMemo(() => {
    if (!briefing) return [] as Array<{ c: string; t: string; m: string }>;
    const out: Array<{ c: string; t: string; m: string }> = [];
    const push = (c: string, t: string, m: string) => out.push({ c, t, m });

    push('#f64e6e', '>>', `DIRECTOR KATE — DAILY BRIEF — ${new Date().toISOString().slice(0, 10).replace(/-/g, '.')} · ${new Date().toISOString().slice(11, 16)} ZULU`);
    push('#545454', '--', '----------------------------------------------------------');
    push('#b8b8b8', 'SUMMARY', briefing.summary);
    push('#545454', '', '');

    briefing.trend.forEach((m) => push('#f59e0b', 'TREND', m));
    if (briefing.trend.length) push('#545454', '', '');

    briefing.fin.forEach((m) => push('#10b981', 'FIN', m));
    if (briefing.fin.length) push('#545454', '', '');

    briefing.arc.forEach((m) => push('#ff795e', 'ARC', m));
    if (briefing.arc.length) push('#545454', '', '');

    briefing.forecast.forEach((m) => push('#38bdf8', 'FORECAST', m));
    if (briefing.forecast.length) push('#545454', '', '');

    briefing.prompts.forEach((m) => push('#f64e6e', 'PROMPTS', m));
    if (briefing.prompts.length) push('#545454', '', '');

    push('#545454', '--', 'end of brief · press ENTER to queue response · TAB to promote.');
    return out;
  }, [briefing]);

  const revealed = useTypewriterLines(typewriterLines.length, 60);

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-2 p-2 relative overflow-y-auto">
      {/* shrink-0 on each stacked panel: they keep their natural/min height and
          the page scrolls (overflow-y-auto above), instead of flexbox squeezing
          all three into the viewport — which clipped their content once Panel
          became overflow-hidden. */}
      <div className="flex flex-col gap-2 min-h-0">
        <Panel label="BRIEFING TERMINAL · /tty7" className="shrink-0 min-h-[300px] max-h-[55vh]" right={<span className="text-[#f64e6e]">● RECORDING</span>}>
          <div className="h-full bg-[#03030a] p-4 font-mono text-[11px] overflow-auto relative" style={{ fontFamily: '"JetBrains Mono",ui-monospace,monospace' }}>
            {loading && !briefing && (
              <div className="text-[#545454]">{'>'} syncing with Mc bridge…</div>
            )}
            {error && (
              <div className="text-[#f64e6e]">{'>'} bridge error: {error}</div>
            )}
            {!loading && !error && !briefing && (
              <div className="text-[#545454]">{'>'} no briefing data available</div>
            )}
            {typewriterLines.slice(0, revealed).map((l, i) => (
              <div key={i} className="flex gap-3">
                <span className="w-20 shrink-0 text-[10px]" style={{ color: l.c }}>{l.t}</span>
                <span style={{ color: l.c }}>{l.m}</span>
              </div>
            ))}
            {revealed < typewriterLines.length && (
              <span className="inline-block w-2 h-[14px] bg-[#f64e6e]" style={{ animation: 'blink 0.7s steps(2) infinite' }} />
            )}
          </div>
        </Panel>

        <div className="shrink-0"><AiDigestPanel /></div>
        <div className="shrink-0"><SentinelFeed /></div>
      </div>

      <Panel label="TODAY'S DIRECTIVES" className="min-h-0">
        <div className="flex flex-col gap-2 h-full overflow-y-auto">
          {briefing?.directives.map((b, i) => (
            <div key={i} className="border-l-2 pl-2" style={{ borderColor: sevColor[b.sev] }}>
              <div className="flex items-center justify-between mb-0.5">
                <Pill tone={sevTone[b.sev]}>{b.sev}</Pill>
                <span className="text-[10px] font-mono text-[#545454]">{b.t}</span>
              </div>
              <div className="text-[11px] text-[#b8b8b8] leading-tight break-words">{b.msg}</div>
            </div>
          ))}
          {!briefing && (
            <div className="text-[11px] text-[#545454]">No directives available.</div>
          )}
        </div>
      </Panel>
    </div>
  );
}
