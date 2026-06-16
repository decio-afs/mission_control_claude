import axios from 'axios';

// ---------------------------------------------------------------------------
// Mc Bridge client
// ---------------------------------------------------------------------------
// Mission Control talks to the local Mc bridge (mc-bridge.py), a thin
// FastAPI wrapper around the `mc` CLI. There is no other backend — every
// screen renders live data sourced from Mc.
export const BRIDGE_BASE_URL = import.meta.env.VITE_BRIDGE_URL || 'http://localhost:8767';

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

/** Extract the bridge's FastAPI `detail` from an axios error — the real
    reason, not "Request failed with status code 500". Handles JSON bodies
    and arraybuffer responses (the TTS endpoint). */
export function bridgeDetail(e: unknown): string {
  if (axios.isAxiosError(e)) {
    let d: unknown = e.response?.data;
    if (d instanceof ArrayBuffer) {
      try { d = JSON.parse(new TextDecoder().decode(d)); } catch { d = null; }
    }
    if (typeof d === 'string' && d.trim()) return d.slice(0, 300);
    const detail = (d as { detail?: unknown } | null)?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    // run_mc failures carry the whole CLI result as the detail object —
    // stderr is where argparse/CLI errors actually live.
    if (detail && typeof detail === 'object') {
      const r = detail as { stderr?: string; stdout?: string };
      const msg = (r.stderr || r.stdout || '').trim();
      if (msg) return msg.split('\n').slice(-3).join(' ').slice(0, 300);
    }
    return e.message;
  }
  return errMessage(e);
}

// ---------------------------------------------------------------------------
// Types — mirror the Mc CLI JSON shapes
// ---------------------------------------------------------------------------
export interface McAgent {
  name: string;
  on_disk: boolean;
  counts: Record<string, number>;
}

export interface McTask {
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
  // Server-computed (mc_store list projection): true when the task produced a
  // retrievable deliverable (result / branch / run summary / non-empty workspace
  // dir). Lets the board flag done cards without a per-card fetch. Optional so
  // older payloads decode cleanly.
  has_deliverable?: boolean;
}

export interface McCronJob {
  id: string;
  status: string;
  name?: string;
  schedule?: string;
  repeat?: string;
  deliver?: string;
  script?: string;
  /** Outcome of the most recent fire (scheduled or manual), stamped by the bridge. */
  last_run?: number;
  last_status?: 'ok' | 'error';
  last_trigger?: 'schedule' | 'manual';
  last_detail?: string;
}

/** Liveness of the in-bridge cron daemon that actually fires due jobs. */
export interface CronSchedulerStatus {
  enabled: boolean;
  running: boolean;
  tick_seconds: number;
  started_at?: number | null;
  last_tick?: number | null;
  ticks: number;
  fired: number;
  errors: number;
  last_fired_id?: string | null;
  last_error?: string | null;
}

export interface McStatus {
  mc_version: string;
  bridge: string;
}

export interface McActivity {
  id: string;
  agent: string;
  action: string;
  timestamp: number;
  status: string;
}

