/**
 * Thin adapter over the deterministic economics engine (S08 live recompute).
 *
 * The screen recomputes a draft locally while the user types, so the scenario table answers
 * immediately; the debounced PATCH then returns the server's own result, which replaces the local
 * one. Both run the same engine on the same input, built by `economicsInputFromDrivers`, so they
 * agree to the last digit (asserted in adapter.test.ts). Committed versions never recalculate.
 *
 * The engine is the WS2 economics engine from `@growth-os/domain` (D-063), the same code the API
 * runs for `economics.calculateDraft`.
 */
import Decimal from 'decimal.js';
import {
  EconomicsInput,
  type EconomicsDriverKey,
  type EconomicsVersion,
  type EngineInput,
  type LedgerRow,
} from '@growth-os/contracts';
import { CASH_FLOW_INPUT_LABELS, createEconomicsEngine } from '@growth-os/domain';

export { CASH_FLOW_INPUT_LABELS };

/** The economics engine (pure; one-time money is never summed with per-year money). */
export const economicsEngine = createEconomicsEngine();

type VersionLike = Pick<EconomicsVersion, 'currency' | 'priceYear' | 'horizonYears' | 'drivers'>;

function engineInput(row: LedgerRow, priceYear: number, value: string): EngineInput {
  let ref: EngineInput['ref'];
  if (row.assumptionId) ref = { type: 'assumption_version', id: row.assumptionId, version: row.version };
  else if (row.basis.source) ref = { type: 'source', id: row.basis.source.sourceId, version: null };
  else throw new Error(`economics driver ${row.inputKey} has no assumption or source`);
  return {
    inputKey: row.inputKey,
    label: row.name,
    value,
    unit: row.unit,
    kind: row.kind,
    currency: row.currency,
    priceYear: row.currency !== null ? priceYear : null,
    ref,
  };
}

/**
 * Engine input for a version's drivers, with optional edited values (inputKey → decimal string).
 * The reachable pool and capacity come from the drivers too (reachable pool is edited in Sizing).
 */
export function economicsInputFromDrivers(
  version: VersionLike,
  edits: Partial<Record<string, string>> = {},
): EconomicsInput {
  const by = new Map(version.drivers.map((d) => [d.inputKey, d]));
  const get = (key: EconomicsDriverKey): EngineInput | null => {
    const row = by.get(key);
    return row ? engineInput(row, version.priceYear, edits[key] ?? row.value) : null;
  };
  const need = (key: EconomicsDriverKey): EngineInput => {
    const v = get(key);
    if (!v) throw new Error(`economics driver ${key} is missing`);
    return v;
  };
  return EconomicsInput.parse({
    currency: version.currency,
    priceYear: version.priceYear,
    horizonYears: version.horizonYears,
    reachablePool: need('reachable_pool'),
    capacity: need('capacity'),
    annualPricePerCustomer: need('annual_price'),
    grossMargin: need('gross_margin'),
    annualIncrementalOpex: need('annual_incremental_opex'),
    oneTimeInvestment: get('one_time_investment'),
    adoption: {
      downside: get('adoption_rate.downside'),
      base: need('adoption_rate.base'),
      upside: get('adoption_rate.upside'),
    },
    cashFlowInputs: {
      acquisitionRamp: null,
      retention: null,
      cashTiming: null,
      partnerMargin: null,
      fxAndBaseYearPolicy: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Edit fields: the prototype edits in display units (€k/year, %, customers, €k one-time).
// These convert between a field's text and the exact decimal string; they never round for
// display (display formatting lives in @growth-os/ui format).
// ---------------------------------------------------------------------------

export interface DriverField {
  inputKey: EconomicsDriverKey;
  prefix: string;
  suffix: string;
  /** Field value = decimal value ÷ scale. */
  scale: number;
  kind: 'money' | 'rate' | 'count';
}

export const DRIVER_FIELDS: Readonly<Partial<Record<EconomicsDriverKey, DriverField>>> = {
  annual_price: { inputKey: 'annual_price', prefix: '€', suffix: 'k/year', scale: 1000, kind: 'money' },
  'adoption_rate.base': {
    inputKey: 'adoption_rate.base',
    prefix: '',
    suffix: '%',
    scale: 0.01,
    kind: 'rate',
  },
  gross_margin: { inputKey: 'gross_margin', prefix: '', suffix: '%', scale: 0.01, kind: 'rate' },
  annual_incremental_opex: {
    inputKey: 'annual_incremental_opex',
    prefix: '€',
    suffix: 'k/year',
    scale: 1000,
    kind: 'money',
  },
  capacity: { inputKey: 'capacity', prefix: '', suffix: 'customers', scale: 1, kind: 'count' },
  one_time_investment: {
    inputKey: 'one_time_investment',
    prefix: '€',
    suffix: 'k one-time',
    scale: 1000,
    kind: 'money',
  },
};

/** "20000.00" → "20" for the €k field; "0.20" → "20" for a % field. */
export function fieldText(field: Pick<DriverField, 'scale'>, value: string): string {
  return new Decimal(value).div(field.scale).toString();
}

const NUMBER = /^\s*-?\d+(\.\d+)?\s*$/;

/**
 * Field text → exact decimal string, or null when the text is not a number. When the number is
 * unchanged the previous string is kept (so "0.20" does not become "0.2" and the input hash holds).
 */
export function fieldValue(
  field: Pick<DriverField, 'scale' | 'kind'>,
  text: string,
  previous: string,
): string | null {
  if (!NUMBER.test(text)) return null;
  const v = new Decimal(text.trim()).times(field.scale);
  if (v.eq(new Decimal(previous))) return previous;
  if (field.kind === 'money') return v.toFixed(Math.max(2, Math.min(8, v.decimalPlaces())));
  if (field.kind === 'rate') return v.toFixed(Math.max(2, Math.min(8, v.decimalPlaces())));
  return v.toFixed(Math.min(8, v.decimalPlaces()));
}
