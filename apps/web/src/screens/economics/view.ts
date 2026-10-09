/**
 * Pure view helpers for S08 Economics. Money is displayed only through @growth-os/ui format
 * (research §10.5): revenue €m one decimal, gross contribution €m two decimals, opex and
 * contribution after opex in €k, a true zero as "€0k (break-even)".
 */
import Decimal from 'decimal.js';
import type {
  EconomicsOutput,
  EconomicsScenarioOutput,
  EconomicsVersion,
  LedgerRow,
  Scenario,
} from '@growth-os/contracts';
import {
  formatContributionK,
  formatCount,
  formatGrossContribution,
  formatRate,
  formatScenarioRevenue,
  formatThousands,
} from '@growth-os/ui';

export const SCENARIOS: Scenario[] = ['downside', 'base', 'upside'];

export type MeasureKey = 'customers' | 'revenue' | 'gross' | 'opex' | 'after';

export const MEASURES: { key: MeasureKey; label: string; formula: string; strong?: boolean }[] = [
  { key: 'customers', label: 'Customers · end of year 3', formula: 'min(reachable × adoption, capacity)' },
  { key: 'revenue', label: 'Annual revenue', formula: 'customers × price' },
  { key: 'gross', label: 'Gross contribution', formula: 'revenue × margin' },
  { key: 'opex', label: 'Annual incremental opex', formula: 'input' },
  {
    key: 'after',
    label: 'Contribution after incremental opex',
    formula: 'gross contribution − opex',
    strong: true,
  },
];

export function capacityOf(drivers: LedgerRow[]): number | null {
  const c = drivers.find((d) => d.inputKey === 'capacity');
  return c ? Number(c.value) : null;
}

/** Raw comparable value of a cell (decimal string or count) — used to flag "Recalculated" cells. */
export function rawCell(s: EconomicsScenarioOutput, m: MeasureKey): string {
  switch (m) {
    case 'customers':
      return String(s.customers);
    case 'revenue':
      return s.annualRevenue.amount;
    case 'gross':
      return s.grossContribution.amount;
    case 'opex':
      return s.annualIncrementalOpex.amount;
    case 'after':
      return s.contributionAfterOpex.amount;
  }
}

export function cellText(s: EconomicsScenarioOutput, m: MeasureKey, capacity: number | null): string {
  switch (m) {
    case 'customers':
      return `${formatCount(s.customers)}${s.capped && capacity !== null ? ` · capped at ${formatCount(capacity)}` : ''}`;
    case 'revenue':
      return formatScenarioRevenue(s.annualRevenue.amount, s.annualRevenue.currency);
    case 'gross':
      return formatGrossContribution(s.grossContribution.amount, s.grossContribution.currency);
    case 'opex':
      return formatThousands(s.annualIncrementalOpex.amount, s.annualIncrementalOpex.currency);
    case 'after':
      return formatContributionK(s.contributionAfterOpex.amount, s.contributionAfterOpex.currency);
  }
}

/** True when the cell differs from the committed snapshot (decimal comparison, not string). */
export function differs(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a !== b;
  return !new Decimal(a).eq(new Decimal(b));
}

export function scenarioOf(r: EconomicsOutput | null | undefined, sc: Scenario) {
  return r?.scenarios.find((x) => x.scenario === sc);
}

/** "What must be true?" working: "€600k ÷ (€20k × 60%)". */
export function breakEvenWorking(
  v: Pick<EconomicsVersion, 'currency'>,
  drivers: Record<string, string>,
): string {
  const opex = drivers['annual_incremental_opex'];
  const price = drivers['annual_price'];
  const margin = drivers['gross_margin'];
  if (!opex || !price || !margin) return '';
  return `${formatThousands(opex, v.currency)} ÷ (${formatThousands(price, v.currency)} × ${formatRate(margin)})`;
}

/** Share of the reachable pool as a whole percent ("10%"). */
export function shareOfPool(customers: number, reachable: string | undefined): string | null {
  if (!reachable || new Decimal(reachable).isZero()) return null;
  return formatRate(new Decimal(customers).div(reachable).toString());
}
