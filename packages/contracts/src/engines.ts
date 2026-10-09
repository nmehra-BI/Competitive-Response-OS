/**
 * FROZEN input/output contracts for the deterministic engines (PRD ME-05, ME-07, §6).
 *
 * The same input always yields the same output and the same `inputHash` (canonical JSON, D-012).
 * Engines never sum measures with different time bases. Missing inputs produce `Unavailable`,
 * never zero. Display rounding happens in the UI, never in engines.
 */
import { z } from 'zod';
import { CrossCheckResult, LedgerKind, MarketMeasure, PopulationUnit, Scenario, SizingMethod } from './enums';
import { ValueUnit } from './entities/assumption';
import {
  CountryCode,
  CurrencyCode,
  DecimalString,
  Id,
  Money,
  PriceYear,
  RateString,
  Sha256Hex,
  Unavailable,
} from './primitives';

/** A single typed engine input with its lineage reference. */
export const EngineInput = z.object({
  inputKey: z.string(), // "tam_site_count", "annual_spend_per_site", "adoption_rate.base", ...
  label: z.string(),
  value: DecimalString,
  unit: ValueUnit,
  kind: LedgerKind,
  currency: CurrencyCode.nullable().default(null),
  priceYear: PriceYear.nullable().default(null),
  ref: z.object({
    type: z.enum(['assumption_version', 'source', 'cohort', 'calculation']),
    id: Id,
    version: z.number().int().positive().nullable().default(null),
  }),
});
export type EngineInput = z.infer<typeof EngineInput>;

export const CalcCheck = z.object({
  key: z.enum([
    'CURRENCY_MISMATCH',
    'PRICE_YEAR_MISMATCH',
    'UNIT_MISMATCH',
    'OVERLAP_NEGATIVE',
    'OVERLAP_EXCEEDS_SMALLER_COHORT',
    'SAM_EXCEEDS_TAM',
    'REACHABLE_EXCEEDS_SAM',
    'RATE_OUT_OF_RANGE',
    'CAPACITY_NEGATIVE',
    'DUPLICATE_COHORT',
    'TOO_MANY_COHORTS_FOR_AGGREGATE_METHOD',
    'MISSING_INPUT',
    'ANNUALIZATION_METHOD_MISSING',
    'CROSS_CHECK_OUTSIDE_RANGE',
    'CAPACITY_CAP_APPLIED',
  ]),
  blocking: z.boolean(),
  message: z.string(),
  inputKeys: z.array(z.string()),
});
export type CalcCheck = z.infer<typeof CalcCheck>;

/** One node of the formula-and-lineage graph ("Trace precedents", research §6.3). */
export const LineageNode = z.object({
  nodeKey: z.string(), // "sizing.sam.value"
  label: z.string(), // "SAM"
  kind: z.enum(['evidence', 'assumption', 'calculated', 'scenario']),
  value: DecimalString.nullable(),
  unit: ValueUnit,
  formulaText: z.string().nullable(), // "(Size-qualified + Process-qualified − Overlap) × Annual spend per site"
  formulaWithValues: z.string().nullable(), // "(1,400 + 1,100 − 500) × €20,000 = €40,000,000/year"
  inputs: z.array(z.string()), // nodeKeys, one level
  dependsOnAssumptionCount: z.number().int().nonnegative(),
  ref: EngineInput.shape.ref.nullable(),
});
export type LineageNode = z.infer<typeof LineageNode>;

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

export const SizingCohortInput = z.object({
  cohortId: Id,
  name: z.string(),
  rule: z.string(),
  siteCount: z.number().int().nonnegative(),
  populationUnit: PopulationUnit,
  priceYear: PriceYear,
  status: z.enum(['active', 'duplicate_candidate', 'excluded']),
  /** Present only for the site_list_union method and only when the caller may see site IDs. */
  siteIds: z.array(z.string()).optional(),
  ref: EngineInput.shape.ref,
});
export type SizingCohortInput = z.infer<typeof SizingCohortInput>;

export const SizingInput = z.object({
  boundary: z.object({
    marketUnit: z.string(),
    populationUnit: PopulationUnit,
    countryCode: CountryCode,
    segmentLabel: z.string(),
    currency: CurrencyCode,
    priceYear: PriceYear,
    annualizationMethod: z.string().nullable(),
    includesOneTimeSpend: z.boolean(),
  }),
  method: SizingMethod,
  horizonYears: z.number().int().positive(),
  tamPopulation: EngineInput,
  annualSpendPerUnit: EngineInput,
  cohorts: z.array(SizingCohortInput),
  overlaps: z.array(
    z.object({ cohortAId: Id, cohortBId: Id, overlapCount: z.number().int(), ref: EngineInput.shape.ref }),
  ),
  reachablePool: EngineInput,
  adoption: z.object({
    downside: EngineInput.nullable(),
    base: EngineInput,
    upside: EngineInput.nullable(),
  }),
  capacity: EngineInput,
  crossCheck: z
    .object({
      measure: z.literal('sam'),
      low: DecimalString,
      high: DecimalString,
      currency: CurrencyCode,
      priceYear: PriceYear,
      illustrative: z.boolean(),
    })
    .nullable(),
});
export type SizingInput = z.infer<typeof SizingInput>;

