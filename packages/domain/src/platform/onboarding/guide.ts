/**
 * First-run guide rules (ONBOARDING.md §3, §6; decisions.md D-190 onward). Pure: no I/O, no clock.
 *
 * - `guidePathFor` picks one role path in the research §8.2 landing order.
 * - `GUIDE_STEPS` is the step catalogue per path (copy, where "Show me" goes, coach-mark anchors).
 * - `composeSteps` merges derived facts (state steps) with visited steps (visit steps).
 * - `checkPatch` refuses changes that do not belong to the viewer's path; state steps cannot be set.
 *
 * Copy rules: research §7.4 vocabulary; a person decides (never "auto-approved"); AI output is a draft;
 * "Confirmed" only with an external key; "Done" is reserved for tasks, so steps read "Complete".
 */
import type { GuidePath, GuideStep, GuideStepKey, OnboardingPatch, RoleCode } from '@growth-os/contracts';

/** Research §8.2: the first matching role wins (same order as the API's landing route). */
const PATH_BY_ROLE: readonly [RoleCode, GuidePath][] = [
  ['sponsor', 'decide'],
  ['investment_committee', 'decide'],
  ['case_owner', 'build'],
  ['finance_reviewer', 'review'],
  ['pilot_owner', 'run'],
  ['product_reviewer', 'review'],
  ['specialist_reviewer', 'review'],
  ['commercial_reviewer', 'review'],
  ['read_only_reviewer', 'review'],
  ['tenant_admin', 'configure'],
];

export function guidePathFor(roles: readonly { role: RoleCode; revokedAt?: string | null }[]): GuidePath {
  const active = roles.filter((r) => !r.revokedAt);
  for (const [role, path] of PATH_BY_ROLE) if (active.some((r) => r.role === role)) return path;
  return 'review';
}

/** Context for hrefs: the viewer's own most recent case, when there is one. */
export interface GuideContext {
  caseKey: string | null;
}

interface StepDef {
  key: GuideStepKey;
  title: string;
  why: string;
  href: (c: GuideContext) => string;
  anchors: string[];
  visitPaths: string[];
  completion: 'state' | 'visit';
}

const nav = (slug: string) => `[data-guide="nav-${slug}"]`;
const caseTab = (tab: string) => `nav[aria-label="Case sections"] a[href*="/${tab}"]`;
const inCase = (tab: string, fallback: string) => (c: GuideContext) =>
  c.caseKey ? `/me/cases/${encodeURIComponent(c.caseKey)}/${tab}` : fallback;
const MAIN_H1 = '#main h1';

