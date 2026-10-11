/**
 * The explainer's storyboard and script (ONBOARDING.md §5). Eight chapters, 84 seconds, captions only.
 * Figures are the Aster fixture's, verbatim (fixtures/aster expectedDisplay, pilotTasks, outcomeObservations,
 * expectedExtension). Labels follow research §7.4; nothing here is formatted at run time.
 */
import type { GuidePath } from '@growth-os/contracts';

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

export const CHAPTERS: readonly Chapter[] = [
  {
    id: 'problem',
    title: 'Scattered decisions',
    duration: 9,
    cues: [
      {
        at: 0,
        text: 'Expansion decisions usually live in slides, spreadsheets, email threads and task tools.',
      },
      { at: 4.5, text: 'Numbers drift, approvals get lost, and no one can say exactly what was agreed.' },
    ],
  },
  {
    id: 'case',
    title: 'One expansion case',
    duration: 10,
    cues: [
      {
        at: 0,
        text: 'Market Expansion keeps one expansion case per decision — here ME-104, German food-processing plants.',
      },
      {
        at: 5,
        text: 'Mandate, evidence, sizing, validation, approvals, pilot and outcome stay together, with an owner and a stage.',
      },
    ],
  },
  {
    id: 'kinds',
    title: 'Four kinds of claim',
    duration: 12,
    cues: [
      { at: 0, text: 'Every number says what kind of claim it is.' },
      {
        at: 3,
        text: 'Evidence is sourced. An assumption is a person’s belief, with an owner. A scenario is calculated under named assumptions. An actual is measured.',
      },
      { at: 9, text: 'An AI draft stays a draft until a person accepts it.' },
    ],
  },
  {
    id: 'ladder',
    title: 'The measure ladder',
    duration: 12,
    cues: [
      { at: 0, text: 'TAM: 5,000 sites, €100m/year. SAM: 2,000 unique sites, €40m/year.' },
      { at: 4, text: 'Reachable pool: 500 unique sites. SOM, a scenario for year 3: €2.0m annual revenue.' },
      { at: 8, text: 'Each rung answers a different question. They are never added up.' },
    ],
  },
  {
    id: 'gates',
    title: 'Gates G0–G3',
    duration: 13,
    cues: [
      { at: 0, text: 'Four gates: G0 scope, G1 validate, G2 pilot, G3 scale.' },
      {
        at: 3.5,
        text: 'A person with authority decides — for example “Approve pilot €120k · 90 days” — on the exact snapshot they read.',
      },
      {
        at: 8.5,
        text: 'If the case changes, the snapshot is stale and must be decided again. Nothing passes a gate on its own.',
      },
    ],
  },
  {
    id: 'pilot',
    title: 'Pilot and task sync',
    duration: 10,
    cues: [
      { at: 0, text: 'An approved pilot becomes owned tasks sent to your task tool.' },
      {
        at: 3,
        text: 'A task shows “Confirmed · PIL-11” only after Jira returns the key. A failed task is retried without duplicates.',
      },
      { at: 7.5, text: 'Finishing tasks never passes a gate.' },
    ],
  },
  {
    id: 'outcomes',
    title: 'Outcomes',
    duration: 10,
    cues: [
      { at: 0, text: 'At the review, actuals are compared with thresholds set before the pilot.' },
      {
        at: 3.5,
        text: 'A negative result is still a result. Here the decision is “Revise and extend validation”, with its own cap: €30k · 45 days.',
      },
      { at: 7.5, text: 'G3 Scale stays blocked until its own preconditions are met.' },
    ],
  },
  {
    id: 'role',
    title: 'Your role',
    duration: 8,
    cues: [
      { at: 0, text: '' }, // replaced by the role line
      { at: 5, text: 'Illustrative data: Aster Industrial Systems and its people are fictional.' },
    ],
  },
];

export interface RoleEnding {
  line: string;
  cta: string;
  href: string;
  steps: [string, string, string];
}

export const ROLE_ENDINGS: Readonly<Record<GuidePath, RoleEnding>> = {
  build: {
    line: 'You build the case: shortlist, size, validate, then submit G2 for a decision.',
    cta: 'Start with Opportunities',
    href: '/me/opportunities',
    steps: ['Shortlist', 'Size and validate', 'Submit G2'],
  },
  decide: {
    line: 'You decide within your authority. Read the package, then choose a scoped action — nothing is approved until you do.',
    cta: 'Open Reviews',
    href: '/reviews?tab=awaiting',
    steps: ['Open Reviews', 'Read the package', 'Decide, with a rationale'],
  },
  run: {
    line: 'You run the pilot: your tasks, the plan, and what reached Jira.',
    cta: 'Open My Work',
    href: '/my-work',
    steps: ['My Work', 'Pilot plan', 'Confirmed tasks'],
  },
  review: {
    line: 'You review what you are asked to: confirm, dispute or abstain, always with a reason.',
    cta: 'Open review requests',
    href: '/reviews?tab=assigned',
    steps: ['Review requests', 'Respond with a reason', 'Read the brief'],
  },
  configure: {
    line: 'You set up connections, roles and policies. Administrators configure; they never approve.',
    cta: 'Open Administration',
    href: '/admin/connections',
    steps: ['Connections', 'Authority', 'Policies'],
  },
};

export const TOTAL_SECONDS = CHAPTERS.reduce((s, c) => s + c.duration, 0);

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
