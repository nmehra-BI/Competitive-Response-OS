/**
 * FROZEN events.
 *
 * 1. Domain events: written in the same transaction as the state change (audit + outbox).
 *    Workers and projections subscribe to them. Payloads carry ids and versions.
 * 2. Analytics events: exactly the PRD §17 list. The envelope carries tenant-scoped case id,
 *    actor role, object version, timestamp, stage and correlation id. Properties are a closed,
 *    per-event whitelist of ids, enums, counts and booleans: never raw restricted source text,
 *    account details or confidential financial inputs.
 */
import { z } from 'zod';
import {
  CaseStage,
  DecisionOutcome,
  GateCode,
  GateDisposition,
  MaterialChangeType,
  OpportunityOrigin,
  ReviewArea,
  RoleCode,
  SyncStatus,
  ThresholdResult,
} from './enums';
import { Id, IsoDateTime } from './primitives';

// ---------------------------------------------------------------------------
// Analytics (PRD §17)
// ---------------------------------------------------------------------------

export const AnalyticsEventName = z.enum([
  'mandate_created',
  'mandate_approved',
  'opportunity_shortlisted',
  'evidence_reviewed',
  'sizing_snapshot_created',
  'assumption_changed',
  'feasibility_review_recorded',
  'validation_authorized',
  'experiment_completed',
  'gate_submitted',
  'gate_returned',
  'gate_approved',
  'approval_invalidated',
  'pilot_activated',
  'external_task_confirmed',
  'external_task_failed',
  'outcome_recorded',
  'extension_requested',
  'scale_requested',
  'case_stopped',
]);
export type AnalyticsEventName = z.infer<typeof AnalyticsEventName>;

export const AnalyticsEnvelope = z.object({
  eventId: Id,
  name: AnalyticsEventName,
  tenantId: Id,
  caseId: Id.nullable(), // tenant-scoped id, never a display title
  actorRole: RoleCode.or(z.literal('system')),
  objectType: z.string(),
  objectId: Id,
  objectVersion: z.number().int().nullable(),
  occurredAt: IsoDateTime,
  stage: CaseStage.nullable(),
  correlationId: z.string(),
});
export type AnalyticsEnvelope = z.infer<typeof AnalyticsEnvelope>;

/** Closed property whitelist per event. `.strict()` rejects any extra key at emit time. */
export const AnalyticsProps = {
  mandate_created: z.object({ hasSponsor: z.boolean() }).strict(),
  mandate_approved: z.object({ gate: z.literal('G0'), waitMs: z.number().int() }).strict(),
  opportunity_shortlisted: z.object({ origin: OpportunityOrigin }).strict(),
  evidence_reviewed: z.object({ action: z.enum(['challenge', 'mark_stale', 'replace', 'accept']) }).strict(),
  sizing_snapshot_created: z.object({ version: z.number().int(), blockedChecks: z.number().int() }).strict(),
  assumption_changed: z
    .object({ decisionCritical: z.boolean(), origin: z.enum(['human', 'ai', 'ai_edited']) })
    .strict(),
  feasibility_review_recorded: z.object({ area: ReviewArea, scoped: z.boolean() }).strict(),
  validation_authorized: z.object({ gate: z.literal('G1') }).strict(),
  experiment_completed: z
    .object({
      metrics: z.number().int(),
      met: z.number().int(),
      notMet: z.number().int(),
      inconclusive: z.number().int(),
    })
    .strict(),
  gate_submitted: z.object({ gate: GateCode, snapshotVersion: z.number().int() }).strict(),
  gate_returned: z
    .object({ gate: GateCode, disposition: GateDisposition, waitMs: z.number().int() })
    .strict(),
  gate_approved: z.object({ gate: GateCode, withConditions: z.boolean(), waitMs: z.number().int() }).strict(),
  approval_invalidated: z.object({ gate: GateCode, changeType: MaterialChangeType }).strict(),
  pilot_activated: z.object({ tasks: z.number().int() }).strict(),
  external_task_confirmed: z.object({ attempts: z.number().int() }).strict(),
  external_task_failed: z.object({ errorCode: z.string(), retryable: z.boolean() }).strict(),
  outcome_recorded: z.object({ result: ThresholdResult.nullable() }).strict(),
  extension_requested: z.object({ parentGate: GateCode }).strict(),
  scale_requested: z.object({ preconditionsUnmet: z.number().int() }).strict(),
  case_stopped: z.object({ fromStage: CaseStage, outcome: DecisionOutcome.nullable() }).strict(),
} as const satisfies Record<AnalyticsEventName, z.ZodTypeAny>;

