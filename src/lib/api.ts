import axios from 'axios';

// ---------------------------------------------------------------------------
// Hermes Bridge client
// ---------------------------------------------------------------------------
// Mission Control talks to the local Hermes bridge (hermes-bridge.py), a thin
// FastAPI wrapper around the `hermes` CLI. There is no other backend — every
// screen renders live data sourced from Hermes.
const BRIDGE_BASE_URL = import.meta.env.VITE_BRIDGE_URL || 'http://localhost:8767';

export const bridge = axios.create({
  baseURL: BRIDGE_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

/** Extract a human-readable message from an unknown thrown value. */
export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Unknown error';
}

// ---------------------------------------------------------------------------
// Types — mirror the Hermes CLI JSON shapes
// ---------------------------------------------------------------------------
export interface HermesAgent {
  name: string;
  on_disk: boolean;
  counts: Record<string, number>;
}

export interface HermesTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: string;
  priority: number;
  tenant: string | null;
  workspace_kind: string;
  workspace_path: string | null;
  branch_name: string | null;
  created_by: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
  skills: string[];
  max_retries: number | null;
  session_id: string | null;
  workflow_template_id: string | null;
  current_step_key: string | null;
}

export interface HermesCronJob {
  id: string;
  status: string;
  name?: string;
  schedule?: string;
  repeat?: string;
  deliver?: string;
  script?: string;
}

export interface HermesStatus {
  hermes_version: string;
  bridge: string;
}

export interface HermesActivity {
  id: string;
  agent: string;
  action: string;
  timestamp: number;
  status: string;
}

export interface HermesBriefing {
  summary: string;
  trend: string[];
  fin: string[];
  arc: string[];
  forecast: string[];
  prompts: string[];
  directives: Array<{ sev: 'HIGH' | 'WARN' | 'INFO'; t: string; msg: string }>;
}

// ---------------------------------------------------------------------------
// Bridge API helpers
// ---------------------------------------------------------------------------
export async function getHermesStatus(): Promise<HermesStatus> {
  const { data } = await bridge.get('/api/hermes/status');
  return data;
}

export async function getHermesAgents(): Promise<{ agents: HermesAgent[] }> {
  const { data } = await bridge.get('/api/hermes/agents');
  return data;
}

export async function getHermesTasks(): Promise<{ tasks: HermesTask[] }> {
  const { data } = await bridge.get('/api/hermes/tasks');
  return data;
}

export async function createHermesTask(payload: { title: string; body?: string; assignee?: string; priority?: number; skills?: string[]; parents?: string[]; triage?: boolean; max_retries?: number | null }) {
  const { data } = await bridge.post('/api/hermes/tasks', payload);
  return data;
}

export async function claimHermesTask(taskId: string) {
  const { data } = await bridge.post(`/api/hermes/tasks/${taskId}/claim`);
  return data;
}

export async function completeHermesTask(taskId: string) {
  const { data } = await bridge.post(`/api/hermes/tasks/${taskId}/complete`);
  return data;
}

export async function blockHermesTask(taskId: string, reason: string) {
  const { data } = await bridge.post(`/api/hermes/tasks/${taskId}/block`, { reason });
  return data;
}

// ── Full kanban task control (mirrors `hermes kanban` verbs) ──────────────
export interface TaskComment { author: string; body: string; created_at: number }
export interface TaskEvent { kind: string; payload: Record<string, unknown> | null; created_at: number; run_id: string | null }
export interface TaskRun { run_id?: string; profile?: string; outcome?: string; elapsed?: number | string; summary?: string; [k: string]: unknown }
export interface TaskDetail {
  task: HermesTask;
  latest_summary: string | null;
  parents: string[];
  children: string[];
  comments: TaskComment[];
  events: TaskEvent[];
  runs: TaskRun[];
}
export interface KanbanStats {
  by_status: Record<string, number>;
  by_assignee: Record<string, Record<string, number>>;
  oldest_ready_age_seconds: number | null;
  now: number;
}

export async function getHermesTaskDetail(taskId: string): Promise<TaskDetail> {
  const { data } = await bridge.get(`/api/hermes/tasks/${taskId}`);
  return data;
}

