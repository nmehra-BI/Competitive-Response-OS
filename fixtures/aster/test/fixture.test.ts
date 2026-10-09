/**
 * Fixture integrity: validates engine inputs against the frozen contracts and checks that the
 * golden numbers are internally consistent using independent integer arithmetic (not the engines).
 */
import { describe, expect, it } from 'vitest';
import { EconomicsInput, SizingInput } from '@growth-os/contracts';
import {
  assumptions,
  economicsV2Input,
  expectedEconomics,
  expectedSizing,
  gates,
  exp03,
  pilotTasks,
  sizingV2Input,
} from '../src/index';

const n = (s: string) => Number(s);

describe('Aster fixture', () => {
  it('engine inputs satisfy the frozen contracts', () => {
    expect(SizingInput.safeParse(sizingV2Input).success).toBe(true);
    expect(EconomicsInput.safeParse(economicsV2Input).success).toBe(true);
  });

  it('PRD §6 sizing numbers are consistent', () => {
    const [size, process] = sizingV2Input.cohorts;
    const overlap = sizingV2Input.overlaps[0]!.overlapCount;
    const unique = size!.siteCount + process!.siteCount - overlap;
    const price = n(sizingV2Input.annualSpendPerUnit.value);
    expect(unique).toBe(expectedSizing.sam.population);
    expect(n(sizingV2Input.tamPopulation.value) * price).toBe(n(expectedSizing.tam.value));
    expect(unique * price).toBe(n(expectedSizing.sam.value));
    expect(500 * 0.2 * price).toBe(n(expectedSizing.som.base.annualRevenue));
  });

  it('PRD §6 economics numbers are consistent and keep one-time money apart', () => {
    for (const s of ['downside', 'base', 'upside'] as const) {
      const e = expectedEconomics[s];
      expect(e.customers * 20000).toBe(n(e.annualRevenue));
      expect(Math.round(n(e.annualRevenue) * 0.6)).toBe(n(e.grossContribution));
      expect(n(e.grossContribution) - 600000).toBe(n(e.contributionAfterOpex));
    }
    expect(expectedEconomics.upside.customers).toBe(120);
    expect(n(expectedEconomics.oneTimeInvestment)).toBe(400000);
  });

  it('keeps the gate asks and thresholds exact', () => {
    expect(gates.g1.amount).toBe('15000.00');
    expect(gates.g2.amount).toBe('120000.00');
    expect(gates.g2.durationDays).toBe(90);
    expect(exp03.originalPlan.sampleSize).toBe(20);
    expect(exp03.result.observations.map((o) => o.observed)).toEqual(['9', '4']);
    expect(gates.x1.amount).toBeNull(); // €[cap] stays a placeholder
  });

  it('every pilot task has an owner in the base fixture, and every assumption has an owner', () => {
    expect(pilotTasks.every((t) => t.ownerId)).toBe(true);
    expect(assumptions.every((a) => a.ownerId)).toBe(true);
  });
});
