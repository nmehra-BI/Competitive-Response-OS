// PORT (WS8b): verbatim copy of the WS2 domain engine (branch worktree-agent-aa0d31ef83422e2fc @ e0958a5),
// imports adjusted only. Delete this folder when @growth-os/domain ships the engines; see ./adapter.ts.
/**
 * Exact decimal arithmetic and typed money for the Market Expansion engines (D-010).
 *
 * - Every computation uses `Dec` (decimal.js with 50 significant digits, half-even rounding). JS floats
 *   never touch money, rates or counts.
 * - Recurring (`per_year`) and one-time money are different TypeScript types. Arithmetic exists only
 *   for `PerYearAmount`; there is no function that accepts a `OneTimeAmount` together with a
 *   `PerYearAmount`, so summing, subtracting or comparing them does not compile (CLAUDE.md rule 3).
 * - Text helpers here produce exact "formula with values" strings for lineage. They never round.
 *   Display rounding belongs to packages/ui/src/format.
 */
import Decimal from 'decimal.js';
import type { Money, MoneyMeasure, ValueUnit } from '@growth-os/contracts';

export const Dec = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_EVEN });
export type Dec = InstanceType<typeof Dec>;

/** Maximum fraction digits a DecimalString may carry. */
const MAX_DP = 8;

export function dec(value: string | number): Dec {
  return new Dec(value);
}

/** Exact decimal string with at least 2 and at most 8 fraction digits (money and amounts). */
export function toAmountString(value: Dec): string {
  const v = value.toDecimalPlaces(MAX_DP, Dec.ROUND_HALF_EVEN);
  if (v.isZero()) return '0.00';
  return v.toFixed(Math.max(2, v.decimalPlaces()));
}

/** Exact decimal string without forced fraction digits (rates such as "0.20" keep their input form). */
export function toDecimalString(value: Dec): string {
  const v = value.toDecimalPlaces(MAX_DP, Dec.ROUND_HALF_EVEN);
  return v.isZero() ? '0' : v.toFixed();
}

export function isWholeNonNegative(value: Dec): boolean {
  return value.isInteger() && !value.isNegative();
}

export function inUnitInterval(value: Dec): boolean {
  return value.gte(0) && value.lte(1);
}

// ---------------------------------------------------------------------------
// Typed money: per-year and one-time are distinct, non-interchangeable types
// ---------------------------------------------------------------------------

type PerYearMeasure = Exclude<
  MoneyMeasure,
  | 'one_time_investment'
  | 'approved_budget'
  | 'requested_budget'
  | 'committed_spend'
  | 'spent_to_date'
  | 'remaining_budget'
>;

declare const perYearBrand: unique symbol;
declare const oneTimeBrand: unique symbol;

/** A recurring amount per year. Only these can be added or subtracted, and only with each other. */
export interface PerYearAmount {
  readonly [perYearBrand]: 'per_year';
  readonly timeBasis: 'per_year';
  readonly measure: PerYearMeasure;
  readonly amount: Dec;
  readonly currency: string;
  readonly priceYear: number;
}

/** A one-time amount. It has no arithmetic at all in this module. */
export interface OneTimeAmount {
  readonly [oneTimeBrand]: 'one_time';
  readonly timeBasis: 'one_time';
  readonly measure: 'one_time_investment';
  readonly amount: Dec;
  readonly currency: string;
  readonly priceYear: number;
}

export function perYear(
  measure: PerYearMeasure,
  amount: Dec,
  currency: string,
  priceYear: number,
): PerYearAmount {
  return { timeBasis: 'per_year', measure, amount, currency, priceYear } as PerYearAmount;
}

export function oneTime(amount: Dec, currency: string, priceYear: number): OneTimeAmount {
  return {
    timeBasis: 'one_time',
    measure: 'one_time_investment',
    amount,
    currency,
    priceYear,
  } as OneTimeAmount;
}

