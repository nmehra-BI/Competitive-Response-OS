/**
 * FROZEN gates, decision snapshots and approvals (shared primitives with app gate definitions).
 * PRD §4 gate table, ME-10, ME-11, S10; research §6.11–§6.13.
 *
 * Invariants:
 *  - An approval references exactly one immutable snapshot by id AND content hash.
 *  - Only a human with an interactive session and a matching authority grant can decide.
 *  - The package author and the case owner cannot approve their own gate.
 *  - A material change after approval invalidates it; executed external writes are preserved.
 */
import { z } from 'zod';
import {
  ConditionFlag,
  ConditionStatus,
  GateCode,
  GateDisposition,
  GateRequestStatus,
  GateStatus,
  MaterialChangeType,
  MaterialityClass,
  ReviewArea,
  ReviewerPosition,
  RoleCode,
  SnapshotStatus,
} from '../enums';
import { Blocker } from '../errors';
import {
  CountryCode,
  CurrencyCode,
  DecimalString,
  DisplayKey,
  Fingerprint,
  Id,
  IsoDate,
  IsoDateTime,
  PersonRef,
  RowVersion,
  Sha256Hex,
} from '../primitives';

/** What the gate asks for. Rendered in the scoped button label, e.g. "Approve pilot €120k · 90 days". */
export const GateScope = z.object({
  amount: DecimalString.nullable(),
  currency: CurrencyCode.nullable(),
  durationDays: z.number().int().positive().nullable(),
  windowStart: IsoDate.nullable(),
  windowEnd: IsoDate.nullable(),
  countryCodes: z.array(CountryCode),
  segmentLabel: z.string().nullable(),
  maxSites: z.number().int().positive().nullable(),
  milestones: z.array(z.string()),
  ownerId: Id.nullable(),
  authorizes: z.array(z.string()), // "What this authorizes"
  doesNotAuthorize: z.array(z.string()), // "What this does not authorize"
});
export type GateScope = z.infer<typeof GateScope>;

export const Precondition = z.object({
  key: z.string(),
  label: z.string(),
  met: z.boolean(),
  detail: z.string().nullable(),
  href: z.string().nullable(),
});
export type Precondition = z.infer<typeof Precondition>;

export const Condition = z.object({
  id: Id,
  key: z.string(), // C1
  text: z.string(),
  owner: PersonRef,
  dueOn: IsoDate.nullable(),
  dueRule: z.string().nullable(), // "Weekly"
  flag: ConditionFlag,
  status: ConditionStatus,
  addedBy: PersonRef,
  metEvidence: z.string().nullable(),
  metAt: IsoDateTime.nullable(),
});
export type Condition = z.infer<typeof Condition>;

export const ConditionInput = z.object({
  text: z.string().min(1),
  ownerId: Id,
  dueOn: IsoDate.nullable(),
  dueRule: z.string().nullable(),
  flag: ConditionFlag,
});
export type ConditionInput = z.infer<typeof ConditionInput>;

export const ReviewerPositionRecord = z.object({
  id: Id,
  reviewer: PersonRef,
  area: ReviewArea,
  position: ReviewerPosition,
  scopeText: z.string(),
  signedVersion: z.number().int().positive().nullable(),
  signedAt: IsoDateTime.nullable(),
});
export type ReviewerPositionRecord = z.infer<typeof ReviewerPositionRecord>;

export const Dissent = z.object({
  id: Id,
  author: PersonRef,
  authorRole: z.string(),
  statement: z.string(), // reviewer's own words
  scopeText: z.string(), // "Scope: adoption assumption · signed on v3"
  signedAt: IsoDateTime,
  signedSnapshotVersion: z.number().int().positive().nullable(),
});
export type Dissent = z.infer<typeof Dissent>;

/**
 * The frozen, hashed decision package. `content` is canonical JSON (RFC 8785) whose SHA-256 is
 * `contentHash`. It copies the human-readable values the approver sees and pins component versions.
 */
