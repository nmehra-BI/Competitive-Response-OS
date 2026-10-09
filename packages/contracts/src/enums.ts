/**
 * FROZEN enums and the exact label vocabulary from UX_RESEARCH.md §7.
 *
 * Rule (D-009): the API and database carry stable snake_case codes. The UI renders the
 * exact label from the `*_LABELS` maps below. Never invent a new label in a component.
 * Reserved words (research §7.2 rule 4): "Approved" only for gates, "Met" only for
 * thresholds, "Supported" only for assumptions, "Confirmed" only for external sync,
 * "Verified" only for evidence strength, "Done" only for tasks.
 */
import { z } from 'zod';

function labels<T extends string>(
  _e: z.ZodEnum<[T, ...T[]]>,
  map: Record<T, string>,
): Readonly<Record<T, string>> {
  return Object.freeze(map);
}

// ---------------------------------------------------------------------------
// Tenancy, identity, roles
// ---------------------------------------------------------------------------

export const AppType = z.enum(['market_expansion', 'competitive_response']);
export type AppType = z.infer<typeof AppType>;

/** Kind of principal. Only `human` with an interactive session can decide a gate (ME-11). */
export const PrincipalKind = z.enum(['human', 'service', 'agent']);
export type PrincipalKind = z.infer<typeof PrincipalKind>;

export const RoleCode = z.enum([
  'sponsor',
  'case_owner',
  'pilot_owner',
  'commercial_reviewer',
  'product_reviewer',
  'finance_reviewer',
  'specialist_reviewer',
  'investment_committee',
  'read_only_reviewer',
  'tenant_admin',
]);
export type RoleCode = z.infer<typeof RoleCode>;
export const ROLE_LABELS = labels(RoleCode, {
  sponsor: 'Sponsor',
  case_owner: 'Case owner',
  pilot_owner: 'Pilot owner',
  commercial_reviewer: 'Commercial reviewer',
  product_reviewer: 'Product reviewer',
  finance_reviewer: 'Finance reviewer',
  specialist_reviewer: 'Specialist reviewer',
  investment_committee: 'Investment committee',
  read_only_reviewer: 'Read-only reviewer',
  tenant_admin: 'Administrator',
});

// ---------------------------------------------------------------------------
// Epistemic kinds (research §7.1)
// ---------------------------------------------------------------------------

export const EpistemicKind = z.enum([
  'evidence',
  'assumption',
  'scenario',
  'actual',
  'inference_ai',
  'unknown',
]);
export type EpistemicKind = z.infer<typeof EpistemicKind>;
export const EPISTEMIC_KIND_LABELS = labels(EpistemicKind, {
  evidence: 'Evidence',
  assumption: 'Assumption',
  scenario: 'Scenario',
  actual: 'Actual',
  inference_ai: 'AI draft',
  unknown: 'Unknown',
});

/** Input-ledger kind. `calculated` inherits the weakest kind of its inputs for display (§7.1 rule 3). */
export const LedgerKind = z.enum(['evidence', 'assumption', 'calculated']);
export type LedgerKind = z.infer<typeof LedgerKind>;
export const LEDGER_KIND_LABELS = labels(LedgerKind, {
  evidence: 'Evidence',
  assumption: 'Assumption',
  calculated: 'Calculated',
});

/** Field-level provenance for AI-draftable text (EXECUTION_PLAN R9). */
export const FieldOrigin = z.enum(['human', 'ai', 'ai_edited']);
export type FieldOrigin = z.infer<typeof FieldOrigin>;

// ---------------------------------------------------------------------------
// Case stage (PRD §4, research §7.2)
// ---------------------------------------------------------------------------

export const CaseStage = z.enum([
  'draft_mandate',
  'discovery',
  'assessment',
  'validation',
  'pilot_approval_pending',
  'pilot_approved',
  'pilot_running',
  'review_due',
  'scale_approval_pending',
  'scaling',
  'closed',
  'on_hold',
  'stopped',
]);
export type CaseStage = z.infer<typeof CaseStage>;
export const CASE_STAGE_LABELS = labels(CaseStage, {
  draft_mandate: 'Draft mandate',
  discovery: 'Discovery',
  assessment: 'Assessment',
  validation: 'Validation',
  pilot_approval_pending: 'Pilot approval pending',
  pilot_approved: 'Pilot approved',
  pilot_running: 'Pilot running',
  review_due: 'Review due',
  scale_approval_pending: 'Scale approval pending',
  scaling: 'Scaling',
  closed: 'Closed',
  on_hold: 'On hold',
  stopped: 'Stopped',
});
/** Stages from which a case may enter On hold or Stopped. */
export const ACTIVE_CASE_STAGES: readonly CaseStage[] = [
  'draft_mandate',
  'discovery',
  'assessment',
  'validation',
  'pilot_approval_pending',
  'pilot_approved',
  'pilot_running',
  'review_due',
  'scale_approval_pending',
  'scaling',
];