export async function getKanbanStats(): Promise<KanbanStats> {
  const { data } = await bridge.get('/api/hermes/kanban/stats');
  return data;
}

export async function unblockHermesTask(taskId: string, reason?: string) {
  const { data } = await bridge.post(`/api/hermes/tasks/${taskId}/unblock`, { reason });
  return data;
}

export async function promoteHermesTask(taskId: string, reason?: string, force?: boolean) {
  const { data } = await bridge.post(`/api/hermes/tasks/${taskId}/promote`, { reason, force });
  return data;
}

export async function scheduleHermesTask(taskId: string, reason?: string) {
  const { data } = await bridge.post(`/api/hermes/tasks/${taskId}/schedule`, { reason });
  return data;
}

export async function archiveHermesTask(taskId: string) {
  const { data } = await bridge.post(`/api/hermes/tasks/${taskId}/archive`);
  return data;
}

export async function assignHermesTask(taskId: string, profile: string) {
  const { data } = await bridge.post(`/api/hermes/tasks/${taskId}/assign`, { profile });
  return data;
}

export async function reassignHermesTask(taskId: string, profile: string, reclaim?: boolean, reason?: string) {
  const { data } = await bridge.post(`/api/hermes/tasks/${taskId}/reassign`, { profile, reclaim, reason });
  return data;
}

export async function reclaimHermesTask(taskId: string) {
  const { data } = await bridge.post(`/api/hermes/tasks/${taskId}/reclaim`);
  return data;
}

export async function commentHermesTask(taskId: string, text: string, author?: string) {
  const { data } = await bridge.post(`/api/hermes/tasks/${taskId}/comment`, { text, author });
  return data;
}

export async function editHermesTask(taskId: string, result: string, summary?: string, metadata?: string) {
  const { data } = await bridge.post(`/api/hermes/tasks/${taskId}/edit`, { result, summary, metadata });
  return data;
}

export async function linkHermesTasks(parentId: string, childId: string) {
  const { data } = await bridge.post('/api/hermes/tasks/link', { parent_id: parentId, child_id: childId });
  return data;
}

export async function unlinkHermesTasks(parentId: string, childId: string) {
  const { data } = await bridge.post('/api/hermes/tasks/unlink', { parent_id: parentId, child_id: childId });
  return data;
}

// ── Worker insight / specify / notify / boards ────────────────────────────
export interface NotifySubscription { platform?: string; chat_id?: string; thread_id?: string | null; user_id?: string | null; [k: string]: unknown }
export interface KanbanBoard {
  slug: string; name: string; description?: string; icon?: string; color?: string;
  is_current?: boolean; archived?: boolean; counts?: Record<string, number>; [k: string]: unknown;
}
export interface BoardDiagnostic {
  task_id: string; title?: string; status?: string; assignee?: string | null;
  diagnostics: Array<{ kind?: string; severity?: string; message?: string; [k: string]: unknown }>;
}

export async function specifyHermesTask(taskId: string) {
  const { data } = await bridge.post(`/api/hermes/tasks/${taskId}/specify`, {}, { timeout: 190000 });
  return data;
}

export async function getHermesTaskLog(taskId: string, tail?: number): Promise<{ log: string }> {
  const { data } = await bridge.get(`/api/hermes/tasks/${taskId}/log`, { params: tail ? { tail } : undefined });
  return data;
}

export async function getHermesTaskContext(taskId: string): Promise<{ context: string }> {
  const { data } = await bridge.get(`/api/hermes/tasks/${taskId}/context`);
  return data;
}

export async function getKanbanDiagnostics(): Promise<{ diagnostics: BoardDiagnostic[] }> {
  const { data } = await bridge.get('/api/hermes/kanban/diagnostics');
  return data;
}

export async function getTaskNotifications(taskId: string): Promise<{ subscriptions: NotifySubscription[] }> {
  const { data } = await bridge.get(`/api/hermes/tasks/${taskId}/notify`);
  return data;
}

export async function subscribeTaskNotify(taskId: string, payload: { platform: string; chat_id: string; thread_id?: string; user_id?: string }) {
  const { data } = await bridge.post(`/api/hermes/tasks/${taskId}/notify`, payload);
  return data;
}

