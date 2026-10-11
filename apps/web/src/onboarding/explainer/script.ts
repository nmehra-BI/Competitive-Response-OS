/**
 * The explainer's storyboard and script (ONBOARDING.md §5). Eight chapters, narrated, with captions that are
 * the exact narration.
 * Figures are the Aster fixture's, verbatim (fixtures/aster expectedDisplay, pilotTasks, outcomeObservations,
 * expectedExtension). Labels follow research §7.4; nothing here is formatted at run time.
 */
import type { GuidePath } from '@growth-os/contracts';
import narration from './narration.json';
import timing from './timing.json';

export interface Cue {
  /** Seconds from the chapter start. */
  at: number;
  text: string;
}

export interface Chapter {
  id: string;
  title: string;
  /** Seconds. */
  duration: number;
  cues: Cue[];
}

/**
 * Narration = captions (D-200): the words come from narration.json and are spoken verbatim; the timing comes
 * from timing.json, written by scripts/onboarding-audio/generate.py from the rendered voice, so captions,
 * visuals and audio share one clock. A chapter is never shorter than its scene.
 */
export const CHAPTERS: readonly Chapter[] = narration.chapters.map((c, i) => {
  const t = timing.chapters[i]!;
  if (t.id !== c.id) throw new Error(`timing.json is out of date for chapter ${c.id}`);
  return {
    id: c.id,
    title: c.title,
    duration: t.duration,
    cues: c.cues.map((q, j) => ({ at: t.cues[j]!.at, text: q.text })),
  };
});

export interface RoleEnding {
  line: string;
  cta: string;
  href: string;
  steps: [string, string, string];
}

export const ROLE_ENDINGS: Readonly<Record<GuidePath, RoleEnding>> = {
  build: {
    line: narration.roleLines.build,
    cta: 'Start with Opportunities',
    href: '/me/opportunities',
    steps: ['Shortlist', 'Size and validate', 'Submit G2'],
  },
  decide: {
    line: narration.roleLines.decide,
    cta: 'Open Reviews',
    href: '/reviews?tab=awaiting',
    steps: ['Open Reviews', 'Read the package', 'Decide, with a rationale'],
  },
  run: {
    line: narration.roleLines.run,
    cta: 'Open My Work',
    href: '/my-work',
    steps: ['My Work', 'Pilot plan', 'Confirmed tasks'],
  },
  review: {
    line: narration.roleLines.review,
    cta: 'Open review requests',
    href: '/reviews?tab=assigned',
    steps: ['Review requests', 'Respond with a reason', 'Read the brief'],
  },
  configure: {
    line: narration.roleLines.configure,
    cta: 'Open Administration',
    href: '/admin/connections',
    steps: ['Connections', 'Authority', 'Policies'],
  },
};

export const TOTAL_SECONDS = CHAPTERS.reduce((s, c) => s + c.duration, 0);

/** The welcome's play button names the real length (the narration sets it, D-201). */
export const TOUR_BUTTON_LABEL =
  TOTAL_SECONDS <= 95 ? 'Play the 90-second tour' : `Play the ${Math.round(TOTAL_SECONDS / 60)}-minute tour`;

/** Chapter start times in seconds. */
export const CHAPTER_STARTS: readonly number[] = CHAPTERS.reduce<number[]>(
  (acc, c, i) => [...acc, i === 0 ? 0 : acc[i - 1]! + CHAPTERS[i - 1]!.duration],
  [],
);

/** Which chapter a time (seconds) falls in, and the local time within it. */
export function locate(t: number): { index: number; local: number } {
  const clamped = Math.max(0, Math.min(t, TOTAL_SECONDS));
  for (let i = CHAPTERS.length - 1; i >= 0; i--) {
    if (clamped >= CHAPTER_STARTS[i]!) return { index: i, local: clamped - CHAPTER_STARTS[i]! };
  }
  return { index: 0, local: 0 };
}

/** The caption on screen at a chapter's local time (role line substituted in the last chapter). */
export function captionAt(index: number, local: number, path: GuidePath): string {
  const cues = CHAPTERS[index]!.cues;
  let cue = cues[0]!;
  for (const c of cues) if (local >= c.at) cue = c;
  return cue.text || ROLE_ENDINGS[path].line;
}

/** Full transcript for a path, chapter by chapter. */
export function transcript(path: GuidePath): { title: string; lines: string[] }[] {
  return CHAPTERS.map((c) => ({
    title: c.title,
    lines: c.cues.map((q) => q.text || ROLE_ENDINGS[path].line),
  }));
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
