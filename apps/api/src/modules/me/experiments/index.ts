/**
 * Validation experiments (S09, ME-09). The plan is edited as a draft until G1 locks it (only the G1
 * follow-on locks). After that every change is an amendment with a reason: a new plan version, the
 * pre-registered original stays visible. Results are append-only versions with period and source.
 */
import {
  API,
  type Experiment,
  type ExperimentPlan,
  type ExperimentPlanVersion,
  type ThresholdResult,
} from '@growth-os/contracts';
import { allocateDisplayKey, sql, type Tx } from '@growth-os/db';
import { experimentMachine, type Actor } from '@growth-os/domain';
import { caseVisible, roleAllows } from '../../../platform/authz';
import type { Authorization } from '../../../platform/context';
import { applyMateriality } from '../../../platform/materiality';
import { ApiError, notFound } from '../../../platform/errors';
import { assertIfMatch, command, query, type HandlerMap, type Tools } from '../../../platform/pipeline';
import { isoDate, isoDateTime, isoDateTimeOrNull } from '../../../platform/serialize';
import {
  approvalEffectiveness,
  caseById,
  caseByRef,
  compareDecimal,
  isDecimal,
  peopleOf,
  refuse,
  tenantIdSql,
  type CaseLite,
  type People,
} from '../gates/lib/common';

const human = (userId: string): Actor => ({ kind: 'human', userId, interactive: true });

async function caseOr404(tx: Tx, ref: string): Promise<CaseLite> {
  const c = await caseByRef(tx, ref);
  if (!c) throw notFound();
  return c;
}

function editAuth(
  subject: Parameters<typeof roleAllows>[0],
  c: CaseLite,
  action: 'experiment.edit' | 'experiment.record_result',
): Authorization {
  const v = caseVisible(subject, c);
  if (!v.allow) return v;
  return roleAllows(subject, action, { businessUnitId: c.businessUnitId, caseId: c.id });
}

interface ExpRow {
  id: string;
  case_id: string;
  display_key: string;
  title: string;
  lifecycle: string;
  owner_user_id: string;
  fieldwork_owner_user_id: string | null;
  locked_by_gate_request_id: string | null;
  locked_at: Date | null;
  current_plan_version: number;
  illustrative: boolean;
  row_version: number;
}

async function experimentById(tx: Tx, id: string): Promise<ExpRow | null> {
  return ((await tx.selectFrom('me.experiment').selectAll().where('id', '=', id).executeTakeFirst()) ??
    null) as ExpRow | null;
}

async function loadExp(tx: Tx, id: string): Promise<{ e: ExpRow; c: CaseLite }> {
  const e = await experimentById(tx, id);
  if (!e) throw notFound();
  const c = await caseById(tx, e.case_id);
  if (!c) throw notFound();
  return { e, c };
}

type PlanRow = Awaited<ReturnType<typeof planRows>>[number];

async function planRows(tx: Tx, experimentIds: readonly string[]) {
  if (experimentIds.length === 0) return [];
  const plans = await tx
    .selectFrom('me.experiment_plan_version')
    .selectAll()
    .where('experiment_id', 'in', [...experimentIds])
    .orderBy('version')
    .execute();
  const metrics = plans.length
    ? await tx
        .selectFrom('me.experiment_metric')
        .selectAll()
        .where(
          'plan_version_id',
          'in',
          plans.map((p) => p.id),
        )
        .orderBy('metric_key')
        .execute()
    : [];
  return plans.map((p) => ({ ...p, metrics: metrics.filter((m) => m.plan_version_id === p.id) }));
}

