/**
 * Sizing model plumbing: rebuild the frozen SizingInput from a version's rows, run the WS2 engine,
 * store the deterministic result in platform.calculation_result (same input hash → same row) and link
 * it to the version. Assumption-backed inputs read the assumption's CURRENT version while a draft
 * (live link) and are pinned to that version at commit. No money is computed here (D-054).
 */
import { SizingOutput, type CalcCheck, type EngineInput, type SizingInput, type ValueUnit } from '@growth-os/contracts';
import { createSizingEngine } from '@growth-os/domain';
import type { Tx } from '@growth-os/db';
import { valueString } from '../assumptions/read';

export const sizingEngine = createSizingEngine();

export const SIZING_INPUT_LABELS: Readonly<Record<string, string>> = {
  tam_site_count: 'TAM site count',
  annual_spend_per_site: 'Annual spend per site',
  reachable_pool: 'Reachable pool',
  'adoption_rate.downside': 'Adoption by year 3 · Downside',
  'adoption_rate.base': 'Adoption by year 3 · Base',
  'adoption_rate.upside': 'Adoption by year 3 · Upside',
  capacity: 'Installation and support capacity',
};

export type SizingVersionRow = {
  id: string;
  case_id: string;
  version: number;
  state: string;
  method: string;
  horizon_years: number;
  market_boundary_id: string;
  dedup_rule_text: string;
  calculation_result_id: string | null;
  row_version: number;
  committed_at: Date | null;
  committed_by: string | null;
  created_at: Date;
  created_by: string;
};

export async function sizingVersions(tx: Tx, caseId: string): Promise<SizingVersionRow[]> {
  return (await tx
    .selectFrom('me.sizing_version')
    .selectAll()
    .where('case_id', '=', caseId)
    .orderBy('version')
    .execute()) as SizingVersionRow[];
}

