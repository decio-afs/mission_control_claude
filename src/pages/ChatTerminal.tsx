import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { getTranscribeStatus, transcribeAudio } from '../lib/api';
import { Panel } from '../components/cyberpunk/ui';
import { useChatStore, type ChatAttachment } from '../stores/useChatStore';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // mirror the bridge's 25 MB cap

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

// Minimal structural types for the Web Speech API (not in lib.dom for all targets).
interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
interface SpeechRecognitionErrorEventLike { error?: string }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
function getSpeechRecognition(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

const UNFILED = '__unfiled__';

export default function ChatTerminal() {
  const {
    sessions, activeId, isDraft, projects, assignments, sending, loadingTranscript, error,
    init, selectSession, newSession, send, rename, remove,
    createProject, renameProject, deleteProject, assign, activeMessages, activeTitle,
  } = useChatStore();

  const [input, setInput] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Inline project editors — window.prompt() is a no-op inside Electron, so
  // project create/rename use the same inline-input pattern as session rename.
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [projectRenameValue, setProjectRenameValue] = useState('');
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [whisperReady, setWhisperReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const inputAtDictationStart = useRef('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const speechSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  useEffect(() => { init(); }, [init]);

  const messages = activeMessages();

  // Auto-scroll to bottom on new messages / while thinking.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, sending]);

  // ── Sessions grouped by project ────────────────────────────────────────
  const grouped = useMemo(() => {
    const groups: { id: string; name: string; items: typeof sessions }[] = [];
    const byProject = (pid: string) => sessions.filter((s) => (assignments[s.id] || UNFILED) === pid);
    for (const p of projects) groups.push({ id: p.id, name: p.name, items: byProject(p.id) });
    groups.push({ id: UNFILED, name: 'Unfiled', items: byProject(UNFILED) });
    return groups;
  }, [sessions, projects, assignments]);

  // ── Attachments ─────────────────────────────────────────────────────────
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    const next: ChatAttachment[] = [];
    for (const file of list) {
      if (file.size > MAX_FILE_BYTES) { setVoiceError(`"${file.name}" exceeds the 25 MB limit`); continue; }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        next.push({ name: file.name, mime: file.type || 'application/octet-stream', size: file.size, dataUrl });
      } catch { setVoiceError(`Failed to read "${file.name}"`); }
    }
    if (next.length) setPending((prev) => [...prev, ...next]);
  }, []);

  const removePending = (idx: number) => setPending((prev) => prev.filter((_, i) => i !== idx));

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files || []);
    if (files.length) { e.preventDefault(); void addFiles(files); }
  };

  const handleSend = async () => {
    if ((!input.trim() && pending.length === 0) || sending) return;
    const content = input.trim();
    const attachments = pending;
    setInput('');
    setPending([]);
    await send(content, { attachments });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
  };

  // ── Voice dictation (Web Speech API) ─────────────────────────────────────
  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    setListening(false);
  }, []);

  const toggleListening = () => {
    if (!speechSupported) { setVoiceError('Voice input is not supported in this build.'); return; }
    if (listening) { stopListening(); return; }
    setVoiceError(null);
    const SR = getSpeechRecognition();
    if (!SR) { setVoiceError('Voice input is not supported in this build.'); return; }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    inputAtDictationStart.current = input ? input.trim() + ' ' : '';
    rec.onresult = (event: SpeechRecognitionEventLike) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setInput((inputAtDictationStart.current + transcript).replace(/\s+/g, ' ').trimStart());
    };
    rec.onerror = (event: SpeechRecognitionErrorEventLike) => {
      setVoiceError(event?.error === 'not-allowed'
        ? 'Microphone access denied. Enable mic permission for the app.'
        : `Voice error: ${event?.error || 'unknown'}`);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    try { rec.start(); setListening(true); } catch { setVoiceError('Could not start the microphone.'); }
  };

  useEffect(() => () => { try { recognitionRef.current?.stop(); } catch { /* noop */ } }, []);

  // ── Local Whisper transcription (preferred: offline, works in Electron) ──
  useEffect(() => {
    let alive = true;
    getTranscribeStatus()
      .then((s) => { if (alive) setWhisperReady(!!s.available); })
      .catch(() => { if (alive) setWhisperReady(false); });
    return () => { alive = false; };
  }, []);

  const stopMediaStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }, []);

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(blob);
    });

  const startRecording = useCallback(async () => {
    setVoiceError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const rec = new MediaRecorder(stream);
      audioChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stopMediaStream();
        const blob = new Blob(audioChunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (!blob.size) { setRecording(false); return; }
        setTranscribing(true);
        try {
          const dataUrl = await blobToDataUrl(blob);
          const { text } = await transcribeAudio(dataUrl, blob.type);
          if (text) setInput((prev) => (prev.trim() ? prev.trim() + ' ' : '') + text);
          else setVoiceError('No speech detected.');
        } catch (err) {
          setVoiceError(`Transcription failed: ${err instanceof Error ? err.message : 'unknown error'}`);
        } finally { setTranscribing(false); }
      };
      rec.start();
      mediaRecorderRef.current = rec;
      setRecording(true);
    } catch { setVoiceError('Microphone access denied or unavailable.'); setRecording(false); }
  }, [stopMediaStream]);

  const stopRecording = useCallback(() => {
    try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
    setRecording(false);
  }, []);

  useEffect(() => () => {
    try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const micUsable = whisperReady || speechSupported;
  const micBusy = recording || transcribing || listening;
  const handleMicClick = () => {
    if (transcribing) return;
    if (whisperReady) { if (recording) stopRecording(); else void startRecording(); }
    else toggleListening();
  };

  // ── Session rename (writes through to Mc) ────────────────────────────
  const startRename = (id: string, current: string) => { setRenamingId(id); setRenameValue(current); };
  const commitRename = () => {
    if (renamingId && renameValue.trim()) void rename(renamingId, renameValue.trim());
    setRenamingId(null); setRenameValue('');
  };

  const formatTime = (iso: string) => {
    // toLocaleTimeString() does NOT throw on a bad date — it returns the literal
    // "Invalid Date" string — so the try/catch alone never yields the intended
    // "--:--" fallback. msgTime() (useChatStore) passes any non-empty string
    // through unvalidated, so a non-ISO-parseable bridge stamp would otherwise
    // render "Invalid Date" in the header. Guard the NaN date explicitly. (iter #82 class.)
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '--:--';
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return '--:--'; }
  };

  const commitNewProject = () => {
    if (newProjectName.trim()) createProject(newProjectName.trim());
    setCreatingProject(false);
    setNewProjectName('');
  };

  const commitProjectRename = () => {
    if (renamingProjectId && projectRenameValue.trim()) renameProject(renamingProjectId, projectRenameValue.trim());
    setRenamingProjectId(null);
    setProjectRenameValue('');
  };

  return (
    <div className="h-full grid grid-rows-[minmax(120px,30vh)_1fr] grid-cols-1 lg:grid-rows-1 lg:grid-cols-[260px_1fr] gap-2 p-2 min-h-0">
      {/* Session sidebar */}
      <Panel label="SESSIONS" right={<span className="text-[#545454]">{sessions.length}</span>} className="min-h-0" bodyClass="flex flex-col min-h-0">
        <div className="flex gap-1 mb-2 shrink-0">
          <button
            onClick={() => newSession()}
            className="flex-1 text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] py-1.5 hover:bg-[#f64e6e]/20"
          >
            + NEW
          </button>
          <button
            onClick={() => { setCreatingProject((v) => !v); setNewProjectName(''); }}
            title="Create a project folder"
            className={`text-[10px] font-mono border px-2 py-1.5 ${creatingProject ? 'border-sky-400 text-sky-400' : 'border-white/10 text-[#b8b8b8] hover:border-sky-400 hover:text-sky-400'}`}
          >
            + PROJECT
          </button>
        </div>

        {creatingProject && (
          <input
            autoFocus
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitNewProject(); if (e.key === 'Escape') { setCreatingProject(false); setNewProjectName(''); } }}
            onBlur={commitNewProject}
            placeholder="Project name… (Enter to create)"
            className="mb-2 shrink-0 bg-[#050505] border border-sky-400/40 px-2 py-1.5 text-[10px] font-mono text-white placeholder:text-[#545454] outline-none focus:border-sky-400"
          />
        )}

        {error && <div className="mb-2 text-[10px] font-mono text-red-400 truncate" title={error}>⚠ {error}</div>}

        <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-2">
          {/* Draft (unsent) session marker */}
          {isDraft && (
            <div className="p-2 border border-[#f64e6e]/40 bg-[#f64e6e]/10">
              <span className="text-[11px] font-bold text-white">New Session</span>
              <div className="text-[10px] font-mono text-[#545454]">unsent · type below to start</div>
            </div>
          )}

          {grouped.map((group) => {
            if (group.id === UNFILED && group.items.length === 0 && projects.length === 0) return null;
            return (
              <div key={group.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-1 px-1">
                  {renamingProjectId === group.id ? (
                    <input
                      autoFocus
                      value={projectRenameValue}
                      onChange={(e) => setProjectRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitProjectRename(); if (e.key === 'Escape') { setRenamingProjectId(null); setProjectRenameValue(''); } }}
                      onBlur={commitProjectRename}
                      className="flex-1 min-w-0 bg-[#050505] border border-sky-400/40 px-1 py-0.5 text-[10px] font-mono text-white outline-none"
                    />
                  ) : (
                    <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-[#545454] truncate">
                      {group.name} · {group.items.length}
                    </span>
                  )}
                  {group.id !== UNFILED && renamingProjectId !== group.id && (
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => { setRenamingProjectId(group.id); setProjectRenameValue(group.name); }}
                        className="text-[10px] font-mono text-[#545454] hover:text-sky-400 px-0.5" title="Rename project"
                      >REN</button>
                      <button
                        onClick={() => deleteProject(group.id)}
                        className="text-[10px] font-mono text-[#545454] hover:text-red-400 px-0.5" title="Delete project (sessions become Unfiled)"
                      >DEL</button>
                    </div>
                  )}
                </div>

                {group.items.map((session) => {
                  const isActive = session.id === activeId && !isDraft;
                  const label = session.title || session.preview || session.id;
                  return (
                    <div
                      key={session.id}
                      onClick={() => void selectSession(session.id)}
                      className={`group flex flex-col gap-0.5 p-2 border cursor-pointer transition-all ${
                        isActive ? 'border-[#f64e6e]/40 bg-[#f64e6e]/10' : 'border-white/[0.06] bg-[#080808] hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        {renamingId === session.id ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); } }}
                            onBlur={commitRename}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-[#050505] border border-[#f64e6e]/40 px-1 py-0.5 text-[10px] text-white outline-none w-full"
                          />
                        ) : (
                          <span className={`text-[11px] font-bold truncate ${isActive ? 'text-white' : 'text-[#b8b8b8]'}`} title={label}>
                            {label}
                          </span>
                        )}
                        {isActive && renamingId !== session.id && <span className="text-[#f64e6e] text-[10px] shrink-0">▸</span>}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-[#545454]">
                          {session.last_active}{session.source ? ` · ${session.source}` : ''}
                        </span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {projects.length > 0 && (
                            <select
                              value={assignments[session.id] || ''}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => { e.stopPropagation(); assign(session.id, e.target.value || null); }}
                              className="bg-[#050505] border border-white/10 text-[10px] font-mono text-[#b8b8b8] outline-none max-w-[72px]"
                              title="Assign to project"
                            >
                              <option value="">— unfiled —</option>
                              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); startRename(session.id, label); }} className="text-[10px] font-mono text-[#545454] hover:text-[#f64e6e] px-1" title="Rename">REN</button>
                          <button onClick={(e) => { e.stopPropagation(); void remove(session.id); }} className="text-[10px] font-mono text-[#545454] hover:text-red-400 px-1" title="Delete">DEL</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {sessions.length === 0 && !isDraft && (
            <div className="text-[10px] font-mono text-[#545454] p-2">No sessions yet. Click NEW and send a message.</div>
          )}
        </div>
      </Panel>

      {/* Chat area */}
      <Panel
        label={`CLAUDE CHAT // ${activeTitle()}`}
        right={<span className="text-[#545454]">{messages.filter((m) => m.role !== 'system').length} transmissions{loadingTranscript ? ' · loading…' : ''}</span>}
        className="min-h-0"
        bodyClass="flex flex-col min-h-0"
      >
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto flex flex-col gap-2 pr-1">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col gap-0.5 p-2 border ${
                msg.role === 'user' ? 'border-[#f64e6e]/30 bg-[#f64e6e]/5 ml-8'
                : msg.role === 'assistant' ? 'border-white/10 bg-[#080808] mr-8'
                : 'border-amber-400/20 bg-amber-400/5'
              } ${msg.error ? 'border-red-400/30 bg-red-400/5' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-mono tracking-[0.15em] uppercase ${
                  msg.role === 'user' ? 'text-[#f64e6e]' : msg.role === 'assistant' ? 'text-emerald-400' : 'text-amber-400'
                }`}>
                  {msg.role === 'user' ? 'OPERATOR' : msg.role === 'assistant' ? 'CLAUDE' : 'SYSTEM'}
                </span>
                <span className="text-[10px] font-mono text-[#545454]">{formatTime(msg.timestamp)}</span>
              </div>
              <div className="text-[11px] text-white whitespace-pre-wrap leading-relaxed">{msg.content}</div>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {msg.attachments.map((att, i) =>
                    att.mime.startsWith('image/') && att.dataUrl ? (
                      <img key={i} src={att.dataUrl} alt={att.name} className="max-h-28 max-w-[160px] object-cover border border-white/10" />
                    ) : (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-1 border border-white/10 bg-[#050505] text-[10px] font-mono text-[#b8b8b8]" title={att.name}>
                        <span className="text-[#f64e6e]">▣</span>
                        <span className="max-w-[140px] truncate">{att.name}</span>
                        <span className="text-[#545454]">{formatBytes(att.size)}</span>
                      </span>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 p-2 border border-white/10 bg-[#080808] mr-8">
              <div className="w-1.5 h-1.5 bg-[#f64e6e]" style={{ animation: 'pulse 1s ease-in-out infinite' }} />
              <span className="text-[10px] font-mono text-[#545454]">CLAUDE is processing...</span>
            </div>
          )}
          {messages.length === 0 && !sending && (
            <div className="flex items-center justify-center h-full">
              <span className="text-[10px] font-mono text-[#545454]">
                {isDraft ? 'New session — type a message to begin.' : 'Select a session or start a new one.'}
              </span>
            </div>
          )}
        </div>

        <div
          className={`mt-2 border-t pt-2 shrink-0 transition-colors ${dragOver ? 'border-[#f64e6e]/60' : 'border-white/10'}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files); }}
        >
          {voiceError && (
            <div className="mb-1.5 text-[10px] font-mono text-red-400 flex items-center justify-between">
              <span>{voiceError}</span>
              <button onClick={() => setVoiceError(null)} className="text-[#545454] hover:text-white px-1">✕</button>
            </div>
          )}

          {pending.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pending.map((att, i) => (
                <div key={i} className="relative group inline-flex items-center gap-1.5 border border-white/10 bg-[#050505] pl-1 pr-1.5 py-1">
                  {att.mime.startsWith('image/') && att.dataUrl ? (
                    <img src={att.dataUrl} alt={att.name} className="w-8 h-8 object-cover border border-white/10" />
                  ) : (
                    <span className="text-[#f64e6e] text-[11px] px-1">▣</span>
                  )}
                  <div className="flex flex-col">
                    <span className="text-[10px] font-mono text-[#b8b8b8] max-w-[120px] truncate">{att.name}</span>
                    <span className="text-[10px] font-mono text-[#545454]">{formatBytes(att.size)}</span>
                  </div>
                  <button onClick={() => removePending(i)} className="text-[#545454] hover:text-red-400 text-[11px] px-1" title="Remove">✕</button>
                </div>
              ))}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }}
          />

          <div className="flex gap-2 items-end">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              title="Attach files or images"
              className="h-9 w-9 shrink-0 flex items-center justify-center text-[13px] border border-white/10 bg-[#080808] text-[#b8b8b8] hover:border-[#f64e6e]/50 hover:text-[#f64e6e] disabled:opacity-30 disabled:cursor-not-allowed"
            >📎</button>
            <button
              onClick={handleMicClick}
              disabled={sending || !micUsable || transcribing}
              title={!micUsable ? 'Voice input unavailable' : transcribing ? 'Transcribing…' : whisperReady ? (recording ? 'Stop & transcribe' : 'Record voice (local Whisper)') : listening ? 'Stop dictation' : 'Dictate with microphone'}
              className={`h-9 w-9 shrink-0 flex items-center justify-center text-[13px] border disabled:opacity-30 disabled:cursor-not-allowed ${
                micBusy ? 'border-[#f64e6e] bg-[#f64e6e]/20 text-[#f64e6e] animate-pulse' : 'border-white/10 bg-[#080808] text-[#b8b8b8] hover:border-[#f64e6e]/50 hover:text-[#f64e6e]'
              }`}
            >{transcribing ? '◌' : recording || listening ? '⏺' : '🎤'}</button>

            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={recording ? 'Recording… click ⏺ to stop' : transcribing ? 'Transcribing…' : listening ? 'Listening…' : dragOver ? 'Drop files to attach…' : 'Enter directive...'}
              disabled={sending}
              className="flex-1 h-9 bg-[#080808] border border-white/10 px-3 text-[11px] text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none disabled:opacity-50"
            />
            <button
              onClick={() => void handleSend()}
              disabled={sending || (!input.trim() && pending.length === 0)}
              className="h-9 px-4 text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] hover:bg-[#f64e6e]/20 disabled:opacity-30 disabled:cursor-not-allowed"
            >TRANSMIT</button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
