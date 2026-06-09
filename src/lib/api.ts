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

export async function createHermesTask(payload: { title: string; body?: string; assignee?: string; priority?: number }) {
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

export async function sendHermesChat(payload: { message: string; model?: string; skills?: string[]; attachments?: ChatAttachmentUpload[] }): Promise<{ response: string; stderr: string; success: boolean }> {
  // Chat round-trips invoke the model and can take well over the 30s client
  // default; the bridge allows 180s, so match it here to avoid premature aborts.
  const { data } = await bridge.post('/api/hermes/chat', payload, { timeout: 185000 });
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
