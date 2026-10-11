/**
 * The guide's "Next" line (ONBOARDING.md §3). It follows real state, in order: a gate decision waiting for the
 * viewer, an open review request for the viewer, the first incomplete step, else "You're set up". Inputs are
 * only views the viewer can already read (`reviews.inbox`, `onboarding.get`), so nothing hidden is named or
 * counted. The copy always says a person decides.
 */
import type { GuideStep, ReviewRequest } from '@growth-os/contracts';

export interface GateWaiting {
  caseKey: string;
  buttonLabel: string;
  dueText: string;
  href: string;
}

export interface NextAction {
  kind: 'decision' | 'review' | 'step' | 'complete';
  title: string;
  detail: string;
  href: string | null;
  step: GuideStep | null;
}

function gateOf(href: string, label: string): string {
  const m = /[?&]gate=(G[0-3]|X)\b/.exec(href);
  if (m) return m[1] === 'X' ? 'extension' : m[1]!;
  if (/extension/i.test(label)) return 'extension';
  return 'gate';
}

export function nextAction(
  steps: readonly GuideStep[],
  inbox: { gateDecisions: readonly GateWaiting[]; reviewRequests: readonly ReviewRequest[] } | undefined,
): NextAction {
  const gate = inbox?.gateDecisions[0];
  if (gate) {
    const g = gateOf(gate.href, gate.buttonLabel);
    return {
      kind: 'decision',
      title: `You have a ${g} decision waiting`,
      detail: `${gate.buttonLabel} · ${gate.caseKey} · ${gate.dueText}. Nothing is approved until you choose an action and give a rationale.`,
      href: gate.href,
      step: null,
    };
  }
  const review = inbox?.reviewRequests.find((r) => r.status === 'open');
  if (review) {
    return {
      kind: 'review',
      title: 'You have a review request waiting',
      detail: `${review.caseKey} · ${review.question}`,
      href: '/reviews?tab=assigned',
      step: null,
    };
  }
  const step = steps.find((s) => !s.done) ?? null;
  if (step) return { kind: 'step', title: step.title, detail: step.why, href: step.href, step };
  return {
    kind: 'complete',
    title: 'You’re set up',
    detail: 'Every step of your guide is complete. The guide stays here if you need it.',
    href: null,
    step: null,
  };
}
