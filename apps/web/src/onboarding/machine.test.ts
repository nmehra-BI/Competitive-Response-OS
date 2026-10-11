// @vitest-environment jsdom
/** The first-run UI machine, the Next line and the explainer script (ONBOARDING.md §3, §5, §6). */
import {
  expectedDisplay,
  expectedExtension,
  outcomeObservations,
  pilotTasks,
} from '@growth-os/fixtures-aster';
import { composeSteps } from '@growth-os/domain';
import type { ReviewRequest } from '@growth-os/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { effectsOf, INITIAL_UI, readAutostart, reduce, type UiEvent, type UiState } from './machine';
import { nextAction } from './next';
import {
  captionAt,
  CHAPTERS,
  CHAPTER_STARTS,
  locate,
  ROLE_ENDINGS,
  TOTAL_SECONDS,
  TOUR_BUTTON_LABEL,
  transcript,
} from './explainer/script';
import narration from './explainer/narration.json';
import timing from './explainer/timing.json';

const run = (events: UiEvent[], from: UiState = INITIAL_UI) => events.reduce(reduce, from);

describe('first-login trigger', () => {
  it('shows the welcome once, only when the server says it was never seen and autostart is on', () => {
    expect(run([{ type: 'LOADED', welcomeSeen: false, autostart: true }]).layer).toEqual({ kind: 'welcome' });
    expect(run([{ type: 'LOADED', welcomeSeen: true, autostart: true }]).layer).toEqual({ kind: 'idle' });
    expect(run([{ type: 'LOADED', welcomeSeen: false, autostart: false }]).layer).toEqual({ kind: 'idle' });
    // A later refetch in the same session never reopens it.
    const s = run([
      { type: 'LOADED', welcomeSeen: false, autostart: true },
      { type: 'SKIP_WELCOME' },
      { type: 'LOADED', welcomeSeen: false, autostart: true },
    ]);
    expect(s.layer).toEqual({ kind: 'idle' });
  });

  it('never opens the welcome over another layer', () => {
    const s = run([{ type: 'OPEN_GUIDE' }, { type: 'LOADED', welcomeSeen: false, autostart: true }]);
    expect(s.layer).toEqual({ kind: 'guide' });
  });

  it('records the welcome for every way out of it, and only from the welcome', () => {
    const welcome = run([{ type: 'LOADED', welcomeSeen: false, autostart: true }]);
    for (const e of ['PLAY_TOUR', 'SKIP_WELCOME', 'OPEN_GUIDE'] as const)
      expect(effectsOf(welcome, { type: e })).toEqual([{ kind: 'welcomeSeen' }]);
    expect(effectsOf(INITIAL_UI, { type: 'PLAY_TOUR' })).toEqual([]); // a replay is not a welcome
  });

  it('the tour plays only after an action and records completed or skipped', () => {
    const welcome = run([{ type: 'LOADED', welcomeSeen: false, autostart: true }]);
    const playing = reduce(welcome, { type: 'PLAY_TOUR' });
    expect(playing.layer).toEqual({ kind: 'explainer', autoPlay: true });
    expect(effectsOf(playing, { type: 'TOUR_FINISHED' })).toEqual([
      { kind: 'explainer', status: 'completed' },
    ]);
    expect(reduce(playing, { type: 'TOUR_FINISHED' }).layer.kind).toBe('explainer'); // end card stays
    expect(effectsOf(playing, { type: 'TOUR_CLOSED' })).toEqual([{ kind: 'explainer', status: 'skipped' }]);
    expect(reduce(playing, { type: 'TOUR_CLOSED' }).layer).toEqual({ kind: 'idle' });
  });

  it('autostart is on unless this browser opted out', () => {
    localStorage.removeItem('gos.onboarding.autostart');
    expect(readAutostart()).toBe(true);
    localStorage.setItem('gos.onboarding.autostart', 'off');
    expect(readAutostart()).toBe(false);
  });
  afterEach(() => localStorage.removeItem('gos.onboarding.autostart'));
});

describe('guide and coach marks', () => {
  it('one layer at a time: Show me replaces the guide; Next moves on; close records the dismissal', () => {
    let s = run([{ type: 'OPEN_GUIDE' }, { type: 'SHOW_ME', step: 'build.sizing' }]);
    expect(s.layer).toEqual({ kind: 'coach', step: 'build.sizing' });
    expect(effectsOf(s, { type: 'COACH_NEXT', step: 'build.validation' })).toEqual([
      { kind: 'dismissCoachMark', step: 'build.sizing' },
    ]);
    s = reduce(s, { type: 'COACH_NEXT', step: 'build.validation' });
    expect(s.layer).toEqual({ kind: 'coach', step: 'build.validation' });
    expect(reduce(s, { type: 'COACH_NEXT', step: null }).layer).toEqual({ kind: 'guide' });
    expect(effectsOf(s, { type: 'COACH_CLOSE' })).toEqual([
      { kind: 'dismissCoachMark', step: 'build.validation' },
    ]);
    expect(reduce(s, { type: 'COACH_CLOSE' }).layer).toEqual({ kind: 'idle' });
  });

  it('toggle opens and closes the guide; reset shows the welcome again', () => {
    expect(run([{ type: 'TOGGLE_GUIDE' }]).layer).toEqual({ kind: 'guide' });
    expect(run([{ type: 'TOGGLE_GUIDE' }, { type: 'TOGGLE_GUIDE' }]).layer).toEqual({ kind: 'idle' });
    expect(run([{ type: 'RESET' }]).layer).toEqual({ kind: 'welcome' });
  });
});

