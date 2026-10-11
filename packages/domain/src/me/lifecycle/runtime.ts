/**
 * Runtime instances of the Market Expansion lifecycles over the FROZEN tables in ./machines.ts, plus
 * the mapping from gate decisions to the follow-on system transitions (gate events drive stages;
 * task completion never does).
 */
import {
  ACTIVE_CASE_STAGES,
  type CaseStage,
  type ExperimentLifecycle,
  type GateCode,
  type GateRequestStatus,
  type OpportunityStatus,
} from '@growth-os/contracts';
import {
  actorId,
  COMMON_GUARDS,
  factGuard,
  fail,
  hasText,
  pass,
  type ApprovalEffectiveness,
  type WorkflowFacts,
} from '../../platform/workflow/guards';
import type { GateCommand } from '../../platform/workflow/machines';
import {
  createStateMachine,
  type Actor,
  type GuardFn,
  type NextAction,
  type StateMachine,
} from '../../platform/workflow/state-machine';
import {
  CASE_TRANSITIONS,
  EXPERIMENT_TRANSITIONS,
  MANDATE_TRANSITIONS,
  OPPORTUNITY_TRANSITIONS,
  type CaseStageCommand,
  type ExperimentCommand,
  type MandateCommand,
  type MandateStatusValue,
  type OpportunityCommand,
} from './machines';

/** Facts for the Market Expansion lifecycles, loaded by the handler from committed records. */
export interface LifecycleFacts extends WorkflowFacts {
  // case
  sponsorId?: string | null;
  pilotOwnerId?: string | null;
  marketBoundaryDefined?: boolean;
  causalLimitations?: readonly string[] | null;
  /** PolicyEngine.check(subject, 'outcome.decide', case).allow */
  reviewAuthority?: boolean;
  /** PolicyEngine.check(subject, 'case.stop', case).allow */
  stopAuthority?: boolean;
  approvalsStillEffective?: boolean;
  allTasksOwned?: boolean;
  /** Pilot window end (ISO date, tenant local) and today's tenant-local date. */
  windowEnd?: string | null;
  today?: string;
  /** Stored when the case went on hold; resume returns here. */
  heldFromStage?: CaseStage | null;

  // mandate
  mandate?: {
    ownerId: string | null;
    sponsorId: string | null;
    currency: string | null;
    objective: string | null;
    horizonYears: number | null;
    pilotDurationDays: number | null;
    geographyCodes: readonly string[];
    productId: string | null;
    segmentIds: readonly string[];
  } | null;
  newMandateVersionApproved?: boolean;

  // opportunity
  mandateApproved?: boolean;
  mergeTarget?: { sameMandate: boolean; status: OpportunityStatus } | null;
  /** Owner named for the case a conversion creates. */
  newCaseOwnerId?: string | null;

  // experiment
  plan?: { complete: boolean; linkedAssumptionCount: number } | null;
  authorizingGate?: ApprovalEffectiveness;
  reason?: string | null;
  result?: {
    periodStart: string | null;
    periodEnd: string | null;
    source: string | null;
    metrics: readonly { observed: boolean; tooEarly: boolean }[];
  } | null;
}

type G = GuardFn<LifecycleFacts>;
const uidOf = (a: Actor) => actorId(a);

const isActor = (
  key: string,
  ids: (f: LifecycleFacts) => (string | null | undefined)[],
  message: string,
): G =>
  ((f: LifecycleFacts, actor: Actor) => {
    const uid = uidOf(actor);
    return uid !== null && ids(f).includes(uid) ? pass(key) : fail(key, message, 'FORBIDDEN');
  }) as G;

// ---------------------------------------------------------------------------
// Case
// ---------------------------------------------------------------------------

