/**
 * FROZEN case envelope (shared WorkflowCase), mandate, opportunity and comparison (app-specific).
 */
import { z } from 'zod';
import {
  AppType,
  CaseStage,
  EvidenceFreshness,
  EvidenceQuality,
  FitResult,
  GateCode,
  GateStatus,
  OpportunityOrigin,
  OpportunityStatus,
  PopulationUnit,
  RailSegment,
  VersionState,
} from '../enums';
import { Blocker } from '../errors';
import {
  CountryCode,
  CurrencyCode,
  DecimalString,
  DisplayKey,
  Id,
  IsoDateTime,
  PersonRef,
  PriceYear,
  RowVersion,
} from '../primitives';
import { SourceChip } from './evidence';

// ---------------------------------------------------------------------------
// Shared envelope
// ---------------------------------------------------------------------------

export const WorkflowCase = z.object({
  id: Id,
  key: DisplayKey, // ME-104
  appType: AppType,
  title: z.string(), // "German food-processing plants — monitoring"
  businessUnitId: Id,
  mandateId: Id,
  owner: PersonRef,
  sponsor: PersonRef,
  stage: CaseStage,
  heldFromStage: CaseStage.nullable(),
  originType: z.enum(['opportunity', 'direct', 'handoff']),
  originId: Id.nullable(),
  rowVersion: RowVersion,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkflowCase = z.infer<typeof WorkflowCase>;

/** One node on the gate rail (research §6.11). */
export const GateRailNode = z.object({
  gateCode: GateCode,
  status: GateStatus,
  caption: z.string(), // "Pilot €120k · 90 days · 27 Nov"
  preconditionsMet: z.number().int().nullable(),
  preconditionsTotal: z.number().int().nullable(),
  gateRequestId: Id.nullable(),
});
export type GateRailNode = z.infer<typeof GateRailNode>;

/** "Next decision" block in the case header. */
export const NextDecision = z.object({
  title: z.string(), // "G2 · Approve pilot €120k · 90 days"
  subtitle: z.string(), // "Elena Fischer · due today, 27 Nov"
  decider: PersonRef.nullable(),
  gateCode: GateCode.nullable(),
  blocked: z.boolean(),
  why: z.array(Blocker), // preconditions behind "Why?"
  primaryAction: z.object({ label: z.string(), href: z.string() }).nullable(),
});
export type NextDecision = z.infer<typeof NextDecision>;

export const FreshnessSummary = z.object({
  lastCheckedAt: IsoDateTime.nullable(),
  label: z.string(), // "Evidence checked 2 days ago · 1 source ageing"
  worst: EvidenceFreshness,
  staleCount: z.number().int(),
  ageingCount: z.number().int(),
});
export type FreshnessSummary = z.infer<typeof FreshnessSummary>;

/** Everything the persistent case header needs, in one call. */
export const CaseHeader = z.object({
  case: WorkflowCase,
  mandateLabel: z.string(), // "Mandate · BU Water · Growth 2027"
  marketLabel: z.string(), // "Germany · food processing"
  currencyLabel: z.string(), // "EUR · 2026 prices"
  currentSegment: RailSegment,
  rail: z.array(GateRailNode),
  nextDecision: NextDecision,
  freshness: FreshnessSummary,
  tabCounts: z.record(z.string(), z.string()), // { Feasibility: "1 pending", Validation: "1 disputed" }
  illustrative: z.boolean(),
});
export type CaseHeader = z.infer<typeof CaseHeader>;

export const CaseListRow = z.object({
  id: Id,
  key: DisplayKey,
  title: z.string(),
  marketLabel: z.string(),
  owner: PersonRef,
  stage: CaseStage,
  nextGate: GateRailNode.nullable(),
  blockersLabel: z.string(), // "1 dissent recorded", "None", "—"
  freshness: EvidenceFreshness,
  freshnessDetail: z.string(),
  latestUpdate: z.string(),
  latestUpdateAt: IsoDateTime,
});
export type CaseListRow = z.infer<typeof CaseListRow>;

// ---------------------------------------------------------------------------
// Mandate (S02)
// ---------------------------------------------------------------------------

export const MandateStatus = z.enum(['draft', 'awaiting_decision', 'returned', 'approved', 'superseded']);
export type MandateStatus = z.infer<typeof MandateStatus>;

export const MandateFields = z.object({
  objective: z.string().min(1),
  productId: Id,
  segmentIds: z.array(Id).min(1),
  geographyCodes: z.array(CountryCode).min(1),
  exclusions: z.array(z.string()),
  horizonYears: z.number().int().min(1).max(10),
  pilotDurationDays: z.number().int().positive().nullable(),
  investmentCeiling: DecimalString.nullable(), // pilot spend ceiling
  currency: CurrencyCode, // required; never free text (S02 validation)
  evidenceSourceKinds: z.array(z.enum(['licensed_market_data', 'authorized_uploads', 'crm_accounts'])),
  ownerId: Id, // accountable owner (required)
  sponsorId: Id,
  successDefinition: z.string().min(1),
});
export type MandateFields = z.infer<typeof MandateFields>;

/** Draft fields are partial so autosave can store incomplete work. Submit validates MandateFields. */
export const MandateDraftFields = MandateFields.partial();
export type MandateDraftFields = z.infer<typeof MandateDraftFields>;

export const MandateVersion = z.object({
  id: Id,
  mandateId: Id,
  version: z.number().int().positive(),
  state: VersionState,
  fields: MandateDraftFields,
  committedAt: IsoDateTime.nullable(),
  rowVersion: RowVersion,
  createdBy: Id,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MandateVersion = z.infer<typeof MandateVersion>;

export const Mandate = z.object({
  id: Id,
  key: DisplayKey, // MD-21
  businessUnitId: Id,
  title: z.string(),
  status: MandateStatus,
  currentVersion: MandateVersion.nullable(), // last committed
  draftVersion: MandateVersion.nullable(),
  g0GateRequestId: Id.nullable(),
  scopePreview: z.string(), // live sentence (S02 right column)
  validationErrors: z.array(z.object({ field: z.string(), message: z.string() })),
});
export type Mandate = z.infer<typeof Mandate>;

// ---------------------------------------------------------------------------
// Opportunity (S03)
// ---------------------------------------------------------------------------

export const MarketBoundary = z.object({
  id: Id,
  marketUnit: z.string(), // "annual spend on water monitoring"
  populationUnit: PopulationUnit,
  countryCode: CountryCode,
  segmentLabel: z.string(),
  productBoundary: z.string(),
  currency: CurrencyCode,
  priceYear: PriceYear,
  includes: z.object({
    hardware: z.boolean(),
    software: z.boolean(),
    services: z.boolean(),
    replacementCycles: z.boolean(),
  }),
  annualizationMethod: z.string().nullable(), // required when one-time spend is annualized
});
export type MarketBoundary = z.infer<typeof MarketBoundary>;

export const Opportunity = z.object({
  id: Id,
  key: DisplayKey, // OPP-07
  mandateId: Id,
  name: z.string(),
  trigger: z.string(),
  fitRationale: z.string(),
  origin: OpportunityOrigin,
  agentRunId: Id.nullable(),
  status: OpportunityStatus,
  dismissReason: z.string().nullable(),
  duplicateOfId: Id.nullable(),
  likelyDuplicateOfId: Id.nullable(), // proposed by dedup; operator decides
  convertedCaseId: Id.nullable(),
  evidenceQuality: EvidenceQuality,
  sourceCount: z.number().int(),
  unknownCount: z.number().int(),
  lastCheckedAt: IsoDateTime.nullable(),
  fitCriteria: z.array(z.object({ criterion: z.string(), result: FitResult, note: z.string().nullable() })),
  unknowns: z.array(z.string()),
  sources: z.array(SourceChip),
  boundary: MarketBoundary.nullable(),
  createdAt: IsoDateTime,
  createdBy: Id,
});
export type Opportunity = z.infer<typeof Opportunity>;

// ---------------------------------------------------------------------------
// Comparison (S04)
// ---------------------------------------------------------------------------

export const ComparisonAttribute = z.enum([
  'market_boundary',
  'tam',
  'sam',
  'growth_evidence',
  'product_fit',
  'channel_access',
  'evidence_coverage',
  'investment_need',
  'readiness_blockers',
  'unknowns',
]);
export type ComparisonAttribute = z.infer<typeof ComparisonAttribute>;

/** Ratings are named reviewers' assessments 1–3, not computed confidence. Null = Unknown, never 0. */
export const ComparisonCell = z.object({
  opportunityId: Id,
  attribute: ComparisonAttribute,
  rating: z.number().int().min(1).max(3).nullable(),
  ratingLabel: z.enum(['High', 'Medium', 'Low']).nullable(),
  valueText: z.string().nullable(),
  detailText: z.string().nullable(),
  unknown: z.boolean(),
  incomparable: z.boolean(),
  sources: z.array(SourceChip),
});
export type ComparisonCell = z.infer<typeof ComparisonCell>;

export const RankingWeights = z.object({
  version: z.number().int().positive(),
  productFit: z.number().int().min(0).max(100),
  channelAccess: z.number().int().min(0).max(100),
  evidenceCoverage: z.number().int().min(0).max(100),
});
export type RankingWeights = z.infer<typeof RankingWeights>;

export const RankingRow = z.object({
  opportunityId: Id,
  ranked: z.boolean(),
  score: DecimalString.nullable(),
  reason: z.string().nullable(), // "Not ranked — 2 inputs missing", "Excluded until normalized"
});
export type RankingRow = z.infer<typeof RankingRow>;

export const Comparison = z.object({
  id: Id,
  mandateId: Id,
  opportunityIds: z.array(Id).min(2).max(4),
  commonUnitLabel: z.string(),
  cells: z.array(ComparisonCell),
  excludedOpportunityIds: z.array(Id),
  incomparableWarnings: z.array(z.object({ opportunityId: Id, message: z.string() })),
  weights: RankingWeights,
  weightsHistory: z.array(RankingWeights),
  ranking: z.array(RankingRow),
  formulaText: z.string(),
  selectedOpportunityId: Id.nullable(),
});
export type Comparison = z.infer<typeof Comparison>;
