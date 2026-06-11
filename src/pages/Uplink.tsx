// UPLINK — Hermes comms integrations: the messaging gateway service, the
// per-platform channel matrix, a direct transmit console (`hermes send`), and
// webhook event subscriptions. All live from the CLI via the bridge.
import { useEffect, useMemo, useState } from 'react';
import { useCapabilitiesStore } from '../stores/useCapabilitiesStore';
import { Panel, Pill, Stat } from '../components/cyberpunk/ui';

export default function Uplink() {
  const {
    overview, gateway, sendTargets, webhooks,
    uplinkLoading, uplinkError, uplinkLoaded, refreshUplink, runGatewayAction, transmit,
  } = useCapabilitiesStore();

  const [gwBusy, setGwBusy] = useState<string | null>(null);
  const [gwMsg, setGwMsg] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendLog, setSendLog] = useState<{ ok: boolean; text: string }[]>([]);

  useEffect(() => {
    if (!uplinkLoaded) void refreshUplink();
  }, [uplinkLoaded, refreshUplink]);

  const targetOptions = useMemo(() => {
    const opts: string[] = [];
    for (const p of sendTargets?.platforms ?? []) {
      // Bare platform name == home channel; explicit targets follow.
      opts.push(p.platform.toLowerCase());
      for (const t of p.targets) {
        const explicit = t.split(/\s/)[0];
        if (explicit && !opts.includes(explicit)) opts.push(explicit);
      }
    }
    return opts;
  }, [sendTargets]);

  // Derive the effective target instead of syncing state in an effect — the
  // select shows the first configured target until the user picks one.
  const effectiveTarget = target || targetOptions[0] || '';

  const configured = overview?.platforms.filter((p) => p.configured) ?? [];
  const runningGateways = gateway?.gateways.filter((g) => g.running) ?? [];

  const handleGateway = async (action: 'start' | 'stop' | 'restart') => {
    setGwBusy(action);
    const msg = await runGatewayAction(action);
    setGwMsg(msg.split('\n')[0].slice(0, 120));
    setGwBusy(null);
  };

  const handleTransmit = async () => {
    if (!effectiveTarget.trim() || !message.trim() || sending) return;
    setSending(true);
    const r = await transmit(effectiveTarget.trim(), message.trim(), subject.trim() || undefined);
    const ok = !r.startsWith('FAILED');
    setSendLog((l) => [{ ok, text: `→ ${effectiveTarget} · ${ok ? 'delivered' : r.slice(0, 120)}` }, ...l].slice(0, 8));
    if (ok) setMessage('');
    setSending(false);
  };

  return (
    <div className="h-full flex flex-col gap-2 p-2 overflow-auto">
      {uplinkError && (
        <div className="shrink-0 px-2 py-1 border border-red-400/40 bg-[#050505]/80 text-red-400 font-mono text-[10px]">
          ⚠ UPLINK: {uplinkError}
        </div>
      )}

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 shrink-0">
        <Panel label="GATEWAY" className="h-[84px]">
          <Stat label="service" value={gateway ? (gateway.service.running ? 'RUNNING' : 'DOWN') : '—'}
            sub={gateway?.service.pids.length ? `PID ${gateway.service.pids.join(', ')}` : undefined}
            tone={gateway?.service.running ? 'good' : 'warn'} />
        </Panel>
        <Panel label="CHANNELS" className="h-[84px]">
          <Stat label="configured" value={overview ? `${configured.length} / ${overview.platforms.length}` : '—'}
            sub={configured.map((p) => p.name).join(' · ') || 'none configured'} tone="info" />
        </Panel>
        <Panel label="PROFILE GATEWAYS" className="h-[84px]">
          <Stat label="running" value={gateway ? `${runningGateways.length} / ${gateway.gateways.length}` : '—'} tone="brand" />
        </Panel>
        <Panel label="WEBHOOKS" className="h-[84px]">
          <Stat label="event subscriptions" value={webhooks ? (webhooks.enabled ? `${webhooks.subscriptions.length}` : 'OFF') : '—'}
            sub={webhooks && !webhooks.enabled ? 'hermes gateway setup to enable' : undefined}
            tone={webhooks?.enabled ? 'good' : 'warn'} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 flex-1 min-h-0">
        <div className="flex flex-col gap-2 min-h-0">
          {/* Gateway service control */}
          <Panel label="GATEWAY SERVICE" className="shrink-0"
            right={
              <div className="flex gap-1">
                {(['start', 'stop', 'restart'] as const).map((a) => (
                  <button key={a} onClick={() => void handleGateway(a)} disabled={gwBusy !== null}
                    className="font-mono text-[10px] border border-white/10 px-2 py-0.5 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e] disabled:opacity-40 uppercase">
                    {gwBusy === a ? '…' : a}
                  </button>
                ))}
              </div>
            }>
            {gwMsg && <div className="font-mono text-[10px] text-sky-400 mb-2">▸ {gwMsg}</div>}
            {!gateway && <div className="font-mono text-[11px] text-[#545454]">{uplinkLoading ? 'querying gateway…' : 'no data'}</div>}
            {gateway && (
              <div className="flex flex-col gap-1 font-mono text-[10px] max-h-[200px] overflow-y-auto">
                {gateway.gateways.map((g) => (
                  <div key={g.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${g.running ? 'bg-emerald-400' : 'bg-[#363636]'}`} />
                      <span className={`truncate ${g.running ? 'text-white' : 'text-[#545454]'}`}>{g.name}</span>
                      {g.current && <Pill tone="brand" className="!text-[10px] !px-1">CURRENT</Pill>}
                    </div>
                    <span className="text-[#545454] shrink-0">{g.running ? `PID ${g.pid}` : 'idle'}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Channel matrix */}
          <Panel label="CHANNEL MATRIX" className="flex-1 min-h-[160px]" bodyClass="overflow-y-auto">
            {!overview && <div className="font-mono text-[11px] text-[#545454]">{uplinkLoading ? 'querying platforms…' : 'no data'}</div>}
            <div className="grid grid-cols-2 gap-1.5">
              {(overview?.platforms ?? []).map((p) => (
                <div key={p.name}
                  className={`border px-2 py-1.5 font-mono text-[10px] ${p.configured ? 'border-emerald-400/30 bg-emerald-400/5' : 'border-white/[0.06] bg-[#0b0b0b]'}`}>
                  <div className={`truncate ${p.configured ? 'text-emerald-400' : 'text-[#545454]'}`}>{p.name}</div>
                  <div className="text-[10px] text-[#545454] truncate">{p.configured ? (p.home ? `home ${p.home}` : 'configured') : 'not configured'}</div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Transmit console */}
        <Panel label="TRANSMIT · HERMES SEND" className="min-h-[280px]" bodyClass="flex flex-col gap-2">
          <div>
            <div className="font-mono text-[10px] text-[#545454] tracking-[0.15em] uppercase mb-1">target</div>
            <div className="flex gap-1.5">
              <select value={effectiveTarget} onChange={(e) => setTarget(e.target.value)}
                className="flex-1 bg-[#050505] border border-white/10 px-2 py-1.5 text-[11px] font-mono text-white focus:border-[#f64e6e]/50 outline-none min-w-0">
                {targetOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                {!targetOptions.length && <option value="">no targets — configure a platform</option>}
              </select>
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] text-[#545454] tracking-[0.15em] uppercase mb-1">subject · optional</div>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="[MISSION CONTROL]"
              className="w-full bg-[#050505] border border-white/10 px-2 py-1.5 text-[11px] font-mono text-white focus:border-[#f64e6e]/50 outline-none" />
          </div>
          <div className="flex-1 flex flex-col min-h-0">
            <div className="font-mono text-[10px] text-[#545454] tracking-[0.15em] uppercase mb-1">message</div>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="payload to deliver…"
              className="flex-1 min-h-[80px] w-full bg-[#050505] border border-white/10 px-2 py-1.5 text-[11px] font-mono text-white focus:border-[#f64e6e]/50 outline-none resize-none" />
          </div>
          <button onClick={() => void handleTransmit()} disabled={sending || !effectiveTarget.trim() || !message.trim()}
            className="font-mono text-[10px] border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] py-1.5 hover:bg-[#f64e6e]/20 disabled:opacity-30">
            {sending ? 'TRANSMITTING…' : '▷ TRANSMIT'}
          </button>
          {sendLog.length > 0 && (
            <div className="flex flex-col gap-0.5 font-mono text-[10px] max-h-[70px] overflow-y-auto">
              {sendLog.map((l, i) => (
                <div key={i} className={l.ok ? 'text-emerald-400' : 'text-red-400'}>{l.text}</div>
              ))}
            </div>
          )}
        </Panel>

        {/* Webhooks + API keys */}
        <div className="flex flex-col gap-2 min-h-0">
          <Panel label="WEBHOOK SUBSCRIPTIONS" className="shrink-0">
            {!webhooks && <div className="font-mono text-[11px] text-[#545454]">{uplinkLoading ? 'querying…' : 'no data'}</div>}
            {webhooks && !webhooks.enabled && (
              <div className="font-mono text-[10px] text-[#b8b8b8] leading-relaxed">
                <Pill tone="warn" className="mb-2">PLATFORM DISABLED</Pill>
                <div className="text-[#545454] mt-1.5">
                  Event-driven agent activation is off. Enable with <span className="text-[#f64e6e]">hermes gateway setup</span> or
                  set <span className="text-white">WEBHOOK_ENABLED=true</span> in ~/.hermes/.env, then restart the gateway.
                </div>
              </div>
            )}
            {webhooks?.enabled && !webhooks.subscriptions.length && (
              <div className="font-mono text-[11px] text-[#545454]">enabled — no subscriptions yet (hermes webhook add)</div>
            )}
            {webhooks?.enabled && webhooks.subscriptions.map((s, i) => (
              <div key={i} className="font-mono text-[10px] text-[#b8b8b8] border-b border-white/[0.05] py-1 truncate">
                {s.cells.join(' · ')}
              </div>
            ))}
          </Panel>

          <Panel label="PROVIDER KEYS" className="flex-1 min-h-[140px]" bodyClass="overflow-y-auto">
            {!overview && <div className="font-mono text-[11px] text-[#545454]">{uplinkLoading ? 'querying…' : 'no data'}</div>}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {(overview?.api_keys ?? []).map((k) => (
                <div key={k.name} className="flex items-center justify-between gap-2 font-mono text-[10px]">
                  <span className={`truncate ${k.set ? 'text-[#b8b8b8]' : 'text-[#545454]'}`}>{k.name}</span>
                  <span className={`shrink-0 ${k.set ? 'text-emerald-400' : 'text-[#363636]'}`}>{k.set ? '●' : '○'}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