export const SomScenarioOutput = z.object({
  scenario: Scenario,
  uncappedCustomers: z.number().int().nonnegative(),
  customers: z.number().int().nonnegative(),
  capped: z.boolean(),
  annualRevenue: Money, // measure annual_revenue · end of horizon
});
export type SomScenarioOutput = z.infer<typeof SomScenarioOutput>;

export const SizingOutput = z.object({
  engine: z.literal('sizing'),
  engineVersion: z.string(),
  inputHash: Sha256Hex,
  blocked: z.boolean(),
  checks: z.array(CalcCheck),
  ladder: z.object({
    tam: z.object({
      population: z.number().int(),
      value: Money,
      /** D-081 (CR-WS4a-1, additive): false on a redacted blocked result; absent means computed. */
      available: z.boolean().optional(),
    }),
    sam: z.object({
      population: z.number().int(),
      value: Money,
      cohortSum: z.number().int(),
      overlapRemoved: z.number().int(),
      /**
       * D-033 (CR-WS2-1, additive): false when SAM could not be computed (wrong cohort count, missing
       * overlap or site IDs). Then population/value/cohortSum/overlapRemoved are placeholders, never
       * a zero to display: show "Not available" with the blocking check. Absent means computed.
       */
      available: z.boolean().optional(),
    }),
    reachablePool: z.object({
      population: z.number().int(), // a site count, never money
      /** D-081 (CR-WS4a-1, additive): false on a redacted blocked result; absent means computed. */
      available: z.boolean().optional(),
    }),
    som: z.array(SomScenarioOutput),
  }),
  crossCheck: z.object({ result: CrossCheckResult, message: z.string() }),
  lineage: z.array(LineageNode),
});
export type SizingOutput = z.infer<typeof SizingOutput>;

// ---------------------------------------------------------------------------
// Economics
// ---------------------------------------------------------------------------

export const EconomicsInput = z.object({
  currency: CurrencyCode,
  priceYear: PriceYear,
  horizonYears: z.number().int().positive(),
  reachablePool: EngineInput,
  capacity: EngineInput,
  annualPricePerCustomer: EngineInput,
  grossMargin: EngineInput, // rate
  annualIncrementalOpex: EngineInput, // sales and admin only; COGS is inside gross margin
  oneTimeInvestment: EngineInput.nullable(),
  adoption: z.object({
    downside: EngineInput.nullable(),
    base: EngineInput,
    upside: EngineInput.nullable(),
  }),
  /** Cash-flow inputs. Cash flow and payback stay Unavailable until all are present (PRD §6). */
  cashFlowInputs: z.object({
    acquisitionRamp: EngineInput.nullable(),
    retention: EngineInput.nullable(),
    cashTiming: EngineInput.nullable(),
    partnerMargin: EngineInput.nullable(),
    fxAndBaseYearPolicy: EngineInput.nullable(),
  }),
});
export type EconomicsInput = z.infer<typeof EconomicsInput>;

export const EconomicsScenarioOutput = z.object({
  scenario: Scenario,
  adoption: RateString,
  uncappedCustomers: z.number().int().nonnegative(),
  customers: z.number().int().nonnegative(),
  capped: z.boolean(),
  annualRevenue: Money,
  grossContribution: Money,
  annualIncrementalOpex: Money,
  contributionAfterOpex: Money, // may be zero (true break-even) or negative
  whatChangesVsBase: z.array(z.string()),
});
export type EconomicsScenarioOutput = z.infer<typeof EconomicsScenarioOutput>;

export const EconomicsOutput = z.object({
  engine: z.literal('economics'),
  engineVersion: z.string(),
  inputHash: Sha256Hex,
  blocked: z.boolean(),
  checks: z.array(CalcCheck),
  scenarios: z.array(EconomicsScenarioOutput), // fixed order downside, base, upside
  oneTimeInvestment: z.union([Money, Unavailable]), // never summed with any per-year value
  cashFlow: Unavailable,
  payback: Unavailable,
  breakEven: z.object({
    targetContributionAfterOpex: DecimalString,
    customers: z.number().int().nullable(),
    formulaText: z.string(), // "customers = opex ÷ (price × margin)"
  }),
  exclusionsText: z.string(),
  lineage: z.array(LineageNode),
});
export type EconomicsOutput = z.infer<typeof EconomicsOutput>;

export const LadderMeasureKey = MarketMeasure;