/** Rail segments under the case header (research §6.11). */
export const RailSegment = z.enum(['mandate', 'discovery_assessment', 'validation', 'pilot_review', 'scale']);
export type RailSegment = z.infer<typeof RailSegment>;
export const RAIL_SEGMENT_LABELS = labels(RailSegment, {
  mandate: 'Mandate',
  discovery_assessment: 'Discovery · Assessment',
  validation: 'Validation',
  pilot_review: 'Pilot · Review',
  scale: 'Scale',
});

// ---------------------------------------------------------------------------
// Gates (PRD §4 table, research §6.11, §10.4)
// ---------------------------------------------------------------------------

/** G0–G3 from the PRD plus X: a scoped extension, which is its own authorization with its own cap. */
export const GateCode = z.enum(['G0', 'G1', 'G2', 'G3', 'X']);
export type GateCode = z.infer<typeof GateCode>;
export const GATE_LABELS = labels(GateCode, {
  G0: 'G0 · Scope approved',
  G1: 'G1 · Validate thesis',
  G2: 'G2 · Pilot investment',
  G3: 'G3 · Scale / enter market',
  X: 'Extension',
});

/** Stored lifecycle of a gate request. */
export const GateRequestStatus = z.enum([
  'draft',
  'awaiting_decision',
  'stale',
  'approved',
  'approved_with_conditions',
  'returned_for_revision',
  'not_approved',
  'withdrawn',
  'invalidated',
  'expired',
]);
export type GateRequestStatus = z.infer<typeof GateRequestStatus>;
/** Labels for the stored request status (e.g. "Withdrawn", which has no GateStatus). Added by D-068. */
export const GATE_REQUEST_STATUS_LABELS = labels(GateRequestStatus, {
  draft: 'Draft',
  awaiting_decision: 'Awaiting decision',
  stale: 'Stale',
  approved: 'Approved',
  approved_with_conditions: 'Approved with conditions',
  returned_for_revision: 'Returned for revision',
  not_approved: 'Not approved',
  withdrawn: 'Withdrawn',
  invalidated: 'Invalidated',
  expired: 'Expired',
});

/** Display status on the rail and approval panel. Derived from request + preconditions. */
export const GateStatus = z.enum([
  'not_started',
  'preconditions_open',
  'ready_to_submit',
  'awaiting_decision',
  'approved',
  'approved_with_conditions',
  'returned_for_revision',
  'not_approved',
  'blocked',
  'invalidated',
  'expired',
  'superseded',
]);
export type GateStatus = z.infer<typeof GateStatus>;
export const GATE_STATUS_LABELS = labels(GateStatus, {
  not_started: 'Not started',
  preconditions_open: 'Preconditions open',
  ready_to_submit: 'Ready to submit',
  awaiting_decision: 'Awaiting decision',
  approved: 'Approved',
  approved_with_conditions: 'Approved with conditions',
  returned_for_revision: 'Returned for revision',
  not_approved: 'Not approved',
  blocked: 'Blocked',
  invalidated: 'Invalidated',
  expired: 'Expired',
  superseded: 'Superseded',
});

/** What an approver records on a snapshot (S10 actions). */
export const GateDisposition = z.enum([
  'approve',
  'approve_with_conditions',
  'return_for_revision',
  'not_approved',
  'abstain',
  'delegate',
]);
export type GateDisposition = z.infer<typeof GateDisposition>;
export const GATE_DISPOSITION_LABELS = labels(GateDisposition, {
  approve: 'Approve',
  approve_with_conditions: 'Approve with conditions',
  return_for_revision: 'Return for revision',
  not_approved: 'Not approved',
  abstain: 'Abstain',
  delegate: 'Delegate',
});