function toPlan(p: PlanRow): ExperimentPlan {
  return {
    hypothesis: p.hypothesis,
    method: p.method,
    sampleText: p.sample_text,
    sampleSize: p.sample_size,
    selectionText: p.selection_text,
    nonresponseNote: p.nonresponse_note,
    windowStart: isoDate(p.window_start as unknown as string),
    windowEnd: isoDate(p.window_end as unknown as string),
    budgetAmount: p.budget_amount,
    currency: p.currency,
    budgetNote: p.budget_note,
    metrics: p.metrics.map((m) => ({
      metricKey: m.metric_key,
      name: m.name,
      operator: m.operator as ExperimentPlan['metrics'][number]['operator'],
      thresholdValue: m.threshold_value === null ? null : trimDecimal(m.threshold_value),
      thresholdText: m.threshold_text,
      unit: m.unit,
    })),
    decisionRules: (p.decision_rules as ExperimentPlan['decisionRules']) ?? [],
  };
}

/** numeric(24,8) comes back as "8.00000000"; contract decimals allow ≤ 8 digits, keep it readable. */
function trimDecimal(v: string): string {
  return v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
}

function toPlanVersion(p: PlanRow, people: People): ExperimentPlanVersion {
  return {
    id: p.id,
    experimentId: p.experiment_id,
    version: p.version,
    isOriginal: p.is_original,
    plan: toPlan(p),
    createdBy: people(p.created_by),
    createdAt: isoDateTime(p.created_at),
  };
}

function displayResult(
  e: ExpRow,
  latest: { observations: unknown } | undefined,
  amended: boolean,
): Experiment['displayResult'] {
  if (e.lifecycle === 'running') return 'running';
  if (e.lifecycle !== 'result_recorded' || !latest) return amended ? 'amended' : 'planned';
  const obs = (latest.observations as { result: ThresholdResult | null }[]) ?? [];
  if (obs.some((o) => o.result === null)) return 'too_early_to_read';
  if (obs.some((o) => o.result === 'not_met')) return 'not_met';
  if (obs.every((o) => o.result === 'met')) return 'met';
  return 'inconclusive';
}

export async function experimentsView(tx: Tx, rows: ExpRow[]): Promise<Experiment[]> {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const [plans, amendments, results, decisions, links, sets] = await Promise.all([
    planRows(tx, ids),
    tx
      .selectFrom('me.experiment_amendment')
      .selectAll()
      .where('experiment_id', 'in', ids)
      .orderBy('number')
      .execute(),
    tx
      .selectFrom('me.experiment_result_version')
      .selectAll()
      .where('experiment_id', 'in', ids)
      .orderBy('version')
      .execute(),
    tx
      .selectFrom('me.experiment_decision')
      .selectAll()
      .where('experiment_id', 'in', ids)
      .orderBy('decided_at')
      .execute(),
    tx
      .selectFrom('me.experiment_assumption')
      .select(['experiment_id', 'assumption_id'])
      .where('experiment_id', 'in', ids)
      .execute(),
    tx
      .selectFrom('platform.task_set')
      .select(['id', 'owner_id'])
      .where('owner_type', '=', 'experiment')
      .where('owner_id', 'in', ids)
      .execute(),
  ]);
  const people = await peopleOf(tx, [
    ...rows.flatMap((r) => [r.owner_user_id, r.fieldwork_owner_user_id]),
    ...plans.map((p) => p.created_by),
    ...amendments.map((a) => a.author_id),
    ...results.map((r) => r.recorded_by),
    ...decisions.map((d) => d.decided_by),
  ]);
  return rows.map((e) => {
    const ps = plans.filter((p) => p.experiment_id === e.id);
    const current = ps.find((p) => p.version === e.current_plan_version) ?? ps[ps.length - 1]!;
    const original = ps.find((p) => p.is_original) ?? null;
    const am = amendments.filter((a) => a.experiment_id === e.id);
    const rs = results.filter((r) => r.experiment_id === e.id);
    const dec = decisions.filter((d) => d.experiment_id === e.id).at(-1);
    return {
      id: e.id,
      key: e.display_key,
      caseId: e.case_id,
      title: e.title,
      lifecycle: e.lifecycle as Experiment['lifecycle'],
      displayResult: displayResult(e, rs.at(-1), am.length > 0),
      owner: people(e.owner_user_id),
      fieldworkOwner: e.fieldwork_owner_user_id ? people(e.fieldwork_owner_user_id) : null,
      dueOn: isoDate(current.window_end as unknown as string),
      linkedAssumptionIds: links.filter((l) => l.experiment_id === e.id).map((l) => l.assumption_id),
      lockedByGateRequestId: e.locked_by_gate_request_id,
      lockedAt: isoDateTimeOrNull(e.locked_at),
      original: original ? toPlanVersion(original, people) : null,
      current: toPlanVersion(current, people),
      amendments: am.map((a) => ({
        id: a.id,
        number: a.number,
        fromPlanVersion: a.from_plan_version,
        toPlanVersion: a.to_plan_version,
        reason: a.reason,
        changedFields: a.changed_fields,
        thresholdsChanged: a.thresholds_changed,
        afterResultsSeen: a.after_results_seen,
        author: people(a.author_id),
        createdAt: isoDateTime(a.created_at),
      })),
      results: rs.map((r) => ({
        id: r.id,
        experimentId: r.experiment_id,
        version: r.version,
        observations: r.observations as Experiment['results'][number]['observations'],
        periodStart: isoDate(r.period_start as unknown as string),
        periodEnd: isoDate(r.period_end as unknown as string),
        sourceText: r.source_text,
        interpretation: r.interpretation,
        limitations: r.limitations,
        recordedBy: people(r.recorded_by),
        recordedAt: isoDateTime(r.recorded_at),
      })),
      decisionTaken: dec
        ? { text: dec.decision_text, by: people(dec.decided_by), at: isoDateTime(dec.decided_at) }
        : null,
      taskSetId: sets.find((s) => s.owner_id === e.id)?.id ?? null,
      illustrative: e.illustrative,
    };
  });
}

