/**
 * FROZEN endpoints: case envelope, thesis and claims (S05), sizing (S06), feasibility (S07),
 * economics (S08), assumptions and disputes (S09 register), lineage drawer.
 */
import { z } from 'zod';
import { FeasibilityDimension, ReviewArea, ReviewerPosition, RoleCode, Sensitivity } from '../enums';
import { Assumption, AssumptionVersion, ThesisFields, ThesisView, ValueUnit } from '../entities/assumption';
import { CaseHeader, MandateFields, WorkflowCase } from '../entities/case';
import { Challenge, Claim } from '../entities/evidence';
import {
  EconomicsView,
  EconomicsVersion,
  FeasibilityView,
  ModelReview,
  SizingVersion,
  SizingView,
} from '../entities/models';
import { ActivityItem, AuditEvent } from '../entities/audit';
import { ReviewRequest } from '../entities/gate';
import { EconomicsOutput, LineageNode, SizingOutput } from '../engines';
import { Page, PageQuery } from '../http';
import { CurrencyCode, DecimalString, Id, IsoDate, PersonRef, PriceYear } from '../primitives';
import { CaseParams, endpoint, IdParams, Rationale } from './endpoint';

// ----- Case envelope -----

export const CaseCommand = z.enum(['start_assessment', 'hold', 'resume', 'stop', 'close']);
export type CaseCommand = z.infer<typeof CaseCommand>;

/**
 * A person who works on a case (D-037, additive after the freeze): owner-picker candidates for
 * conditions, tasks and reviews. Roles are the person's roles that reach this case (case- or
 * business-unit-scoped); participantRoles are their case_participant rows. Tenant admins are not
 * members unless they also hold a case role. Never includes agents or service principals.
 */
export const CaseMember = PersonRef.extend({
  roles: z.array(RoleCode),
  participantRoles: z.array(z.string()),
});
export type CaseMember = z.infer<typeof CaseMember>;

export const caseEndpoints = {
  createDirect: endpoint({
    id: 'cases.createDirect',
    method: 'POST',
    path: '/me/cases',
    summary: 'Create a case with a new inline mandate. Stage Draft mandate until G0.',
    screens: ['S01', 'S02'],
    prd: ['ME-01'],
    idempotent: true,
    body: z.object({ businessUnitId: Id, title: z.string().min(1), mandate: MandateFields.partial() }),
    response: WorkflowCase,
  }),
  header: endpoint({
    id: 'cases.header',
    method: 'GET',
    path: '/me/cases/:caseRef',
    summary: 'Persistent case header: owner, stage, next decision, freshness, gate rail, tab counts.',
    screens: ['S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12', 'BRIEF'],
    prd: ['§7', 'ME-11'],
    params: CaseParams,
    response: CaseHeader,
  }),
  transition: endpoint({
    id: 'cases.transition',
    method: 'POST',
    path: '/me/cases/:caseRef/transitions',
    summary:
      'Owner/sponsor commands outside gates: start assessment, hold, resume, stop (decision), close. Stop needs authority and rationale.',
    screens: ['S05', 'S12'],
    prd: ['§4', 'ME-17'],
    auth: 'human',
    idempotent: true,
    params: CaseParams,
    body: Rationale.extend({ command: CaseCommand }),
    response: CaseHeader,
    successStatus: 200,
  }),
  members: endpoint({
    id: 'cases.members',
    method: 'GET',
    path: '/me/cases/:caseRef/members',
    summary:
      'People who work on the case (owner-picker candidates): human principals with a role that reaches the case, and case participants. Added by D-037.',
    screens: ['S10', 'S11', 'S12'],
    prd: ['ME-11', 'ME-12'],
    params: CaseParams,
    response: z.object({ items: z.array(CaseMember) }),
  }),
  activity: endpoint({
    id: 'cases.activity',
    method: 'GET',
    path: '/me/cases/:caseRef/activity',
    summary: 'Activity timeline (shared component); key decisions pinned.',
    screens: ['S05', 'S12', 'S01'],
    prd: ['ME-17'],
    params: CaseParams,
    query: PageQuery.extend({ keyOnly: z.coerce.boolean().optional() }),
    response: Page(ActivityItem),
  }),
  history: endpoint({
    id: 'cases.history',
    method: 'GET',
    path: '/me/cases/:caseRef/history',
    summary: 'History tab: audit events for this case, filterable by object.',
    screens: ['S13'],
    prd: ['ME-17'],
    params: CaseParams,
    query: PageQuery.extend({ objectType: z.string().optional(), objectId: Id.optional() }),
    response: Page(AuditEvent),
  }),
  requestReview: endpoint({
    id: 'cases.requestReview',
    method: 'POST',
    path: '/me/cases/:caseRef/review-requests',
    summary: 'Assign a reviewer with a focused question and "what to check" list.',
    screens: ['S05', 'S07', 'S08'],
    prd: ['ME-06'],
    idempotent: true,
    params: CaseParams,
    body: z.object({
      area: ReviewArea,
      reviewerId: Id,
      targetType: z.string(),
      targetId: Id.nullable(),
      question: z.string().min(1),
      whatToCheck: z.array(z.string()),
      dueOn: IsoDate.nullable(),
    }),
    response: ReviewRequest,
  }),
};