export async function unsubscribeTaskNotify(taskId: string, payload: { platform: string; chat_id: string; thread_id?: string }) {
  const { data } = await bridge.post(`/api/hermes/tasks/${taskId}/notify/unsubscribe`, payload);
  return data;
}

export async function getHermesBoards(): Promise<{ boards: KanbanBoard[] }> {
  const { data } = await bridge.get('/api/hermes/boards');
  return data;
}

export async function createHermesBoard(payload: { slug: string; name?: string; description?: string; switch?: boolean }) {
  const { data } = await bridge.post('/api/hermes/boards', payload);
  return data;
}

export async function switchHermesBoard(slug: string) {
  const { data } = await bridge.post('/api/hermes/boards/switch', { slug });
  return data;
}

export async function getHermesCron(): Promise<{ jobs: HermesCronJob[]; raw: string }> {
  const { data } = await bridge.get('/api/hermes/cron');
  return data;
}

export async function runHermesCron(jobId: string) {
  const { data } = await bridge.post(`/api/hermes/cron/${jobId}/run`);
  return data;
}

export interface CreateCronRequest {
  /** Schedule like '30m', 'every 2h', or '0 9 * * *'. */
  schedule: string;
  /** Optional self-contained prompt / task instruction. */
  prompt?: string;
  name?: string;
  /** Delivery target: origin, local, telegram, discord, signal, or platform:chat_id. */
  deliver?: string;
  repeat?: string;
  skills?: string[];
}

export async function createHermesCron(payload: CreateCronRequest): Promise<{ message: string; jobs: HermesCronJob[] }> {
  // Creating a cron job can shell out to `hermes cron create`; keep within client default timeout.
  const { data } = await bridge.post('/api/hermes/cron', payload);
  return data;
}

export interface AgentCreateRequest {
  name: string;
  role: string;
  skills: string[];
  model?: string;
}

export interface AgentUpdateRequest {
  name?: string;
  role?: string;
  skills?: string[];
  model?: string;
}

export interface SpawnRequest {
  goal: string;
  model?: string;
  skills?: string[];
}

export interface TaskDecomposeRequest {
  task: string;
}

export interface TaskDecomposeResponse {
  subtasks: { title: string; body?: string; assignee?: string }[];
}

export async function createHermesAgent(payload: AgentCreateRequest) {
  const { data } = await bridge.post('/api/hermes/agents', payload);
  return data;
}

export async function updateHermesAgent(id: string, payload: AgentUpdateRequest) {
  const { data } = await bridge.put(`/api/hermes/agents/${id}`, payload);
  return data;
}

export async function deleteHermesAgent(id: string) {
  const { data } = await bridge.delete(`/api/hermes/agents/${id}`);
  return data;
}

export async function spawnAgentOnTask(agentId: string, taskId: string) {
  const { data } = await bridge.post(`/api/hermes/agents/${agentId}/spawn`, { task_id: taskId });
  return data;
}

export async function decomposeTask(payload: TaskDecomposeRequest) {
  const { data } = await bridge.post('/api/hermes/tasks/decompose', payload, { timeout: 125000 });
  return data;
}

export async function spawnHermesAgent(payload: SpawnRequest) {
  // LLM spawns are slow; the bridge allows 120s, so override the 30s client default.
  const { data } = await bridge.post('/api/hermes/spawn', payload, { timeout: 125000 });
  return data;
}

export interface ChatAttachmentUpload {
  name: string;
  mime?: string;
  /** base64-encoded contents (raw base64 or a full data: URL) */
  data: string;
}

export async function sendHermesChat(payload: { message: string; model?: string; skills?: string[]; attachments?: ChatAttachmentUpload[]; session_id?: string }): Promise<{ response: string; session_id: string | null; stderr: string; success: boolean }> {
  // Chat round-trips invoke the model and can take well over the 30s client
  // default; the bridge allows 180s, so match it here to avoid premature aborts.
  const { data } = await bridge.post('/api/hermes/chat', payload, { timeout: 185000 });
  return data;
}

// ── Hermes sessions (the persistent SQLite session store) ──────────────────
export interface HermesSession {
  id: string;
  title: string;
  preview: string;
  last_active: string;
  source: string;
}

