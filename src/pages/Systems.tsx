// SYSTEMS — Hermes runtime health & analytics: doctor diagnostics, usage
// insights (tokens / tools / platforms), live log tail, model + fallback +
// credential pool, checkpoint store, and the on-demand OSV supply-chain audit.
import { useEffect, useMemo, useState } from 'react';
import { useCapabilitiesStore } from '../stores/useCapabilitiesStore';
import { Panel, Pill, Stat } from '../components/cyberpunk/ui';

const LOG_NAMES = ['agent', 'errors', 'gateway', 'gui'] as const;
const LOG_LEVEL_COLORS: Record<string, string> = {
  ERROR: '#ef4444', WARNING: '#f59e0b', INFO: '#b8b8b8', DEBUG: '#545454',
};

function fmtTokens(n: number | string | undefined): string {
  if (typeof n !== 'number') return String(n ?? '—');
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export default function Systems() {
  const {
    model, auth, checkpoints, doctor, doctorLoading, insights, insightsDays, insightsLoading,
    logName, logLines, logLoading, audit, auditLoading,
    systemsLoading, systemsError, systemsLoaded,
    refreshSystems, runDoctor, fetchInsights, fetchLogs, runAudit,
  } = useCapabilitiesStore();

  const [logLevel, setLogLevel] = useState<string>('');
  const [doctorFilter, setDoctorFilter] = useState<'all' | 'warn'>('all');

  useEffect(() => {
    if (!systemsLoaded) void refreshSystems();
  }, [systemsLoaded, refreshSystems]);

  // Auto-refresh the visible log tail every 15s.
  useEffect(() => {
    const id = setInterval(() => { void fetchLogs(logName, 100, logLevel || undefined); }, 15000);
    return () => clearInterval(id);
  }, [logName, logLevel, fetchLogs]);

  const visibleChecks = useMemo(() => {
    if (!doctor) return [];
    return doctorFilter === 'warn' ? doctor.checks.filter((c) => c.level !== 'ok') : doctor.checks;
  }, [doctor, doctorFilter]);

  const maxToolCalls = Math.max(1, ...(insights?.top_tools ?? []).map((t) => t.calls));
  const maxDay = Math.max(1, ...(insights?.weekday_activity ?? []).map((d) => d.sessions));

  return (
    <div className="h-full flex flex-col gap-2 p-2 overflow-auto">
      {systemsError && (
        <div className="shrink-0 px-2 py-1 border border-red-400/40 bg-[#050505]/80 text-red-400 font-mono text-[10px]">
          ⚠ SYSTEMS: {systemsError}
        </div>
      )}

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 shrink-0">
        <Panel label="MODEL" className="h-[84px]">
          <Stat label="inference" value={model?.model ?? '—'} sub={model?.provider ?? undefined} tone="brand" />
        </Panel>
        <Panel label="FALLBACKS" className="h-[84px]">
          <Stat label="provider chain" value={model ? (model.fallbacks.length || 'NONE') : '—'}
            tone={model?.fallbacks.length ? 'good' : 'warn'}
            sub={model && !model.fallbacks.length ? 'no failover configured' : model?.fallbacks.slice(0, 2).join(' · ')} />
        </Panel>
        <Panel label="CREDENTIALS" className="h-[84px]">
          <Stat label="auth pool" value={auth ? auth.providers.reduce((s, p) => s + p.count, 0) : '—'}
            sub={auth ? `${auth.providers.length} providers` : undefined} tone="info" />
        </Panel>
        <Panel label="DOCTOR" className="h-[84px]">
          <Stat label="diagnostics" value={doctor ? `${doctor.counts.fail}✗ ${doctor.counts.warn}⚠` : '—'}
            sub={doctor ? `${doctor.counts.ok} checks ok` : 'run diagnostics →'}
            tone={doctor ? (doctor.counts.fail ? 'warn' : 'good') : 'white'} />
        </Panel>
        <Panel label={`TOKENS · ${insightsDays}D`} className="h-[84px]">
          <Stat label="total processed" value={fmtTokens(insights?.overview.total_tokens as number | undefined)}
            sub={insights ? `${fmtTokens(insights.overview.input_tokens as number)} in · ${fmtTokens(insights.overview.output_tokens as number)} out` : undefined} tone="brand" />
        </Panel>
        <Panel label={`SESSIONS · ${insightsDays}D`} className="h-[84px]">
          <Stat label="agent sessions" value={insights?.overview.sessions ?? '—'}
            sub={insights ? `${insights.overview.tool_calls} tool calls` : undefined} tone="good" />
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 flex-1 min-h-0">
        {/* Insights */}
        <Panel
          label="USAGE INSIGHTS"
          className="min-h-[340px]"
          right={
            <div className="flex gap-1">
              {[7, 30, 90].map((d) => (
                <button key={d} onClick={() => void fetchInsights(d)} disabled={insightsLoading}
                  className={`font-mono text-[10px] border px-2 py-0.5 ${insightsDays === d ? 'border-[#f64e6e]/50 text-[#f64e6e]' : 'border-white/10 text-[#b8b8b8]'} hover:border-[#f64e6e] disabled:opacity-40`}>
                  {d}D
                </button>
              ))}
            </div>
          }
          bodyClass="overflow-y-auto"
        >
          {insightsLoading && <div className="font-mono text-[11px] text-[#545454]">analyzing session history…</div>}
          {!insightsLoading && !insights && <div className="font-mono text-[11px] text-[#545454]">no insight data</div>}
          {!insightsLoading && insights && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
                <div><div className="text-[#545454]">MESSAGES</div><div className="text-white text-[13px] tabular-nums">{insights.overview.messages ?? '—'}</div></div>
                <div><div className="text-[#545454]">ACTIVE TIME</div><div className="text-white text-[13px]">{insights.overview.active_time ?? '—'}</div></div>
                <div><div className="text-[#545454]">AVG SESSION</div><div className="text-white text-[13px]">{insights.overview.avg_session ?? '—'}</div></div>
              </div>

              <div>
                <div className="font-mono text-[10px] text-[#545454] tracking-[0.15em] uppercase mb-1">top tools</div>
                {insights.top_tools.slice(0, 8).map((t) => (
                  <div key={t.tool} className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[10px] text-[#b8b8b8] w-[120px] truncate shrink-0" title={t.tool}>{t.tool}</span>
                    <div className="flex-1 h-[8px] bg-white/[0.04]">
                      <div className="h-full bg-[#f64e6e]/60" style={{ width: `${(t.calls / maxToolCalls) * 100}%` }} />
                    </div>
                    <span className="font-mono text-[10px] text-[#545454] w-[52px] text-right shrink-0">{t.calls} · {t.pct}%</span>
                  </div>
                ))}
              </div>

              <div>
                <div className="font-mono text-[10px] text-[#545454] tracking-[0.15em] uppercase mb-1">platforms</div>
                {insights.platforms.map((p) => (
                  <div key={p.platform} className="flex justify-between font-mono text-[10px] border-b border-white/[0.05] py-0.5">
                    <span className="text-[#b8b8b8]">{p.platform}</span>
                    <span className="text-[#545454]">{p.sessions} sess · {fmtTokens(p.tokens)} tok</span>
                  </div>
                ))}
              </div>

              <div>
                <div className="font-mono text-[10px] text-[#545454] tracking-[0.15em] uppercase mb-1">weekday activity</div>
                <div className="flex items-end gap-1 h-[44px]">
                  {insights.weekday_activity.map((d) => (
                    <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.day}: ${d.sessions}`}>
                      <div className="w-full bg-sky-400/50" style={{ height: `${(d.sessions / maxDay) * 32}px` }} />
                      <span className="font-mono text-[10px] text-[#545454]">{d.day[0]}</span>
                    </div>
                  ))}
                </div>
                {insights.peak_hours && <div className="font-mono text-[10px] text-[#545454] mt-1">peak: {insights.peak_hours}</div>}
              </div>
            </div>
          )}
        </Panel>

        {/* Log viewer */}
        <Panel
          label="LOG TAIL"
          className="min-h-[340px]"
          right={
            <div className="flex gap-1 items-center">
              {LOG_NAMES.map((n) => (
                <button key={n} onClick={() => void fetchLogs(n, 100, logLevel || undefined)}
                  className={`font-mono text-[10px] border px-1.5 py-0.5 uppercase ${logName === n ? 'border-[#f64e6e]/50 text-[#f64e6e]' : 'border-white/10 text-[#b8b8b8]'} hover:border-[#f64e6e]`}>
                  {n}
                </button>
              ))}
              <select value={logLevel} onChange={(e) => { setLogLevel(e.target.value); void fetchLogs(logName, 100, e.target.value || undefined); }}
                className="bg-[#050505] border border-white/10 px-1 py-0.5 text-[10px] font-mono text-[#b8b8b8] outline-none">
                <option value="">ALL</option>
                <option value="WARNING">WARN+</option>
                <option value="ERROR">ERROR</option>
              </select>
            </div>
          }
          bodyClass="overflow-y-auto"
          noPad
        >
          <div className="p-2 font-mono text-[10px] leading-[1.6]">
            {logLoading && !logLines.length && <div className="text-[#545454]">tailing {logName}.log…</div>}
            {logLines.map((l, i) => {
              const level = Object.keys(LOG_LEVEL_COLORS).find((lv) => l.includes(` ${lv} `));
              return (
                <div key={i} className="whitespace-pre-wrap break-all" style={{ color: level ? LOG_LEVEL_COLORS[level] : '#7a7a7a' }}>
                  {l}
                </div>
              );
            })}
          </div>
        </Panel>

        {/* Doctor + model + audit */}
        <div className="flex flex-col gap-2 min-h-0">
          <Panel
            label="DOCTOR DIAGNOSTICS"
            className="flex-1 min-h-[180px]"
            right={
              <>
                {doctor && (
                  <button onClick={() => setDoctorFilter((f) => (f === 'all' ? 'warn' : 'all'))}
                    className="font-mono text-[10px] border border-white/10 px-2 py-0.5 text-[#b8b8b8] hover:border-[#f64e6e]">
                    {doctorFilter === 'all' ? 'ALL' : '⚠ ONLY'}
                  </button>
                )}
                <button onClick={() => void runDoctor()} disabled={doctorLoading}
                  className="font-mono text-[10px] border border-[#f64e6e]/40 bg-[#f64e6e]/10 px-2 py-0.5 text-[#f64e6e] hover:bg-[#f64e6e]/20 disabled:opacity-40">
                  {doctorLoading ? 'RUNNING…' : '▷ RUN'}
                </button>
              </>
            }
            bodyClass="overflow-y-auto"
          >
            {!doctor && !doctorLoading && <div className="font-mono text-[11px] text-[#545454]">run diagnostics to check config, dependencies & advisories</div>}
            {doctorLoading && <div className="font-mono text-[11px] text-[#545454]">hermes doctor — checking ~18s…</div>}
            {doctor && visibleChecks.map((c, i) => (
              <div key={i} className="flex items-start gap-2 font-mono text-[10px] py-0.5 border-b border-white/[0.04]">
                <span className={`shrink-0 ${c.level === 'ok' ? 'text-emerald-400' : c.level === 'warn' ? 'text-amber-400' : 'text-red-400'}`}>
                  {c.level === 'ok' ? '✓' : c.level === 'warn' ? '⚠' : '✗'}
                </span>
                <span className="text-[#b8b8b8]">{c.text}</span>
              </div>
            ))}
            {doctor && doctorFilter === 'warn' && !visibleChecks.length && (
              <div className="font-mono text-[11px] text-emerald-400">all {doctor.counts.ok} checks passing — no warnings</div>
            )}
          </Panel>

          <Panel label="CREDENTIAL POOL" className="shrink-0 max-h-[140px]" bodyClass="overflow-y-auto">
            {!auth && <div className="font-mono text-[11px] text-[#545454]">{systemsLoading ? 'querying…' : 'no data'}</div>}
            {auth?.providers.map((p) => (
              <div key={p.provider} className="font-mono text-[10px] py-0.5 flex items-center justify-between gap-2">
                <span className="text-[#b8b8b8] truncate">{p.provider}</span>
                <span className="text-[#545454] shrink-0">{p.credentials.map((c) => c.kind).join(' · ')}</span>
              </div>
            ))}
          </Panel>

          <Panel
            label="SUPPLY-CHAIN AUDIT"
            className="shrink-0"
            right={
              <button onClick={() => void runAudit()} disabled={auditLoading}
                className="font-mono text-[10px] border border-[#f64e6e]/40 bg-[#f64e6e]/10 px-2 py-0.5 text-[#f64e6e] hover:bg-[#f64e6e]/20 disabled:opacity-40">
                {auditLoading ? 'SCANNING…' : '▷ OSV SCAN'}
              </button>
            }
          >
            {auditLoading && <div className="font-mono text-[10px] text-[#545454]">scanning venv + plugins + MCP pins against OSV.dev…</div>}
            {!auditLoading && !audit && <div className="font-mono text-[10px] text-[#545454]">on-demand vulnerability scan (venv · plugins · MCP servers)</div>}
            {!auditLoading && audit && (
              <div className="flex items-center gap-2">
                <Pill tone={audit.vulnerabilities ? 'bad' : 'good'}>
                  {audit.vulnerabilities ? `${audit.vulnerabilities} ADVISORIES` : 'CLEAN'}
                </Pill>
                <span className="font-mono text-[10px] text-[#545454] truncate">{audit.raw.split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 60)}</span>
              </div>
            )}
          </Panel>

          {checkpoints && (
            <Panel label="CHECKPOINT STORE" className="shrink-0">
              <pre className="font-mono text-[10px] text-[#545454] whitespace-pre-wrap leading-relaxed">{checkpoints}</pre>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