/** Decision package snapshot status. */
export const SnapshotStatus = z.enum(['current', 'stale', 'superseded']);
export type SnapshotStatus = z.infer<typeof SnapshotStatus>;

export const ConditionFlag = z.enum(['blocks_execution', 'monitor_only']);
export type ConditionFlag = z.infer<typeof ConditionFlag>;
export const CONDITION_FLAG_LABELS = labels(ConditionFlag, {
  blocks_execution: 'Blocks execution until met',
  monitor_only: 'Monitor only',
});
export const ConditionStatus = z.enum(['open', 'met', 'waived']);
export type ConditionStatus = z.infer<typeof ConditionStatus>;
export const CONDITION_STATUS_LABELS = labels(ConditionStatus, {
  open: 'Open',
  met: 'Met',
  waived: 'Waived',
});

export const ReviewerPosition = z.enum([
  'supports',
  'supports_with_conditions',
  'dissents',
  'abstains',
  'not_yet_reviewed',
  'accepts_ownership',
]);
export type ReviewerPosition = z.infer<typeof ReviewerPosition>;
export const REVIEWER_POSITION_LABELS = labels(ReviewerPosition, {
  supports: 'Supports',
  supports_with_conditions: 'Supports with conditions',
  dissents: 'Dissents',
  abstains: 'Abstains',
  not_yet_reviewed: 'Not yet reviewed',
  accepts_ownership: 'Accepts ownership',
});

// ---------------------------------------------------------------------------
// Review outcomes (research §7.2 "Decision outcome")
// ---------------------------------------------------------------------------

export const DecisionOutcome = z.enum(['proceed', 'revise', 'extend', 'stop', 'scale']);
export type DecisionOutcome = z.infer<typeof DecisionOutcome>;
export const DECISION_OUTCOME_LABELS = labels(DecisionOutcome, {
  proceed: 'Proceed',
  revise: 'Revise',
  extend: 'Extend',
  stop: 'Stop',
  scale: 'Scale',
});

// ---------------------------------------------------------------------------
// Opportunities (PRD §4, research §7.2)
// ---------------------------------------------------------------------------

export const OpportunityStatus = z.enum(['detected', 'shortlisted', 'converted', 'dismissed', 'duplicate']);
export type OpportunityStatus = z.infer<typeof OpportunityStatus>;
export const OPPORTUNITY_STATUS_LABELS = labels(OpportunityStatus, {
  detected: 'Detected',
  shortlisted: 'Shortlisted',
  converted: 'Converted',
  dismissed: 'Dismissed',
  duplicate: 'Duplicate',
});

export const OpportunityOrigin = z.enum(['ai', 'manual', 'handoff']);
export type OpportunityOrigin = z.infer<typeof OpportunityOrigin>;
export const OPPORTUNITY_ORIGIN_LABELS = labels(OpportunityOrigin, {
  ai: 'Proposed · AI',
  manual: 'Added manually',
  handoff: 'Linked from another app',
});

export const FitResult = z.enum(['met', 'not_met', 'unknown']);
export type FitResult = z.infer<typeof FitResult>;

// ---------------------------------------------------------------------------
// Assumptions (research §6.9)
// ---------------------------------------------------------------------------

export const AssumptionStatus = z.enum([
  'untested',
  'testing',
  'supported',
  'contradicted',
  'inconclusive',
  'retired',
]);
export type AssumptionStatus = z.infer<typeof AssumptionStatus>;
export const ASSUMPTION_STATUS_LABELS = labels(AssumptionStatus, {
  untested: 'Untested',
  testing: 'Testing',
  supported: 'Supported',
  contradicted: 'Contradicted',
  inconclusive: 'Inconclusive',
  retired: 'Retired',
});

export const Sensitivity = z.enum(['high', 'medium', 'low']);
export type Sensitivity = z.infer<typeof Sensitivity>;
export const SENSITIVITY_LABELS = labels(Sensitivity, { high: 'High', medium: 'Medium', low: 'Low' });

export const EvidenceQuality = z.enum(['strong', 'some', 'weak', 'none', 'conflicting']);
export type EvidenceQuality = z.infer<typeof EvidenceQuality>;
export const EVIDENCE_QUALITY_LABELS = labels(EvidenceQuality, {
  strong: 'Strong',
  some: 'Some',
  weak: 'Weak',
  none: 'None',
  conflicting: 'Conflicting',
});