export async function storeCalculation(
  tx: Tx,
  tenantId: string,
  engine: 'sizing' | 'economics',
  input: unknown,
  output: { engineVersion: string; inputHash: string; blocked: boolean },
  now: Date,
): Promise<string> {
  const existing = await tx
    .selectFrom('platform.calculation_result')
    .select('id')
    .where('engine', '=', engine)
    .where('engine_version', '=', output.engineVersion)
    .where('input_hash', '=', output.inputHash)
    .executeTakeFirst();
  if (existing) return existing.id;
  const row = await tx
    .insertInto('platform.calculation_result')
    .values({
      tenant_id: tenantId,
      engine,
      engine_version: output.engineVersion,
      input_hash: output.inputHash,
      input: JSON.stringify(input),
      output: JSON.stringify(output),
      blocked: output.blocked,
      created_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Live assumption values for draft inputs. */
export async function currentAssumptionVersions(tx: Tx, assumptionIds: readonly string[]) {
  if (assumptionIds.length === 0) return new Map<string, { id: string; version: number; value: string | null; unit: string; currency: string | null; price_year: number | null; evidence_quality: string }>();
  const rows = await tx
    .selectFrom('platform.assumption as a')
    .innerJoin('platform.assumption_version as v', 'v.id', 'a.current_version_id')
    .select(['a.id as assumption_id', 'v.id', 'v.version', 'v.value', 'v.unit', 'v.currency', 'v.price_year', 'v.evidence_quality'])
    .where('a.id', 'in', [...assumptionIds])
    .execute();
  return new Map(rows.map((r) => [r.assumption_id, r]));
}

/** Refresh assumption-backed draft rows to the assumption's current value (drafts follow the register). */
export async function refreshDraftInputs(tx: Tx, v: SizingVersionRow): Promise<void> {
  if (v.state !== 'draft') return;
  const inputs = await tx.selectFrom('me.sizing_input').selectAll().where('sizing_version_id', '=', v.id).execute();
  const live = await currentAssumptionVersions(tx, inputs.flatMap((i) => (i.assumption_id ? [i.assumption_id] : [])));
  for (const i of inputs) {
    const a = i.assumption_id ? live.get(i.assumption_id) : undefined;
    if (!a || a.value === null) continue;
    if (valueString(a.value, a.unit) !== valueString(i.value, i.unit) || i.evidence_quality !== a.evidence_quality)
      await tx
        .updateTable('me.sizing_input')
        .set({ value: a.value, evidence_quality: a.evidence_quality, currency: a.currency ?? i.currency, price_year: a.price_year ?? i.price_year })
        .where('id', '=', i.id)
        .execute();
  }
}

export type BuiltInput = { ok: true; input: SizingInput } | { ok: false; checks: CalcCheck[] };

/** Rebuild the engine input from the version rows. Missing required inputs → MISSING_INPUT checks. */
export async function buildSizingInput(tx: Tx, v: SizingVersionRow): Promise<BuiltInput> {
  const b = await tx.selectFrom('me.market_boundary').selectAll().where('id', '=', v.market_boundary_id).executeTakeFirstOrThrow();
  const inputs = await tx.selectFrom('me.sizing_input').selectAll().where('sizing_version_id', '=', v.id).execute();
  const cohorts = await tx.selectFrom('me.cohort').selectAll().where('sizing_version_id', '=', v.id).orderBy('ordinal').execute();
  const overlaps = await tx.selectFrom('me.cohort_overlap').selectAll().where('sizing_version_id', '=', v.id).execute();
  const cross = await tx.selectFrom('me.sizing_cross_check').selectAll().where('sizing_version_id', '=', v.id).executeTakeFirst();
  const pinned = await currentAssumptionVersions(tx, inputs.flatMap((i) => (i.assumption_id ? [i.assumption_id] : [])));
  const versionIds = inputs.flatMap((i) => (i.assumption_version_id ? [i.assumption_version_id] : []));
  const pinnedRows = versionIds.length
    ? await tx.selectFrom('platform.assumption_version').select(['id', 'version']).where('id', 'in', versionIds).execute()
    : [];

  const toInput = (key: string): EngineInput | null => {
    const i = inputs.find((x) => x.input_key === key);
    if (!i) return null;
    let ref: EngineInput['ref'];
    if (i.kind === 'assumption' && i.assumption_id) {
      const p = i.assumption_version_id ? pinnedRows.find((r) => r.id === i.assumption_version_id) : undefined;
      const live = pinned.get(i.assumption_id);
      ref = p
        ? { type: 'assumption_version', id: p.id, version: p.version }
        : { type: 'assumption_version', id: live!.id, version: live!.version };
    } else if (i.source_id) ref = { type: 'source', id: i.source_id, version: null };
    else ref = { type: 'calculation', id: i.id, version: null };
    return {
      inputKey: i.input_key,
      label: i.label,
      value: valueString(i.value, i.unit),
      unit: i.unit as ValueUnit,
      kind: i.kind as EngineInput['kind'],
      currency: i.currency,
      priceYear: i.price_year,
      ref,
    };
  };
  const required = ['tam_site_count', 'annual_spend_per_site', 'reachable_pool', 'adoption_rate.base', 'capacity'];
  const missing = required.filter((k) => !inputs.some((i) => i.input_key === k));
  if (missing.length > 0)
    return {
      ok: false,
      checks: [
        {
          key: 'MISSING_INPUT',
          blocking: true,
          message: `Not available — add ${missing.map((k) => SIZING_INPUT_LABELS[k] ?? k).join(', ')} before calculating.`,
          inputKeys: missing,
        },
      ],
    };
  const input: SizingInput = {
    boundary: {
      marketUnit: b.market_unit,
      populationUnit: b.population_unit as SizingInput['boundary']['populationUnit'],
      countryCode: b.country_code,
      segmentLabel: b.segment_label,
      currency: b.currency,
      priceYear: b.price_year,
      annualizationMethod: b.annualization_method,
      includesOneTimeSpend: b.includes_replacement,
    },
    method: v.method as SizingInput['method'],
    horizonYears: v.horizon_years,
    tamPopulation: toInput('tam_site_count')!,
    annualSpendPerUnit: toInput('annual_spend_per_site')!,
    cohorts: cohorts.map((c) => ({
      cohortId: c.id,
      name: c.name,
      rule: c.rule,
      siteCount: c.site_count,
      populationUnit: c.population_unit as 'site',
      priceYear: c.price_year,
      status: c.status as 'active',
      ref: c.source_id ? { type: 'source', id: c.source_id, version: null } : { type: 'cohort', id: c.id, version: null },
    })),
    overlaps: overlaps.map((o) => ({
      cohortAId: o.cohort_a_id,
      cohortBId: o.cohort_b_id,
      overlapCount: o.overlap_count,
      ref: { type: 'calculation', id: o.id, version: null },
    })),
    reachablePool: toInput('reachable_pool')!,
    adoption: {
      downside: toInput('adoption_rate.downside'),
      base: toInput('adoption_rate.base')!,
      upside: toInput('adoption_rate.upside'),
    },
    capacity: toInput('capacity')!,
    crossCheck: cross
      ? {
          measure: 'sam',
          low: valueString(cross.low, 'currency_per_year'),
          high: valueString(cross.high, 'currency_per_year'),
          currency: cross.currency,
          priceYear: cross.price_year,
          illustrative: cross.illustrative,
        }
      : null,
  };
  return { ok: true, input };
}

export interface Recalc {
  output: SizingOutput | null;
  checks: CalcCheck[];
  calculationResultId: string | null;
}

/** Recalculate a DRAFT and link the result (or unlink when inputs are incomplete). */
export async function recalcSizingDraft(tx: Tx, tenantId: string, v: SizingVersionRow, now: Date): Promise<Recalc> {
  await refreshDraftInputs(tx, v);
  const built = await buildSizingInput(tx, v);
  if (!built.ok) {
    await tx
      .updateTable('me.sizing_version')
      .set({ calculation_result_id: null })
      .where('id', '=', v.id)
      .where('calculation_result_id', 'is not', null)
      .execute();
    return { output: null, checks: built.checks, calculationResultId: null };
  }
  const output = SizingOutput.parse(await sizingEngine.calculate(built.input));
  const id = await storeCalculation(tx, tenantId, 'sizing', built.input, output, now);
  await tx
    .updateTable('me.sizing_version')
    .set({ calculation_result_id: id })
    .where('id', '=', v.id)
    .where((eb) => eb.or([eb('calculation_result_id', 'is', null), eb('calculation_result_id', '<>', id)]))
    .execute();
  return { output, checks: output.checks, calculationResultId: id };
}