export interface HermesSessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string | number | null;
  tool_name?: string | null;
}

export interface HermesSessionDetail {
  id: string;
  title: string;
  cwd: string | null;
  source: string | null;
  message_count: number;
  started_at: string | number | null;
  ended_at: string | number | null;
  messages: HermesSessionMessage[];
}

export async function getHermesSessions(limit = 100, source?: string): Promise<{ sessions: HermesSession[] }> {
  const { data } = await bridge.get('/api/hermes/sessions', { params: { limit, ...(source ? { source } : {}) } });
  return data;
}

export async function getHermesSession(id: string): Promise<HermesSessionDetail> {
  const { data } = await bridge.get(`/api/hermes/sessions/${encodeURIComponent(id)}`);
  return data;
}

export async function renameHermesSession(id: string, title: string) {
  const { data } = await bridge.post(`/api/hermes/sessions/${encodeURIComponent(id)}/rename`, { title });
  return data;
}

export async function deleteHermesSession(id: string) {
  const { data } = await bridge.delete(`/api/hermes/sessions/${encodeURIComponent(id)}`);
  return data;
}

export async function getTranscribeStatus(): Promise<{ available: boolean; model: string; loadError: string | null }> {
  const { data } = await bridge.get('/api/transcribe/status');
  return data;
}

export async function transcribeAudio(audio: string, mime?: string): Promise<{ text: string }> {
  // Whisper inference on CPU can take a few seconds for longer clips.
  const { data } = await bridge.post('/api/transcribe', { audio, mime }, { timeout: 120000 });
  return data;
}

export async function getHermesBriefing(): Promise<HermesBriefing> {
  const { data } = await bridge.get('/api/hermes/briefing');
  return data;
}

export async function getHermesActivity(): Promise<{ activities: HermesActivity[] }> {
  const { data } = await bridge.get('/api/hermes/activity');
  return data;
}

// ---------------------------------------------------------------------------
// Bridge health / diagnostics
// ---------------------------------------------------------------------------
export interface HermesHealth {
  bridge: string;
  port: number;
  uptime_seconds: number;
  python_version: string;
  hermes_cmd: string;
  cli_ok: boolean;
  cli_version: string;
  cli_probe_ms: number;
  cli_error: string | null;
  server_time: string;
}

export async function getHermesHealth(): Promise<HermesHealth> {
  const { data } = await bridge.get('/api/hermes/health');
  return data;
}

/** GET endpoints the Diagnostics panel probes for per-endpoint latency/status. */
export interface BridgeEndpoint {
  key: string;
  label: string;
  path: string;
}

export const BRIDGE_ENDPOINTS: BridgeEndpoint[] = [
  { key: 'status',   label: 'Status',          path: '/api/hermes/status' },
  { key: 'health',   label: 'Health',          path: '/api/hermes/health' },
  { key: 'agents',   label: 'Agents',          path: '/api/hermes/agents' },
  { key: 'tasks',    label: 'Tasks',           path: '/api/hermes/tasks' },
  { key: 'cron',     label: 'Cron',            path: '/api/hermes/cron' },
  { key: 'activity', label: 'Activity',        path: '/api/hermes/activity' },
  { key: 'content',  label: 'Content Pipeline', path: '/api/content/pipeline' },
  { key: 'briefing', label: 'Briefing',        path: '/api/hermes/briefing' },
  { key: 'sentinel', label: 'Sentinel Digest', path: '/api/sentinel/digest' },
  { key: 'leads',    label: 'Leads',           path: '/api/hermes/leads' },
  { key: 'skills',   label: 'Skills',          path: '/api/hermes/skills' },
  { key: 'mcp',      label: 'MCP Servers',     path: '/api/hermes/mcp' },
  { key: 'gateway',  label: 'Gateway',         path: '/api/hermes/gateway' },
  { key: 'memory',   label: 'Memory',          path: '/api/hermes/memory' },
  { key: 'logs',     label: 'Logs',            path: '/api/hermes/logs?name=agent&lines=5' },
];