// ----- Thesis and claims (S05) -----

export const thesisEndpoints = {
  get: endpoint({
    id: 'thesis.get',
    method: 'GET',
    path: '/me/cases/:caseRef/thesis',
    summary:
      'Thesis (current + draft), claims with kinds, top 5 assumptions, disagreements, blockers, reviewers.',
    screens: ['S05'],
    prd: ['ME-15', 'S05'],
    params: CaseParams,
    response: ThesisView,
  }),
  saveDraft: endpoint({
    id: 'thesis.saveDraft',
    method: 'PATCH',
    path: '/me/cases/:caseRef/thesis/draft',
    summary: 'Autosave thesis draft. Editing an AI field flips its origin to ai_edited.',
    screens: ['S05'],
    prd: ['ME-15'],
    ifMatch: true,
    params: CaseParams,
    body: z.object({ fields: ThesisFields.partial() }),
    response: ThesisView,
  }),
  commit: endpoint({
    id: 'thesis.commit',
    method: 'POST',
    path: '/me/cases/:caseRef/thesis/commit',
    summary: 'Commit the draft as an immutable thesis version.',
    screens: ['S05'],
    prd: ['ME-15'],
    auth: 'human',
    idempotent: true,
    params: CaseParams,
    response: ThesisView,
  }),
  addClaim: endpoint({
    id: 'claims.create',
    method: 'POST',
    path: '/me/cases/:caseRef/claims',
    summary: 'Add a claim. Every claim has a kind; evidence claims need at least one source link.',
    screens: ['S05'],
    prd: ['ME-15', 'ME-02'],
    idempotent: true,
    params: CaseParams,
    body: z.object({
      statement: z.string().min(1),
      kind: z.enum(['evidence', 'assumption', 'unknown']),
      sourceIds: z.array(Id),
      assumptionId: Id.nullable(),
    }),
    response: Claim,
  }),
  acceptClaim: endpoint({
    id: 'claims.accept',
    method: 'POST',
    path: '/me/claims/:id/accept',
    summary: 'Accept an AI-draft claim, optionally as an assumption owned by the viewer.',
    screens: ['S05', 'S13'],
    prd: ['ME-15'],
    auth: 'human',
    idempotent: true,
    params: IdParams,
    body: z.object({ as: z.enum(['inference', 'assumption']), editedStatement: z.string().nullable() }),
    response: Claim,
    successStatus: 200,
  }),
  discardClaim: endpoint({
    id: 'claims.discard',
    method: 'POST',
    path: '/me/claims/:id/discard',
    summary: 'Discard a proposed claim. Kept in history.',
    screens: ['S05'],
    prd: ['ME-15'],
    auth: 'human',
    idempotent: true,
    params: IdParams,
    response: Claim,
    successStatus: 200,
  }),
  challengeClaim: endpoint({
    id: 'claims.challenge',
    method: 'POST',
    path: '/me/claims/:id/challenges',
    summary: 'Challenge a claim (required statement). Sent to the claim owner.',
    screens: ['S05'],
    prd: ['ME-15'],
    auth: 'human',
    idempotent: true,
    params: IdParams,
    body: z.object({ statement: z.string().min(1) }),
    response: Challenge,
  }),
};

// ----- Sizing (S06) -----

