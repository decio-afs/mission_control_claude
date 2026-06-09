import { useEffect } from 'react';
import { useHealthStore } from '../stores/useHealthStore';
import { Label, Pill } from './cyberpunk/ui';

function fmtUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function fmtAgo(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function latencyTone(ms: number): string {
  if (ms < 150) return 'text-emerald-400';
  if (ms < 600) return 'text-amber-400';
  return 'text-red-400';
}

export default function BridgeDiagnostics({ onClose }: { onClose: () => void }) {
  const { meta, endpoints, probing, error, lastRun, runDiagnostics } = useHealthStore();

  // Run a fresh probe each time the panel opens.
  useEffect(() => {
    void runDiagnostics();
  }, [runDiagnostics]);

  const okCount = endpoints.filter((e) => e.ok).length;
  const allOk = okCount === endpoints.length;

  return (
    <div className="fixed inset-0 z-[5000] flex items-start justify-center bg-black/70 backdrop-blur-sm pt-[8vh] px-4" onClick={onClose}>
      <div
        className="bg-[#0A0A0A] border border-white/10 w-full max-w-2xl max-h-[84vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-3 h-[34px] flex items-center justify-between border-b border-white/10 bg-[#080808] shrink-0">
          <div className="flex items-center gap-2">
            <Label className="text-[#b8b8b8]">BRIDGE DIAGNOSTICS</Label>
            <Pill tone={allOk ? 'good' : okCount === 0 ? 'bad' : 'warn'}>
              {okCount}/{endpoints.length} OK
            </Pill>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void runDiagnostics()}
              disabled={probing}
              className="text-[10px] font-mono border border-white/10 px-2 py-0.5 hover:border-[#f64e6e] hover:text-[#f64e6e] disabled:opacity-50"
            >
              {probing ? 'PROBING…' : 'RE-RUN'}
            </button>
            <button onClick={onClose} className="text-[#545454] hover:text-white text-[12px]">✕</button>
          </div>
        </div>

        <div className="p-3 overflow-auto flex flex-col gap-3">
          {/* Bridge meta */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <MetaCard label="BRIDGE" value={meta ? meta.bridge.toUpperCase() : '—'} tone={meta ? 'good' : 'neutral'} />
            <MetaCard label="PORT" value={meta ? String(meta.port) : '—'} />
            <MetaCard label="UPTIME" value={meta ? fmtUptime(meta.uptime_seconds) : '—'} />
            <MetaCard label="CLI" value={meta ? (meta.cli_ok ? 'WIRED' : 'DOWN') : '—'} tone={meta?.cli_ok ? 'good' : meta ? 'bad' : 'neutral'} />
          </div>

          {meta && (
            <div className="text-[10px] font-mono text-[#545454] flex flex-wrap gap-x-4 gap-y-1">
              <span>hermes: <span className="text-[#b8b8b8]">{meta.cli_version}</span></span>
              <span>cli probe: <span className="text-[#b8b8b8]">{meta.cli_probe_ms}ms</span></span>
              <span>python: <span className="text-[#b8b8b8]">{meta.python_version}</span></span>
              <span>server: <span className="text-[#b8b8b8]">{meta.server_time}</span></span>
            </div>
          )}

          {error && (
            <div className="text-[10px] font-mono text-red-400 border border-red-400/30 bg-red-400/5 px-2 py-1.5">
              ⚠ bridge meta: {error}
            </div>
          )}

          {/* Endpoint table */}
          <div className="border border-white/[0.08]">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1.5 border-b border-white/10 bg-[#080808] text-[9px] font-mono uppercase tracking-[0.18em] text-[#545454]">
              <span>Endpoint</span>
              <span className="text-right w-14">HTTP</span>
              <span className="text-right w-16">Latency</span>
              <span className="text-right w-20">Last OK</span>
            </div>
            {endpoints.map((e) => (
              <div key={e.key} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1.5 border-b border-white/[0.04] items-center text-[10px] font-mono">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${e.checkedAt ? (e.ok ? 'bg-emerald-400' : 'bg-red-400') : 'bg-[#363636]'}`} />
                    <span className="text-[#d8d8d8] truncate">{e.label}</span>
                  </div>
                  <div className="text-[9px] text-[#444] truncate pl-3.5">{e.path}</div>
                  {e.error && <div className="text-[9px] text-red-400/80 truncate pl-3.5">{e.error}</div>}
                </div>
                <span className={`text-right w-14 tabular-nums ${e.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {e.checkedAt ? (e.status || 'ERR') : '—'}
                </span>
                <span className={`text-right w-16 tabular-nums ${e.checkedAt ? latencyTone(e.latencyMs) : 'text-[#545454]'}`}>
                  {e.checkedAt ? `${e.latencyMs}ms` : '—'}
                </span>
                <span className="text-right w-20 text-[#545454]">{fmtAgo(e.lastSuccess)}</span>
              </div>
            ))}
          </div>

          <div className="text-[9px] font-mono text-[#444] flex justify-between">
            <span>Probes run client-side from the app · localhost:{meta?.port ?? '8767'}</span>
            <span>last run {fmtAgo(lastRun)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaCard({ label, value, tone = 'white' }: { label: string; value: string; tone?: string }) {
  const tones: Record<string, string> = {
    white: 'text-white',
    good: 'text-emerald-400',
    bad: 'text-red-400',
    neutral: 'text-[#545454]',
  };
  return (
    <div className="border border-white/[0.08] bg-[#080808] px-2 py-1.5">
      <Label className="text-[#545454]">{label}</Label>
      <div className={`text-sm font-mono font-bold tabular-nums ${tones[tone] || tones.white}`}>{value}</div>
    </div>
  );
}
