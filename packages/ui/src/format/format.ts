/**
 * Number and money display rules (UX_RESEARCH.md §6.8, §7.3, §10.5). FROZEN behaviour.
 * Engines return exact decimal strings; these functions round for display only.
 * Exact values live in the ledger (`formatExact`).
 */
import Decimal from 'decimal.js';

const MINUS = '−'; // true minus sign for signed adjustments
const EN_DASH = '–';

function symbol(currency: string): string {
  return currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : `${currency} `;
}

function group(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "5,000" — counts use a thousands separator. */
export function formatCount(n: number): string {
  return group(String(Math.trunc(Math.abs(n)))).replace(/^/, n < 0 ? MINUS : '');
}

/** "−500" with U+2212 for negatives; "+" is never added. */
export function formatSigned(n: number): string {
  return formatCount(n);
}

/** "20%" — whole percent for assumptions; never "20.0%". Input is a fraction string such as "0.20". */
export function formatRate(fraction: string): string {
  return `${new Decimal(fraction).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString()}%`;
}

/** €m with a fixed number of decimals: ("2400000.00", 1) → "€2.4m". */
export function formatMillions(amount: string, currency: string, decimals: number): string {
  const d = new Decimal(amount);
  const sign = d.isNegative() ? MINUS : '';
  return `${sign}${symbol(currency)}${d.abs().div(1_000_000).toFixed(decimals)}m`;
}

/** €k with no decimals: "600000.00" → "€600k". Zero → "€0k". */
export function formatThousands(amount: string, currency: string): string {
  const d = new Decimal(amount);
  const sign = d.isNegative() ? MINUS : '';
  return `${sign}${symbol(currency)}${group(d.abs().div(1000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString())}k`;
}

/** Annual market spend: "€100m/year", "€40m/year" (no decimals: inputs are rounded counts). */
export function formatMarketSpend(amount: string, currency: string): string {
  return `${formatMillions(amount, currency, 0)}/year`;
}

/** Scenario revenue cell: "€2.0m" (research: revenue in €m with one decimal). */
export function formatScenarioRevenue(amount: string, currency: string): string {
  return formatMillions(amount, currency, 1);
}

/** Gross contribution cell: "€1.44m" (two decimals, as the PRD fixes €1.44m). */
export function formatGrossContribution(amount: string, currency: string): string {
  return formatMillions(amount, currency, 2);
}

/** Opex and contribution-after-opex cells: "€600k"; a true zero reads "€0k (break-even)", never blank. */
export function formatContributionK(amount: string, currency: string): string {
  return new Decimal(amount).isZero()
    ? `${symbol(currency)}0k (break-even)`
    : formatThousands(amount, currency);
}

/** One-time money always says so: "€400k one-time". */
export function formatOneTime(amount: string, currency: string): string {
  return `${formatThousands(amount, currency)} one-time`;
}

/** Budgets: "€120k", "€15k". */
export function formatBudget(amount: string, currency: string): string {
  return formatThousands(amount, currency);
}

/** Ranges use an en dash and the unit once: "€35–50m/year". */
export function formatRangeMillions(low: string, high: string, currency: string, suffix = '/year'): string {
  const l = new Decimal(low).div(1_000_000).toDecimalPlaces(0).toString();
  const h = new Decimal(high).div(1_000_000).toDecimalPlaces(0).toString();
  return `${symbol(currency)}${l}${EN_DASH}${h}m${suffix}`;
}

/** Exact ledger value: "€40,000,000". */
export function formatExact(amount: string, currency: string): string {
  const d = new Decimal(amount);
  const [i, f] = d.abs().toFixed(2).split('.') as [string, string];
  const sign = d.isNegative() ? MINUS : '';
  return `${sign}${symbol(currency)}${group(i)}${f === '00' ? '' : `.${f}`}`;
}

/** "x of y" for threshold ratios: "3 of 4". */
export function formatOf(x: number, y: number): string {
  return `${x} of ${y}`;
}

/** Missing values are never zero: "Not available — finance source unavailable". */
export function formatNotAvailable(reason: string): string {
  return `Not available ${'—'} ${reason}`;
}
