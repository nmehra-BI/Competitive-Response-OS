/**
 * GOLDEN expected outputs (release gate "calculations verified against fixtures", PRD §10).
 * Exact decimal strings. The engines in packages/domain must reproduce these from
 * sizingV2Input / economicsV2Input byte for byte (as decimal values).
 */
export const expectedSizing = {
  tam: { population: 5000, value: '100000000.00' }, // 5,000 × €20,000 = €100m/year
  sam: { cohortSum: 2500, overlapRemoved: 500, population: 2000, value: '40000000.00' }, // (1,400 + 1,100 − 500) × €20,000
  reachablePool: { population: 500 }, // a site count, not money
  som: {
    downside: { uncappedCustomers: 50, customers: 50, capped: false, annualRevenue: '1000000.00' },
    base: { uncappedCustomers: 100, customers: 100, capped: false, annualRevenue: '2000000.00' }, // €2m annual revenue at end of year 3
    upside: { uncappedCustomers: 150, customers: 120, capped: true, annualRevenue: '2400000.00' },
  },
  blockingChecks: [] as string[],
} as const;

export const expectedEconomics = {
  downside: {
    customers: 50,
    annualRevenue: '1000000.00',
    grossContribution: '600000.00',
    annualIncrementalOpex: '600000.00',
    contributionAfterOpex: '0.00',
  },
  base: {
    customers: 100,
    annualRevenue: '2000000.00',
    grossContribution: '1200000.00',
    annualIncrementalOpex: '600000.00',
    contributionAfterOpex: '600000.00',
  },
  upside: {
    customers: 120,
    capped: true,
    annualRevenue: '2400000.00',
    grossContribution: '1440000.00',
    annualIncrementalOpex: '600000.00',
    contributionAfterOpex: '840000.00',
  },
  oneTimeInvestment: '400000.00', // separate; never summed with any /year value
  breakEvenCustomers: 50, // ceil(600,000 ÷ (20,000 × 0.60))
  cashFlowAvailable: false,
  paybackAvailable: false,
} as const;

/** Display strings the UI must render for these values (research §6.5, §10.5). */
export const expectedDisplay = {
  tam: '€100m/year',
  sam: '€40m/year',
  reachablePool: '500 unique sites',
  somBase: '€2.0m annual revenue',
  scenarioRevenue: ['€1.0m', '€2.0m', '€2.4m'],
  scenarioGross: ['€0.60m', '€1.20m', '€1.44m'],
  scenarioOpex: ['€600k', '€600k', '€600k'],
  scenarioAfterOpex: ['€0k (break-even)', '€600k', '€840k'],
  oneTime: '€400k one-time',
  pilotButton: 'Approve pilot €120k · 90 days',
  validationButton: 'Approve validation €15k',
  overlapRow: '−500',
} as const;

/** Variant checks the sizing engine must block (S06 alternate paths). */
export const expectedBlocking = {
  samExceedsTam: 'SAM_EXCEEDS_TAM', // TAM site count edited to 500
  negativeOverlap: 'OVERLAP_NEGATIVE',
  overlapAboveSmaller: 'OVERLAP_EXCEEDS_SMALLER_COHORT', // overlap 1,200 > 1,100
  mixedUnits: 'UNIT_MISMATCH', // a cohort counted in companies
  mixedYears: 'PRICE_YEAR_MISMATCH', // a cohort from 2024
  currencyMismatch: 'CURRENCY_MISMATCH',
  reachableExceedsSam: 'REACHABLE_EXCEEDS_SAM', // D-117: reachable pool edited above SAM sites
} as const;

/**
 * D-117 (PQ-18): the reachable pool stays an entered number and is checked against SAM (≤ SAM sites).
 * SAM's lineage drawer lists the check as a "checked against" edge; a breach blocks like SAM > TAM.
 */
export const expectedLineage = {
  samUsedBy: [
    {
      label: 'Reachable pool',
      relation: 'checked_against',
      detail: 'upper-bound check: 500 ≤ 2,000 sites',
    },
  ],
} as const;

/** D-110 / D-109: the X rule applied to the €120k · 90-day G2 (one-time pilot money only). */
export const expectedExtension = {
  maxAmount: '30000.00', // 25% of €120k
  maxDurationDays: 45, // 50% of 90 days (≥ 14)
  extensionsAllowed: 1,
  cumulativeCeiling: '150000.00', // Elena's G2 ceiling: €120k + €30k
  limitsText: 'Up to €30k (25% of €120k) · up to 45 days',
  buttonLabel: 'Approve extension €30k · 45 days',
} as const;

/**
 * D-111 / D-039: the four G3 blockers, in order. The fourth names the committed one-time investment;
 * it is never next to a /year figure and is omitted when the viewer cannot read the committed economics.
 */
export const expectedScaleGate = {
  blockerKeys: [
    'pilot_actuals_vs_thresholds',
    'readiness_reassessment',
    'updated_economics_and_capacity',
    'approved_scale_budget',
  ],
  scaleBudgetBlocker:
    'No scale budget requested · economics v2 carries €400k one-time scale-entry investment',
} as const;

/** D-109 §3: G3 quorum on one snapshot hash. */
export const expectedCommittee = {
  quorum: 2,
  requiredSeats: ['finance'],
  waitingText: 'Waiting on second approver · finance seat',
  authorityGapText: 'Committee named · G3 authority not granted',
} as const;
