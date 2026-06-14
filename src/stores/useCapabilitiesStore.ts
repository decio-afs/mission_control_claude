// Store for the full Mc capability surface — backs the Arsenal (skills /
// plugins / MCP / memory / curator), Uplink (gateway / channels / send /
// webhooks) and Systems (doctor / insights / logs / model / security) modules.
// Each domain has its own loading flag + error so one slow CLI call doesn't
// block the rest of the page.
import { create } from 'zustand';
import {
  getMcOverview, getMcSkills, getMcMcp, testMcMcp,
  getMcPlugins, setMcPlugin, getMcGateway, gatewayAction,
  getSendTargets, sendPlatformMessage, getMcWebhooks, getMcMemory,
  getMcCurator, getMcInsights, getMcDoctor, getMcLogs,
  getMcModel, getMcAuth, getMcCheckpoints, runSecurityAudit,
  errMessage,
  type McOverview, type McSkill, type SkillsSummary, type McMcpServer,
  type McPlugin, type McGatewayInfo, type SendTargets, type McWebhooks,
  type McMemoryStatus, type McCuratorStatus, type McInsights,
  type McDoctor, type McModelInfo, type McAuthInfo,
} from '../lib/api';

interface CapabilitiesStore {
  // ── Arsenal ──
  skills: McSkill[];
  skillsSummary: SkillsSummary | null;
  mcpServers: McMcpServer[];
  plugins: McPlugin[];
  memory: McMemoryStatus | null;
  curator: McCuratorStatus | null;
  arsenalLoading: boolean;
  arsenalError: string | null;
  arsenalLoaded: boolean;
  refreshArsenal: () => Promise<void>;
  togglePlugin: (name: string, enable: boolean) => Promise<string>;
  testMcp: (name: string) => Promise<{ ok: boolean; message: string }>;

  // ── Uplink ──
  overview: McOverview | null;
  gateway: McGatewayInfo | null;
  sendTargets: SendTargets | null;
  webhooks: McWebhooks | null;
  uplinkLoading: boolean;
  uplinkError: string | null;
  uplinkLoaded: boolean;
  refreshUplink: () => Promise<void>;
  runGatewayAction: (action: 'start' | 'stop' | 'restart') => Promise<string>;
  transmit: (target: string, message: string, subject?: string) => Promise<string>;

  // ── Systems ──
  model: McModelInfo | null;
  auth: McAuthInfo | null;
  checkpoints: string | null;
  doctor: McDoctor | null;
  doctorLoading: boolean;
  insights: McInsights | null;
  insightsDays: number;
  insightsLoading: boolean;
  logName: string;
  logLines: string[];
  logLoading: boolean;
  audit: { vulnerabilities: number; raw: string } | null;
  auditLoading: boolean;
  systemsLoading: boolean;
  systemsError: string | null;
  systemsLoaded: boolean;
  refreshSystems: () => Promise<void>;
  runDoctor: () => Promise<void>;
  fetchInsights: (days: number) => Promise<void>;
  fetchLogs: (name?: string, lines?: number, level?: string) => Promise<void>;
  runAudit: () => Promise<void>;
}

