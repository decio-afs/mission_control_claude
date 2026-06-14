import { useCallback, useEffect, useRef, useState } from 'react';
import { useHealthStore } from '../stores/useHealthStore';
import { getMcGateway, gatewayAction, getMcPatches, applyMcPatches, errMessage, type McPatchReport } from '../lib/api';
import { Label, Pill } from './cyberpunk/ui';

// Exposed by electron/preload.cjs in the desktop build; absent in a browser tab.
declare global {
  interface Window {
    missionControl?: {
      desktop: boolean;
      bridgePort: string;
      startBridge?: () => Promise<{ ok: boolean; already: boolean }>;
    };
  }
}

// One auto-start attempt per app session — opening the panel again later
// shouldn't keep respawning a bridge that exits immediately.
let autoStartAttempted = false;
// Same one-shot guard for the messaging gateway (Telegram + kanban dispatcher).
let autoGatewayAttempted = false;

// Two spawn paths, one per runtime:
//  - Electron desktop: preload IPC (window.missionControl.startBridge)
//  - `npm run dev` in a browser: the Vite dev-server middleware at /__bridge/start
// A static production build served outside Electron has neither — the panel
// falls back to showing the manual command.
async function spawnBridge(): Promise<{ ok: boolean; already: boolean }> {
  if (window.missionControl?.startBridge) return window.missionControl.startBridge();
  const res = await fetch('/__bridge/start', { method: 'POST' });
  if (!res.ok) throw new Error(`launcher responded ${res.status}`);
  return res.json();
}

