// Content Factory — live content pipeline fed from Hermes kanban tasks.
import { useEffect, useMemo } from 'react';
import { Panel, Pill, CornerBrackets, Stat } from '../components/cyberpunk/ui';
import { useContentStore } from '../stores/useContentStore';

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
    return calendar.filter((c) => c.date >= today).slice(0, 7);
  }, [calendar]);

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
          {upcoming.length === 0 ? (
            <div className="text-[#545454] font-mono text-xs">No upcoming items.</div>
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

        {/* Mini legend / help */}
        <Panel label="LEGEND" className="shrink-0">
          <div className="grid grid-cols-2 gap-1">
            {Object.entries(statusColor).map(([st, col]) => (
              <div key={st} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: col }} />
                <span className="text-[10px] font-mono text-[#b8b8b8] uppercase">{st}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
