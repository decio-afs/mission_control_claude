import { create } from 'zustand';
import {
  getMcSessions,
  getMcSession,
  renameMcSession,
  deleteMcSession,
  sendMcChat,
  bridgeDetail,
  type McSession,
  type ChatAttachmentUpload,
} from '../lib/api';

// ─────────────────────────────────────────────────────────────────────────
// Shared chat/session store — backed by Mc' real session store.
//
// The session LIST and conversation TRANSCRIPTS come from the bridge (Mc
// `sessions list` / `export`), so they're persistent and shared with cron,
// telegram, the CLI, etc. Sending a message resumes the active session via
// `--resume`, giving real conversational memory. Projects are an app-side
// grouping (folders you create) persisted in localStorage — Mc has no
// native project concept. This single store powers both Claude Chat (the full
// workspace) and Agent Network's command bar, so the active conversation
// survives tab switches.
// ─────────────────────────────────────────────────────────────────────────

export interface ChatAttachment {
  name: string;
  mime: string;
  size: number;
  dataUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  error?: boolean;
  attachments?: ChatAttachment[];
}

export interface Project {
  id: string;
  name: string;
}

/** Transcript key for a brand-new session whose Mc id doesn't exist yet. */
const DRAFT_KEY = '__draft__';
const META_KEY = 'mc-chat-meta';

interface PersistedMeta {
  activeId: string | null;
  isDraft: boolean;
  projects: Project[];
  assignments: Record<string, string>;
}

interface ChatState {
  sessions: McSession[];
  activeId: string | null;
  isDraft: boolean;
  transcripts: Record<string, ChatMessage[]>;
  projects: Project[];
  assignments: Record<string, string>; // sessionId -> projectId
  loadingList: boolean;
  loadingTranscript: boolean;
  sending: boolean;
  error: string | null;

  init: () => void;
  fetchSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  newSession: () => void;
  send: (text: string, opts?: { attachments?: ChatAttachment[]; model?: string; skills?: string[] }) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;

  createProject: (name: string) => void;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  assign: (sessionId: string, projectId: string | null) => void;

  activeMessages: () => ChatMessage[];
  activeTitle: () => string;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function tsNow(): string {
  return new Date().toISOString();
}

function toMessage(role: ChatMessage['role'], content: string, extra?: Partial<ChatMessage>): ChatMessage {
  return { id: uid('m'), role, content, timestamp: tsNow(), ...extra };
}

function loadMeta(): PersistedMeta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PersistedMeta>;
      return {
        activeId: p.activeId ?? null,
        isDraft: p.isDraft ?? false,
        projects: Array.isArray(p.projects) ? p.projects : [],
        assignments: p.assignments && typeof p.assignments === 'object' ? p.assignments : {},
      };
    }
  } catch { /* ignore bad cache */ }
  return { activeId: null, isDraft: false, projects: [], assignments: {} };
}

