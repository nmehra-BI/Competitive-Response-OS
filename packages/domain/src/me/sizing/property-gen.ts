/**
 * Seeded generators for the engines' property tests. Test support only (not exported from the
 * package). A fixed seed keeps every run reproducible; a failing case reports its seed and index.
 */
import type { EconomicsInput, EngineInput, SizingInput } from '@growth-os/contracts';
import { economicsV2Input, sizingV2Input } from '@growth-os/fixtures-aster';

/** mulberry32: tiny deterministic PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export const int = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));

/** A rate "0.xx" (two decimals) in [0, 1]. */
export const rate = (r: Rng): string => {
  const n = int(r, 0, 100);
  return n === 100 ? '1.00' : `0.${String(n).padStart(2, '0')}`;
};

/** A money amount with 2 decimals, below `max` whole units. */
export const money = (r: Rng, max: number): string =>
  `${int(r, 0, max)}.${String(int(r, 0, 99)).padStart(2, '0')}`;

const withValue = (i: EngineInput, value: string): EngineInput => ({ ...structuredClone(i), value });

/** A valid sizing input (no blocking check expected) derived from the Aster fixture's shape. */
export function genSizingInput(r: Rng): SizingInput {
  const input = structuredClone(sizingV2Input);
  const a = int(r, 1, 5000);
  const b = int(r, 1, 5000);
  const overlap = int(r, 0, Math.min(a, b));
  const sam = a + b - overlap;
  input.cohorts[0]!.siteCount = a;
  input.cohorts[1]!.siteCount = b;
  input.overlaps[0]!.overlapCount = overlap;
  input.tamPopulation = withValue(input.tamPopulation, String(int(r, sam, sam + 20000)));
  input.reachablePool = withValue(input.reachablePool, String(int(r, 0, sam)));
  input.annualSpendPerUnit = withValue(input.annualSpendPerUnit, money(r, 200000));
  input.capacity = withValue(input.capacity, String(int(r, 0, 3000)));
  input.adoption = {
    downside: r() < 0.8 ? withValue(sizingV2Input.adoption.downside!, rate(r)) : null,
    base: withValue(sizingV2Input.adoption.base, rate(r)),
    upside: r() < 0.8 ? withValue(sizingV2Input.adoption.upside!, rate(r)) : null,
  };
  return input;
}

/** A valid economics input derived from the Aster fixture's shape. */
export function genEconomicsInput(r: Rng): EconomicsInput {
  const input = structuredClone(economicsV2Input);
  input.reachablePool = withValue(input.reachablePool, String(int(r, 0, 5000)));
  input.capacity = withValue(input.capacity, String(int(r, 0, 3000)));
  input.annualPricePerCustomer = withValue(input.annualPricePerCustomer, money(r, 200000));
  input.grossMargin = withValue(input.grossMargin, rate(r));
  input.annualIncrementalOpex = withValue(input.annualIncrementalOpex, money(r, 5000000));
  input.oneTimeInvestment = withValue(input.oneTimeInvestment!, money(r, 5000000));
  input.adoption = {
    downside: r() < 0.8 ? withValue(economicsV2Input.adoption.downside!, rate(r)) : null,
    base: withValue(economicsV2Input.adoption.base, rate(r)),
    upside: r() < 0.8 ? withValue(economicsV2Input.adoption.upside!, rate(r)) : null,
  };
  return input;
}

/** Runs `n` cases from a fixed seed; the case label names the seed and index on failure. */
export async function forAll<T>(
  seed: number,
  n: number,
  gen: (r: Rng) => T,
  check: (value: T, r: Rng, label: string) => void | Promise<void>,
): Promise<void> {
  const r = prng(seed);
  for (let i = 0; i < n; i++) {
    const v = gen(r);
    await check(v, r, `seed ${seed} case ${i}`);
  }
}