const SizingDraftPatch = z.object({
  method: z.enum(['aggregate_overlap', 'site_list_union']).optional(),
  horizonYears: z.number().int().positive().optional(),
  boundary: z
    .object({
      marketUnit: z.string(),
      populationUnit: z.enum(['site', 'company', 'customer']),
      currency: CurrencyCode,
      priceYear: PriceYear,
      annualizationMethod: z.string().nullable(),
    })
    .partial()
    .optional(),
  inputs: z
    .array(
      z.object({
        inputKey: z.string(),
        value: DecimalString,
        unit: ValueUnit,
        sourceId: Id.nullable(),
        assumptionId: Id.nullable(),
      }),
    )
    .optional(),
  cohorts: z
    .array(
      z.object({
        id: Id.nullable(),
        name: z.string(),
        rule: z.string(),
        siteCount: z.number().int(),
        sourceId: Id.nullable(),
      }),
    )
    .optional(),
  overlaps: z.array(z.object({ cohortAId: Id, cohortBId: Id, overlapCount: z.number().int() })).optional(),
  crossCheck: z
    .object({
      low: DecimalString,
      high: DecimalString,
      basis: z.string(),
      sourceId: Id.nullable(),
      illustrative: z.boolean(),
      explanation: z.string().nullable(),
    })
    .nullable()
    .optional(),
});

export const sizingEndpoints = {
  get: endpoint({
    id: 'sizing.get',
    method: 'GET',
    path: '/me/cases/:caseRef/sizing',
    summary: 'Measure ladder, cohorts, input ledger and cross-check for current and draft versions.',
    screens: ['S06'],
    prd: ['ME-05'],
    params: CaseParams,
    response: SizingView,
  }),
  saveDraft: endpoint({
    id: 'sizing.saveDraft',
    method: 'PATCH',
    path: '/me/cases/:caseRef/sizing/draft',
    summary: 'Edit the sizing draft (creates the draft from current if absent). Recalculates the draft.',
    screens: ['S06'],
    prd: ['ME-05', 'ME-15'],
    ifMatch: true,
    params: CaseParams,
    body: SizingDraftPatch,
    response: SizingView,
  }),
  calculateDraft: endpoint({
    id: 'sizing.calculateDraft',
    method: 'POST',
    path: '/me/cases/:caseRef/sizing/draft/calculate',
    summary:
      'Run the deterministic sizing engine on the draft. Returns blocking checks; writes the draft result only.',
    screens: ['S06'],
    prd: ['ME-05'],
    params: CaseParams,
    response: SizingOutput,
    successStatus: 200,
  }),
  resolveDuplicateCohort: endpoint({
    id: 'sizing.resolveDuplicateCohort',
    method: 'POST',
    path: '/me/cases/:caseRef/sizing/draft/duplicate-cohorts/resolve',
    summary: 'Keep one of two duplicate cohorts (the other is excluded, not deleted).',
    screens: ['S06'],
    prd: ['ME-05'],
    ifMatch: true,
    params: CaseParams,
    body: z.object({ keepCohortId: Id, excludeCohortId: Id }),
    response: SizingView,
    successStatus: 200,
  }),
  commit: endpoint({
    id: 'sizing.commit',
    method: 'POST',
    path: '/me/cases/:caseRef/sizing/commit',
    summary:
      'Create snapshot vN: commit the draft as an immutable version. Rejected with CALCULATION_BLOCKED when checks fail.',
    screens: ['S06'],
    prd: ['ME-05'],
    auth: 'human',
    idempotent: true,
    params: CaseParams,
    response: SizingVersion,
  }),
  getVersion: endpoint({
    id: 'sizing.getVersion',
    method: 'GET',
    path: '/me/cases/:caseRef/sizing/versions/:version',
    summary: 'A committed sizing version (frozen; never recalculates).',
    screens: ['S06', 'S10'],
    prd: ['ME-05'],
    params: CaseParams.extend({ version: z.coerce.number().int().positive() }),
    response: SizingVersion,
  }),
  compareVersions: endpoint({
    id: 'sizing.compareVersions',
    method: 'GET',
    path: '/me/cases/:caseRef/sizing/compare',
    summary: 'Field-by-field difference between two sizing versions (or a version and the draft).',
    screens: ['S06'],
    prd: ['ME-05'],
    params: CaseParams,
    query: z.object({
      from: z.coerce.number().int().positive(),
      to: z.union([z.coerce.number().int().positive(), z.literal('draft')]),
    }),
    response: z.object({
      changes: z.array(
        z.object({
          inputKey: z.string(),
          label: z.string(),
          from: z.string().nullable(),
          to: z.string().nullable(),
        }),
      ),
    }),
  }),
  population: endpoint({
    id: 'sizing.population',
    method: 'GET',
    path: '/me/cases/:caseRef/sizing/cohorts/:cohortId/population',
    summary:
      'Inspect population. Returns site rows only when policy allows; otherwise aggregates or 403 RESTRICTED_SOURCE without counts.',
    screens: ['S06'],
    prd: ['ME-16'],
    params: CaseParams.extend({ cohortId: Id }),
    query: PageQuery,
    response: z.object({
      restricted: z.boolean(),
      aggregateOnly: z.boolean(),
      dataOwnerName: z.string().nullable(),
      rows: z.array(z.object({ siteId: z.string(), name: z.string(), region: z.string() })),
      nextCursor: z.string().nullable(),
    }),
  }),
};

