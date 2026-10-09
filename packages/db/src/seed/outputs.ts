/**
 * Engine outputs for the demo's committed sizing v2 and economics v2.
 *
 * The real deterministic engines (packages/domain, WS2) are used when they are implemented. Until
 * then the seed builds the output from the fixture's GOLDEN expectations (fixtures/aster
 * expected.ts — the values the engines must reproduce) and marks engine_version with
 * "+aster-golden", so the row never claims to come from an engine that did not run.
 */
import {
  EconomicsOutput,
  SizingOutput,
  type EconomicsInput,
  type LineageNode,
  type Money,
  type MoneyMeasure,
  type SizingInput,
} from '@growth-os/contracts';
import {
  createEconomicsEngine,
  createSizingEngine,
  ECONOMICS_ENGINE_VERSION,
  hashCanonical,
  SIZING_ENGINE_VERSION,
} from '@growth-os/domain';
import { expectedEconomics, expectedSizing } from '@growth-os/fixtures-aster';

const money = (amount: string, measure: MoneyMeasure): Money => ({
  amount,
  currency: 'EUR',
  measure,
  timeBasis: measure === 'one_time_investment' ? 'one_time' : 'per_year',
  priceYear: 2026,
});

const node = (
  n: Partial<LineageNode> & Pick<LineageNode, 'nodeKey' | 'label' | 'kind' | 'unit'>,
): LineageNode => ({
  value: null,
  formulaText: null,
  formulaWithValues: null,
  inputs: [],
  dependsOnAssumptionCount: 0,
  ref: null,
  ...n,
});

export interface EngineRun<T> {
  output: T;
  engineVersion: string;
  inputHash: string;
  blocked: boolean;
}

async function tryEngine<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('TODO(')) return null;
    throw err;
  }
}

export async function sizingRun(input: SizingInput): Promise<EngineRun<SizingOutput>> {
  const { hash } = await hashCanonical(input);
  const real = await tryEngine(() => createSizingEngine().calculate(input));
  if (real)
    return {
      output: SizingOutput.parse(real),
      engineVersion: real.engineVersion,
      inputHash: real.inputHash,
      blocked: real.blocked,
    };
  const e = expectedSizing;
  const engineVersion = `${SIZING_ENGINE_VERSION}+aster-golden`;
  const output = SizingOutput.parse({
    engine: 'sizing',
    engineVersion,
    inputHash: hash,
    blocked: false,
    checks: [
      {
        key: 'CAPACITY_CAP_APPLIED',
        blocking: false,
        message: 'Upside capped at installation and support capacity (120 customers)',
        inputKeys: ['capacity', 'adoption_rate.upside'],
      },
    ],
    ladder: {
      tam: { population: e.tam.population, value: money(e.tam.value, 'annual_market_spend') },
      sam: {
        population: e.sam.population,
        value: money(e.sam.value, 'annual_market_spend'),
        cohortSum: e.sam.cohortSum,
        overlapRemoved: e.sam.overlapRemoved,
      },
      reachablePool: { population: e.reachablePool.population },
      som: (['downside', 'base', 'upside'] as const).map((scenario) => ({
        scenario,
        uncappedCustomers: e.som[scenario].uncappedCustomers,
        customers: e.som[scenario].customers,
        capped: e.som[scenario].capped,
        annualRevenue: money(e.som[scenario].annualRevenue, 'annual_revenue'),
      })),
    },
    crossCheck: {
      result: 'not_available',
      message: 'No top-down figure in the PRD; cross-check not available.',
    },
    lineage: [
      node({
        nodeKey: 'sizing.tam.value',
        label: 'TAM',
        kind: 'calculated',
        value: e.tam.value,
        unit: 'currency_per_year',
        formulaText: 'TAM site count × Annual spend per site',
        formulaWithValues: '5,000 × €20,000 = €100,000,000/year',
        inputs: ['input.tam_site_count', 'input.annual_spend_per_site'],
        dependsOnAssumptionCount: 1,
      }),
      node({
        nodeKey: 'sizing.sam.value',
        label: 'SAM',
        kind: 'calculated',
        value: e.sam.value,
        unit: 'currency_per_year',
        formulaText: '(Size-qualified + Process-qualified − Overlap) × Annual spend per site',
        formulaWithValues: '(1,400 + 1,100 − 500) × €20,000 = €40,000,000/year',
        inputs: ['cohort.size', 'cohort.process', 'overlap', 'input.annual_spend_per_site'],
        dependsOnAssumptionCount: 1,
      }),
      node({
        nodeKey: 'sizing.reachable_pool',
        label: 'Reachable pool',
        kind: 'assumption',
        value: '500',
        unit: 'sites',
        inputs: [],
        dependsOnAssumptionCount: 1,
      }),
      node({
        nodeKey: 'sizing.som.base.revenue',
        label: 'SOM · Base · Year 3',
        kind: 'scenario',
        value: e.som.base.annualRevenue,
        unit: 'currency_per_year',
        formulaText: 'min(floor(Reachable pool × Adoption), Capacity) × Annual spend per site',
        formulaWithValues: 'min(floor(500 × 20%), 120) × €20,000 = €2,000,000',
        inputs: [
          'sizing.reachable_pool',
          'input.adoption_rate.base',
          'input.capacity',
          'input.annual_spend_per_site',
        ],
        dependsOnAssumptionCount: 4,
      }),
    ],
  });
  return { output, engineVersion, inputHash: hash, blocked: false };
}

