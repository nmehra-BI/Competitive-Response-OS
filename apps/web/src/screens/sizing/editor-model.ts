/**
 * S06 sizing draft editor (D-112 §2): the form state, its reading from the server view, and the
 * `SizingDraftPatch` a save sends. Pure; the editor component and its tests use it.
 *
 * Rules: every input is Evidence (a source) or an Assumption (a register link); a blank input is
 * cleared with `clearInputKeys` and the ledger shows Unknown (never 0); the first save needs the
 * market boundary; a patch only carries what changed against the last server state.
 */
import {
  MONEY_MEASURE_LABELS,
  type Assumption,
  type SizingDraftPatch as SizingDraftPatchSchema,
  type SizingVersion,
  type ValueUnit,
} from '@growth-os/contracts';
import type { z } from 'zod';
import { fieldText, fieldValue, type DriverField } from '../economics/engine/adapter';

export type SizingDraftPatch = z.input<typeof SizingDraftPatchSchema>;

export type SizingInputKey =
  | 'tam_site_count'
  | 'annual_spend_per_site'
  | 'reachable_pool'
  | 'adoption_rate.downside'
  | 'adoption_rate.base'
  | 'adoption_rate.upside'
  | 'capacity';

export interface EditorInputSpec {
  key: SizingInputKey;
  label: string;
  unit: ValueUnit;
  field: Pick<DriverField, 'scale' | 'kind'>;
  /** Text after the value field ("sites", "%", "€ per year per site"). */
  suffix: (currency: string) => string;
  /** Required by the engine: a blank one blocks the snapshot (MISSING_INPUT). */
  required: boolean;
  group: 'market' | 'reach' | 'adoption';
}

export const SIZING_EDITOR_INPUTS: readonly EditorInputSpec[] = [
  {
    key: 'tam_site_count',
    label: 'TAM site count',
    unit: 'sites',
    field: { scale: 1, kind: 'count' },
    suffix: () => 'sites',
    required: true,
    group: 'market',
  },
  {
    key: 'annual_spend_per_site',
    label: MONEY_MEASURE_LABELS.annual_spend_per_unit,
    unit: 'currency_per_year_per_site',
    field: { scale: 1, kind: 'money' },
    suffix: (c) => `${c} per year per site`,
    required: true,
    group: 'market',
  },
  {
    key: 'reachable_pool',
    label: 'Reachable pool',
    unit: 'sites',
    field: { scale: 1, kind: 'count' },
    suffix: () => 'sites',
    required: true,
    group: 'reach',
  },
  {
    key: 'adoption_rate.downside',
    label: 'Adoption by year 3 · Downside',
    unit: 'rate',
    field: { scale: 0.01, kind: 'rate' },
    suffix: () => '%',
    required: false,
    group: 'adoption',
  },
  {
    key: 'adoption_rate.base',
    label: 'Adoption by year 3 · Base',
    unit: 'rate',
    field: { scale: 0.01, kind: 'rate' },
    suffix: () => '%',
    required: true,
    group: 'adoption',
  },
  {
    key: 'adoption_rate.upside',
    label: 'Adoption by year 3 · Upside',
    unit: 'rate',
    field: { scale: 0.01, kind: 'rate' },
    suffix: () => '%',
    required: false,
    group: 'adoption',
  },
  {
    key: 'capacity',
    label: 'Installation and support capacity',
    unit: 'customers',
    field: { scale: 1, kind: 'count' },
    suffix: () => 'customers',
    required: true,
    group: 'adoption',
  },
];

/** `''` = not entered (Unknown); `src:<sourceId>` = Evidence; `asm:<assumptionId>` = Assumption. */
export type Basis = '' | `src:${string}` | `asm:${string}`;

export interface InputForm {
  basis: Basis;
  /** Field text in display units (sites, %, currency). Unused while the basis is an assumption. */
  text: string;
  /** Basis text, e.g. the reachable pool's channel definition. */
  basisText: string;
}

export interface CohortForm {
  id: string | null;
  name: string;
  rule: string;
  siteCount: string;
  sourceId: string;
}

