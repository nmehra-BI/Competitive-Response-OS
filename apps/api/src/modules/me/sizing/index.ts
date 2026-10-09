/**
 * Sizing (S06, ME-05). One mutable draft, any number of immutable committed versions. Every draft edit
 * recalculates with the WS2 engine; committing needs an unblocked result (422 CALCULATION_BLOCKED)
 * and runs materiality for snapshots that pin the previous version (D-047).
 */
import { API, type CalcCheck } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { effectiveAccess, entitlementFor } from '../../../platform/entitlements';
import { ApiError, notFound } from '../../../platform/errors';
import { applyMateriality } from '../../../platform/materiality';
import { pageOf } from '../../../platform/pagination';
import { assertIfMatch, command, query, type HandlerMap, type Tools } from '../../../platform/pipeline';
import {
  authorizeOnCase,
  eventBase,
  findCase,
  peopleMap,
  readDecision,
  readableCase,
  who,
  type BaseCtx,
  type CaseRecord,
} from '../cases/access';
import {
  currentAssumptionVersions,
  recalcSizingDraft,
  SIZING_INPUT_LABELS,
  sizingVersions,
  type SizingVersionRow,
} from './model';
import { redactBlockedSizing, sizingView, toSizingVersion } from './read';

type Patch = (typeof API.sizing.saveDraft)['body']['_output'];

const MONEY = new Set(['currency_per_year_per_site', 'currency_per_year', 'currency_one_time']);

async function loadCase(tx: Tx, ref: string): Promise<CaseRecord> {
  const c = await findCase(tx, ref);
  if (!c) throw notFound();
  return c;
}

export function blocked(checks: readonly CalcCheck[]): ApiError {
  const b = checks.filter((c) => c.blocking);
  return new ApiError('CALCULATION_BLOCKED', b[0]?.message ?? 'Calculation blocked', {
    checks: b.map((c) => ({ key: c.key, message: c.message, blocking: true })),
  });
}

async function mandateDefaults(tx: Tx, c: CaseRecord) {
  if (!c.mandate_id) return null;
  const v = await tx
    .selectFrom('me.mandate as m')
    .innerJoin('me.mandate_version as v', (j) => j.on((eb) => eb('v.id', '=', eb.fn.coalesce('m.current_version_id', 'm.draft_version_id'))))
    .select(['v.geography_codes', 'v.segment_ids', 'v.horizon_years', 'v.product_id'])
    .where('m.id', '=', c.mandate_id)
    .executeTakeFirst();
  if (!v) return null;
  const segs = v.segment_ids.length ? await tx.selectFrom('platform.segment').select('name').where('id', 'in', v.segment_ids).execute() : [];
  const product = v.product_id ? await tx.selectFrom('platform.product').select('name').where('id', '=', v.product_id).executeTakeFirst() : undefined;
  return {
    country: v.geography_codes[0] ?? null,
    segment: segs.map((s) => s.name.toLowerCase()).join(', ') || null,
    horizon: v.horizon_years,
    product: product?.name ?? null,
  };
}

