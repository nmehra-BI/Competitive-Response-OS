/**
 * Release gate "calculations verified against fixtures" (PRD §10). These golden tests are the
 * acceptance criteria for WS2. Numbers come from fixtures/aster (PRD §6) and are compared exactly.
 */
import { describe, expect, it } from 'vitest';
import { EconomicsOutput, SizingOutput } from '@growth-os/contracts';
import type { EconomicsInput, SizingInput } from '@growth-os/contracts';
import {
  COHORT_PROCESS_ID,
  COHORT_PROCESS_IMPORTED_ID,
  comparison,
  economicsV2Input,
  expectedBlocking,
  expectedEconomics,
  expectedSizing,
  opportunities,
  sizingV2Input,
  sizingMeta,
} from '@growth-os/fixtures-aster';
import { createSizingEngine, lineageView, mergeLineage, usedByTransitive } from './sizing/engine';
import { createEconomicsEngine } from './economics/engine';
import { RANKING_FORMULA_TEXT, createRankingEngine, explainScore } from './comparison/ranking';
import type { RankingInputRow } from './comparison/ranking';

const sizing = createSizingEngine();
const economics = createEconomicsEngine();

const clone = <T>(v: T): T => structuredClone(v);
const blockingKeys = (o: { checks: { key: string; blocking: boolean }[] }) =>
  o.checks.filter((c) => c.blocking).map((c) => c.key);

