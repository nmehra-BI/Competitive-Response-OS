/**
 * FROZEN versioned analysis models: sizing (S06), feasibility (S07), economics (S08).
 *
 * Pattern (D-011): each model has at most one mutable draft and any number of immutable committed
 * versions ("Create snapshot v3"). Committed versions never recalculate.
 */
import { z } from 'zod';
import {
  BlockerStatus,
  CohortStatus,
  EvidenceQuality,
  FeasibilityDimension,
  GateCode,
  LedgerKind,
  ReviewStatus,
  ReviewerPosition,
  SizingMethod,
  VersionState,
} from '../enums';
import { EconomicsOutput, SizingOutput } from '../engines';
import {
  CurrencyCode,
  DecimalString,
  Id,
  IsoDate,
  IsoDateTime,
  PersonRef,
  PriceYear,
  RowVersion,
} from '../primitives';
import { MarketBoundary } from './case';
import { ValueUnit } from './assumption';
import { SourceChip } from './evidence';

/** One row of the input ledger (research §6.3). */
export const LedgerRow = z.object({
  inputKey: z.string(),
  name: z.string(),
  value: DecimalString,
  unit: ValueUnit,
  currency: CurrencyCode.nullable(),
  kind: LedgerKind,
  basis: z.object({
    source: SourceChip.nullable(),
    owner: PersonRef.nullable(),
    text: z.string().nullable(), // "Test: paid pilot offer", "Dedup run v2"
  }),
  evidenceQuality: EvidenceQuality.nullable(),
  assumptionId: Id.nullable(),
  version: z.number().int().positive(),
  lastChangedAt: IsoDateTime,
  usedByCount: z.number().int().nonnegative(),
  disputed: z.boolean(),
  changedInDraft: z.boolean(),
});
export type LedgerRow = z.infer<typeof LedgerRow>;

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

export const Cohort = z.object({
  id: Id,
  name: z.string(),
  qualifier: z.string().nullable(), // "(v1)", "(imported)"
  rule: z.string(),
  siteCount: z.number().int().nonnegative(),
  source: SourceChip.nullable(),
  status: CohortStatus,
});
export type Cohort = z.infer<typeof Cohort>;

export const CohortOverlap = z.object({
  id: Id,
  cohortAId: Id,
  cohortBId: Id,
  overlapCount: z.number().int(),
  method: z.string(), // "Dedup run v2"
});
export type CohortOverlap = z.infer<typeof CohortOverlap>;

export const DuplicateCohortWarning = z.object({
  cohortAId: Id,
  cohortBId: Id,
  sharedSiteCount: z.number().int().nullable(),
  message: z.string(),
});
export type DuplicateCohortWarning = z.infer<typeof DuplicateCohortWarning>;

export const SizingVersion = z.object({
  id: Id,
  caseId: Id,
  version: z.number().int().positive(),
  state: VersionState,
  method: SizingMethod,
  horizonYears: z.number().int().positive(),
  boundary: MarketBoundary,
  dedupRuleText: z.string(),
  ledger: z.array(LedgerRow),
  cohorts: z.array(Cohort),
  overlaps: z.array(CohortOverlap),
  crossCheck: z
    .object({
      low: DecimalString,
      high: DecimalString,
      basis: z.string(),
      source: SourceChip.nullable(),
      illustrative: z.boolean(),
      explanation: z.string().nullable(),
    })
    .nullable(),
  result: SizingOutput.nullable(), // null for a draft never calculated
  rowVersion: RowVersion,
  committedAt: IsoDateTime.nullable(),
  committedBy: Id.nullable(),
  createdAt: IsoDateTime,
});
export type SizingVersion = z.infer<typeof SizingVersion>;

export const SizingView = z.object({
  current: SizingVersion.nullable(),
  draft: SizingVersion.nullable(),
  duplicateCohorts: z.array(DuplicateCohortWarning),
  /** True when the viewer sees only aggregates under policy (S06 restricted state). */
  siteListRestricted: z.boolean(),
  siteListDataOwner: PersonRef.nullable(),
  versions: z.array(z.object({ id: Id, version: z.number().int(), committedAt: IsoDateTime.nullable() })),
});
export type SizingView = z.infer<typeof SizingView>;

// ---------------------------------------------------------------------------
// Feasibility
// ---------------------------------------------------------------------------

/** Structured scope of a sign-off, so G3 can see "Pilot review does not cover scale". */
export const SignOffScope = z.object({
  text: z.string(), // "Signed for pilot only: up to 4 sites, 90 days"
  coversGate: GateCode.nullable(),
  maxSites: z.number().int().nullable(),
  maxDays: z.number().int().nullable(),
});
export type SignOffScope = z.infer<typeof SignOffScope>;