/** Probe a single bridge path; returns HTTP status + round-trip latency. */
export async function probeEndpoint(path: string): Promise<{ ok: boolean; status: number; latencyMs: number; error: string | null }> {
  const start = performance.now();
  try {
    const res = await bridge.get(path, { timeout: 15000 });
    return { ok: true, status: res.status, latencyMs: Math.round(performance.now() - start), error: null };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - start);
    const status = axios.isAxiosError(e) && e.response ? e.response.status : 0;
    return { ok: false, status, latencyMs, error: errMessage(e) };
  }
}

// ---------------------------------------------------------------------------
// Sentinel AI Daily Digest types & fetchers
// ---------------------------------------------------------------------------
export interface SentinelStory {
  title: string;
  url: string;
  source: string;
  score: number;
}

export interface SentinelDigest {
  generated_at: string;
  total_stories: number;
  sources: string[];
  stories: SentinelStory[];
}

export interface SentinelArchiveEntry {
  date: string;
  size: number;
  modified: string;
}

export interface SentinelArchive {
  digests: SentinelArchiveEntry[];
}

export interface ContentCampaign {
  id: string;
  title: string;
  status: 'ready' | 'running' | 'done' | 'blocked' | 'failed';
  assignee: string;
  priority: number;
  platform: string;
}

export interface ContentDraft {
  id: string;
  title: string;
  status: 'ready' | 'running' | 'done' | 'blocked' | 'failed';
  assignee: string;
  priority: number;
  platform: string;
}

export interface ContentCalendarItem {
  id: string;
  title: string;
  date: string;
  status: 'ready' | 'running' | 'done' | 'blocked' | 'failed';
  platform: string;
}

export interface ContentPipeline {
  campaigns: ContentCampaign[];
  drafts: ContentDraft[];
  calendar: ContentCalendarItem[];
}

export async function getContentPipeline(): Promise<ContentPipeline> {
  const { data } = await bridge.get('/api/content/pipeline');
  return data;
}

export async function getSentinelDigest(): Promise<SentinelDigest> {
  const { data } = await bridge.get('/api/sentinel/digest');
  return data;
}

export async function getSentinelArchive(): Promise<SentinelArchive> {
  const { data } = await bridge.get('/api/sentinel/archive');
  return data;
}

export async function getSentinelDigestByDate(date: string): Promise<SentinelDigest> {
  const { data } = await bridge.get(`/api/sentinel/digest/${date}`);
  return data;
}

// ---------------------------------------------------------------------------
// Capability surface — full Hermes CLI coverage (Arsenal / Uplink / Systems)
// ---------------------------------------------------------------------------

export interface HermesOverview {
  model: string | null;
  provider: string | null;
  platforms: { name: string; configured: boolean; home: string | null }[];
  gateway: { running: boolean; pids: number[] };
  jobs: string | null;
  sessions: string | null;
  api_keys: { name: string; set: boolean }[];
  raw: string;
}

export interface HermesSkill { name: string; category: string; source: string; trust: string; enabled: boolean }
export interface SkillsSummary { hub: number; builtin: number; local: number; enabled: number; disabled: number }
export interface HermesMcpServer { name: string; transport: string; tools: string; enabled: boolean }
export interface HermesPlugin { status: string; source: string; version: string; name: string; enabled: boolean }
export interface HermesGatewayInfo {
  service: {
    running: boolean;
    /** Authoritative liveness — the gateway's api_server answering on :8642.
     * `running` comes from process scans, which hung zombies can fool. */
    api_listening?: boolean;
    manager: string | null;
    pids: number[];
  };
  gateways: { name: string; current: boolean; running: boolean; pid: number | null }[];
  raw: string;
}
export interface SendTargets { platforms: { platform: string; targets: string[] }[]; raw: string }
export interface HermesWebhooks { enabled: boolean; subscriptions: { cells: string[] }[]; raw: string }
export interface HermesMemoryStatus {
  provider: string | null; plugin_installed: boolean; available: boolean;
  providers: { name: string; auth: string; active: boolean }[]; raw: string;
}
export interface HermesCuratorStatus {
  enabled: boolean; runs: string | null; last_run: string | null; interval: string | null;
  skills_total: number | null; active: number | null; stale: number | null; archived: number | null;
  most_active: { name: string; activity: number; last_activity: string }[]; raw: string;
}
export interface HermesInsights {
  days: number;
  overview: Record<string, number | string>;
  models: { model: string; sessions: number; tokens: number }[];
  platforms: { platform: string; sessions: number; messages: number; tokens: number }[];
  top_tools: { tool: string; calls: number; pct: number }[];
  weekday_activity: { day: string; sessions: number }[];
  peak_hours: string | null;
  raw: string;
}
export interface HermesDoctor {
  checks: { level: 'ok' | 'warn' | 'fail'; text: string }[];
  counts: { ok: number; warn: number; fail: number };
  raw: string;
}
export interface HermesModelInfo { model: string | null; provider: string | null; fallbacks: string[]; raw: string }
export interface HermesAuthInfo {
  providers: { provider: string; count: number; credentials: { index: number; label: string; kind: string; source: string }[] }[];
  raw: string;
}

