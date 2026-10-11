/**
 * FROZEN Market Expansion lifecycles: case stage, mandate, opportunity, experiment (PRD §4).
 * Diagrams: docs/market-expansion/architecture/ARCHITECTURE.md §8. Gate-driven stage changes are
 * `system` transitions triggered by gate events, never by task completion.
 */
import type { CaseStage, ExperimentLifecycle, OpportunityStatus } from '@growth-os/contracts';
import type { Transition } from '../../platform/workflow/state-machine';

// ---------------------------------------------------------------------------
// Case stage
// ---------------------------------------------------------------------------

export type CaseStageCommand =
  // human commands (cases.transition)
  | 'start_assessment'
  | 'hold'
  | 'resume'
  | 'stop'
  | 'close'
  // system, from gate events
  | 'g0_approved'
  | 'g1_approved'
  | 'g1_invalidated'
  | 'g2_submitted'
  | 'g2_returned_or_withdrawn'
  | 'g2_approved'
  | 'g2_invalidated'
  | 'g2_expired' // D-035 (CR-WS3-3)
  | 'pilot_activated'
  | 'pilot_window_ended'
  | 'start_review'
  | 'g3_submitted'
  | 'g3_returned_or_withdrawn'
  | 'g3_approved'
  // human, from outcome decisions (outcomes.decide)
  | 'outcome_revise_or_extend'
  | 'outcome_stop';

export const CASE_TRANSITIONS: readonly Transition<CaseStage, CaseStageCommand>[] = [
  {
    from: 'draft_mandate',
    command: 'g0_approved',
    to: 'discovery',
    by: 'system',
    guards: [],
    emits: ['mandate_approved'],
  },
  {
    from: 'discovery',
    command: 'start_assessment',
    to: 'assessment',
    by: 'human',
    guards: ['actor_is_case_owner', 'market_boundary_defined'],
  },
  {
    from: 'assessment',
    command: 'g1_approved',
    to: 'validation',
    by: 'system',
    guards: [],
    emits: ['validation_authorized'],
  },
  {
    from: 'validation',
    command: 'g1_invalidated',
    to: 'assessment',
    by: 'system',
    guards: [],
    note: 'running validation tasks pause',
  },
  { from: 'validation', command: 'g2_submitted', to: 'pilot_approval_pending', by: 'system', guards: [] },
  {
    from: 'pilot_approval_pending',
    command: 'g2_returned_or_withdrawn',
    to: 'validation',
    by: 'system',
    guards: [],
  },
  { from: 'pilot_approval_pending', command: 'g2_approved', to: 'pilot_approved', by: 'system', guards: [] },
  {
    from: ['pilot_approved', 'pilot_running'],
    command: 'g2_invalidated',
    to: 'pilot_approval_pending',
    by: 'system',
    guards: [],
    note: 'returns for review; executed writes preserved; unsent writes paused',
  },
  {
    // D-035 (CR-WS3-3): an unused G2 approval expired (timers.approval_expiry). Same target as an
    // invalidation, so a new G2 request can be prepared and decided from Pilot approval pending.
    from: 'pilot_approved',
    command: 'g2_expired',
    to: 'pilot_approval_pending',
    by: 'system',
    guards: [],
    note: 'approval expired unused; nothing was executed under it',
  },
  {
    from: 'pilot_approved',
    command: 'pilot_activated',
    to: 'pilot_running',
    by: 'system',
    guards: ['approval_effective', 'blocking_conditions_met', 'all_tasks_owned'],
    emits: ['pilot_activated'],
  },
  {
    from: 'pilot_running',
    command: 'pilot_window_ended',
    to: 'review_due',
    by: 'system',
    guards: ['window_end_passed'],
  },
  {
    from: 'pilot_running',
    command: 'start_review',
    to: 'review_due',
    by: 'human',
    guards: ['actor_is_case_owner_or_pilot_owner'],
  },
  {
    from: 'review_due',
    command: 'g3_submitted',
    to: 'scale_approval_pending',
    by: 'system',
    guards: [],
    emits: ['scale_requested'],
  },
  {
    from: 'scale_approval_pending',
    command: 'g3_returned_or_withdrawn',
    to: 'review_due',
    by: 'system',
    guards: [],
  },
  { from: 'scale_approval_pending', command: 'g3_approved', to: 'scaling', by: 'system', guards: [] },
  {
    from: 'review_due',
    command: 'outcome_revise_or_extend',
    to: 'validation',
    by: 'human',
    guards: ['actor_has_review_authority', 'rationale_present', 'causal_limitations_present'],
    emits: ['extension_requested'],
    note: 'extension is its own X gate with its own cap; G3 stays blocked',
  },
  {
    from: '*active*',
    command: 'outcome_stop',
    to: 'stopped',
    by: 'human',
    guards: ['actor_has_review_authority', 'rationale_present'],
    emits: ['case_stopped'],
  },
  {
    from: '*active*',
    command: 'stop',
    to: 'stopped',
    by: 'human',
    guards: ['actor_is_sponsor_or_authorized', 'rationale_present'],
    emits: ['case_stopped'],
    note: 'Stop is a recorded decision',
  },
  {
    from: '*active*',
    command: 'hold',
    to: 'on_hold',
    by: 'human',
    guards: ['actor_is_sponsor_or_case_owner', 'rationale_present'],
    note: 'held_from_stage remembers where to resume',
  },
  {
    from: 'on_hold',
    command: 'resume',
    to: 'held_from_stage',
    by: 'human',
    guards: ['actor_is_sponsor_or_case_owner', 'approvals_still_effective'],
  },
  { from: 'scaling', command: 'close', to: 'closed', by: 'human', guards: ['actor_is_sponsor'] },
];