export const useCapabilitiesStore = create<CapabilitiesStore>((set, get) => ({
  skills: [],
  skillsSummary: null,
  mcpServers: [],
  plugins: [],
  memory: null,
  curator: null,
  arsenalLoading: false,
  arsenalError: null,
  arsenalLoaded: false,

  refreshArsenal: async () => {
    set({ arsenalLoading: true, arsenalError: null });
    // Fire all five in parallel; surface the first failure but keep partial data.
    const [skills, mcp, plugins, memory, curator] = await Promise.allSettled([
      getMcSkills(), getMcMcp(), getMcPlugins(), getMcMemory(), getMcCurator(),
    ]);
    const firstErr = [skills, mcp, plugins, memory, curator].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    set({
      ...(skills.status === 'fulfilled' ? { skills: skills.value.skills, skillsSummary: skills.value.summary } : {}),
      ...(mcp.status === 'fulfilled' ? { mcpServers: mcp.value.servers } : {}),
      ...(plugins.status === 'fulfilled' ? { plugins: plugins.value.plugins } : {}),
      ...(memory.status === 'fulfilled' ? { memory: memory.value } : {}),
      ...(curator.status === 'fulfilled' ? { curator: curator.value } : {}),
      arsenalLoading: false,
      arsenalLoaded: true,
      arsenalError: firstErr ? errMessage(firstErr.reason) : null,
    });
  },

  togglePlugin: async (name, enable) => {
    try {
      const r = await setMcPlugin(name, enable);
      const plugins = await getMcPlugins();
      set({ plugins: plugins.plugins });
      return r.message || `${name} ${enable ? 'enabled' : 'disabled'}`;
    } catch (e) {
      return `FAILED: ${errMessage(e)}`;
    }
  },

  testMcp: async (name) => {
    try {
      return await testMcMcp(name);
    } catch (e) {
      return { ok: false, message: errMessage(e) };
    }
  },

  overview: null,
  gateway: null,
  sendTargets: null,
  webhooks: null,
  uplinkLoading: false,
  uplinkError: null,
  uplinkLoaded: false,

  refreshUplink: async () => {
    set({ uplinkLoading: true, uplinkError: null });
    const [overview, gateway, targets, webhooks] = await Promise.allSettled([
      getMcOverview(), getMcGateway(), getSendTargets(), getMcWebhooks(),
    ]);
    const firstErr = [overview, gateway, targets, webhooks].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    set({
      ...(overview.status === 'fulfilled' ? { overview: overview.value } : {}),
      ...(gateway.status === 'fulfilled' ? { gateway: gateway.value } : {}),
      ...(targets.status === 'fulfilled' ? { sendTargets: targets.value } : {}),
      ...(webhooks.status === 'fulfilled' ? { webhooks: webhooks.value } : {}),
      uplinkLoading: false,
      uplinkLoaded: true,
      uplinkError: firstErr ? errMessage(firstErr.reason) : null,
    });
  },

  runGatewayAction: async (action) => {
    try {
      const r = await gatewayAction(action);
      const gateway = await getMcGateway();
      set({ gateway });
      return r.message || `gateway ${action} ok`;
    } catch (e) {
      return `FAILED: ${errMessage(e)}`;
    }
  },

  transmit: async (target, message, subject) => {
    try {
      const r = await sendPlatformMessage({ target, message, subject });
      return r.message || 'delivered';
    } catch (e) {
      return `FAILED: ${errMessage(e)}`;
    }
  },

  model: null,
  auth: null,
  checkpoints: null,
  doctor: null,
  doctorLoading: false,
  insights: null,
  insightsDays: 7,
  insightsLoading: false,
  logName: 'agent',
  logLines: [],
  logLoading: false,
  audit: null,
  auditLoading: false,
  systemsLoading: false,
  systemsError: null,
  systemsLoaded: false,

  refreshSystems: async () => {
    set({ systemsLoading: true, systemsError: null });
    const [model, auth, checkpoints] = await Promise.allSettled([
      getMcModel(), getMcAuth(), getMcCheckpoints(),
    ]);
    const firstErr = [model, auth, checkpoints].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    set({
      ...(model.status === 'fulfilled' ? { model: model.value } : {}),
      ...(auth.status === 'fulfilled' ? { auth: auth.value } : {}),
      ...(checkpoints.status === 'fulfilled' ? { checkpoints: checkpoints.value.raw } : {}),
      systemsLoading: false,
      systemsLoaded: true,
      systemsError: firstErr ? errMessage(firstErr.reason) : null,
    });
    // Kick off the default insights + log tail in the background.
    if (!get().insights) void get().fetchInsights(get().insightsDays);
    if (!get().logLines.length) void get().fetchLogs();
  },

  runDoctor: async () => {
    set({ doctorLoading: true });
    try {
      set({ doctor: await getMcDoctor() });
    } catch (e) {
      set({ systemsError: errMessage(e) });
    } finally {
      set({ doctorLoading: false });
    }
  },

  fetchInsights: async (days) => {
    set({ insightsLoading: true, insightsDays: days });
    try {
      set({ insights: await getMcInsights(days) });
    } catch (e) {
      set({ systemsError: errMessage(e) });
    } finally {
      set({ insightsLoading: false });
    }
  },

  fetchLogs: async (name = get().logName, lines = 100, level) => {
    set({ logLoading: true, logName: name });
    try {
      const r = await getMcLogs(name, lines, level);
      set({ logLines: r.lines });
    } catch (e) {
      set({ logLines: [`log fetch failed: ${errMessage(e)}`] });
    } finally {
      set({ logLoading: false });
    }
  },

  runAudit: async () => {
    set({ auditLoading: true });
    try {
      set({ audit: await runSecurityAudit() });
    } catch (e) {
      set({ systemsError: errMessage(e) });
    } finally {
      set({ auditLoading: false });
    }
  },
}));