export const useChatStore = create<ChatState>((set, get) => {
  // Both Claude Chat and Agent Network mount this; only hydrate once.
  let didInit = false;

  function persist() {
    const { activeId, isDraft, projects, assignments } = get();
    try {
      localStorage.setItem(META_KEY, JSON.stringify({ activeId, isDraft, projects, assignments } as PersistedMeta));
    } catch { /* quota — non-fatal */ }
  }

  function appendMessage(key: string, msg: ChatMessage) {
    set((s) => ({ transcripts: { ...s.transcripts, [key]: [...(s.transcripts[key] || []), msg] } }));
  }

  return {
    sessions: [],
    activeId: null,
    isDraft: false,
    transcripts: {},
    projects: [],
    assignments: {},
    loadingList: false,
    loadingTranscript: false,
    sending: false,
    error: null,

    init: () => {
      if (didInit) return;
      didInit = true;
      const meta = loadMeta();
      set({
        projects: meta.projects,
        assignments: meta.assignments,
        activeId: meta.activeId,
        isDraft: meta.isDraft,
      });
      void get().fetchSessions();
      // Re-hydrate the previously active conversation from Mc.
      if (meta.activeId && !meta.isDraft) void get().selectSession(meta.activeId);
      else if (!meta.activeId) get().newSession();
    },

    fetchSessions: async () => {
      set({ loadingList: true });
      try {
        const { sessions } = await getMcSessions(100);
        set({ sessions, loadingList: false, error: null });
      } catch (e) {
        set({ loadingList: false, error: bridgeDetail(e) });
      }
    },

    selectSession: async (id: string) => {
      set({ activeId: id, isDraft: false });
      persist();
      if (get().transcripts[id]) return; // cached
      set({ loadingTranscript: true });
      try {
        const detail = await getMcSession(id);
        const msgs: ChatMessage[] = (detail.messages || [])
          .filter((m) => (m.role === 'user' || m.role === 'assistant') && (m.content || '').trim())
          .map((m) =>
            toMessage(m.role as ChatMessage['role'], m.content, {
              timestamp: typeof m.timestamp === 'string' ? m.timestamp : tsNow(),
            }),
          );
        set((s) => ({ transcripts: { ...s.transcripts, [id]: msgs }, loadingTranscript: false }));
      } catch (e) {
        set({ loadingTranscript: false, error: bridgeDetail(e) });
      }
    },

    newSession: () => {
      set((s) => ({ activeId: null, isDraft: true, transcripts: { ...s.transcripts, [DRAFT_KEY]: [] } }));
      persist();
    },

    send: async (text, opts) => {
      const trimmed = text.trim();
      const attachments = opts?.attachments || [];
      if ((!trimmed && attachments.length === 0) || get().sending) return;

      const { isDraft, activeId } = get();
      const key = isDraft || !activeId ? DRAFT_KEY : activeId;

      appendMessage(key, toMessage('user', trimmed || '(attachment only)', {
        attachments: attachments.length ? attachments : undefined,
      }));
      set({ sending: true, error: null });

      try {
        const uploads: ChatAttachmentUpload[] = attachments
          .filter((a) => a.dataUrl)
          .map((a) => ({ name: a.name, mime: a.mime, data: a.dataUrl as string }));
        const resp = await sendMcChat({
          message: trimmed || 'See attached file(s).',
          session_id: isDraft || !activeId ? undefined : activeId,
          attachments: uploads.length ? uploads : undefined,
          model: opts?.model,
          skills: opts?.skills,
        });

        const newId = resp.session_id;
        // For a brand-new session, adopt the returned id and migrate the draft
        // transcript onto it so the conversation keeps its history.
        if ((isDraft || !activeId) && newId) {
          set((s) => {
            const transcripts = { ...s.transcripts };
            const draftMsgs = transcripts[DRAFT_KEY] || [];
            delete transcripts[DRAFT_KEY];
            transcripts[newId] = draftMsgs;
            return { transcripts, activeId: newId, isDraft: false };
          });
        }
        const finalKey = newId || key;
        appendMessage(finalKey, toMessage('assistant', resp.response || '(no response)'));
        persist();
        void get().fetchSessions();
      } catch (e) {
        appendMessage(get().activeId || DRAFT_KEY, toMessage('system', `COMMS FAILURE: ${bridgeDetail(e)}`, { error: true }));
      } finally {
        set({ sending: false });
      }
    },

    rename: async (id, title) => {
      const clean = title.trim();
      if (!clean) return;
      try {
        await renameMcSession(id, clean);
        set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title: clean } : x)) }));
      } catch (e) {
        set({ error: bridgeDetail(e) });
      }
    },

    remove: async (id) => {
      try {
        await deleteMcSession(id);
      } catch (e) {
        set({ error: bridgeDetail(e) });
        return;
      }
      set((s) => {
        const sessions = s.sessions.filter((x) => x.id !== id);
        const transcripts = { ...s.transcripts };
        delete transcripts[id];
        const assignments = { ...s.assignments };
        delete assignments[id];
        return { sessions, transcripts, assignments };
      });
      if (get().activeId === id) get().newSession();
      persist();
    },

    createProject: (name) => {
      const clean = name.trim();
      if (!clean) return;
      set((s) => ({ projects: [...s.projects, { id: uid('p'), name: clean }] }));
      persist();
    },
    renameProject: (id, name) => {
      const clean = name.trim();
      if (!clean) return;
      set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, name: clean } : p)) }));
      persist();
    },
    deleteProject: (id) => {
      set((s) => {
        const assignments = { ...s.assignments };
        for (const sid of Object.keys(assignments)) if (assignments[sid] === id) delete assignments[sid];
        return { projects: s.projects.filter((p) => p.id !== id), assignments };
      });
      persist();
    },
    assign: (sessionId, projectId) => {
      set((s) => {
        const assignments = { ...s.assignments };
        if (projectId) assignments[sessionId] = projectId;
        else delete assignments[sessionId];
        return { assignments };
      });
      persist();
    },

    activeMessages: () => {
      const { transcripts, activeId, isDraft } = get();
      return transcripts[isDraft || !activeId ? DRAFT_KEY : activeId] || [];
    },
    activeTitle: () => {
      const { sessions, activeId, isDraft } = get();
      if (isDraft || !activeId) return 'New Session';
      const s = sessions.find((x) => x.id === activeId);
      return s?.title || s?.preview || activeId;
    },
  };
});
