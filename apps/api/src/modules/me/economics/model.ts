/**
 * Economics model plumbing (S08): drivers ↔ EconomicsInput, WS2 engine runs and stored results.
 * Recurring (/year) and one-time money stay separate: the one-time investment is its own nullable
 * engine input and never enters a per-year figure (never-rule 3). No arithmetic on money here.
 */
import {
  EconomicsOutput,
  type CalcCheck,
  type EconomicsDriverKey,
  type EconomicsInput,
  type EngineInput,
  type ValueUnit,
} from '@growth-os/contracts';
import { createEconomicsEngine, ECONOMICS_EXCLUSIONS_TEXT } from '@growth-os/domain';
import type { Tx } from '@growth-os/db';
import { ApiError } from '../../../platform/errors';
import { valueString } from '../assumptions/read';
import type { BaseCtx, CaseRecord } from '../cases/access';
import { currentAssumptionVersions, sizingVersions, storeCalculation } from '../sizing/model';

export const economicsEngine = createEconomicsEngine();

export const DRIVERS: Readonly<Record<EconomicsDriverKey, { label: string; unit: ValueUnit; register: string[] }>> = {
  annual_price: { label: 'Annual price per site', unit: 'currency_per_year_per_site', register: ['annual_price', 'annual_spend_per_site'] },
  'adoption_rate.downside': { label: 'Adoption by year 3 · Downside', unit: 'rate', register: ['adoption_rate.downside'] },
  'adoption_rate.base': { label: 'Adoption by year 3 · Base', unit: 'rate', register: ['adoption_rate.base'] },
  'adoption_rate.upside': { label: 'Adoption by year 3 · Upside', unit: 'rate', register: ['adoption_rate.upside'] },
  gross_margin: { label: 'Gross margin', unit: 'rate', register: ['gross_margin'] },
  annual_incremental_opex: { label: 'Annual incremental opex', unit: 'currency_per_year', register: ['annual_incremental_opex'] },
  capacity: { label: 'Installation and support capacity', unit: 'customers', register: ['capacity'] },
  one_time_investment: { label: 'Scale-entry investment', unit: 'currency_one_time', register: ['one_time_investment'] },
  reachable_pool: { label: 'Reachable pool', unit: 'sites', register: ['reachable_pool'] },
};
const ORDER = Object.keys(DRIVERS) as EconomicsDriverKey[];

const timeBasis = (unit: string) =>
  unit === 'currency_one_time' ? 'one_time' : unit.startsWith('currency_per_year') ? 'per_year' : null;

export type EconomicsVersionRow = {
  id: string;
  case_id: string;
  version: number;
  state: string;
  sizing_version_id: string;
  currency: string;
  price_year: number;
  horizon_years: number;
  exclusions_text: string;
  calculation_result_id: string | null;
  row_version: number;
  committed_at: Date | null;
  committed_by: string | null;
  created_at: Date;
  created_by: string;
};

export async function economicsVersions(tx: Tx, caseId: string): Promise<EconomicsVersionRow[]> {
  return (await tx.selectFrom('me.economics_version').selectAll().where('case_id', '=', caseId).orderBy('version').execute()) as EconomicsVersionRow[];
}

export async function driverRows(tx: Tx, versionId: string) {
  const rows = await tx.selectFrom('me.economics_driver').selectAll().where('economics_version_id', '=', versionId).execute();
  return rows.sort((a, b) => ORDER.indexOf(a.input_key as EconomicsDriverKey) - ORDER.indexOf(b.input_key as EconomicsDriverKey));
}