async function viewOne(tx: Tx, id: string): Promise<Experiment> {
  const e = (await experimentById(tx, id))!;
  return (await experimentsView(tx, [e]))[0]!;
}

async function insertPlan(
  tx: Tx,
  experimentId: string,
  version: number,
  plan: ExperimentPlan,
  userId: string,
  now: Date,
): Promise<string> {
  const row = await tx
    .insertInto('me.experiment_plan_version')
    .values({
      tenant_id: tenantIdSql,
      experiment_id: experimentId,
      version,
      is_original: false,
      hypothesis: plan.hypothesis,
      method: plan.method,
      sample_text: plan.sampleText,
      sample_size: plan.sampleSize,
      selection_text: plan.selectionText,
      nonresponse_note: plan.nonresponseNote,
      window_start: plan.windowStart,
      window_end: plan.windowEnd,
      budget_amount: plan.budgetAmount,
      currency: plan.currency,
      budget_note: plan.budgetNote,
      decision_rules: JSON.stringify(plan.decisionRules),
      created_by: userId,
      created_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await insertMetrics(tx, row.id, plan);
  return row.id;
}

async function insertMetrics(tx: Tx, planId: string, plan: ExperimentPlan): Promise<void> {
  for (const m of plan.metrics)
    await tx
      .insertInto('me.experiment_metric')
      .values({
        tenant_id: tenantIdSql,
        plan_version_id: planId,
        metric_key: m.metricKey,
        name: m.name,
        operator: m.operator,
        threshold_value: m.thresholdValue,
        threshold_text: m.thresholdText,
        unit: m.unit,
      })
      .execute();
}

function validatePlan(plan: ExperimentPlan, path = 'body.plan'): void {
  const errors = [];
  if (plan.windowEnd < plan.windowStart)
    errors.push({ path: `${path}.windowEnd`, code: 'custom', message: 'The window ends before it starts.' });
  if ((plan.budgetAmount === null) !== (plan.currency === null))
    errors.push({
      path: `${path}.currency`,
      code: 'custom',
      message: 'A budget needs a currency (and vice versa).',
    });
  plan.metrics.forEach((m, i) => {
    if (m.operator !== 'qualitative' && m.thresholdValue === null)
      errors.push({
        path: `${path}.metrics.${i}.thresholdValue`,
        code: 'custom',
        message: 'A threshold needs a value.',
      });
  });
  if (new Set(plan.metrics.map((m) => m.metricKey)).size !== plan.metrics.length)
    errors.push({ path: `${path}.metrics`, code: 'custom', message: 'Metric keys must be unique.' });
  if (errors.length) throw new ApiError('VALIDATION_FAILED', 'The plan is not valid', { errors });
}

async function linkAssumptions(tx: Tx, c: CaseLite, experimentId: string, ids: readonly string[]) {
  const found = ids.length
    ? await tx
        .selectFrom('platform.assumption')
        .select('id')
        .where('case_id', '=', c.id)
        .where('id', 'in', [...ids])
        .execute()
    : [];
  if (found.length !== new Set(ids).size)
    throw new ApiError('VALIDATION_FAILED', 'Link assumptions of this case only.', {
      errors: [{ path: 'body.assumptionIds', code: 'custom', message: 'Unknown assumption for this case' }],
    });
  await tx.deleteFrom('me.experiment_assumption').where('experiment_id', '=', experimentId).execute();
  for (const id of new Set(ids))
    await tx
      .insertInto('me.experiment_assumption')
      .values({ tenant_id: tenantIdSql, experiment_id: experimentId, assumption_id: id })
      .execute();
}

const PLAN_FIELDS: (keyof ExperimentPlan)[] = [
  'hypothesis',
  'method',
  'sampleText',
  'sampleSize',
  'selectionText',
  'nonresponseNote',
  'windowStart',
  'windowEnd',
  'budgetAmount',
  'currency',
  'budgetNote',
  'metrics',
  'decisionRules',
];

function thresholdResult(
  op: string,
  threshold: string | null,
  observed: string | null,
): ThresholdResult | null {
  if (observed === null) return null; // too early to read
  if (op === 'qualitative' || threshold === null || !isDecimal(observed)) return 'inconclusive';
  const c = compareDecimal(observed, threshold);
  const met = op === 'gte' ? c >= 0 : op === 'lte' ? c <= 0 : c === 0;
  return met ? 'met' : 'not_met';
}

async function audit(
  t: Tools,
  e: ExpRow,
  action: string,
  summary: string,
  version?: number,
  details?: Record<string, string | number | boolean | null>,
) {
  await t.audit({
    action,
    objectType: 'experiment',
    objectId: e.id,
    objectVersion: version ?? null,
    caseId: e.case_id,
    summary,
    details,
  });
}

export const experimentHandlers: HandlerMap = {
  [API.experiments.list.id]: query(API.experiments.list, {
    load: (ctx, tx) => caseOr404(tx, ctx.params.caseRef),
    authorize: (ctx, c) => caseVisible(ctx.identity.subject, c),
    handle: async (_ctx, { tx }, c) => {
      const rows = (await tx
        .selectFrom('me.experiment')
        .selectAll()
        .where('case_id', '=', c.id)
        .orderBy('display_key')
        .execute()) as ExpRow[];
      const all = await experimentsView(tx, rows);
      return { items: all.filter((x) => !x.illustrative), examples: all.filter((x) => x.illustrative) };
    },
  }),

  [API.experiments.create.id]: command(API.experiments.create, {
    load: (ctx, tx) => caseOr404(tx, ctx.params.caseRef),
    authorize: (ctx, c) => editAuth(ctx.identity.subject, c, 'experiment.edit'),
    handle: async (ctx, t, c) => {
      const b = ctx.body;
      validatePlan(b.plan);
      const key = await allocateDisplayKey(
        t.tx,
        ctx.tenantId,
        'EXP',
        async (k) =>
          !!(await t.tx
            .selectFrom('me.experiment')
            .select('id')
            .where('display_key', '=', k)
            .executeTakeFirst()),
      );
      const row = await t.tx
        .insertInto('me.experiment')
        .values({
          tenant_id: tenantIdSql,
          case_id: c.id,
          display_key: key,
          title: b.title,
          lifecycle: 'draft',
          owner_user_id: b.ownerId,
          fieldwork_owner_user_id: b.fieldworkOwnerId,
          current_plan_version: 1,
          created_by: ctx.userId,
          created_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await linkAssumptions(t.tx, c, row.id, b.assumptionIds);
      await insertPlan(t.tx, row.id, 1, b.plan, ctx.userId, ctx.now);
      const e = (await experimentById(t.tx, row.id))!;
      await audit(t, e, 'experiment.created', `${key} drafted in ${c.key}`, 1, {
        metrics: b.plan.metrics.length,
      });
      return viewOne(t.tx, row.id);
    },
  }),

  [API.experiments.updateDraft.id]: command(API.experiments.updateDraft, {
    load: (ctx, tx) => loadExp(tx, ctx.params.id),
    authorize: (ctx, { c }) => editAuth(ctx.identity.subject, c, 'experiment.edit'),
    handle: async (ctx, t, { e, c }) => {
      assertIfMatch(ctx, e.row_version);
      if (e.lifecycle !== 'draft')
        throw new ApiError(
          'INVALID_TRANSITION',
          'This plan is locked by G1. Use an amendment with a reason.',
        );
      const [p] = await planRows(t.tx, [e.id]).then((ps) =>
        ps.filter((x) => x.version === e.current_plan_version),
      );
      const merged: ExperimentPlan = { ...toPlan(p!), ...(ctx.body.plan ?? {}) };
      validatePlan(merged);
      await t.tx
        .updateTable('me.experiment_plan_version')
        .set({
          hypothesis: merged.hypothesis,
          method: merged.method,
          sample_text: merged.sampleText,
          sample_size: merged.sampleSize,
          selection_text: merged.selectionText,
          nonresponse_note: merged.nonresponseNote,
          window_start: merged.windowStart,
          window_end: merged.windowEnd,
          budget_amount: merged.budgetAmount,
          currency: merged.currency,
          budget_note: merged.budgetNote,
          decision_rules: JSON.stringify(merged.decisionRules),
        })
        .where('id', '=', p!.id)
        .execute();
      if (ctx.body.plan?.metrics) {
        await t.tx.deleteFrom('me.experiment_metric').where('plan_version_id', '=', p!.id).execute();
        await insertMetrics(t.tx, p!.id, merged);
      }
      if (ctx.body.assumptionIds) await linkAssumptions(t.tx, c, e.id, ctx.body.assumptionIds);
      const upd = await t.tx
        .updateTable('me.experiment')
        .set({ title: ctx.body.title ?? e.title })
        .where('id', '=', e.id)
        .returning('row_version')
        .executeTakeFirstOrThrow();
      ctx.setETag(upd.row_version);
      await audit(
        t,
        e,
        'experiment.draft_saved',
        `${e.display_key} draft plan edited`,
        e.current_plan_version,
      );
      return viewOne(t.tx, e.id);
    },
  }),

  [API.experiments.amend.id]: command(API.experiments.amend, {
    load: (ctx, tx) => loadExp(tx, ctx.params.id),
    authorize: (ctx, { c }) => editAuth(ctx.identity.subject, c, 'experiment.edit'),
    handle: async (ctx, t, { e }) => {
      const r = experimentMachine.apply(e.lifecycle as never, 'amend', human(ctx.userId), {
        reason: ctx.body.reason,
      });
      if (!r.ok)
        refuse(
          r,
          e.lifecycle === 'draft'
            ? 'A draft plan is edited directly; amendments start after G1 locks it.'
            : undefined,
        );
      const plans = await planRows(t.tx, [e.id]);
      const current = plans.find((p) => p.version === e.current_plan_version)!;
      const before = toPlan(current);
      const after: ExperimentPlan = { ...before, ...ctx.body.plan };
      validatePlan(after);
      const changed = PLAN_FIELDS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      if (changed.length === 0) throw new ApiError('VALIDATION_FAILED', 'The amendment changes nothing.');
      const toVersion = Math.max(...plans.map((p) => p.version)) + 1;
      await insertPlan(t.tx, e.id, toVersion, after, ctx.userId, ctx.now);
      const prior = await t.tx
        .selectFrom('me.experiment_amendment')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('experiment_id', '=', e.id)
        .executeTakeFirst();
      const results = await t.tx
        .selectFrom('me.experiment_result_version')
        .select('id')
        .where('experiment_id', '=', e.id)
        .executeTakeFirst();
      const number = (prior?.n ?? 0) + 1;
      await t.tx
        .insertInto('me.experiment_amendment')
        .values({
          tenant_id: tenantIdSql,
          experiment_id: e.id,
          number,
          from_plan_version: e.current_plan_version,
          to_plan_version: toVersion,
          reason: ctx.body.reason,
          changed_fields: changed,
          thresholds_changed: changed.includes('metrics'),
          after_results_seen: !!results,
          author_id: ctx.userId,
          created_at: ctx.now,
        })
        .execute();
      await t.tx
        .updateTable('me.experiment')
        .set({ current_plan_version: toVersion })
        .where('id', '=', e.id)
        .execute();
      await audit(
        t,
        e,
        r.auditAction,
        `${e.display_key} amendment ${number}: ${changed.join(', ')}`,
        toVersion,
        {
          amendment: number,
          thresholdsChanged: changed.includes('metrics'),
        },
      );
      // A pinned plan changed: the tenant policy decides (unlisted → uncertain → sponsor resolves).
      await applyMateriality(
        t,
        {
          changeType: 'other',
          objectType: 'experiment_plan_version',
          objectId: current.id,
          componentType: 'experiment_plan_version',
          fromVersion: current.version,
          toVersion,
          label: `${e.display_key} plan`,
        },
        { now: ctx.now, actorUserId: ctx.userId },
      );
      return viewOne(t.tx, e.id);
    },
  }),

  [API.experiments.start.id]: command(API.experiments.start, {
    load: (ctx, tx) => loadExp(tx, ctx.params.id),
    authorize: (ctx, { c }) => editAuth(ctx.identity.subject, c, 'experiment.edit'),
    handle: async (ctx, t, { e }) => {
      const authorizingGate = await approvalEffectiveness(t.tx, e.locked_by_gate_request_id, ctx.now);
      const r = experimentMachine.apply(e.lifecycle as never, 'start', human(ctx.userId), {
        authorizingGate,
      });
      if (!r.ok) refuse(r);
      await t.tx.updateTable('me.experiment').set({ lifecycle: r.to }).where('id', '=', e.id).execute();
      await audit(t, e, r.auditAction, `${e.display_key} started`, e.current_plan_version);
      return viewOne(t.tx, e.id);
    },
  }),

  [API.experiments.recordResult.id]: command(API.experiments.recordResult, {
    load: (ctx, tx) => loadExp(tx, ctx.params.id),
    authorize: (ctx, { c }) => editAuth(ctx.identity.subject, c, 'experiment.record_result'),
    handle: async (ctx, t, { e }) => {
      const b = ctx.body;
      if (b.periodEnd < b.periodStart)
        throw new ApiError('VALIDATION_FAILED', 'The period ends before it starts.', {
          errors: [{ path: 'body.periodEnd', code: 'custom', message: 'Must not be before periodStart' }],
        });
      const plans = await planRows(t.tx, [e.id]);
      const current = plans.find((p) => p.version === e.current_plan_version)!;
      const metrics = new Map(current.metrics.map((m) => [m.metric_key, m]));
      const unknown = b.observations.filter((o) => !metrics.has(o.metricKey));
      if (unknown.length)
        throw new ApiError('VALIDATION_FAILED', 'Observations must use the pre-registered metrics.', {
          errors: unknown.map((o) => ({
            path: 'body.observations',
            code: 'custom',
            message: `Unknown metric ${o.metricKey}`,
          })),
        });
      const observations = current.metrics.map((m) => {
        const o = b.observations.find((x) => x.metricKey === m.metric_key);
        const observed = o?.observed ?? null;
        return {
          metricKey: m.metric_key,
          observed,
          observedText: o?.observedText ?? 'Too early to read',
          result: thresholdResult(m.operator, m.threshold_value, observed),
        };
      });
      const r = experimentMachine.apply(e.lifecycle as never, 'record_result', human(ctx.userId), {
        result: {
          periodStart: b.periodStart,
          periodEnd: b.periodEnd,
          source: b.sourceText,
          metrics: observations.map((o) => ({
            observed: o.observed !== null,
            tooEarly: o.observed === null,
          })),
        },
      });
      if (!r.ok) refuse(r);
      const prev = await t.tx
        .selectFrom('me.experiment_result_version')
        .select(['id', 'version'])
        .where('experiment_id', '=', e.id)
        .orderBy('version', 'desc')
        .executeTakeFirst();
      const version = (prev?.version ?? 0) + 1;
      const row = await t.tx
        .insertInto('me.experiment_result_version')
        .values({
          tenant_id: tenantIdSql,
          experiment_id: e.id,
          version,
          observations: JSON.stringify(observations),
          period_start: b.periodStart,
          period_end: b.periodEnd,
          source_text: b.sourceText,
          interpretation: b.interpretation,
          limitations: b.limitations,
          recorded_by: ctx.userId,
          recorded_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.tx.updateTable('me.experiment').set({ lifecycle: r.to }).where('id', '=', e.id).execute();
      const count = (x: ThresholdResult) => observations.filter((o) => o.result === x).length;
      await audit(t, e, r.auditAction, `${e.display_key} result v${version} recorded`, version, {
        resultVersionId: row.id,
        met: count('met'),
        notMet: count('not_met'),
      });
      for (const ev of r.events)
        if (ev === 'experiment_completed')
          await t.analytics(
            'experiment_completed',
            { objectType: 'experiment', objectId: e.id, objectVersion: version, caseId: e.case_id },
            {
              metrics: observations.length,
              met: count('met'),
              notMet: count('not_met'),
              inconclusive: count('inconclusive'),
            },
          );
      if (prev)
        await applyMateriality(
          t,
          {
            changeType: 'other',
            objectType: 'experiment_result_version',
            objectId: prev.id,
            componentType: 'experiment_result_version',
            fromVersion: prev.version,
            toVersion: version,
            label: `${e.display_key} result`,
          },
          { now: ctx.now, actorUserId: ctx.userId },
        );
      return viewOne(t.tx, e.id);
    },
  }),

  [API.experiments.recordDecision.id]: command(API.experiments.recordDecision, {
    load: (ctx, tx) => loadExp(tx, ctx.params.id),
    authorize: (ctx, { c }) => editAuth(ctx.identity.subject, c, 'experiment.record_result'),
    handle: async (ctx, t, { e }) => {
      if (e.lifecycle !== 'result_recorded')
        throw new ApiError(
          'INVALID_TRANSITION',
          'Record the results before the decision taken under the rule.',
        );
      const row = await t.tx
        .insertInto('me.experiment_decision')
        .values({
          tenant_id: tenantIdSql,
          experiment_id: e.id,
          decision_text: ctx.body.decisionText,
          decided_by: ctx.userId,
          decided_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await audit(
        t,
        e,
        'experiment.decision_recorded',
        `${e.display_key} decision under the pre-registered rule recorded`,
        undefined,
        {
          decisionId: row.id,
        },
      );
      return viewOne(t.tx, e.id);
    },
  }),
};
