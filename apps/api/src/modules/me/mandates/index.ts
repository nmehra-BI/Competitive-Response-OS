/**
 * Mandates (S02, ME-01, WF-01). Drafts autosave with If-Match; submitting validates the required
 * fields through the mandate machine (every missing field listed together), commits the version,
 * freezes a G0 snapshot whose subject is the mandate (D-036) and opens the G0 gate request.
 * Deciding G0 is WS4b's `gates.decide`.
 */
import {
  API,
  type GateCode,
  type Mandate,
  type MandateDraftFields,
  type MandateVersion,
  type SnapshotContent,
} from '@growth-os/contracts';
import {
  createSnapshot,
  evaluateGate,
  gateRequestMachine,
  mandateMachine,
  nextSnapshotVersion,
  snapshotMachine,
} from '@growth-os/domain';
import { allocateDisplayKey, type Tx } from '@growth-os/db';
import { roleAllows } from '../../../platform/authz';
import { isUuid } from '../../../platform/cases';
import type { Authorization, Identity } from '../../../platform/context';
import { ApiError, notFound } from '../../../platform/errors';
import { pageOf } from '../../../platform/pagination';
import { assertIfMatch, command, query, type HandlerMap } from '../../../platform/pipeline';
import { isoDateTime, isoDateTimeOrNull } from '../../../platform/serialize';
import { machineRefusal, moneyLabel } from '../cases/access';
import { toGateRequest, type GateRow } from '../gates/lib/serialize';

type MandateRow = {
  id: string;
  display_key: string;
  business_unit_id: string;
  title: string;
  status: string;
  current_version_id: string | null;
  draft_version_id: string | null;
  g0_gate_request_id: string | null;
  created_at: Date;
  created_by: string;
};
type VersionRow = Awaited<ReturnType<typeof versionRows>>[number];

async function versionRows(tx: Tx, ids: string[]) {
  if (ids.length === 0) return [];
  return tx.selectFrom('me.mandate_version').selectAll().where('id', 'in', ids).execute();
}

export async function findMandate(tx: Tx, ref: string): Promise<MandateRow | undefined> {
  return tx
    .selectFrom('me.mandate')
    .selectAll()
    .where(isUuid(ref) ? 'id' : 'display_key', '=', ref)
    .executeTakeFirst() as Promise<MandateRow | undefined>;
}

/** Mandates are visible to people with a case-reading or mandate-editing role in their business unit. */
export function mandateVisible(identity: Identity, buId: string): Authorization {
  const scope = { businessUnitId: buId, caseId: null };
  const edit = roleAllows(identity.subject, 'mandate.edit', scope);
  if (edit.allow) return edit;
  return roleAllows(identity.subject, 'case.read', scope, { hidden: true });
}

function fieldsOf(v: VersionRow): MandateDraftFields {
  const f: MandateDraftFields = {
    ...(v.segment_ids.length ? { segmentIds: v.segment_ids } : {}),
    ...(v.geography_codes.length ? { geographyCodes: v.geography_codes } : {}),
    exclusions: v.exclusions,
    evidenceSourceKinds: v.evidence_source_kinds as MandateDraftFields['evidenceSourceKinds'],
    pilotDurationDays: v.pilot_duration_days,
    investmentCeiling: v.investment_ceiling,
  };
  if (v.objective !== null) f.objective = v.objective;
  if (v.product_id !== null) f.productId = v.product_id;
  if (v.horizon_years !== null) f.horizonYears = v.horizon_years;
  if (v.currency !== null) f.currency = v.currency;
  if (v.owner_user_id !== null) f.ownerId = v.owner_user_id;
  if (v.sponsor_user_id !== null) f.sponsorId = v.sponsor_user_id;
  if (v.success_definition !== null) f.successDefinition = v.success_definition;
  return f;
}

function toVersion(v: VersionRow): MandateVersion {
  return {
    id: v.id,
    mandateId: v.mandate_id,
    version: v.version,
    state: v.state as MandateVersion['state'],
    fields: fieldsOf(v),
    committedAt: isoDateTimeOrNull(v.committed_at),
    rowVersion: v.row_version,
    createdBy: v.created_by,
    createdAt: isoDateTime(v.created_at),
    updatedAt: isoDateTime(v.updated_at),
  };
}

