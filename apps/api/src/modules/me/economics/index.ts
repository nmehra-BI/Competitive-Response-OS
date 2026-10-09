/**
 * Economics (S08, ME-07). Drivers are edited in a draft; linked drivers follow the assumption register,
 * an edited value becomes a draft-only override. The engine keeps per-year and one-time money apart;
 * cash flow and payback stay Unavailable. Committed versions never recalculate.
 */
import { API, EconomicsDriverKey, type EconomicsInput, type EconomicsOutput } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { ApiError, notFound } from '../../../platform/errors';
import { applyMateriality } from '../../../platform/materiality';
import { assertIfMatch, command, query, type HandlerMap } from '../../../platform/pipeline';
import {
  allowSelf,
  assertHuman,
  authorizeOnCase,
  caseById,
  eventBase,
  findCase,
  readDecision,
  readableCase,
  type CaseRecord,
} from '../cases/access';
import { valueString } from '../assumptions/read';
import { blocked } from '../sizing';
import { calcOutput } from '../sizing/read';
import { currentAssumptionVersions } from '../sizing/model';
import {
  buildEconomicsInput,
  driverRows,
  DRIVERS,
  economicsEngine,
  economicsVersions,
  ensureEconomicsDraft,
  recalcEconomicsDraft,
  timeBasis,
  type EconomicsVersionRow,
} from './model';
import { economicsView, scenarioTable, toEconomicsVersion, toModelReview } from './read';

async function loadCase(tx: Tx, ref: string): Promise<CaseRecord> {
  const c = await findCase(tx, ref);
  if (!c) throw notFound();
  return c;
}

async function draftOf(tx: Tx, caseId: string): Promise<EconomicsVersionRow> {
  const d = (await economicsVersions(tx, caseId)).find((v) => v.state === 'draft');
  if (!d) throw new ApiError('INVALID_TRANSITION', 'There is no economics draft. Edit a driver to start one.');
  return d;
}

/** The version a read refers to: a number, 'draft', or (default) the latest committed. */
async function pickVersion(tx: Tx, caseId: string, v: number | 'draft' | undefined): Promise<EconomicsVersionRow> {
  const all = await economicsVersions(tx, caseId);
  const row =
    v === 'draft'
      ? all.find((x) => x.state === 'draft')
      : v === undefined
        ? all.filter((x) => x.state === 'committed').pop()
        : all.find((x) => x.version === v && x.state === 'committed');
  if (!row) throw notFound();
  return row;
}