export const FeasibilityReview = z.object({
  id: Id,
  assessmentId: Id,
  version: z.number().int().positive(),
  position: ReviewerPosition,
  scope: SignOffScope,
  statement: z.string().nullable(),
  evidenceSourceIds: z.array(Id),
  signedBy: PersonRef, // always a human; never the agent
  signedAt: IsoDateTime,
});
export type FeasibilityReview = z.infer<typeof FeasibilityReview>;

export const FeasibilityBlocker = z.object({
  id: Id,
  assessmentId: Id.nullable(),
  text: z.string(), // "Blocks G2 until signed"
  blocksGate: GateCode,
  status: BlockerStatus,
  resolution: z.string().nullable(),
  resolvedBy: PersonRef.nullable(),
  scopeRestrictionGateRequestId: Id.nullable(),
});
export type FeasibilityBlocker = z.infer<typeof FeasibilityBlocker>;

export const FeasibilityAssessment = z.object({
  id: Id,
  caseId: Id,
  dimension: FeasibilityDimension,
  question: z.string(),
  /** Full question text where `question` is the short label (S07 specialist section). Additive (D-068). */
  questionDetail: z.string().nullable().optional(),
  evidenceText: z.string(),
  reviewer: PersonRef,
  status: ReviewStatus,
  scopeText: z.string(), // shown in the "Status · scope of sign-off" column
  dueOn: IsoDate.nullable(),
  humanOnly: z.boolean(), // specialist review: "AI cannot provide this review"
  currentReview: FeasibilityReview.nullable(),
  blockers: z.array(FeasibilityBlocker),
  disagreements: z.array(
    z.object({ id: Id, author: PersonRef, statement: z.string(), createdAt: IsoDateTime }),
  ),
});
export type FeasibilityAssessment = z.infer<typeof FeasibilityAssessment>;

export const FeasibilityView = z.object({
  rows: z.array(FeasibilityAssessment),
  counts: z.object({
    signed: z.number().int(),
    inReview: z.number().int(),
    pending: z.number().int(),
    blockers: z.number().int(),
  }),
  competitors: z.array(
    z.object({ id: Id, text: z.string(), source: SourceChip.nullable(), unknown: z.boolean() }),
  ),
});
export type FeasibilityView = z.infer<typeof FeasibilityView>;

// ---------------------------------------------------------------------------
// Economics
// ---------------------------------------------------------------------------

export const EconomicsDriverKey = z.enum([
  'annual_price',
  'adoption_rate.downside',
  'adoption_rate.base',
  'adoption_rate.upside',
  'gross_margin',
  'annual_incremental_opex',
  'capacity',
  'one_time_investment',
  'reachable_pool',
]);
export type EconomicsDriverKey = z.infer<typeof EconomicsDriverKey>;

export const EconomicsVersion = z.object({
  id: Id,
  caseId: Id,
  version: z.number().int().positive(),
  state: VersionState,
  sizingVersionId: Id,
  currency: CurrencyCode,
  priceYear: PriceYear,
  horizonYears: z.number().int().positive(),
  drivers: z.array(LedgerRow), // inputKey ∈ EconomicsDriverKey
  result: EconomicsOutput.nullable(),
  rowVersion: RowVersion,
  committedAt: IsoDateTime.nullable(),
  committedBy: Id.nullable(),
  createdAt: IsoDateTime,
});
export type EconomicsVersion = z.infer<typeof EconomicsVersion>;

/** A finance (or other model) review: what was checked and what was not (research §4.6). */
export const ModelReview = z.object({
  id: Id,
  modelType: z.enum(['economics', 'sizing']),
  modelVersionId: Id,
  reviewer: PersonRef,
  requestedAt: IsoDateTime,
  dueOn: IsoDate.nullable(),
  checkedItems: z.array(z.string()),
  notCheckedItems: z.array(z.string()),
  position: ReviewerPosition,
  statement: z.string().nullable(),
  signedAt: IsoDateTime.nullable(),
});
export type ModelReview = z.infer<typeof ModelReview>;

export const EconomicsView = z.object({
  current: EconomicsVersion.nullable(),
  draft: EconomicsVersion.nullable(),
  financeReview: ModelReview.nullable(),
  recommendationIncomplete: z.boolean(),
  incompleteReasons: z.array(z.string()),
  versions: z.array(z.object({ id: Id, version: z.number().int(), committedAt: IsoDateTime.nullable() })),
});
export type EconomicsView = z.infer<typeof EconomicsView>;