export async function getHermesOverview(): Promise<HermesOverview> {
  const { data } = await bridge.get('/api/hermes/overview', { timeout: 95000 });
  return data;
}
export async function getHermesSkills(): Promise<{ skills: HermesSkill[]; summary: SkillsSummary | null; raw: string }> {
  const { data } = await bridge.get('/api/hermes/skills', { timeout: 95000 });
  return data;
}
export async function getHermesMcp(): Promise<{ servers: HermesMcpServer[]; raw: string }> {
  const { data } = await bridge.get('/api/hermes/mcp', { timeout: 95000 });
  return data;
}
export async function testHermesMcp(name: string): Promise<{ message: string; ok: boolean }> {
  const { data } = await bridge.post(`/api/hermes/mcp/${encodeURIComponent(name)}/test`, {}, { timeout: 125000 });
  return data;
}
export async function getHermesPlugins(): Promise<{ plugins: HermesPlugin[]; raw: string }> {
  const { data } = await bridge.get('/api/hermes/plugins', { timeout: 95000 });
  return data;
}
export async function setHermesPlugin(name: string, enable: boolean): Promise<{ message: string }> {
  const { data } = await bridge.post(`/api/hermes/plugins/${encodeURIComponent(name)}/${enable ? 'enable' : 'disable'}`, {}, { timeout: 125000 });
  return data;
}
export async function getHermesGateway(): Promise<HermesGatewayInfo> {
  const { data } = await bridge.get('/api/hermes/gateway', { timeout: 95000 });
  return data;
}
export async function gatewayAction(action: 'start' | 'stop' | 'restart'): Promise<{ message: string; running: boolean; pending: boolean }> {
  const { data } = await bridge.post('/api/hermes/gateway/action', { action }, { timeout: 125000 });
  return data;
}