const CASE_GUARDS: Readonly<Record<string, G>> = {
  approval_effective: COMMON_GUARDS.approval_effective,
  blocking_conditions_met: COMMON_GUARDS.blocking_conditions_met,
  rationale_present: COMMON_GUARDS.rationale_present,
  actor_is_case_owner: isActor(
    'actor_is_case_owner',
    (f) => [f.caseOwnerId],
    'Only the case owner can do this.',
  ),
  actor_is_case_owner_or_pilot_owner: isActor(
    'actor_is_case_owner_or_pilot_owner',
    (f) => [f.caseOwnerId, f.pilotOwnerId],
    'Only the case owner or the pilot owner can start the review.',
  ),
  actor_is_sponsor_or_case_owner: isActor(
    'actor_is_sponsor_or_case_owner',
    (f) => [f.sponsorId, f.caseOwnerId],
    'Only the sponsor or the case owner can do this.',
  ),
  actor_is_sponsor: isActor('actor_is_sponsor', (f) => [f.sponsorId], 'Only the sponsor can close the case.'),
  actor_is_sponsor_or_authorized: ((f: LifecycleFacts, actor: Actor) => {
    const uid = uidOf(actor);
    return uid !== null && (uid === f.sponsorId || f.stopAuthority === true)
      ? pass('actor_is_sponsor_or_authorized')
      : fail(
          'actor_is_sponsor_or_authorized',
          'Stopping a case is a decision for the sponsor or someone with authority.',
          'FORBIDDEN',
        );
  }) as G,
  actor_has_review_authority: factGuard<LifecycleFacts>(
    'actor_has_review_authority',
    (f) => f.reviewAuthority,
    'Only the sponsor or the investment committee records the outcome decision.',
    'FORBIDDEN',
  ),
  market_boundary_defined: factGuard<LifecycleFacts>(
    'market_boundary_defined',
    (f) => f.marketBoundaryDefined,
    'Define the market boundary before starting the assessment.',
  ),
  causal_limitations_present: factGuard<LifecycleFacts>(
    'causal_limitations_present',
    (f) => (f.causalLimitations ?? []).some((l) => hasText(l)),
    'State the causal limitations before deciding.',
  ),
  approvals_still_effective: factGuard<LifecycleFacts>(
    'approvals_still_effective',
    (f) => f.approvalsStillEffective,
    'An approval this stage relies on no longer applies.',
  ),
  all_tasks_owned: factGuard<LifecycleFacts>(
    'all_tasks_owned',
    (f) => f.allTasksOwned,
    'Activation blocked: a task has no owner.',
  ),
  window_end_passed: factGuard<LifecycleFacts>(
    'window_end_passed',
    (f) => (f.windowEnd && f.today ? f.today > f.windowEnd : undefined),
    'The pilot window has not ended.',
  ),
};

const CASE_NEXT: Partial<Record<CaseStage, NextAction>> = {
  draft_mandate: { key: 'submit_g0', label: 'Submit the mandate for G0', owner: 'case_owner' },
  discovery: { key: 'start_assessment', label: 'Start assessment', owner: 'case_owner' },
  assessment: { key: 'submit_g1', label: 'Prepare the G1 validation request', owner: 'case_owner' },
  validation: { key: 'submit_g2', label: 'Record validation results and prepare G2', owner: 'case_owner' },
  pilot_approval_pending: { key: 'decide_g2', label: 'G2 decision', owner: 'approver' },
  pilot_approved: { key: 'activate_pilot', label: 'Activate the pilot', owner: 'pilot_owner' },
  pilot_running: { key: 'record_outcomes', label: 'Run the pilot and record actuals', owner: 'pilot_owner' },
  review_due: { key: 'outcome_decision', label: 'Outcome review and decision', owner: 'sponsor' },
  scale_approval_pending: { key: 'decide_g3', label: 'G3 decision', owner: 'approver' },
  scaling: { key: 'close', label: 'Close the case when scale-up is complete', owner: 'sponsor' },
  on_hold: { key: 'resume', label: 'Resume', owner: 'sponsor' },
};

export const caseMachine: StateMachine<CaseStage, CaseStageCommand, LifecycleFacts> = createStateMachine(
  'case',
  CASE_TRANSITIONS,
  CASE_GUARDS,
  {
    activeStates: ACTIVE_CASE_STAGES,
    resolveHeldFrom: (f) => f.heldFromStage ?? null,
    nextActions: CASE_NEXT,
    domainEvent: (_c, from, to) => (from === to ? null : 'case.stage_changed'),
  },
);

// ---------------------------------------------------------------------------
// Mandate
// ---------------------------------------------------------------------------

const m = (f: LifecycleFacts) => f.mandate ?? null;

