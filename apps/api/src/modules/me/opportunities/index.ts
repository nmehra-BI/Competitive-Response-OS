/**
 * Opportunities (S03, ME-03, WF-02). Triage goes through the opportunity machine: shortlist needs a
 * G0-approved mandate, dismiss/restore need a reason, merge keeps both records and links them, and
 * converting a shortlisted candidate creates an expansion case in Discovery (OPP-07 → ME-104).
 */
import { API, type CaseStage, type OpportunityStatus } from '@growth-os/contracts';
import { opportunityMachine, type LifecycleFacts } from '@growth-os/domain';
import { allocateDisplayKey, type Tx } from '@growth-os/db';
import { roleAllows } from '../../../platform/authz';
import type { Authorization, Identity } from '../../../platform/context';
import { ApiError, notFound } from '../../../platform/errors';
import { pageOf } from '../../../platform/pagination';
import { command, query, type HandlerMap, type Tools } from '../../../platform/pipeline';
import { isoDateTime } from '../../../platform/serialize';
import { assertHuman, type BaseCtx, machineRefusal, serializeCase, type CaseRecord } from '../cases/access';
import { findMandate, mandateVisible } from '../mandates';
import { findOpportunity, toOpportunities, toOpportunity, type OpportunityRow } from './read';
import { insertOpportunity } from './writers';

type Mandate = NonNullable<Awaited<ReturnType<typeof findMandate>>>;
interface Loaded {
  opp: OpportunityRow;
  mandate: Mandate;
}

async function load(tx: Tx, ref: string): Promise<Loaded> {
  const opp = await findOpportunity(tx, ref);
  if (!opp) throw notFound();
  const mandate = await findMandate(tx, opp.mandate_id);
  if (!mandate) throw notFound();
  return { opp, mandate };
}

function triage(
  identity: Identity,
  m: Mandate,
  action: 'opportunity.triage' | 'opportunity.convert',
): Authorization {
  const v = mandateVisible(identity, m.business_unit_id);
  if (!v.allow) return v;
  return roleAllows(identity.subject, action, { businessUnitId: m.business_unit_id, caseId: null });
}

async function transition(
  ctx: BaseCtx,
  t: Tools,
  { opp, mandate }: Loaded,
  command: 'shortlist' | 'dismiss' | 'restore',
  facts: LifecycleFacts,
  set: Partial<{ dismiss_reason: string | null }>,
): Promise<OpportunityRow> {
  const r = opportunityMachine.apply(opp.status as OpportunityStatus, command, ctx.identity.actor, {
    mandateApproved: mandate.status === 'approved',
    ...facts,
  });
  if (!r.ok) throw machineRefusal(r);
  const row = (await t.tx
    .updateTable('me.opportunity')
    .set({ status: r.to, ...set })
    .where('id', '=', opp.id)
    .where('status', '=', opp.status)
    .returningAll()
    .executeTakeFirstOrThrow()) as OpportunityRow;
  await t.audit({
    action: r.auditAction,
    objectType: 'opportunity',
    objectId: opp.id,
    summary: `${opp.display_key} ${opp.status} → ${r.to}`,
    before: { status: opp.status },
    after: { status: r.to },
    details: { from: opp.status, to: r.to },
  });
  await statusEvent(ctx, t, opp.id, opp.status, r.to);
  return row;
}

async function statusEvent(ctx: BaseCtx, t: Tools, id: string, from: string, to: string): Promise<void> {
  await t.emit({
    type: 'opportunity.status_changed',
    eventId: crypto.randomUUID(),
    tenantId: ctx.tenantId,
    caseId: null,
    actorId: ctx.userId,
    occurredAt: ctx.now.toISOString(),
    correlationId: ctx.correlationId,
    opportunityId: id,
    from,
    to,
  });
}

/**
 * Partial discovery: a connection used for discovery is not connected. The list never reads analysis
 * runs (D-074: no module depends on runs, so the list behaves the same with analysis off); the run's
 * own status and detail are on the analysis panel (`analysis.latestForCase`).
 */
async function discoveryHealth(tx: Tx) {
  const conns = await tx
    .selectFrom('platform.connection')
    .select(['id', 'name', 'status', 'used_for', 'last_success_at', 'last_checked_at'])
    .execute();
  const down = conns.filter((c) => /discovery/i.test(c.used_for ?? '') && c.status !== 'connected');
  return {
    discoveryPartial: down.length > 0,
    unavailableSources: down.map((c) => ({
      connectionId: c.id,
      name: c.name,
      since: isoDateTime(c.last_success_at ?? c.last_checked_at ?? new Date(0)),
    })),
  };
}