describe('Next follows real state', () => {
  const steps = composeSteps('decide', {}, [], { caseKey: null });
  it('a gate decision waiting comes first and says a person decides', () => {
    const n = nextAction(steps, {
      gateDecisions: [
        {
          caseKey: 'ME-104',
          buttonLabel: 'Approve pilot €120k · 90 days',
          dueText: 'Due today, 27 Nov',
          href: '/me/cases/ME-104/decisions?gate=G2&version=3',
        },
      ],
      reviewRequests: [],
    });
    expect(n.title).toBe('You have a G2 decision waiting');
    expect(n.detail).toContain('Approve pilot €120k · 90 days · ME-104');
    expect(n.detail).toContain('Nothing is approved until you choose an action and give a rationale.');
    expect(n.href).toBe('/me/cases/ME-104/decisions?gate=G2&version=3');
  });

  it('then an open review request, then the first incomplete step, then complete', () => {
    const rr = {
      status: 'open',
      caseKey: 'ME-104',
      question: 'Is the margin assumption supported?',
    } as ReviewRequest;
    expect(nextAction(steps, { gateDecisions: [], reviewRequests: [rr] }).kind).toBe('review');
    expect(
      nextAction(steps, { gateDecisions: [], reviewRequests: [{ ...rr, status: 'responded' }] }).step?.key,
    ).toBe('decide.reviews');
    const done = steps.map((s) => ({ ...s, done: true }));
    expect(nextAction(done, undefined).kind).toBe('complete');
  });
});

describe('explainer script', () => {
  it('is 8 chapters timed by the narration, with contiguous chapter starts', () => {
    expect(CHAPTERS).toHaveLength(8);
    expect(TOTAL_SECONDS).toBeCloseTo(timing.total, 5);
    // Narration may lengthen a scene, never shorten it (D-201).
    expect(CHAPTERS.map((c) => c.duration).every((d, i) => d >= [9, 10, 12, 12, 13, 10, 10, 8][i]!)).toBe(
      true,
    );
    let at = 0;
    CHAPTERS.forEach((c, i) => {
      expect(CHAPTER_STARTS[i]).toBeCloseTo(at, 5);
      at += c.duration;
    });
    expect(locate(0)).toEqual({ index: 0, local: 0 });
    const s4 = CHAPTER_STARTS[4]!;
    expect(locate(s4 + 1).index).toBe(4);
    expect(locate(s4 + 1).local).toBeCloseTo(1, 5);
    expect(locate(9999)).toEqual({ index: 7, local: CHAPTERS[7]!.duration });
    expect(TOUR_BUTTON_LABEL).toBe(
      TOTAL_SECONDS <= 95
        ? 'Play the 90-second tour'
        : `Play the ${Math.round(TOTAL_SECONDS / 60)}-minute tour`,
    );
  });

  it('the captions are exactly the narration (one cue = one spoken sentence group)', () => {
    CHAPTERS.forEach((c, i) => {
      expect(c.cues.map((q) => q.text)).toEqual(narration.chapters[i]!.cues.map((q) => q.text));
      expect(c.cues.map((q) => q.at)).toEqual(timing.chapters[i]!.cues.map((q) => q.at));
    });
    expect(ROLE_ENDINGS.decide.line).toBe(narration.roleLines.decide);
  });

  it('uses the fixture’s figures and labels verbatim', () => {
    const text = transcript('decide')
      .flatMap((c) => c.lines)
      .join(' ');
    expect(text).toContain(expectedDisplay.pilotButton); // Approve pilot €120k · 90 days
    expect(text).toContain('€100m/year');
    expect(text).toContain('€40m/year');
    expect(text).toContain('500 unique sites');
    expect(text).toContain('€2.0m annual revenue');
    expect(text).toContain(`Confirmed · ${pilotTasks[0].externalKey}`);
    expect(text).toContain('€30k · 45 days');
    expect(expectedExtension.buttonLabel).toContain('€30k · 45 days');
    expect(outcomeObservations[0].valueText).toBe('3 of 4');
  });

  it('never claims automatic approval, never calls AI output a fact, never totals measures', () => {
    const all = (['build', 'decide', 'run', 'review', 'configure'] as const)
      .flatMap((p) => transcript(p).flatMap((c) => c.lines))
      .join(' ');
    expect(all).not.toMatch(/auto(matic(ally)?)?[- ]?approv|\bSynced\b|forecast|total opportunity/i);
    expect(all).toContain('An AI draft stays a draft until a person accepts it.');
    expect(all).toContain('They are never added up.');
    expect(all).toContain('Nothing passes a gate on its own.');
    expect(all).toContain('Finishing tasks never passes a gate.');
  });

  it('the last chapter speaks to the viewer’s role', () => {
    expect(captionAt(7, 0, 'decide')).toBe(ROLE_ENDINGS.decide.line);
    expect(captionAt(7, 0, 'build')).toBe(ROLE_ENDINGS.build.line);
    expect(captionAt(7, CHAPTERS[7]!.cues[1]!.at + 0.1, 'build')).toContain('Illustrative data');
    expect(ROLE_ENDINGS.configure.line).toContain('they never approve');
  });
});
