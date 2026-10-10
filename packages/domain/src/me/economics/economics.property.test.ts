/** Property tests for the economics engine: determinism, no recurring/one-time mixing, break-even, cap. */
import { describe, expect, it } from 'vitest';
import { EconomicsOutput } from '@growth-os/contracts';
import { createEconomicsEngine } from './engine';
import { Dec, addPerYear, oneTime, perYear, subtractPerYear } from '../sizing/numeric';
import { forAll, genEconomicsInput, int } from '../sizing/property-gen';

const engine = createEconomicsEngine();
const N = 150;

describe('economics properties', () => {
  it('valid inputs are never blocked and match the frozen output contract', async () => {
    await forAll(101, N, genEconomicsInput, async (input, _r, label) => {
      const out = await engine.calculate(input);
      expect(
        out.checks.filter((c) => c.blocking),
        label,
      ).toEqual([]);
      expect(() => EconomicsOutput.parse(out), label).not.toThrow();
      expect(
        out.scenarios.map((s) => s.scenario),
        label,
      ).toEqual((['downside', 'base', 'upside'] as const).filter((s) => input.adoption[s] !== null));
    });
  });

  it('determinism: same input → identical output and inputHash', async () => {
    await forAll(102, N, genEconomicsInput, async (input, _r, label) => {
      const a = await engine.calculate(input);
      const b = await engine.calculate(structuredClone(input));
      expect(b, label).toEqual(a);
    });
  });

  it('per-year arithmetic is exact: revenue, gross, after-opex', async () => {
    await forAll(103, N, genEconomicsInput, async (input, _r, label) => {
      const out = await engine.calculate(input);
      const price = new Dec(input.annualPricePerCustomer.value);
      const margin = new Dec(input.grossMargin.value);
      const opex = new Dec(input.annualIncrementalOpex.value);
      for (const s of out.scenarios) {
        const rev = price.times(s.customers);
        expect(new Dec(s.annualRevenue.amount).eq(rev), label).toBe(true);
        expect(new Dec(s.grossContribution.amount).eq(rev.times(margin)), label).toBe(true);
        expect(new Dec(s.annualIncrementalOpex.amount).eq(opex), label).toBe(true);
        expect(new Dec(s.contributionAfterOpex.amount).eq(rev.times(margin).minus(opex)), label).toBe(true);
      }
    });
  });

  it('no cross-measure sum: the one-time investment never moves any per-year value', async () => {
    await forAll(104, N, genEconomicsInput, async (input, r, label) => {
      const a = await engine.calculate(input);
      const b0 = structuredClone(input);
      b0.oneTimeInvestment!.value = `${int(r, 0, 9_000_000)}.00`;
      const b = await engine.calculate(b0);
      expect(b.scenarios, label).toEqual(a.scenarios);
      expect(b.breakEven, label).toEqual(a.breakEven);
      expect(a.oneTimeInvestment, label).toMatchObject({
        timeBasis: 'one_time',
        measure: 'one_time_investment',
      });
      for (const s of a.scenarios) {
        for (const m of [
          s.annualRevenue,
          s.grossContribution,
          s.annualIncrementalOpex,
          s.contributionAfterOpex,
        ]) {
          expect(m.timeBasis, label).toBe('per_year');
        }
      }
      // No lineage node takes the one-time investment as an input.
      const usesOneTime = a.lineage.some((n) => n.inputs.includes('input.one_time_investment'));
      expect(usesOneTime, label).toBe(false);
    });
  });

  it('cash flow and payback are always Unavailable, never zero', async () => {
    await forAll(105, N, genEconomicsInput, async (input, _r, label) => {
      const out = await engine.calculate(input);
      expect(out.cashFlow.unavailable, label).toBe(true);
      expect(out.payback.unavailable, label).toBe(true);
      expect(out.cashFlow.missingInputs.length, label).toBe(5);
    });
  });

  it('break-even: the stated customers reach the target; one fewer does not', async () => {
    await forAll(106, N, genEconomicsInput, async (input, r, label) => {
      const target = new Dec(int(r, 0, 2_000_000));
      const be = engine.breakEven(input, target.toFixed(2));
      const perCustomer = new Dec(input.annualPricePerCustomer.value).times(input.grossMargin.value);
      const opex = new Dec(input.annualIncrementalOpex.value);
      if (perCustomer.isZero()) {
        expect(be.customers, label).toBeNull();
        return;
      }
      const after = (n: number) => perCustomer.times(n).minus(opex);
      expect(be.customers, label).not.toBeNull();
      expect(after(be.customers!).gte(target), label).toBe(true);
      if (be.customers! > 0) expect(after(be.customers! - 1).lt(target), label).toBe(true);
    });
  });

  it('capacity cap is monotone and binding exactly when uncapped > capacity', async () => {
    await forAll(107, N, genEconomicsInput, async (input, r, label) => {
      const lo = await engine.calculate(input);
      const raised = structuredClone(input);
      raised.capacity.value = String(Number(input.capacity.value) + int(r, 1, 500));
      const hi = await engine.calculate(raised);
      const cap = Number(input.capacity.value);
      lo.scenarios.forEach((s, k) => {
        expect(s.customers, label).toBe(Math.min(s.uncappedCustomers, cap));
        expect(s.capped, label).toBe(s.uncappedCustomers > cap);
        expect(hi.scenarios[k]!.customers >= s.customers, label).toBe(true);
        expect(
          new Dec(hi.scenarios[k]!.contributionAfterOpex.amount).gte(s.contributionAfterOpex.amount),
          label,
        ).toBe(true);
      });
    });
  });
});

describe('type-level guard: recurring and one-time money never combine', () => {
  it('per-year arithmetic compiles; mixing with one-time does not', () => {
    const y = perYear('annual_revenue', new Dec(1), 'EUR', 2026);
    const o = oneTime(new Dec(1), 'EUR', 2026);
    expect(addPerYear('annual_revenue', y, y).amount.toFixed()).toBe('2');
    // Compile-time only: these lines must fail typecheck (never executed).
    const mixing = () => {
      // @ts-expect-error a one-time amount is not a PerYearAmount
      subtractPerYear('contribution_after_opex', y, o);
      // @ts-expect-error a one-time amount is not a PerYearAmount
      addPerYear('annual_revenue', o, y);
    };
    expect(typeof mixing).toBe('function');
    // The runtime still refuses cross-currency per-year arithmetic.
    expect(() =>
      addPerYear('annual_revenue', y, perYear('annual_revenue', new Dec(1), 'USD', 2026)),
    ).toThrow();
  });
});