/** The draft, created from the current version or from the register and the latest committed sizing. */
export async function ensureEconomicsDraft(
  tx: Tx,
  ctx: BaseCtx,
  c: CaseRecord,
  check: (rowVersion: number) => void,
): Promise<EconomicsVersionRow> {
  const versions = await economicsVersions(tx, c.id);
  const draft = versions.find((v) => v.state === 'draft');
  if (draft) {
    check(draft.row_version);
    return draft;
  }
  const sizing = (await sizingVersions(tx, c.id)).filter((v) => v.state === 'committed').pop();
  if (!sizing)
    throw new ApiError('PRECONDITIONS_UNMET', 'Commit a sizing version before modelling economics.', {
      blockers: [{ key: 'comparable_sizing', message: 'Commit a sizing version first.' }],
    });
  const boundary = await tx.selectFrom('me.market_boundary').select(['currency', 'price_year']).where('id', '=', sizing.market_boundary_id).executeTakeFirstOrThrow();
  const current = versions.filter((v) => v.state === 'committed').pop();
  check(current?.row_version ?? 0);
  const next = (versions[versions.length - 1]?.version ?? 0) + 1;
  const d = (await tx
    .insertInto('me.economics_version')
    .values({
      tenant_id: ctx.tenantId,
      case_id: c.id,
      version: next,
      state: 'draft',
      sizing_version_id: sizing.id,
      currency: current?.currency ?? boundary.currency,
      price_year: current?.price_year ?? boundary.price_year,
      horizon_years: current?.horizon_years ?? sizing.horizon_years,
      exclusions_text: current?.exclusions_text ?? ECONOMICS_EXCLUSIONS_TEXT,
      created_by: ctx.userId,
      created_at: ctx.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow()) as EconomicsVersionRow;
  if (current) {
    for (const { id: _i, economics_version_id: _e, assumption_version_id: _p, ...r } of await driverRows(tx, current.id))
      await tx.insertInto('me.economics_driver').values({ ...r, economics_version_id: d.id }).execute();
  } else {
    const register = await tx.selectFrom('platform.assumption').select(['id', 'input_key']).where('case_id', '=', c.id).where('status', '<>', 'retired').execute();
    const live = await currentAssumptionVersions(tx, register.map((r) => r.id));
    for (const key of ORDER) {
      const a = register.find((r) => DRIVERS[key].register.includes(r.input_key));
      const v = a ? live.get(a.id) : undefined;
      if (!a || !v || v.value === null) continue;
      await tx
        .insertInto('me.economics_driver')
        .values({
          tenant_id: ctx.tenantId,
          economics_version_id: d.id,
          input_key: key,
          label: DRIVERS[key].label,
          value: v.value,
          unit: DRIVERS[key].unit,
          time_basis: timeBasis(DRIVERS[key].unit),
          assumption_id: a.id,
        })
        .execute();
    }
  }
  return d;
}

/** Linked drivers follow the register while drafting. */
export async function refreshDrivers(tx: Tx, v: EconomicsVersionRow): Promise<void> {
  if (v.state !== 'draft') return;
  const rows = await driverRows(tx, v.id);
  const live = await currentAssumptionVersions(tx, rows.flatMap((r) => (r.assumption_id ? [r.assumption_id] : [])));
  for (const r of rows) {
    const a = r.assumption_id ? live.get(r.assumption_id) : undefined;
    if (a?.value && valueString(a.value, r.unit) !== valueString(r.value, r.unit))
      await tx.updateTable('me.economics_driver').set({ value: a.value }).where('id', '=', r.id).execute();
  }
}

export async function buildEconomicsInput(tx: Tx, v: EconomicsVersionRow): Promise<{ ok: true; input: EconomicsInput } | { ok: false; checks: CalcCheck[] }> {
  const rows = await driverRows(tx, v.id);
  const pinnedIds = rows.flatMap((r) => (r.assumption_version_id ? [r.assumption_version_id] : []));
  const pinned = pinnedIds.length
    ? await tx.selectFrom('platform.assumption_version').select(['id', 'version']).where('id', 'in', pinnedIds).execute()
    : [];
  const live = await currentAssumptionVersions(tx, rows.flatMap((r) => (r.assumption_id ? [r.assumption_id] : [])));
  const input = (key: EconomicsDriverKey): EngineInput | null => {
    const r = rows.find((x) => x.input_key === key);
    if (!r) return null;
    const p = r.assumption_version_id ? pinned.find((x) => x.id === r.assumption_version_id) : undefined;
    const l = r.assumption_id ? live.get(r.assumption_id) : undefined;
    const money = r.unit.startsWith('currency');
    return {
      inputKey: key,
      label: r.label,
      value: valueString(r.value, r.unit),
      unit: r.unit as ValueUnit,
      kind: 'assumption',
      currency: money ? v.currency : null,
      priceYear: money ? v.price_year : null,
      ref: p
        ? { type: 'assumption_version', id: p.id, version: p.version }
        : l
          ? { type: 'assumption_version', id: l.id, version: l.version }
          : { type: 'calculation', id: r.id, version: null },
    };
  };
  const required: EconomicsDriverKey[] = ['annual_price', 'adoption_rate.base', 'gross_margin', 'annual_incremental_opex', 'capacity', 'reachable_pool'];
  const missing = required.filter((k) => !rows.some((r) => r.input_key === k));
  if (missing.length)
    return {
      ok: false,
      checks: [
        {
          key: 'MISSING_INPUT',
          blocking: true,
          message: `Not available — add ${missing.map((k) => DRIVERS[k].label).join(', ')} before calculating.`,
          inputKeys: missing,
        },
      ],
    };
  return {
    ok: true,
    input: {
      currency: v.currency,
      priceYear: v.price_year,
      horizonYears: v.horizon_years,
      reachablePool: input('reachable_pool')!,
      capacity: input('capacity')!,
      annualPricePerCustomer: input('annual_price')!,
      grossMargin: input('gross_margin')!,
      annualIncrementalOpex: input('annual_incremental_opex')!,
      oneTimeInvestment: input('one_time_investment'),
      adoption: { downside: input('adoption_rate.downside'), base: input('adoption_rate.base')!, upside: input('adoption_rate.upside') },
      cashFlowInputs: { acquisitionRamp: null, retention: null, cashTiming: null, partnerMargin: null, fxAndBaseYearPolicy: null },
    },
  };
}

export async function recalcEconomicsDraft(tx: Tx, tenantId: string, v: EconomicsVersionRow, now: Date) {
  await refreshDrivers(tx, v);
  const built = await buildEconomicsInput(tx, v);
  if (!built.ok) {
    await tx.updateTable('me.economics_version').set({ calculation_result_id: null }).where('id', '=', v.id).where('calculation_result_id', 'is not', null).execute();
    return { output: null, checks: built.checks, input: null };
  }
  const output = EconomicsOutput.parse(await economicsEngine.calculate(built.input));
  const id = await storeCalculation(tx, tenantId, 'economics', built.input, output, now);
  await tx
    .updateTable('me.economics_version')
    .set({ calculation_result_id: id })
    .where('id', '=', v.id)
    .where((eb) => eb.or([eb('calculation_result_id', 'is', null), eb('calculation_result_id', '<>', id)]))
    .execute();
  return { output, checks: output.checks, input: built.input };
}

export { timeBasis };
