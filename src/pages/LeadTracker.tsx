import { useEffect, useState } from 'react';
import { useLeadStore } from '../stores/useLeadStore';
import { addLead, updateLead, deleteLead } from '../lib/api';
import { Panel, Pill } from '../components/cyberpunk/ui';

// Pipeline order for the click-to-advance status cycle.
const STATUS_CYCLE = ['new', 'contacted', 'qualified', 'converted', 'lost'];

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
  const [nName, setNName] = useState('');
  const [nSource, setNSource] = useState('manual');
  const [nScore, setNScore] = useState('50');
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  useEffect(() => {
    fetchLeads();
    const id = setInterval(() => fetchLeads(), 30000);
    return () => clearInterval(id);
  }, [fetchLeads]);

  const handleAdd = async () => {
    if (!nName.trim() || busy) return;
    setBusy(true);
    setActionErr(null);
    try {
      await addLead({ name: nName.trim(), source: nSource, score: Math.max(0, Math.min(100, parseInt(nScore, 10) || 50)) });
      setNName('');
      await fetchLeads();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cycleStatus = async (id: string, current: string) => {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length];
    try {
      await updateLead(id, { status: next });
      await fetchLeads();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteLead(id);
      await fetchLeads();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    }
  };

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
        {/* Add-lead form — agents can also POST /api/hermes/leads directly */}
        <div className="flex flex-wrap gap-1.5 mb-3 items-center">
          <input value={nName} onChange={(e) => setNName(e.target.value)} placeholder="lead name / company…"
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
            className="flex-1 min-w-[180px] bg-[#050505] border border-white/10 px-2 py-1.5 text-[11px] font-mono text-white focus:border-[#f64e6e]/50 outline-none" />
          <select value={nSource} onChange={(e) => setNSource(e.target.value)}
            className="bg-[#050505] border border-white/10 px-2 py-1.5 text-[10px] font-mono text-[#b8b8b8] outline-none">
            {['manual', 'website', 'referral', 'social', 'agent', 'rfp'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input value={nScore} onChange={(e) => setNScore(e.target.value)} inputMode="numeric" title="score 0-100"
            className="w-[52px] bg-[#050505] border border-white/10 px-2 py-1.5 text-[10px] font-mono text-white text-right outline-none" />
          <button onClick={() => void handleAdd()} disabled={busy || !nName.trim()}
            className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] px-3 py-1.5 hover:bg-[#f64e6e]/20 disabled:opacity-30">
            {busy ? '…' : '+ LEAD'}
          </button>
        </div>
        {actionErr && <div className="text-red-400 font-mono text-[10px] mb-2">⚠ {actionErr}</div>}

        {error ? (
          <div className="text-red-400 font-mono text-xs border border-red-400/30 bg-red-400/5 p-3">
            ⚠ {error}
          </div>
        ) : leads.length === 0 ? (
          <div className="text-[#545454] font-mono text-xs">
            No leads yet — add one above, or let agents push leads via POST /api/hermes/leads
            (e.g. the RFP-research tasks on the kanban).
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_120px_110px_60px_40px] gap-2 px-2 py-1 border-b border-white/10 text-[10px] font-mono text-[#545454] uppercase tracking-widest">
              <span>Name</span>
              <span>Source</span>
              <span>Status · click to advance</span>
              <span className="text-right">Score</span>
              <span />
            </div>
            {/* Rows */}
            {leads.map((lead) => (
              <div
                key={lead.id}
                className="grid grid-cols-[1fr_120px_110px_60px_40px] gap-2 px-2 py-2 border border-white/5 bg-[#080808] hover:border-white/10 transition-colors items-center"
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
                <span className="text-[10px] font-mono text-[#b8b8b8] uppercase truncate" title={lead.source}>{lead.source}</span>
                <button onClick={() => void cycleStatus(lead.id, lead.status)} title="Advance to next pipeline stage" className="text-left">
                  <Pill tone={statusTone[lead.status] || 'neutral'}>{lead.status}</Pill>
                </button>
                <span
                  className="text-right text-xs font-mono font-bold tabular-nums"
                  style={{ color: scoreColor(lead.score) }}
                >
                  {lead.score}
                </span>
                <button onClick={() => void handleDelete(lead.id)} title="Delete lead"
                  className="text-[#545454] hover:text-red-400 text-[11px] font-mono text-right">✕</button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
