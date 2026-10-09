/**
 * Case envelope (S01, S05, S12, S13): list, direct creation, header, owner/sponsor transitions through
 * the case machine, members (D-037), activity, history and review requests.
 */
import {
  API,
  type ActivityItem,
  type CaseMember,
  type CaseStage,
  type ReviewRequest,
  type RoleCode,
} from '@growth-os/contracts';
import { caseMachine, type CaseStageCommand, type LifecycleFacts } from '@growth-os/domain';
import type { Tx } from '@growth-os/db';
import { roleAllows } from '../../../platform/authz';
import { readAudit } from '../../../platform/audit-read';
import type { Identity } from '../../../platform/context';
import { ApiError, notFound } from '../../../platform/errors';
import { decodeCursor, encodeCursor, pageOf } from '../../../platform/pagination';
import { command, query, type HandlerMap } from '../../../platform/pipeline';
import { isoDateOrNull, isoDateTimeOrNull } from '../../../platform/serialize';
import { insertMandate } from '../mandates';
import { createCaseRow } from '../opportunities';
import {
  assertHuman,
  authorizeAny,
  authorizeOnCase,
  canRead,
  caseResource,
  eventBase,
  findCase,
  machineRefusal,
  peopleMap,
  policy,
  readDecision,
  readableCase,
  serializeCase,
  subjectAt,
  who,
  type CaseRecord,
} from './access';
import { buildHeader, buildListRow } from './read';


const KEY_ACTIONS = /gate|case\.(stage_changed|stop|hold|resume|close|created)|decision|seed\.(gate|case_converted)|caseMachine|case\.(start_assessment)/;

async function allCases(tx: Tx): Promise<CaseRecord[]> {
  return (await tx
    .selectFrom('platform.workflow_case')
    .selectAll()
    .where('app_type', '=', 'market_expansion')
    .orderBy('display_key')
    .execute()) as CaseRecord[];
}

/** Cases the viewer can read, and whether some business units are outside their access. */
export async function accessibleCases(tx: Tx, identity: Identity) {
  const cases = (await allCases(tx)).filter((c) => canRead(identity, c));
  const bus = await tx.selectFrom('platform.business_unit').select(['id', 'name']).orderBy('name').execute();
  const access = bus.map((b) => ({
    ...b,
    accessible: roleAllows(identity.subject, 'case.read', { businessUnitId: b.id, caseId: null }).allow,
  }));
  const shown = access.filter((b) => b.accessible).map((b) => b.name);
  return {
    cases,
    businessUnits: access,
    scope: {
      label: `Showing ${shown.join(', ') || 'no business unit'} · cases you can access · hidden cases are not counted`,
      partial: access.some((b) => !b.accessible),
    },
  };
}

export function toReviewRequest(
  r: {
    id: string;
    case_id: string;
    area: string;
    target_type: string;
    target_id: string | null;
    question: string;
    what_to_check: string[];
    requested_by: string;
    reviewer_user_id: string;
    due_on: Date | string | null;
    status: string;
    response: string | null;
    response_reason: string | null;
    responded_at: Date | null;
  },
  caseKey: string,
  people: Map<string, ReturnType<typeof who>>,
): ReviewRequest {
  return {
    id: r.id,
    caseId: r.case_id,
    caseKey,
    area: r.area as ReviewRequest['area'],
    targetType: r.target_type,
    targetId: r.target_id,
    question: r.question,
    whatToCheck: r.what_to_check,
    requestedBy: who(people, r.requested_by),
    reviewer: who(people, r.reviewer_user_id),
    dueOn: isoDateOrNull(r.due_on),
    status: r.status as ReviewRequest['status'],
    response: r.response as ReviewRequest['response'],
    responseReason: r.response_reason,
    respondedAt: isoDateTimeOrNull(r.responded_at),
  };
}

const APPROVED = ['approved', 'approved_with_conditions'];
const STAGE_GATE: Partial<Record<CaseStage, 'G1' | 'G2' | 'G3'>> = {
  validation: 'G1',
  pilot_approved: 'G2',
  pilot_running: 'G2',
  review_due: 'G2',
  scaling: 'G3',
};

async function approvalsStillEffective(tx: Tx, c: CaseRecord): Promise<boolean> {
  const gate = c.held_from_stage ? STAGE_GATE[c.held_from_stage as CaseStage] : undefined;
  if (!gate) return true;
  const g = await tx
    .selectFrom('platform.gate_request')
    .select('status')
    .where('case_id', '=', c.id)
    .where('gate_code', '=', gate)
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  return Boolean(g && APPROVED.includes(g.status));
}