/** Register groups (S09): derived from sensitivity then evidence quality. No combined score. */
export const RegisterGroup = z.enum(['test_first', 'test_next', 'watch', 'monitor']);
export type RegisterGroup = z.infer<typeof RegisterGroup>;
export const REGISTER_GROUP_LABELS = labels(RegisterGroup, {
  test_first: 'Test first',
  test_next: 'Test next',
  watch: 'Watch',
  monitor: 'Monitor',
});

export const ChallengeKind = z.enum(['dispute', 'challenge']);
export type ChallengeKind = z.infer<typeof ChallengeKind>;
export const ChallengeTargetType = z.enum([
  'assumption',
  'claim',
  'source',
  'sizing_output',
  'economics_output',
]);
export type ChallengeTargetType = z.infer<typeof ChallengeTargetType>;
export const ChallengeStatus = z.enum(['open', 'resolved', 'withdrawn']);
export type ChallengeStatus = z.infer<typeof ChallengeStatus>;

// ---------------------------------------------------------------------------
// Experiments (research §6.10, §7.2)
// ---------------------------------------------------------------------------

export const ExperimentLifecycle = z.enum(['draft', 'locked', 'running', 'result_recorded', 'cancelled']);
export type ExperimentLifecycle = z.infer<typeof ExperimentLifecycle>;

export const ThresholdResult = z.enum(['met', 'not_met', 'inconclusive']);
export type ThresholdResult = z.infer<typeof ThresholdResult>;
export const THRESHOLD_RESULT_LABELS = labels(ThresholdResult, {
  met: 'Met',
  not_met: 'Not met',
  inconclusive: 'Inconclusive',
});

/** Display-only "Experiment result" grammar (research §7.2). Derived; never stored. */
export const ExperimentResultDisplay = z.enum([
  'planned',
  'running',
  'too_early_to_read',
  'met',
  'not_met',
  'inconclusive',
  'amended',
]);
export type ExperimentResultDisplay = z.infer<typeof ExperimentResultDisplay>;
export const EXPERIMENT_RESULT_LABELS = labels(ExperimentResultDisplay, {
  planned: 'Planned',
  running: 'Running',
  too_early_to_read: 'Too early to read',
  met: 'Met',
  not_met: 'Not met',
  inconclusive: 'Inconclusive',
  amended: 'Amended',
});

export const ThresholdOperator = z.enum(['gte', 'lte', 'eq', 'qualitative']);
export type ThresholdOperator = z.infer<typeof ThresholdOperator>;

// ---------------------------------------------------------------------------
// Feasibility (PRD S07)
// ---------------------------------------------------------------------------

export const FeasibilityDimension = z.enum([
  'product_fit',
  'differentiation',
  'commercial_access',
  'operations',
  'specialist_review',
  'channel',
  'competition',
]);
export type FeasibilityDimension = z.infer<typeof FeasibilityDimension>;
export const FEASIBILITY_DIMENSION_LABELS = labels(FeasibilityDimension, {
  product_fit: 'Product fit',
  differentiation: 'Differentiation',
  commercial_access: 'Commercial access',
  operations: 'Operations',
  specialist_review: 'Specialist review',
  channel: 'Channel',
  competition: 'Competition',
});

export const ReviewStatus = z.enum(['pending', 'in_review', 'signed', 'declined']);
export type ReviewStatus = z.infer<typeof ReviewStatus>;
export const REVIEW_STATUS_LABELS = labels(ReviewStatus, {
  pending: 'Pending',
  in_review: 'In review',
  signed: 'Signed',
  declined: 'Blocker',
});

export const BlockerStatus = z.enum(['open', 'resolved', 'scope_restricted']);
export type BlockerStatus = z.infer<typeof BlockerStatus>;

export const ReviewArea = z.enum([
  'finance',
  'specialist',
  'product',
  'commercial',
  'pilot_owner',
  'operations',
  'sponsor',
]);
export type ReviewArea = z.infer<typeof ReviewArea>;
/** Reviewer areas as screens name them (S05 assign reviewer, S10 sign-offs). Added by D-068. */
export const REVIEW_AREA_LABELS = labels(ReviewArea, {
  finance: 'Finance',
  specialist: 'Specialist',
  product: 'Product',
  commercial: 'Commercial',
  pilot_owner: 'Pilot owner',
  operations: 'Operations',
  sponsor: 'Sponsor',
});