const SPAWN_AVAILABLE = typeof window !== 'undefined' &&
  (typeof window.missionControl?.startBridge === 'function' || import.meta.env.DEV);

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
  const [starting, setStarting] = useState(false);
  const [startMsg, setStartMsg] = useState<string | null>(null);
  const startingRef = useRef(false);

  // Run a fresh probe each time the panel opens.
  useEffect(() => {
    void runDiagnostics();
  }, [runDiagnostics]);

  const okCount = endpoints.filter((e) => e.ok).length;
  const allOk = okCount === endpoints.length;
  // "Down" = a completed probe run where nothing answered (vs. partial outage).
  const bridgeDown = lastRun !== null && !probing && okCount === 0;
  const canSpawn = SPAWN_AVAILABLE;

  const handleStartBridge = async () => {
    if (startingRef.current || !canSpawn) return;
    startingRef.current = true;
    setStarting(true);
    setStartMsg('spawning mc-bridge.py…');
    try {
      const r = await spawnBridge();
      setStartMsg(r.already ? 'bridge already running — re-probing' : r.ok ? 'bridge is up — re-probing' : 'bridge failed to come up — check the app logs');
      if (r.ok) await runDiagnostics();
    } catch (e) {
      setStartMsg(`start failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  // Auto-start: the first time in a session the opening probe finds the bridge
  // dead (desktop build only), bring it up without requiring a click.
  useEffect(() => {
    if (bridgeDown && canSpawn && !autoStartAttempted) {
      autoStartAttempted = true;
      void handleStartBridge();
    }
    // handleStartBridge is stable enough for this one-shot; re-running on each
    // probe is exactly the trigger we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeDown, canSpawn]);

  // ── Messaging gateway (Telegram bots + the embedded kanban dispatcher) ──
  // The gateway is a separate Mc service; if it dies, messaging AND agent
  // task dispatch silently stop. Check it whenever the panel has a live bridge,
  // and auto-start it once per session if it's down.
  // up = api port answering (authoritative); booting = process exists or a
  // start is pending but the api isn't up yet (cold boot can take 60s+).
  const [gw, setGw] = useState<{ up: boolean; booting: boolean; pids: number[] } | null | 'unknown'>('unknown');
  const [gwBusy, setGwBusy] = useState(false);
  const [gwMsg, setGwMsg] = useState<string | null>(null);
  const settleTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const checkGateway = useCallback(async (): Promise<'up' | 'booting' | 'down' | null> => {
    try {
      const g = await getMcGateway();
      const up = g.service.api_listening === true;
      const booting = !up && g.service.running;
      setGw({ up, booting, pids: g.service.pids });
      return up ? 'up' : booting ? 'booting' : 'down';
    } catch {
      setGw(null); // bridge reachable but gateway status unavailable
      return null;
    }
  }, []);

  // Poll until the gateway settles (BOOTING → RUNNING or DOWN). Capped backoff
  // so a cold 60s+ boot is tracked without hammering the CLI.
  const watchUntilSettled = useCallback(() => {
    settleTimers.current.forEach(clearTimeout);
    settleTimers.current = [10, 25, 45, 75, 110].map((s) =>
      setTimeout(() => {
        void checkGateway().then((st) => {
          if (st === 'up') {
            settleTimers.current.forEach(clearTimeout);
            settleTimers.current = [];
            setGwMsg(null);
          }
        });
      }, s * 1000),
    );
  }, [checkGateway]);

  useEffect(() => () => settleTimers.current.forEach(clearTimeout), []);

  const handleStartGateway = useCallback(async () => {
    setGwBusy(true);
    setGwMsg('starting gateway via its service task…');
    try {
      // The bridge starts via the Windows Scheduled Task (clean environment)
      // and reports liveness from the gateway's api port — see the bridge for
      // the zombie/phantom-PID war stories that led here.
      const r = await gatewayAction('restart');
      setGwMsg(r.message?.slice(0, 110) ?? null);
      await checkGateway();
      if (!r.running) watchUntilSettled();
    } catch (e) {
      setGwMsg(`gateway restart failed: ${errMessage(e)}`);
    } finally {
      setGwBusy(false);
    }
  }, [checkGateway, watchUntilSettled]);

  useEffect(() => {
    // Wait for a completed probe run with a reachable bridge — the gateway
    // verbs go through the bridge, so there's nothing to do before that.
    if (probing || lastRun === null || okCount === 0) return;
    void (async () => {
      const state = await checkGateway();
      if (state === 'down' && !autoGatewayAttempted) {
        autoGatewayAttempted = true;
        await handleStartGateway();
      } else if (state === 'booting') {
        watchUntilSettled();
      }
    })();
  }, [probing, lastRun, okCount, checkGateway, handleStartGateway, watchUntilSettled]);

  // ── Mc local patches — the quota-burn fixes are local edits inside the
  // mc-agent checkout; `mc update` (git pull) can drop them. The
  // bridge wraps scripts/mc_patches.py to detect and re-apply.
  const [patches, setPatches] = useState<McPatchReport | null | 'unknown'>('unknown');
  const [patchBusy, setPatchBusy] = useState(false);
  const [patchMsg, setPatchMsg] = useState<string | null>(null);

  useEffect(() => {
    if (probing || lastRun === null || okCount === 0) return;
    getMcPatches().then(setPatches).catch(() => setPatches(null));
  }, [probing, lastRun, okCount]);

  const handleApplyPatches = async () => {
    if (patchBusy) return;
    setPatchBusy(true);
    setPatchMsg('re-applying patches to the mc-agent checkout…');
    try {
      const r = await applyMcPatches();
      setPatches(r);
      if (r.conflicts > 0) {
        setPatchMsg(`${r.changed ?? 0} re-applied, ${r.conflicts} conflict(s) — upstream changed; re-port by hand (see memory notes)`);
      } else if (r.gateway_restart_suggested) {
        setPatchMsg('patches re-applied ✓ — restarting gateway so it loads the patched modules…');
        await handleStartGateway();
      } else {
        setPatchMsg('all patches already in place — nothing to do');
      }
    } catch (e) {
      setPatchMsg(`apply failed: ${errMessage(e)}`);
    } finally {
      setPatchBusy(false);
    }
  };

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
            {bridgeDown && canSpawn && (
              <button
                onClick={() => void handleStartBridge()}
                disabled={starting}
                className="text-[10px] font-mono border border-emerald-400/40 bg-emerald-400/10 text-emerald-400 px-2 py-0.5 hover:bg-emerald-400/20 disabled:opacity-50"
              >
                {starting ? 'STARTING…' : '▶ START BRIDGE'}
              </button>
            )}
            <button
              onClick={() => void runDiagnostics()}
              disabled={probing}
              className="text-[10px] font-mono border border-white/10 px-2 py-0.5 hover:border-[#f64e6e] hover:text-[#f64e6e] disabled:opacity-50"
            >
              {probing ? 'PROBING…' : 'RE-RUN'}
            </button>
            <button onClick={onClose} className="text-[#545454] hover:text-white text-[11px]">✕</button>
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
              <span>mc: <span className="text-[#b8b8b8]">{meta.cli_version}</span></span>
              <span>cli probe: <span className="text-[#b8b8b8]">{meta.cli_probe_ms}ms</span></span>
              <span>python: <span className="text-[#b8b8b8]">{meta.python_version}</span></span>
              <span>server: <span className="text-[#b8b8b8]">{meta.server_time}</span></span>
            </div>
          )}

          {bridgeDown && (
            <div className="text-[10px] font-mono border border-amber-400/30 bg-amber-400/5 px-2 py-1.5 text-amber-400">
              ⚠ BRIDGE OFFLINE — no endpoint answered.
              {canSpawn
                ? ' Use ▶ START BRIDGE above — mc-bridge.py relaunches automatically.'
                : ' Start it from a terminal: npm run bridge — then RE-RUN.'}
            </div>
          )}

          {startMsg && (
            <div className="text-[10px] font-mono text-sky-400 border border-sky-400/30 bg-sky-400/5 px-2 py-1.5">
              ▸ {startMsg}
            </div>
          )}

          {/* Messaging gateway — Telegram bots + the embedded kanban dispatcher.
              Auto-started once per session if the check finds it down. */}
          <div className="flex items-center justify-between gap-2 border border-white/[0.08] bg-[#080808] px-2 py-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <Label className="text-[#545454] shrink-0">GATEWAY</Label>
              {gw === 'unknown' && <span className="text-[10px] font-mono text-[#707070]">checking…</span>}
              {gw === null && <Pill tone="warn">STATUS UNAVAILABLE</Pill>}
              {gw !== null && gw !== 'unknown' && (
                <Pill tone={gw.up ? 'good' : gw.booting ? 'warn' : 'bad'}>
                  {gw.up ? `RUNNING${gw.pids.length ? ` · PID ${gw.pids[0]}` : ''}` : gw.booting ? 'BOOTING…' : 'DOWN'}
                </Pill>
              )}
              <span className="text-[10px] font-mono text-[#707070] truncate hidden sm:inline">telegram bots · kanban dispatcher</span>
            </div>
            {gw !== 'unknown' && gw !== null && !gw.up && !gw.booting && (
              <button
                onClick={() => void handleStartGateway()}
                disabled={gwBusy}
                className="text-[10px] font-mono border border-emerald-400/40 bg-emerald-400/10 text-emerald-400 px-2 py-0.5 hover:bg-emerald-400/20 disabled:opacity-50 shrink-0"
              >
                {gwBusy ? 'STARTING…' : '▶ START GATEWAY'}
              </button>
            )}
          </div>

          {gwMsg && (
            <div className="text-[10px] font-mono text-sky-400 border border-sky-400/30 bg-sky-400/5 px-2 py-1.5">
              ▸ {gwMsg}
            </div>
          )}

          {/* Mc local patches — quota-burn fixes inside the mc-agent
              checkout. `mc update` can drop them; RE-APPLY restores them. */}
          <div className="border border-white/[0.08] bg-[#080808]">
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <Label className="text-[#545454] shrink-0">LOCAL PATCHES</Label>
                {patches === 'unknown' && <span className="text-[10px] font-mono text-[#707070]">checking…</span>}
                {patches === null && <Pill tone="warn">STATUS UNAVAILABLE</Pill>}
                {patches !== null && patches !== 'unknown' && (
                  <Pill tone={patches.all_applied ? 'good' : patches.conflicts > 0 ? 'bad' : 'warn'}>
                    {patches.all_applied
                      ? 'ALL APPLIED'
                      : patches.conflicts > 0
                        ? `${patches.conflicts} CONFLICT`
                        : `${patches.applicable} TO RE-APPLY`}
                  </Pill>
                )}
                <span className="text-[10px] font-mono text-[#707070] truncate hidden sm:inline">kimi quota-burn fixes · survive mc update</span>
              </div>
              {patches !== null && patches !== 'unknown' && !patches.all_applied && patches.applicable > 0 && (
                <button
                  onClick={() => void handleApplyPatches()}
                  disabled={patchBusy}
                  className="text-[10px] font-mono border border-emerald-400/40 bg-emerald-400/10 text-emerald-400 px-2 py-0.5 hover:bg-emerald-400/20 disabled:opacity-50 shrink-0"
                >
                  {patchBusy ? 'APPLYING…' : '⟲ RE-APPLY'}
                </button>
              )}
            </div>
            {/* Per-patch detail only when something needs attention. */}
            {patches !== null && patches !== 'unknown' && !patches.all_applied && (
              <div className="border-t border-white/[0.06] px-2 py-1.5 flex flex-col gap-1">
                {patches.patches.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 text-[10px] font-mono min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.status === 'applied' ? 'bg-emerald-400' : p.status === 'applicable' ? 'bg-amber-400' : 'bg-red-400'}`} />
                    <span className="text-[#d8d8d8] shrink-0">{p.id}</span>
                    <span className="text-[#545454] truncate">{p.description}</span>
                    <span className={`ml-auto shrink-0 ${p.status === 'applied' ? 'text-emerald-400' : p.status === 'applicable' ? 'text-amber-400' : 'text-red-400'}`}>{p.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {patchMsg && (
            <div className="text-[10px] font-mono text-sky-400 border border-sky-400/30 bg-sky-400/5 px-2 py-1.5">
              ▸ {patchMsg}
            </div>
          )}

          {error && !bridgeDown && (
            <div className="text-[10px] font-mono text-red-400 border border-red-400/30 bg-red-400/5 px-2 py-1.5">
              ⚠ bridge meta: {error}
            </div>
          )}

          {/* Endpoint table */}
          <div className="border border-white/[0.08]">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1.5 border-b border-white/10 bg-[#080808] text-[10px] font-mono uppercase tracking-[0.18em] text-[#545454]">
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
                  <div className="text-[10px] text-[#444] truncate pl-3.5">{e.path}</div>
                  {e.error && <div className="text-[10px] text-red-400/80 truncate pl-3.5">{e.error}</div>}
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

          <div className="text-[10px] font-mono text-[#444] flex justify-between">
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