export const SnapshotContent = z.object({
  schemaVersion: z.literal(1),
  caseId: Id,
  caseKey: DisplayKey,
  /**
   * D-036 (CR-WS1-2, additive): what the gate decides on. A standalone G0 has no case yet; its subject
   * is the mandate, and caseId/caseKey repeat the mandate id/key for compatibility. Absent = the case.
   */
  subject: z.object({ type: z.enum(['case', 'mandate']), id: Id, key: DisplayKey }).optional(),
  gateCode: GateCode,
  ask: z.string(),
  scope: GateScope,
  recommendation: z.string(),
  alternatives: z.array(z.object({ name: z.string(), meaning: z.string(), isNoEntry: z.boolean() })),
  evidenceSummary: z.array(z.object({ sourceId: Id, label: z.string() })),
  assumptions: z.array(
    z.object({
      assumptionId: Id,
      versionId: Id,
      name: z.string(),
      valueText: z.string(),
      disputed: z.boolean(),
    }),
  ),
  validationResults: z.array(
    z.object({ experimentId: Id, resultVersionId: Id, summary: z.string(), limitations: z.string() }),
  ),
  economics: z
    .object({
      economicsVersionId: Id,
      inputHash: Sha256Hex,
      tableText: z.array(z.array(z.string())),
      note: z.string(),
    })
    .nullable(),
  sizing: z.object({ sizingVersionId: Id, inputHash: Sha256Hex, summary: z.string() }).nullable(),
  signOffs: z.array(ReviewerPositionRecord.omit({ id: true })),
  budgetAndStopRules: z.array(z.string()),
  conditionsProposed: z.array(ConditionInput),
  dissent: z.array(Dissent.omit({ id: true })),
  knownLimitations: z.array(z.string()),
  blockers: z.array(z.string()),
  outcomeTargets: z.array(
    z.object({ metricKey: z.string(), name: z.string(), thresholdText: z.string(), window: z.string() }),
  ),
  components: z.array(
    z.object({
      type: z.enum([
        'mandate_version',
        'thesis_version',
        'sizing_version',
        'economics_version',
        'assumption_version',
        'feasibility_review',
        'experiment_result_version',
        'experiment_plan_version',
        'pilot_plan_version',
        'source',
        'claim',
        'outcome_review',
      ]),
      id: Id,
      version: z.number().int().positive().nullable(),
    }),
  ),
});
export type SnapshotContent = z.infer<typeof SnapshotContent>;

export const DecisionSnapshot = z.object({
  id: Id,
  gateRequestId: Id,
  caseId: Id.nullable(),
  version: z.number().int().positive(), // per case: "Snapshot v3"
  status: SnapshotStatus,
  staleReason: z.string().nullable(),
  staleAt: IsoDateTime.nullable(),
  supersededBySnapshotId: Id.nullable(),
  content: SnapshotContent,
  contentHash: Sha256Hex,
  fingerprint: Fingerprint,
  createdBy: PersonRef,
  createdAt: IsoDateTime,
});
export type DecisionSnapshot = z.infer<typeof DecisionSnapshot>;

/** Immutable decision record by one approver on one snapshot. */
export const Approval = z.object({
  id: Id,
  gateRequestId: Id,
  snapshotId: Id,
  snapshotHash: Sha256Hex,
  approver: PersonRef,
  approverRole: RoleCode,
  authorityGrantId: Id.nullable(),
  disposition: GateDisposition,
  rationale: z.string().min(1),
  note: z.string().nullable(),
  delegatedTo: PersonRef.nullable(),
  decidedAt: IsoDateTime,
  /** Derived from approval_invalidation / expiry; the approval row itself never changes. */
  effective: z.boolean(),
  invalidation: z.object({ reason: z.string(), at: IsoDateTime, materialChangeId: Id.nullable() }).nullable(),
});
export type Approval = z.infer<typeof Approval>;

export const ApprovalChainStep = z.object({
  approver: PersonRef,
  routingReason: z.string(), // "Pilot spend in BU Water routes to the BU VP"
  state: z.enum(['waiting', 'decided', 'abstained', 'delegated']),
  isViewer: z.boolean(),
});
export type ApprovalChainStep = z.infer<typeof ApprovalChainStep>;