async function boundaryDefined(tx: Tx, c: CaseRecord): Promise<boolean> {
  const s = await tx.selectFrom('me.sizing_version').select('id').where('case_id', '=', c.id).executeTakeFirst();
  if (s) return true;
  if (c.origin_type === 'opportunity' && c.origin_id) {
    const o = await tx.selectFrom('me.opportunity').select('market_boundary_id').where('id', '=', c.origin_id).executeTakeFirst();
    return Boolean(o?.market_boundary_id);
  }
  return false;
}

export const caseHandlers: HandlerMap = {
  [API.overview.listCases.id]: query(API.overview.listCases, {
    authorize: () => ({ allow: true, rule: 'case.list', authorityGrantId: null }),
    handle: async (ctx, { tx }) => {
      const { cases, scope } = await accessibleCases(tx, ctx.identity);
      const f = ctx.query;
      const rows = cases.filter(
        (c) =>
          (!f.stage || c.stage === f.stage) &&
          (!f.businessUnitId || c.business_unit_id === f.businessUnitId) &&
          (!f.ownerId || c.owner_user_id === f.ownerId),
      );
      const page = pageOf(rows, {
        limit: f.limit,
        cursor: f.cursor,
        tenantId: ctx.tenantId,
        op: API.overview.listCases.id,
        now: ctx.now,
        keyOf: (c) => ({ key: c.display_key, id: c.id }),
      });
      return {
        items: await Promise.all(page.items.map((c) => buildListRow(tx, c, ctx.now))),
        nextCursor: page.nextCursor,
        scope,
      };
    },
  }),

  [API.cases.createDirect.id]: command(API.cases.createDirect, {
    load: async (ctx, tx) => {
      const bu = await tx.selectFrom('platform.business_unit').select('id').where('id', '=', ctx.body.businessUnitId).executeTakeFirst();
      if (!bu) throw notFound();
      return bu.id;
    },
    authorize: (ctx, bu) => roleAllows(ctx.identity.subject, 'mandate.edit', { businessUnitId: bu, caseId: null }),
    handle: async (ctx, t, bu) => {
      const { tx } = t;
      const fields = ctx.body.mandate;
      const ownerId = fields.ownerId ?? ctx.userId;
      let sponsorId = fields.sponsorId ?? null;
      if (!sponsorId) {
        const s = await tx
          .selectFrom('platform.role_assignment')
          .select('user_id')
          .where('role', '=', 'sponsor')
          .where('revoked_at', 'is', null)
          .where((eb) => eb.or([eb('business_unit_id', '=', bu), eb('business_unit_id', 'is', null)]))
          .orderBy('granted_at')
          .executeTakeFirst();
        sponsorId = s?.user_id ?? null;
      }
      if (!sponsorId)
        throw new ApiError('VALIDATION_FAILED', 'Name a sponsor.', {
          errors: [{ path: 'body.mandate.sponsorId', code: 'required', message: 'Name a sponsor.' }],
        });
      await assertHuman(tx, ownerId, 'body.mandate.ownerId');
      await assertHuman(tx, sponsorId, 'body.mandate.sponsorId');
      const m = await insertMandate(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        businessUnitId: bu,
        title: `Mandate · ${ctx.body.title}`,
        fields: { ...fields, ownerId, sponsorId },
        now: ctx.now,
      });
      const c = await createCaseRow(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        now: ctx.now,
        title: ctx.body.title,
        businessUnitId: bu,
        ownerId,
        sponsorId,
        stage: 'draft_mandate',
        originType: 'direct',
        originId: null,
        mandateId: m.id,
      });
      await t.audit({
        action: 'case.created',
        objectType: 'case',
        objectId: c.id,
        objectVersion: c.row_version,
        caseId: c.id,
        summary: `${c.display_key} created directly with draft mandate ${m.display_key}`,
        details: { originType: 'direct', stage: 'draft_mandate' },
      });
      await t.analytics('mandate_created', { objectType: 'mandate', objectId: m.id, caseId: c.id, stage: 'draft_mandate' }, {
        hasSponsor: true,
      });
      await t.emit({ type: 'case.created', ...eventBase(ctx, c.id), originType: 'direct' });
      return serializeCase(tx, c);
    },
  }),

  [API.cases.header.id]: query(API.cases.header, {
    load: (ctx, tx) => readableCase(tx, ctx.identity, ctx.params.caseRef),
    authorize: (ctx, c) => readDecision(ctx.identity, c),
    handle: (ctx, { tx }, c) => buildHeader(tx, ctx.identity, c, ctx.now),
  }),

  [API.cases.transition.id]: command(API.cases.transition, {
    load: async (ctx, tx) => {
      const c = await findCase(tx, ctx.params.caseRef);
      if (!c) throw notFound();
      return c;
    },
    authorize: (ctx, c) => authorizeAny(ctx.identity, ctx.now, c, ['case.edit', 'case.hold_resume', 'case.stop']),
    handle: async (ctx, t, c) => {
      const { tx } = t;
      const cmd = ctx.body.command as CaseStageCommand;
      const facts: LifecycleFacts = {
        caseOwnerId: c.owner_user_id,
        sponsorId: c.sponsor_user_id,
        rationale: ctx.body.rationale,
        heldFromStage: c.held_from_stage as CaseStage | null,
        stopAuthority: policy.check(subjectAt(ctx.identity, ctx.now), 'case.stop', caseResource(c)).allow,
        marketBoundaryDefined: await boundaryDefined(tx, c),
        approvalsStillEffective: await approvalsStillEffective(tx, c),
      };
      const r = caseMachine.apply(c.stage as CaseStage, cmd, ctx.identity.actor, facts);
      if (!r.ok) throw machineRefusal(r);
      const terminal = r.to === 'stopped' || r.to === 'closed';
      const moved = await tx
        .updateTable('platform.workflow_case')
        .set({
          stage: r.to,
          held_from_stage: r.to === 'on_hold' ? r.from : null,
          updated_by: ctx.userId,
          ...(terminal ? { closed_at: ctx.now } : {}),
        })
        .where('id', '=', c.id)
        .where('stage', '=', c.stage)
        .returningAll()
        .executeTakeFirst();
      if (!moved) throw new ApiError('VERSION_CONFLICT', 'The case changed while you were deciding. Reload.');
      if (cmd === 'stop') {
        await tx
          .insertInto('platform.decision_record')
          .values({
            tenant_id: ctx.tenantId,
            case_id: c.id,
            outcome: 'stop',
            label: 'Stopped',
            rationale: ctx.body.rationale,
            decided_by: ctx.userId,
            decided_at: ctx.now,
          })
          .execute();
      }
      await t.audit({
        action: r.auditAction,
        objectType: 'case',
        objectId: c.id,
        objectVersion: moved.row_version,
        caseId: c.id,
        summary: `${c.display_key}: ${r.from} → ${r.to} (${cmd})`,
        before: { stage: r.from },
        after: { stage: r.to },
        details: { from: r.from, to: r.to, command: cmd },
      });
      for (const e of r.events)
        if (e === 'case_stopped')
          await t.analytics(
            'case_stopped',
            { objectType: 'case', objectId: c.id, objectVersion: moved.row_version, caseId: c.id, stage: r.to },
            { fromStage: r.from, outcome: null },
          );
      await t.emit({
        type: 'case.stage_changed',
        ...eventBase(ctx, c.id),
        from: r.from,
        to: r.to,
        reason: cmd,
      });
      return buildHeader(tx, ctx.identity, moved as CaseRecord, ctx.now);
    },
  }),

  [API.cases.members.id]: query(API.cases.members, {
    load: (ctx, tx) => readableCase(tx, ctx.identity, ctx.params.caseRef),
    authorize: (ctx, c) => readDecision(ctx.identity, c),
    handle: async (_ctx, { tx }, c) => {
      const roles = await tx
        .selectFrom('platform.role_assignment as r')
        .innerJoin('platform.app_user as u', 'u.id', 'r.user_id')
        .select(['r.user_id', 'r.role', 'r.business_unit_id', 'r.case_id', 'u.kind', 'u.is_active'])
        .where('r.revoked_at', 'is', null)
        .execute();
      const parts = await tx
        .selectFrom('platform.case_participant as p')
        .innerJoin('platform.app_user as u', 'u.id', 'p.user_id')
        .select(['p.user_id', 'p.participant_role', 'u.kind', 'u.is_active'])
        .where('p.case_id', '=', c.id)
        .execute();
      const byUser = new Map<string, { roles: Set<RoleCode>; participantRoles: Set<string> }>();
      const entry = (id: string) => {
        if (!byUser.has(id)) byUser.set(id, { roles: new Set(), participantRoles: new Set() });
        return byUser.get(id)!;
      };
      for (const r of roles) {
        if (r.kind !== 'human' || !r.is_active || r.role === 'tenant_admin') continue;
        const reaches =
          (r.business_unit_id === null || r.business_unit_id === c.business_unit_id) &&
          (r.case_id === null || r.case_id === c.id);
        if (reaches) entry(r.user_id).roles.add(r.role as RoleCode);
      }
      for (const p of parts) {
        if (p.kind !== 'human' || !p.is_active) continue;
        entry(p.user_id).participantRoles.add(p.participant_role);
      }
      for (const [id, label] of [
        [c.owner_user_id, 'case_owner'],
        [c.sponsor_user_id, 'sponsor'],
      ] as const)
        if (!byUser.has(id)) entry(id).participantRoles.add(label);
      const people = await peopleMap(tx, [...byUser.keys()]);
      const items: CaseMember[] = [...byUser.entries()]
        .map(([id, e]) => ({ ...who(people, id), roles: [...e.roles], participantRoles: [...e.participantRoles] }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      return { items };
    },
  }),

  [API.cases.activity.id]: query(API.cases.activity, {
    load: (ctx, tx) => readableCase(tx, ctx.identity, ctx.params.caseRef),
    authorize: (ctx, c) => readDecision(ctx.identity, c),
    handle: async (ctx, { tx }, c) => {
      const op = API.cases.activity.id;
      const after = decodeCursor(ctx.query.cursor, ctx.tenantId, op, ctx.now);
      const events = await readAudit(tx, {
        caseId: c.id,
        limit: 1000,
        beforeSeq: after ? Number(after.key) : undefined,
      });
      const filtered = ctx.query.keyOnly ? events.filter((e) => KEY_ACTIONS.test(e.action)) : events;
      const items = filtered.slice(0, ctx.query.limit);
      const last = items[items.length - 1];
      return {
        items: items.map(
          (e): ActivityItem => ({
            id: e.id,
            at: e.occurredAt,
            actor: e.actor,
            title: e.summary,
            detail: e.objectVersion ? `${e.objectType.replace(/_/g, ' ')} v${e.objectVersion}` : null,
            keyDecision: KEY_ACTIONS.test(e.action),
            href: null,
          }),
        ),
        nextCursor:
          last && filtered.length > items.length ? encodeCursor(ctx.tenantId, op, last.seq, last.id, ctx.now) : null,
      };
    },
  }),

  [API.cases.history.id]: query(API.cases.history, {
    load: (ctx, tx) => readableCase(tx, ctx.identity, ctx.params.caseRef),
    authorize: (ctx, c) => readDecision(ctx.identity, c),
    handle: async (ctx, { tx }, c) => {
      const op = API.cases.history.id;
      const after = decodeCursor(ctx.query.cursor, ctx.tenantId, op, ctx.now);
      const events = await readAudit(tx, {
        caseId: c.id,
        objectType: ctx.query.objectType,
        objectId: ctx.query.objectId,
        limit: ctx.query.limit + 1,
        beforeSeq: after ? Number(after.key) : undefined,
      });
      const items = events.slice(0, ctx.query.limit);
      const last = items[items.length - 1];
      return {
        items,
        nextCursor: last && events.length > items.length ? encodeCursor(ctx.tenantId, op, last.seq, last.id, ctx.now) : null,
      };
    },
  }),

  [API.cases.requestReview.id]: command(API.cases.requestReview, {
    load: async (ctx, tx) => {
      const c = await findCase(tx, ctx.params.caseRef);
      if (!c) throw notFound();
      return c;
    },
    authorize: (ctx, c) => authorizeOnCase(ctx.identity, ctx.now, c, 'review.request'),
    handle: async (ctx, t, c) => {
      const { tx } = t;
      const b = ctx.body;
      await assertHuman(tx, b.reviewerId, 'body.reviewerId');
      const row = await tx
        .insertInto('platform.review_request')
        .values({
          tenant_id: ctx.tenantId,
          case_id: c.id,
          area: b.area,
          target_type: b.targetType,
          target_id: b.targetId,
          question: b.question,
          what_to_check: b.whatToCheck,
          requested_by: ctx.userId,
          reviewer_user_id: b.reviewerId,
          due_on: b.dueOn,
          created_at: ctx.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      // S07: asking a named reviewer about a feasibility dimension creates or reassigns that row.
      const dim = /^feasibility\.(\w+)$/.exec(b.targetType)?.[1];
      if (dim) {
        const DIMS = ['product_fit', 'differentiation', 'commercial_access', 'operations', 'specialist_review', 'channel', 'competition'];
        if (!DIMS.includes(dim)) throw new ApiError('VALIDATION_FAILED', 'Unknown feasibility dimension.');
        await tx
          .insertInto('me.feasibility_assessment')
          .values({
            tenant_id: ctx.tenantId,
            case_id: c.id,
            dimension: dim,
            question: b.question,
            reviewer_user_id: b.reviewerId,
            status: 'in_review',
            scope_text: 'In review',
            due_on: b.dueOn,
            human_only: dim === 'specialist_review',
          })
          .onConflict((oc) =>
            oc.columns(['case_id', 'dimension']).doUpdateSet({
              reviewer_user_id: b.reviewerId,
              question: b.question,
              due_on: b.dueOn,
            }),
          )
          .execute();
      }
      await t.audit({
        action: 'review_request.created',
        objectType: 'review_request',
        objectId: row.id,
        caseId: c.id,
        summary: `${b.area} review requested from a named reviewer on ${c.display_key}`,
        details: { area: b.area, targetType: b.targetType },
      });
      const people = await peopleMap(tx, [row.requested_by, row.reviewer_user_id]);
      return toReviewRequest(row, c.display_key, people);
    },
  }),
};