/** The case's draft, created from the current version (or from scratch) when absent. */
async function ensureDraft(tx: Tx, ctx: BaseCtx & { ifMatch: number | null }, c: CaseRecord, patch: Patch): Promise<SizingVersionRow> {
  const versions = await sizingVersions(tx, c.id);
  const draft = versions.find((v) => v.state === 'draft');
  const check = (rv: number) => assertIfMatch(ctx as never, rv);
  if (draft) {
    check(draft.row_version);
    return draft;
  }
  const current = versions.filter((v) => v.state === 'committed').pop();
  const next = (versions[versions.length - 1]?.version ?? 0) + 1;
  if (current) {
    check(current.row_version);
    const d = (await tx
      .insertInto('me.sizing_version')
      .values({
        tenant_id: ctx.tenantId,
        case_id: c.id,
        version: next,
        state: 'draft',
        method: current.method,
        horizon_years: current.horizon_years,
        market_boundary_id: current.market_boundary_id,
        dedup_rule_text: current.dedup_rule_text,
        created_by: ctx.userId,
        created_at: ctx.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow()) as SizingVersionRow;
    const inputs = await tx.selectFrom('me.sizing_input').selectAll().where('sizing_version_id', '=', current.id).execute();
    for (const { id: _id, sizing_version_id: _v, assumption_version_id: _p, ...i } of inputs)
      await tx.insertInto('me.sizing_input').values({ ...i, sizing_version_id: d.id }).execute();
    const cohorts = await tx.selectFrom('me.cohort').selectAll().where('sizing_version_id', '=', current.id).execute();
    const map = new Map<string, string>();
    for (const { id, sizing_version_id: _v, ...k } of cohorts) {
      const n = await tx.insertInto('me.cohort').values({ ...k, sizing_version_id: d.id }).returning('id').executeTakeFirstOrThrow();
      map.set(id, n.id);
    }
    const overlaps = await tx.selectFrom('me.cohort_overlap').selectAll().where('sizing_version_id', '=', current.id).execute();
    for (const { id: _id, sizing_version_id: _v, ...o } of overlaps)
      await tx
        .insertInto('me.cohort_overlap')
        .values({ ...o, sizing_version_id: d.id, cohort_a_id: map.get(o.cohort_a_id)!, cohort_b_id: map.get(o.cohort_b_id)! })
        .execute();
    const cross = await tx.selectFrom('me.sizing_cross_check').selectAll().where('sizing_version_id', '=', current.id).executeTakeFirst();
    if (cross) {
      const { id: _id, sizing_version_id: _v, ...x } = cross;
      await tx.insertInto('me.sizing_cross_check').values({ ...x, sizing_version_id: d.id }).execute();
    }
    return d;
  }
  check(0);
  const b = patch.boundary ?? {};
  const md = await mandateDefaults(tx, c);
  const missing = (['marketUnit', 'populationUnit', 'currency', 'priceYear'] as const).filter((k) => b[k] === undefined);
  if (missing.length || !md?.country)
    throw new ApiError('VALIDATION_FAILED', 'Define the market boundary first: unit, population unit, currency and price year.', {
      errors: missing.map((k) => ({ path: `body.boundary.${k}`, code: 'required', message: 'Required for the first sizing draft' })),
    });
  const boundary = await tx
    .insertInto('me.market_boundary')
    .values({
      tenant_id: ctx.tenantId,
      market_unit: b.marketUnit!,
      population_unit: b.populationUnit!,
      country_code: md.country,
      segment_label: md.segment ?? 'segment not stated',
      product_boundary: md.product ?? 'product not stated',
      currency: b.currency!,
      price_year: b.priceYear!,
      annualization_method: b.annualizationMethod ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return (await tx
    .insertInto('me.sizing_version')
    .values({
      tenant_id: ctx.tenantId,
      case_id: c.id,
      version: next,
      state: 'draft',
      method: patch.method ?? 'aggregate_overlap',
      horizon_years: patch.horizonYears ?? md.horizon ?? 3,
      market_boundary_id: boundary.id,
      dedup_rule_text: 'Unique by site ID. Sites of one parent company stay separate when they buy separately.',
      created_by: ctx.userId,
      created_at: ctx.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow()) as SizingVersionRow;
}

async function applyPatch(tx: Tx, ctx: BaseCtx, c: CaseRecord, d: SizingVersionRow, p: Patch): Promise<SizingVersionRow> {
  const set: Record<string, unknown> = {};
  if (p.method) set.method = p.method;
  if (p.horizonYears) set.horizon_years = p.horizonYears;
  const old = await tx.selectFrom('me.market_boundary').selectAll().where('id', '=', d.market_boundary_id).executeTakeFirstOrThrow();
  if (p.boundary && Object.keys(p.boundary).length > 0) {
    const b = p.boundary;
    const changed =
      (b.marketUnit !== undefined && b.marketUnit !== old.market_unit) ||
      (b.populationUnit !== undefined && b.populationUnit !== old.population_unit) ||
      (b.currency !== undefined && b.currency !== old.currency) ||
      (b.priceYear !== undefined && b.priceYear !== old.price_year) ||
      (b.annualizationMethod !== undefined && b.annualizationMethod !== old.annualization_method);
    if (changed) {
      const { id: _id, created_at: _c, ...rest } = old;
      const nb = await tx
        .insertInto('me.market_boundary')
        .values({
          ...rest,
          market_unit: b.marketUnit ?? old.market_unit,
          population_unit: b.populationUnit ?? old.population_unit,
          currency: b.currency ?? old.currency,
          price_year: b.priceYear ?? old.price_year,
          annualization_method: b.annualizationMethod !== undefined ? b.annualizationMethod : old.annualization_method,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      set.market_boundary_id = nb.id;
    }
  }
  const boundary = set.market_boundary_id
    ? await tx.selectFrom('me.market_boundary').selectAll().where('id', '=', set.market_boundary_id as string).executeTakeFirstOrThrow()
    : old;
  if (Object.keys(set).length) await tx.updateTable('me.sizing_version').set(set).where('id', '=', d.id).execute();

  for (const i of p.inputs ?? []) {
    if (!SIZING_INPUT_LABELS[i.inputKey])
      throw new ApiError('VALIDATION_FAILED', `Unknown sizing input "${i.inputKey}".`, {
        errors: [{ path: 'body.inputs', code: 'unknown_input', message: `Unknown input ${i.inputKey}` }],
      });
    if (!i.sourceId && !i.assumptionId)
      throw new ApiError('VALIDATION_FAILED', 'Every input needs a source or an assumption.', {
        errors: [{ path: 'body.inputs', code: 'basis_required', message: `${i.inputKey} has no basis` }],
      });
    let row: Record<string, unknown>;
    const money = MONEY.has(i.unit);
    if (i.assumptionId) {
      const a = await tx.selectFrom('platform.assumption').select(['id', 'case_id']).where('id', '=', i.assumptionId).executeTakeFirst();
      if (!a || a.case_id !== c.id) throw new ApiError('VALIDATION_FAILED', 'The assumption is not in this case register.');
      const live = (await currentAssumptionVersions(tx, [a.id])).get(a.id)!;
      if (live.value === null) throw new ApiError('VALIDATION_FAILED', 'The assumption has no numeric value.');
      row = {
        kind: 'assumption',
        value: live.value,
        unit: live.unit,
        currency: live.currency ?? (money ? boundary.currency : null),
        price_year: live.price_year ?? (money ? boundary.price_year : null),
        assumption_id: a.id,
        source_id: null,
        evidence_quality: live.evidence_quality,
      };
    } else {
      const s = await tx.selectFrom('platform.source').select(['id', 'origin_kind']).where('id', '=', i.sourceId!).executeTakeFirst();
      if (!s) throw new ApiError('VALIDATION_FAILED', 'Unknown source.');
      row = {
        kind: 'evidence',
        value: i.value,
        unit: i.unit,
        currency: money ? boundary.currency : null,
        price_year: boundary.price_year,
        assumption_id: null,
        source_id: s.id,
        evidence_quality: s.origin_kind === 'licensed' ? 'strong' : 'some',
      };
    }
    await tx.deleteFrom('me.sizing_input').where('sizing_version_id', '=', d.id).where('input_key', '=', i.inputKey).execute();
    await tx
      .insertInto('me.sizing_input')
      .values({
        tenant_id: ctx.tenantId,
        sizing_version_id: d.id,
        input_key: i.inputKey,
        label: SIZING_INPUT_LABELS[i.inputKey]!,
        ...(row as { kind: string; value: string; unit: string }),
      })
      .execute();
  }

  if (p.cohorts) {
    const existing = await tx.selectFrom('me.cohort').select('id').where('sizing_version_id', '=', d.id).execute();
    const keep = new Set(p.cohorts.flatMap((k) => (k.id ? [k.id] : [])));
    for (const id of keep)
      if (!existing.some((e) => e.id === id)) throw new ApiError('VALIDATION_FAILED', 'Unknown cohort in this draft.');
    const gone = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (gone.length) {
      await tx
        .deleteFrom('me.cohort_overlap')
        .where('sizing_version_id', '=', d.id)
        .where((eb) => eb.or([eb('cohort_a_id', 'in', gone), eb('cohort_b_id', 'in', gone)]))
        .execute();
      await tx.deleteFrom('me.cohort').where('id', 'in', gone).execute();
    }
    for (const [n, k] of p.cohorts.entries()) {
      const vals = {
        name: k.name,
        rule: k.rule,
        site_count: k.siteCount,
        source_id: k.sourceId,
        ordinal: n + 1,
        population_unit: boundary.population_unit,
        price_year: boundary.price_year,
      };
      if (k.siteCount < 0) throw new ApiError('VALIDATION_FAILED', 'Site counts cannot be negative.');
      if (k.id) await tx.updateTable('me.cohort').set(vals).where('id', '=', k.id).execute();
      else await tx.insertInto('me.cohort').values({ tenant_id: ctx.tenantId, sizing_version_id: d.id, ...vals }).execute();
    }
  }
  if (p.overlaps) {
    const ids = new Set((await tx.selectFrom('me.cohort').select('id').where('sizing_version_id', '=', d.id).execute()).map((x) => x.id));
    await tx.deleteFrom('me.cohort_overlap').where('sizing_version_id', '=', d.id).execute();
    for (const o of p.overlaps) {
      if (!ids.has(o.cohortAId) || !ids.has(o.cohortBId)) throw new ApiError('VALIDATION_FAILED', 'Overlaps must name two cohorts of this draft.');
      await tx
        .insertInto('me.cohort_overlap')
        .values({
          tenant_id: ctx.tenantId,
          sizing_version_id: d.id,
          cohort_a_id: o.cohortAId,
          cohort_b_id: o.cohortBId,
          overlap_count: o.overlapCount,
          method_text: 'Entered in the draft',
        })
        .execute();
    }
  }
  if (p.crossCheck !== undefined) {
    await tx.deleteFrom('me.sizing_cross_check').where('sizing_version_id', '=', d.id).execute();
    if (p.crossCheck)
      await tx
        .insertInto('me.sizing_cross_check')
        .values({
          tenant_id: ctx.tenantId,
          sizing_version_id: d.id,
          low: p.crossCheck.low,
          high: p.crossCheck.high,
          currency: boundary.currency,
          price_year: boundary.price_year,
          basis: p.crossCheck.basis,
          source_id: p.crossCheck.sourceId,
          illustrative: p.crossCheck.illustrative,
          explanation: p.crossCheck.explanation,
        })
        .execute();
  }
  return (await tx.selectFrom('me.sizing_version').selectAll().where('id', '=', d.id).executeTakeFirstOrThrow()) as SizingVersionRow;
}

async function reread(tx: Tx, id: string): Promise<SizingVersionRow> {
  return (await tx.selectFrom('me.sizing_version').selectAll().where('id', '=', id).executeTakeFirstOrThrow()) as SizingVersionRow;
}

async function draftOf(tx: Tx, caseId: string): Promise<SizingVersionRow> {
  const d = (await sizingVersions(tx, caseId)).find((v) => v.state === 'draft');
  if (!d) throw new ApiError('INVALID_TRANSITION', 'There is no sizing draft. Edit an input to start one.');
  return d;
}

async function audit(t: Tools, c: CaseRecord, v: SizingVersionRow, action: string, summary: string, details: Record<string, string | number | boolean | null> = {}) {
  await t.audit({ action, objectType: 'sizing_version', objectId: v.id, objectVersion: v.version, caseId: c.id, summary, details });
}

const fmtValue = (v: string | null) => v;

export const sizingHandlers: HandlerMap = {
  [API.sizing.get.id]: query(API.sizing.get, {
    load: (ctx, tx) => readableCase(tx, ctx.identity, ctx.params.caseRef),
    authorize: (ctx, c) => readDecision(ctx.identity, c),
    handle: async (ctx, { tx }, c) => {
      const view = await sizingView(tx, ctx.identity, c.id);
      if (view.draft) ctx.setETag(view.draft.rowVersion);
      else if (view.current) ctx.setETag(view.current.rowVersion);
      return view;
    },
  }),

  [API.sizing.saveDraft.id]: command(API.sizing.saveDraft, {
    load: (ctx, tx) => loadCase(tx, ctx.params.caseRef),
    authorize: (ctx, c) => authorizeOnCase(ctx.identity, ctx.now, c, 'model.edit_draft'),
    handle: async (ctx, t, c) => {
      const d0 = await ensureDraft(t.tx, ctx, c, ctx.body);
      const d = await applyPatch(t.tx, ctx, c, d0, ctx.body);
      const r = await recalcSizingDraft(t.tx, ctx.tenantId, d, ctx.now);
      const after = await reread(t.tx, d.id);
      ctx.setETag(after.row_version);
      await audit(t, c, after, 'sizing.draft_saved', `Sizing draft v${after.version} edited and recalculated`, {
        blocked: r.output ? r.output.blocked : true,
        blockingChecks: r.checks.filter((x) => x.blocking).length,
      });
      return sizingView(t.tx, ctx.identity, c.id);
    },
  }),

  [API.sizing.calculateDraft.id]: command(API.sizing.calculateDraft, {
    load: (ctx, tx) => loadCase(tx, ctx.params.caseRef),
    authorize: (ctx, c) => authorizeOnCase(ctx.identity, ctx.now, c, 'model.edit_draft'),
    handle: async (ctx, t, c) => {
      const d = await draftOf(t.tx, c.id);
      const r = await recalcSizingDraft(t.tx, ctx.tenantId, d, ctx.now);
      if (!r.output) throw blocked(r.checks);
      await audit(t, c, d, 'sizing.draft_calculated', `Sizing draft v${d.version} calculated`, {
        blocked: r.output.blocked,
        blockingChecks: r.output.checks.filter((x) => x.blocking).length,
      });
      return redactBlockedSizing(r.output);
    },
  }),

  [API.sizing.resolveDuplicateCohort.id]: command(API.sizing.resolveDuplicateCohort, {
    load: (ctx, tx) => loadCase(tx, ctx.params.caseRef),
    authorize: (ctx, c) => authorizeOnCase(ctx.identity, ctx.now, c, 'model.edit_draft'),
    handle: async (ctx, t, c) => {
      const d = await draftOf(t.tx, c.id);
      assertIfMatch(ctx, d.row_version);
      const { keepCohortId, excludeCohortId } = ctx.body;
      if (keepCohortId === excludeCohortId) throw new ApiError('VALIDATION_FAILED', 'Choose two different cohorts.');
      const cohorts = await t.tx.selectFrom('me.cohort').select(['id', 'name']).where('sizing_version_id', '=', d.id).execute();
      if (![keepCohortId, excludeCohortId].every((id) => cohorts.some((k) => k.id === id))) throw notFound();
      await t.tx.updateTable('me.cohort').set({ status: 'active' }).where('id', '=', keepCohortId).execute();
      await t.tx.updateTable('me.cohort').set({ status: 'excluded' }).where('id', '=', excludeCohortId).execute();
      await recalcSizingDraft(t.tx, ctx.tenantId, d, ctx.now);
      const after = await reread(t.tx, d.id);
      ctx.setETag(after.row_version);
      await audit(t, c, after, 'sizing.duplicate_cohort_resolved', 'Duplicate cohort resolved: one kept, the other excluded (not deleted)', {
        keepCohortId,
        excludeCohortId,
      });
      return sizingView(t.tx, ctx.identity, c.id);
    },
  }),

  [API.sizing.commit.id]: command(API.sizing.commit, {
    load: (ctx, tx) => loadCase(tx, ctx.params.caseRef),
    authorize: (ctx, c) => authorizeOnCase(ctx.identity, ctx.now, c, 'model.commit'),
    handle: async (ctx, t, c) => {
      const { tx } = t;
      const d = await draftOf(tx, c.id);
      const r = await recalcSizingDraft(tx, ctx.tenantId, d, ctx.now);
      if (!r.output || r.output.blocked) throw blocked(r.checks);
      // Pin every live assumption link to the version the result was calculated with.
      const inputs = await tx.selectFrom('me.sizing_input').select(['id', 'assumption_id']).where('sizing_version_id', '=', d.id).execute();
      const live = await currentAssumptionVersions(tx, inputs.flatMap((i) => (i.assumption_id ? [i.assumption_id] : [])));
      for (const i of inputs)
        if (i.assumption_id)
          await tx.updateTable('me.sizing_input').set({ assumption_version_id: live.get(i.assumption_id)!.id }).where('id', '=', i.id).execute();
      const prev = (await sizingVersions(tx, c.id)).filter((v) => v.state === 'committed').pop();
      const committed = (await tx
        .updateTable('me.sizing_version')
        .set({ state: 'committed', committed_at: ctx.now, committed_by: ctx.userId })
        .where('id', '=', d.id)
        .returningAll()
        .executeTakeFirstOrThrow()) as SizingVersionRow;
      await audit(t, c, committed, 'sizing.version_committed', `Sizing snapshot v${committed.version} created (immutable)`, {
        inputHash: r.output.inputHash.slice(0, 16),
      });
      await t.analytics(
        'sizing_snapshot_created',
        { objectType: 'sizing_version', objectId: committed.id, objectVersion: committed.version, caseId: c.id, stage: c.stage as never },
        { version: committed.version, blockedChecks: 0 },
      );
      await t.emit({ type: 'model.version_committed', ...eventBase(ctx, c.id), modelType: 'sizing', modelVersionId: committed.id, version: committed.version });
      if (prev)
        await applyMateriality(
          t,
          {
            changeType: 'model_version_changed',
            objectType: 'sizing_version',
            objectId: prev.id,
            componentType: 'sizing_version',
            fromVersion: prev.version,
            toVersion: committed.version,
            label: `sizing v${prev.version}`,
          },
          { now: ctx.now, actorUserId: ctx.userId },
        );
      return toSizingVersion(tx, ctx.identity, committed);
    },
  }),

  [API.sizing.getVersion.id]: query(API.sizing.getVersion, {
    load: (ctx, tx) => readableCase(tx, ctx.identity, ctx.params.caseRef),
    authorize: (ctx, c) => readDecision(ctx.identity, c),
    handle: async (ctx, { tx }, c) => {
      const v = (await sizingVersions(tx, c.id)).find((x) => x.version === ctx.params.version && x.state === 'committed');
      if (!v) throw notFound();
      return toSizingVersion(tx, ctx.identity, v);
    },
  }),

  [API.sizing.compareVersions.id]: query(API.sizing.compareVersions, {
    load: (ctx, tx) => readableCase(tx, ctx.identity, ctx.params.caseRef),
    authorize: (ctx, c) => readDecision(ctx.identity, c),
    handle: async (ctx, { tx }, c) => {
      const versions = await sizingVersions(tx, c.id);
      const pick = (v: number | 'draft') =>
        v === 'draft' ? versions.find((x) => x.state === 'draft') : versions.find((x) => x.version === v && x.state === 'committed');
      const a = pick(ctx.query.from);
      const b = pick(ctx.query.to);
      if (!a || !b) throw notFound();
      const [va, vb] = [await toSizingVersion(tx, ctx.identity, a), await toSizingVersion(tx, ctx.identity, b)];
      const changes: { inputKey: string; label: string; from: string | null; to: string | null }[] = [];
      const keys = [...new Set([...va.ledger, ...vb.ledger].map((l) => l.inputKey))];
      for (const k of keys) {
        const x = va.ledger.find((l) => l.inputKey === k);
        const y = vb.ledger.find((l) => l.inputKey === k);
        if (x?.value !== y?.value)
          changes.push({ inputKey: k, label: (x ?? y)!.name, from: fmtValue(x?.value ?? null), to: fmtValue(y?.value ?? null) });
      }
      const cohortKey = (k: { name: string; qualifier: string | null }) => `${k.name}${k.qualifier ? ` ${k.qualifier}` : ''}`;
      const names = [...new Set([...va.cohorts, ...vb.cohorts].map(cohortKey))];
      for (const n of names) {
        const x = va.cohorts.find((k) => cohortKey(k) === n);
        const y = vb.cohorts.find((k) => cohortKey(k) === n);
        const fx = x ? `${x.siteCount} sites · ${x.status}` : null;
        const fy = y ? `${y.siteCount} sites · ${y.status}` : null;
        if (fx !== fy) changes.push({ inputKey: `cohort.${n}`, label: `Cohort ${n}`, from: fx, to: fy });
      }
      const sumO = (v: typeof va) => v.overlaps.map((o) => String(o.overlapCount)).join(', ') || null;
      if (sumO(va) !== sumO(vb)) changes.push({ inputKey: 'overlaps', label: 'Overlap removed', from: sumO(va), to: sumO(vb) });
      for (const [k, label, f] of [
        ['method', 'Method', (v: typeof va) => v.method],
        ['horizonYears', 'Horizon (years)', (v: typeof va) => String(v.horizonYears)],
        ['boundary', 'Market boundary', (v: typeof va) => `${v.boundary.marketUnit} · ${v.boundary.currency} ${v.boundary.priceYear}`],
      ] as const)
        if (f(va) !== f(vb)) changes.push({ inputKey: k, label, from: f(va), to: f(vb) });
      return { changes };
    },
  }),

  [API.sizing.population.id]: query(API.sizing.population, {
    load: async (ctx, tx) => {
      const c = await readableCase(tx, ctx.identity, ctx.params.caseRef);
      const cohort = await tx
        .selectFrom('me.cohort as k')
        .innerJoin('me.sizing_version as v', 'v.id', 'k.sizing_version_id')
        .select(['k.id', 'k.source_id'])
        .where('k.id', '=', ctx.params.cohortId)
        .where('v.case_id', '=', c.id)
        .executeTakeFirst();
      if (!cohort) throw notFound();
      return { c, cohort };
    },
    authorize: (ctx, { c }) => readDecision(ctx.identity, c),
    handle: async (ctx, { tx }, { cohort }) => {
      const src = cohort.source_id
        ? await tx.selectFrom('platform.source').selectAll().where('id', '=', cohort.source_id).executeTakeFirst()
        : undefined;
      const access = src ? effectiveAccess(await entitlementFor(tx, ctx.identity, src.license_id), src) : 'excerpt';
      const owner = src ? who(await peopleMap(tx, [src.created_by]), src.created_by).displayName : null;
      // No count, excerpt or name leaves the server without the site-list entitlement (never-rule 8).
      if (access === 'none') throw new ApiError('RESTRICTED_SOURCE', 'This site list is restricted by its licence.');
      if (access === 'aggregate_only')
        return { restricted: true, aggregateOnly: true, dataOwnerName: owner, rows: [], nextCursor: null };
      const sites = src
        ? await tx
            .selectFrom('platform.site')
            .select(['id', 'external_site_id', 'name', 'country_code'])
            .where('source_id', '=', src.id)
            .orderBy('external_site_id')
            .execute()
        : [];
      const page = pageOf(sites, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
        tenantId: ctx.tenantId,
        op: API.sizing.population.id,
        now: ctx.now,
        keyOf: (s) => ({ key: s.external_site_id, id: s.id }),
      });
      return {
        restricted: false,
        aggregateOnly: false,
        dataOwnerName: owner,
        rows: page.items.map((s) => ({ siteId: s.external_site_id, name: s.name, region: s.country_code })),
        nextCursor: page.nextCursor,
      };
    },
  }),
};