/** Missing or inconsistent required fields (S02 inline validation). */
export function mandateValidation(f: MandateDraftFields): { field: string; message: string }[] {
  const e: { field: string; message: string }[] = [];
  if (!f.objective?.trim()) e.push({ field: 'objective', message: 'State the objective.' });
  if (!f.productId) e.push({ field: 'productId', message: 'Choose the product.' });
  if (!f.segmentIds?.length) e.push({ field: 'segmentIds', message: 'Choose at least one segment.' });
  if (!f.geographyCodes?.length)
    e.push({ field: 'geographyCodes', message: 'Choose at least one geography.' });
  if (!f.horizonYears) e.push({ field: 'horizonYears', message: 'Set the decision horizon.' });
  if (!f.currency) e.push({ field: 'currency', message: 'State the currency.' });
  if (!f.ownerId) e.push({ field: 'ownerId', message: 'Name an accountable owner.' });
  if (!f.sponsorId) e.push({ field: 'sponsorId', message: 'Name a sponsor.' });
  if (!f.successDefinition?.trim())
    e.push({ field: 'successDefinition', message: 'Say what a successful outcome is.' });
  if (f.horizonYears && f.pilotDurationDays && f.pilotDurationDays > f.horizonYears * 365)
    e.push({
      field: 'pilotDurationDays',
      message: 'The pilot duration must fit inside the decision horizon.',
    });
  return e;
}

async function scopePreview(tx: Tx, f: MandateDraftFields): Promise<string> {
  const product = f.productId
    ? await tx.selectFrom('platform.product').select('name').where('id', '=', f.productId).executeTakeFirst()
    : undefined;
  const segs = f.segmentIds?.length
    ? await tx.selectFrom('platform.segment').select('name').where('id', 'in', f.segmentIds).execute()
    : [];
  const parts = [
    `${product?.name ?? 'Product not chosen'} for ${segs.map((s) => s.name.toLowerCase()).join(', ') || 'no segment yet'} in ${f.geographyCodes?.join(', ') || 'no geography yet'}`,
    f.horizonYears ? `horizon ${f.horizonYears} years` : 'horizon not set',
    f.currency ?? 'currency not stated',
  ];
  if (f.investmentCeiling) parts.push(`pilot up to ${moneyLabel(f.investmentCeiling, f.currency ?? 'EUR')}`);
  if (f.pilotDurationDays) parts.push(`${f.pilotDurationDays} days`);
  if (f.exclusions?.length) parts.push(`excludes: ${f.exclusions.join('; ')}`);
  return parts.join(' · ');
}

export async function toMandate(tx: Tx, m: MandateRow): Promise<Mandate> {
  const rows = await versionRows(
    tx,
    [m.current_version_id, m.draft_version_id].filter((x): x is string => !!x),
  );
  const cur = rows.find((r) => r.id === m.current_version_id);
  const draft = rows.find((r) => r.id === m.draft_version_id);
  const shown = draft ?? cur;
  const fields = shown ? fieldsOf(shown) : {};
  return {
    id: m.id,
    key: m.display_key,
    businessUnitId: m.business_unit_id,
    title: m.title,
    status: m.status as Mandate['status'],
    currentVersion: cur ? toVersion(cur) : null,
    draftVersion: draft ? toVersion(draft) : null,
    g0GateRequestId: m.g0_gate_request_id,
    scopePreview: await scopePreview(tx, fields),
    validationErrors: draft ? mandateValidation(fields) : [],
  };
}