// ----- Lineage drawer (S06, S08, S10) -----

export const lineageEndpoints = {
  get: endpoint({
    id: 'lineage.get',
    method: 'GET',
    path: '/me/cases/:caseRef/lineage',
    summary:
      'Formula, inputs (one level), used-by and history for a figure. Same data in drafts and frozen versions.',
    screens: ['S06', 'S08', 'S10', 'BRIEF'],
    prd: ['ME-15', 'ME-05', 'ME-07'],
    params: CaseParams,
    query: z.object({
      node: z.string(), // "sizing.sam.value"
      model: z.enum(['sizing', 'economics']),
      version: z.union([z.coerce.number().int().positive(), z.literal('draft')]).optional(),
    }),
    response: z.object({
      node: LineageNode,
      inputs: z.array(LineageNode),
      usedBy: z.array(z.object({ label: z.string(), href: z.string() })),
      history: z.array(z.object({ at: z.string(), text: z.string() })),
      exactValue: z.string().nullable(), // "€40,000,000"
      engineLabel: z.string(), // "Calculated by sizing engine v1.0 · reproducible"
    }),
  }),
};

// ----- Feasibility (S07) -----

export const feasibilityEndpoints = {
  get: endpoint({
    id: 'feasibility.get',
    method: 'GET',
    path: '/me/cases/:caseRef/feasibility',
    summary: 'Readiness table with named reviewers. No readiness score.',
    screens: ['S07'],
    prd: ['ME-06'],
    params: CaseParams,
    response: FeasibilityView,
  }),
  sign: endpoint({
    id: 'feasibility.sign',
    method: 'POST',
    path: '/me/cases/:caseRef/feasibility/:dimension/reviews',
    summary: 'Named reviewer records a scoped position. Human only; the agent cannot sign.',
    screens: ['S07', 'REVIEWS'],
    prd: ['ME-06'],
    auth: 'human',
    idempotent: true,
    params: CaseParams.extend({ dimension: FeasibilityDimension }),
    body: z.object({
      position: ReviewerPosition,
      scopeText: z.string().min(1),
      coversGate: z.enum(['G1', 'G2', 'G3', 'X']).nullable(),
      maxSites: z.number().int().positive().nullable(),
      maxDays: z.number().int().positive().nullable(),
      statement: z.string().nullable(),
      evidenceSourceIds: z.array(Id),
    }),
    response: FeasibilityView,
  }),
  recordDisagreement: endpoint({
    id: 'feasibility.recordDisagreement',
    method: 'POST',
    path: '/me/cases/:caseRef/feasibility/:dimension/disagreements',
    summary: 'Record a signed disagreement; it is carried into G1/G2 packages.',
    screens: ['S07'],
    prd: ['ME-06', 'ME-10'],
    auth: 'human',
    idempotent: true,
    params: CaseParams.extend({ dimension: FeasibilityDimension }),
    body: z.object({ statement: z.string().min(1) }),
    response: FeasibilityView,
  }),
  resolveBlocker: endpoint({
    id: 'feasibility.resolveBlocker',
    method: 'POST',
    path: '/me/blockers/:id/resolution',
    summary:
      'Resolve a blocker with a reason, or restrict scope (which needs an approved gate scope restriction).',
    screens: ['S07'],
    prd: ['ME-06'],
    auth: 'human',
    idempotent: true,
    params: IdParams,
    body: z.object({
      kind: z.enum(['resolved', 'scope_restricted']),
      resolution: z.string().min(1),
      scopeRestrictionGateRequestId: Id.nullable(),
    }),
    response: FeasibilityView,
    successStatus: 200,
  }),
};

