/**
 * Outcome review (S12, ME-14). Actuals are append-only versions with period and source, compared to the
 * thresholds pre-registered in the approved G2 snapshot. The recommendation is not a decision; only the
 * sponsor or the investment committee records the decision. "Scale" is never an outcome decision: it
 * needs a G3 request, blocked while its preconditions are unmet. An extension is its own X gate request
 * with its own cap and does not unblock G3.
 */
import {
  API,
  DECISION_OUTCOME_LABELS,
  type DecisionOutcome,
  type DecisionRecord,
  type OutcomeObservation,
  type OutcomeReviewView,
  type ThresholdResult,
} from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { createPolicyEngine } from '@growth-os/domain';
import { caseVisible, roleAllows } from '../../../platform/authz';
import type { Authorization } from '../../../platform/context';
import { ApiError, notFound } from '../../../platform/errors';
import { assertIfMatch, command, query, type HandlerMap } from '../../../platform/pipeline';
import { isoDate, isoDateTime } from '../../../platform/serialize';
import {
  caseByRef,
  caseResource,
  compareDecimal,
  peopleOf,
  scaled,
  subjectOf,
  tenantIdSql,
  type CaseLite,
  type People,
} from '../gates/lib/common';
import { loadGateCtx } from '../gates/lib/access';
import { evaluate } from '../gates/lib/facts';
import { moveCase } from '../gates/lib/moves';
import { gateById, scopeOf } from '../gates/lib/serialize';
import { nextGateKey, submitGate } from '../gates';

const policy = createPolicyEngine();

const RECOMMENDATION_LABELS: Record<DecisionOutcome, string> = {
  extend: 'Revise and extend validation',
  revise: 'Revise',
  proceed: 'Proceed',
  stop: 'Stop',
  scale: 'Request scale approval (G3)',
};

/** Placeholder causal limitation shown until the team states one (the decision requires a real one). */
const NO_LIMITATIONS = 'Causal limitations not stated yet — required before a decision.';

async function caseOr404(tx: Tx, ref: string): Promise<CaseLite> {
  const c = await caseByRef(tx, ref);
  if (!c) throw notFound();
  return c;
}

function scoped(subject: Parameters<typeof roleAllows>[0], c: CaseLite, action: Parameters<typeof roleAllows>[1]): Authorization {
  const v = caseVisible(subject, c);
  if (!v.allow) return v;
  return roleAllows(subject, action, { businessUnitId: c.businessUnitId, caseId: c.id });
}

async function reviewOf(tx: Tx, caseId: string) {
  return tx
    .selectFrom('me.outcome_review')
    .selectAll()
    .where('case_id', '=', caseId)
    .orderBy('version', 'desc')
    .executeTakeFirst();
}
type ReviewRow = NonNullable<Awaited<ReturnType<typeof reviewOf>>>;

async function targetsOf(tx: Tx, gateRequestId: string) {
  const g = await tx.selectFrom('platform.gate_request').select('current_snapshot_id').where('id', '=', gateRequestId).executeTakeFirst();
  if (!g?.current_snapshot_id) return [];
  return tx.selectFrom('platform.outcome_target').selectAll().where('snapshot_id', '=', g.current_snapshot_id).orderBy('metric_key').execute();
}
type TargetRow = Awaited<ReturnType<typeof targetsOf>>[number];

const trim = (v: string | null) => (v === null ? null : v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v);

function toTarget(t: TargetRow) {
  return {
    id: t.id,
    metricKey: t.metric_key,
    name: t.name,
    thresholdText: t.threshold_text,
    operator: t.operator as 'gte',
    thresholdValue: trim(t.threshold_value),
    unit: t.unit,
    windowText: t.window_text,
    snapshotId: t.snapshot_id,
  };
}

type ObsRow = {
  id: string;
  target_id: string | null;
  label: string;
  version: number;
  value: string | null;
  value_text: string;
  unit: string;
  period_start: unknown;
  period_end: unknown;
  source_text: string;
  source_id: string | null;
  result: string | null;
  supersedes_id: string | null;
  recorded_by: string;
  recorded_at: Date;
};

