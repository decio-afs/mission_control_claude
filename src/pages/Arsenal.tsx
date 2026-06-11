// ARSENAL — the agent capability surface: installed skills, plugins, MCP
// servers, the external memory provider, and the background skill curator.
// Everything renders live from the Hermes CLI via the bridge.
import { useEffect, useMemo, useState } from 'react';
import { useCapabilitiesStore } from '../stores/useCapabilitiesStore';
import { Panel, Pill, Stat } from '../components/cyberpunk/ui';

const CATEGORY_COLORS: Record<string, string> = {
  'autonomous-ai-agents': '#f64e6e',
  creative: '#a78bfa',
  devops: '#38bdf8',
  productivity: '#10b981',
  'software-development': '#f59e0b',
  research: '#22d3ee',
  media: '#fb7185',
  mlops: '#84cc16',
};

export default function Arsenal() {
  const {
    skills, skillsSummary, mcpServers, plugins, memory, curator,
    arsenalLoading, arsenalError, arsenalLoaded, refreshArsenal, togglePlugin, testMcp,
  } = useCapabilitiesStore();

  const [skillFilter, setSkillFilter] = useState('');
  const [pluginFilter, setPluginFilter] = useState('');
  const [showAllPlugins, setShowAllPlugins] = useState(false);
  const [mcpResults, setMcpResults] = useState<Record<string, string>>({});
  const [mcpBusy, setMcpBusy] = useState<string | null>(null);
  const [pluginBusy, setPluginBusy] = useState<string | null>(null);
  const [pluginMsg, setPluginMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!arsenalLoaded) void refreshArsenal();
  }, [arsenalLoaded, refreshArsenal]);

  const filteredSkills = useMemo(() => {
    const q = skillFilter.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) => s.name.includes(q) || s.category.includes(q) || s.source.includes(q));
  }, [skills, skillFilter]);

  const skillsByCategory = useMemo(() => {
    const groups = new Map<string, typeof skills>();
    for (const s of filteredSkills) {
      const cat = s.category || 'core';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(s);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filteredSkills]);

  const visiblePlugins = useMemo(() => {
    const q = pluginFilter.trim().toLowerCase();
    let list = plugins;
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
    else if (!showAllPlugins) list = list.filter((p) => p.enabled);
    return list;
  }, [plugins, pluginFilter, showAllPlugins]);

  const enabledPlugins = plugins.filter((p) => p.enabled).length;

  const handleTestMcp = async (name: string) => {
    setMcpBusy(name);
    const r = await testMcp(name);
    setMcpResults((m) => ({ ...m, [name]: `${r.ok ? '✓' : '✗'} ${r.message.split('\n')[0].slice(0, 80)}` }));
    setMcpBusy(null);
  };

  const handleTogglePlugin = async (name: string, enable: boolean) => {
    setPluginBusy(name);
    const msg = await togglePlugin(name, enable);
    setPluginMsg(`${name}: ${msg.split('\n')[0].slice(0, 100)}`);
    setPluginBusy(null);
  };

  return (
    <div className="h-full flex flex-col gap-2 p-2 overflow-auto">
      {arsenalError && (
        <div className="shrink-0 px-2 py-1 border border-red-400/40 bg-[#050505]/80 text-red-400 font-mono text-[10px]">
          ⚠ ARSENAL: {arsenalError}
        </div>
      )}

      {/* Top: capability stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 shrink-0">
        <Panel label="SKILLS" className="h-[84px]">
          <Stat label="enabled" value={skillsSummary ? `${skillsSummary.enabled}` : skills.length || '—'} sub={skillsSummary ? `${skillsSummary.hub} hub · ${skillsSummary.builtin} builtin · ${skillsSummary.local} local` : undefined} tone="brand" />
        </Panel>
        <Panel label="PLUGINS" className="h-[84px]">
          <Stat label="enabled / total" value={plugins.length ? `${enabledPlugins} / ${plugins.length}` : '—'} tone="info" />
        </Panel>
        <Panel label="MCP SERVERS" className="h-[84px]">
          <Stat label="connected" value={mcpServers.length || '—'} sub={mcpServers.map((s) => s.name).join(' · ') || undefined} tone="good" />
        </Panel>
        <Panel label="MEMORY" className="h-[84px]">
          <Stat label="provider" value={memory?.provider ?? '—'} sub={memory ? (memory.available ? 'available' : 'unavailable') : undefined} tone={memory?.available ? 'good' : 'warn'} />
        </Panel>
        <Panel label="CURATOR" className="h-[84px]">
          <Stat label="skill maintenance" value={curator ? (curator.enabled ? 'ON' : 'OFF') : '—'} sub={curator ? `${curator.runs ?? '?'} runs · ${curator.interval ?? ''}` : undefined} tone={curator?.enabled ? 'good' : 'warn'} />
        </Panel>
        <Panel label="AGENT SKILLS" className="h-[84px]">
          <Stat label="agent-created" value={curator?.skills_total ?? '—'} sub={curator ? `${curator.active ?? 0} active · ${curator.stale ?? 0} stale` : undefined} tone="white" />
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 flex-1 min-h-0">
        {/* Skills registry */}
        <Panel
          label={`SKILL REGISTRY · ${filteredSkills.length}`}
          className="lg:col-span-2 min-h-[320px]"
          right={
            <input
              value={skillFilter}
              onChange={(e) => setSkillFilter(e.target.value)}
              placeholder="filter skills…"
              className="bg-[#050505] border border-white/10 px-2 py-0.5 text-[10px] font-mono text-white w-[140px] focus:border-[#f64e6e]/50 outline-none"
            />
          }
          bodyClass="overflow-y-auto"
        >
          {arsenalLoading && !skills.length && <div className="font-mono text-[11px] text-[#545454]">querying hermes skills…</div>}
          {!arsenalLoading && !skills.length && <div className="font-mono text-[11px] text-[#545454]">no skills reported by the CLI</div>}
          <div className="flex flex-col gap-3">
            {skillsByCategory.map(([cat, list]) => (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CATEGORY_COLORS[cat] || '#545454' }} />
                  <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#b8b8b8]">{cat}</span>
                  <span className="font-mono text-[10px] text-[#545454]">{list.length}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {list.map((s) => (
                    <span
                      key={s.name}
                      title={`${s.name} · ${s.source} · ${s.trust}${s.enabled ? '' : ' · DISABLED'}`}
                      className={`font-mono text-[10px] px-1.5 py-0.5 border truncate max-w-[180px] ${
                        s.enabled ? 'border-white/10 text-[#b8b8b8]' : 'border-red-400/30 text-red-400/70 line-through'
                      } ${s.source !== 'builtin' ? 'bg-white/[0.03]' : ''}`}
                    >
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <div className="flex flex-col gap-2 min-h-0">
          {/* MCP servers */}
          <Panel label="MCP SERVERS" className="shrink-0">
            {!mcpServers.length && <div className="font-mono text-[11px] text-[#545454]">{arsenalLoading ? 'querying…' : 'no MCP servers configured — hermes mcp add'}</div>}
            <div className="flex flex-col gap-2">
              {mcpServers.map((s) => (
                <div key={s.name} className="border border-white/[0.08] bg-[#0b0b0b] p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Pill tone={s.enabled ? 'good' : 'bad'}>{s.enabled ? 'ON' : 'OFF'}</Pill>
                      <span className="font-mono text-[11px] text-white truncate">{s.name}</span>
                    </div>
                    <button
                      onClick={() => void handleTestMcp(s.name)}
                      disabled={mcpBusy !== null}
                      className="font-mono text-[10px] border border-white/10 px-2 py-0.5 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e] disabled:opacity-40 shrink-0"
                    >
                      {mcpBusy === s.name ? 'TESTING…' : 'TEST'}
                    </button>
                  </div>
                  <div className="font-mono text-[10px] text-[#545454] truncate mt-1">{s.transport} · tools: {s.tools}</div>
                  {mcpResults[s.name] && (
                    <div className={`font-mono text-[10px] mt-1 ${mcpResults[s.name].startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>
                      {mcpResults[s.name]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Panel>

          {/* Memory provider */}
          <Panel label="EXTERNAL MEMORY" className="shrink-0">
            {!memory && <div className="font-mono text-[11px] text-[#545454]">{arsenalLoading ? 'querying…' : 'no data'}</div>}
            {memory && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <Pill tone={memory.available ? 'good' : 'warn'}>{memory.provider ?? 'none'}</Pill>
                  <span className="font-mono text-[10px] text-[#545454]">built-in MEMORY.md always active</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {memory.providers.map((p) => (
                    <span key={p.name} title={p.auth}
                      className={`font-mono text-[10px] px-1.5 py-0.5 border ${p.active ? 'border-emerald-400/40 text-emerald-400' : 'border-white/10 text-[#545454]'}`}>
                      {p.name}{p.active ? ' ●' : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          {/* Curator */}
          <Panel label="SKILL CURATOR" className="flex-1 min-h-[120px]" bodyClass="overflow-y-auto">
            {!curator && <div className="font-mono text-[11px] text-[#545454]">{arsenalLoading ? 'querying…' : 'no data'}</div>}
            {curator && (
              <div className="flex flex-col gap-1.5 font-mono text-[10px]">
                <div className="flex gap-3 text-[#b8b8b8]">
                  <span>last run <span className="text-white">{curator.last_run ?? '—'}</span></span>
                  <span>cadence <span className="text-white">{curator.interval ?? '—'}</span></span>
                </div>
                <div className="text-[#545454] mt-1 tracking-[0.15em] uppercase text-[10px]">most active agent-created skills</div>
                {curator.most_active.map((s) => (
                  <div key={s.name} className="flex items-center justify-between gap-2">
                    <span className="text-[#b8b8b8] truncate">{s.name}</span>
                    <span className="text-[#545454] shrink-0">{s.activity} · {s.last_activity}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* Plugins */}
      <Panel
        label={`PLUGINS · ${enabledPlugins} ENABLED OF ${plugins.length}`}
        className="shrink-0"
        right={
          <>
            <input
              value={pluginFilter}
              onChange={(e) => setPluginFilter(e.target.value)}
              placeholder="filter plugins…"
              className="bg-[#050505] border border-white/10 px-2 py-0.5 text-[10px] font-mono text-white w-[140px] focus:border-[#f64e6e]/50 outline-none"
            />
            <button
              onClick={() => setShowAllPlugins((v) => !v)}
              className={`font-mono text-[10px] border px-2 py-0.5 ${showAllPlugins ? 'border-[#f64e6e]/50 text-[#f64e6e]' : 'border-white/10 text-[#b8b8b8]'} hover:border-[#f64e6e]`}
            >
              {showAllPlugins ? 'ALL' : 'ENABLED'}
            </button>
          </>
        }
        bodyClass="overflow-y-auto max-h-[220px]"
      >
        {pluginMsg && <div className="font-mono text-[10px] text-sky-400 mb-2">▸ {pluginMsg}</div>}
        {!visiblePlugins.length && (
          <div className="font-mono text-[11px] text-[#545454]">
            {arsenalLoading ? 'querying hermes plugins…' : pluginFilter ? 'no plugins match the filter' : 'no plugins enabled — toggle ALL to browse the catalog'}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
          {visiblePlugins.map((p) => (
            <div key={p.name} className="flex items-center justify-between gap-2 border border-white/[0.08] bg-[#0b0b0b] px-2 py-1.5">
              <div className="min-w-0">
                <div className="font-mono text-[10px] text-white truncate" title={p.name}>{p.name}</div>
                <div className="font-mono text-[10px] text-[#545454]">{p.source} · v{p.version}</div>
              </div>
              <button
                onClick={() => void handleTogglePlugin(p.name, !p.enabled)}
                disabled={pluginBusy !== null}
                className={`font-mono text-[10px] border px-2 py-0.5 shrink-0 disabled:opacity-40 ${
                  p.enabled
                    ? 'border-emerald-400/40 text-emerald-400 hover:bg-emerald-400/10'
                    : 'border-white/10 text-[#545454] hover:border-[#f64e6e] hover:text-[#f64e6e]'
                }`}
              >
                {pluginBusy === p.name ? '…' : p.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