/** S05 thesis blocker state: pending (not started), blocker (blocks its gate), resolved. Added by D-068. */
export const ThesisBlockerStatus = z.enum(['pending', 'blocker', 'resolved']);
export type ThesisBlockerStatus = z.infer<typeof ThesisBlockerStatus>;
export const THESIS_BLOCKER_STATUS_LABELS = labels(ThesisBlockerStatus, {
  pending: 'Pending',
  blocker: 'Blocker',
  resolved: 'Resolved',
});

export const ReviewRequestStatus = z.enum(['open', 'responded', 'cancelled']);
export type ReviewRequestStatus = z.infer<typeof ReviewRequestStatus>;
export const ReviewResponse = z.enum(['confirm', 'dispute', 'abstain']);
export type ReviewResponse = z.infer<typeof ReviewResponse>;

// ---------------------------------------------------------------------------
// Scenarios and money (research §6.5, §7.3)
// ---------------------------------------------------------------------------

/** Fixed display order: Downside · Base · Upside. Never probabilities. */
export const Scenario = z.enum(['downside', 'base', 'upside']);
export type Scenario = z.infer<typeof Scenario>;
export const SCENARIO_LABELS = labels(Scenario, { downside: 'Downside', base: 'Base', upside: 'Upside' });
export const SCENARIO_ORDER: readonly Scenario[] = ['downside', 'base', 'upside'];

/**
 * Typed money measures (research §7.3, D-010). The domain forbids arithmetic across measures.
 * In particular recurring (/year) and one-time money are never summed.
 */
export const MoneyMeasure = z.enum([
  'annual_market_spend',
  'annual_spend_per_unit',
  'annual_revenue',
  'gross_contribution',
  'annual_incremental_opex',
  'contribution_after_opex',
  'one_time_investment',
  'approved_budget',
  'requested_budget',
  'committed_spend',
  'spent_to_date',
  'remaining_budget',
]);
export type MoneyMeasure = z.infer<typeof MoneyMeasure>;
export const MONEY_MEASURE_LABELS = labels(MoneyMeasure, {
  annual_market_spend: 'Annual market spend',
  annual_spend_per_unit: 'Annual spend per site',
  annual_revenue: 'Annual revenue',
  gross_contribution: 'Gross contribution',
  annual_incremental_opex: 'Annual incremental opex',
  contribution_after_opex: 'Contribution after incremental opex',
  one_time_investment: 'One-time scale-entry investment',
  approved_budget: 'Approved budget',
  requested_budget: 'Requested budget',
  committed_spend: 'Committed',
  spent_to_date: 'Spent to date',
  remaining_budget: 'Remaining',
});

export const TimeBasis = z.enum(['per_year', 'one_time', 'budget']);
export type TimeBasis = z.infer<typeof TimeBasis>;

export const MEASURE_TIME_BASIS: Readonly<Record<MoneyMeasure, TimeBasis>> = Object.freeze({
  annual_market_spend: 'per_year',
  annual_spend_per_unit: 'per_year',
  annual_revenue: 'per_year',
  gross_contribution: 'per_year',
  annual_incremental_opex: 'per_year',
  contribution_after_opex: 'per_year',
  one_time_investment: 'one_time',
  approved_budget: 'budget',
  requested_budget: 'budget',
  committed_spend: 'budget',
  spent_to_date: 'budget',
  remaining_budget: 'budget',
});

/** Market measure ladder rows (research §6.1). */
export const MarketMeasure = z.enum(['tam', 'sam', 'reachable_pool', 'som']);
export type MarketMeasure = z.infer<typeof MarketMeasure>;
export const MARKET_MEASURE_LABELS = labels(MarketMeasure, {
  tam: 'TAM',
  sam: 'SAM',
  reachable_pool: 'Reachable pool',
  som: 'SOM',
});
export const MARKET_MEASURE_MEANING = labels(MarketMeasure, {
  tam: 'Annual spend in the defined market. No claim of capture.',
  sam: 'Sites we could serve after eligibility and product-fit filters.',
  reachable_pool: 'Sites inside current channel and service coverage. Not SOM.',
  som: 'Scenario for a stated horizon. Not a forecast.',
});

export const PopulationUnit = z.enum(['site', 'company', 'customer']);
export type PopulationUnit = z.infer<typeof PopulationUnit>;