const MANDATE_GUARDS: Readonly<Record<string, G>> = {
  owner_set: factGuard<LifecycleFacts>(
    'owner_set',
    (f) => hasText(m(f)?.ownerId),
    'Name an accountable owner.',
  ),
  sponsor_set: factGuard<LifecycleFacts>('sponsor_set', (f) => hasText(m(f)?.sponsorId), 'Name a sponsor.'),
  currency_set: factGuard<LifecycleFacts>(
    'currency_set',
    (f) => hasText(m(f)?.currency),
    'State the currency.',
  ),
  horizons_compatible: factGuard<LifecycleFacts>(
    'horizons_compatible',
    (f) => {
      const md = m(f);
      if (!md || md.horizonYears === null || md.horizonYears <= 0) return false;
      return md.pilotDurationDays === null || md.pilotDurationDays <= md.horizonYears * 365;
    },
    'The pilot duration must fit inside the decision horizon.',
  ),
  required_fields: factGuard<LifecycleFacts>(
    'required_fields',
    (f) => {
      const md = m(f);
      return (
        !!md &&
        hasText(md.objective) &&
        hasText(md.productId) &&
        md.geographyCodes.length > 0 &&
        md.segmentIds.length > 0
      );
    },
    'Complete the objective, product, geography and segment.',
  ),
  actor_is_owner: isActor('actor_is_owner', (f) => [m(f)?.ownerId], 'Only the mandate owner can revise it.'),
  new_mandate_version_approved: factGuard<LifecycleFacts>(
    'new_mandate_version_approved',
    (f) => f.newMandateVersionApproved,
    'A newer mandate version must be approved first.',
  ),
};

export const mandateMachine: StateMachine<MandateStatusValue, MandateCommand, LifecycleFacts> =
  createStateMachine('mandate', MANDATE_TRANSITIONS, MANDATE_GUARDS, {
    nextActions: {
      draft: { key: 'submit', label: 'Submit for G0', owner: 'case_owner' },
      awaiting_decision: { key: 'decide_g0', label: 'Approve mandate (G0)', owner: 'sponsor' },
      returned: { key: 'revise', label: 'Revise and resubmit', owner: 'case_owner' },
    },
  });

// ---------------------------------------------------------------------------
// Opportunity
// ---------------------------------------------------------------------------

const OPPORTUNITY_GUARDS: Readonly<Record<string, G>> = {
  rationale_present: COMMON_GUARDS.rationale_present,
  mandate_approved: factGuard<LifecycleFacts>(
    'mandate_approved',
    (f) => f.mandateApproved,
    'The mandate must be approved (G0) first.',
  ),
  target_in_same_mandate: factGuard<LifecycleFacts>(
    'target_in_same_mandate',
    (f) => f.mergeTarget?.sameMandate,
    'Merge only within the same mandate.',
  ),
  target_not_duplicate: factGuard<LifecycleFacts>(
    'target_not_duplicate',
    (f) => (f.mergeTarget ? f.mergeTarget.status !== 'duplicate' : undefined),
    'The merge target is itself a duplicate. Merge into its primary instead.',
  ),
  owner_named: factGuard<LifecycleFacts>(
    'owner_named',
    (f) => hasText(f.newCaseOwnerId),
    'Name the case owner before converting.',
  ),
};

export const opportunityMachine: StateMachine<OpportunityStatus, OpportunityCommand, LifecycleFacts> =
  createStateMachine('opportunity', OPPORTUNITY_TRANSITIONS, OPPORTUNITY_GUARDS, {
    domainEvent: () => 'opportunity.status_changed',
    nextActions: {
      detected: { key: 'triage', label: 'Shortlist, merge or dismiss', owner: 'case_owner' },
      shortlisted: { key: 'convert', label: 'Convert to a case', owner: 'case_owner' },
    },
  });

// ---------------------------------------------------------------------------
// Experiment
// ---------------------------------------------------------------------------

