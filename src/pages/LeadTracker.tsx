import { useEffect } from 'react';
import { useLeadStore } from '../stores/useLeadStore';
import { Panel, Pill } from '../components/cyberpunk/ui';

const statusTone: Record<string, 'good' | 'warn' | 'info' | 'neutral' | 'bad'> = {
  new: 'good',
  contacted: 'info',
  qualified: 'warn',
  converted: 'neutral',
  lost: 'bad',
};

const statusColor: Record<string, string> = {
  new: '#10b981',
  contacted: '#38bdf8',
  qualified: '#f59e0b',
  converted: '#b8b8b8',
  lost: '#ef4444',
};

const scoreColor = (score: number): string => {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
};

export default function LeadTracker() {
  const { leads, isLoading, error, lastSync, fetchLeads } = useLeadStore();

  useEffect(() => {
    fetchLeads();
    const id = setInterval(() => fetchLeads(), 30000);
    return () => clearInterval(id);
  }, [fetchLeads]);

  return (
    <div className="h-full flex flex-col gap-2 p-2 overflow-y-auto">
      {/* Header stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 shrink-0">
        <Panel noPad className="p-2">
          <div className="text-[10px] font-mono text-[#545454] tracking-widest">TOTAL LEADS</div>
          <div className="text-2xl font-mono font-bold text-white tabular-nums">{leads.length}</div>
        </Panel>
        <Panel noPad className="p-2">
          <div className="text-[10px] font-mono text-[#545454] tracking-widest">NEW</div>
          <div className="text-2xl font-mono font-bold text-emerald-400 tabular-nums">
            {leads.filter((l) => l.status === 'new').length}
          </div>
        </Panel>
        <Panel noPad className="p-2">
          <div className="text-[10px] font-mono text-[#545454] tracking-widest">QUALIFIED</div>
          <div className="text-2xl font-mono font-bold text-amber-400 tabular-nums">
            {leads.filter((l) => l.status === 'qualified').length}
          </div>
        </Panel>
        <Panel noPad className="p-2">
          <div className="text-[10px] font-mono text-[#545454] tracking-widest">AVG SCORE</div>
          <div className="text-2xl font-mono font-bold text-white tabular-nums">
            {leads.length ? Math.round(leads.reduce((s, l) => s + l.score, 0) / leads.length) : 0}
          </div>
        </Panel>
      </div>

      {/* Lead table */}
      <Panel
        label="LEAD REGISTRY"
        right={
          <div className="flex items-center gap-2">
            {isLoading && <span className="text-sky-400 animate-pulse">● SYNCING</span>}
            {lastSync && (
              <span className="text-[#545454]">
                {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            <button
              onClick={() => fetchLeads()}
              className="text-[10px] font-mono text-[#b8b8b8] border border-white/10 px-2 py-0.5 hover:text-white hover:border-white/30 transition-colors"
            >
              REFRESH
            </button>
          </div>
        }
      >
        {error ? (
          <div className="text-red-400 font-mono text-xs border border-red-400/30 bg-red-400/5 p-3">
            ⚠ {error}
          </div>
        ) : leads.length === 0 ? (
          <div className="text-[#545454] font-mono text-xs">No leads found.</div>
        ) : (
          <div className="flex flex-col gap-1">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_120px_100px_80px] gap-2 px-2 py-1 border-b border-white/10 text-[10px] font-mono text-[#545454] uppercase tracking-widest">
              <span>Name</span>
              <span>Source</span>
              <span>Status</span>
              <span className="text-right">Score</span>
            </div>
            {/* Rows */}
            {leads.map((lead) => (
              <div
                key={lead.id}
                className="grid grid-cols-[1fr_120px_100px_80px] gap-2 px-2 py-2 border border-white/5 bg-[#080808] hover:border-white/10 transition-colors items-center"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      background: statusColor[lead.status] || '#b8b8b8',
                      boxShadow: `0 0 6px ${statusColor[lead.status] || '#b8b8b8'}`,
                    }}
                  />
                  <span className="text-xs text-white truncate font-medium">{lead.name}</span>
                </div>
                <span className="text-[10px] font-mono text-[#b8b8b8] uppercase">{lead.source}</span>
                <Pill tone={statusTone[lead.status] || 'neutral'}>{lead.status}</Pill>
                <span
                  className="text-right text-xs font-mono font-bold tabular-nums"
                  style={{ color: scoreColor(lead.score) }}
                >
                  {lead.score}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