export const SizingMethod = z.enum(['aggregate_overlap', 'site_list_union']);
export type SizingMethod = z.infer<typeof SizingMethod>;

export const CrossCheckResult = z.enum(['within_range', 'outside_range', 'not_available']);
export type CrossCheckResult = z.infer<typeof CrossCheckResult>;
export const CROSS_CHECK_RESULT_LABELS = labels(CrossCheckResult, {
  within_range: 'Within range',
  outside_range: 'Outside range',
  not_available: 'Not available',
});

export const CohortStatus = z.enum(['active', 'duplicate_candidate', 'excluded']);
export type CohortStatus = z.infer<typeof CohortStatus>;

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export const VersionState = z.enum(['draft', 'committed']);
export type VersionState = z.infer<typeof VersionState>;

// ---------------------------------------------------------------------------
// Evidence (research §7.2 freshness, connector; PRD S13)
// ---------------------------------------------------------------------------

export const SourceOriginKind = z.enum(['licensed', 'authorized_upload', 'public_web', 'internal_system']);
export type SourceOriginKind = z.infer<typeof SourceOriginKind>;

export const SourceAvailability = z.enum(['available', 'restricted', 'deleted_by_provider', 'unavailable']);
export type SourceAvailability = z.infer<typeof SourceAvailability>;

export const IngestionStatus = z.enum(['pending', 'ingested', 'partial', 'failed']);
export type IngestionStatus = z.infer<typeof IngestionStatus>;

export const EvidenceFreshness = z.enum(['current', 'ageing', 'stale', 'superseded']);
export type EvidenceFreshness = z.infer<typeof EvidenceFreshness>;
export const EVIDENCE_FRESHNESS_LABELS = labels(EvidenceFreshness, {
  current: 'Current',
  ageing: 'Ageing',
  stale: 'Stale',
  superseded: 'Superseded',
});

/** What a principal may see of a source (S14 Source entitlements). */
export const EntitlementAccess = z.enum(['excerpt', 'aggregate_only', 'none']);
export type EntitlementAccess = z.infer<typeof EntitlementAccess>;

export const ClaimStatus = z.enum(['proposed', 'accepted', 'challenged', 'discarded', 'superseded']);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

export const ClaimEvidenceRelation = z.enum(['quoted', 'supports', 'contradicts']);
export type ClaimEvidenceRelation = z.infer<typeof ClaimEvidenceRelation>;

// ---------------------------------------------------------------------------
// Tasks, sync and connectors (research §7.2)
// ---------------------------------------------------------------------------

/** Internal task status. "Done" is reserved for tasks. */
export const TaskStatus = z.enum(['not_started', 'in_progress', 'blocked', 'done']);
export type TaskStatus = z.infer<typeof TaskStatus>;
export const TASK_STATUS_LABELS = labels(TaskStatus, {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
});

export const TaskFunction = z.enum([
  'product',
  'sales',
  'marketing',
  'operations',
  'strategy',
  'finance',
  'specialist',
]);
export type TaskFunction = z.infer<typeof TaskFunction>;

export const TaskSetOwnerType = z.enum(['pilot_plan_version', 'experiment']);
export type TaskSetOwnerType = z.infer<typeof TaskSetOwnerType>;

/** External sync status, separate from internal task status (honest sync). */
export const SyncStatus = z.enum([
  'not_sent',
  'in_preview',
  'sending',
  'confirmed',
  'failed',
  'retry_scheduled',
  'checking',
  'paused_approval_changed',
  'paused_connector',
]);
export type SyncStatus = z.infer<typeof SyncStatus>;
export const SYNC_STATUS_LABELS = labels(SyncStatus, {
  not_sent: 'Not sent',
  in_preview: 'In preview',
  sending: 'Sending…',
  confirmed: 'Confirmed',
  failed: 'Failed',
  retry_scheduled: 'Retry',
  checking: 'Checking',
  paused_approval_changed: 'Paused — approval changed',
  paused_connector: 'Paused — connection expired',
});

export const ConnectorStatus = z.enum(['connected', 'expired', 'missing_permission', 'unavailable']);
export type ConnectorStatus = z.infer<typeof ConnectorStatus>;
export const CONNECTOR_STATUS_LABELS = labels(ConnectorStatus, {
  connected: 'Connected',
  expired: 'Expired',
  missing_permission: 'Missing permission',
  unavailable: 'Unavailable',
});

