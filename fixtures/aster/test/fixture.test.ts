/**
 * Fixture integrity: validates engine inputs against the frozen contracts and checks that the
 * golden numbers are internally consistent using independent integer arithmetic (not the engines).
 */
import { describe, expect, it } from 'vitest';
import { EconomicsInput, GatePolicyBody, LicenseInput, SizingInput } from '@growth-os/contracts';
import {
  assumptions,
  authorityGrants,
  committeeMembers,
  expectedExtension,
  gatePolicies,
  licenses,
  outcomeTargets,
  people,
  roleAssignments,
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
  });

  it('X1 follows the extension rule: €30k · 45 days inside the sponsor G2 ceiling (D-110)', () => {
    const x = gatePolicies.find((g) => g.gateCode === 'X')!;
    expect(gates.x1.amount).toBe(expectedExtension.maxAmount);
    expect(gates.x1.durationDays).toBe(expectedExtension.maxDurationDays);
    expect(n(gates.x1.amount)).toBeLessThanOrEqual(n(gates.g2.amount) * n(x.extension.maxBudgetShare));
    expect(gates.x1.durationDays).toBeLessThanOrEqual(
      gates.g2.durationDays * n(x.extension.maxDurationShare),
    );
    const g2Grant = authorityGrants.find((a) => a.gateCode === 'G2')!;
    expect(n(gates.g2.amount) + n(gates.x1.amount)).toBeLessThanOrEqual(n(g2Grant.ceilingAmount!));
    expect(gates.x1.buttonLabel).toBe(expectedExtension.buttonLabel);
  });

  it('policies match the D-109 matrix and validate against the contract', () => {
    for (const g of gatePolicies) expect(GatePolicyBody.safeParse(g).success, g.gateCode).toBe(true);
    const days = Object.fromEntries(
      gatePolicies.map((g) => [g.gateCode, g.approvalExpires ? g.approvalExpiryDays : null]),
    );
    expect(days).toEqual({ G0: null, G1: 30, G2: 30, G3: null, X: 14 });
    const g3 = gatePolicies.find((g) => g.gateCode === 'G3')!;
    expect(g3.requiredApprovals).toBe(2);
    expect(g3.requiredSeats).toEqual(['finance']);
    expect(authorityGrants.map((a) => a.gateCode as string)).not.toContain('G3'); // the authority gap stays visible
    expect(authorityGrants.every((a) => a.doaReference)).toBe(true);
  });

  it('names a three-seat committee with synthetic members and no G3 grant (D-109 §5)', () => {
    expect(committeeMembers.map((m) => m.seat)).toEqual(['chair', 'finance', 'operations']);
    expect(committeeMembers.map((m) => m.userId)).toEqual([
      people.elena.id,
      people.katrin.id,
      people.thomas.id,
    ]);
    const ic = roleAssignments.filter((r) => r.role === 'investment_committee').map((r) => r.userId);
    expect(ic).toEqual([people.katrin.id, people.thomas.id]);
  });

  it('licences fail closed without a written confirmation (D-120)', () => {
    for (const l of licenses) {
      expect(LicenseInput.safeParse(l).success, l.key).toBe(true);
      const permits = l.maxExcerptSentences > 0 || l.allowModelContext || l.allowEmbeddings || l.allowExport;
      if (permits) expect(l.rightsConfirmation, l.key).not.toBeNull();
    }
  });

  it('every pilot threshold has a measure type and a number where the PRD placeholder was (D-110, D-115)', () => {
    expect(outcomeTargets.map((t) => t.measureType)).toEqual(['demand', 'delivery_effort', 'buyer_fit']);
    expect(outcomeTargets.find((t) => t.metricKey === 'deployment_effort')!.thresholdValue).toBe('16');
  });

  it('every pilot task has an owner in the base fixture, and every assumption has an owner', () => {
    expect(pilotTasks.every((t) => t.ownerId)).toBe(true);
    expect(assumptions.every((a) => a.ownerId)).toBe(true);
  });
});