describe('golden: sizing engine vs Aster fixture', () => {
  it('TAM 5,000 × €20,000 = €100,000,000/year', async () => {
    const out = await sizing.calculate(sizingV2Input);
    expect(SizingOutput.parse(out)).toEqual(out);
    expect(out.ladder.tam.population).toBe(expectedSizing.tam.population);
    expect(out.ladder.tam.value).toEqual({
      amount: expectedSizing.tam.value,
      currency: 'EUR',
      measure: 'annual_market_spend',
      timeBasis: 'per_year',
      priceYear: 2026,
    });
    const tam = out.lineage.find((n) => n.nodeKey === 'sizing.tam.value')!;
    expect(tam.formulaWithValues).toBe('5,000 × €20,000 = €100,000,000/year');
  });

  it('SAM (1,400 + 1,100 − 500) × €20,000 = €40,000,000/year', async () => {
    const out = await sizing.calculate(sizingV2Input);
    expect(out.ladder.sam).toMatchObject({
      population: expectedSizing.sam.population,
      cohortSum: expectedSizing.sam.cohortSum,
      overlapRemoved: expectedSizing.sam.overlapRemoved,
    });
    expect(out.ladder.sam.value.amount).toBe(expectedSizing.sam.value);
    expect(out.ladder.sam.available).toBe(true); // D-033
    expect(out.ladder.sam.value.measure).toBe('annual_market_spend');
    const samNode = out.lineage.find((n) => n.nodeKey === 'sizing.sam.value')!;
    expect(samNode.formulaText).toBe(
      'SAM = (Size-qualified + Process-qualified − Overlap) × Annual spend per site',
    );
    expect(samNode.formulaWithValues).toBe('(1,400 + 1,100 − 500) × €20,000 = €40,000,000/year');
    expect(samNode.dependsOnAssumptionCount).toBe(1);
    const overlap = out.lineage.find((n) => n.nodeKey === 'sizing.sam.overlap_removed')!;
    expect(overlap.value).toBe('-500');
  });

  it('SAM lineage: inputs one level and used by (acceptance step 8)', async () => {
    const s = await sizing.calculate(sizingV2Input);
    const e = await economics.calculate(economicsV2Input);
    const graph = mergeLineage(s.lineage, e.lineage);
    const view = lineageView(graph, 'sizing.sam.value')!;
    expect(view.node.value).toBe('40000000.00');
    expect(view.inputs.map((n) => n.label)).toEqual([
      'Size-qualified',
      'Process-qualified',
      'Overlap removed',
      'Annual spend per site',
    ]);
    // SAM sites bound the reachable pool, which feeds SOM; the reachable-pool input also feeds economics.
    const samSitesUsedBy = usedByTransitive(graph, 'sizing.sam.population').map((n) => n.nodeKey);
    expect(samSitesUsedBy).toContain('sizing.reachable_pool');
    expect(samSitesUsedBy).toContain('sizing.som.base.annual_revenue');
    const reachUsedBy = lineageView(graph, 'input.reachable_pool')!.usedBy.map((n) => n.nodeKey);
    expect(reachUsedBy).toContain('sizing.reachable_pool');
    expect(reachUsedBy).toContain('economics.base.customers');
  });

  it('reachable pool 500 sites, no money value', async () => {
    const out = await sizing.calculate(sizingV2Input);
    expect(out.ladder.reachablePool).toEqual({ population: expectedSizing.reachablePool.population });
    const node = out.lineage.find((n) => n.nodeKey === 'sizing.reachable_pool')!;
    expect(node.unit).toBe('sites');
  });

  it('SOM base 100 customers, €2,000,000 annual revenue at end of year 3', async () => {
    const out = await sizing.calculate(sizingV2Input);
    const base = out.ladder.som.find((s) => s.scenario === 'base')!;
    expect(base).toMatchObject({
      uncappedCustomers: expectedSizing.som.base.uncappedCustomers,
      customers: expectedSizing.som.base.customers,
      capped: false,
    });
    expect(base.annualRevenue).toMatchObject({
      amount: expectedSizing.som.base.annualRevenue,
      measure: 'annual_revenue',
      timeBasis: 'per_year',
    });
    const downside = out.ladder.som.find((s) => s.scenario === 'downside')!;
    expect(downside.customers).toBe(expectedSizing.som.downside.customers);
    expect(downside.annualRevenue.amount).toBe(expectedSizing.som.downside.annualRevenue);
    expect(out.ladder.som.map((s) => s.scenario)).toEqual(['downside', 'base', 'upside']);
    const node = out.lineage.find((n) => n.nodeKey === 'sizing.som.base.annual_revenue')!;
    expect(node.formulaText).toContain('end of year 3');
  });

  it('SOM upside capped at 120 customers (uncapped 150), €2,400,000', async () => {
    const out = await sizing.calculate(sizingV2Input);
    const up = out.ladder.som.find((s) => s.scenario === 'upside')!;
    expect(up).toMatchObject({
      uncappedCustomers: expectedSizing.som.upside.uncappedCustomers,
      customers: expectedSizing.som.upside.customers,
      capped: expectedSizing.som.upside.capped,
    });
    expect(up.annualRevenue.amount).toBe(expectedSizing.som.upside.annualRevenue);
    expect(blockingKeys(out)).toEqual(expectedSizing.blockingChecks);
    expect(out.blocked).toBe(false);
    expect(out.checks.map((c) => c.key)).toContain('CAPACITY_CAP_APPLIED');
  });

  it('blocks SAM > TAM, negative overlap, overlap > smaller cohort, mixed units, mixed years, mixed currency', async () => {
    const variant = async (mutate: (i: SizingInput) => void) => {
      const i = clone(sizingV2Input);
      mutate(i);
      const out = await sizing.calculate(i);
      expect(out.blocked).toBe(true);
      expect(out.ladder.som).toEqual([]);
      return blockingKeys(out);
    };
    expect(
      await variant((i) => {
        i.tamPopulation.value = sizingMeta.variants.samExceedsTam.tamPopulation;
      }),
    ).toContain(expectedBlocking.samExceedsTam);
    expect(
      await variant((i) => {
        i.overlaps[0]!.overlapCount = -1;
      }),
    ).toContain(expectedBlocking.negativeOverlap);
    expect(
      await variant((i) => {
        i.overlaps[0]!.overlapCount = 1200;
      }),
    ).toContain(expectedBlocking.overlapAboveSmaller);
    expect(
      await variant((i) => {
        i.cohorts[1]!.populationUnit = 'company';
      }),
    ).toContain(expectedBlocking.mixedUnits);
    expect(
      await variant((i) => {
        i.cohorts[1]!.priceYear = 2024;
      }),
    ).toContain(expectedBlocking.mixedYears);
    expect(
      await variant((i) => {
        i.annualSpendPerUnit.currency = 'USD';
      }),
    ).toContain(expectedBlocking.currencyMismatch);
  });

  it('blocks a duplicate cohort (same rule and source, or a duplicate candidate)', async () => {
    const i = clone(sizingV2Input);
    const proc = i.cohorts.find((c) => c.cohortId === COHORT_PROCESS_ID)!;
    i.cohorts.push({
      ...clone(proc),
      cohortId: COHORT_PROCESS_IMPORTED_ID,
      name: 'Process-qualified (imported)',
    });
    const out = await sizing.calculate(i);
    expect(blockingKeys(out)).toContain('DUPLICATE_COHORT');
  });

  it('same input → same output and same inputHash (determinism)', async () => {
    const a = await sizing.calculate(sizingV2Input);
    const b = await sizing.calculate(clone(sizingV2Input));
    expect(b).toEqual(a);
    expect(a.inputHash).toMatch(/^[0-9a-f]{64}$/);
    const changed = clone(sizingV2Input);
    changed.adoption.base.value = '0.21';
    expect((await sizing.calculate(changed)).inputHash).not.toBe(a.inputHash);
  });

  it('cross-check is a test, never an average', async () => {
    const i = clone(sizingV2Input);
    i.crossCheck = {
      measure: 'sam',
      low: '35000000.00',
      high: '50000000.00',
      currency: 'EUR',
      priceYear: 2026,
      illustrative: true,
    };
    const within = await sizing.calculate(i);
    expect(within.crossCheck.result).toBe('within_range');
    expect(within.crossCheck.message.startsWith('Illustrative')).toBe(true);
    expect(within.ladder.sam.value.amount).toBe('40000000.00');
    i.crossCheck = { ...i.crossCheck, low: '45000000.00', high: '60000000.00' };
    const outside = await sizing.calculate(i);
    expect(outside.crossCheck.result).toBe('outside_range');
    expect(outside.crossCheck.message).toContain('Outside range by €5,000,000/year');
    expect(outside.ladder.sam.value.amount).toBe('40000000.00');
    expect(outside.blocked).toBe(false);
    expect((await sizing.calculate(sizingV2Input)).crossCheck.result).toBe('not_available');
  });
});