// ---------------------------------------------------------------------------
// Domain events (internal; also the audit `action` vocabulary)
// ---------------------------------------------------------------------------

const base = {
  eventId: Id,
  tenantId: Id,
  caseId: Id.nullable(),
  actorId: Id.nullable(),
  occurredAt: IsoDateTime,
  correlationId: z.string(),
};

export const DomainEvent = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('mandate.created'), mandateId: Id }),
  z.object({
    ...base,
    type: z.literal('mandate.version_committed'),
    mandateId: Id,
    version: z.number().int(),
  }),
  z.object({
    ...base,
    type: z.literal('opportunity.status_changed'),
    opportunityId: Id,
    from: z.string(),
    to: z.string(),
  }),
  z.object({ ...base, type: z.literal('case.created'), originType: z.string() }),
  z.object({
    ...base,
    type: z.literal('case.stage_changed'),
    from: CaseStage,
    to: CaseStage,
    reason: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('model.version_committed'),
    modelType: z.enum(['sizing', 'economics', 'thesis', 'pilot_plan']),
    modelVersionId: Id,
    version: z.number().int(),
  }),
  z.object({
    ...base,
    type: z.literal('assumption.version_created'),
    assumptionId: Id,
    versionId: Id,
    decisionCritical: z.boolean(),
  }),
  z.object({
    ...base,
    type: z.literal('source.changed'),
    sourceId: Id,
    change: z.enum(['superseded', 'deleted', 'marked_stale', 'replaced']),
  }),
  z.object({
    ...base,
    type: z.literal('material_change.detected'),
    materialChangeId: Id,
    changeType: MaterialChangeType,
  }),
  z.object({ ...base, type: z.literal('gate.submitted'), gateRequestId: Id, snapshotId: Id, gate: GateCode }),
  z.object({
    ...base,
    type: z.literal('gate.snapshot_stale'),
    gateRequestId: Id,
    snapshotId: Id,
    reason: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('gate.decided'),
    gateRequestId: Id,
    snapshotId: Id,
    approvalId: Id,
    disposition: GateDisposition,
  }),
  z.object({
    ...base,
    type: z.literal('gate.approval_invalidated'),
    gateRequestId: Id,
    approvalId: Id,
    materialChangeId: Id.nullable(),
  }),
  z.object({ ...base, type: z.literal('gate.approval_expired'), gateRequestId: Id, approvalId: Id }),
  z.object({
    ...base,
    type: z.literal('experiment.locked'),
    experimentId: Id,
    planVersion: z.number().int(),
  }),
  z.object({ ...base, type: z.literal('experiment.amended'), experimentId: Id, amendment: z.number().int() }),
  z.object({
    ...base,
    type: z.literal('experiment.result_recorded'),
    experimentId: Id,
    resultVersion: z.number().int(),
  }),
  z.object({ ...base, type: z.literal('pilot.activated'), pilotPlanId: Id, planVersionId: Id }),
  z.object({
    ...base,
    type: z.literal('task_sync.requested'),
    taskSetId: Id,
    previewId: Id,
    taskIds: z.array(Id),
  }),
  z.object({
    ...base,
    type: z.literal('task_sync.status_changed'),
    taskId: Id,
    from: SyncStatus,
    to: SyncStatus,
    externalKey: z.string().nullable(),
  }),
  z.object({ ...base, type: z.literal('outcome.recorded'), observationId: Id }),
  z.object({ ...base, type: z.literal('decision.recorded'), decisionId: Id, outcome: DecisionOutcome }),
  z.object({
    ...base,
    type: z.literal('analysis_run.status_changed'),
    runId: Id,
    from: z.string(),
    to: z.string(),
  }),
  z.object({ ...base, type: z.literal('proposal.decided'), proposalId: Id, status: z.string() }),
]);
export type DomainEvent = z.infer<typeof DomainEvent>;
export type DomainEventType = DomainEvent['type'];
