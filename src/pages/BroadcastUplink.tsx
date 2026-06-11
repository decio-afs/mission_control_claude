// Broadcast Uplink — live channel matrix. Data from the Hermes overview
// (/api/hermes/overview → configured platforms) and the gateway service
// (/api/hermes/gateway → runtime status + registered gateways).
import { useEffect, useState } from 'react';
import { Panel, Pill } from '../components/cyberpunk/ui';
import {
  getHermesOverview, getHermesGateway, errMessage,
  type HermesOverview, type HermesGatewayInfo,
} from '../lib/api';

const PALETTE = ['#f64e6e', '#38bdf8', '#ff795e', '#10b981', '#f59e0b', '#a78bfa'];

export default function BroadcastUplink() {
  const [overview, setOverview] = useState<HermesOverview | null>(null);
  const [gateway, setGateway] = useState<HermesGatewayInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([getHermesOverview(), getHermesGateway()]).then(([ov, gw]) => {
      if (!alive) return;
      if (ov.status === 'fulfilled') setOverview(ov.value);
      if (gw.status === 'fulfilled') setGateway(gw.value);
      if (ov.status === 'rejected' && gw.status === 'rejected') {
        setError(errMessage(ov.reason));
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const platforms = overview?.platforms ?? [];
  const configured = platforms.filter((p) => p.configured);
  const apiUp = gateway?.service?.api_listening ?? gateway?.service?.running ?? false;

  return (
    <div className="h-full grid grid-cols-2 lg:grid-cols-4 gap-2 p-2 overflow-auto relative content-start">
      {loading && (
        <Panel label="CHANNEL MATRIX" className="col-span-2 lg:col-span-4 h-[120px]">
          <div className="h-full flex items-center justify-center text-[11px] font-mono text-[#545454]">
            querying hermes overview + gateway…
          </div>
        </Panel>
      )}

      {!loading && error && (
        <Panel label="CHANNEL MATRIX" className="col-span-2 lg:col-span-4 h-[120px]">
          <div className="h-full flex items-center justify-center text-[11px] font-mono text-red-400">
            bridge error · {error}
          </div>
        </Panel>
      )}

      {!loading && !error && platforms.length === 0 && (
        <Panel label="CHANNEL MATRIX" className="col-span-2 lg:col-span-4 h-[140px]">
          <div className="h-full flex flex-col items-center justify-center gap-2 text-[11px] font-mono text-[#545454]">
            <span className="text-[13px] opacity-40">⊘</span>
            <span>no platforms reported by hermes</span>
            <span className="text-[10px] text-[#363636]">configure channels via `hermes` platform setup, then reload</span>
          </div>
        </Panel>
      )}

      {platforms.map((p, i) => {
        const c = PALETTE[i % PALETTE.length];
        const gw = gateway?.gateways?.find((g) => g.name.toLowerCase() === p.name.toLowerCase());
        return (
          <Panel
            key={p.name}
            label={p.name.toUpperCase()}
            right={
              <span style={{ color: p.configured ? c : '#545454' }}>
                {p.configured ? '● ON-AIR' : '○ OFFLINE'}
              </span>
            }
            className={p.configured ? '' : 'opacity-50'}
          >
            <div className="flex flex-col h-full">
              <div className="mt-1">
                <Pill tone={p.configured ? 'good' : 'neutral'}>{p.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}</Pill>
              </div>
              <div className="mt-3 text-[10px] font-mono text-[#545454] break-all">
                {p.home ? `home · ${p.home}` : 'no home directory reported'}
              </div>
              <div className="mt-auto pt-2 border-t border-white/10 text-[10px] font-mono">
                <div className="flex justify-between">
                  <span className="text-[#545454]">gateway</span>
                  <span style={{ color: gw ? (gw.running ? '#10b981' : '#f59e0b') : '#545454' }}>
                    {gw ? (gw.running ? 'RUNNING' : 'STOPPED') : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#545454]">pid</span>
                  <span className="text-white tabular-nums">{gw?.pid ?? '—'}</span>
                </div>
              </div>
            </div>
          </Panel>
        );
      })}

      {!loading && (
        <Panel
          label="GATEWAY SERVICE"
          className="col-span-2 lg:col-span-4"
          right={
            <span className={apiUp ? 'text-emerald-400' : 'text-red-400'}>
              {apiUp ? '● API LISTENING' : '● API DOWN'}
            </span>
          }
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-[10px] font-mono">
            <div className="flex justify-between border border-white/5 bg-[#080808] px-3 py-2">
              <span className="text-[#545454]">process</span>
              <span style={{ color: gateway?.service?.running ? '#10b981' : '#ef4444' }}>
                {gateway?.service?.running ? 'RUNNING' : 'STOPPED'}
              </span>
            </div>
            <div className="flex justify-between border border-white/5 bg-[#080808] px-3 py-2">
              <span className="text-[#545454]">api :8642</span>
              <span style={{ color: apiUp ? '#10b981' : '#ef4444' }}>{apiUp ? 'LISTENING' : 'NO RESPONSE'}</span>
            </div>
            <div className="flex justify-between border border-white/5 bg-[#080808] px-3 py-2">
              <span className="text-[#545454]">manager</span>
              <span className="text-white">{gateway?.service?.manager ?? '—'}</span>
            </div>
            <div className="flex justify-between border border-white/5 bg-[#080808] px-3 py-2">
              <span className="text-[#545454]">pids</span>
              <span className="text-white tabular-nums">{gateway?.service?.pids?.length ? gateway.service.pids.join(', ') : '—'}</span>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            {(gateway?.gateways ?? []).length === 0 && (
              <div className="text-[10px] font-mono text-[#545454] px-1">
                no gateways registered — start one with the gateway controls in Uplink
              </div>
            )}
            {(gateway?.gateways ?? []).map((g) => (
              <div key={g.name} className="grid grid-cols-[1fr_auto_auto_80px] items-center gap-3 px-3 py-2 border border-white/5 hover:border-white/15 bg-[#080808]">
                <span className="text-[11px] text-white font-mono">{g.name}</span>
                {g.current ? <Pill tone="brand">CURRENT</Pill> : <span className="text-[10px] font-mono text-[#545454]">—</span>}
                <span className="text-[10px] font-mono" style={{ color: g.running ? '#10b981' : '#545454' }}>
                  {g.running ? '● RUNNING' : '○ STOPPED'}
                </span>
                <span className="text-[10px] font-mono text-[#b8b8b8] tabular-nums text-right">{g.pid ?? '—'}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 pt-2 border-t border-white/10 text-[10px] font-mono text-[#545454] flex flex-wrap gap-x-4 gap-y-1">
            <span>configured channels · <span className="text-white tabular-nums">{configured.length}</span>/{platforms.length}</span>
            {overview?.model && <span>model · <span className="text-[#b8b8b8]">{overview.model}</span></span>}
            {overview?.provider && <span>provider · <span className="text-[#b8b8b8]">{overview.provider}</span></span>}
          </div>
        </Panel>
      )}
    </div>
  );
}
