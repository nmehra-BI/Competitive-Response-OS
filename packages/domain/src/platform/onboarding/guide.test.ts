/** First-run guide rules (ONBOARDING.md §3, §6). */
import { describe, expect, it } from 'vitest';
import { GuideStepKey, type GuidePath, type RoleCode } from '@growth-os/contracts';
import {
  applyPatch,
  checkPatch,
  composeSteps,
  EMPTY_ONBOARDING,
  GUIDE_STEPS,
  guidePathFor,
  matchesVisitPath,
  nextStep,
  visitStepsFor,
} from './guide';

const r = (...roles: RoleCode[]) => roles.map((role) => ({ role, revokedAt: null }));

describe('role paths', () => {
  it('follows the research §8.2 landing order: the first matching role wins', () => {
    expect(guidePathFor(r('case_owner'))).toBe('build'); // Maya
    expect(guidePathFor(r('sponsor', 'case_owner'))).toBe('decide'); // Elena
    expect(guidePathFor(r('investment_committee'))).toBe('decide');
    expect(guidePathFor(r('pilot_owner', 'product_reviewer'))).toBe('run'); // Jonas
    expect(guidePathFor(r('finance_reviewer', 'pilot_owner'))).toBe('review'); // Daniel
    expect(guidePathFor(r('specialist_reviewer'))).toBe('review'); // Lena
    expect(guidePathFor(r('tenant_admin'))).toBe('configure');
  });

  it('ignores revoked roles and falls back to the reviewer path', () => {
    expect(guidePathFor([{ role: 'sponsor', revokedAt: '2026-01-01T00:00:00Z' }])).toBe('review');
    expect(guidePathFor([])).toBe('review');
  });

  it('every path is the documented sequence, every key exists in the contract, and no key repeats', () => {
    expect(GUIDE_STEPS.build.map((s) => s.key)).toEqual([
      'build.shortlist',
      'build.case',
      'build.sizing',
      'build.validation',
      'build.submitG2',
    ]);
    expect(GUIDE_STEPS.decide.map((s) => s.key)).toEqual([
      'decide.reviews',
      'decide.package',
      'decide.decide',
    ]);
    expect(GUIDE_STEPS.run.map((s) => s.key)).toEqual([
      'run.myWork',
      'run.pilotPlan',
      'run.taskSync',
      'run.actuals',
    ]);
    expect(GUIDE_STEPS.review.map((s) => s.key)).toEqual([
      'review.requests',
      'review.respond',
      'review.brief',
    ]);
    expect(GUIDE_STEPS.configure.map((s) => s.key)).toEqual([
      'configure.connections',
      'configure.authority',
      'configure.policies',
    ]);
    const all = Object.values(GUIDE_STEPS).flatMap((p) => p.map((s) => s.key));
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...GuideStepKey.options].sort());
  });

  it('copy never claims automatic approval, never calls AI output a fact and avoids reserved words', () => {
    const text = Object.values(GUIDE_STEPS)
      .flatMap((p) => p.map((s) => `${s.title} ${s.why}`))
      .join(' ');
    expect(text).not.toMatch(/auto(matic(ally)?)?[- ]?approv/i);
    expect(text).not.toMatch(/\bSynced\b|\bDone\b|forecast|total opportunity/i);
    expect(text).toContain('Nothing is approved until you choose a scoped action');
    expect(text).toContain('“Confirmed · PIL-11” only after Jira returns the key');
  });
});

describe('composeSteps and nextStep', () => {
  it('state steps come from derived facts, visit steps from visits; hrefs use the viewer’s case', () => {
    const steps = composeSteps('build', { 'build.shortlist': true, 'build.case': true }, ['build.sizing'], {
      caseKey: 'ME-104',
    });
    // A visit can never complete a state step.
    expect(steps.map((s) => s.done)).toEqual([true, true, false, false, false]);
    expect(steps[2]!.href).toBe('/me/cases/ME-104/sizing');
    expect(steps[4]!.href).toBe('/me/cases/ME-104/decisions?gate=G2');
    expect(nextStep(steps)?.key).toBe('build.sizing');
  });

  it('without a case, case steps point to the case list', () => {
    const steps = composeSteps('build', {}, [], { caseKey: null });
    expect(steps[2]!.href).toBe('/me/cases');
  });

  it('nextStep is null when every step is complete', () => {
    const steps = composeSteps(
      'configure',
      {},
      ['configure.connections', 'configure.authority', 'configure.policies'],
      { caseKey: null },
    );
    expect(nextStep(steps)).toBeNull();
  });
});

describe('visits', () => {
  it('matches a pattern segment by segment', () => {
    expect(matchesVisitPath('/me/cases/ME-104/decisions', '/me/cases/*/decisions')).toBe(true);
    expect(matchesVisitPath('/me/cases/ME-104/decisions/x', '/me/cases/*/decisions')).toBe(true);
    expect(matchesVisitPath('/me/cases/ME-104/sizing', '/me/cases/*/decisions')).toBe(false);
    expect(matchesVisitPath('/reviewsx', '/reviews')).toBe(false);
    expect(matchesVisitPath('/reviews', '/reviews')).toBe(true);
  });

  it('maps a pathname to the visit steps of the viewer’s path only', () => {
    expect(visitStepsFor('decide', '/me/cases/ME-104/decisions')).toEqual(['decide.package']);
    expect(visitStepsFor('review', '/me/cases/ME-104/brief')).toEqual(['review.brief']);
    expect(visitStepsFor('build', '/reviews')).toEqual([]);
  });
});

describe('patch rules', () => {
  const ok = (path: GuidePath, p: Parameters<typeof checkPatch>[1]) => checkPatch(path, p).ok;

  it('a visit step of the path may be marked; a state step or another path’s step may not', () => {
    expect(ok('decide', { visitedStep: 'decide.reviews' })).toBe(true);
    expect(ok('decide', { visitedStep: 'decide.decide' })).toBe(false); // decisions are derived, never clicked
    expect(ok('build', { visitedStep: 'build.submitG2' })).toBe(false);
    expect(ok('build', { visitedStep: 'decide.reviews' })).toBe(false);
    expect(ok('build', { dismissCoachMark: 'decide.reviews' })).toBe(false);
    expect(ok('build', { dismissCoachMark: 'build.sizing' })).toBe(true);
  });

  it('applies changes: lists only grow, completed is never downgraded, guide can be skipped and resumed', () => {
    let s = applyPatch(EMPTY_ONBOARDING, { welcomeSeen: true });
    expect(s.welcomeSeen).toBe(true);
    s = applyPatch(s, { explainer: 'completed' });
    s = applyPatch(s, { explainer: 'skipped' });
    expect(s.explainer).toBe('completed');
    s = applyPatch(s, { visitedStep: 'decide.reviews' });
    s = applyPatch(s, { visitedStep: 'decide.reviews' });
    expect(s.visitedSteps).toEqual(['decide.reviews']);
    s = applyPatch(s, { guideDismissed: true });
    expect(s.guideDismissed).toBe(true);
    s = applyPatch(s, { guideDismissed: false });
    expect(s.guideDismissed).toBe(false);
    expect(applyPatch(EMPTY_ONBOARDING, { explainer: 'skipped' }).explainer).toBe('skipped');
    expect(EMPTY_ONBOARDING.visitedSteps).toEqual([]); // never mutated
  });
});
