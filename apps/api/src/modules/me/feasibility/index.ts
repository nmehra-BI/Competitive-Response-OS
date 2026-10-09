/**
 * Feasibility (S07, ME-06). A readiness table with named reviewers and no readiness score. Sign-offs
 * are human-only (the database refuses agents too), recorded only by the named reviewer, and carry a
 * structured scope (`coversGate`, `maxSites`, `maxDays`): Lena's "pilot only: up to 4 sites, 90 days"
 * covers G2 and never G3 (D-045). A changed scope runs materiality (`specialist_scope_changed`).
 */
import {
  API,
  type FeasibilityAssessment,
  type FeasibilityBlocker,
  type FeasibilityDimension,
  type FeasibilityView,
  type GateCode,
  type ReviewArea,
  type ReviewerPosition,
} from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { ApiError, notFound } from '../../../platform/errors';
import { applyMateriality } from '../../../platform/materiality';
import { command, query, type HandlerMap } from '../../../platform/pipeline';
import { isoDateOrNull, isoDateTime } from '../../../platform/serialize';
import {
  allowSelf,
  authorizeOnCase,
  caseById,
  findCase,
  peopleMap,
  readDecision,
  readableCase,
  who,
} from '../cases/access';
import { chipsFor, sourceChips } from '../cases/sources';
import type { Identity } from '../../../platform/context';

const AREA: Record<FeasibilityDimension, ReviewArea> = {
  product_fit: 'product',
  differentiation: 'product',
  commercial_access: 'commercial',
  operations: 'operations',
  specialist_review: 'specialist',
  channel: 'commercial',
  competition: 'commercial',
};
const SIGNED = new Set(['supports', 'supports_with_conditions', 'accepts_ownership']);

export async function feasibilityView(tx: Tx, identity: Identity, caseId: string): Promise<FeasibilityView> {
  const rows = await tx
    .selectFrom('me.feasibility_assessment')
    .selectAll()
    .where('case_id', '=', caseId)
    .execute();
  const ids = rows.map((r) => r.id);
  const reviews = ids.length
    ? await tx.selectFrom('me.feasibility_review').selectAll().where('assessment_id', 'in', ids).execute()
    : [];
  const blockers = await tx
    .selectFrom('me.blocker')
    .selectAll()
    .where('case_id', '=', caseId)
    .orderBy('created_at')
    .execute();
  const dis = ids.length
    ? await tx
        .selectFrom('me.feasibility_disagreement')
        .selectAll()
        .where('assessment_id', 'in', ids)
        .orderBy('created_at')
        .execute()
    : [];
  const comps = await tx
    .selectFrom('me.competitor_entry')
    .selectAll()
    .where('case_id', '=', caseId)
    .execute();
  const people = await peopleMap(tx, [
    ...rows.map((r) => r.reviewer_user_id),
    ...reviews.map((r) => r.signed_by),
    ...blockers.map((b) => b.resolved_by),
    ...dis.map((d) => d.author_id),
  ]);
  const chips = await sourceChips(
    tx,
    identity,
    comps.map((c) => c.source_id),
  );
  const order = Object.keys(AREA);
  const toBlocker = (b: (typeof blockers)[number]): FeasibilityBlocker => ({
    id: b.id,
    assessmentId: b.assessment_id,
    text: b.text,
    blocksGate: b.blocks_gate as GateCode,
    status: b.status as FeasibilityBlocker['status'],
    resolution: b.resolution,
    resolvedBy: b.resolved_by ? who(people, b.resolved_by) : null,
    scopeRestrictionGateRequestId: b.scope_restriction_gate_request_id,
  });
  const out = rows
    .sort((a, b) => order.indexOf(a.dimension) - order.indexOf(b.dimension))
    .map((r): FeasibilityAssessment => {
      const cur = reviews.find((x) => x.id === r.current_review_id);
      return {
        id: r.id,
        caseId: r.case_id,
        dimension: r.dimension as FeasibilityDimension,
        question: r.question,
        evidenceText: r.evidence_text,
        reviewer: who(people, r.reviewer_user_id),
        status: r.status as FeasibilityAssessment['status'],
        scopeText: r.scope_text,
        dueOn: isoDateOrNull(r.due_on),
        humanOnly: r.human_only,
        currentReview: cur
          ? {
              id: cur.id,
              assessmentId: cur.assessment_id,
              version: cur.version,
              position: cur.position as ReviewerPosition,
              scope: {
                text: cur.scope_text,
                coversGate: cur.covers_gate as GateCode | null,
                maxSites: cur.max_sites,
                maxDays: cur.max_days,
              },
              statement: cur.statement,
              evidenceSourceIds: cur.evidence_source_ids,
              signedBy: who(people, cur.signed_by),
              signedAt: isoDateTime(cur.signed_at),
            }
          : null,
        blockers: blockers.filter((b) => b.assessment_id === r.id).map(toBlocker),
        disagreements: dis
          .filter((d) => d.assessment_id === r.id)
          .map((d) => ({
            id: d.id,
            author: who(people, d.author_id),
            statement: d.statement,
            createdAt: isoDateTime(d.created_at),
          })),
      };
    });
  return {
    rows: out,
    counts: {
      signed: rows.filter((r) => r.status === 'signed').length,
      inReview: rows.filter((r) => r.status === 'in_review').length,
      pending: rows.filter((r) => r.status === 'pending').length,
      blockers: blockers.filter((b) => b.status === 'open').length,
    },
    competitors: comps.map((c) => ({
      id: c.id,
      text: c.text,
      source: c.source_id ? (chipsFor(chips, [c.source_id])[0] ?? null) : null,
      unknown: c.unknown,
    })),
  };
}

