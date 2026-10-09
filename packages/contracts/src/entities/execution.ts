/**
 * FROZEN pilot plan, tasks, external sync, budget, outcomes (PRD ME-12–ME-14, S11, S12, My Work).
 *
 * Internal task status and external sync status are separate fields. "Confirmed" appears only
 * after the external tool returned a key. Task completion never passes a gate.
 */
import { z } from 'zod';
import {
  BudgetEntryKind,
  ConnectorStatus,
  DecisionOutcome,
  OutcomeReviewStatus,
  PilotPlanStatus,
  SyncStatus,
  TaskFunction,
  TaskSetOwnerType,
  TaskStatus,
  ThresholdResult,
  VersionState,
} from '../enums';
import { Blocker } from '../errors';
import {
  CurrencyCode,
  DecimalString,
  DisplayKey,
  Id,
  IsoDate,
  IsoDateTime,
  Money,
  PersonRef,
  RowVersion,
  Sha256Hex,
  Unavailable,
} from '../primitives';
import { Condition } from './gate';

export const ExternalSync = z.object({
  status: SyncStatus,
  connectionId: Id.nullable(),
  externalKey: z.string().nullable(), // "PIL-11"
  externalUrl: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  lastErrorCode: z.string().nullable(), // "permission_denied", "timeout", "token_expired", "http_5xx"
  lastErrorMessage: z.string().nullable(), // business copy: "assignee is not a member of project PIL"
  retryable: z.boolean(),
  confirmedAt: IsoDateTime.nullable(),
});
export type ExternalSync = z.infer<typeof ExternalSync>;

export const Task = z.object({
  id: Id,
  caseId: Id,
  taskSetId: Id,
  ordinal: z.number().int().positive(), // "Task 1"
  title: z.string(),
  milestoneId: Id.nullable(),
  milestoneLabel: z.string().nullable(), // "M1 · Kick-off · weeks 1–2"
  function: TaskFunction,
  owner: PersonRef.nullable(), // missing owner blocks activation (ME-12)
  dependsOnTaskIds: z.array(Id),
  dependsOnLabel: z.string(), // "Task 1", "Tasks 4, 5", "—"
  dueOn: IsoDate.nullable(),
  dueRule: z.string().nullable(), // "Weekly"
  deliverable: z.string(),
  conditionKey: z.string().nullable(), // tasks created for a condition, e.g. "C2"
  status: TaskStatus,
  sync: ExternalSync,
  rowVersion: RowVersion,
});
export type Task = z.infer<typeof Task>;

export const Milestone = z.object({
  id: Id,
  name: z.string(),
  windowText: z.string(),
  ordinal: z.number().int().positive(),
});
export type Milestone = z.infer<typeof Milestone>;

export const TaskSet = z.object({
  id: Id,
  caseId: Id,
  ownerType: TaskSetOwnerType,
  ownerId: Id,
  authorizingGateRequestId: Id, // the approval that allows creating these tasks
  connectionId: Id.nullable(),
  destinationLabel: z.string().nullable(), // "Jira · project PIL · Aster Pilots"
  tasks: z.array(Task),
  summary: z.object({
    total: z.number().int(),
    confirmed: z.number().int(),
    failed: z.number().int(),
    pending: z.number().int(),
    paused: z.number().int(),
  }),
  summaryText: z.string(), // "5 of 6 tasks confirmed in Jira · 1 failed"
});
export type TaskSet = z.infer<typeof TaskSet>;