// ── Hermes local patches — the quota-burn fixes live inside the hermes-agent
// git checkout, so `hermes update` can drop them. The bridge wraps
// scripts/hermes_patches.py (check / idempotent re-apply).
export interface HermesPatch {
  id: string;
  file: string;
  description: string;
  status: 'applied' | 'applicable' | 'conflict' | 'file-missing' | 'compile-failed-rolled-back';
  changed?: boolean;
}
export interface HermesPatchReport {
  hermes_dir: string;
  mode: 'check' | 'apply';
  patches: HermesPatch[];
  all_applied: boolean;
  applicable: number;
  conflicts: number;
  changed?: number;
  gateway_restart_suggested?: boolean;
}
export async function getHermesPatches(): Promise<HermesPatchReport> {
  const { data } = await bridge.get('/api/hermes/patches', { timeout: 65000 });
  return data;
}
export async function applyHermesPatches(): Promise<HermesPatchReport> {
  const { data } = await bridge.post('/api/hermes/patches/apply', {}, { timeout: 95000 });
  return data;
}
export async function getSendTargets(): Promise<SendTargets> {
  const { data } = await bridge.get('/api/hermes/send/targets', { timeout: 65000 });
  return data;
}
export async function sendPlatformMessage(payload: { target: string; message: string; subject?: string }): Promise<{ result: unknown; message: string }> {
  const { data } = await bridge.post('/api/hermes/send', payload, { timeout: 95000 });
  return data;
}
export async function getHermesWebhooks(): Promise<HermesWebhooks> {
  const { data } = await bridge.get('/api/hermes/webhooks', { timeout: 65000 });
  return data;
}
export async function getHermesMemory(): Promise<HermesMemoryStatus> {
  const { data } = await bridge.get('/api/hermes/memory', { timeout: 65000 });
  return data;
}
export async function getHermesCurator(): Promise<HermesCuratorStatus> {
  const { data } = await bridge.get('/api/hermes/curator', { timeout: 65000 });
  return data;
}
export async function getHermesInsights(days = 30): Promise<HermesInsights> {
  const { data } = await bridge.get('/api/hermes/insights', { params: { days }, timeout: 185000 });
  return data;
}
export async function getHermesDoctor(): Promise<HermesDoctor> {
  const { data } = await bridge.get('/api/hermes/doctor', { timeout: 185000 });
  return data;
}
export async function getHermesLogs(name = 'agent', lines = 80, level?: string, since?: string): Promise<{ name: string; lines: string[] }> {
  const { data } = await bridge.get('/api/hermes/logs', { params: { name, lines, ...(level ? { level } : {}), ...(since ? { since } : {}) }, timeout: 65000 });
  return data;
}
export async function getHermesModel(): Promise<HermesModelInfo> {
  const { data } = await bridge.get('/api/hermes/model', { timeout: 125000 });
  return data;
}
export async function getHermesAuth(): Promise<HermesAuthInfo> {
  const { data } = await bridge.get('/api/hermes/auth', { timeout: 65000 });
  return data;
}
export async function getHermesCheckpoints(): Promise<{ raw: string }> {
  const { data } = await bridge.get('/api/hermes/checkpoints', { timeout: 65000 });
  return data;
}
export async function getHermesPairing(): Promise<{ raw: string }> {
  const { data } = await bridge.get('/api/hermes/pairing', { timeout: 65000 });
  return data;
}
export async function runSecurityAudit(): Promise<{ vulnerabilities: number; raw: string }> {
  const { data } = await bridge.get('/api/hermes/security/audit', { timeout: 305000 });
  return data;
}

// ---------------------------------------------------------------------------
// Real data pipelines — leads, content calendar (Ayrshare), creator intel
// (Apify), consolidated AI digest. All file-backed on the bridge; no demo data.
// ---------------------------------------------------------------------------

export interface Lead {
  id: string; name: string; source: string; status: string; score: number;
  company?: string | null; contact?: string | null; notes?: string | null; created_at?: number;
}
export async function getLeads(): Promise<{ leads: Lead[]; source: string }> {
  const { data } = await bridge.get('/api/hermes/leads');
  return data;
}
export async function addLead(payload: { name: string; source?: string; status?: string; score?: number; company?: string; contact?: string; notes?: string }): Promise<{ lead: Lead }> {
  const { data } = await bridge.post('/api/hermes/leads', payload);
  return data;
}
export async function updateLead(id: string, payload: { status?: string; score?: number; notes?: string }): Promise<{ lead: Lead }> {
  const { data } = await bridge.put(`/api/hermes/leads/${id}`, payload);
  return data;
}
export async function deleteLead(id: string): Promise<{ deleted: string }> {
  const { data } = await bridge.delete(`/api/hermes/leads/${id}`);
  return data;
}

export interface CalendarItem {
  id: string; title: string; date: string; platform: string; status: string;
  body?: string | null; buffer_id?: string | null; ayrshare_id?: string;
}
export interface CalendarResponse {
  calendar: CalendarItem[];
  scheduler: {
    provider: 'buffer' | 'ayrshare' | null;
    configured: boolean;
    history: { id?: string; title: string; date?: string | null; platform: string; status: string }[];
    error?: string;
  };
}
export async function getCalendar(): Promise<CalendarResponse> {
  const { data } = await bridge.get('/api/content/calendar', { timeout: 45000 });
  return data;
}
export async function addCalendarItem(payload: { title: string; date: string; platform?: string; body?: string; status?: string; publish?: boolean }): Promise<{ item: CalendarItem }> {
  const { data } = await bridge.post('/api/content/calendar', payload, { timeout: 65000 });
  return data;
}
export async function deleteCalendarItem(id: string): Promise<{ deleted: string }> {
  const { data } = await bridge.delete(`/api/content/calendar/${id}`);
  return data;
}