// ----- Economics (S08) -----

export const economicsEndpoints = {
  get: endpoint({
    id: 'economics.get',
    method: 'GET',
    path: '/me/cases/:caseRef/economics',
    summary:
      'Drivers, scenario table, recurring vs one-time cards, unavailable cash flow/payback, finance review.',
    screens: ['S08'],
    prd: ['ME-07'],
    params: CaseParams,
    response: EconomicsView,
  }),
  saveDraft: endpoint({
    id: 'economics.saveDraft',
    method: 'PATCH',
    path: '/me/cases/:caseRef/economics/draft',
    summary: 'Edit drivers in draft. The approved snapshot never recalculates.',
    screens: ['S08'],
    prd: ['ME-07', 'ME-15'],
    ifMatch: true,
    params: CaseParams,
    body: z.object({ drivers: z.array(z.object({ inputKey: z.string(), value: DecimalString })) }),
    response: EconomicsView,
  }),
  calculateDraft: endpoint({
    id: 'economics.calculateDraft',
    method: 'POST',
    path: '/me/cases/:caseRef/economics/draft/calculate',
    summary: 'Run the deterministic economics engine on the draft.',
    screens: ['S08'],
    prd: ['ME-07'],
    params: CaseParams,
    response: EconomicsOutput,
    successStatus: 200,
  }),
  whatMustBeTrue: endpoint({
    id: 'economics.whatMustBeTrue',
    method: 'GET',
    path: '/me/cases/:caseRef/economics/what-must-be-true',
    summary: 'Work back from a target contribution after opex to required customers. Pure.',
    screens: ['S08'],
    prd: ['ME-07'],
    params: CaseParams,
    query: z.object({
      targetContributionAfterOpex: DecimalString.default('0'),
      version: z.union([z.coerce.number().int(), z.literal('draft')]).optional(),
    }),
    response: EconomicsOutput.shape.breakEven,
  }),
  commit: endpoint({
    id: 'economics.commit',
    method: 'POST',
    path: '/me/cases/:caseRef/economics/commit',
    summary: 'Create snapshot vN of economics (immutable).',
    screens: ['S08'],
    prd: ['ME-07'],
    auth: 'human',
    idempotent: true,
    params: CaseParams,
    response: EconomicsVersion,
  }),
  requestFinanceReview: endpoint({
    id: 'economics.requestFinanceReview',
    method: 'POST',
    path: '/me/cases/:caseRef/economics/finance-reviews',
    summary: 'Ask the finance partner to review a committed economics version.',
    screens: ['S08'],
    prd: ['ME-07', 'ME-06'],
    idempotent: true,
    params: CaseParams,
    body: z.object({
      economicsVersion: z.number().int().positive(),
      reviewerId: Id,
      dueOn: IsoDate.nullable(),
    }),
    response: ModelReview,
  }),
  signFinanceReview: endpoint({
    id: 'economics.signFinanceReview',
    method: 'POST',
    path: '/me/model-reviews/:id/sign',
    summary: 'Finance sign-off listing items checked and not checked.',
    screens: ['S08', 'REVIEWS'],
    prd: ['ME-07'],
    auth: 'human',
    idempotent: true,
    params: IdParams,
    body: z.object({
      position: ReviewerPosition,
      checkedItems: z.array(z.string()),
      notCheckedItems: z.array(z.string()),
      statement: z.string().nullable(),
    }),
    response: ModelReview,
    successStatus: 200,
  }),
  export: endpoint({
    id: 'economics.export',
    method: 'GET',
    path: '/me/cases/:caseRef/economics/export',
    summary: 'Export with formulas and lineage. Inherits access and licence rules.',
    screens: ['S08'],
    prd: ['ME-07', '§13'],
    params: CaseParams,
    query: z.object({
      format: z.enum(['csv', 'xlsx']),
      version: z.union([z.coerce.number().int(), z.literal('draft')]).optional(),
    }),
    response: z.unknown(), // file download
    successStatus: 200,
  }),
};

// ----- Assumptions and disputes (S09 register; shared primitive) -----

