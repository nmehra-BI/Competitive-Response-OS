/**
 * Assumption register and disputes (S09, ME-08, ME-15). A value change creates a new immutable version
 * and runs the materiality check in the same transaction (D-047): snapshots pinning the previous
 * version go stale ("adoption assumption changed on 26 Nov") and effective approvals are invalidated.
 */
import { API, type ValueUnit } from '@growth-os/contracts';
import { allocateDisplayKey, type Tx } from '@growth-os/db';
import type { Authorization, Identity } from '../../../platform/context';
import { ApiError, notFound } from '../../../platform/errors';
import { applyMateriality } from '../../../platform/materiality';
import { assertIfMatch, command, query, type HandlerMap } from '../../../platform/pipeline';
import {
  allowSelf,
  assertHuman,
  authorizeAny,
  authorizeOnCase,
  canRead,
  caseById,
  eventBase,
  findCase,
  peopleMap,
  readDecision,
  readableCase,
  trimDecimal,
  type CaseRecord,
} from '../cases/access';
import {
  assumptionLabel,
  caseAssumptions,
  challengesWhere,
  toAssumptions,
  toVersion,
  type AssumptionRow,
  type VersionRow,
} from './read';

const MONEY_UNITS = new Set<ValueUnit>([
  'currency_per_year_per_site',
  'currency_per_year',
  'currency_one_time',
]);

async function loadAssumption(tx: Tx, id: string): Promise<{ a: AssumptionRow; c: CaseRecord }> {
  const a = (await tx
    .selectFrom('platform.assumption')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()) as AssumptionRow | undefined;
  if (!a) throw notFound();
  return { a, c: await caseById(tx, a.case_id) };
}

async function one(tx: Tx, a: AssumptionRow, c: CaseRecord) {
  const row = (await tx
    .selectFrom('platform.assumption')
    .selectAll()
    .where('id', '=', a.id)
    .executeTakeFirstOrThrow()) as AssumptionRow;
  return (await toAssumptions(tx, [row], c.display_key))[0]!;
}

function checkValue(value: string | null | undefined, unit: string): void {
  if (value === null || value === undefined) return;
  if (unit === 'rate' && (Number(value) < 0 || Number(value) > 1))
    throw new ApiError('VALIDATION_FAILED', 'A rate is a fraction between 0 and 1 (20% is 0.20).', {
      errors: [{ path: 'body.value', code: 'rate_range', message: 'Rate must be in [0, 1]' }],
    });
}

async function priceBasis(
  tx: Tx,
  c: CaseRecord,
  now: Date,
): Promise<{ currency: string; priceYear: number }> {
  const b = await tx
    .selectFrom('me.sizing_version as v')
    .innerJoin('me.market_boundary as b', 'b.id', 'v.market_boundary_id')
    .select(['b.currency', 'b.price_year'])
    .where('v.case_id', '=', c.id)
    .orderBy('v.version', 'desc')
    .executeTakeFirst();
  if (b) return { currency: b.currency, priceYear: b.price_year };
  const m = c.mandate_id
    ? await tx
        .selectFrom('me.mandate as m')
        .innerJoin('me.mandate_version as v', 'v.id', 'm.current_version_id')
        .select('v.currency')
        .where('m.id', '=', c.mandate_id)
        .executeTakeFirst()
    : undefined;
  return { currency: m?.currency ?? 'EUR', priceYear: now.getUTCFullYear() };
}

/** Who may resolve a challenge: disputes → the disputing reviewer or the sponsor (policy); challenges → also the case owner. */
function canResolve(
  identity: Identity,
  now: Date,
  c: CaseRecord,
  raisedBy: string,
  kind: string,
): Authorization {
  const d = authorizeOnCase(identity, now, c, 'challenge.resolve', { namedReviewerId: raisedBy });
  if (d.allow) return d;
  if (d.code === 'NOT_FOUND') return d;
  if (identity.user.id === raisedBy) return allowSelf(identity, c, raisedBy, d.reason);
  if (kind === 'challenge' && identity.user.id === c.owner_user_id)
    return allowSelf(identity, c, c.owner_user_id, d.reason);
  return d;
}