const EXPERIMENT_GUARDS: Readonly<Record<string, G>> = {
  rationale_present: COMMON_GUARDS.rationale_present,
  plan_complete: factGuard<LifecycleFacts>(
    'plan_complete',
    (f) => f.plan?.complete,
    'Complete the plan: hypothesis, sample, window, metrics with thresholds and decision rules.',
  ),
  linked_to_assumption: factGuard<LifecycleFacts>(
    'linked_to_assumption',
    (f) => (f.plan ? f.plan.linkedAssumptionCount > 0 : undefined),
    'Link the experiment to at least one assumption.',
  ),
  authorizing_gate_effective: ((f: LifecycleFacts) => {
    const r = COMMON_GUARDS.approval_effective(
      { approval: f.authorizingGate },
      { kind: 'system', reason: 'worker' },
    );
    return r.ok
      ? pass('authorizing_gate_effective')
      : fail(
          'authorizing_gate_effective',
          f.authorizingGate === undefined || f.authorizingGate === 'missing'
            ? 'The authorizing gate (G1) is not approved.'
            : (r.message ?? 'The authorizing gate no longer applies.'),
          r.code,
        );
  }) as G,
  reason_present: factGuard<LifecycleFacts>('reason_present', (f) => hasText(f.reason), 'Give a reason.'),
  period_and_source_present: factGuard<LifecycleFacts>(
    'period_and_source_present',
    (f) =>
      !!f.result && hasText(f.result.periodStart) && hasText(f.result.periodEnd) && hasText(f.result.source),
    'Results need a measurement period and a source.',
  ),
  all_metrics_observed_or_too_early: factGuard<LifecycleFacts>(
    'all_metrics_observed_or_too_early',
    (f) =>
      !!f.result && f.result.metrics.length > 0 && f.result.metrics.every((x) => x.observed || x.tooEarly),
    'Every metric needs an observed value or "Too early to read".',
  ),
};

export const experimentMachine: StateMachine<ExperimentLifecycle, ExperimentCommand, LifecycleFacts> =
  createStateMachine('experiment', EXPERIMENT_TRANSITIONS, EXPERIMENT_GUARDS, {
    domainEvent: (c) =>
      c === 'lock'
        ? 'experiment.locked'
        : c === 'amend'
          ? 'experiment.amended'
          : c === 'record_result'
            ? 'experiment.result_recorded'
            : null,
    nextActions: {
      draft: { key: 'submit_g1', label: 'Include the plan in the G1 request', owner: 'case_owner' },
      locked: { key: 'start', label: 'Start the experiment', owner: 'case_owner' },
      running: { key: 'record_result', label: 'Record results with period and source', owner: 'case_owner' },
    },
  });

// ---------------------------------------------------------------------------
// Gate decision → follow-on system transitions
// ---------------------------------------------------------------------------

export interface FollowOn {
  case: CaseStageCommand | null;
  mandate: MandateCommand | null;
  /** Lock the experiment plans pinned by the approved G1 snapshot. */
  lockExperiments: boolean;
}

/**
 * Which system transitions a successful gate request command triggers. X (extension) never moves the
 * case and never unblocks G3. Expiry moves no stage: activation is blocked by `approval_effective`.
 */
export function followOnForGate(
  gate: GateCode,
  command: GateCommand,
  /** Gate request status before the command; withdrawing a draft moves nothing. */
  from?: GateRequestStatus,
): FollowOn {
  const none: FollowOn = { case: null, mandate: null, lockExperiments: false };
  if (command === 'withdraw' && from === 'draft') return none;
  const approved = command === 'approve' || command === 'approve_with_conditions';
  const returned = command === 'return_for_revision' || command === 'not_approved' || command === 'withdraw';
  const submitted = command === 'submit' || command === 'resubmit';
  switch (gate) {
    case 'G0':
      if (approved) return { case: 'g0_approved', mandate: 'approve', lockExperiments: false };
      if (command === 'return_for_revision' || command === 'not_approved') {
        return { case: null, mandate: 'return', lockExperiments: false };
      }
      return none;
    case 'G1':
      if (approved) return { case: 'g1_approved', mandate: null, lockExperiments: true };
      if (command === 'invalidate') return { ...none, case: 'g1_invalidated' };
      return none;
    case 'G2':
      if (submitted) return { ...none, case: 'g2_submitted' };
      if (returned) return { ...none, case: 'g2_returned_or_withdrawn' };
      if (approved) return { ...none, case: 'g2_approved' };
      if (command === 'invalidate') return { ...none, case: 'g2_invalidated' };
      if (command === 'expire') return { ...none, case: 'g2_expired' };
      return none;
    case 'G3':
      if (submitted) return { ...none, case: 'g3_submitted' };
      if (returned) return { ...none, case: 'g3_returned_or_withdrawn' };
      if (approved) return { ...none, case: 'g3_approved' };
      return none;
    case 'X':
      return none;
  }
}