export const GateRequest = z.object({
  id: Id,
  key: DisplayKey, // ME-104-G2, ME-104-X1, MD-21-G0
  caseId: Id.nullable(), // null for G0 on a standalone mandate
  mandateId: Id.nullable(),
  gateCode: GateCode,
  status: GateRequestStatus,
  displayStatus: GateStatus,
  scope: GateScope,
  buttonLabel: z.string(), // "Approve pilot €120k · 90 days" — never a bare "Approve"
  parentGateRequestId: Id.nullable(), // extensions point to the gate they extend
  submittedBy: PersonRef.nullable(),
  submittedAt: IsoDateTime.nullable(),
  decidedAt: IsoDateTime.nullable(),
  expiresAt: IsoDateTime.nullable(),
  currentSnapshotId: Id.nullable(),
  conditions: z.array(Condition),
  rowVersion: RowVersion,
});
export type GateRequest = z.infer<typeof GateRequest>;

/** What the viewer may do on the approval panel, computed by the policy engine. */
export const ApprovalPanelState = z.object({
  canDecide: z.boolean(),
  allowedDispositions: z.array(GateDisposition),
  cannotDecideReason: z.string().nullable(), // "You authored this package and cannot approve it."
  viewerAuthorityText: z.string().nullable(), // "Up to €[limit] · BU Water · pilots and validation"
  chain: z.array(ApprovalChainStep),
  requiredApprovals: z.number().int(),
  receivedApprovals: z.number().int(),
});
export type ApprovalPanelState = z.infer<typeof ApprovalPanelState>;

/** S10 / decision brief payload. */
export const DecisionPackageView = z.object({
  gateRequest: GateRequest,
  snapshot: DecisionSnapshot,
  approvals: z.array(Approval),
  dissent: z.array(Dissent),
  positions: z.array(ReviewerPositionRecord),
  panel: ApprovalPanelState,
  changesSinceViewerLastSaw: z.array(z.string()),
  staleBanner: z.object({ title: z.string(), body: z.string() }).nullable(),
  gateHistory: z.array(
    z.object({
      gateRequestId: Id,
      gateCode: GateCode,
      label: z.string(),
      status: GateStatus,
      snapshotVersion: z.number().int().nullable(),
      fingerprint: Fingerprint.nullable(),
      rationale: z.string().nullable(),
      decidedAt: IsoDateTime.nullable(),
    }),
  ),
});
export type DecisionPackageView = z.infer<typeof DecisionPackageView>;

export const GatePreconditionsView = z.object({
  gateCode: GateCode,
  status: GateStatus,
  preconditions: z.array(Precondition),
  blockers: z.array(Blocker),
  canSubmit: z.boolean(),
});
export type GatePreconditionsView = z.infer<typeof GatePreconditionsView>;

export const MaterialChange = z.object({
  id: Id,
  caseId: Id,
  changeType: MaterialChangeType,
  objectType: z.string(),
  objectId: Id,
  fromVersion: z.number().int().nullable(),
  toVersion: z.number().int().nullable(),
  classification: MaterialityClass,
  ruleKey: z.string(),
  detectedAt: IsoDateTime,
  actor: PersonRef,
  affectedSnapshotIds: z.array(Id),
  affectedApprovalIds: z.array(Id),
  resolvedClassification: MaterialityClass.nullable(),
  resolvedBy: PersonRef.nullable(),
});
export type MaterialChange = z.infer<typeof MaterialChange>;

export const ReviewRequest = z.object({
  id: Id,
  caseId: Id,
  caseKey: DisplayKey,
  area: ReviewArea,
  targetType: z.string(),
  targetId: Id.nullable(),
  question: z.string(),
  whatToCheck: z.array(z.string()),
  requestedBy: PersonRef,
  reviewer: PersonRef,
  dueOn: IsoDate.nullable(),
  status: z.enum(['open', 'responded', 'cancelled']),
  response: z.enum(['confirm', 'dispute', 'abstain']).nullable(),
  responseReason: z.string().nullable(),
  respondedAt: IsoDateTime.nullable(),
});
export type ReviewRequest = z.infer<typeof ReviewRequest>;
