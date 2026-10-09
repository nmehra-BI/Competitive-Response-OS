/**
 * Engine outputs for the demo's committed sizing v2 and economics v2.
 *
 * The seed runs the real deterministic engines from packages/domain (WS2) and then checks the
 * result against the fixture's golden expectations (fixtures/aster expected.ts). A mismatch aborts
 * the seed: the demo never shows numbers the engines did not produce, and never shows engine
 * numbers that disagree with the PRD.
 */
import { EconomicsOutput, SizingOutput, type EconomicsInput, type SizingInput } from '@growth-os/contracts';
import { createEconomicsEngine, createSizingEngine } from '@growth-os/domain';
import { expectedEconomics, expectedSizing } from '@growth-os/fixtures-aster';

export interface EngineRun<T> {
  output: T;
  engineVersion: string;
  inputHash: string;
  blocked: boolean;
}

const SCENARIOS = ['downside', 'base', 'upside'] as const;

function check(mismatches: string[], path: string, actual: unknown, expected: unknown): void {
  if (actual !== expected)
    mismatches.push(`${path}: engine ${JSON.stringify(actual)}, golden ${JSON.stringify(expected)}`);
}

/** Every golden sizing value the fixture fixes; returns the differences (empty = match). */
export function sizingGoldenMismatches(out: SizingOutput): string[] {
  const m: string[] = [];
  const e = expectedSizing;
  check(m, 'blocked', out.blocked, false);
  check(m, 'blockingChecks', out.checks.filter((c) => c.blocking).length, e.blockingChecks.length);
  check(m, 'tam.population', out.ladder.tam.population, e.tam.population);
  check(m, 'tam.value', out.ladder.tam.value.amount, e.tam.value);
  check(m, 'sam.population', out.ladder.sam.population, e.sam.population);
  check(m, 'sam.cohortSum', out.ladder.sam.cohortSum, e.sam.cohortSum);
  check(m, 'sam.overlapRemoved', out.ladder.sam.overlapRemoved, e.sam.overlapRemoved);
  check(m, 'sam.value', out.ladder.sam.value.amount, e.sam.value);
  check(m, 'reachablePool.population', out.ladder.reachablePool.population, e.reachablePool.population);
  for (const s of SCENARIOS) {
    const row = out.ladder.som.find((r) => r.scenario === s);
    check(m, `som.${s}.present`, Boolean(row), true);
    if (!row) continue;
    check(m, `som.${s}.uncappedCustomers`, row.uncappedCustomers, e.som[s].uncappedCustomers);
    check(m, `som.${s}.customers`, row.customers, e.som[s].customers);
    check(m, `som.${s}.capped`, row.capped, e.som[s].capped);
    check(m, `som.${s}.annualRevenue`, row.annualRevenue.amount, e.som[s].annualRevenue);
  }
  return m;
}

/** Every golden economics value the fixture fixes; returns the differences (empty = match). */
export function economicsGoldenMismatches(out: EconomicsOutput): string[] {
  const m: string[] = [];
  const e = expectedEconomics;
  check(m, 'blocked', out.blocked, false);
  for (const s of SCENARIOS) {
    const row = out.scenarios.find((r) => r.scenario === s);
    check(m, `${s}.present`, Boolean(row), true);
    if (!row) continue;
    check(m, `${s}.customers`, row.customers, e[s].customers);
    check(m, `${s}.annualRevenue`, row.annualRevenue.amount, e[s].annualRevenue);
    check(m, `${s}.grossContribution`, row.grossContribution.amount, e[s].grossContribution);
    check(m, `${s}.annualIncrementalOpex`, row.annualIncrementalOpex.amount, e[s].annualIncrementalOpex);
    check(m, `${s}.contributionAfterOpex`, row.contributionAfterOpex.amount, e[s].contributionAfterOpex);
  }
  check(m, 'upside.capped', out.scenarios.find((r) => r.scenario === 'upside')?.capped, e.upside.capped);
  const oneTime = 'amount' in out.oneTimeInvestment ? out.oneTimeInvestment.amount : null;
  check(m, 'oneTimeInvestment', oneTime, e.oneTimeInvestment);
  check(m, 'breakEven.customers', out.breakEven?.customers ?? null, e.breakEvenCustomers);
  check(m, 'cashFlow.available', !('unavailable' in out.cashFlow), e.cashFlowAvailable);
  check(m, 'payback.available', !('unavailable' in out.payback), e.paybackAvailable);
  return m;
}

function assertGolden(engine: string, mismatches: string[]): void {
  if (mismatches.length > 0)
    throw new Error(
      `seed: ${engine} engine output differs from the Aster golden values:\n  ${mismatches.join('\n  ')}`,
    );
}

export async function sizingRun(input: SizingInput): Promise<EngineRun<SizingOutput>> {
  const output = SizingOutput.parse(await createSizingEngine().calculate(input));
  assertGolden('sizing', sizingGoldenMismatches(output));
  return {
    output,
    engineVersion: output.engineVersion,
    inputHash: output.inputHash,
    blocked: output.blocked,
  };
}

export async function economicsRun(input: EconomicsInput): Promise<EngineRun<EconomicsOutput>> {
  const output = EconomicsOutput.parse(await createEconomicsEngine().calculate(input));
  assertGolden('economics', economicsGoldenMismatches(output));
  return {
    output,
    engineVersion: output.engineVersion,
    inputHash: output.inputHash,
    blocked: output.blocked,
  };
}