async function loadChallenge(tx: Tx, id: string) {
  const ch = await tx.selectFrom('platform.challenge').selectAll().where('id', '=', id).executeTakeFirst();
  if (!ch || !ch.case_id) throw notFound();
  return { ch, c: await caseById(tx, ch.case_id) };
}

export const assumptionHandlers: HandlerMap = {
  [API.assumptions.list.id]: query(API.assumptions.list, {
    load: (ctx, tx) => readableCase(tx, ctx.identity, ctx.params.caseRef),
    authorize: (ctx, c) => readDecision(ctx.identity, c),
    handle: async (_ctx, { tx }, c) => ({ items: await caseAssumptions(tx, c.id, c.display_key) }),
  }),

  [API.assumptions.create.id]: command(API.assumptions.create, {
    load: async (ctx, tx) => {
      const c = await findCase(tx, ctx.params.caseRef);
      if (!c) throw notFound();
      return c;
    },
    authorize: (ctx, c) => authorizeOnCase(ctx.identity, ctx.now, c, 'assumption.edit'),
    handle: async (ctx, t, c) => {
      const { tx } = t;
      const b = ctx.body;
      await assertHuman(tx, b.ownerId, 'body.ownerId');
      if (b.value === null && !b.valueText?.trim())
        throw new ApiError('VALIDATION_FAILED', 'Give a value or describe it in words.', {
          errors: [{ path: 'body.value', code: 'required', message: 'Value or value text required' }],
        });
      checkValue(b.value, b.unit);
      const dup = await tx
        .selectFrom('platform.assumption')
        .select('display_key')
        .where('case_id', '=', c.id)
        .where('input_key', '=', b.inputKey)
        .executeTakeFirst();
      if (dup)
        throw new ApiError(
          'INVALID_TRANSITION',
          `${dup.display_key} already holds ${b.inputKey}; change its value instead.`,
        );
      const key = await allocateDisplayKey(tx, ctx.tenantId, 'ASM', async (k) =>
        Boolean(
          await tx
            .selectFrom('platform.assumption')
            .select('id')
            .where('display_key', '=', k)
            .executeTakeFirst(),
        ),
      );
      const scenario = /^adoption_rate\.(downside|base|upside)$/.exec(b.inputKey)?.[1] ?? null;
      const money = MONEY_UNITS.has(b.unit) ? await priceBasis(tx, c, ctx.now) : null;
      const a = await tx
        .insertInto('platform.assumption')
        .values({
          tenant_id: ctx.tenantId,
          case_id: c.id,
          display_key: key,
          input_key: b.inputKey,
          name: b.name,
          scenario,
          owner_user_id: b.ownerId,
          sensitivity: b.sensitivity,
          decision_critical: b.decisionCritical,
          consequence_if_false: b.consequenceIfFalse,
          validation_method: b.validationMethod,
          due_on: b.dueOn,
          created_by: ctx.userId,
          created_at: ctx.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const v = await tx
        .insertInto('platform.assumption_version')
        .values({
          tenant_id: ctx.tenantId,
          assumption_id: a.id,
          version: 1,
          value: b.value,
          value_text: b.value === null ? b.valueText : null,
          unit: b.unit,
          currency: money?.currency ?? null,
          price_year: money?.priceYear ?? null,
          basis: b.basis,
          evidence_quality: 'none',
          origin: 'human',
          created_by: ctx.userId,
          created_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .updateTable('platform.assumption')
        .set({ current_version_id: v.id })
        .where('id', '=', a.id)
        .execute();
      await t.audit({
        action: 'assumption.created',
        objectType: 'assumption',
        objectId: a.id,
        objectVersion: 1,
        caseId: c.id,
        summary: `${key} added: ${b.name}`.slice(0, 280),
        details: { decisionCritical: b.decisionCritical, sensitivity: b.sensitivity },
      });
      await t.analytics(
        'assumption_changed',
        { objectType: 'assumption', objectId: a.id, objectVersion: 1, caseId: c.id, stage: c.stage as never },
        { decisionCritical: b.decisionCritical, origin: 'human' },
      );
      await t.emit({
        type: 'assumption.version_created',
        ...eventBase(ctx, c.id),
        assumptionId: a.id,
        versionId: v.id,
        decisionCritical: b.decisionCritical,
      });
      const out = await one(tx, a as AssumptionRow, c);
      ctx.setETag(out.rowVersion);
      return out;
    },
  }),

  [API.assumptions.update.id]: command(API.assumptions.update, {
    load: (ctx, tx) => loadAssumption(tx, ctx.params.id),
    authorize: (ctx, { a, c }) => {
      const d = authorizeOnCase(ctx.identity, ctx.now, c, 'assumption.edit');
      if (d.allow || d.code === 'NOT_FOUND') return d;
      // The named owner of an assumption may change it.
      return ctx.userId === a.owner_user_id ? allowSelf(ctx.identity, c, a.owner_user_id, d.reason) : d;
    },
    handle: async (ctx, t, { a, c }) => {
      const { tx } = t;
      assertIfMatch(ctx, a.row_version);
      const b = ctx.body;
      if (a.status === 'retired')
        throw new ApiError('INVALID_TRANSITION', 'A retired assumption cannot change.');
      if (b.ownerId) await assertHuman(tx, b.ownerId, 'body.ownerId');
      const cur = (await tx
        .selectFrom('platform.assumption_version')
        .selectAll()
        .where('id', '=', a.current_version_id!)
        .executeTakeFirstOrThrow()) as VersionRow;
      checkValue(b.value, cur.unit);
      const norm = (v: string | null) => (v === null ? null : trimDecimal(v));
      const valueChanged = b.value !== undefined && norm(b.value) !== norm(cur.value);
      const textChanged = b.valueText !== undefined && b.valueText !== cur.value_text;
      const basisChanged = b.basis !== undefined && b.basis !== cur.basis;
      let staleSnapshotIds: string[] = [];
      let invalidatedApprovalIds: string[] = [];
      let newVersion: number | null = null;
      if (valueChanged || textChanged || basisChanged) {
        const value = b.value !== undefined ? b.value : cur.value;
        const valueText = b.valueText !== undefined ? b.valueText : value === null ? cur.value_text : null;
        if (value === null && !valueText?.trim())
          throw new ApiError('VALIDATION_FAILED', 'Give a value or describe it in words.');
        newVersion = cur.version + 1;
        const v = await tx
          .insertInto('platform.assumption_version')
          .values({
            tenant_id: ctx.tenantId,
            assumption_id: a.id,
            version: newVersion,
            value,
            value_text: value === null ? valueText : null,
            unit: cur.unit,
            currency: cur.currency,
            price_year: cur.price_year,
            basis: b.basis ?? cur.basis,
            evidence_quality: cur.evidence_quality,
            origin: 'human',
            change_reason: b.changeReason,
            created_by: ctx.userId,
            created_at: ctx.now,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await tx
          .updateTable('platform.assumption')
          .set({ current_version_id: v.id })
          .where('id', '=', a.id)
          .execute();
        await t.audit({
          action: 'assumption.version_created',
          objectType: 'assumption',
          objectId: a.id,
          objectVersion: newVersion,
          caseId: c.id,
          summary: `${a.display_key} v${newVersion}: ${assumptionLabel(a.input_key, a.display_key)} changed`,
          before: { version: cur.version, value: cur.value, valueText: cur.value_text },
          after: { version: newVersion, value, valueText },
          details: { decisionCritical: a.decision_critical, fromVersion: cur.version, toVersion: newVersion },
        });
        await t.analytics(
          'assumption_changed',
          {
            objectType: 'assumption',
            objectId: a.id,
            objectVersion: newVersion,
            caseId: c.id,
            stage: c.stage as never,
          },
          { decisionCritical: a.decision_critical, origin: 'human' },
        );
        await t.emit({
          type: 'assumption.version_created',
          ...eventBase(ctx, c.id),
          assumptionId: a.id,
          versionId: v.id,
          decisionCritical: a.decision_critical,
        });
        const applied = await applyMateriality(
          t,
          {
            changeType: 'decision_critical_assumption_changed',
            objectType: 'assumption_version',
            objectId: cur.id,
            componentType: 'assumption_version',
            fromVersion: cur.version,
            toVersion: newVersion,
            decisionCritical: a.decision_critical,
            label: assumptionLabel(a.input_key, a.display_key),
          },
          { now: ctx.now, actorUserId: ctx.userId },
        );
        staleSnapshotIds = applied.flatMap((r) => r.outcome.staleSnapshotIds);
        invalidatedApprovalIds = applied.flatMap((r) => r.outcome.invalidateApprovalIds);
      }
      const meta: Record<string, unknown> = {};
      if (b.sensitivity !== undefined) meta.sensitivity = b.sensitivity;
      if (b.validationMethod !== undefined) meta.validation_method = b.validationMethod;
      if (b.dueOn !== undefined) meta.due_on = b.dueOn;
      if (b.ownerId !== undefined) meta.owner_user_id = b.ownerId;
      if (Object.keys(meta).length > 0) {
        await tx.updateTable('platform.assumption').set(meta).where('id', '=', a.id).execute();
        await t.audit({
          action: 'assumption.updated',
          objectType: 'assumption',
          objectId: a.id,
          caseId: c.id,
          summary: `${a.display_key} details updated: ${Object.keys(meta).join(', ')}`,
        });
      }
      if (newVersion === null && Object.keys(meta).length === 0)
        throw new ApiError('VALIDATION_FAILED', 'Nothing to change.');
      const out = await one(tx, a, c);
      ctx.setETag(out.rowVersion);
      return { assumption: out, staleSnapshotIds, invalidatedApprovalIds };
    },
  }),

  [API.assumptions.versions.id]: query(API.assumptions.versions, {
    load: (ctx, tx) => loadAssumption(tx, ctx.params.id),
    authorize: (ctx, { c }) => readDecision(ctx.identity, c),
    handle: async (_ctx, { tx }, { a }) => {
      const rows = (await tx
        .selectFrom('platform.assumption_version')
        .selectAll()
        .where('assumption_id', '=', a.id)
        .orderBy('version')
        .execute()) as VersionRow[];
      const people = await peopleMap(
        tx,
        rows.map((r) => r.created_by),
      );
      return { items: rows.map((r) => toVersion(r, people)) };
    },
  }),

  [API.assumptions.retire.id]: command(API.assumptions.retire, {
    load: (ctx, tx) => loadAssumption(tx, ctx.params.id),
    authorize: (ctx, { c }) => authorizeOnCase(ctx.identity, ctx.now, c, 'assumption.edit'),
    handle: async (ctx, t, { a, c }) => {
      if (a.status === 'retired') throw new ApiError('INVALID_TRANSITION', 'Already retired.');
      await t.tx
        .updateTable('platform.assumption')
        .set({ status: 'retired', retired_reason: ctx.body.rationale })
        .where('id', '=', a.id)
        .execute();
      await t.audit({
        action: 'assumption.retired',
        objectType: 'assumption',
        objectId: a.id,
        caseId: c.id,
        summary: `${a.display_key} retired`,
        before: { status: a.status },
        after: { status: 'retired' },
      });
      return one(t.tx, a, c);
    },
  }),

  [API.assumptions.dispute.id]: command(API.assumptions.dispute, {
    load: (ctx, tx) => loadAssumption(tx, ctx.params.id),
    authorize: (ctx, { c }) => authorizeOnCase(ctx.identity, ctx.now, c, 'assumption.dispute'),
    handle: async (ctx, t, { a, c }) => {
      const ch = await t.tx
        .insertInto('platform.challenge')
        .values({
          tenant_id: ctx.tenantId,
          kind: 'dispute',
          target_type: 'assumption',
          target_id: a.id,
          case_id: c.id,
          raised_by: ctx.userId,
          statement: ctx.body.statement,
          proposed_value: ctx.body.proposedValueText,
          created_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'assumption.disputed',
        objectType: 'assumption',
        objectId: a.id,
        caseId: c.id,
        summary: `${a.display_key} disputed by a reviewer (stays open until resolved with a reason)`,
        details: { challengeId: ch.id },
      });
      return (await challengesWhere(t.tx, { ids: [ch.id] }))[0]!;
    },
  }),

  [API.assumptions.replyToChallenge.id]: command(API.assumptions.replyToChallenge, {
    load: (ctx, tx) => loadChallenge(tx, ctx.params.id),
    authorize: (ctx, { ch, c }) => {
      if (!canRead(ctx.identity, c))
        return { allow: false, rule: 'case.read', code: 'NOT_FOUND', reason: 'Not found' };
      if (ctx.userId === ch.raised_by || ctx.userId === c.owner_user_id || ctx.userId === c.sponsor_user_id)
        return allowSelf(ctx.identity, c, ctx.userId, '');
      return authorizeAny(ctx.identity, ctx.now, c, ['assumption.dispute', 'challenge.resolve', 'case.edit']);
    },
    handle: async (ctx, t, { ch, c }) => {
      if (ch.status !== 'open') throw new ApiError('INVALID_TRANSITION', 'This thread is resolved.');
      await t.tx
        .insertInto('platform.challenge_reply')
        .values({
          tenant_id: ctx.tenantId,
          challenge_id: ch.id,
          author_id: ctx.userId,
          body: ctx.body.body,
          created_at: ctx.now,
        })
        .execute();
      await t.audit({
        action: 'challenge.replied',
        objectType: 'challenge',
        objectId: ch.id,
        caseId: c.id,
        summary: `Reply added to a ${ch.kind} thread`,
      });
      return (await challengesWhere(t.tx, { ids: [ch.id] }))[0]!;
    },
  }),

  [API.assumptions.resolveChallenge.id]: command(API.assumptions.resolveChallenge, {
    load: (ctx, tx) => loadChallenge(tx, ctx.params.id),
    authorize: (ctx, { ch, c }) => canResolve(ctx.identity, ctx.now, c, ch.raised_by, ch.kind),
    handle: async (ctx, t, { ch, c }) => {
      if (ch.status !== 'open') throw new ApiError('INVALID_TRANSITION', 'Already resolved.');
      await t.tx
        .updateTable('platform.challenge')
        .set({
          status: 'resolved',
          resolution: ctx.body.resolution,
          resolved_by: ctx.userId,
          resolved_at: ctx.now,
        })
        .where('id', '=', ch.id)
        .execute();
      if (ch.target_type === 'claim') {
        const open = await t.tx
          .selectFrom('platform.challenge')
          .select('id')
          .where('target_id', '=', ch.target_id)
          .where('status', '=', 'open')
          .execute();
        if (open.length === 0)
          await t.tx
            .updateTable('platform.claim')
            .set({ status: 'accepted' })
            .where('id', '=', ch.target_id)
            .where('status', '=', 'challenged')
            .execute();
      }
      await t.audit({
        action: 'challenge.resolved',
        objectType: 'challenge',
        objectId: ch.id,
        caseId: c.id,
        summary: `${ch.kind === 'dispute' ? 'Dispute' : 'Challenge'} resolved with a reason`,
        before: { status: 'open' },
        after: { status: 'resolved' },
      });
      return (await challengesWhere(t.tx, { ids: [ch.id] }))[0]!;
    },
  }),
};
