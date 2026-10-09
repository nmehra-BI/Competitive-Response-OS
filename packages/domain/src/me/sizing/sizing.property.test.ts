/** Property tests for the sizing engine: determinism, no cross-measure sums, blocking checks, cap. */
import { describe, expect, it } from 'vitest';
import { SizingOutput } from '@growth-os/contracts';
import type { SizingInput } from '@growth-os/contracts';
import { createSizingEngine } from './engine';
import { Dec } from './numeric';
import { forAll, genSizingInput, int } from './property-gen';

const engine = createSizingEngine();
const N = 150;
const blockingKeys = (o: SizingOutput) => o.checks.filter((c) => c.blocking).map((c) => c.key);

function walkKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => walkKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      walkKeys(v, out);
    }
  }
  return out;
}

describe('sizing properties', () => {
  it('valid inputs are never blocked and always match the frozen output contract', async () => {
    await forAll(1, N, genSizingInput, async (input, _r, label) => {
      const out = await engine.calculate(input);
      expect(blockingKeys(out), label).toEqual([]);
      expect(() => SizingOutput.parse(out), label).not.toThrow();
    });
  });

  it('determinism: same input → identical output and inputHash; any change → new hash', async () => {
    await forAll(2, N, genSizingInput, async (input, _r, label) => {
      const a = await engine.calculate(input);
      const b = await engine.calculate(structuredClone(input));
      expect(b, label).toEqual(a);
      const changed = structuredClone(input);
      changed.capacity.value = String(Number(changed.capacity.value) + 1);
      expect((await engine.calculate(changed)).inputHash, label).not.toBe(a.inputHash);
    });
  });

  it('no cross-measure sum: every measure is its own product, and no total exists', async () => {
    await forAll(3, N, genSizingInput, async (input, _r, label) => {
      const out = await engine.calculate(input);
      const spend = new Dec(input.annualSpendPerUnit.value);
      expect(new Dec(out.ladder.tam.value.amount).eq(spend.times(input.tamPopulation.value)), label).toBe(
        true,
      );
      expect(new Dec(out.ladder.sam.value.amount).eq(spend.times(out.ladder.sam.population)), label).toBe(
        true,
      );
      expect(out.ladder.sam.population, label).toBe(out.ladder.sam.cohortSum - out.ladder.sam.overlapRemoved);
      for (const s of out.ladder.som) {
        expect(new Dec(s.annualRevenue.amount).eq(spend.times(s.customers)), label).toBe(true);
      }
      expect(
        walkKeys(out).some((k) => /total/i.test(k)),
        label,
      ).toBe(false);
      expect(Object.keys(out.ladder)).toEqual(['tam', 'sam', 'reachablePool', 'som']);
      expect('value' in out.ladder.reachablePool).toBe(false);
    });
  });

  it('measures are independent: changing TAM leaves SAM and SOM unchanged', async () => {
    await forAll(4, N, genSizingInput, async (input, r, label) => {
      const a = await engine.calculate(input);
      const bigger = structuredClone(input);
      bigger.tamPopulation.value = String(Number(input.tamPopulation.value) + int(r, 1, 10000));
      const b = await engine.calculate(bigger);
      expect(b.ladder.sam, label).toEqual(a.ladder.sam);
      expect(b.ladder.som, label).toEqual(a.ladder.som);
    });
  });

  it('blocking checks fire for each invalid variant and suppress SOM', async () => {
    const variants: Array<[string, (i: SizingInput, r: () => number) => void]> = [
      ['OVERLAP_NEGATIVE', (i, r) => void (i.overlaps[0]!.overlapCount = -int(r, 1, 1000))],
      [
        'OVERLAP_EXCEEDS_SMALLER_COHORT',
        (i, r) =>
          void (i.overlaps[0]!.overlapCount =
            Math.min(i.cohorts[0]!.siteCount, i.cohorts[1]!.siteCount) + int(r, 1, 1000)),
      ],
      [
        'SAM_EXCEEDS_TAM',
        (i, r) => {
          const sam = i.cohorts[0]!.siteCount + i.cohorts[1]!.siteCount - i.overlaps[0]!.overlapCount;
          i.tamPopulation.value = String(int(r, 0, sam - 1));
        },
      ],
      [
        'REACHABLE_EXCEEDS_SAM',
        (i, r) => {
          const sam = i.cohorts[0]!.siteCount + i.cohorts[1]!.siteCount - i.overlaps[0]!.overlapCount;
          i.reachablePool.value = String(sam + int(r, 1, 1000));
          i.tamPopulation.value = String(sam + 100000);
        },
      ],
      ['UNIT_MISMATCH', (i, r) => void (i.cohorts[int(r, 0, 1)]!.populationUnit = 'company')],
      ['UNIT_MISMATCH', (i) => void (i.reachablePool.unit = 'companies')],
      ['PRICE_YEAR_MISMATCH', (i, r) => void (i.cohorts[0]!.priceYear = 2026 - int(r, 1, 5))],
      ['CURRENCY_MISMATCH', (i) => void (i.annualSpendPerUnit.currency = 'USD')],
      ['RATE_OUT_OF_RANGE', (i, r) => void (i.adoption.base.value = `1.${int(r, 1, 99)}`)],
      ['CAPACITY_NEGATIVE', (i, r) => void (i.capacity.value = `-${int(r, 1, 100)}`)],
      ['DUPLICATE_COHORT', (i) => void (i.cohorts[1]!.status = 'duplicate_candidate')],
      [
        'DUPLICATE_COHORT',
        (i) => {
          i.cohorts[1]!.rule = i.cohorts[0]!.rule;
          i.cohorts[1]!.ref = structuredClone(i.cohorts[0]!.ref);
        },
      ],
      [
        'TOO_MANY_COHORTS_FOR_AGGREGATE_METHOD',
        (i) =>
          void i.cohorts.push({
            ...structuredClone(i.cohorts[0]!),
            cohortId: '00000000-0000-4000-8000-0000000000aa',
            rule: 'another rule',
            ref: { ...i.cohorts[0]!.ref, id: '00000000-0000-4000-8000-0000000000ab' },
          }),
      ],
      [
        'ANNUALIZATION_METHOD_MISSING',
        (i) => {
          i.boundary.includesOneTimeSpend = true;
          i.boundary.annualizationMethod = null;
        },
      ],
    ];
    let seed = 10;
    for (const [key, mutate] of variants) {
      await forAll(seed++, 25, genSizingInput, async (input, r, label) => {
        mutate(input, r);
        const out = await engine.calculate(input);
        expect(out.blocked, `${key} ${label}`).toBe(true);
        expect(blockingKeys(out), `${key} ${label}`).toContain(key);
        expect(out.ladder.som, `${key} ${label}`).toEqual([]);
      });
    }
  });

  it('site-list union: SAM = |union of site IDs|; overlap removed = Σ − union', async () => {
    await forAll(40, N, genSizingInput, async (input, r, label) => {
      const ids = Array.from({ length: int(r, 1, 300) }, (_, k) => `S${k}`);
      const pick = () => ids.filter(() => r() < 0.5);
      const cohorts = [pick(), pick(), pick()].filter((c) => c.length > 0);
      if (cohorts.length === 0) return;
      const i: SizingInput = structuredClone(input);
      i.method = 'site_list_union';
      i.cohorts = cohorts.map((siteIds, k) => ({
        ...structuredClone(input.cohorts[0]!),
        cohortId: `00000000-0000-4000-8000-00000000000${k}`,
        rule: `rule ${k}`,
        siteCount: siteIds.length,
        siteIds,
        ref: { ...input.cohorts[0]!.ref, id: `00000000-0000-4000-8000-00000000010${k}` },
      }));
      const union = new Set(cohorts.flat()).size;
      i.tamPopulation.value = String(union + 10);
      i.reachablePool.value = String(Math.min(union, Number(i.reachablePool.value)));
      const out = await engine.calculate(i);
      const dup = blockingKeys(out).includes('DUPLICATE_COHORT');
      if (!dup) expect(blockingKeys(out), label).toEqual([]);
      expect(out.ladder.sam.population, label).toBe(union);
      expect(out.ladder.sam.overlapRemoved, label).toBe(cohorts.reduce((s, c) => s + c.length, 0) - union);
    });
  });

  it('capacity cap: customers = min(floor(reach × adoption), capacity) and monotone in capacity', async () => {
    await forAll(50, N, genSizingInput, async (input, r, label) => {
      const lo = await engine.calculate(input);
      const raised = structuredClone(input);
      raised.capacity.value = String(Number(input.capacity.value) + int(r, 1, 500));
      const hi = await engine.calculate(raised);
      const cap = Number(input.capacity.value);
      lo.ladder.som.forEach((s, k) => {
        const h = hi.ladder.som[k]!;
        const adoption = new Dec(input.adoption[s.scenario]!.value);
        const uncapped = adoption.times(input.reachablePool.value).floor().toNumber();
        expect(s.uncappedCustomers, label).toBe(uncapped);
        expect(s.customers, label).toBe(Math.min(uncapped, cap));
        expect(s.customers <= cap, label).toBe(true);
        expect(s.capped, label).toBe(uncapped > cap);
        expect(h.customers >= s.customers, label).toBe(true);
        expect(new Dec(h.annualRevenue.amount).gte(s.annualRevenue.amount), label).toBe(true);
        expect(h.uncappedCustomers, label).toBe(s.uncappedCustomers);
        if (!s.capped) expect(h.customers, label).toBe(s.customers);
      });
    });
  });

  it('customers are monotone in adoption (higher adoption never yields fewer customers)', async () => {
    await forAll(60, N, genSizingInput, async (input, r, label) => {
      const a = await engine.calculate(input);
      const more = structuredClone(input);
      const base = new Dec(input.adoption.base.value);
      more.adoption.base.value = Dec.min(base.plus(new Dec(int(r, 1, 50)).div(100)), 1).toFixed(2);
      const b = await engine.calculate(more);
      const pa = a.ladder.som.find((s) => s.scenario === 'base')!;
      const pb = b.ladder.som.find((s) => s.scenario === 'base')!;
      expect(pb.customers >= pa.customers, label).toBe(true);
    });
  });
});
