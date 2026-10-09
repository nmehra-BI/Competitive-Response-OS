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
} as const;