describe('golden: economics engine vs Aster fixture', () => {
  const scenario = async (s: 'downside' | 'base' | 'upside') => {
    const out = await economics.calculate(economicsV2Input);
    expect(EconomicsOutput.parse(out)).toEqual(out);
    return out.scenarios.find((x) => x.scenario === s)!;
  };
  const amounts = (x: Awaited<ReturnType<typeof scenario>>) => ({
    customers: x.customers,
    annualRevenue: x.annualRevenue.amount,
    grossContribution: x.grossContribution.amount,
    annualIncrementalOpex: x.annualIncrementalOpex.amount,
    contributionAfterOpex: x.contributionAfterOpex.amount,
  });

  it('downside 50 → €1.0m → €0.60m → €0 after opex (true zero, break-even)', async () => {
    const d = await scenario('downside');
    expect(amounts(d)).toEqual(expectedEconomics.downside);
    expect(d.contributionAfterOpex).toMatchObject({ amount: '0.00', measure: 'contribution_after_opex' });
    expect(d.whatChangesVsBase).toEqual(['Adoption 10% (50 of 500 sites)']);
  });

  it('base 100 → €2.0m → €1.2m → €600k after opex', async () => {
    const b = await scenario('base');
    expect(amounts(b)).toEqual(expectedEconomics.base);
    expect(b.whatChangesVsBase).toEqual([]);
  });

  it('upside 120 (capped) → €2.4m → €1.44m → €840k after opex', async () => {
    const u = await scenario('upside');
    const { capped, ...rest } = expectedEconomics.upside;
    expect(amounts(u)).toEqual(rest);
    expect(u.capped).toBe(capped);
    expect(u.uncappedCustomers).toBe(150);
    expect(u.whatChangesVsBase).toContain('120 customers: capacity cap reached (unconstrained would be 150)');
  });

  it('one-time €400k returned separately; no per_year value includes it', async () => {
    const out = await economics.calculate(economicsV2Input);
    expect(out.oneTimeInvestment).toEqual({
      amount: expectedEconomics.oneTimeInvestment,
      currency: 'EUR',
      measure: 'one_time_investment',
      timeBasis: 'one_time',
      priceYear: 2026,
    });
    for (const s of out.scenarios) {
      for (const m of [
        s.annualRevenue,
        s.grossContribution,
        s.annualIncrementalOpex,
        s.contributionAfterOpex,
      ]) {
        expect(m.timeBasis).toBe('per_year');
      }
    }
    // Changing the one-time amount changes nothing that is per year.
    const other = clone(economicsV2Input) as EconomicsInput;
    other.oneTimeInvestment!.value = '999999.00';
    const out2 = await economics.calculate(other);
    expect(out2.scenarios).toEqual(out.scenarios);
    expect(out2.breakEven).toEqual(out.breakEven);
    expect(out.blocked).toBe(false);
  });

  it('cash flow and payback Unavailable with the five missing inputs listed', async () => {
    const out = await economics.calculate(economicsV2Input);
    const five = [
      'Acquisition ramp',
      'Retention',
      'Cash timing',
      'Partner margin',
      'FX and base year policy',
    ];
    expect(expectedEconomics.cashFlowAvailable).toBe(false);
    expect(expectedEconomics.paybackAvailable).toBe(false);
    expect(out.cashFlow).toMatchObject({ unavailable: true, missingInputs: five });
    expect(out.payback).toMatchObject({ unavailable: true, missingInputs: five });
    expect(out.exclusionsText).toBe(
      'Before taxes, working capital, ramp timing and financing. Constant price and margin. Not a year-one profit or cash-flow forecast.',
    );
  });

  it('break-even customers = 50', async () => {
    const out = await economics.calculate(economicsV2Input);
    expect(out.breakEven).toEqual({
      targetContributionAfterOpex: '0.00',
      customers: expectedEconomics.breakEvenCustomers,
      formulaText: 'customers = opex ÷ (price × margin)',
    });
    expect(economics.breakEven(economicsV2Input, '600000.00').customers).toBe(100);
    const node = out.lineage.find((n) => n.nodeKey === 'economics.break_even.customers')!;
    expect(node.formulaWithValues).toBe('ceil(€600,000 ÷ (€20,000 × 60%)) = 50');
  });

  it('blocks a currency mismatch and a missing cost input', async () => {
    const usd = clone(economicsV2Input);
    usd.annualIncrementalOpex.currency = 'USD';
    const a = await economics.calculate(usd);
    expect(blockingKeys(a)).toContain('CURRENCY_MISMATCH');
    expect(a.scenarios).toEqual([]);
    expect(a.breakEven.customers).toBeNull();
    const noInvestment = clone(economicsV2Input);
    noInvestment.oneTimeInvestment = null;
    const b = await economics.calculate(noInvestment);
    expect(blockingKeys(b)).toEqual(['MISSING_INPUT']);
    expect(b.oneTimeInvestment).toMatchObject({ unavailable: true });
    expect(b.scenarios).toHaveLength(3);
  });
});