export interface SizingForm {
  marketUnit: string;
  populationUnit: 'site' | 'company' | 'customer';
  currency: string;
  priceYear: string;
  productBoundary: string;
  includes: { hardware: boolean; software: boolean; services: boolean; replacementCycles: boolean };
  horizonYears: string;
  inputs: Record<SizingInputKey, InputForm>;
  cohorts: CohortForm[];
  overlapCount: string;
  overlapMethod: string;
  dedupRule: string;
}

const EMPTY_INPUT: InputForm = { basis: '', text: '', basisText: '' };

export function blankForm(defaults: { horizonYears?: number | null } = {}): SizingForm {
  return {
    marketUnit: '',
    populationUnit: 'site',
    currency: 'EUR',
    priceYear: '',
    productBoundary: '',
    includes: { hardware: false, software: false, services: false, replacementCycles: false },
    horizonYears: defaults.horizonYears ? String(defaults.horizonYears) : '3',
    inputs: Object.fromEntries(SIZING_EDITOR_INPUTS.map((s) => [s.key, { ...EMPTY_INPUT }])) as Record<
      SizingInputKey,
      InputForm
    >,
    cohorts: [],
    overlapCount: '',
    overlapMethod: '',
    dedupRule: '',
  };
}

/** The form for a version (the draft, else the committed one a first edit copies). */
export function formFromVersion(v: SizingVersion | null): SizingForm {
  if (!v) return blankForm();
  const f = blankForm({ horizonYears: v.horizonYears });
  const b = v.boundary;
  f.marketUnit = b.marketUnit;
  f.populationUnit = b.populationUnit;
  f.currency = b.currency;
  f.priceYear = String(b.priceYear);
  f.productBoundary = b.productBoundary;
  f.includes = { ...b.includes };
  for (const spec of SIZING_EDITOR_INPUTS) {
    const row = v.ledger.find((r) => r.inputKey === spec.key);
    if (!row) continue;
    f.inputs[spec.key] = {
      basis: row.assumptionId
        ? `asm:${row.assumptionId}`
        : row.basis.source
          ? `src:${row.basis.source.sourceId}`
          : '',
      text: fieldText(spec.field, row.value),
      basisText: spec.key === 'reachable_pool' ? (row.basis.text ?? '') : '',
    };
  }
  f.cohorts = v.cohorts.map((c) => ({
    id: c.id,
    name: c.name,
    rule: c.rule,
    siteCount: String(c.siteCount),
    sourceId: c.source?.sourceId ?? '',
  }));
  const o = v.overlaps[0];
  f.overlapCount = o ? String(o.overlapCount) : '';
  f.overlapMethod = o?.method ?? '';
  f.dedupRule = v.dedupRuleText;
  return f;
}

const INT = /^\s*\d+\s*$/;
const YEAR = /^\s*(19|20|21)\d\d\s*$/;
const CURRENCY = /^[A-Z]{3}$/;

/** Boundary problems that stop the first save (the server's own rule, said before sending). */
export function boundaryErrors(
  f: SizingForm,
): Partial<Record<'marketUnit' | 'currency' | 'priceYear', string>> {
  const e: Partial<Record<'marketUnit' | 'currency' | 'priceYear', string>> = {};
  if (!f.marketUnit.trim()) e.marketUnit = 'Required for the first sizing draft';
  if (!CURRENCY.test(f.currency.trim())) e.currency = 'Use a three-letter currency code, e.g. EUR';
  if (!YEAR.test(f.priceYear)) e.priceYear = 'Enter a four-digit year';
  return e;
}

/** The decimal string an input would save, or null when blank or not a number. */
export function inputValue(spec: EditorInputSpec, i: InputForm, previous = '0'): string | null {
  if (!i.text.trim()) return null;
  return fieldValue(spec.field, i.text, previous);
}

