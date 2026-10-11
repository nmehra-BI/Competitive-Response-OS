/**
 * First-run onboarding (CR-ONB-1, decisions.md D-190 onward; design docs/market-expansion/design/ONBOARDING.md).
 * ADDITIVE to the frozen registry: one GET, one PATCH and one dev-only reset, all about the signed-in
 * person's own guide state. Nothing here reads or changes a case, a gate or any business record.
 */
import { z } from 'zod';
import { IsoDateTime } from '../primitives';
import { endpoint } from './endpoint';

const labels = <T extends string>(_e: z.ZodEnum<[T, ...T[]]>, map: Record<T, string>) =>
  Object.freeze(map) as Readonly<Record<T, string>>;

/** Role path of the "Getting started" guide (research §8.2 landing order picks it). */
export const GuidePath = z.enum(['build', 'decide', 'run', 'review', 'configure']);
export type GuidePath = z.infer<typeof GuidePath>;
export const GUIDE_PATH_LABELS = labels(GuidePath, {
  build: 'Build the case',
  decide: 'Decide investments',
  run: 'Run the pilot',
  review: 'Review what you are asked',
  configure: 'Set up the workspace',
});

/** Every guide step across the five paths. Keys are stable; copy comes with the response. */
export const GuideStepKey = z.enum([
  'build.shortlist',
  'build.case',
  'build.sizing',
  'build.validation',
  'build.submitG2',
  'decide.reviews',
  'decide.package',
  'decide.decide',
  'run.myWork',
  'run.pilotPlan',
  'run.taskSync',
  'run.actuals',
  'review.requests',
  'review.respond',
  'review.brief',
  'configure.connections',
  'configure.authority',
  'configure.policies',
]);
export type GuideStepKey = z.infer<typeof GuideStepKey>;

/** How a step completes: from workspace state, or by visiting the place it names. */
export const GuideStepCompletion = z.enum(['state', 'visit']);
export type GuideStepCompletion = z.infer<typeof GuideStepCompletion>;

export const ExplainerStatus = z.enum(['not_started', 'completed', 'skipped']);
export type ExplainerStatus = z.infer<typeof ExplainerStatus>;
export const EXPLAINER_STATUS_LABELS = labels(ExplainerStatus, {
  not_started: 'Not watched',
  completed: 'Watched',
  skipped: 'Skipped',
});

export const GuideStep = z.object({
  key: GuideStepKey,
  title: z.string(), // "Size the market"
  why: z.string(), // one line: why this matters
  href: z.string(), // where "Show me" goes (a route the viewer can open)
  /** CSS selector of the element the coach mark points at, tried in order. */
  anchors: z.array(z.string()),
  /** Route prefixes that count as "visited" for `visit` steps. */
  visitPaths: z.array(z.string()),
  completion: GuideStepCompletion,
  done: z.boolean(),
});
export type GuideStep = z.infer<typeof GuideStep>;

export const OnboardingState = z.object({
  path: GuidePath,
  welcomeSeen: z.boolean(),
  explainer: ExplainerStatus,
  /** "Skip guide": the top-bar progress is hidden; the guide still opens on request. */
  guideDismissed: z.boolean(),
  steps: z.array(GuideStep),
  coachMarksDismissed: z.array(GuideStepKey),
  /** Reset is offered only in an illustrative workspace with dev features on (D-165). */
  canReset: z.boolean(),
  updatedAt: IsoDateTime.nullable(),
});
export type OnboardingState = z.infer<typeof OnboardingState>;

/** One change per request. Every field is optional; at least one must be present. */
export const OnboardingPatch = z
  .object({
    welcomeSeen: z.literal(true).optional(),
    explainer: z.enum(['completed', 'skipped']).optional(),
    guideDismissed: z.boolean().optional(),
    /** Mark a `visit` step done (state steps are derived and cannot be set). */
    visitedStep: GuideStepKey.optional(),
    dismissCoachMark: GuideStepKey.optional(),
  })
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: 'Send at least one change.',
  });
export type OnboardingPatch = z.infer<typeof OnboardingPatch>;

export const onboardingEndpoints = {
  get: endpoint({
    id: 'onboarding.get',
    method: 'GET',
    path: '/me/onboarding',
    summary:
      "The signed-in person's first-run state and role guide: welcome seen, explainer watched or skipped, checklist steps (state steps derived from the viewer's own records) and dismissed coach marks. People only. Added by CR-ONB-1 (D-191).",
    screens: ['SHELL'],
    prd: ['§7', 'ME-16'],
    auth: 'human',
    response: OnboardingState,
  }),
  update: endpoint({
    id: 'onboarding.update',
    method: 'PATCH',
    path: '/me/onboarding',
    summary:
      'Record one first-run change for the signed-in person (welcome seen, explainer completed or skipped, guide skipped or resumed, a visited step, a dismissed coach mark). Audited; never changes business state. People only. Added by CR-ONB-1 (D-191).',
    screens: ['SHELL'],
    prd: ['§7', 'ME-16'],
    auth: 'human',
    idempotent: true,
    body: OnboardingPatch,
    response: OnboardingState,
  }),
  reset: endpoint({
    id: 'onboarding.reset',
    method: 'POST',
    path: '/dev/onboarding/reset',
    summary:
      "Demo only: clear the signed-in person's first-run state so the welcome and the guide show again. Registered only with dev features on; illustrative workspaces only. Audited. Added by CR-ONB-1 (D-191).",
    screens: ['SHELL'],
    prd: ['§10'],
    auth: 'dev_only',
    idempotent: true,
    response: OnboardingState,
    successStatus: 200,
  }),
};