describe('golden: comparison ranking vs Aster fixture (S04, weights v1 40/30/30)', () => {
  const idOf = (key: string) => opportunities.find((o) => o.key === key)!.id;
  const rows = (excludeOpp09: boolean): RankingInputRow[] =>
    comparison.opportunityKeys.map((key) => ({
      opportunityId: idOf(key),
      ...comparison.ratings[key],
      excluded: excludeOpp09 && (comparison.excludedUntilNormalized as readonly string[]).includes(key),
      incomparable: key === 'OPP-09',
    }));
  const weights = { productFit: 40, channelAccess: 30, evidenceCoverage: 30 };
  const ranking = createRankingEngine();

  it('ranks OPP-07 first, OPP-14 not ranked (Unknown never 0), OPP-09 excluded', () => {
    const r = ranking.rank(rows(true), weights);
    expect(r.valid).toBe(true);
    expect(r.ranking).toEqual([
      { opportunityId: idOf('OPP-07'), ranked: true, score: '2.70', reason: null },
      { opportunityId: idOf('OPP-16'), ranked: true, score: '1.70', reason: null },
      {
        opportunityId: idOf('OPP-14'),
        ranked: false,
        score: null,
        reason: 'Not ranked — 1 input missing (channel access)',
      },
      { opportunityId: idOf('OPP-09'), ranked: false, score: null, reason: 'Excluded until normalized' },
    ]);
  });

  it('an incomparable boundary blocks the aggregate ranking until excluded', () => {
    const r = ranking.rank(rows(false), weights);
    expect(r.valid).toBe(false);
    expect(r.ranking.every((x) => !x.ranked && x.reason === 'Not ranked — boundary conflict in set')).toBe(
      true,
    );
  });

  it('formula and weights are inspectable', () => {
    expect(RANKING_FORMULA_TEXT).toContain('Score = Product fit × w₁');
    const opp07 = rows(true)[0]!;
    expect(explainScore(opp07, weights)).toBe('3 × 40% + 3 × 30% + 2 × 30% = 2.70 of 3');
    expect(explainScore(rows(true)[1]!, weights)).toContain('Unknown × 30%');
  });

  it('weights that do not total 100 make the ranking invalid', () => {
    const r = ranking.rank(rows(true), { productFit: 50, channelAccess: 30, evidenceCoverage: 30 });
    expect(r.valid).toBe(false);
    expect(r.ranking.some((x) => x.ranked)).toBe(false);
  });
});
