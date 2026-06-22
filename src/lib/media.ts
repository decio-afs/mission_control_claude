// Shared deliverable/artifact media classification.
//
// The bridge serves any file's raw bytes (deliverables/raw and
// tasks/{id}/workspace/raw) via FileResponse with HTTP Range support, so the UI
// can render images, video, and audio INLINE straight from those URLs — not just
// offer download links. This is the single source of truth for "what kind of
// viewer does this extension get", used by both the Deliverables drawer and the
// per-task workspace browser, so adding a new clip/format only changes one place.
export type MediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'text';

// Extensions a browser/Chromium (Electron) can render inline from raw bytes.
// Kept conservative to the broadly-playable codecs; anything not listed degrades
// to the text view or open/download links rather than a dead inline element.
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus']);

export function mediaKind(ext: string): MediaKind {
  const e = (ext || '').toLowerCase().replace(/^\./, '');
  if (IMAGE_EXTS.has(e)) return 'image';
  if (VIDEO_EXTS.has(e)) return 'video';
  if (AUDIO_EXTS.has(e)) return 'audio';
  if (e === 'pdf') return 'pdf';
  return 'text';
}

// Derive the extension from a bare file name (the per-task workspace lists names,
// not pre-split extensions like the deliverables endpoint does).
export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export const isImageExt = (ext: string) => mediaKind(ext) === 'image';
export const isVideoExt = (ext: string) => mediaKind(ext) === 'video';
export const isAudioExt = (ext: string) => mediaKind(ext) === 'audio';
export const isPdfExt = (ext: string) => mediaKind(ext) === 'pdf';
// True for any binary that streams from /raw (no point fetching the text JSON).
export const isInlineMediaExt = (ext: string) => {
  const k = mediaKind(ext);
  return k === 'image' || k === 'video' || k === 'audio';
};