async function loadAssessment(tx: Tx, ref: string, dimension: string) {
  const c = await findCase(tx, ref);
  if (!c) throw notFound();
  const a = await tx
    .selectFrom('me.feasibility_assessment')
    .selectAll()
    .where('case_id', '=', c.id)
    .where('dimension', '=', dimension)
    .executeTakeFirst();
  return { c, a };
}

export const feasibilityHandlers: HandlerMap = {
  [API.feasibility.get.id]: query(API.feasibility.get, {
    load: (ctx, tx) => readableCase(tx, ctx.identity, ctx.params.caseRef),
    authorize: (ctx, c) => readDecision(ctx.identity, c),
    handle: (ctx, { tx }, c) => feasibilityView(tx, ctx.identity, c.id),
  }),

  [API.feasibility.sign.id]: command(API.feasibility.sign, {
    load: (ctx, tx) => loadAssessment(tx, ctx.params.caseRef, ctx.params.dimension),
    authorize: (ctx, { c, a }) => {
      const d = authorizeOnCase(ctx.identity, ctx.now, c, 'review.sign', {
        namedReviewerId: a?.reviewer_user_id,
      });
      if (d.allow || d.code === 'NOT_FOUND') return d;
      return a && ctx.userId === a.reviewer_user_id
        ? allowSelf(ctx.identity, c, a.reviewer_user_id, d.reason)
        : d;
    },
    handle: async (ctx, t, { c, a }) => {
      const { tx } = t;
      if (!a)
        throw new ApiError(
          'INVALID_TRANSITION',
          'Name a reviewer for this dimension first (request a review).',
        );
      const b = ctx.body;
      if (b.position === 'not_yet_reviewed')
        throw new ApiError('VALIDATION_FAILED', 'Record a position to sign.');
      const prev = a.current_review_id
        ? await tx
            .selectFrom('me.feasibility_review')
            .select('version')
            .where('id', '=', a.current_review_id)
            .executeTakeFirst()
        : undefined;
      const review = await tx
        .insertInto('me.feasibility_review')
        .values({
          tenant_id: ctx.tenantId,
          assessment_id: a.id,
          version: (prev?.version ?? 0) + 1,
          position: b.position,
          scope_text: b.scopeText,
          covers_gate: b.coversGate,
          max_sites: b.maxSites,
          max_days: b.maxDays,
          statement: b.statement,
          evidence_source_ids: b.evidenceSourceIds,
          signed_by: ctx.userId,
          signed_at: ctx.now,
        })
        .returning(['id', 'version'])
        .executeTakeFirstOrThrow();
      const status = SIGNED.has(b.position) ? 'signed' : b.position === 'dissents' ? 'declined' : 'in_review';
      await tx
        .updateTable('me.feasibility_assessment')
        .set({ status, scope_text: b.scopeText, current_review_id: review.id })
        .where('id', '=', a.id)
        .execute();
      // A supporting sign-off that covers the blocked gate resolves the dimension's blocker with its scope.
      if (SIGNED.has(b.position) && b.coversGate)
        await tx
          .updateTable('me.blocker')
          .set({ status: 'resolved', resolution: b.scopeText, resolved_by: ctx.userId, resolved_at: ctx.now })
          .where('assessment_id', '=', a.id)
          .where('status', '=', 'open')
          .where('blocks_gate', '=', b.coversGate)
          .execute();
      await t.audit({
        action: 'feasibility.review_signed',
        objectType: 'feasibility_review',
        objectId: review.id,
        objectVersion: review.version,
        caseId: c.id,
        summary:
          `${a.dimension.replace(/_/g, ' ')} review v${review.version}: ${b.position} · ${b.scopeText}`.slice(
            0,
            280,
          ),
        details: { coversGate: b.coversGate, maxSites: b.maxSites, maxDays: b.maxDays },
      });
      const area = AREA[a.dimension as FeasibilityDimension];
      await t.analytics(
        'feasibility_review_recorded',
        {
          objectType: 'feasibility_review',
          objectId: review.id,
          objectVersion: review.version,
          caseId: c.id,
          stage: c.stage as never,
        },
        { area, scoped: b.coversGate !== null || b.maxSites !== null || b.maxDays !== null },
      );
      // Snapshots pin the review version they read; every earlier version whose scope differs from
      // the new one is a material scope change for the snapshots pinning it.
      const earlier = await tx
        .selectFrom('me.feasibility_review')
        .selectAll()
        .where('assessment_id', '=', a.id)
        .where('id', '<>', review.id)
        .execute();
      for (const p of earlier) {
        const changed =
          p.scope_text !== b.scopeText ||
          p.covers_gate !== b.coversGate ||
          p.max_sites !== b.maxSites ||
          p.max_days !== b.maxDays ||
          p.position !== b.position;
        if (!changed) continue;
        await applyMateriality(
          t,
          {
            changeType: 'specialist_scope_changed',
            objectType: 'feasibility_review',
            objectId: p.id,
            componentType: 'feasibility_review',
            fromVersion: p.version,
            toVersion: review.version,
            label: `${a.dimension.replace(/_/g, ' ')} sign-off scope`,
          },
          { now: ctx.now, actorUserId: ctx.userId },
        );
      }
      return feasibilityView(tx, ctx.identity, c.id);
    },
  }),

  [API.feasibility.recordDisagreement.id]: command(API.feasibility.recordDisagreement, {
    load: (ctx, tx) => loadAssessment(tx, ctx.params.caseRef, ctx.params.dimension),
    authorize: (ctx, { c }) => authorizeOnCase(ctx.identity, ctx.now, c, 'gate.record_position'),
    handle: async (ctx, t, { c, a }) => {
      if (!a) throw notFound();
      const row = await t.tx
        .insertInto('me.feasibility_disagreement')
        .values({
          tenant_id: ctx.tenantId,
          assessment_id: a.id,
          author_id: ctx.userId,
          statement: ctx.body.statement,
          created_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'feasibility.disagreement_recorded',
        objectType: 'feasibility_assessment',
        objectId: a.id,
        caseId: c.id,
        summary: `Signed disagreement recorded on ${a.dimension.replace(/_/g, ' ')} (carried into G1/G2 packages)`,
        details: { disagreementId: row.id },
      });
      return feasibilityView(t.tx, ctx.identity, c.id);
    },
  }),

  [API.feasibility.resolveBlocker.id]: command(API.feasibility.resolveBlocker, {
    load: async (ctx, tx) => {
      const b = await tx
        .selectFrom('me.blocker')
        .selectAll()
        .where('id', '=', ctx.params.id)
        .executeTakeFirst();
      if (!b) throw notFound();
      return { b, c: await caseById(tx, b.case_id) };
    },
    authorize: (ctx, { b, c }) => {
      const d = authorizeOnCase(ctx.identity, ctx.now, c, 'case.edit');
      if (d.allow || d.code === 'NOT_FOUND') return d;
      return b.owner_user_id === ctx.userId ? allowSelf(ctx.identity, c, b.owner_user_id, d.reason) : d;
    },
    handle: async (ctx, t, { b, c }) => {
      if (b.status !== 'open') throw new ApiError('INVALID_TRANSITION', 'This blocker is already resolved.');
      const body = ctx.body;
      if (body.kind === 'scope_restricted') {
        const g = body.scopeRestrictionGateRequestId
          ? await t.tx
              .selectFrom('platform.gate_request')
              .select(['case_id', 'status'])
              .where('id', '=', body.scopeRestrictionGateRequestId)
              .executeTakeFirst()
          : undefined;
        if (!g || g.case_id !== c.id || !['approved', 'approved_with_conditions'].includes(g.status))
          throw new ApiError(
            'PRECONDITIONS_UNMET',
            'Restricting scope needs an approved gate that restricts it.',
            {
              blockers: [{ key: 'scope_restriction_gate', message: 'No approved gate restricts the scope.' }],
            },
          );
      }
      await t.tx
        .updateTable('me.blocker')
        .set({
          status: body.kind,
          resolution: body.resolution,
          resolved_by: ctx.userId,
          resolved_at: ctx.now,
          scope_restriction_gate_request_id:
            body.kind === 'scope_restricted' ? body.scopeRestrictionGateRequestId : null,
        })
        .where('id', '=', b.id)
        .execute();
      await t.audit({
        action: 'feasibility.blocker_resolved',
        objectType: 'blocker',
        objectId: b.id,
        caseId: c.id,
        summary: `Blocker ${body.kind === 'resolved' ? 'resolved' : 'resolved by restricting scope'} with a reason`,
        before: { status: 'open' },
        after: { status: body.kind },
      });
      return feasibilityView(t.tx, ctx.identity, c.id);
    },
  }),
};
