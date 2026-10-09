/**
 * FROZEN assumption register (shared primitive) and thesis (app-specific). PRD ME-08, ME-15, S05, S09.
 */
import { z } from 'zod';
import {
  AssumptionStatus,
  EvidenceQuality,
  FieldOrigin,
  RegisterGroup,
  Scenario,
  Sensitivity,
  ThesisBlockerStatus,
  VersionState,
} from '../enums';
import {
  CurrencyCode,
  DecimalString,
  DisplayKey,
  Id,
  IsoDate,
  IsoDateTime,
  PersonRef,
  PriceYear,
  ProvenancedText,
  RowVersion,
} from '../primitives';
import { Challenge, Claim, SourceChip } from './evidence';

/** Units the engines understand. Units are checked; mixing them blocks calculation. */
export const ValueUnit = z.enum([
  'sites',
  'companies',
  'customers',
  'rate', // fraction in [0,1]
  'currency_per_year_per_site',
  'currency_per_year',
  'currency_one_time',
  'interviews',
  'commitments',
  'hours_per_site',
  'text',
]);
export type ValueUnit = z.infer<typeof ValueUnit>;

export const AssumptionVersion = z.object({
  id: Id,
  assumptionId: Id,
  version: z.number().int().positive(),
  value: DecimalString.nullable(),
  valueText: z.string().nullable(),
  unit: ValueUnit,
  currency: CurrencyCode.nullable(),
  priceYear: PriceYear.nullable(),
  basis: z.string(), // "Test: paid pilot offer · buyer interviews"
  evidenceQuality: EvidenceQuality,
  sources: z.array(SourceChip),
  origin: FieldOrigin,
  agentRunId: Id.nullable(),
  changeReason: z.string().nullable(),
  createdBy: PersonRef,
  createdAt: IsoDateTime,
});
export type AssumptionVersion = z.infer<typeof AssumptionVersion>;

/** One register row. `key` is the input key engines reference, e.g. "adoption_rate.base". */
export const Assumption = z.object({
  id: Id,
  key: DisplayKey, // ASM-xx
  caseId: Id,
  inputKey: z.string(),
  name: z.string(), // "Adoption 20% by year 3"
  scenario: Scenario.nullable(),
  owner: PersonRef,
  sensitivity: Sensitivity,
  decisionCritical: z.boolean(), // drives materiality
  consequenceIfFalse: z.string(),
  validationMethod: z.string(),
  linkedExperimentIds: z.array(Id),
  dueOn: IsoDate.nullable(),
  status: AssumptionStatus,
  statusDetail: z.string().nullable(), // "Supported · 4 paid commitments"
  retiredReason: z.string().nullable(),
  current: AssumptionVersion,
  registerGroup: RegisterGroup,
  openDispute: Challenge.nullable(),
  usedBy: z.array(z.object({ label: z.string(), href: z.string() })),
  rowVersion: RowVersion,
});
export type Assumption = z.infer<typeof Assumption>;

/** Reasons to win are tied to the core product, not to market size. */
export const ReasonToWin = z.object({
  id: Id,
  text: ProvenancedText,
  linkedAssumptionId: Id.nullable(),
  linkedFeasibilityDimension: z.string().nullable(),
  statusText: z.string().nullable(), // "Pending · demo with Priya Shah"
});
export type ReasonToWin = z.infer<typeof ReasonToWin>;

/** Alternatives always include "No entry" (research §3). */
export const Alternative = z.object({
  id: Id,
  name: z.string(),
  meaning: z.string(),
  status: z.enum(['recommended', 'considered_fallback', 'considered_not_preferred', 'not_ranked']),
  statusText: z.string(),
  isNoEntry: z.boolean(),
});
export type Alternative = z.infer<typeof Alternative>;

export const ThesisFields = z.object({
  proposition: ProvenancedText,
  intendedCustomer: ProvenancedText,
  whyNow: ProvenancedText,
  reasonsToWin: z.array(ReasonToWin),
  alternatives: z.array(Alternative),
  recommendation: ProvenancedText.nullable(),
  recommendationBy: Id.nullable(),
  claimIds: z.array(Id),
});
export type ThesisFields = z.infer<typeof ThesisFields>;

export const ThesisVersion = z.object({
  id: Id,
  caseId: Id,
  version: z.number().int().positive(),
  state: VersionState,
  fields: ThesisFields,
  rowVersion: RowVersion,
  committedAt: IsoDateTime.nullable(),
  reviewerAcceptedBy: Id.nullable(), // first reviewer-accepted thesis ends "mandate-to-thesis" (PRD §17)
  createdAt: IsoDateTime,
});
export type ThesisVersion = z.infer<typeof ThesisVersion>;

export const ThesisView = z.object({
  current: ThesisVersion.nullable(),
  draft: ThesisVersion.nullable(),
  claims: z.array(Claim),
  criticalAssumptions: z.array(Assumption), // top 5 from the register
  disagreements: z.array(Challenge),
  blockers: z.array(
    z.object({
      id: Id,
      text: z.string(),
      owner: PersonRef,
      dueOn: IsoDate.nullable(),
      gate: z.string(),
      /** Additive (D-068); absent → the S05 rule (blocks the next gate → Pending, a later one → Blocker). */
      status: ThesisBlockerStatus.optional(),
    }),
  ),
  reviewers: z.array(z.object({ person: PersonRef, area: z.string(), status: z.string() })),
});
export type ThesisView = z.infer<typeof ThesisView>;