export interface McBriefing {
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
export async function getMcStatus(): Promise<McStatus> {
  const { data } = await bridge.get('/api/mc/status');
  return data;
}

export async function getMcAgents(): Promise<{ agents: McAgent[] }> {
  const { data } = await bridge.get('/api/mc/agents');
  return data;
}

// --- Web-access audit: which agents need the live web but lack a web MCP ---
export interface WebAccessRow {
  name: string;
  needs_web: boolean;
  has_web: boolean;
  gap: boolean;
  blocked_tasks: number;
  mcps: string[];
  web_skills: string[];
}

export interface WebAccessAudit {
  agents: WebAccessRow[];
  summary: { total: number; needs_web: number; missing_web: number; blocked_due_to_web: number };
  hint: string;
}

export async function getWebAccessAudit(): Promise<WebAccessAudit> {
  const { data } = await bridge.get('/api/mc/agents/web-access');
  return data;
}

export async function getMcTasks(): Promise<{ tasks: McTask[] }> {
  const { data } = await bridge.get('/api/mc/tasks');
  return data;
}

export async function createMcTask(payload: { title: string; body?: string; assignee?: string; priority?: number; skills?: string[]; parents?: string[]; triage?: boolean; max_retries?: number | null }) {
  const { data } = await bridge.post('/api/mc/tasks', payload);
  return data;
}

export async function claimMcTask(taskId: string) {
  const { data } = await bridge.post(`/api/mc/tasks/${taskId}/claim`);
  return data;
}

export async function completeMcTask(taskId: string) {
  const { data } = await bridge.post(`/api/mc/tasks/${taskId}/complete`);
  return data;
}

export async function blockMcTask(taskId: string, reason: string) {
  const { data } = await bridge.post(`/api/mc/tasks/${taskId}/block`, { reason });
  return data;
}

// ── Full kanban task control (mirrors `mc kanban` verbs) ──────────────
export interface TaskComment { author: string; body: string; created_at: number }
export interface TaskEvent { kind: string; payload: Record<string, unknown> | null; created_at: number; run_id: string | null }
export interface TaskRun { run_id?: string; profile?: string; outcome?: string; elapsed?: number | string; summary?: string; [k: string]: unknown }
export interface TaskDetail {
  task: McTask;
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

export async function getMcTaskDetail(taskId: string): Promise<TaskDetail> {
  const { data } = await bridge.get(`/api/mc/tasks/${taskId}`);
  return data;
}

export async function getKanbanStats(): Promise<KanbanStats> {
  const { data } = await bridge.get('/api/mc/kanban/stats');
  return data;
}

export async function unblockMcTask(taskId: string, reason?: string) {
  const { data } = await bridge.post(`/api/mc/tasks/${taskId}/unblock`, { reason });
  return data;
}

export async function promoteMcTask(taskId: string, reason?: string, force?: boolean) {
  const { data } = await bridge.post(`/api/mc/tasks/${taskId}/promote`, { reason, force });
  return data;
}

export async function scheduleMcTask(taskId: string, reason?: string) {
  const { data } = await bridge.post(`/api/mc/tasks/${taskId}/schedule`, { reason });
  return data;
}

export async function archiveMcTask(taskId: string) {
  const { data } = await bridge.post(`/api/mc/tasks/${taskId}/archive`);
  return data;
}

export async function assignMcTask(taskId: string, profile: string) {
  const { data } = await bridge.post(`/api/mc/tasks/${taskId}/assign`, { profile });
  return data;
}

export async function reassignMcTask(taskId: string, profile: string, reclaim?: boolean, reason?: string) {
  const { data } = await bridge.post(`/api/mc/tasks/${taskId}/reassign`, { profile, reclaim, reason });
  return data;
}

export async function reclaimMcTask(taskId: string) {
  const { data } = await bridge.post(`/api/mc/tasks/${taskId}/reclaim`);
  return data;
}

export async function commentMcTask(taskId: string, text: string, author?: string) {
  const { data } = await bridge.post(`/api/mc/tasks/${taskId}/comment`, { text, author });
  return data;
}

export async function editMcTask(taskId: string, result: string, summary?: string, metadata?: string) {
  const { data } = await bridge.post(`/api/mc/tasks/${taskId}/edit`, { result, summary, metadata });
  return data;
}

export async function linkMcTasks(parentId: string, childId: string) {
  const { data } = await bridge.post('/api/mc/tasks/link', { parent_id: parentId, child_id: childId });
  return data;
}

export async function unlinkMcTasks(parentId: string, childId: string) {
  const { data } = await bridge.post('/api/mc/tasks/unlink', { parent_id: parentId, child_id: childId });
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

export async function specifyMcTask(taskId: string) {
  const { data } = await bridge.post(`/api/mc/tasks/${taskId}/specify`, {}, { timeout: 190000 });
  return data;
}

export async function getMcTaskLog(taskId: string, tail?: number): Promise<{ log: string }> {
  const { data } = await bridge.get(`/api/mc/tasks/${taskId}/log`, { params: tail ? { tail } : undefined });
  return data;
}

export async function getMcTaskContext(taskId: string): Promise<{ context: string }> {
  const { data } = await bridge.get(`/api/mc/tasks/${taskId}/context`);
  return data;
}

// DELIV-4 slice b: read-only browse of a task's workspace (where file/branch
// deliverables physically live). The bridge derives the path from Mc, never
// from us, and confines any file read inside the workspace.
export interface WorkspaceEntry { name: string; rel: string; is_dir: boolean; size: number | null }
export interface TaskWorkspace {
  workspace_path: string | null; branch_name: string | null;
  exists: boolean; is_git: boolean; files: WorkspaceEntry[];
  log: string; diffstat: string; note: string;
}
export interface TaskWorkspaceFile { file: string; binary: boolean; truncated: boolean; content: string; note?: string }

export async function getMcTaskWorkspace(taskId: string): Promise<TaskWorkspace> {
  const { data } = await bridge.get(`/api/mc/tasks/${taskId}/workspace`);
  return data;
}

export async function getMcTaskWorkspaceFile(taskId: string, file: string): Promise<TaskWorkspaceFile> {
  const { data } = await bridge.get(`/api/mc/tasks/${taskId}/workspace`, { params: { file } });
  return data;
}

export async function getKanbanDiagnostics(): Promise<{ diagnostics: BoardDiagnostic[] }> {
  const { data } = await bridge.get('/api/mc/kanban/diagnostics');
  return data;
}

// Self-heal: reclaim stale running claims back to `ready` so a dead/abandoned
// agent can't freeze the board. The companion remediation for the `stale_claim`
// diagnostic. `thresholdHours` omitted → bridge/store default (2h).
export interface ReconcileResult {
  reclaimed: Array<{ id: string; title?: string; assignee?: string | null; stale_hours?: number }>;
  threshold_hours: number;
  message: string;
}
export async function reconcileKanban(thresholdHours?: number): Promise<ReconcileResult> {
  const { data } = await bridge.post('/api/mc/kanban/reconcile',
    thresholdHours != null ? { threshold_hours: thresholdHours } : {});
  return data;
}

// --- Triage auto-route: assign triage tasks to the best-fit agent by skill ---
// The deterministic "assign-by-skill" half of triage → specify → assign. Routed
// tasks de-triage to `todo` with the winning agent; unmatched tasks are left in
// triage (honest, never force-assigned). `dryRun` previews without mutating.
export interface RoutedTask {
  id: string;
  title?: string;
  assignee: string;
  score: number;
  matched: string[];
  skill_match: string[];
  runner_up?: string | null;
  web_gap?: boolean;
}
export interface RouteResult {
  routed: RoutedTask[];
  skipped: Array<{ id: string; title?: string; reason: string }>;
  dry_run: boolean;
  message: string;
}
export async function routeTriage(opts?: { taskId?: string; dryRun?: boolean }): Promise<RouteResult> {
  const body: Record<string, unknown> = {};
  if (opts?.taskId != null) body.task_id = opts.taskId;
  if (opts?.dryRun) body.dry_run = true;
  const { data } = await bridge.post('/api/mc/kanban/route', body);
  return data;
}

// --- Retry-exhaustion escalation: blocked-with-reason when a task burns its budget ---
// `max_retries` exists on every task but nothing acted on it post-Hermes. This sweeps
// tasks whose failed-attempt count reached their budget and moves them to `blocked`
// with a recorded reason + `escalated` event so a human (or routeTriage) picks the
// next owner. Reversible; `dryRun` previews the plan without mutating.
export interface EscalatedTask {
  id: string;
  title?: string;
  assignee?: string | null;
  attempts: number;
  max_retries: number;
  prev_status?: string;
  reason: string;
}
export interface EscalateResult {
  escalated: EscalatedTask[];
  skipped: Array<{ id: string; title?: string; reason: string }>;
  dry_run: boolean;
  message: string;
}
export async function escalateExhausted(opts?: { taskId?: string; dryRun?: boolean }): Promise<EscalateResult> {
  const body: Record<string, unknown> = {};
  if (opts?.taskId != null) body.task_id = opts.taskId;
  if (opts?.dryRun) body.dry_run = true;
  const { data } = await bridge.post('/api/mc/kanban/escalate', body);
  return data;
}

// --- Dependency-aware promotion gate: enforce parent→child ordering ---
// Parent→child links existed but nothing enforced ordering post-Hermes. This
// sweep HOLDS a workable child whose parents are still open (→ blocked-with-
// reason), PROMOTES a child it previously held once all parents are done
// (→ ready), and surfaces children still waiting. Conservative (only promotes
// tasks it held) and idempotent; `dryRun` previews without mutating.
export interface CascadeHeld { id: string; title?: string; open_parents: string[]; prev_status?: string; reason: string }
export interface CascadePromoted { id: string; title?: string; parents: string[]; reason: string }
export interface CascadeWaiting { id: string; title?: string; open_parents: string[] }
export interface CascadeResult {
  held: CascadeHeld[];
  promoted: CascadePromoted[];
  waiting: CascadeWaiting[];
  dry_run: boolean;
  message: string;
}
export async function cascadeDependencies(opts?: { dryRun?: boolean }): Promise<CascadeResult> {
  const body: Record<string, unknown> = {};
  if (opts?.dryRun) body.dry_run = true;
  const { data } = await bridge.post('/api/mc/kanban/cascade', body);
  return data;
}

export async function getTaskNotifications(taskId: string): Promise<{ subscriptions: NotifySubscription[] }> {
  const { data } = await bridge.get(`/api/mc/tasks/${taskId}/notify`);
  return data;
}

export async function subscribeTaskNotify(taskId: string, payload: { platform: string; chat_id: string; thread_id?: string; user_id?: string }) {
  const { data } = await bridge.post(`/api/mc/tasks/${taskId}/notify`, payload);
  return data;
}

export async function unsubscribeTaskNotify(taskId: string, payload: { platform: string; chat_id: string; thread_id?: string }) {
  const { data } = await bridge.post(`/api/mc/tasks/${taskId}/notify/unsubscribe`, payload);
  return data;
}

export async function getMcBoards(): Promise<{ boards: KanbanBoard[] }> {
  const { data } = await bridge.get('/api/mc/boards');
  return data;
}

export async function createMcBoard(payload: { slug: string; name?: string; description?: string; switch?: boolean }) {
  const { data } = await bridge.post('/api/mc/boards', payload);
  return data;
}

export async function switchMcBoard(slug: string) {
  const { data } = await bridge.post('/api/mc/boards/switch', { slug });
  return data;
}

export async function getMcCron(): Promise<{ jobs: McCronJob[]; raw: string; scheduler?: CronSchedulerStatus }> {
  const { data } = await bridge.get('/api/mc/cron');
  return data;
}

export async function runMcCron(jobId: string) {
  const { data } = await bridge.post(`/api/mc/cron/${jobId}/run`);
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

export async function createMcCron(payload: CreateCronRequest): Promise<{ message: string; jobs: McCronJob[] }> {
  // Creating a cron job can shell out to `mc cron create`; keep within client default timeout.
  const { data } = await bridge.post('/api/mc/cron', payload);
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

export async function createMcAgent(payload: AgentCreateRequest) {
  const { data } = await bridge.post('/api/mc/agents', payload);
  return data;
}

export async function updateMcAgent(id: string, payload: AgentUpdateRequest) {
  const { data } = await bridge.put(`/api/mc/agents/${id}`, payload);
  return data;
}

export async function deleteMcAgent(id: string) {
  const { data } = await bridge.delete(`/api/mc/agents/${id}`);
  return data;
}

export async function spawnAgentOnTask(agentId: string, taskId: string) {
  // A specialized agent run can take minutes (real deliverable work); the bridge
  // allows up to 600s, so match it here instead of the 30s client default.
  const { data } = await bridge.post(`/api/mc/agents/${agentId}/spawn`, { task_id: taskId }, { timeout: 605000 });
  return data;
}

export async function decomposeTask(payload: TaskDecomposeRequest) {
  const { data } = await bridge.post('/api/mc/tasks/decompose', payload, { timeout: 125000 });
  return data;
}

export async function spawnMcAgent(payload: SpawnRequest) {
  // LLM spawns are slow; the bridge allows 120s, so override the 30s client default.
  const { data } = await bridge.post('/api/mc/spawn', payload, { timeout: 125000 });
  return data;
}

export interface ChatAttachmentUpload {
  name: string;
  mime?: string;
  /** base64-encoded contents (raw base64 or a full data: URL) */
  data: string;
}

export async function sendMcChat(payload: { message: string; model?: string; skills?: string[]; attachments?: ChatAttachmentUpload[]; session_id?: string }): Promise<{ response: string; session_id: string | null; stderr: string; success: boolean }> {
  // Chat round-trips invoke the model and can take well over the 30s client
  // default; the bridge allows 180s, so match it here to avoid premature aborts.
  const { data } = await bridge.post('/api/mc/chat', payload, { timeout: 185000 });
  return data;
}

// ── Mc sessions (the persistent SQLite session store) ──────────────────
export interface McSession {
  id: string;
  title: string;
  preview: string;
  last_active: string;
  source: string;
}

export interface McSessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string | number | null;
  tool_name?: string | null;
}

export interface McSessionDetail {
  id: string;
  title: string;
  cwd: string | null;
  source: string | null;
  message_count: number;
  started_at: string | number | null;
  ended_at: string | number | null;
  messages: McSessionMessage[];
}

export async function getMcSessions(limit = 100, source?: string): Promise<{ sessions: McSession[] }> {
  const { data } = await bridge.get('/api/mc/sessions', { params: { limit, ...(source ? { source } : {}) } });
  return data;
}

export async function getMcSession(id: string): Promise<McSessionDetail> {
  const { data } = await bridge.get(`/api/mc/sessions/${encodeURIComponent(id)}`);
  return data;
}

export async function renameMcSession(id: string, title: string) {
  const { data } = await bridge.post(`/api/mc/sessions/${encodeURIComponent(id)}/rename`, { title });
  return data;
}

export async function deleteMcSession(id: string) {
  const { data } = await bridge.delete(`/api/mc/sessions/${encodeURIComponent(id)}`);
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

export async function getTtsStatus(): Promise<{ available: boolean; voice_id: string; model_id: string; max_chars: number }> {
  const { data } = await bridge.get('/api/tts/status');
  return data;
}

export async function synthesizeSpeech(text: string, voiceId?: string): Promise<Blob> {
  const { data } = await bridge.post(
    '/api/tts',
    { text, voice_id: voiceId },
    { responseType: 'arraybuffer', timeout: 120000 },
  );
  return new Blob([data], { type: 'audio/mpeg' });
}

export async function getMcBriefing(): Promise<McBriefing> {
  const { data } = await bridge.get('/api/mc/briefing');
  return data;
}

export async function getMcActivity(): Promise<{ activities: McActivity[] }> {
  const { data } = await bridge.get('/api/mc/activity');
  return data;
}

// ── Patch notes — changelog written by the autonomous bug-hunt routine ──────
// The routine appends one entry per shipped fix to `.mc/patch-notes.json`;
// the bridge serves it read-only (newest first). Surfaced in the ⚙ UI settings
// popover via the PatchNotes modal.
export interface PatchNote {
  id: string;
  iteration?: number;
  date: string;
  title: string;
  summary: string;
  /** bug | deliverable | lifecycle | ui | perf | misconfig | audit */
  category?: string;
  /** high | medium | low */
  severity?: string;
  files?: string[];
}

export async function getPatchNotes(): Promise<{ notes: PatchNote[] }> {
  const { data } = await bridge.get('/api/mc/patch-notes');
  return data;
}

// ---------------------------------------------------------------------------
// Bridge health / diagnostics
// ---------------------------------------------------------------------------
export interface McHealth {
  bridge: string;
  port: number;
  uptime_seconds: number;
  python_version: string;
  mc_cmd: string;
  cli_ok: boolean;
  cli_version: string;
  cli_probe_ms: number;
  cli_error: string | null;
  server_time: string;
}

export async function getMcHealth(): Promise<McHealth> {
  const { data } = await bridge.get('/api/mc/health');
  return data;
}

/** GET endpoints the Diagnostics panel probes for per-endpoint latency/status. */
export interface BridgeEndpoint {
  key: string;
  label: string;
  path: string;
}

export const BRIDGE_ENDPOINTS: BridgeEndpoint[] = [
  { key: 'status',   label: 'Status',          path: '/api/mc/status' },
  { key: 'health',   label: 'Health',          path: '/api/mc/health' },
  { key: 'agents',   label: 'Agents',          path: '/api/mc/agents' },
  { key: 'tasks',    label: 'Tasks',           path: '/api/mc/tasks' },
  { key: 'cron',     label: 'Cron',            path: '/api/mc/cron' },
  { key: 'activity', label: 'Activity',        path: '/api/mc/activity' },
  { key: 'content',  label: 'Content Pipeline', path: '/api/content/pipeline' },
  { key: 'briefing', label: 'Briefing',        path: '/api/mc/briefing' },
  { key: 'sentinel', label: 'Sentinel Digest', path: '/api/sentinel/digest' },
  { key: 'leads',    label: 'Leads',           path: '/api/mc/leads' },
  { key: 'skills',   label: 'Skills',          path: '/api/mc/skills' },
  { key: 'mcp',      label: 'MCP Servers',     path: '/api/mc/mcp' },
  { key: 'gateway',  label: 'Gateway',         path: '/api/mc/gateway' },
  { key: 'memory',   label: 'Memory',          path: '/api/mc/memory' },
  { key: 'logs',     label: 'Logs',            path: '/api/mc/logs?name=agent&lines=5' },
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
  // kanban-derived statuses plus local planned-post statuses (draft/scheduled/posted)
  status: string;
  platform: string;
  // present on locally planned posts merged in by the bridge
  planned?: boolean;
  virality?: ViralityPrediction;
  metricool_id?: string | null;
  scheduled_for?: string | null;
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
// Capability surface — full Mc CLI coverage (Arsenal / Uplink / Systems)
// ---------------------------------------------------------------------------

export interface McOverview {
  model: string | null;
  provider: string | null;
  platforms: { name: string; configured: boolean; home: string | null }[];
  gateway: { running: boolean; pids: number[] };
  jobs: string | null;
  sessions: string | null;
  api_keys: { name: string; set: boolean }[];
  raw: string;
}

export interface McSkill { name: string; category: string; source: string; trust: string; enabled: boolean }
export interface SkillsSummary { hub: number; builtin: number; local: number; enabled: number; disabled: number }
export interface McMcpServer { name: string; transport: string; tools: string; enabled: boolean }
export interface McPlugin { status: string; source: string; version: string; name: string; enabled: boolean }
export interface McGatewayInfo {
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
export interface McWebhooks { enabled: boolean; subscriptions: { cells: string[] }[]; raw: string }
export interface McMemoryStatus {
  provider: string | null; plugin_installed: boolean; available: boolean;
  providers: { name: string; auth: string; active: boolean }[]; raw: string;
}
export interface McCuratorStatus {
  enabled: boolean; runs: string | null; last_run: string | null; interval: string | null;
  skills_total: number | null; active: number | null; stale: number | null; archived: number | null;
  most_active: { name: string; activity: number; last_activity: string }[]; raw: string;
}
export interface McInsights {
  days: number;
  overview: Record<string, number | string>;
  models: { model: string; sessions: number; tokens: number }[];
  platforms: { platform: string; sessions: number; messages: number; tokens: number }[];
  top_tools: { tool: string; calls: number; pct: number }[];
  weekday_activity: { day: string; sessions: number }[];
  peak_hours: string | null;
  raw: string;
}
export interface McDoctor {
  checks: { level: 'ok' | 'warn' | 'fail'; text: string }[];
  counts: { ok: number; warn: number; fail: number };
  raw: string;
}
export interface McModelInfo { model: string | null; provider: string | null; fallbacks: string[]; raw: string }
export interface McAuthInfo {
  providers: { provider: string; count: number; credentials: { index: number; label: string; kind: string; source: string }[] }[];
  raw: string;
}

export async function getMcOverview(): Promise<McOverview> {
  const { data } = await bridge.get('/api/mc/overview', { timeout: 95000 });
  return data;
}
export async function getMcSkills(): Promise<{ skills: McSkill[]; summary: SkillsSummary | null; raw: string }> {
  const { data } = await bridge.get('/api/mc/skills', { timeout: 95000 });
  return data;
}
export async function getMcMcp(): Promise<{ servers: McMcpServer[]; raw: string }> {
  const { data } = await bridge.get('/api/mc/mcp', { timeout: 95000 });
  return data;
}
export async function testMcMcp(name: string): Promise<{ message: string; ok: boolean }> {
  const { data } = await bridge.post(`/api/mc/mcp/${encodeURIComponent(name)}/test`, {}, { timeout: 125000 });
  return data;
}
export async function getMcPlugins(): Promise<{ plugins: McPlugin[]; raw: string }> {
  const { data } = await bridge.get('/api/mc/plugins', { timeout: 95000 });
  return data;
}
export async function setMcPlugin(name: string, enable: boolean): Promise<{ message: string }> {
  const { data } = await bridge.post(`/api/mc/plugins/${encodeURIComponent(name)}/${enable ? 'enable' : 'disable'}`, {}, { timeout: 125000 });
  return data;
}
export async function getMcGateway(): Promise<McGatewayInfo> {
  const { data } = await bridge.get('/api/mc/gateway', { timeout: 95000 });
  return data;
}
export async function gatewayAction(action: 'start' | 'stop' | 'restart'): Promise<{ message: string; running: boolean; pending: boolean }> {
  const { data } = await bridge.post('/api/mc/gateway/action', { action }, { timeout: 125000 });
  return data;
}

// ── Mc local patches — the quota-burn fixes live inside the mc-agent
// git checkout, so `mc update` can drop them. The bridge wraps
// scripts/mc_patches.py (check / idempotent re-apply).
export interface McPatch {
  id: string;
  file: string;
  description: string;
  status: 'applied' | 'applicable' | 'conflict' | 'file-missing' | 'compile-failed-rolled-back';
  changed?: boolean;
}
export interface McPatchReport {
  mc_dir: string;
  mode: 'check' | 'apply';
  patches: McPatch[];
  all_applied: boolean;
  applicable: number;
  conflicts: number;
  changed?: number;
  gateway_restart_suggested?: boolean;
}
export async function getMcPatches(): Promise<McPatchReport> {
  const { data } = await bridge.get('/api/mc/patches', { timeout: 65000 });
  return data;
}
export async function applyMcPatches(): Promise<McPatchReport> {
  const { data } = await bridge.post('/api/mc/patches/apply', {}, { timeout: 95000 });
  return data;
}
export async function getSendTargets(): Promise<SendTargets> {
  const { data } = await bridge.get('/api/mc/send/targets', { timeout: 65000 });
  return data;
}
export async function sendPlatformMessage(payload: { target: string; message: string; subject?: string }): Promise<{ result: unknown; message: string }> {
  const { data } = await bridge.post('/api/mc/send', payload, { timeout: 95000 });
  return data;
}
export async function getMcWebhooks(): Promise<McWebhooks> {
  const { data } = await bridge.get('/api/mc/webhooks', { timeout: 65000 });
  return data;
}
export async function getMcMemory(): Promise<McMemoryStatus> {
  const { data } = await bridge.get('/api/mc/memory', { timeout: 65000 });
  return data;
}
export async function getMcCurator(): Promise<McCuratorStatus> {
  const { data } = await bridge.get('/api/mc/curator', { timeout: 65000 });
  return data;
}
export async function getMcInsights(days = 30): Promise<McInsights> {
  const { data } = await bridge.get('/api/mc/insights', { params: { days }, timeout: 185000 });
  return data;
}
export async function getMcDoctor(): Promise<McDoctor> {
  const { data } = await bridge.get('/api/mc/doctor', { timeout: 185000 });
  return data;
}
export async function getMcLogs(name = 'agent', lines = 80, level?: string, since?: string): Promise<{ name: string; lines: string[] }> {
  const { data } = await bridge.get('/api/mc/logs', { params: { name, lines, ...(level ? { level } : {}), ...(since ? { since } : {}) }, timeout: 65000 });
  return data;
}
export async function getMcModel(): Promise<McModelInfo> {
  const { data } = await bridge.get('/api/mc/model', { timeout: 125000 });
  return data;
}
export async function getMcAuth(): Promise<McAuthInfo> {
  const { data } = await bridge.get('/api/mc/auth', { timeout: 65000 });
  return data;
}
export async function getMcCheckpoints(): Promise<{ raw: string }> {
  const { data } = await bridge.get('/api/mc/checkpoints', { timeout: 65000 });
  return data;
}
export async function getMcPairing(): Promise<{ raw: string }> {
  const { data } = await bridge.get('/api/mc/pairing', { timeout: 65000 });
  return data;
}
export async function runSecurityAudit(): Promise<{ vulnerabilities: number; raw: string }> {
  const { data } = await bridge.get('/api/mc/security/audit', { timeout: 305000 });
  return data;
}

// ---------------------------------------------------------------------------
// Real data pipelines — leads, content calendar (Metricool auto-posting), creator intel
// (Apify), consolidated AI digest. All file-backed on the bridge; no demo data.
// ---------------------------------------------------------------------------

export interface Lead {
  id: string; name: string; source: string; status: string; score: number;
  company?: string | null; contact?: string | null; notes?: string | null; created_at?: number;
}
export async function getLeads(): Promise<{ leads: Lead[]; source: string }> {
  const { data } = await bridge.get('/api/mc/leads');
  return data;
}
export async function addLead(payload: { name: string; source?: string; status?: string; score?: number; company?: string; contact?: string; notes?: string }): Promise<{ lead: Lead }> {
  const { data } = await bridge.post('/api/mc/leads', payload);
  return data;
}
export async function updateLead(id: string, payload: { status?: string; score?: number; notes?: string }): Promise<{ lead: Lead }> {
  const { data } = await bridge.put(`/api/mc/leads/${id}`, payload);
  return data;
}
export async function deleteLead(id: string): Promise<{ deleted: string }> {
  const { data } = await bridge.delete(`/api/mc/leads/${id}`);
  return data;
}

export interface ViralityPrediction {
  predicted_at: string; media_url: string; score: number | null;
  hook_strength: string; retention_risk: string; verdict: string; suggestions: string[];
}
export interface CalendarItem {
  id: string; title: string; date: string; platform: string; status: string;
  body?: string | null; metricool_id?: string | null; scheduled_for?: string | null;
  virality?: ViralityPrediction;
}
export interface CalendarResponse {
  calendar: CalendarItem[];
  scheduler: {
    provider: 'metricool';
    configured: boolean; // true once brands have been synced from Metricool
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
  likes: number; comments: number; views: number; posted_at: string | number | null;
  // outperformance × freshness: 100 ≈ creator's fresh baseline post, 500 ≈ 5× breakout
  viral_score: number;
  age_days?: number; engagement?: number;
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
  const { data } = await bridge.get('/api/mc/ai-digest');
  return data;
}
export async function generateAiDigest(): Promise<AiDigest> {
  // LLM synthesis — slow.
  const { data } = await bridge.post('/api/mc/ai-digest', {}, { timeout: 250000 });
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
export async function scheduleCalendarItem(itemId: string): Promise<{ item: CalendarItem; metricool: unknown }> {
  // Books the post with Metricool (auto-publishes at the planned time) — LLM hop, slow.
  const { data } = await bridge.post(`/api/content/calendar/${itemId}/schedule`, {}, { timeout: 600000 });
  return data;
}

export interface MetricoolBrand { name: string; blogId: number; networks: Record<string, string> }
export interface MetricoolBrands {
  available: boolean; synced_at?: string; brands?: MetricoolBrand[]; reason?: string;
}
export async function getMetricoolBrands(): Promise<MetricoolBrands> {
  const { data } = await bridge.get('/api/metricool/brands');
  return data;
}
export async function syncMetricoolBrands(): Promise<MetricoolBrands> {
  // Pulls connected profiles via the Metricool MCP — LLM hop, slow.
  const { data } = await bridge.post('/api/metricool/brands', {}, { timeout: 320000 });
  return data;
}
export async function predictCalendarVirality(itemId: string): Promise<{ item: CalendarItem }> {
  // One-shot Mc session → Higgsfield virality predictor; advisory, slow.
  const { data } = await bridge.post(`/api/content/calendar/${itemId}/predict-virality`, {}, { timeout: 650000 });
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

// ---------------------------------------------------------------------------
// LLM model switcher
// ---------------------------------------------------------------------------
export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  base_url: string | null;
  key_env: string;
  ctx_k: number;
  tags: string[];
  enabled: boolean;
  current: boolean;
}

export interface ModelsResponse {
  current_model: string;
  current_provider: string;
  models: ModelInfo[];
}

export async function getModels(): Promise<ModelsResponse> {
  const { data } = await bridge.get('/api/mc/models');
  return data;
}

export async function setModel(model: string, provider: string, base_url?: string | null): Promise<void> {
  await bridge.put('/api/mc/models', { model, provider, base_url: base_url ?? null });
}