export const assumptionEndpoints = {
  list: endpoint({
    id: 'assumptions.list',
    method: 'GET',
    path: '/me/cases/:caseRef/assumptions',
    summary:
      'Register sorted by decision sensitivity, then evidence quality. Groups: Test first / Test next / Monitor.',
    screens: ['S09', 'S05'],
    prd: ['ME-08'],
    params: CaseParams,
    response: z.object({ items: z.array(Assumption) }),
  }),
  create: endpoint({
    id: 'assumptions.create',
    method: 'POST',
    path: '/me/cases/:caseRef/assumptions',
    summary: 'Add an assumption with owner, value/unit, basis, sensitivity, method and due date.',
    screens: ['S09'],
    prd: ['ME-08'],
    idempotent: true,
    params: CaseParams,
    body: z.object({
      inputKey: z.string(),
      name: z.string().min(1),
      ownerId: Id,
      value: DecimalString.nullable(),
      valueText: z.string().nullable(),
      unit: ValueUnit,
      basis: z.string(),
      sensitivity: Sensitivity,
      decisionCritical: z.boolean(),
      consequenceIfFalse: z.string(),
      validationMethod: z.string(),
      dueOn: IsoDate.nullable(),
    }),
    response: Assumption,
  }),
  update: endpoint({
    id: 'assumptions.update',
    method: 'PATCH',
    path: '/me/assumptions/:id',
    summary:
      'Change value or metadata. A value change creates a new immutable version and runs the materiality check.',
    screens: ['S06', 'S08', 'S09'],
    prd: ['ME-08', 'ME-11', 'ME-15'],
    auth: 'human',
    ifMatch: true,
    params: IdParams,
    body: z.object({
      value: DecimalString.nullable().optional(),
      valueText: z.string().nullable().optional(),
      basis: z.string().optional(),
      changeReason: z.string().min(1),
      sensitivity: Sensitivity.optional(),
      validationMethod: z.string().optional(),
      dueOn: IsoDate.nullable().optional(),
      ownerId: Id.optional(),
    }),
    response: z.object({
      assumption: Assumption,
      staleSnapshotIds: z.array(Id),
      invalidatedApprovalIds: z.array(Id),
    }),
  }),
  versions: endpoint({
    id: 'assumptions.versions',
    method: 'GET',
    path: '/me/assumptions/:id/versions',
    summary: 'All versions of an assumption.',
    screens: ['S09', 'S06'],
    prd: ['ME-08', 'ME-17'],
    params: IdParams,
    response: z.object({ items: z.array(AssumptionVersion) }),
  }),
  retire: endpoint({
    id: 'assumptions.retire',
    method: 'POST',
    path: '/me/assumptions/:id/retire',
    summary: 'Retire with a reason.',
    screens: ['S09'],
    prd: ['ME-08'],
    auth: 'human',
    idempotent: true,
    params: IdParams,
    body: Rationale,
    response: Assumption,
    successStatus: 200,
  }),
  dispute: endpoint({
    id: 'assumptions.dispute',
    method: 'POST',
    path: '/me/assumptions/:id/disputes',
    summary: 'Open a dispute (reviewer dissent) with a proposed value. Stays until resolved with a reason.',
    screens: ['S09', 'S08'],
    prd: ['ME-08', 'ME-15'],
    auth: 'human',
    idempotent: true,
    params: IdParams,
    body: z.object({ statement: z.string().min(1), proposedValueText: z.string().nullable() }),
    response: Challenge,
  }),
  replyToChallenge: endpoint({
    id: 'challenges.reply',
    method: 'POST',
    path: '/me/challenges/:id/replies',
    summary: 'Reply in a dispute or challenge thread.',
    screens: ['S09', 'S05', 'S13'],
    prd: ['ME-15'],
    idempotent: true,
    params: IdParams,
    body: z.object({ body: z.string().min(1) }),
    response: Challenge,
  }),
  resolveChallenge: endpoint({
    id: 'challenges.resolve',
    method: 'POST',
    path: '/me/challenges/:id/resolve',
    summary: 'Resolve with a reason. For disputes, only the disputing reviewer or the sponsor may resolve.',
    screens: ['S09', 'S05', 'S13'],
    prd: ['ME-15'],
    auth: 'human',
    idempotent: true,
    params: IdParams,
    body: z.object({ resolution: z.string().min(1) }),
    response: Challenge,
    successStatus: 200,
  }),
};
