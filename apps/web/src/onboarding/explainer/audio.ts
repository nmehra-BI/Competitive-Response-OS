/**
 * Tour audio (D-200 onward; ONBOARDING.md "Audio"): one narration file per chapter (the last chapter per role
 * path) and one music bed, pre-rendered by scripts/onboarding-audio/generate.py and served as static files
 * from /onboarding/audio/. Nothing loads until the tour opens. The player's clock is the master: `sync()`
 * runs on every tick and keeps the chapter's voice and the music at the visual time, so pause, scrub,
 * chapter jumps and Skip stay in step; `destroy()` stops everything when the dialog closes.
 */
import type { GuidePath } from '@growth-os/contracts';

export const AUDIO_BASE = '/onboarding/audio';
/** Re-seek a playing element when it drifts more than this from the visual clock (seconds). */
export const DRIFT_S = 0.3;

export type AudioFormat = 'webm' | 'm4a';

/** Opus in WebM where supported (Chromium, Firefox), else AAC in MP4 (Safari). */
export function pickFormat(probe?: HTMLAudioElement): AudioFormat {
  try {
    const el = probe ?? document.createElement('audio');
    return el.canPlayType('audio/webm; codecs="opus"') ? 'webm' : 'm4a';
  } catch {
    return 'm4a';
  }
}

/** File stem for a chapter's narration; the role chapter speaks to the viewer's path. */
export function voiceStem(chapterId: string, path: GuidePath): string {
  return chapterId === 'role' ? `voice-role-${path}` : `voice-${chapterId}`;
}

// ---------------------------------------------------------------------------
// Per-viewer preferences (local storage; never required for the page to work)
// ---------------------------------------------------------------------------

export interface AudioPrefs {
  muted: boolean;
  musicOn: boolean;
  /** 0..1 */
  voice: number;
  /** 0..1 */
  music: number;
}

export const DEFAULT_PREFS: AudioPrefs = { muted: false, musicOn: true, voice: 1, music: 0.8 };
export const PREFS_KEY = 'gos.onboarding.audio';

const unit = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);

export function loadPrefs(): AudioPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const p = JSON.parse(raw) as Partial<AudioPrefs>;
    return {
      muted: p.muted === true,
      musicOn: p.musicOn !== false,
      voice: unit(p.voice, DEFAULT_PREFS.voice),
      music: unit(p.music, DEFAULT_PREFS.music),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: AudioPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the preference lasts for this page only */
  }
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export interface SyncState {
  playing: boolean;
  /** Chapter index and seconds into it. */
  index: number;
  local: number;
  /** Seconds into the whole tour. */
  t: number;
}

function make(container: HTMLElement, src: string, testId: string): HTMLAudioElement {
  const el = document.createElement('audio');
  el.preload = 'auto';
  el.src = src;
  el.dataset.testid = testId;
  container.appendChild(el);
  return el;
}

function want(el: HTMLAudioElement, at: number, on: boolean): void {
  const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : Infinity;
  if (on && at < dur - 0.05) {
    if (Math.abs(el.currentTime - at) > DRIFT_S) el.currentTime = at;
    if (el.paused) void el.play()?.catch(() => undefined); // a refused play never breaks the tour
  } else if (!el.paused) {
    el.pause();
  }
}

export class TourAudio {
  readonly voices: HTMLAudioElement[];
  readonly music: HTMLAudioElement;
  private prefs: AudioPrefs = { ...DEFAULT_PREFS };
  private narrating: number | null = null;

  constructor(container: HTMLElement, chapterIds: readonly string[], path: GuidePath, format = pickFormat()) {
    this.voices = chapterIds.map((id) =>
      make(container, `${AUDIO_BASE}/${voiceStem(id, path)}.${format}`, `tour-voice-${id}`),
    );
    this.music = make(container, `${AUDIO_BASE}/music.${format}`, 'tour-music');
  }

  apply(prefs: AudioPrefs): void {
    this.prefs = prefs;
    for (const v of this.voices) v.volume = prefs.voice;
    this.music.volume = prefs.music;
  }

  /** Follow the visual clock (motion mode). */
  sync(s: SyncState): void {
    this.narrating = null;
    const on = s.playing && !this.prefs.muted;
    this.voices.forEach((el, i) => want(el, s.local, on && i === s.index));
    want(this.music, s.t, on && this.prefs.musicOn);
  }

  /** Storyboard mode: speak one chapter from its start, on request; no music. */
  narrate(index: number): void {
    this.narrating = index;
    this.music.pause();
    this.voices.forEach((el, i) => {
      if (i === index && !this.prefs.muted) {
        el.currentTime = 0;
        void el.play()?.catch(() => undefined);
      } else if (!el.paused) el.pause();
    });
  }

  get narratingIndex(): number | null {
    return this.narrating;
  }

  stop(): void {
    this.narrating = null;
    for (const el of [...this.voices, this.music]) if (!el.paused) el.pause();
  }

  /** Stop and release everything (dialog closed). */
  destroy(): void {
    this.stop();
    for (const el of [...this.voices, this.music]) {
      el.removeAttribute('src');
      try {
        el.load();
      } catch {
        /* jsdom */
      }
      el.remove();
    }
  }
}
