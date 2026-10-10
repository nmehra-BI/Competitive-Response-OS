/**
 * S08 economics driver editor (D-112 §3): the form a draft autosaves and the `economics.saveDraft`
 * body it sends. Pure; the screen and its tests use it.
 *
 * Rules: currency and base year once in the header; a blank driver is cleared (Unknown, never 0);
 * a driver can follow an assumption of the register (same unit) or hold a draft value; the one-time
 * investment is its own driver and is never added to a /year figure (never-rule 3).
 */
import type { EconomicsDriverKey, EconomicsVersion, ValueUnit } from '@growth-os/contracts';
import type { API } from '@growth-os/contracts';
import type { ApiBody } from '../../lib/api-client';

export type SaveBody = ApiBody<typeof API.economics.saveDraft>;

/** Recurring drivers in table order. The one-time investment has its own block. */
export const RECURRING_ORDER = [
  'annual_price',
  'adoption_rate.downside',
  'adoption_rate.base',
  'adoption_rate.upside',
  'gross_margin',
  'annual_incremental_opex',
  'capacity',
] as const satisfies readonly EconomicsDriverKey[];

export const ONE_TIME_KEY = 'one_time_investment' satisfies EconomicsDriverKey;

/** Labels and units as the server stores them (a missing driver still needs its row). */
export const DRIVER_SPECS: Readonly<Record<EconomicsDriverKey, { label: string; unit: ValueUnit }>> = {
  annual_price: { label: 'Annual price per site', unit: 'currency_per_year_per_site' },
  'adoption_rate.downside': { label: 'Adoption by year 3 · Downside', unit: 'rate' },
  'adoption_rate.base': { label: 'Adoption by year 3 · Base', unit: 'rate' },
  'adoption_rate.upside': { label: 'Adoption by year 3 · Upside', unit: 'rate' },
  gross_margin: { label: 'Gross margin', unit: 'rate' },
  annual_incremental_opex: { label: 'Annual incremental opex', unit: 'currency_per_year' },
  capacity: { label: 'Installation and support capacity', unit: 'customers' },
  one_time_investment: { label: 'Scale-entry investment', unit: 'currency_one_time' },
  reachable_pool: { label: 'Reachable pool', unit: 'sites' },
};

/** Drivers the engine needs before it calculates (the server's MISSING_INPUT list). */
export const REQUIRED_DRIVERS: readonly EconomicsDriverKey[] = [
  'annual_price',
  'adoption_rate.base',
  'gross_margin',
  'annual_incremental_opex',
  'capacity',
  'reachable_pool',
];

export interface EconForm {
  /** Driver value as a decimal string; '' = cleared (Unknown). */
  values: Record<string, string>;
  /** Linked assumption per driver; null = a draft value. */
  links: Record<string, string | null>;
  currency: string;
  priceYear: string;
  horizonYears: string;
  opexScopeNote: string;
}

const SCOPE = 'Scope: ';

/** The opex scope note the server returns as the basis of the opex row ("Scope: …"). */
export function opexScopeOf(v: Pick<EconomicsVersion, 'drivers'>): string {
  const t = v.drivers.find((d) => d.inputKey === 'annual_incremental_opex')?.basis.text ?? '';
  return t.startsWith(SCOPE) ? t.slice(SCOPE.length) : '';
}

export function econFormOf(v: EconomicsVersion): EconForm {
  return {
    values: Object.fromEntries(v.drivers.map((d) => [d.inputKey, d.value])),
    links: Object.fromEntries(v.drivers.map((d) => [d.inputKey, d.assumptionId])),
    currency: v.currency,
    priceYear: String(v.priceYear),
    horizonYears: String(v.horizonYears),
    opexScopeNote: opexScopeOf(v),
  };
}

/** Values without cleared drivers (never let a blank reach a calculation as 0). */
export function enteredValues(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
}

export function missingDrivers(form: EconForm): EconomicsDriverKey[] {
  return REQUIRED_DRIVERS.filter((k) => !form.values[k]);
}

const YEAR = /^\s*(19|20|21)\d\d\s*$/;
const INT = /^\s*\d+\s*$/;

/** The PATCH body that turns the server draft into the form. */
export function saveBody(form: EconForm, server: EconomicsVersion): SaveBody {
  const has = new Map(server.drivers.map((d) => [d.inputKey, d]));
  const keys: EconomicsDriverKey[] = [...RECURRING_ORDER, ONE_TIME_KEY, 'reachable_pool'];
  const drivers: SaveBody['drivers'] = [];
  const clear: string[] = [];
  for (const k of keys) {
    const v = form.values[k];
    const before = has.get(k);
    const link = form.links[k] ?? null;
    const linkChanged = link !== (before?.assumptionId ?? null);
    if (v === '' || v === undefined) {
      if (before) clear.push(k);
      continue;
    }
    // The reachable pool comes from sizing; it is only sent when (re)linked here.
    if (k === 'reachable_pool' && !linkChanged) continue;
    drivers.push({ inputKey: k, value: v, ...(linkChanged ? { assumptionId: link } : {}) });
  }
  const body: SaveBody = { drivers };
  if (clear.length) body.clearInputKeys = clear;
  const cur = form.currency.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(cur) && cur !== server.currency) body.currency = cur;
  if (YEAR.test(form.priceYear) && Number(form.priceYear) !== server.priceYear)
    body.priceYear = Number(form.priceYear);
  if (
    INT.test(form.horizonYears) &&
    Number(form.horizonYears) > 0 &&
    Number(form.horizonYears) !== server.horizonYears
  )
    body.horizonYears = Number(form.horizonYears);
  const note = form.opexScopeNote.trim();
  if (note && note !== opexScopeOf(server)) body.opexScopeNote = note;
  return body;
}