function assertSameMoneyBasis(a: PerYearAmount, b: PerYearAmount): void {
  if (a.currency !== b.currency || a.priceYear !== b.priceYear) {
    throw new Error('per-year arithmetic across currencies or price years is not allowed');
  }
}

/** Per-year minus per-year (e.g. gross contribution − annual incremental opex). */
export function subtractPerYear(measure: PerYearMeasure, a: PerYearAmount, b: PerYearAmount): PerYearAmount {
  assertSameMoneyBasis(a, b);
  return perYear(measure, a.amount.minus(b.amount), a.currency, a.priceYear);
}

/** Per-year plus per-year (e.g. target contribution + opex in break-even). */
export function addPerYear(measure: PerYearMeasure, a: PerYearAmount, b: PerYearAmount): PerYearAmount {
  assertSameMoneyBasis(a, b);
  return perYear(measure, a.amount.plus(b.amount), a.currency, a.priceYear);
}

/** Per-year scaled by a dimensionless factor (customers, a rate). */
export function scalePerYear(measure: PerYearMeasure, a: PerYearAmount, factor: Dec): PerYearAmount {
  return perYear(measure, a.amount.times(factor), a.currency, a.priceYear);
}

/** Serialize to the frozen `Money` contract shape. */
export function toMoney(value: PerYearAmount | OneTimeAmount): Money {
  return {
    amount: toAmountString(value.amount),
    currency: value.currency,
    measure: value.measure,
    timeBasis: value.timeBasis,
    priceYear: value.priceYear,
  };
}

// ---------------------------------------------------------------------------
// SOM customers (shared by sizing and economics so both engines agree exactly)
// ---------------------------------------------------------------------------

export interface CustomerCount {
  uncappedCustomers: number;
  customers: number;
  capped: boolean;
}

/** customers = min(floor(reachable × adoption), capacity). Never negative. */
export function capCustomers(reachable: Dec, adoption: Dec, capacity: Dec): CustomerCount {
  const uncapped = Dec.max(reachable.times(adoption).floor(), 0);
  const cap = Dec.max(capacity.floor(), 0);
  const capped = uncapped.gt(cap);
  return {
    uncappedCustomers: uncapped.toNumber(),
    customers: (capped ? cap : uncapped).toNumber(),
    capped,
  };
}

// ---------------------------------------------------------------------------
// Exact text for formulas (lineage). Not display rounding: every digit is kept.
// ---------------------------------------------------------------------------

const MINUS = '−';
const CURRENCY_SYMBOL: Readonly<Record<string, string>> = { EUR: '€', USD: '$', GBP: '£' };

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "1,400", "−500", "12.5" — exact. */
export function fmtNumber(value: Dec | number): string {
  const v = typeof value === 'number' ? new Dec(value) : value;
  const neg = v.isNegative() && !v.isZero();
  const [i = '0', f] = v.abs().toFixed().split('.');
  return `${neg ? MINUS : ''}${group(i)}${f ? `.${f}` : ''}`;
}

/** "€20,000", "€40,000,000", "€0.50" — exact, fraction shown only when non-zero. */
export function fmtMoney(value: Dec, currency: string): string {
  const neg = value.isNegative() && !value.isZero();
  const abs = value.abs();
  const body = abs.isInteger() ? group(abs.toFixed(0)) : fmtNumber(abs.toDecimalPlaces(MAX_DP));
  const sym = CURRENCY_SYMBOL[currency];
  return `${neg ? MINUS : ''}${sym ?? `${currency} `}${body}`;
}

/** "20%", "12.5%" — exact. */
export function fmtRate(value: Dec): string {
  return `${fmtNumber(value.times(100))}%`;
}

export const POPULATION_VALUE_UNIT = {
  site: 'sites',
  company: 'companies',
  customer: 'customers',
} as const satisfies Record<string, ValueUnit>;

export function unitWord(unit: ValueUnit): string {
  return unit === 'sites' || unit === 'companies' || unit === 'customers' ? unit : 'units';
}