export interface CreatorWatch { handle: string; platform: string; niche?: string | null }
export interface CreatorPost {
  platform: string; creator: string; caption: string; url: string;
  likes: number; comments: number; views: number; posted_at: string | number | null; viral_score: number;
}
export interface CreatorsResponse {
  configured: boolean;
  watchlist: CreatorWatch[];
  feed: { scraped_at: string | null; items: CreatorPost[]; errors?: string[] };
}
export async function getCreators(): Promise<CreatorsResponse> {
  const { data } = await bridge.get('/api/creators');
  return data;
}
export async function watchCreator(handle: string, platform: string, niche?: string): Promise<{ watchlist: CreatorWatch[] }> {
  const { data } = await bridge.post('/api/creators/watch', { handle, platform, niche });
  return data;
}
export async function unwatchCreator(platform: string, handle: string): Promise<{ watchlist: CreatorWatch[] }> {
  const { data } = await bridge.delete(`/api/creators/watch/${platform}/${encodeURIComponent(handle)}`);
  return data;
}
export async function scrapeCreators(): Promise<CreatorsResponse['feed']> {
  // Apify actor runs take minutes.
  const { data } = await bridge.post('/api/creators/scrape', {}, { timeout: 300000 });
  return data;
}

export interface AiDigest {
  available: boolean;
  generated_at?: string;
  summary?: string;
  ideas?: { title: string; angle: string; why_viral: string; source_url: string }[];
  story_count?: number;
  reason?: string;
}
export async function getAiDigest(): Promise<AiDigest> {
  const { data } = await bridge.get('/api/hermes/ai-digest');
  return data;
}
export async function generateAiDigest(): Promise<AiDigest> {
  // LLM synthesis — slow.
  const { data } = await bridge.post('/api/hermes/ai-digest', {}, { timeout: 250000 });
  return data;
}

export interface ContentIdea {
  title: string; platform: string; format: string;
  hook: string; why_now: string; pattern_source: string;
}
export interface ContentIdeas {
  available: boolean;
  generated_at?: string;
  strategy_note?: string;
  ideas?: ContentIdea[];
  inputs?: { viral_posts: number; news_stories: number; brand_doc: boolean };
}
export async function uploadContentMedia(name: string, dataBase64: string): Promise<{ media_id: string; bytes: number; url: string }> {
  // 120 MB cap server-side; long timeout for big reels over localhost.
  const { data } = await bridge.post('/api/content/media', { name, data: dataBase64 }, { timeout: 300000 });
  return data;
}
export async function attachCalendarMedia(itemId: string, mediaIds: string[]): Promise<{ item: CalendarItem }> {
  const { data } = await bridge.put(`/api/content/calendar/${itemId}/media`, { media_ids: mediaIds });
  return data;
}
export async function scheduleCalendarItem(itemId: string): Promise<{ item: CalendarItem; ayrshare: unknown }> {
  // Uploads attached media to Ayrshare then books the post — can take minutes for video.
  const { data } = await bridge.post(`/api/content/calendar/${itemId}/schedule`, {}, { timeout: 600000 });
  return data;
}
export async function pushCalendarItemToBuffer(itemId: string): Promise<{ item: CalendarItem }> {
  const { data } = await bridge.post(`/api/content/calendar/${itemId}/push-buffer`, {}, { timeout: 65000 });
  return data;
}

export async function getContentIdeas(): Promise<ContentIdeas> {
  const { data } = await bridge.get('/api/content/ideas');
  return data;
}
export async function generateContentIdeas(): Promise<ContentIdeas> {
  // LLM synthesis over viral signals + news + brand doc — slow.
  const { data } = await bridge.post('/api/content/ideas', {}, { timeout: 250000 });
  return data;
}
export async function consumeContentIdea(title: string): Promise<{ deck: ContentIdeas }> {
  const { data } = await bridge.post('/api/content/ideas/consume', { title });
  return data;
}
export async function skipContentIdea(title: string): Promise<{ deck: ContentIdeas; replacement: ContentIdea }> {
  // Generates ONE replacement idea via LLM — slow (~30-90s).
  const { data } = await bridge.post('/api/content/ideas/skip', { title }, { timeout: 250000 });
  return data;
}
