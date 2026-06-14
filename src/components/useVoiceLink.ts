// Voice Link — headless voice↔voice loop with the orchestrator.
//
// No popup: the Agent Network core orb IS the interface. This hook owns the
// audio machinery and exposes phase/level so the orb can wear the state —
// coral and level-reactive while listening, violet while transcribing, cyan
// while ARCAN speaks.
//
// The loop: mic → local Whisper STT (/api/transcribe, free) → the shared
// Mc chat session (same one the command bar drives, so spoken turns land
// in the activity feed) → ElevenLabs TTS via the bridge (/api/tts), or the
// browser's speechSynthesis as a zero-cost fallback. Recording ends itself
// after ~1.8s of silence and the mic re-arms after each reply — a continuous
// conversation until ended (orb tap mid-listen with nothing said, Esc, or the
// command-bar toggle).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '../stores/useChatStore';
import { bridgeDetail, getTranscribeStatus, getTtsStatus, synthesizeSpeech, transcribeAudio } from '../lib/api';

export type VoicePhase = 'off' | 'listening' | 'transcribing' | 'thinking' | 'speaking';

// Silence detection: once speech has been heard, this much quiet ends the turn.
const SILENCE_MS = 1800;
// Nothing said at all for this long → operator walked away, end the session.
const NO_SPEECH_MS = 8000;
// Absolute recording ceiling.
const MAX_CLIP_MS = 60000;
// RMS thresholds on the analyser signal (0..~1).
const SPEECH_RMS = 0.02;
const QUIET_RMS = 0.012;

/** Strip markdown/code so the TTS reads prose, not syntax. */
function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' Code block omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/[*_~>|#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });

export interface VoiceLink {
  phase: VoicePhase;
  active: boolean;
  /** Mic level 0..1 while listening — drives the orb's halo. */
  level: number;
  error: string | null;
  engine: 'elevenlabs' | 'browser' | null;
  start: () => void;
  end: () => void;
  /** Context-sensitive orb tap: talk / send-now / interrupt / hang up. */
  tapOrb: () => void;
}