export async function createCaseRow(
  tx: Tx,
  input: {
    tenantId: string;
    userId: string;
    now: Date;
    title: string;
    businessUnitId: string;
    ownerId: string;
    sponsorId: string;
    stage: CaseStage;
    originType: 'opportunity' | 'direct';
    originId: string | null;
    mandateId: string;
  },
): Promise<CaseRecord> {
  const key = await allocateDisplayKey(tx, input.tenantId, 'ME', async (k) =>
    Boolean(
      await tx
        .selectFrom('platform.workflow_case')
        .select('id')
        .where('display_key', '=', k)
        .executeTakeFirst(),
    ),
  );
  return (await tx
    .insertInto('platform.workflow_case')
    .values({
      tenant_id: input.tenantId,
      app_type: 'market_expansion',
      display_key: key,
      title: input.title,
      business_unit_id: input.businessUnitId,
      owner_user_id: input.ownerId,
      sponsor_user_id: input.sponsorId,
      stage: input.stage,
      origin_type: input.originType,
      origin_id: input.originId,
      mandate_id: input.mandateId,
      created_by: input.userId,
      created_at: input.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow()) as CaseRecord;
}

export const opportunityHandlers: HandlerMap = {
  [API.opportunities.list.id]: query(API.opportunities.list, {
    load: async (ctx, tx) => {
      const m = await findMandate(tx, ctx.query.mandateId);
      if (!m) throw notFound();
      return m;
    },
    authorize: (ctx, m) => mandateVisible(ctx.identity, m.business_unit_id),
    handle: async (ctx, { tx }, m) => {
      let q = tx.selectFrom('me.opportunity').selectAll().where('mandate_id', '=', m.id);
      const f = ctx.query;
      if (f.status) q = q.where('status', '=', f.status);
      if (f.productId) q = q.where('product_id', '=', f.productId);
      if (f.segmentId) q = q.where('segment_id', '=', f.segmentId);
      if (f.countryCode) q = q.where('country_code', '=', f.countryCode);
      const rows = (await q.orderBy('display_key').execute()) as OpportunityRow[];
      const page = pageOf(rows, {
        limit: f.limit,
        cursor: f.cursor,
        tenantId: ctx.tenantId,
        op: API.opportunities.list.id,
        now: ctx.now,
        keyOf: (r) => ({ key: r.display_key, id: r.id }),
      });
      const filters = [
        `Mandate ${m.display_key}`,
        f.status ? `status ${f.status}` : 'all statuses',
        ...(f.countryCode ? [`country ${f.countryCode}`] : []),
      ];
      return {
        items: await toOpportunities(tx, ctx.identity, page.items),
        nextCursor: page.nextCursor,
        ...(await discoveryHealth(tx)),
        filtersText: filters.join(' · '),
      };
    },
  }),

  [API.opportunities.get.id]: query(API.opportunities.get, {
    load: (ctx, tx) => load(tx, ctx.params.ref),
    authorize: (ctx, l) => mandateVisible(ctx.identity, l.mandate.business_unit_id),
    handle: (ctx, { tx }, l) => toOpportunity(tx, ctx.identity, l.opp),
  }),

  [API.opportunities.createManual.id]: command(API.opportunities.createManual, {
    load: async (ctx, tx) => {
      const m = await findMandate(tx, ctx.body.mandateId);
      if (!m) throw notFound();
      return m;
    },
    authorize: (ctx, m) => triage(ctx.identity, m, 'opportunity.triage'),
    handle: async (ctx, t, m) => {
      const row = await insertOpportunity(
        t.tx,
        { tenantId: ctx.tenantId, actorUserId: ctx.userId, now: ctx.now },
        {
          mandateId: m.id,
          name: ctx.body.name,
          trigger: ctx.body.trigger,
          fitRationale: ctx.body.fitRationale,
          origin: 'manual',
          agentRunId: null,
        },
      );
      await t.audit({
        action: 'opportunity.created',
        objectType: 'opportunity',
        objectId: row.id,
        summary: `${row.display_key} added manually to ${m.display_key}`,
      });
      return toOpportunity(t.tx, ctx.identity, row);
    },
  }),

  [API.opportunities.shortlist.id]: command(API.opportunities.shortlist, {
    load: (ctx, tx) => load(tx, ctx.params.ref),
    authorize: (ctx, l) => triage(ctx.identity, l.mandate, 'opportunity.triage'),
    handle: async (ctx, t, l) => {
      const row = await transition(ctx, t, l, 'shortlist', {}, {});
      await t.analytics(
        'opportunity_shortlisted',
        { objectType: 'opportunity', objectId: row.id },
        {
          origin: row.origin as 'ai',
        },
      );
      return toOpportunity(t.tx, ctx.identity, row);
    },
  }),

  [API.opportunities.dismiss.id]: command(API.opportunities.dismiss, {
    load: (ctx, tx) => load(tx, ctx.params.ref),
    authorize: (ctx, l) => triage(ctx.identity, l.mandate, 'opportunity.triage'),
    handle: async (ctx, t, l) =>
      toOpportunity(
        t.tx,
        ctx.identity,
        await transition(
          ctx,
          t,
          l,
          'dismiss',
          { rationale: ctx.body.reason },
          { dismiss_reason: ctx.body.reason },
        ),
      ),
  }),

  [API.opportunities.restore.id]: command(API.opportunities.restore, {
    load: (ctx, tx) => load(tx, ctx.params.ref),
    authorize: (ctx, l) => triage(ctx.identity, l.mandate, 'opportunity.triage'),
    handle: async (ctx, t, l) =>
      toOpportunity(
        t.tx,
        ctx.identity,
        await transition(ctx, t, l, 'restore', { rationale: ctx.body.reason }, { dismiss_reason: null }),
      ),
  }),

  [API.opportunities.merge.id]: command(API.opportunities.merge, {
    load: async (ctx, tx) => {
      const l = await load(tx, ctx.params.ref);
      const target = await findOpportunity(tx, ctx.body.targetOpportunityId);
      if (!target) throw notFound();
      return { ...l, target };
    },
    authorize: (ctx, l) => triage(ctx.identity, l.mandate, 'opportunity.triage'),
    handle: async (ctx, t, { opp, target }) => {
      if (target.id === opp.id)
        throw new ApiError('VALIDATION_FAILED', 'Choose a different candidate to merge into.');
      const r = opportunityMachine.apply(opp.status as OpportunityStatus, 'merge', ctx.identity.actor, {
        mergeTarget: {
          sameMandate: target.mandate_id === opp.mandate_id,
          status: target.status as OpportunityStatus,
        },
      });
      if (!r.ok) throw machineRefusal(r);
      const merged = (await t.tx
        .updateTable('me.opportunity')
        .set({ status: 'duplicate', duplicate_of_id: target.id })
        .where('id', '=', opp.id)
        .returningAll()
        .executeTakeFirstOrThrow()) as OpportunityRow;
      await t.audit({
        action: r.auditAction,
        objectType: 'opportunity',
        objectId: opp.id,
        summary: `${opp.display_key} merged into ${target.display_key} (both kept and linked)`,
        before: { status: opp.status },
        after: { status: 'duplicate', duplicateOf: target.id },
      });
      await statusEvent(ctx, t, opp.id, opp.status, 'duplicate');
      const [m, tg] = await toOpportunities(t.tx, ctx.identity, [merged, target]);
      return { merged: m!, target: tg! };
    },
  }),

  [API.opportunities.convert.id]: command(API.opportunities.convert, {
    load: (ctx, tx) => load(tx, ctx.params.ref),
    authorize: (ctx, l) => triage(ctx.identity, l.mandate, 'opportunity.convert'),
    handle: async (ctx, t, { opp, mandate }) => {
      const { tx } = t;
      await assertHuman(tx, ctx.body.ownerId, 'body.ownerId');
      const r = opportunityMachine.apply(opp.status as OpportunityStatus, 'convert', ctx.identity.actor, {
        mandateApproved: mandate.status === 'approved',
        newCaseOwnerId: ctx.body.ownerId,
      });
      if (!r.ok) throw machineRefusal(r);
      const ver = await tx
        .selectFrom('me.mandate_version')
        .select(['sponsor_user_id', 'product_id'])
        .where('id', '=', mandate.current_version_id!)
        .executeTakeFirstOrThrow();
      const product = ver.product_id
        ? await tx
            .selectFrom('platform.product')
            .select('name')
            .where('id', '=', ver.product_id)
            .executeTakeFirst()
        : undefined;
      const c = await createCaseRow(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        now: ctx.now,
        title: `${opp.name} — ${(product?.name ?? 'expansion').toLowerCase()}`,
        businessUnitId: mandate.business_unit_id,
        ownerId: ctx.body.ownerId,
        sponsorId: ver.sponsor_user_id!,
        stage: 'discovery',
        originType: 'opportunity',
        originId: opp.id,
        mandateId: mandate.id,
      });
      // The case starts at Discovery: G0 is already approved on the mandate.
      const row = (await tx
        .updateTable('me.opportunity')
        .set({ status: 'converted', converted_case_id: c.id })
        .where('id', '=', opp.id)
        .returningAll()
        .executeTakeFirstOrThrow()) as OpportunityRow;
      await t.audit({
        action: 'case.created',
        objectType: 'case',
        objectId: c.id,
        objectVersion: c.row_version,
        caseId: c.id,
        summary: `${c.display_key} created from ${opp.display_key} at stage Discovery`,
        details: { originType: 'opportunity', stage: 'discovery' },
      });
      await t.audit({
        action: r.auditAction,
        objectType: 'opportunity',
        objectId: opp.id,
        caseId: c.id,
        summary: `${opp.display_key} converted to ${c.display_key}`,
        before: { status: opp.status },
        after: { status: 'converted' },
      });
      await t.emit({
        type: 'case.created',
        eventId: crypto.randomUUID(),
        tenantId: ctx.tenantId,
        caseId: c.id,
        actorId: ctx.userId,
        occurredAt: ctx.now.toISOString(),
        correlationId: ctx.correlationId,
        originType: 'opportunity',
      });
      return { opportunity: await toOpportunity(tx, ctx.identity, row), case: await serializeCase(tx, c) };
    },
  }),
};