export const GUIDE_STEPS: Readonly<Record<GuidePath, readonly StepDef[]>> = {
  build: [
    {
      key: 'build.shortlist',
      title: 'Shortlist an opportunity',
      why: 'Pick a candidate from your mandate to look at closely. Press s on a selected row to shortlist it.',
      href: () => '/me/opportunities',
      anchors: ['[aria-label="Opportunity candidates"]', MAIN_H1, nav('opportunities')],
      visitPaths: [],
      completion: 'state',
    },
    {
      key: 'build.case',
      title: 'Open your expansion case',
      why: 'Converting a shortlisted opportunity creates the case: one place for evidence, sizing, approvals and the pilot.',
      href: () => '/me/cases',
      anchors: [MAIN_H1, nav('cases')],
      visitPaths: [],
      completion: 'state',
    },
    {
      key: 'build.sizing',
      title: 'Size the market',
      why: 'Build the measure ladder: TAM, SAM, reachable pool and SOM are separate questions and are never added up.',
      href: inCase('sizing', '/me/cases'),
      anchors: [caseTab('sizing'), MAIN_H1, nav('cases')],
      visitPaths: [],
      completion: 'state',
    },
    {
      key: 'build.validation',
      title: 'Plan validation',
      why: 'Turn the riskiest assumptions into experiments with thresholds you set before you look at results.',
      href: inCase('validation', '/me/cases'),
      anchors: [caseTab('validation'), MAIN_H1, nav('cases')],
      visitPaths: [],
      completion: 'state',
    },
    {
      key: 'build.submitG2',
      title: 'Submit G2 for a decision',
      why: 'Submitting creates a snapshot. A person with authority decides on that exact version; you cannot approve your own.',
      href: (c) => (c.caseKey ? `/me/cases/${encodeURIComponent(c.caseKey)}/decisions?gate=G2` : '/me/cases'),
      anchors: [caseTab('decisions'), '[aria-label="Stage and gate rail"]', MAIN_H1],
      visitPaths: [],
      completion: 'state',
    },
  ],
  decide: [
    {
      key: 'decide.reviews',
      title: 'Open Reviews',
      why: 'Decisions waiting for you are listed here with their scope and due date.',
      href: () => '/reviews?tab=awaiting',
      anchors: ['[aria-label="Gate decisions awaiting you"]', MAIN_H1, nav('reviews')],
      visitPaths: ['/reviews'],
      completion: 'visit',
    },
    {
      key: 'decide.package',
      title: 'Read the decision package',
      why: 'The package is a fixed snapshot: what is requested, the evidence, dissent and conditions, and what it does not authorize.',
      href: () => '/reviews?tab=awaiting',
      anchors: ['[aria-label="Decision package"]', '[aria-label="Gate decisions awaiting you"]', MAIN_H1],
      visitPaths: ['/me/cases/*/decisions', '/me/cases/*/brief'],
      completion: 'visit',
    },
    {
      key: 'decide.decide',
      title: 'Decide within your authority',
      why: 'Nothing is approved until you choose a scoped action, such as “Approve pilot €120k · 90 days”, and give a rationale.',
      href: () => '/reviews?tab=awaiting',
      anchors: ['[aria-label="Approval panel"]', '[aria-label="Gate decisions awaiting you"]', MAIN_H1],
      visitPaths: [],
      completion: 'state',
    },
  ],
  run: [
    {
      key: 'run.myWork',
      title: 'Open My Work',
      why: 'Your tasks, milestones and conditions across cases, with what is due next.',
      href: () => '/my-work',
      anchors: [MAIN_H1, nav('my-work')],
      visitPaths: ['/my-work'],
      completion: 'visit',
    },
    {
      key: 'run.pilotPlan',
      title: 'Review the pilot plan',
      why: 'The plan, budget and stop rules the approver signed off. Changes to scope need a new decision.',
      href: inCase('pilot', '/my-work'),
      anchors: [caseTab('pilot'), MAIN_H1, nav('my-work')],
      visitPaths: ['/me/cases/*/pilot'],
      completion: 'visit',
    },
    {
      key: 'run.taskSync',
      title: 'Check what reached Jira',
      why: 'A task reads “Confirmed · PIL-11” only after Jira returns the key. Failed tasks can be retried without duplicates.',
      href: inCase('pilot', '/my-work'),
      anchors: [caseTab('pilot'), MAIN_H1, nav('my-work')],
      visitPaths: [],
      completion: 'state',
    },
    {
      key: 'run.actuals',
      title: 'Record actuals',
      why: 'At the review, record what you measured against the thresholds set before the pilot. Finishing tasks never passes a gate.',
      href: inCase('outcomes', '/my-work'),
      anchors: [caseTab('outcomes'), MAIN_H1, nav('my-work')],
      visitPaths: [],
      completion: 'state',
    },
  ],
  review: [
    {
      key: 'review.requests',
      title: 'Open your review requests',
      why: 'Each request says what to check and on which version.',
      href: () => '/reviews?tab=assigned',
      anchors: [MAIN_H1, nav('reviews')],
      visitPaths: ['/reviews'],
      completion: 'visit',
    },
    {
      key: 'review.respond',
      title: 'Respond with a reason',
      why: 'Confirm, dispute or abstain — always with a reason. A dispute opens a thread on the assumption.',
      href: () => '/reviews?tab=assigned',
      anchors: [MAIN_H1, nav('reviews')],
      visitPaths: [],
      completion: 'state',
    },
    {
      key: 'review.brief',
      title: 'Read a decision brief',
      why: 'The read-only brief shows the snapshot your review feeds into, without the working tabs.',
      href: () => '/reviews?tab=assigned',
      anchors: ['[aria-label="Decision package"]', MAIN_H1, nav('reviews')],
      visitPaths: ['/me/cases/*/brief', '/me/cases/*/decisions'],
      completion: 'visit',
    },
  ],
  configure: [
    {
      key: 'configure.connections',
      title: 'Check connections',
      why: 'Source and task-tool connections, their status and the task mapping.',
      href: () => '/admin/connections',
      anchors: ['[aria-label="Administration sections"]', MAIN_H1, nav('administration')],
      visitPaths: ['/admin/connections'],
      completion: 'visit',
    },
    {
      key: 'configure.authority',
      title: 'Check authority coverage',
      why: 'Who may decide which gate, up to what amount. Gaps are listed so they can be granted — administrators never approve.',
      href: () => '/admin/authority',
      anchors: ['[aria-label="Administration sections"]', MAIN_H1, nav('administration')],
      visitPaths: ['/admin/authority'],
      completion: 'visit',
    },
    {
      key: 'configure.policies',
      title: 'Review policies',
      why: 'Gate, materiality and expiry policies. Changes publish a new version; nothing changes silently.',
      href: () => '/admin/policies',
      anchors: ['[aria-label="Administration sections"]', MAIN_H1, nav('administration')],
      visitPaths: ['/admin/policies'],
      completion: 'visit',
    },
  ],
};