export function useVoiceLink(): VoiceLink {
  const [phase, setPhase] = useState<VoicePhase>('off');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ttsReady, setTtsReady] = useState<boolean | null>(null);

  const phaseRef = useRef<VoicePhase>('off');
  const aliveRef = useRef(true);
  const probedRef = useRef(false);
  const ttsReadyRef = useRef<boolean | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const setPhaseSafe = useCallback((p: VoicePhase) => {
    if (!aliveRef.current) return;
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const stopMeter = useCallback(() => {
    if (meterTimerRef.current) { clearInterval(meterTimerRef.current); meterTimerRef.current = null; }
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stopPlayback = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }
  }, []);

  /** Hang up: kill mic, meter and playback, drop back to off. */
  const end = useCallback(() => {
    stopMeter();
    stopPlayback();
    if (recRef.current) {
      recRef.current.onstop = null; // don't let the pending clip fire a turn
      try { recRef.current.stop(); } catch { /* noop */ }
      recRef.current = null;
    }
    stopStream();
    setPhaseSafe('off');
  }, [stopMeter, stopPlayback, stopStream, setPhaseSafe]);

  const afterSpeak = useCallback(() => {
    if (!aliveRef.current || phaseRef.current !== 'speaking') return;
    void startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const browserSpeak = useCallback((text: string) => {
    const synth = window.speechSynthesis;
    if (!synth) { setError('No TTS available — set ELEVENLABS_API_KEY on the bridge.'); end(); return; }
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.05;
    utt.onend = afterSpeak;
    utt.onerror = afterSpeak;
    synth.cancel();
    synth.speak(utt);
  }, [afterSpeak, end]);

  const speak = useCallback(async (raw: string) => {
    const text = speakable(raw);
    if (!text) { setPhaseSafe('speaking'); afterSpeak(); return; }
    setPhaseSafe('speaking');
    if (ttsReadyRef.current) {
      try {
        const blob = await synthesizeSpeech(text);
        if (!aliveRef.current || phaseRef.current !== 'speaking') return;
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => { stopPlayback(); afterSpeak(); };
        await audio.play();
        return;
      } catch {
        // ElevenLabs failed (quota, network) — degrade to the free voice.
      }
    }
    if (phaseRef.current === 'speaking') browserSpeak(text);
  }, [browserSpeak, afterSpeak, setPhaseSafe, stopPlayback]);

  const runTurn = useCallback(async (text: string) => {
    setPhaseSafe('thinking');
    const store = useChatStore.getState();
    if (store.sending) { setError('Orchestrator is busy with another directive — try again.'); end(); return; }
    await store.send(text);
    if (!aliveRef.current || phaseRef.current !== 'thinking') return;
    const msgs = useChatStore.getState().activeMessages();
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== 'assistant') {
      setError(last?.content || 'No response from the orchestrator.');
      end();
      return;
    }
    await speak(last.content);
  }, [speak, setPhaseSafe, end]);

  const handleClip = useCallback(async (blob: Blob) => {
    if (!aliveRef.current || phaseRef.current === 'off') return;
    if (!blob.size) { end(); return; } // nothing said — hang up quietly
    setPhaseSafe('transcribing');
    try {
      const dataUrl = await blobToDataUrl(blob);
      const { text } = await transcribeAudio(dataUrl, blob.type);
      if (!aliveRef.current || phaseRef.current !== 'transcribing') return;
      if (!text.trim()) { end(); return; }
      await runTurn(text.trim());
    } catch (e) {
      setError(`Transcription failed: ${bridgeDetail(e)}`);
      end();
    }
  }, [runTurn, setPhaseSafe, end]);

  const stopListening = useCallback(() => {
    stopMeter();
    try { recRef.current?.stop(); } catch { /* noop */ }
    recRef.current = null;
  }, [stopMeter]);

  const startListening = useCallback(async () => {
    if (!aliveRef.current || phaseRef.current === 'listening') return;
    setError(null);
    // One-time capability probe — Whisper is required, ElevenLabs optional.
    if (!probedRef.current) {
      try {
        const [stt, tts] = await Promise.all([
          getTranscribeStatus().catch(() => ({ available: false })),
          getTtsStatus().catch(() => ({ available: false })),
        ]);
        if (!stt.available) {
          setError('Local Whisper missing on the bridge — pip install faster-whisper, then restart it.');
          setPhaseSafe('off');
          return;
        }
        probedRef.current = true;
        ttsReadyRef.current = !!tts.available;
        setTtsReady(!!tts.available);
      } catch {
        setError('Bridge unreachable — voice link needs the Mc bridge.');
        setPhaseSafe('off');
        return;
      }
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!aliveRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stopStream();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        void handleClip(blob);
      };
      rec.start();
      recRef.current = rec;
      setPhaseSafe('listening');

      // Level meter + silence auto-stop.
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const startedAt = Date.now();
      let heardSpeech = false;
      let lastLoud = Date.now();
      meterTimerRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms * 8));
        const now = Date.now();
        if (rms > SPEECH_RMS) { heardSpeech = true; lastLoud = now; }
        else if (rms > QUIET_RMS) { lastLoud = now; }
        const tooLong = now - startedAt > MAX_CLIP_MS;
        const wentQuiet = heardSpeech && now - lastLoud > SILENCE_MS;
        const neverSpoke = !heardSpeech && now - startedAt > NO_SPEECH_MS;
        if (tooLong || wentQuiet || neverSpoke) {
          if (neverSpoke) chunksRef.current = []; // drop the empty clip → hang up
          stopListening();
        }
      }, 100);
    } catch {
      setError('Microphone access denied or unavailable.');
      setPhaseSafe('off');
    }
  }, [handleClip, setPhaseSafe, stopListening, stopStream]);

  const start = useCallback(() => { void startListening(); }, [startListening]);

  // Orb tap — the one control: talk / send-now / interrupt.
  const tapOrb = useCallback(() => {
    const p = phaseRef.current;
    if (p === 'off') void startListening();
    else if (p === 'listening') stopListening(); // sends if something was said, hangs up if not
    else if (p === 'speaking') { stopPlayback(); void startListening(); }
    // transcribing / thinking: nothing to do but wait
  }, [startListening, stopListening, stopPlayback]);

  // Esc hangs up from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && phaseRef.current !== 'off') end(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [end]);

  // Teardown on unmount. (Re-arms aliveRef on mount so StrictMode's dev
  // double-mount doesn't leave the hook dead.)
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (meterTimerRef.current) clearInterval(meterTimerRef.current);
      if (recRef.current) { recRef.current.onstop = null; try { recRef.current.stop(); } catch { /* noop */ } }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void audioCtxRef.current?.close().catch(() => undefined);
      try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
      if (audioRef.current) { audioRef.current.onended = null; audioRef.current.pause(); }
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  return {
    phase,
    active: phase !== 'off',
    level,
    error,
    engine: phase === 'off' && ttsReady === null ? null : ttsReady ? 'elevenlabs' : 'browser',
    start,
    end,
    tapOrb,
  };
}