export async function economicsRun(
  input: EconomicsInput,
  exclusionsText: string,
): Promise<EngineRun<EconomicsOutput>> {
  const { hash } = await hashCanonical(input);
  const real = await tryEngine(() => createEconomicsEngine().calculate(input));
  if (real)
    return {
      output: EconomicsOutput.parse(real),
      engineVersion: real.engineVersion,
      inputHash: real.inputHash,
      blocked: real.blocked,
    };
  const e = expectedEconomics;
  const engineVersion = `${ECONOMICS_ENGINE_VERSION}+aster-golden`;
  const adoption = { downside: '0.10', base: '0.20', upside: '0.30' } as const;
  const uncapped = { downside: 50, base: 100, upside: 150 } as const;
  const changes = {
    downside: ['Adoption 10% instead of 20%'],
    base: [],
    upside: ['Adoption 30% instead of 20%', 'Capped at 120 customers by capacity'],
  } as const;
  const missing = [
    'acquisition ramp',
    'retention',
    'cash timing',
    'partner margin',
    'FX and base-year policy',
  ];
  const output = EconomicsOutput.parse({
    engine: 'economics',
    engineVersion,
    inputHash: hash,
    blocked: false,
    checks: [],
    scenarios: (['downside', 'base', 'upside'] as const).map((scenario) => ({
      scenario,
      adoption: adoption[scenario],
      uncappedCustomers: uncapped[scenario],
      customers: e[scenario].customers,
      capped: scenario === 'upside',
      annualRevenue: money(e[scenario].annualRevenue, 'annual_revenue'),
      grossContribution: money(e[scenario].grossContribution, 'gross_contribution'),
      annualIncrementalOpex: money(e[scenario].annualIncrementalOpex, 'annual_incremental_opex'),
      contributionAfterOpex: money(e[scenario].contributionAfterOpex, 'contribution_after_opex'),
      whatChangesVsBase: [...changes[scenario]],
    })),
    oneTimeInvestment: money(e.oneTimeInvestment, 'one_time_investment'),
    cashFlow: {
      unavailable: true,
      reason: 'Not available — cash-flow inputs are not in the model',
      missingInputs: missing,
    },
    payback: {
      unavailable: true,
      reason: 'Not available — cash-flow inputs are not in the model',
      missingInputs: missing,
    },
    breakEven: {
      targetContributionAfterOpex: '0.00',
      customers: e.breakEvenCustomers,
      formulaText: 'customers = ceil((target + opex) ÷ (price × margin))',
    },
    exclusionsText,
    lineage: [],
  });
  return { output, engineVersion, inputHash: hash, blocked: false };
}