export function stepDef(path: GuidePath, key: GuideStepKey): StepDef | undefined {
  return GUIDE_STEPS[path].find((s) => s.key === key);
}

/** Steps for a path: state steps from `derived`, visit steps from `visited`. */
export function composeSteps(
  path: GuidePath,
  derived: Partial<Record<GuideStepKey, boolean>>,
  visited: readonly string[],
  ctx: GuideContext,
): GuideStep[] {
  return GUIDE_STEPS[path].map((d) => ({
    key: d.key,
    title: d.title,
    why: d.why,
    href: d.href(ctx),
    anchors: [...d.anchors],
    visitPaths: [...d.visitPaths],
    completion: d.completion,
    done: d.completion === 'state' ? derived[d.key] === true : visited.includes(d.key),
  }));
}

/** First incomplete step, or null when the path is complete. */
export function nextStep<T extends { done: boolean }>(steps: readonly T[]): T | null {
  return steps.find((s) => !s.done) ?? null;
}

/** Does a pathname match a visit pattern (`*` = one path segment)? */
export function matchesVisitPath(pathname: string, pattern: string): boolean {
  const re = new RegExp(
    `^${pattern
      .split('*')
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]+')}(?:/.*)?$`,
  );
  return re.test(pathname);
}

/** Visit steps of a path that a pathname completes. */
export function visitStepsFor(path: GuidePath, pathname: string): GuideStepKey[] {
  return GUIDE_STEPS[path]
    .filter((s) => s.completion === 'visit' && s.visitPaths.some((p) => matchesVisitPath(pathname, p)))
    .map((s) => s.key);
}

export type PatchRefusal = { ok: false; reason: string };

/** Refuse patch fields that do not belong to the viewer's path or that would set a derived step. */
export function checkPatch(path: GuidePath, patch: OnboardingPatch): { ok: true } | PatchRefusal {
  if (patch.visitedStep) {
    const d = stepDef(path, patch.visitedStep);
    if (!d) return { ok: false, reason: 'That step is not part of your guide.' };
    if (d.completion !== 'visit')
      return { ok: false, reason: 'This step completes from your work, not from a click.' };
  }
  if (patch.dismissCoachMark && !stepDef(path, patch.dismissCoachMark))
    return { ok: false, reason: 'That step is not part of your guide.' };
  return { ok: true };
}

/** Stored per-user row (subset the rules need). */
export interface OnboardingRowState {
  welcomeSeen: boolean;
  explainer: 'not_started' | 'completed' | 'skipped';
  guideDismissed: boolean;
  visitedSteps: string[];
  coachMarksDismissed: string[];
}

export const EMPTY_ONBOARDING: OnboardingRowState = Object.freeze({
  welcomeSeen: false,
  explainer: 'not_started',
  guideDismissed: false,
  visitedSteps: [],
  coachMarksDismissed: [],
}) as OnboardingRowState;

/**
 * Apply a checked patch. "completed" is never downgraded to "skipped" (a replay that is skipped keeps
 * the earlier completion); lists only grow.
 */
export function applyPatch(row: OnboardingRowState, patch: OnboardingPatch): OnboardingRowState {
  const add = (list: string[], v: string | undefined) => (v && !list.includes(v) ? [...list, v] : list);
  return {
    welcomeSeen: row.welcomeSeen || patch.welcomeSeen === true,
    explainer:
      patch.explainer === undefined
        ? row.explainer
        : row.explainer === 'completed'
          ? 'completed'
          : patch.explainer,
    guideDismissed: patch.guideDismissed ?? row.guideDismissed,
    visitedSteps: add(row.visitedSteps, patch.visitedStep),
    coachMarksDismissed: add(row.coachMarksDismissed, patch.dismissCoachMark),
  };
}
