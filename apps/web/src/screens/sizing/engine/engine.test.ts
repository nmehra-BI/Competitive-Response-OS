/**
 * The ported engines reproduce the WS2 domain engines exactly: golden fixture values (PRD §6),
 * the same input hashes WS2 records for the Aster fixture, and the S06 blocking variants.
 */
import {
  COHORT_PROCESS_IMPORTED_ID,
  economicsV2Input,
  expectedBlocking,
  expectedEconomics,
  expectedSizing,
  sizingMeta,
  sizingV2Input,
} from '@growth-os/fixtures-aster';
import type { SizingInput } from '@growth-os/contracts';
import { describe, expect, it } from 'vitest';
import { economicsEngine } from '../../economics/engine/adapter';
import { sizingEngine } from './adapter';

/** Hashes produced by the WS2 engines (worktree-agent-aa0d31ef83422e2fc @ e0958a5) for the fixture. */
const WS2_SIZING_HASH = '74cedbb39b6f6fc25a7556009bd0d3f45150adfa933f50dbe2f072c682c7bc35';
const WS2_ECONOMICS_HASH = '3b748b4df20a2abc8ee77b0b6c1b798c4ceae1a4bfefd5c8a5571fba84e4f7b2';

describe('sizing engine port', () => {
  it('matches the golden ladder and the WS2 input hash', async () => {
    const out = await sizingEngine.calculate(sizingV2Input);
    expect(out.inputHash).toBe(WS2_SIZING_HASH);
    expect(out.blocked).toBe(false);
    expect(out.ladder.tam).toMatchObject({
      population: expectedSizing.tam.population,
      value: { amount: expectedSizing.tam.value, timeBasis: 'per_year' },
    });
    expect(out.ladder.sam).toMatchObject({
      population: expectedSizing.sam.population,
      cohortSum: expectedSizing.sam.cohortSum,
      overlapRemoved: expectedSizing.sam.overlapRemoved,
      value: { amount: expectedSizing.sam.value },
    });
    expect(out.ladder.reachablePool).toEqual(expectedSizing.reachablePool);
    for (const s of out.ladder.som) {
      const e = expectedSizing.som[s.scenario];
      expect(s).toMatchObject({
        uncappedCustomers: e.uncappedCustomers,
        customers: e.customers,
        capped: e.capped,
        annualRevenue: { amount: e.annualRevenue, measure: 'annual_revenue' },
      });
    }
    const sam = out.lineage.find((n) => n.nodeKey === 'sizing.sam.value')!;
    expect(sam.formulaWithValues).toBe('(1,400 + 1,100 − 500) × €20,000 = €40,000,000/year');
    expect(sam.dependsOnAssumptionCount).toBe(1);
    // No total: the ladder has exactly the four measures.
    expect(Object.keys(out.ladder)).toEqual(['tam', 'sam', 'reachablePool', 'som']);
  });

  it('blocks SAM > TAM when the TAM count is edited to 500', async () => {
    const input: SizingInput = {
      ...sizingV2Input,
      tamPopulation: {
        ...sizingV2Input.tamPopulation,
        value: sizingMeta.variants.samExceedsTam.tamPopulation,
      },
    };
    const out = await sizingEngine.calculate(input);
    expect(out.blocked).toBe(true);
    expect(out.checks.map((c) => c.key)).toContain(expectedBlocking.samExceedsTam);
    expect(out.ladder.som).toEqual([]);
  });

  it('blocks a duplicate cohort', async () => {
    const input: SizingInput = {
      ...sizingV2Input,
      cohorts: [
        ...sizingV2Input.cohorts,
        {
          ...sizingV2Input.cohorts[1]!,
          cohortId: COHORT_PROCESS_IMPORTED_ID,
          status: 'duplicate_candidate',
          ref: { type: 'cohort', id: COHORT_PROCESS_IMPORTED_ID, version: 1 },
        },
      ],
    };
    const out = await sizingEngine.calculate(input);
    expect(out.blocked).toBe(true);
    expect(out.checks.map((c) => c.key)).toContain('DUPLICATE_COHORT');
  });

  it('blocks a negative overlap and an overlap above the smaller cohort', async () => {
    const withOverlap = (n: number): SizingInput => ({
      ...sizingV2Input,
      overlaps: [{ ...sizingV2Input.overlaps[0]!, overlapCount: n }],
    });
    expect((await sizingEngine.calculate(withOverlap(-1))).checks.map((c) => c.key)).toContain(
      expectedBlocking.negativeOverlap,
    );
    expect((await sizingEngine.calculate(withOverlap(1200))).checks.map((c) => c.key)).toContain(
      expectedBlocking.overlapAboveSmaller,
    );
  });
});

describe('economics engine port', () => {
  it('matches the golden scenarios and the WS2 input hash', async () => {
    const out = await economicsEngine.calculate(economicsV2Input);
    expect(out.inputHash).toBe(WS2_ECONOMICS_HASH);
    expect(out.scenarios.map((s) => s.scenario)).toEqual(['downside', 'base', 'upside']);
    for (const s of out.scenarios) {
      const e = expectedEconomics[s.scenario];
      expect(s.customers).toBe(e.customers);
      expect(s.annualRevenue.amount).toBe(e.annualRevenue);
      expect(s.grossContribution.amount).toBe(e.grossContribution);
      expect(s.annualIncrementalOpex.amount).toBe(e.annualIncrementalOpex);
      expect(s.contributionAfterOpex.amount).toBe(e.contributionAfterOpex);
    }
    expect(out.oneTimeInvestment).toMatchObject({
      amount: expectedEconomics.oneTimeInvestment,
      timeBasis: 'one_time',
    });
    expect(out.breakEven.customers).toBe(expectedEconomics.breakEvenCustomers);
    expect(out.cashFlow.unavailable).toBe(true);
    expect(out.payback.unavailable).toBe(true);
    expect(out.cashFlow.missingInputs).toEqual([
      'Acquisition ramp',
      'Retention',
      'Cash timing',
      'Partner margin',
      'FX and base year policy',
    ]);
  });
});