function columnsOf(f: MandateDraftFields) {
  const c: Record<string, unknown> = {};
  if (f.objective !== undefined) c.objective = f.objective;
  if (f.productId !== undefined) c.product_id = f.productId;
  if (f.segmentIds !== undefined) c.segment_ids = f.segmentIds;
  if (f.geographyCodes !== undefined) c.geography_codes = f.geographyCodes;
  if (f.exclusions !== undefined) c.exclusions = f.exclusions;
  if (f.horizonYears !== undefined) c.horizon_years = f.horizonYears;
  if (f.pilotDurationDays !== undefined) c.pilot_duration_days = f.pilotDurationDays;
  if (f.investmentCeiling !== undefined) c.investment_ceiling = f.investmentCeiling;
  if (f.currency !== undefined) c.currency = f.currency;
  if (f.evidenceSourceKinds !== undefined) c.evidence_source_kinds = f.evidenceSourceKinds;
  if (f.ownerId !== undefined) c.owner_user_id = f.ownerId;
  if (f.sponsorId !== undefined) c.sponsor_user_id = f.sponsorId;
  if (f.successDefinition !== undefined) c.success_definition = f.successDefinition;
  return c;
}

/** Create a mandate with a draft version (also used by `cases.createDirect`). */
export async function insertMandate(
  tx: Tx,
  input: {
    tenantId: string;
    userId: string;
    businessUnitId: string;
    title: string;
    fields: MandateDraftFields;
    now: Date;
  },
): Promise<MandateRow> {
  const key = await allocateDisplayKey(tx, input.tenantId, 'MD', async (k) =>
    Boolean(await tx.selectFrom('me.mandate').select('id').where('display_key', '=', k).executeTakeFirst()),
  );
  const m = await tx
    .insertInto('me.mandate')
    .values({
      tenant_id: input.tenantId,
      display_key: key,
      business_unit_id: input.businessUnitId,
      title: input.title,
      status: 'draft',
      created_by: input.userId,
      created_at: input.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const v = await tx
    .insertInto('me.mandate_version')
    .values({
      tenant_id: input.tenantId,
      mandate_id: m.id,
      version: 1,
      state: 'draft',
      created_by: input.userId,
      created_at: input.now,
      ...columnsOf(input.fields),
    } as never)
    .returning('id')
    .executeTakeFirstOrThrow();
  return (await tx
    .updateTable('me.mandate')
    .set({ draft_version_id: v.id })
    .where('id', '=', m.id)
    .returningAll()
    .executeTakeFirstOrThrow()) as MandateRow;
}

async function loadVisible(tx: Tx, identity: Identity, ref: string) {
  const m = await findMandate(tx, ref);
  if (!m) throw notFound();
  return m;
}

function g0Content(
  m: MandateRow,
  v: VersionRow,
  segLabel: string | null,
): Omit<SnapshotContent, 'schemaVersion' | 'components'> {
  return {
    caseId: m.id,
    caseKey: m.display_key,
    subject: { type: 'mandate', id: m.id, key: m.display_key },
    gateCode: 'G0',
    ask: `Approve the mandate scope: ${v.objective ?? m.title}`,
    scope: {
      amount: null,
      currency: v.currency,
      durationDays: null,
      windowStart: null,
      windowEnd: null,
      countryCodes: v.geography_codes,
      segmentLabel: segLabel,
      maxSites: null,
      milestones: [],
      ownerId: v.owner_user_id,
      authorizes: [
        `Search and assessment within this scope · horizon ${v.horizon_years} years · ${v.currency}`,
      ],
      doesNotAuthorize: ['No spend: validation (G1) and pilot (G2) are separate gates', ...v.exclusions],
    },
    recommendation: 'Approve the bounded mandate scope.',
    alternatives: [{ name: 'No entry.', meaning: 'Do not search this segment.', isNoEntry: true }],
    evidenceSummary: [],
    assumptions: [],
    validationResults: [],
    economics: null,
    sizing: null,
    signOffs: [],
    budgetAndStopRules: ['No spend: validation (G1) and pilot (G2) are separate gates'],
    conditionsProposed: [],
    dissent: [],
    knownLimitations: [],
    blockers: [],
    outcomeTargets: [],
  };
}

export const mandateHandlers: HandlerMap = {
  [API.mandates.list.id]: query(API.mandates.list, {
    authorize: () => ({ allow: true, rule: 'mandate.list', authorityGrantId: null }),
    handle: async (ctx, { tx }) => {
      const rows = (await tx
        .selectFrom('me.mandate')
        .selectAll()
        .orderBy('created_at')
        .orderBy('id')
        .execute()) as MandateRow[];
      const visible = rows.filter((m) => mandateVisible(ctx.identity, m.business_unit_id).allow);
      const page = pageOf(visible, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
        tenantId: ctx.tenantId,
        op: API.mandates.list.id,
        now: ctx.now,
        keyOf: (m) => ({ key: m.id, id: m.id }),
      });
      return {
        items: await Promise.all(page.items.map((m) => toMandate(tx, m))),
        nextCursor: page.nextCursor,
      };
    },
  }),

  [API.mandates.create.id]: command(API.mandates.create, {
    load: async (ctx, tx) => {
      const bu = await tx
        .selectFrom('platform.business_unit')
        .select('id')
        .where('id', '=', ctx.body.businessUnitId)
        .executeTakeFirst();
      if (!bu) throw notFound();
      return bu.id;
    },
    authorize: (ctx, bu) =>
      roleAllows(ctx.identity.subject, 'mandate.edit', { businessUnitId: bu, caseId: null }),
    handle: async (ctx, t, bu) => {
      const m = await insertMandate(t.tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        businessUnitId: bu,
        title: ctx.body.title,
        fields: ctx.body.fields,
        now: ctx.now,
      });
      await t.audit({
        action: 'mandate.created',
        objectType: 'mandate',
        objectId: m.id,
        objectVersion: 1,
        summary: `Mandate ${m.display_key} created as a draft`,
        after: ctx.body.fields,
      });
      await t.analytics(
        'mandate_created',
        { objectType: 'mandate', objectId: m.id },
        {
          hasSponsor: Boolean(ctx.body.fields.sponsorId),
        },
      );
      await t.emit({
        type: 'mandate.created',
        eventId: crypto.randomUUID(),
        tenantId: ctx.tenantId,
        caseId: null,
        actorId: ctx.userId,
        occurredAt: ctx.now.toISOString(),
        correlationId: ctx.correlationId,
        mandateId: m.id,
      });
      return toMandate(t.tx, m);
    },
  }),

  [API.mandates.get.id]: query(API.mandates.get, {
    load: (ctx, tx) => loadVisible(tx, ctx.identity, ctx.params.ref),
    authorize: (ctx, m) => mandateVisible(ctx.identity, m.business_unit_id),
    handle: (_ctx, { tx }, m) => toMandate(tx, m),
  }),

  [API.mandates.saveDraft.id]: command(API.mandates.saveDraft, {
    load: (ctx, tx) => loadVisible(tx, ctx.identity, ctx.params.ref),
    authorize: (ctx, m) => {
      const v = mandateVisible(ctx.identity, m.business_unit_id);
      if (!v.allow) return v;
      return roleAllows(ctx.identity.subject, 'mandate.edit', {
        businessUnitId: m.business_unit_id,
        caseId: null,
      });
    },
    handle: async (ctx, t, m) => {
      const { tx } = t;
      let draftId = m.draft_version_id;
      let current: VersionRow | undefined;
      if (!draftId) {
        if (m.status !== 'returned')
          throw new ApiError(
            'INVALID_TRANSITION',
            m.status === 'awaiting_decision'
              ? 'The mandate is awaiting its G0 decision and cannot be edited.'
              : 'An approved mandate cannot be edited; start a new mandate to change the scope.',
          );
        [current] = await versionRows(tx, [m.current_version_id!]);
        assertIfMatch(ctx, current!.row_version);
        const r = mandateMachine.apply('returned', 'revise', ctx.identity.actor, {
          mandate: { ownerId: current!.owner_user_id } as never,
        });
        if (!r.ok) throw machineRefusal(r);
        const {
          id: _i,
          version,
          state: _s,
          row_version: _r,
          committed_at: _c,
          created_at: _ca,
          updated_at: _u,
          ...copy
        } = current!;
        const d = await tx
          .insertInto('me.mandate_version')
          .values({
            ...copy,
            version: version + 1,
            state: 'draft',
            created_by: ctx.userId,
            created_at: ctx.now,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        draftId = d.id;
        await tx
          .updateTable('me.mandate')
          .set({ draft_version_id: draftId, status: 'draft' })
          .where('id', '=', m.id)
          .execute();
      } else {
        const [d] = await versionRows(tx, [draftId]);
        assertIfMatch(ctx, d!.row_version);
      }
      const cols = columnsOf(ctx.body.fields);
      const updated =
        Object.keys(cols).length > 0
          ? await tx
              .updateTable('me.mandate_version')
              .set(cols)
              .where('id', '=', draftId)
              .returningAll()
              .executeTakeFirstOrThrow()
          : (await versionRows(tx, [draftId]))[0]!;
      ctx.setETag(updated.row_version);
      await t.audit({
        action: 'mandate.draft_saved',
        objectType: 'mandate_version',
        objectId: draftId,
        objectVersion: updated.version,
        summary: `Draft of ${m.display_key} v${updated.version} saved`,
        after: ctx.body.fields,
      });
      return toMandate(tx, (await findMandate(tx, m.id))!);
    },
  }),

  [API.mandates.submit.id]: command(API.mandates.submit, {
    load: (ctx, tx) => loadVisible(tx, ctx.identity, ctx.params.ref),
    authorize: (ctx, m) => {
      const v = mandateVisible(ctx.identity, m.business_unit_id);
      if (!v.allow) return v;
      return roleAllows(ctx.identity.subject, 'mandate.submit', {
        businessUnitId: m.business_unit_id,
        caseId: null,
      });
    },
    handle: async (ctx, t, m) => {
      const { tx } = t;
      if (!m.draft_version_id) throw new ApiError('INVALID_TRANSITION', 'There is no draft to submit.');
      const [d] = await versionRows(tx, [m.draft_version_id]);
      const draft = d!;
      const r = mandateMachine.apply(m.status as 'draft', 'submit', ctx.identity.actor, {
        mandate: {
          ownerId: draft.owner_user_id,
          sponsorId: draft.sponsor_user_id,
          currency: draft.currency,
          objective: draft.objective,
          horizonYears: draft.horizon_years,
          pilotDurationDays: draft.pilot_duration_days,
          geographyCodes: draft.geography_codes,
          productId: draft.product_id,
          segmentIds: draft.segment_ids,
        },
      });
      if (!r.ok) throw machineRefusal(r);
      if (!draft.success_definition?.trim())
        throw new ApiError('PRECONDITIONS_UNMET', 'Say what a successful outcome is.', {
          blockers: [{ key: 'success_definition', message: 'Say what a successful outcome is.' }],
        });
      const ev = evaluateGate({
        gateCode: 'G0',
        mandate: {
          sponsorId: draft.sponsor_user_id,
          objective: draft.objective,
          constraints: draft.exclusions,
          ownerId: draft.owner_user_id,
          currency: draft.currency,
          horizonYears: draft.horizon_years,
        },
      });
      if (!ev.allMet)
        throw new ApiError('PRECONDITIONS_UNMET', ev.summary ?? 'G0 preconditions unmet', {
          blockers: ev.blockers,
        });

      // Commit the version (immutable from here on).
      const committed = await tx
        .updateTable('me.mandate_version')
        .set({ state: 'committed', committed_at: ctx.now })
        .where('id', '=', draft.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      // G0 gate request: reused after a return (resubmit), created on first submission.
      let gate = m.g0_gate_request_id
        ? ((await tx
            .selectFrom('platform.gate_request')
            .selectAll()
            .where('id', '=', m.g0_gate_request_id)
            .executeTakeFirst()) as GateRow | undefined)
        : undefined;
      const scope = g0Content(m, committed, null).scope;
      if (!gate) {
        gate = (await tx
          .insertInto('platform.gate_request')
          .values({
            tenant_id: ctx.tenantId,
            display_key: `${m.display_key}-G0`,
            subject_type: 'mandate',
            subject_id: m.id,
            business_unit_id: m.business_unit_id,
            gate_code: 'G0',
            status: 'draft',
            scope: JSON.stringify(scope),
            created_by: ctx.userId,
            created_at: ctx.now,
          })
          .returningAll()
          .executeTakeFirstOrThrow()) as GateRow;
      }
      const segs = committed.segment_ids.length
        ? await tx
            .selectFrom('platform.segment')
            .select('name')
            .where('id', 'in', committed.segment_ids)
            .execute()
        : [];
      const existing = await tx
        .selectFrom('platform.decision_snapshot')
        .select(['id', 'version', 'status'])
        .where('subject_id', '=', m.id)
        .execute();
      const built = await createSnapshot(
        {
          ...g0Content(m, committed, segs.map((s) => s.name).join(', ') || null),
          components: [
            { type: 'mandate_version', id: committed.id, version: committed.version, state: 'committed' },
          ],
        },
        nextSnapshotVersion(existing.map((s) => s.version)),
      );
      if (!built.ok) throw new ApiError(built.code, built.problems[0] ?? 'Snapshot could not be built');
      const snap = built.snapshot;
      const command = gate.status === 'returned_for_revision' ? 'resubmit' : 'submit';
      const gr = gateRequestMachine.apply(gate.status as never, command, ctx.identity.actor, {
        caseOwnerId: committed.owner_user_id,
        preconditions: ev.preconditions,
        snapshot: { id: 'pending', hash: snap.hash, status: 'current' },
      });
      if (!gr.ok) throw machineRefusal(gr);
      const snapRow = await tx
        .insertInto('platform.decision_snapshot')
        .values({
          tenant_id: ctx.tenantId,
          gate_request_id: gate.id,
          case_id: null,
          version: snap.version,
          subject_id: m.id,
          content_canonical: snap.canonical,
          content_hash: snap.hash,
          created_by: ctx.userId,
          created_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const c of snap.content.components)
        await tx
          .insertInto('platform.snapshot_component')
          .values({
            tenant_id: ctx.tenantId,
            snapshot_id: snapRow.id,
            component_type: c.type,
            component_id: c.id,
            component_version: c.version,
          })
          .execute();
      for (const old of existing.filter((s) => s.status !== 'superseded')) {
        const sr = snapshotMachine.apply(
          old.status as never,
          'supersede',
          { kind: 'system', reason: 'gate_decision' },
          {
            newerSnapshotCreated: true,
          },
        );
        if (sr.ok)
          await tx
            .updateTable('platform.decision_snapshot')
            .set({ status: 'superseded', superseded_by_snapshot_id: snapRow.id })
            .where('id', '=', old.id)
            .execute();
      }
      const gateAfter = (await tx
        .updateTable('platform.gate_request')
        .set({
          status: gr.to,
          scope: JSON.stringify(scope),
          current_snapshot_id: snapRow.id,
          submitted_by: ctx.userId,
          submitted_at: ctx.now,
        })
        .where('id', '=', gate.id)
        .returningAll()
        .executeTakeFirstOrThrow()) as GateRow;
      const mAfter = (await tx
        .updateTable('me.mandate')
        .set({
          status: r.to,
          current_version_id: committed.id,
          draft_version_id: null,
          g0_gate_request_id: gate.id,
        })
        .where('id', '=', m.id)
        .returningAll()
        .executeTakeFirstOrThrow()) as MandateRow;

      await t.audit({
        action: 'mandate.submit',
        objectType: 'mandate_version',
        objectId: committed.id,
        objectVersion: committed.version,
        summary: `${m.display_key} v${committed.version} committed and submitted for G0`,
        before: { status: m.status },
        after: { status: r.to },
      });
      await t.audit({
        action: gr.auditAction,
        objectType: 'gate_request',
        objectId: gate.id,
        objectVersion: snap.version,
        summary: `G0 requested for ${m.display_key}: snapshot v${snap.version} · ${snap.fingerprint}`,
        details: { snapshotVersion: snap.version, fingerprint: snap.fingerprint },
      });
      await t.analytics(
        'gate_submitted',
        { objectType: 'gate_request', objectId: gate.id, objectVersion: snap.version },
        {
          gate: 'G0' as GateCode,
          snapshotVersion: snap.version,
        },
      );
      await t.emit({
        type: 'mandate.version_committed',
        eventId: crypto.randomUUID(),
        tenantId: ctx.tenantId,
        caseId: null,
        actorId: ctx.userId,
        occurredAt: ctx.now.toISOString(),
        correlationId: ctx.correlationId,
        mandateId: m.id,
        version: committed.version,
      });
      return { mandate: await toMandate(tx, mAfter), gateRequest: await toGateRequest(tx, gateAfter) };
    },
  }),
};