async function inputOf(tx: Tx, v: EconomicsVersionRow): Promise<EconomicsInput> {
  if (v.state === 'committed' && v.calculation_result_id) {
    const r = await tx.selectFrom('platform.calculation_result').select('input').where('id', '=', v.calculation_result_id).executeTakeFirstOrThrow();
    return r.input as unknown as EconomicsInput;
  }
  const built = await buildEconomicsInput(tx, v);
  if (!built.ok) throw blocked(built.checks);
  return built.input;
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export const economicsHandlers: HandlerMap = {
  [API.economics.get.id]: query(API.economics.get, {
    load: (ctx, tx) => readableCase(tx, ctx.identity, ctx.params.caseRef),
    authorize: (ctx, c) => readDecision(ctx.identity, c),
    handle: async (ctx, { tx }, c) => {
      const v = await economicsView(tx, ctx.identity, c.id);
      const shown = v.draft ?? v.current;
      if (shown) ctx.setETag(shown.rowVersion);
      return v;
    },
  }),

  [API.economics.saveDraft.id]: command(API.economics.saveDraft, {
    load: (ctx, tx) => loadCase(tx, ctx.params.caseRef),
    authorize: (ctx, c) => authorizeOnCase(ctx.identity, ctx.now, c, 'model.edit_draft'),
    handle: async (ctx, t, c) => {
      const { tx } = t;
      const d = await ensureEconomicsDraft(tx, ctx, c, (rv) => assertIfMatch(ctx, rv));
      const rows = await driverRows(tx, d.id);
      const live = await currentAssumptionVersions(tx, rows.flatMap((r) => (r.assumption_id ? [r.assumption_id] : [])));
      for (const dr of ctx.body.drivers) {
        const key = EconomicsDriverKey.safeParse(dr.inputKey);
        if (!key.success)
          throw new ApiError('VALIDATION_FAILED', `Unknown driver "${dr.inputKey}".`, {
            errors: [{ path: 'body.drivers', code: 'unknown_driver', message: dr.inputKey }],
          });
        const spec = DRIVERS[key.data];
        if (spec.unit === 'rate' && (Number(dr.value) < 0 || Number(dr.value) > 1))
          throw new ApiError('VALIDATION_FAILED', 'A rate is a fraction between 0 and 1.');
        const row = rows.find((r) => r.input_key === key.data);
        if (row) {
          const linked = row.assumption_id ? live.get(row.assumption_id) : undefined;
          const same = linked?.value !== undefined && linked.value !== null && valueString(linked.value, row.unit) === valueString(dr.value, row.unit);
          await tx
            .updateTable('me.economics_driver')
            .set({ value: dr.value, assumption_id: same ? row.assumption_id : null })
            .where('id', '=', row.id)
            .execute();
        } else {
          await tx
            .insertInto('me.economics_driver')
            .values({
              tenant_id: ctx.tenantId,
              economics_version_id: d.id,
              input_key: key.data,
              label: spec.label,
              value: dr.value,
              unit: spec.unit,
              time_basis: timeBasis(spec.unit),
            })
            .execute();
        }
      }
      // Touch the draft so its ETag changes with every edit.
      await tx.updateTable('me.economics_version').set({ exclusions_text: d.exclusions_text }).where('id', '=', d.id).execute();
      const r = await recalcEconomicsDraft(tx, ctx.tenantId, d, ctx.now);
      const after = (await tx.selectFrom('me.economics_version').selectAll().where('id', '=', d.id).executeTakeFirstOrThrow()) as EconomicsVersionRow;
      ctx.setETag(after.row_version);
      await t.audit({
        action: 'economics.draft_saved',
        objectType: 'economics_version',
        objectId: d.id,
        objectVersion: d.version,
        caseId: c.id,
        summary: `Economics draft v${d.version} edited (${ctx.body.drivers.map((x) => x.inputKey).join(', ') || 'no driver'})`,
        details: { blocked: r.output ? r.output.blocked : true },
      });
      return economicsView(tx, ctx.identity, c.id);
    },
  }),

  [API.economics.calculateDraft.id]: command(API.economics.calculateDraft, {
    load: (ctx, tx) => loadCase(tx, ctx.params.caseRef),
    authorize: (ctx, c) => authorizeOnCase(ctx.identity, ctx.now, c, 'model.edit_draft'),
    handle: async (ctx, t, c) => {
      const d = await draftOf(t.tx, c.id);
      const r = await recalcEconomicsDraft(t.tx, ctx.tenantId, d, ctx.now);
      if (!r.output) throw blocked(r.checks);
      await t.audit({
        action: 'economics.draft_calculated',
        objectType: 'economics_version',
        objectId: d.id,
        objectVersion: d.version,
        caseId: c.id,
        summary: `Economics draft v${d.version} calculated`,
        details: { blocked: r.output.blocked },
      });
      return r.output;
    },
  }),

  [API.economics.whatMustBeTrue.id]: query(API.economics.whatMustBeTrue, {
    load: (ctx, tx) => readableCase(tx, ctx.identity, ctx.params.caseRef),
    authorize: (ctx, c) => readDecision(ctx.identity, c),
    handle: async (ctx, { tx }, c) => {
      const v = await pickVersion(tx, c.id, ctx.query.version);
      return economicsEngine.breakEven(await inputOf(tx, v), ctx.query.targetContributionAfterOpex);
    },
  }),

  [API.economics.commit.id]: command(API.economics.commit, {
    load: (ctx, tx) => loadCase(tx, ctx.params.caseRef),
    authorize: (ctx, c) => authorizeOnCase(ctx.identity, ctx.now, c, 'model.commit'),
    handle: async (ctx, t, c) => {
      const { tx } = t;
      const d = await draftOf(tx, c.id);
      const r = await recalcEconomicsDraft(tx, ctx.tenantId, d, ctx.now);
      if (!r.output || r.output.blocked) throw blocked(r.checks);
      const rows = await driverRows(tx, d.id);
      const live = await currentAssumptionVersions(tx, rows.flatMap((x) => (x.assumption_id ? [x.assumption_id] : [])));
      for (const x of rows)
        if (x.assumption_id)
          await tx.updateTable('me.economics_driver').set({ assumption_version_id: live.get(x.assumption_id)!.id }).where('id', '=', x.id).execute();
      const prev = (await economicsVersions(tx, c.id)).filter((v) => v.state === 'committed').pop();
      const committed = (await tx
        .updateTable('me.economics_version')
        .set({ state: 'committed', committed_at: ctx.now, committed_by: ctx.userId })
        .where('id', '=', d.id)
        .returningAll()
        .executeTakeFirstOrThrow()) as EconomicsVersionRow;
      await t.audit({
        action: 'economics.version_committed',
        objectType: 'economics_version',
        objectId: committed.id,
        objectVersion: committed.version,
        caseId: c.id,
        summary: `Economics snapshot v${committed.version} created (immutable)`,
      });
      await t.emit({ type: 'model.version_committed', ...eventBase(ctx, c.id), modelType: 'economics', modelVersionId: committed.id, version: committed.version });
      if (prev)
        await applyMateriality(
          t,
          {
            changeType: 'model_version_changed',
            objectType: 'economics_version',
            objectId: prev.id,
            componentType: 'economics_version',
            fromVersion: prev.version,
            toVersion: committed.version,
            label: `economics v${prev.version}`,
          },
          { now: ctx.now, actorUserId: ctx.userId },
        );
      return toEconomicsVersion(tx, ctx.identity, committed);
    },
  }),

  [API.economics.requestFinanceReview.id]: command(API.economics.requestFinanceReview, {
    load: (ctx, tx) => loadCase(tx, ctx.params.caseRef),
    authorize: (ctx, c) => authorizeOnCase(ctx.identity, ctx.now, c, 'review.request'),
    handle: async (ctx, t, c) => {
      const { tx } = t;
      const v = (await economicsVersions(tx, c.id)).find((x) => x.version === ctx.body.economicsVersion && x.state === 'committed');
      if (!v) throw new ApiError('INVALID_TRANSITION', 'Only a committed economics version can be reviewed.');
      await assertHuman(tx, ctx.body.reviewerId, 'body.reviewerId');
      const row = await tx
        .insertInto('me.model_review')
        .values({
          tenant_id: ctx.tenantId,
          case_id: c.id,
          model_type: 'economics',
          model_version_id: v.id,
          reviewer_user_id: ctx.body.reviewerId,
          requested_by: ctx.userId,
          requested_at: ctx.now,
          due_on: ctx.body.dueOn,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      // Also an inbox item for the reviewer (Reviews › Economics).
      await tx
        .insertInto('platform.review_request')
        .values({
          tenant_id: ctx.tenantId,
          case_id: c.id,
          area: 'finance',
          target_type: 'model_review',
          target_id: row.id,
          question: `Review economics v${v.version}: what did you check and what not?`,
          what_to_check: ['Margin definition', 'Opex scope', `Currency ${v.currency} ${v.price_year}`],
          requested_by: ctx.userId,
          reviewer_user_id: ctx.body.reviewerId,
          due_on: ctx.body.dueOn,
          created_at: ctx.now,
        })
        .execute();
      await t.audit({
        action: 'model_review.requested',
        objectType: 'model_review',
        objectId: row.id,
        caseId: c.id,
        summary: `Finance review of economics v${v.version} requested`,
      });
      return toModelReview(tx, row);
    },
  }),

  [API.economics.signFinanceReview.id]: command(API.economics.signFinanceReview, {
    load: async (ctx, tx) => {
      const r = await tx.selectFrom('me.model_review').selectAll().where('id', '=', ctx.params.id).executeTakeFirst();
      if (!r) throw notFound();
      return { r, c: await caseById(tx, r.case_id) };
    },
    authorize: (ctx, { r, c }) => {
      const d = authorizeOnCase(ctx.identity, ctx.now, c, 'review.sign', { namedReviewerId: r.reviewer_user_id });
      return d.allow || d.code === 'NOT_FOUND' || ctx.userId !== r.reviewer_user_id ? d : allowSelf(ctx.identity, c, r.reviewer_user_id, d.reason);
    },
    handle: async (ctx, t, { r, c }) => {
      if (r.signed_at) throw new ApiError('INVALID_TRANSITION', 'This review is already signed. Request a new review for a new version.');
      if (ctx.body.position === 'not_yet_reviewed' || ctx.body.position === 'accepts_ownership')
        throw new ApiError('VALIDATION_FAILED', 'Sign with a position: supports, supports with conditions, dissents or abstains.');
      const row = await t.tx
        .updateTable('me.model_review')
        .set({
          checked_items: ctx.body.checkedItems,
          not_checked_items: ctx.body.notCheckedItems,
          position: ctx.body.position,
          statement: ctx.body.statement,
          signed_at: ctx.now,
        })
        .where('id', '=', r.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await t.tx
        .updateTable('platform.review_request')
        .set({ status: 'responded', response: ctx.body.position === 'dissents' ? 'dispute' : 'confirm', response_reason: 'Finance review signed', responded_at: ctx.now })
        .where('target_type', '=', 'model_review')
        .where('target_id', '=', r.id)
        .where('status', '=', 'open')
        .execute();
      await t.audit({
        action: 'model_review.signed',
        objectType: 'model_review',
        objectId: r.id,
        caseId: c.id,
        summary: `Finance review signed: ${ctx.body.checkedItems.length} checked, ${ctx.body.notCheckedItems.length} not checked`,
        details: { position: ctx.body.position, checked: ctx.body.checkedItems.length, notChecked: ctx.body.notCheckedItems.length },
      });
      await t.analytics(
        'feasibility_review_recorded',
        { objectType: 'model_review', objectId: r.id, caseId: c.id, stage: c.stage as never },
        { area: 'finance', scoped: true },
      );
      return toModelReview(t.tx, row);
    },
  }),

  [API.economics.export.id]: query(API.economics.export, {
    load: (ctx, tx) => readableCase(tx, ctx.identity, ctx.params.caseRef),
    authorize: (ctx, c) => readDecision(ctx.identity, c),
    handle: async (ctx, { tx }, c) => {
      if (ctx.query.format !== 'csv')
        throw new ApiError('VALIDATION_FAILED', 'XLSX export is not available yet. Export CSV instead.', {
          errors: [{ path: 'query.format', code: 'unsupported', message: 'Use csv' }],
        });
      const v = await pickVersion(tx, c.id, ctx.query.version);
      const o = await calcOutput<EconomicsOutput>(tx, v.calculation_result_id);
      if (!o) throw new ApiError('CALCULATION_BLOCKED', 'Not calculated yet.');
      const lines: string[][] = [
        [`${c.display_key} · Economics v${v.version}${v.state === 'draft' ? ' (draft)' : ''} · ${v.currency} ${v.price_year} prices · horizon ${v.horizon_years} years`],
        [o.exclusionsText],
        [],
        ['Per-year scenarios (recurring money, /year)'],
        ...scenarioTable(o),
        [],
        ['One-time money (never added to per-year figures)'],
        ['One-time scale-entry investment', 'amount' in o.oneTimeInvestment ? `${o.oneTimeInvestment.amount} ${o.oneTimeInvestment.currency}` : `Not available — ${o.oneTimeInvestment.reason}`],
        ['Cash flow', `Not available — ${o.cashFlow.reason}`],
        ['Payback', `Not available — ${o.payback.reason}`],
        [],
        ['Lineage', 'Formula', 'Formula with values'],
        ...o.lineage.map((n) => [n.label, n.formulaText ?? '', n.formulaWithValues ?? '']),
      ];
      ctx.setHeader('content-type', 'text/csv; charset=utf-8');
      ctx.setHeader('content-disposition', `attachment; filename="${c.display_key}-economics-v${v.version}.csv"`);
      return lines.map((l) => l.map(csvCell).join(',')).join('\n') + '\n';
    },
  }),
};