function toObservation(o: ObsRow, people: People): OutcomeObservation {
  return {
    id: o.id,
    targetId: o.target_id,
    version: o.version,
    valueText: o.value_text,
    value: trim(o.value),
    unit: o.unit,
    periodStart: isoDate(o.period_start as string),
    periodEnd: isoDate(o.period_end as string),
    sourceText: o.source_text,
    sourceId: o.source_id,
    result: o.result as ThresholdResult | null,
    recordedBy: people(o.recorded_by),
    recordedAt: isoDateTime(o.recorded_at),
    supersedesId: o.supersedes_id,
  };
}

/**
 * Result of an actual against a pre-registered target. Numeric thresholds compare exactly. Placeholder
 * thresholds ("Within [hours per site]") read the stated direction ("Above assumption …"); qualitative
 * targets are Inconclusive unless a later human judgement says otherwise (CR-WS4b-4).
 */
export function resultFor(t: TargetRow | undefined, value: string | null, valueText: string): ThresholdResult | null {
  if (!t) return null;
  if (t.operator === 'qualitative') return 'inconclusive';
  if (t.threshold_value !== null && value !== null) {
    const c = compareDecimal(value, t.threshold_value);
    const met = t.operator === 'gte' ? c >= 0 : t.operator === 'lte' ? c <= 0 : c === 0;
    return met ? 'met' : 'not_met';
  }
  const text = valueText.trim().toLowerCase();
  const above = /^(above|over|exceed)/.test(text);
  const below = /^(below|under|within)/.test(text);
  if (!above && !below) return 'inconclusive';
  if (t.operator === 'lte') return above ? 'not_met' : 'met';
  if (t.operator === 'gte') return above ? 'met' : 'not_met';
  return 'inconclusive';
}

async function decisionRecord(tx: Tx, id: string | null): Promise<DecisionRecord | null> {
  if (!id) return null;
  const d = await tx.selectFrom('platform.decision_record').selectAll().where('id', '=', id).executeTakeFirst();
  if (!d) return null;
  const people = await peopleOf(tx, [d.decided_by, d.on_recommendation_of]);
  return {
    id: d.id,
    caseId: d.case_id,
    outcome: d.outcome as DecisionOutcome,
    label: d.label,
    rationale: d.rationale,
    decidedBy: people(d.decided_by),
    decidedAt: isoDateTime(d.decided_at),
    onRecommendationOf: d.on_recommendation_of ? people(d.on_recommendation_of) : null,
    outcomeReviewId: d.outcome_review_id,
  };
}

export async function reviewView(tx: Tx, c: CaseLite, r: ReviewRow): Promise<OutcomeReviewView> {
  const targets = await targetsOf(tx, r.gate_request_id);
  const obs = (await tx
    .selectFrom('platform.outcome_observation')
    .selectAll()
    .where('case_id', '=', c.id)
    .orderBy('recorded_at')
    .orderBy('version')
    .execute()) as ObsRow[];
  const rec = r.recommendation as { outcome: DecisionOutcome; label: string; text: string; by: string } | null;
  const people = await peopleOf(tx, [...obs.map((o) => o.recorded_by), rec?.by]);
  const superseded = new Set(obs.map((o) => o.supersedes_id).filter(Boolean));
  const latestOf = (list: ObsRow[]) => list.filter((o) => !superseded.has(o.id)).at(-1) ?? null;
  const rows: OutcomeReviewView['rows'] = targets.map((t) => {
    const hist = obs.filter((o) => o.target_id === t.id);
    const latest = latestOf(hist);
    return {
      target: toTarget(t),
      label: t.name,
      latest: latest ? toObservation(latest, people) : null,
      history: hist.map((o) => toObservation(o, people)),
      notAThreshold: false,
    };
  });
  const free = obs.filter((o) => o.target_id === null || !targets.some((t) => t.id === o.target_id));
  for (const label of [...new Set(free.map((o) => o.label))]) {
    const hist = free.filter((o) => o.label === label);
    const latest = latestOf(hist);
    rows.push({
      target: null,
      label,
      latest: latest ? toObservation(latest, people) : null,
      history: hist.map((o) => toObservation(o, people)),
      notAThreshold: true,
    });
  }
  const missing = rows.filter((x) => x.target && !x.latest);
  const decision = await decisionRecord(tx, r.decision_record_id);
  const g3 = await evaluate(tx, { gateCode: 'G3', caseRow: c, gate: null });
  return {
    id: r.id,
    caseId: c.id,
    version: r.version,
    status: decision ? 'decided' : missing.length ? 'incomplete' : 'ready',
    incompleteReasons: missing.map((x) => `${x.label} · no data recorded`),
    rows,
    whatWeLearned: r.what_we_learned,
    whatChangesNext: r.what_changes_next,
    causalLimitations: r.causal_limitations.length ? r.causal_limitations : [NO_LIMITATIONS],
    readiness: [],
    recommendation: rec
      ? {
          outcome: rec.outcome,
          label: rec.label,
          text: rec.text,
          by: people(rec.by),
          accepted: !!decision && decision.outcome === rec.outcome,
        }
      : null,
    decision,
    scaleGate: { blocked: !g3.allMet, unmet: g3.blockers },
  };
}