/** Dry-run preview (ME-13). Creating tasks requires the id and hash of a current preview. */
export const TaskSyncPreview = z.object({
  id: Id,
  taskSetId: Id,
  planVersionId: Id.nullable(),
  contentHash: Sha256Hex,
  destination: z.object({ tool: z.string(), project: z.string(), projectName: z.string().nullable() }),
  willCreate: z.number().int(),
  linkText: z.string(), // "each linked to ME-104 · G2 v3"
  assigneesText: z.string(),
  permissionsText: z.string(), // "Create and assign issues · as Jonas Klein"
  repeatsText: z.string(), // "Each task has a fixed reference; retrying never duplicates"
  items: z.array(
    z.object({
      taskId: Id,
      title: z.string(),
      assignee: z.string().nullable(),
      fields: z.record(z.string(), z.string()),
    }),
  ),
  problems: z.array(Blocker), // e.g. assignee not mappable
  connectionStatus: ConnectorStatus,
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type TaskSyncPreview = z.infer<typeof TaskSyncPreview>;

export const PilotPlanVersion = z.object({
  id: Id,
  pilotPlanId: Id,
  version: z.number().int().positive(),
  state: VersionState,
  baselineSnapshotId: Id.nullable(), // the approved G2 snapshot pinned on S11
  budgetCeiling: DecimalString,
  currency: CurrencyCode,
  windowStart: IsoDate,
  windowEnd: IsoDate,
  scopeText: z.string(),
  thresholdsText: z.array(z.string()),
  milestones: z.array(Milestone),
  rowVersion: RowVersion,
});
export type PilotPlanVersion = z.infer<typeof PilotPlanVersion>;

export const BudgetMeter = z.object({
  gateRequestId: Id,
  asOf: IsoDate,
  approved: Money,
  committed: z.union([Money, Unavailable]),
  spent: z.union([Money, Unavailable]),
  remaining: z.union([Money, Unavailable]),
  note: z.string(), // "Spend above €120k is blocked without a scope-change request."
});
export type BudgetMeter = z.infer<typeof BudgetMeter>;

export const BudgetEntry = z.object({
  id: Id,
  gateRequestId: Id,
  kind: BudgetEntryKind,
  amount: DecimalString,
  currency: CurrencyCode,
  asOf: IsoDate,
  sourceText: z.string(),
  recordedBy: PersonRef,
});
export type BudgetEntry = z.infer<typeof BudgetEntry>;

export const MessageDraft = z.object({
  id: Id,
  caseId: Id,
  title: z.string(),
  body: z.string(),
  origin: z.enum(['human', 'ai', 'ai_edited']),
  status: z.literal('draft'), // MVP never sends prospect communications (PRD §3, S11)
  notice: z.literal('Draft — not authorized to send'),
});
export type MessageDraft = z.infer<typeof MessageDraft>;

export const PilotPlanView = z.object({
  pilotPlanId: Id,
  status: PilotPlanStatus,
  baseline: z
    .object({
      gateRequestId: Id,
      snapshotId: Id,
      snapshotVersion: z.number().int(),
      fingerprint: z.string(),
      approvedAt: IsoDateTime,
      statusText: z.string(), // "G2 · Approved with conditions · 27 Nov"
    })
    .nullable(),
  current: PilotPlanVersion.nullable(),
  draft: PilotPlanVersion.nullable(),
  conditions: z.array(Condition),
  budget: BudgetMeter.nullable(),
  taskSet: TaskSet.nullable(),
  activationBlockers: z.array(Blocker),
  messageDrafts: z.array(MessageDraft),
  connectorBanner: z.object({ status: ConnectorStatus, title: z.string(), body: z.string() }).nullable(),
});
export type PilotPlanView = z.infer<typeof PilotPlanView>;

export const ScopeChangeRequest = z.object({
  id: Id,
  caseId: Id,
  requestedBy: PersonRef,
  description: z.string(),
  requestedChanges: z.record(z.string(), z.string()),
  status: z.enum(['open', 'converted_to_gate_request', 'withdrawn']),
  gateRequestId: Id.nullable(),
  createdAt: IsoDateTime,
});
export type ScopeChangeRequest = z.infer<typeof ScopeChangeRequest>;

// ---------------------------------------------------------------------------
// Outcomes (S12)
// ---------------------------------------------------------------------------

/** Target pre-registered in the approved snapshot. Thresholds never move after activation. */
export const OutcomeTarget = z.object({
  id: Id,
  metricKey: z.string(),
  name: z.string(),
  thresholdText: z.string(), // "4 of 4 pilot customers"
  operator: z.enum(['gte', 'lte', 'eq', 'qualitative']),
  thresholdValue: DecimalString.nullable(),
  unit: z.string(),
  windowText: z.string(),
  snapshotId: Id,
});
export type OutcomeTarget = z.infer<typeof OutcomeTarget>;

/** An actual. Append-only: edits create a new version that supersedes the previous one. */
export const OutcomeObservation = z.object({
  id: Id,
  targetId: Id.nullable(),
  version: z.number().int().positive(),
  valueText: z.string(), // "3 of 4"
  value: DecimalString.nullable(),
  unit: z.string(),
  periodStart: IsoDate,
  periodEnd: IsoDate,
  sourceText: z.string(), // "Source: billing records"
  sourceId: Id.nullable(),
  result: ThresholdResult.nullable(),
  recordedBy: PersonRef,
  recordedAt: IsoDateTime,
  supersedesId: Id.nullable(),
});
export type OutcomeObservation = z.infer<typeof OutcomeObservation>;

export const DecisionRecord = z.object({
  id: Id,
  caseId: Id,
  outcome: DecisionOutcome,
  label: z.string(), // "Revise and extend validation"
  rationale: z.string(),
  decidedBy: PersonRef,
  decidedAt: IsoDateTime,
  onRecommendationOf: PersonRef.nullable(),
  outcomeReviewId: Id.nullable(),
});
export type DecisionRecord = z.infer<typeof DecisionRecord>;

export const OutcomeReviewView = z.object({
  id: Id,
  caseId: Id,
  version: z.number().int().positive(),
  status: OutcomeReviewStatus,
  incompleteReasons: z.array(z.string()), // "1 metric has no data for Oct"
  rows: z.array(
    z.object({
      target: OutcomeTarget.nullable(),
      label: z.string(),
      latest: OutcomeObservation.nullable(),
      history: z.array(OutcomeObservation),
      notAThreshold: z.boolean(), // e.g. spend
    }),
  ),
  whatWeLearned: z.array(z.string()),
  whatChangesNext: z.array(z.string()),
  causalLimitations: z.array(z.string()).min(1), // required
  readiness: z.array(z.object({ text: z.string(), owner: PersonRef, status: z.string() })),
  recommendation: z
    .object({
      outcome: DecisionOutcome,
      label: z.string(),
      text: z.string(),
      by: PersonRef,
      accepted: z.boolean(),
    })
    .nullable(),
  decision: DecisionRecord.nullable(),
  scaleGate: z.object({ blocked: z.boolean(), unmet: z.array(Blocker) }),
});
export type OutcomeReviewView = z.infer<typeof OutcomeReviewView>;

// ---------------------------------------------------------------------------
// My Work and Reviews inbox
// ---------------------------------------------------------------------------

export const WorkItem = z.object({
  id: Id,
  kind: z.enum(['task', 'experiment', 'review_request', 'condition', 'gate_decision']),
  title: z.string(),
  caseId: Id,
  caseKey: DisplayKey,
  subtitle: z.string(), // "ME-104 · M1 Kick-off · Sales"
  dueText: z.string().nullable(),
  statusText: z.string(),
  href: z.string(),
  brief: z
    .object({
      gateText: z.string(),
      syncText: z.string(),
      why: z.string(),
      doneLooksLike: z.string(),
      stayInside: z.array(z.string()),
      measuredAgainst: z.string(),
    })
    .nullable(),
});
export type WorkItem = z.infer<typeof WorkItem>;