/** Rail segment for each stage (research §6.11). */
export const STAGE_SEGMENT: Readonly<
  Record<CaseStage, 'mandate' | 'discovery_assessment' | 'validation' | 'pilot_review' | 'scale' | null>
> = {
  draft_mandate: 'mandate',
  discovery: 'discovery_assessment',
  assessment: 'discovery_assessment',
  validation: 'validation',
  pilot_approval_pending: 'validation',
  pilot_approved: 'pilot_review',
  pilot_running: 'pilot_review',
  review_due: 'pilot_review',
  scale_approval_pending: 'pilot_review',
  scaling: 'scale',
  closed: 'scale',
  on_hold: null, // shown as a flag on the held stage's segment
  stopped: null,
};

// ---------------------------------------------------------------------------
// Mandate
// ---------------------------------------------------------------------------

export type MandateStatusValue = 'draft' | 'awaiting_decision' | 'returned' | 'approved' | 'superseded';
export type MandateCommand = 'submit' | 'return' | 'approve' | 'revise' | 'supersede';
export const MANDATE_TRANSITIONS: readonly Transition<MandateStatusValue, MandateCommand>[] = [
  {
    from: 'draft',
    command: 'submit',
    to: 'awaiting_decision',
    by: 'human',
    guards: ['owner_set', 'sponsor_set', 'currency_set', 'horizons_compatible', 'required_fields'],
    emits: ['gate_submitted'],
  },
  {
    from: 'awaiting_decision',
    command: 'return',
    to: 'returned',
    by: 'system',
    guards: [],
    note: 'from G0 return_for_revision; comment required',
  },
  {
    from: 'awaiting_decision',
    command: 'approve',
    to: 'approved',
    by: 'system',
    guards: [],
    note: 'from G0 approval',
  },
  { from: 'returned', command: 'revise', to: 'draft', by: 'human', guards: ['actor_is_owner'] },
  {
    from: 'approved',
    command: 'supersede',
    to: 'superseded',
    by: 'human',
    guards: ['new_mandate_version_approved'],
  },
];

// ---------------------------------------------------------------------------
// Opportunity (separate from case stage)
// ---------------------------------------------------------------------------

export type OpportunityCommand = 'shortlist' | 'dismiss' | 'merge' | 'restore' | 'convert' | 'unshortlist';
export const OPPORTUNITY_TRANSITIONS: readonly Transition<OpportunityStatus, OpportunityCommand>[] = [
  {
    from: 'detected',
    command: 'shortlist',
    to: 'shortlisted',
    by: 'human',
    guards: ['mandate_approved'],
    emits: ['opportunity_shortlisted'],
  },
  { from: 'shortlisted', command: 'unshortlist', to: 'detected', by: 'human', guards: ['rationale_present'] },
  {
    from: ['detected', 'shortlisted'],
    command: 'dismiss',
    to: 'dismissed',
    by: 'human',
    guards: ['rationale_present'],
  },
  {
    from: ['detected', 'shortlisted'],
    command: 'merge',
    to: 'duplicate',
    by: 'human',
    guards: ['target_in_same_mandate', 'target_not_duplicate'],
  },
  { from: 'dismissed', command: 'restore', to: 'detected', by: 'human', guards: ['rationale_present'] },
  {
    from: 'shortlisted',
    command: 'convert',
    to: 'converted',
    by: 'human',
    guards: ['mandate_approved', 'owner_named'],
    note: 'creates case in Discovery',
  },
];

// ---------------------------------------------------------------------------
// Experiment
// ---------------------------------------------------------------------------

export type ExperimentCommand = 'lock' | 'start' | 'amend' | 'record_result' | 'cancel';
export const EXPERIMENT_TRANSITIONS: readonly Transition<ExperimentLifecycle, ExperimentCommand>[] = [
  {
    from: 'draft',
    command: 'lock',
    to: 'locked',
    by: 'system',
    guards: ['plan_complete', 'linked_to_assumption'],
    note: 'on G1 approval of the snapshot containing the plan',
  },
  { from: 'locked', command: 'start', to: 'running', by: 'human', guards: ['authorizing_gate_effective'] },
  {
    from: ['locked', 'running', 'result_recorded'],
    command: 'amend',
    to: 'unchanged',
    by: 'human',
    guards: ['reason_present'],
    note: 'state unchanged; new plan version + amendment row; original stays visible',
  },
  {
    from: ['running', 'result_recorded'],
    command: 'record_result',
    to: 'result_recorded',
    by: 'human',
    guards: ['period_and_source_present', 'all_metrics_observed_or_too_early'],
    emits: ['experiment_completed'],
    note: 'appends a result version; never overwrites',
  },
  {
    from: ['draft', 'locked', 'running'],
    command: 'cancel',
    to: 'cancelled',
    by: 'human',
    guards: ['rationale_present'],
  },
];