async function needReview(tx: Tx, c: CaseLite): Promise<ReviewRow> {
  const r = await reviewOf(tx, c.id);
  if (!r) throw new ApiError('INVALID_TRANSITION', 'The outcome review opens when the pilot is activated.');
  return r;
}

export const outcomeHandlers: HandlerMap = {
  [API.outcomes.get.id]: query(API.outcomes.get, {
    load: (ctx, tx) => caseOr404(tx, ctx.params.caseRef),
    authorize: (ctx, c) => caseVisible(ctx.identity.subject, c),
    handle: async (_ctx, { tx }, c) => {
      const r = await reviewOf(tx, c.id);
      if (!r) throw notFound();
      return reviewView(tx, c, r);
    },
  }),

  [API.outcomes.recordObservation.id]: command(API.outcomes.recordObservation, {
    load: (ctx, tx) => caseOr404(tx, ctx.params.caseRef),
    authorize: (ctx, c) => scoped(ctx.identity.subject, c, 'outcome.record'),
    handle: async (ctx, t, c) => {
      const b = ctx.body;
      if (b.periodEnd < b.periodStart)
        throw new ApiError('VALIDATION_FAILED', 'The period ends before it starts.', {
          errors: [{ path: 'body.periodEnd', code: 'custom', message: 'Must not be before periodStart' }],
        });
      const review = await needReview(t.tx, c);
      const targets = await targetsOf(t.tx, review.gate_request_id);
      const target = b.targetId ? targets.find((x) => x.id === b.targetId) : undefined;
      if (b.targetId && !target) throw notFound();
      if (b.sourceId) {
        const s = await t.tx.selectFrom('platform.source').select('id').where('id', '=', b.sourceId).executeTakeFirst();
        if (!s) throw notFound();
      }
      let version = 1;
      if (b.supersedesId) {
        const prev = await t.tx
          .selectFrom('platform.outcome_observation')
          .select(['id', 'version', 'target_id'])
          .where('id', '=', b.supersedesId)
          .where('case_id', '=', c.id)
          .executeTakeFirst();
        if (!prev) throw notFound();
        if (prev.target_id !== (b.targetId ?? null))
          throw new ApiError('VALIDATION_FAILED', 'A new version must be for the same target.');
        const newer = await t.tx.selectFrom('platform.outcome_observation').select('id').where('supersedes_id', '=', prev.id).executeTakeFirst();
        if (newer) throw new ApiError('INVALID_TRANSITION', 'That actual already has a newer version.');
        version = prev.version + 1;
      }
      if (b.value !== null && scaled(b.value) < 0n && target?.unit === 'customers')
        throw new ApiError('VALIDATION_FAILED', 'Counts are not negative.');
      const result = resultFor(target, b.value, b.valueText);
      const row = (await t.tx
        .insertInto('platform.outcome_observation')
        .values({
          tenant_id: tenantIdSql,
          case_id: c.id,
          target_id: target?.id ?? null,
          label: target?.name ?? b.unit,
          version,
          value: b.value,
          value_text: b.valueText,
          unit: b.unit,
          period_start: b.periodStart,
          period_end: b.periodEnd,
          source_text: b.sourceText,
          source_id: b.sourceId,
          result,
          supersedes_id: b.supersedesId,
          recorded_by: ctx.userId,
          recorded_at: ctx.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow()) as ObsRow;
      await t.audit({
        action: 'outcome.recorded',
        objectType: 'outcome_observation',
        objectId: row.id,
        objectVersion: version,
        caseId: c.id,
        summary: `Actual recorded for ${target?.name ?? 'an untargeted measure'} (v${version})`,
        details: { targetId: target?.id ?? null, result: result ?? null },
      });
      await t.analytics(
        'outcome_recorded',
        { objectType: 'outcome_observation', objectId: row.id, objectVersion: version, caseId: c.id },
        { result },
      );
      return toObservation(row, await peopleOf(t.tx, [ctx.userId]));
    },
  }),

  [API.outcomes.saveReviewDraft.id]: command(API.outcomes.saveReviewDraft, {
    load: (ctx, tx) => caseOr404(tx, ctx.params.caseRef),
    authorize: (ctx, c) => scoped(ctx.identity.subject, c, 'outcome.record'),
    handle: async (ctx, t, c) => {
      const r = await needReview(t.tx, c);
      assertIfMatch(ctx, r.row_version);
      if (r.status === 'decided') throw new ApiError('INVALID_TRANSITION', 'This review is decided. Start a new review version.');
      const b = ctx.body;
      const rec =
        b.recommendation === undefined
          ? undefined
          : b.recommendation === null
            ? null
            : JSON.stringify({
                outcome: b.recommendation.outcome,
                label: RECOMMENDATION_LABELS[b.recommendation.outcome] ?? DECISION_OUTCOME_LABELS[b.recommendation.outcome],
                text: b.recommendation.text,
                by: ctx.userId,
              });
      const clean = (xs: string[] | undefined) => xs?.map((x) => x.trim()).filter(Boolean);
      const upd = await t.tx
        .updateTable('me.outcome_review')
        .set({
          ...(b.whatWeLearned ? { what_we_learned: clean(b.whatWeLearned) } : {}),
          ...(b.whatChangesNext ? { what_changes_next: clean(b.whatChangesNext) } : {}),
          ...(b.causalLimitations ? { causal_limitations: clean(b.causalLimitations) } : {}),
          ...(rec !== undefined ? { recommendation: rec } : {}),
        })
        .where('id', '=', r.id)
        .returning('row_version')
        .executeTakeFirstOrThrow();
      ctx.setETag(upd.row_version);
      await t.audit({
        action: 'outcome_review.draft_saved',
        objectType: 'outcome_review',
        objectId: r.id,
        objectVersion: r.version,
        caseId: c.id,
        summary: `Outcome review v${r.version} edited${b.recommendation ? ' (recommendation is not a decision)' : ''}`,
        details: { recommendation: b.recommendation?.outcome ?? null },
      });
      return reviewView(t.tx, c, (await reviewOf(t.tx, c.id))!);
    },
  }),

  [API.outcomes.decide.id]: command(API.outcomes.decide, {
    load: (ctx, tx) => caseOr404(tx, ctx.params.caseRef),
    authorize: (ctx, c) => {
      const v = caseVisible(ctx.identity.subject, c);
      if (!v.allow) return v;
      const d = policy.check(subjectOf(ctx), 'outcome.decide', caseResource(c));
      return d.allow ? { allow: true, rule: d.rule, authorityGrantId: null, role: v.role } : d;
    },
    handle: async (ctx, t, c) => {
      const r = await needReview(t.tx, c);
      if (r.decision_record_id) throw new ApiError('INVALID_TRANSITION', 'This review already has a decision.');
      const b = ctx.body;
      const facts = { reviewAuthority: true, rationale: b.rationale, causalLimitations: r.causal_limitations };
      const rec = r.recommendation as { outcome: DecisionOutcome; by: string } | null;
      let props = {};
      {
        if (!r.causal_limitations.some((x) => x.trim()))
          throw new ApiError('PRECONDITIONS_UNMET', 'State the causal limitations before deciding.', {
            blockers: [{ key: 'causal_limitations_present', message: 'State the causal limitations before deciding.' }],
          });
      }
      const d = await t.tx
        .insertInto('platform.decision_record')
        .values({
          tenant_id: tenantIdSql,
          case_id: c.id,
          outcome: b.outcome,
          label: b.label,
          rationale: b.rationale,
          decided_by: ctx.userId,
          on_recommendation_of: rec && rec.outcome === b.outcome ? rec.by : null,
          outcome_review_id: r.id,
          decided_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (b.outcome === 'revise' || b.outcome === 'extend' || b.outcome === 'stop') {
        const gate = await t.tx
          .selectFrom('platform.gate_request')
          .select('gate_code')
          .where('id', '=', r.gate_request_id)
          .executeTakeFirst();
        props =
          b.outcome === 'stop'
            ? { case_stopped: { fromStage: c.stage as never, outcome: 'stop' as const } }
            : { extension_requested: { parentGate: (gate?.gate_code ?? 'G2') as 'G2' } };
        await moveCase(t, c.id, b.outcome === 'stop' ? 'outcome_stop' : 'outcome_revise_or_extend', {
          actor: ctx.identity.actor,
          facts,
          strict: true,
          props,
          reason: `outcome ${b.outcome}`,
        });
      }
      await t.tx
        .updateTable('me.outcome_review')
        .set({ status: 'decided', decision_record_id: d.id })
        .where('id', '=', r.id)
        .execute();
      await t.audit({
        action: 'outcome.decided',
        objectType: 'decision_record',
        objectId: d.id,
        caseId: c.id,
        summary: `Outcome decision: ${b.label}`,
        details: { outcome: b.outcome, outcomeReviewId: r.id },
      });
      const fresh = (await caseByRef(t.tx, c.id))!;
      return {
        decision: (await decisionRecord(t.tx, d.id))!,
        review: await reviewView(t.tx, fresh, (await reviewOf(t.tx, c.id))!),
      };
    },
  }),

  [API.outcomes.requestExtension.id]: command(API.outcomes.requestExtension, {
    load: (ctx, tx) => caseOr404(tx, ctx.params.caseRef),
    authorize: (ctx, c) => scoped(ctx.identity.subject, c, 'gate.submit'),
    handle: async (ctx, t, c) => {
      const b = ctx.body;
      const parent = await gateById(t.tx, b.parentGateRequestId);
      if (!parent || parent.case_id !== c.id) throw notFound();
      if (b.spendCap.startsWith('-'))
        throw new ApiError('VALIDATION_FAILED', 'The cap is not negative.', {
          errors: [{ path: 'body.spendCap', code: 'custom', message: 'Must not be negative' }],
        });
      // "0" means the cap is still a placeholder (€[cap], D-040): requested, never approvable.
      const amount = scaled(b.spendCap) === 0n ? null : b.spendCap;
      const ps = scopeOf(parent);
      const scope = {
        amount,
        currency: b.currency,
        durationDays: b.durationDays,
        windowStart: null,
        windowEnd: null,
        countryCodes: ps.countryCodes,
        segmentLabel: ps.segmentLabel,
        maxSites: ps.maxSites,
        milestones: [],
        ownerId: b.ownerId,
        authorizes: b.scopeItems,
        doesNotAuthorize: ['Not scale', 'No new sites without a new gate', 'Does not unblock G3'],
        proposedConditions: [],
      };
      const key = await nextGateKey(t.tx, c, 'X');
      const row = await t.tx
        .insertInto('platform.gate_request')
        .values({
          tenant_id: tenantIdSql,
          display_key: key,
          case_id: c.id,
          subject_type: 'case',
          subject_id: c.id,
          business_unit_id: c.businessUnitId,
          gate_code: 'X',
          status: 'draft',
          scope: JSON.stringify(scope),
          requested_amount: amount,
          currency: amount ? b.currency : null,
          duration_days: b.durationDays,
          parent_gate_request_id: parent.id,
          created_by: ctx.userId,
          created_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'gate_request.created',
        objectType: 'gate_request',
        objectId: row.id,
        caseId: c.id,
        summary: `${key} drafted as an extension of ${parent.display_key}${amount ? '' : ' (cap placeholder €[cap])'}`,
        details: { gate: 'X', parentGateRequestId: parent.id, capPlaceholder: amount === null },
      });
      const g = await loadGateCtx(t.tx, row.id);
      const out = await submitGate(ctx, t, g, 'submit');
      await t.analytics(
        'extension_requested',
        { objectType: 'gate_request', objectId: row.id, caseId: c.id },
        { parentGate: parent.gate_code as 'G2' },
      );
      return out.gateRequest;
    },
  }),
};