/** Inputs the engine needs that are not entered: the ledger shows Unknown and the snapshot is blocked. */
export function missingRequired(v: SizingVersion | null): EditorInputSpec[] {
  return SIZING_EDITOR_INPUTS.filter((s) => s.required && !v?.ledger.some((r) => r.inputKey === s.key));
}

function registerValue(assumptions: readonly Assumption[], id: string): string | null {
  return assumptions.find((a) => a.id === id)?.current.value ?? null;
}

export interface PatchPlan {
  /** First request. Null when nothing changed. */
  patch: SizingDraftPatch | null;
  /** The overlap needs cohort ids the first request creates: send it after. */
  overlapAfter: boolean;
  /** Rows that cannot be saved yet, with the reason (shown beside the field). */
  pending: { key: string; message: string }[];
}

function sameCohorts(a: CohortForm[], b: CohortForm[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (c, n) =>
        c.name === b[n]!.name &&
        c.rule === b[n]!.rule &&
        c.siteCount.trim() === b[n]!.siteCount.trim() &&
        c.sourceId === b[n]!.sourceId,
    )
  );
}

/**
 * The patch that turns `server` (last saved state; null when the case has no sizing yet) into
 * `form`. Throws a plain Error with the reason when the first save lacks the boundary.
 */
export function planPatch(
  form: SizingForm,
  server: { form: SizingForm; version: SizingVersion | null },
  assumptions: readonly Assumption[],
): PatchPlan {
  const first = server.version === null;
  const s = server.form;
  const patch: SizingDraftPatch = {};
  const pending: PatchPlan['pending'] = [];

  // Boundary (immutable rows: any change makes a new one on the server).
  const boundary: NonNullable<SizingDraftPatch['boundary']> = {};
  if (first) {
    const e = boundaryErrors(form);
    if (Object.keys(e).length)
      throw new Error('Define the market boundary first: market unit, currency and reference year.');
    boundary.marketUnit = form.marketUnit.trim();
    boundary.populationUnit = form.populationUnit;
    boundary.currency = form.currency.trim();
    boundary.priceYear = Number(form.priceYear);
    boundary.annualizationMethod = null;
    if (form.productBoundary.trim()) boundary.productBoundary = form.productBoundary.trim();
    boundary.includes = { ...form.includes };
  } else {
    if (form.marketUnit.trim() && form.marketUnit.trim() !== s.marketUnit)
      boundary.marketUnit = form.marketUnit.trim();
    if (form.populationUnit !== s.populationUnit) boundary.populationUnit = form.populationUnit;
    if (CURRENCY.test(form.currency.trim()) && form.currency.trim() !== s.currency)
      boundary.currency = form.currency.trim();
    if (YEAR.test(form.priceYear) && form.priceYear.trim() !== s.priceYear)
      boundary.priceYear = Number(form.priceYear);
    if (form.productBoundary.trim() && form.productBoundary.trim() !== s.productBoundary)
      boundary.productBoundary = form.productBoundary.trim();
    const inc = (Object.keys(form.includes) as (keyof SizingForm['includes'])[]).filter(
      (k) => form.includes[k] !== s.includes[k],
    );
    if (inc.length) boundary.includes = Object.fromEntries(inc.map((k) => [k, form.includes[k]]));
  }
  if (Object.keys(boundary).length) patch.boundary = boundary;

  if (INT.test(form.horizonYears) && Number(form.horizonYears) > 0) {
    if (first || form.horizonYears.trim() !== s.horizonYears) patch.horizonYears = Number(form.horizonYears);
  }
  if (form.dedupRule.trim() && form.dedupRule.trim() !== s.dedupRule)
    patch.dedupRuleText = form.dedupRule.trim();

  // Inputs: Evidence (value + source) or Assumption (register link). Blank → cleared.
  const inputs: NonNullable<SizingDraftPatch['inputs']> = [];
  const clear: string[] = [];
  const exists = (k: string) => !!server.version?.ledger.some((r) => r.inputKey === k);
  for (const spec of SIZING_EDITOR_INPUTS) {
    const f = form.inputs[spec.key];
    const o = s.inputs[spec.key];
    const basisText = f.basisText.trim() ? f.basisText.trim() : null;
    const textChanged = (o.basisText.trim() || null) !== basisText;
    if (f.basis.startsWith('asm:')) {
      const id = f.basis.slice(4);
      if (f.basis === o.basis && !textChanged && exists(spec.key)) continue;
      const v = registerValue(assumptions, id);
      if (v === null) {
        pending.push({ key: spec.key, message: 'This assumption has no numeric value.' });
        continue;
      }
      inputs.push({
        inputKey: spec.key,
        value: v,
        unit: spec.unit,
        sourceId: null,
        assumptionId: id,
        ...(spec.key === 'reachable_pool' ? { basisText } : {}),
      });
      continue;
    }
    if (f.basis === '' || !f.text.trim()) {
      if (exists(spec.key)) clear.push(spec.key);
      else if (f.text.trim())
        pending.push({ key: spec.key, message: 'Choose the evidence or an assumption.' });
      continue;
    }
    const value = inputValue(spec, f);
    if (value === null) {
      pending.push({ key: spec.key, message: 'Enter a number.' });
      continue;
    }
    const before = inputValue(spec, o);
    if (f.basis === o.basis && before === value && !textChanged && exists(spec.key)) continue;
    inputs.push({
      inputKey: spec.key,
      value,
      unit: spec.unit,
      sourceId: f.basis.slice(4),
      assumptionId: null,
      ...(spec.key === 'reachable_pool' ? { basisText } : {}),
    });
  }
  if (inputs.length) patch.inputs = inputs;
  if (clear.length) patch.clearInputKeys = clear;

  // Cohorts: the whole list when anything changed; ids by position from the last server state.
  const valid = form.cohorts.filter((c) => c.name.trim() && INT.test(c.siteCount));
  const cohortsChanged = !sameCohorts(valid, s.cohorts);
  if (cohortsChanged)
    patch.cohorts = valid.map((c, n) => ({
      id: s.cohorts[n]?.id ?? null,
      name: c.name.trim(),
      rule: c.rule.trim(),
      siteCount: Number(c.siteCount),
      sourceId: c.sourceId || null,
    }));
  for (const c of form.cohorts)
    if (c.name.trim() && !INT.test(c.siteCount))
      pending.push({ key: `cohort.${c.name}`, message: 'Enter a whole number of sites.' });

  // The overlap of the first two cohorts.
  let overlapAfter = false;
  const overlapChanged =
    form.overlapCount.trim() !== s.overlapCount.trim() ||
    form.overlapMethod.trim() !== s.overlapMethod.trim();
  if (overlapChanged || (cohortsChanged && form.overlapCount.trim())) {
    if (!form.overlapCount.trim()) patch.overlaps = [];
    else if (!INT.test(form.overlapCount))
      pending.push({ key: 'overlap', message: 'Enter a whole number of sites.' });
    else if (valid.length < 2) pending.push({ key: 'overlap', message: 'Add two cohorts first.' });
    else if (cohortsChanged && (!s.cohorts[0]?.id || !s.cohorts[1]?.id)) overlapAfter = true;
    else
      patch.overlaps = [
        {
          cohortAId: s.cohorts[0]!.id!,
          cohortBId: s.cohorts[1]!.id!,
          overlapCount: Number(form.overlapCount),
          ...(form.overlapMethod.trim() ? { method: form.overlapMethod.trim() } : {}),
        },
      ];
  }
  return { patch: Object.keys(patch).length ? patch : null, overlapAfter, pending };
}

/** The follow-up overlap patch once the cohorts have ids. */
export function overlapPatch(form: SizingForm, v: SizingVersion): SizingDraftPatch | null {
  const [a, b] = v.cohorts;
  if (!a || !b || !INT.test(form.overlapCount)) return null;
  return {
    overlaps: [
      {
        cohortAId: a.id,
        cohortBId: b.id,
        overlapCount: Number(form.overlapCount),
        ...(form.overlapMethod.trim() ? { method: form.overlapMethod.trim() } : {}),
      },
    ],
  };
}