export const ConnectionKind = z.enum(['task_tool', 'market_data', 'finance', 'crm', 'trade_registry']);
export type ConnectionKind = z.infer<typeof ConnectionKind>;

export const OutboxStatus = z.enum([
  'pending',
  'sending',
  'checking',
  'confirmed',
  'failed',
  'paused',
  'cancelled',
]);
export type OutboxStatus = z.infer<typeof OutboxStatus>;

export const OutboxKind = z.enum(['task.create', 'analytics.emit']);
export type OutboxKind = z.infer<typeof OutboxKind>;

export const PilotPlanStatus = z.enum(['draft', 'ready', 'active', 'paused', 'completed']);
export type PilotPlanStatus = z.infer<typeof PilotPlanStatus>;

export const BudgetEntryKind = z.enum(['committed', 'spent']);
export type BudgetEntryKind = z.infer<typeof BudgetEntryKind>;

export const MessageDraftStatus = z.enum(['draft']);
export type MessageDraftStatus = z.infer<typeof MessageDraftStatus>;

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export const OutcomeReviewStatus = z.enum(['incomplete', 'ready', 'decided']);
export type OutcomeReviewStatus = z.infer<typeof OutcomeReviewStatus>;

// ---------------------------------------------------------------------------
// Analysis runs (PRD §8, research §7.2)
// ---------------------------------------------------------------------------

export const RunStatus = z.enum([
  'queued',
  'running',
  'waiting_for_input',
  'awaiting_approval',
  'completed',
  'partial',
  'failed',
  'cancelled',
]);
export type RunStatus = z.infer<typeof RunStatus>;
/** Business copy for the analysis strip. Infrastructure words never appear here. */
export const RUN_STATUS_LABELS = labels(RunStatus, {
  queued: 'Queued',
  running: 'Working: checking sources…',
  waiting_for_input: 'Needs your input',
  awaiting_approval: 'Needs your input',
  completed: 'Done',
  partial: 'Partial results',
  failed: 'Stopped — your work is saved',
  cancelled: 'Stopped — your work is saved',
});

export const RunStepKind = z.enum([
  'provider_call',
  'tool_call',
  'validation',
  'checkpoint',
  'proposal_write',
]);
export type RunStepKind = z.infer<typeof RunStepKind>;

export const ToolCallOutcome = z.enum(['ok', 'denied', 'error']);
export type ToolCallOutcome = z.infer<typeof ToolCallOutcome>;

export const ProposalStatus = z.enum([
  'proposed',
  'accepted',
  'edited_and_accepted',
  'rejected',
  'superseded',
]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

export const SkillKey = z.enum([
  'mandate-to-search-plan',
  'market-boundary-definition',
  'bottom-up-sizing',
  'cohort-deduplication',
  'ability-to-win-assessment',
  'scenario-economics',
  'assumption-prioritization',
  'validation-experiment-design',
  'pilot-plan',
  'outcome-review',
]);
export type SkillKey = z.infer<typeof SkillKey>;

/** Tools the analysis agent may call. All are read-only or deterministic (D-019). */
export const AgentToolName = z.enum([
  'intelligence.search',
  'evidence.get',
  'portfolio.get_product',
  'crm.get_authorized_accounts',
  'sizing.calculate',
  'economics.calculate',
  'work.preview_tasks',
]);
export type AgentToolName = z.infer<typeof AgentToolName>;

// ---------------------------------------------------------------------------
// Materiality (PRD §4)
// ---------------------------------------------------------------------------

export const MaterialityClass = z.enum(['material', 'not_material', 'uncertain']);
export type MaterialityClass = z.infer<typeof MaterialityClass>;

export const MaterialChangeType = z.enum([
  'geography_changed',
  'product_changed',
  'segment_changed',
  'spend_ceiling_changed',
  'decision_critical_assumption_changed',
  'model_version_changed',
  'source_superseded_or_deleted',
  'specialist_scope_changed',
  'plan_tasks_changed',
  'plan_destination_changed',
  'comment_or_formatting',
  'other',
]);
export type MaterialChangeType = z.infer<typeof MaterialChangeType>;

export const PolicyKind = z.enum([
  'gate',
  'materiality',
  'approval_expiry',
  'retention',
  'run_budget',
  'self_approval',
]);
export type PolicyKind = z.infer<typeof PolicyKind>;
