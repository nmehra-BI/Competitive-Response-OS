// @vitest-environment jsdom
/** Tour audio controller: sync with the visual clock, mute, music off, narration-only mode, stop on close. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installMediaMock } from './audio-mock';
import { DEFAULT_PREFS, loadPrefs, PREFS_KEY, savePrefs, TourAudio, voiceStem } from './audio';
import { CHAPTERS, TOTAL_SECONDS } from './script';
import timing from './timing.json';

let media: ReturnType<typeof installMediaMock>;
let box: HTMLDivElement;
let a: TourAudio;
const ids = CHAPTERS.map((c) => c.id);

beforeEach(() => {
  media = installMediaMock();
  box = document.createElement('div');
  document.body.appendChild(box);
  a = new TourAudio(box, ids, 'decide', 'webm');
  a.apply(DEFAULT_PREFS);
});
afterEach(() => {
  a.destroy();
  box.remove();
  media.restore();
  localStorage.removeItem(PREFS_KEY);
});

describe('TourAudio', () => {
  it('loads one voice per chapter (the role chapter for the viewer’s path) and one music bed, lazily', () => {
    const srcs = Array.from(box.querySelectorAll('audio')).map((el) => el.getAttribute('src'));
    expect(srcs).toEqual([
      ...ids.map((id) => `/onboarding/audio/${voiceStem(id, 'decide')}.webm`),
      '/onboarding/audio/music.webm',
    ]);
    expect(srcs).toContain('/onboarding/audio/voice-role-decide.webm');
    expect(box.querySelectorAll('audio')[0]!.preload).toBe('auto');
  });

  it('plays only the current chapter’s voice and the music, at the visual time; pause pauses both', () => {
    a.sync({ playing: true, index: 2, local: 1.5, t: 25 });
    expect(a.voices[2]!.paused).toBe(false);
    expect(a.voices[2]!.currentTime).toBe(1.5);
    expect(a.music.paused).toBe(false);
    expect(a.music.currentTime).toBe(25);
    expect(a.voices.filter((v) => !v.paused)).toHaveLength(1);
    a.sync({ playing: false, index: 2, local: 1.6, t: 25.1 });
    expect(media.playing(box)).toHaveLength(0);
  });

  it('seeks only when the audio drifts from the clock; a chapter jump switches the voice', () => {
    a.sync({ playing: true, index: 0, local: 1, t: 1 });
    const seeks = () => media.calls.filter((c) => c.op === 'seek' && c.el === a.voices[0]).length;
    a.voices[0]!.currentTime = 1.1; // the element advanced by itself
    const before = seeks();
    a.sync({ playing: true, index: 0, local: 1.2, t: 1.2 }); // within the drift window: no seek
    expect(seeks()).toBe(before);
    a.sync({ playing: true, index: 0, local: 5, t: 5 }); // scrubbed: seek
    expect(a.voices[0]!.currentTime).toBe(5);
    a.sync({
      playing: true,
      index: 4,
      local: 0,
      t: CHAPTERS.slice(0, 4).reduce((s, c) => s + c.duration, 0),
    });
    expect(a.voices[0]!.paused).toBe(true);
    expect(a.voices[4]!.paused).toBe(false);
  });

  it('does not play past the end of a chapter’s voice file', () => {
    media.setDuration(a.voices[1]!, 3);
    a.sync({ playing: true, index: 1, local: 3.5, t: 12 });
    expect(a.voices[1]!.paused).toBe(true);
  });

  it('mute pauses everything; music off keeps the voice', () => {
    a.apply({ ...DEFAULT_PREFS, muted: true });
    a.sync({ playing: true, index: 0, local: 1, t: 1 });
    expect(media.playing(box)).toHaveLength(0);
    a.apply({ ...DEFAULT_PREFS, musicOn: false, voice: 0.5 });
    a.sync({ playing: true, index: 0, local: 1, t: 1 });
    expect(a.voices[0]!.paused).toBe(false);
    expect(a.voices[0]!.volume).toBe(0.5);
    expect(a.music.paused).toBe(true);
  });

  it('narrates one chapter from its start without music (storyboard), and stop() silences it', () => {
    a.narrate(3);
    expect(a.voices[3]!.paused).toBe(false);
    expect(a.voices[3]!.currentTime).toBe(0);
    expect(a.music.paused).toBe(true);
    a.stop();
    expect(media.playing(box)).toHaveLength(0);
  });

  it('destroy stops and removes every element (dialog closed)', () => {
    a.sync({ playing: true, index: 0, local: 1, t: 1 });
    const els = Array.from(box.querySelectorAll('audio'));
    a.destroy();
    expect(els.every((el) => el.paused)).toBe(true);
    expect(box.querySelectorAll('audio')).toHaveLength(0);
  });
});

describe('preferences', () => {
  it('round-trip through local storage and fall back to defaults on bad data', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    savePrefs({ muted: true, musicOn: false, voice: 0.4, music: 0.2 });
    expect(loadPrefs()).toEqual({ muted: true, musicOn: false, voice: 0.4, music: 0.2 });
    localStorage.setItem(PREFS_KEY, '{not json');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    localStorage.setItem(PREFS_KEY, JSON.stringify({ voice: 7 }));
    expect(loadPrefs().voice).toBe(DEFAULT_PREFS.voice);
  });
});

describe('timing', () => {
  it('cues never overlap, start after their scene’s design time, and chapters cover the narration', () => {
    expect(timing.total).toBeCloseTo(TOTAL_SECONDS, 5);
    for (const c of timing.chapters) {
      for (let i = 0; i < c.cues.length; i++) {
        const q = c.cues[i]!;
        expect(q.end).toBeGreaterThan(q.at);
        if (i > 0) expect(q.at).toBeGreaterThan(c.cues[i - 1]!.end);
      }
      expect(c.duration).toBeGreaterThanOrEqual(c.cues.at(-1)!.end);
    }
  });
});
