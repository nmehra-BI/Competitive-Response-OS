/**
 * Evidence (S13, ME-02, ME-15, ME-16, WF-10): sources, permitted excerpts, uploads, challenges,
 * staleness and replacement. Every content read goes through the licence entitlement:
 *   excerpt         permitted passages and the quoted fact / inferred claim / human assumption panel
 *   aggregate_only  metadata only, no passages, no derived text
 *   none            metadata only; no excerpt, summary, paraphrase or challenge text ("Open in licensed tool")
 * Sources used only by cases the viewer cannot read are hidden (404); impact lists accessible cases only.
 */
import {
  API,
  type Challenge,
  type EntitlementAccess,
  type License,
  type PersonRef,
  type Source,
  type SourceDetail,
} from '@growth-os/contracts';
import { allocateDisplayKey, type Tx } from '@growth-os/db';
import { canReadCase, caseVisible, roleAllows, type CaseFacts } from '../../../platform/authz';
import { casesByIds, isUuid, resolveCase, type CaseRow } from '../../../platform/cases';
import type { Authorization, Identity } from '../../../platform/context';
import { effectiveAccess, entitlementFor, entitlementsFor } from '../../../platform/entitlements';
import { ApiError, notFound } from '../../../platform/errors';
import { applyMateriality } from '../../../platform/materiality';
import { pageOf } from '../../../platform/pagination';
import { command, query, type HandlerMap, type Tools } from '../../../platform/pipeline';
import { isoDateOrNull, isoDateTime, isoDateTimeOrNull, personRef } from '../../../platform/serialize';
import { sourceUses, type SourceUse } from './links';

export const EVIDENCE_INGEST_JOB = 'evidence.ingest';
const DAY_MS = 24 * 60 * 60 * 1000;

type SourceRow = Awaited<ReturnType<typeof loadSourceRow>> & object;

async function loadSourceRow(tx: Tx, ref: string) {
  return tx
    .selectFrom('platform.source')
    .selectAll()
    .where(isUuid(ref) ? 'id' : 'display_key', '=', ref)
    .executeTakeFirst();
}

export function toSource(r: SourceRow, now: Date): Source {
  const since = r.published_on ?? r.retrieved_at;
  const ageingDays =
    r.freshness === 'ageing' && since
      ? Math.floor((now.getTime() - new Date(since).getTime()) / DAY_MS)
      : null;
  return {
    id: r.id,
    key: r.display_key,
    title: r.title,
    publisher: r.publisher,
    originKind: r.origin_kind as Source['originKind'],
    originText: r.origin_text,
    uri: r.uri,
    contentSha256: r.content_sha256,
    publishedOn: isoDateOrNull(r.published_on),
    retrievedAt: isoDateTimeOrNull(r.retrieved_at),
    licenseId: r.license_id,
    ingestionStatus: r.ingestion_status as Source['ingestionStatus'],
    availability: r.availability as Source['availability'],
    freshness: r.freshness as Source['freshness'],
    ageingDays,
    supersededBySourceId: r.superseded_by_source_id,
    staleReason: r.stale_reason,
    deletedAt: isoDateTimeOrNull(r.deleted_at),
    createdAt: isoDateTime(r.created_at),
    createdBy: r.created_by,
  };
}

interface VisibleSource {
  row: SourceRow;
  access: EntitlementAccess;
  uses: SourceUse[];
  readableCases: CaseRow[];
}

/** The source if the caller may see it (metadata), else null. Never reveals hidden cases. */
async function visibleSource(tx: Tx, identity: Identity, ref: string): Promise<VisibleSource | null> {
  if (!roleAllows(identity.subject, 'source.read_metadata').allow) return null;
  const row = await loadSourceRow(tx, ref);
  if (!row) return null;
  const uses = await sourceUses(tx, [row.id]);
  const cases = await casesByIds(
    tx,
    uses.map((u) => u.caseId),
  );
  const readableCases = cases.filter((c) => canReadCase(identity.subject, c));
  if (cases.length > 0 && readableCases.length === 0) return null;
  const access = effectiveAccess(await entitlementFor(tx, identity, row.license_id), row);
  return {
    row,
    access,
    uses: uses.filter((u) => readableCases.some((c) => c.id === u.caseId)),
    readableCases,
  };
}

async function people(tx: Tx, ids: readonly string[]): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .selectFrom('platform.app_user')
    .select(['id', 'display_name', 'title', 'initials'])
    .where('id', 'in', unique)
    .execute();
  return new Map(rows.map((r) => [r.id, personRef(r)]));
}

async function challengesFor(tx: Tx, targetType: string, targetIds: readonly string[]): Promise<Challenge[]> {
  if (targetIds.length === 0) return [];
  const rows = await tx
    .selectFrom('platform.challenge')
    .selectAll()
    .where('target_type', '=', targetType)
    .where('target_id', 'in', [...targetIds])
    .orderBy('created_at')
    .execute();
  const replies = rows.length
    ? await tx
        .selectFrom('platform.challenge_reply')
        .selectAll()
        .where(
          'challenge_id',
          'in',
          rows.map((r) => r.id),
        )
        .orderBy('created_at')
        .execute()
    : [];
  const who = await people(tx, [
    ...rows.map((r) => r.raised_by),
    ...rows.flatMap((r) => (r.resolved_by ? [r.resolved_by] : [])),
    ...replies.map((r) => r.author_id),
  ]);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as Challenge['kind'],
    targetType: r.target_type as Challenge['targetType'],
    targetId: r.target_id,
    caseId: r.case_id,
    raisedBy: who.get(r.raised_by)!,
    statement: r.statement,
    proposedValue: r.proposed_value,
    status: r.status as Challenge['status'],
    resolution: r.resolution,
    resolvedBy: r.resolved_by ? (who.get(r.resolved_by) ?? null) : null,
    resolvedAt: isoDateTimeOrNull(r.resolved_at),
    createdAt: isoDateTime(r.created_at),
    replies: replies
      .filter((x) => x.challenge_id === r.id)
      .map((x) => ({
        id: x.id,
        author: who.get(x.author_id)!,
        body: x.body,
        createdAt: isoDateTime(x.created_at),
      })),
  }));
}

const CASE_TAB: Record<SourceUse['tab'], string> = {
  sizing: 'sizing',
  thesis: 'thesis',
  outcomes: 'outcomes',
  overview: 'thesis',
};

export async function sourceDetail(tx: Tx, v: VisibleSource, now: Date): Promise<SourceDetail> {
  const { row, access } = v;
  const licenseRow = row.license_id
    ? await tx.selectFrom('platform.license').selectAll().where('id', '=', row.license_id).executeTakeFirst()
    : undefined;
  const license: License | null = licenseRow
    ? {
        id: licenseRow.id,
        key: licenseRow.key,
        name: licenseRow.name,
        boundaryText: licenseRow.boundary_text,
        maxExcerptSentences: licenseRow.max_excerpt_sentences,
        allowModelContext: licenseRow.allow_model_context,
        allowEmbeddings: licenseRow.allow_embeddings,
        allowExport: licenseRow.allow_export,
      }
    : null;

  // Content: only with excerpt entitlement. Nothing derived from the source otherwise.
  const excerpt = access === 'excerpt';
  const passages = excerpt
    ? await tx
        .selectFrom('platform.evidence_passage')
        .select(['id', 'source_id', 'locator', 'excerpt', 'excerpt_sha256'])
        .where('source_id', '=', row.id)
        .orderBy('created_at')
        .execute()
    : [];
  const claims = excerpt
    ? await tx
        .selectFrom('platform.claim_evidence_link as l')
        .innerJoin('platform.claim as c', 'c.id', 'l.claim_id')
        .select(['c.statement', 'c.kind', 'c.status', 'c.accepted_by', 'c.created_by', 'c.case_id'])
        .where('l.source_id', '=', row.id)
        .where('c.status', 'in', ['accepted', 'challenged'])
        .execute()
    : [];
  const readableClaims = claims.filter(
    (c) => c.case_id === null || v.readableCases.some((k) => k.id === c.case_id),
  );
  const inferred = readableClaims.find((c) => c.kind === 'inference_ai');
  const assumption = readableClaims.find((c) => c.kind === 'assumption');
  const who = await people(tx, [
    ...(inferred?.accepted_by ? [inferred.accepted_by] : []),
    ...(assumption ? [assumption.created_by] : []),
  ]);

  const caseById = new Map(v.readableCases.map((c) => [c.id, c]));
  const impact = v.readableCases.map((c) => ({
    caseId: c.id,
    caseKey: c.key,
    what: [...new Set(v.uses.filter((u) => u.caseId === c.id).map((u) => u.where))].join(', '),
  }));
  return {
    source: toSource(row, now),
    license,
    viewerAccess: access,
    passages: passages.map((p) => ({
      id: p.id,
      sourceId: p.source_id,
      locator: p.locator,
      excerpt: p.excerpt,
      excerptSha256: p.excerpt_sha256,
    })),
    quotedFact: passages[0]?.excerpt ?? null,
    inferredClaim: inferred
      ? {
          text: inferred.statement,
          acceptedBy: inferred.accepted_by ? (who.get(inferred.accepted_by) ?? null) : null,
        }
      : null,
    humanAssumption: assumption
      ? { text: assumption.statement, owner: who.get(assumption.created_by)! }
      : null,
    linkedUses: v.uses.map((u) => {
      const c = caseById.get(u.caseId)!;
      return {
        label: u.label,
        where: `${c.key} · ${u.where}`,
        href: `/me/cases/${c.key}/${CASE_TAB[u.tab]}`,
      };
    }),
    impact,
    challenges: access === 'none' ? [] : await challengesFor(tx, 'source', [row.id]),
  };
}

const sourceReadable = (ctx: { identity: Identity }): Authorization =>
  roleAllows(ctx.identity.subject, 'source.read_metadata');

async function requireVisible(tx: Tx, identity: Identity, ref: string): Promise<VisibleSource> {
  const v = await visibleSource(tx, identity, ref);
  if (!v) throw notFound();
  return v;
}

/** Corrections (mark stale, replace) are case-owner work; challenges are open to every case role. */
const canCorrect = (identity: Identity): Authorization => roleAllows(identity.subject, 'case.edit');

async function reviewed(
  t: Tools,
  v: VisibleSource,
  action: 'challenge' | 'mark_stale' | 'replace',
  audit: { action: string; summary: string; details?: Record<string, string | number | boolean | null> },
  objectId = v.row.id,
): Promise<void> {
  await t.audit({
    action: audit.action,
    objectType: action === 'challenge' ? 'challenge' : 'source',
    objectId,
    summary: audit.summary,
    details: { sourceKey: v.row.display_key, ...audit.details },
  });
  await t.analytics('evidence_reviewed', { objectType: 'source', objectId: v.row.id }, { action });
}

export const evidenceHandlers: HandlerMap = {
  [API.evidence.list.id]: query(API.evidence.list, {
    load: async (ctx, tx) => (ctx.query.caseRef ? await resolveCase(tx, ctx.query.caseRef) : null),
    authorize: (ctx, c) => {
      const base = sourceReadable(ctx);
      if (!base.allow || !ctx.query.caseRef) return base;
      return c
        ? caseVisible(ctx.identity.subject, c)
        : { allow: false, rule: 'case.read', code: 'NOT_FOUND', reason: 'Not found' };
    },
    handle: async (ctx, { tx }, c) => {
      const rows = await tx.selectFrom('platform.source').selectAll().orderBy('display_key').execute();
      const uses = await sourceUses(
        tx,
        rows.map((r) => r.id),
      );
      const cases = await casesByIds(
        tx,
        uses.map((u) => u.caseId),
      );
      const readable = new Set(cases.filter((k) => canReadCase(ctx.identity.subject, k)).map((k) => k.id));
      const visible = rows.filter((r) => {
        const own = uses.filter((u) => u.sourceId === r.id).map((u) => u.caseId);
        if (c) return own.includes(c.id);
        return own.length === 0 || own.some((id) => readable.has(id));
      });
      const page = pageOf(visible, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
        tenantId: ctx.tenantId,
        op: API.evidence.list.id,
        now: ctx.now,
        keyOf: (r) => ({ key: r.display_key, id: r.id }),
      });
      return { items: page.items.map((r) => toSource(r, ctx.now)), nextCursor: page.nextCursor };
    },
  }),

  [API.evidence.get.id]: query(API.evidence.get, {
    load: (ctx, tx) => visibleSource(tx, ctx.identity, ctx.params.ref),
    authorize: (ctx, v) =>
      v
        ? sourceReadable(ctx)
        : { allow: false, rule: 'source.read_metadata', code: 'NOT_FOUND', reason: 'Not found' },
    handle: async (ctx, { tx }, v) => sourceDetail(tx, v!, ctx.now),
  }),

  [API.evidence.upload.id]: command(API.evidence.upload, {
    multipart: true,
    load: async (ctx, tx) => {
      const license = await tx
        .selectFrom('platform.license')
        .select(['id'])
        .where('id', '=', ctx.body.licenseId)
        .executeTakeFirst();
      if (!license)
        throw new ApiError('VALIDATION_FAILED', 'Unknown licence', {
          errors: [
            { path: 'body.licenseId', code: 'not_found', message: 'Choose a licence of this workspace' },
          ],
        });
      const c = ctx.body.caseRef ? await resolveCase(tx, ctx.body.caseRef) : null;
      if (ctx.body.caseRef && (!c || !canReadCase(ctx.identity.subject, c))) throw notFound();
      return c as CaseFacts | null;
    },
    authorize: (ctx, c) => {
      const scope = { businessUnitId: c?.businessUnitId ?? null, caseId: c?.id ?? null };
      const edit = roleAllows(ctx.identity.subject, 'case.edit', scope);
      return edit.allow ? edit : roleAllows(ctx.identity.subject, 'model.edit_draft', scope);
    },
    handle: async (ctx, t, c) => {
      const file = ctx.files[0];
      if (!file || file.bytes.byteLength === 0)
        throw new ApiError(
          'VALIDATION_FAILED',
          'Attach the file: multipart/form-data with a "metadata" field and a file part.',
        );
      const stored = await ctx.deps.objects.put(file.bytes);

      // The same bytes uploaded again link to the existing source (WF-10).
      const existing = await t.tx
        .selectFrom('platform.source')
        .selectAll()
        .where('content_sha256', '=', stored.sha256)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (existing) {
        await t.audit({
          action: 'source.upload_linked',
          objectType: 'source',
          objectId: existing.id,
          caseId: c?.id ?? null,
          summary: `Upload matched existing source ${existing.display_key} (same content hash)`,
          details: { sourceKey: existing.display_key },
        });
        return toSource(existing, ctx.now);
      }

      const key = await allocateDisplayKey(t.tx, ctx.tenantId, 'SRC', async (k) =>
        Boolean(
          await t.tx
            .selectFrom('platform.source')
            .select('id')
            .where('display_key', '=', k)
            .executeTakeFirst(),
        ),
      );
      const row = await t.tx
        .insertInto('platform.source')
        .values({
          tenant_id: ctx.tenantId,
          display_key: key,
          title: ctx.body.title,
          publisher: ctx.body.publisher,
          origin_kind: 'authorized_upload',
          origin_text: `Authorized upload · ${ctx.body.fileName}`.slice(0, 300),
          object_key: stored.key,
          content_sha256: stored.sha256,
          published_on: ctx.body.publishedOn,
          retrieved_at: ctx.now,
          license_id: ctx.body.licenseId,
          ingestion_status: 'pending',
          created_by: ctx.userId,
          created_at: ctx.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await t.enqueue(EVIDENCE_INGEST_JOB, { sourceId: row.id });
      await t.audit({
        action: 'source.uploaded',
        objectType: 'source',
        objectId: row.id,
        caseId: c?.id ?? null,
        summary: `Uploaded ${key} (ingestion queued)`,
        details: { sourceKey: key, bytes: stored.size, mimeType: file.mimeType.slice(0, 100) },
        after: { contentSha256: stored.sha256 },
      });
      return toSource(row, ctx.now);
    },
  }),

  [API.evidence.challenge.id]: command(API.evidence.challenge, {
    load: (ctx, tx) => requireVisible(tx, ctx.identity, ctx.params.ref),
    authorize: (ctx) => sourceReadable(ctx),
    handle: async (ctx, t, v) => {
      const row = await t.tx
        .insertInto('platform.challenge')
        .values({
          tenant_id: ctx.tenantId,
          kind: 'challenge',
          target_type: 'source',
          target_id: v.row.id,
          raised_by: ctx.userId,
          statement: ctx.body.statement,
          created_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await reviewed(
        t,
        v,
        'challenge',
        { action: 'source.challenged', summary: `Challenged ${v.row.display_key}` },
        row.id,
      );
      const [challenge] = (await challengesFor(t.tx, 'source', [v.row.id])).filter((c) => c.id === row.id);
      return challenge!;
    },
  }),

  [API.evidence.markStale.id]: command(API.evidence.markStale, {
    load: (ctx, tx) => requireVisible(tx, ctx.identity, ctx.params.ref),
    authorize: (ctx) => canCorrect(ctx.identity),
    handle: async (ctx, t, v) => {
      if (v.row.freshness === 'superseded')
        throw new ApiError('INVALID_TRANSITION', 'This source is superseded; mark its replacement instead.');
      await t.tx
        .updateTable('platform.source')
        .set({ freshness: 'stale', stale_reason: ctx.body.reason, stale_marked_by: ctx.userId })
        .where('id', '=', v.row.id)
        .execute();
      await reviewed(t, v, 'mark_stale', {
        action: 'source.marked_stale',
        summary: `Marked ${v.row.display_key} stale`,
        details: { from: v.row.freshness },
      });
      await applyMateriality(
        t,
        {
          changeType: 'source_superseded_or_deleted',
          objectType: 'source',
          objectId: v.row.id,
          componentType: 'source',
        },
        { now: ctx.now, actorUserId: ctx.userId },
      );
      return sourceDetail(t.tx, (await visibleSource(t.tx, ctx.identity, v.row.id))!, ctx.now);
    },
  }),

  [API.evidence.replace.id]: command(API.evidence.replace, {
    load: async (ctx, tx) => {
      const v = await requireVisible(tx, ctx.identity, ctx.params.ref);
      const replacement = await visibleSource(tx, ctx.identity, ctx.body.replacementSourceId);
      if (!replacement) throw notFound();
      return { v, replacement };
    },
    authorize: (ctx) => canCorrect(ctx.identity),
    handle: async (ctx, t, { v, replacement }) => {
      const r = replacement.row;
      if (r.id === v.row.id) throw new ApiError('VALIDATION_FAILED', 'A source cannot replace itself.');
      if (v.row.freshness === 'superseded')
        throw new ApiError('INVALID_TRANSITION', 'This source is already superseded.');
      if (r.deleted_at || r.freshness === 'superseded')
        throw new ApiError('INVALID_TRANSITION', 'The replacement must be a current, available source.');
      await t.tx
        .updateTable('platform.source')
        .set({ freshness: 'superseded', superseded_by_source_id: r.id })
        .where('id', '=', v.row.id)
        .execute();
      // Re-link drafts only. Committed versions keep the original source (their rows are immutable).
      const inputs = await t.tx
        .updateTable('me.sizing_input')
        .set({ source_id: r.id })
        .where('source_id', '=', v.row.id)
        .where('sizing_version_id', 'in', (eb) =>
          eb.selectFrom('me.sizing_version').select('id').where('state', '=', 'draft'),
        )
        .executeTakeFirst();
      const cohorts = await t.tx
        .updateTable('me.cohort')
        .set({ source_id: r.id })
        .where('source_id', '=', v.row.id)
        .where('sizing_version_id', 'in', (eb) =>
          eb.selectFrom('me.sizing_version').select('id').where('state', '=', 'draft'),
        )
        .executeTakeFirst();
      const claims = await t.tx
        .updateTable('platform.claim_evidence_link')
        .set({ source_id: r.id, passage_id: null })
        .where('source_id', '=', v.row.id)
        .where('claim_id', 'not in', (eb) =>
          eb
            .selectFrom('me.thesis_claim as tc')
            .innerJoin('me.thesis_version as tv', 'tv.id', 'tc.thesis_version_id')
            .select('tc.claim_id')
            .where('tv.state', '=', 'committed'),
        )
        .executeTakeFirst();
      await reviewed(t, v, 'replace', {
        action: 'source.replaced',
        summary: `Replaced ${v.row.display_key} with ${r.display_key}`,
        details: {
          replacementKey: r.display_key,
          relinkedDraftInputs: Number(inputs.numUpdatedRows) + Number(cohorts.numUpdatedRows),
          relinkedClaims: Number(claims.numUpdatedRows),
        },
      });
      await applyMateriality(
        t,
        {
          changeType: 'source_superseded_or_deleted',
          objectType: 'source',
          objectId: v.row.id,
          componentType: 'source',
        },
        { now: ctx.now, actorUserId: ctx.userId },
      );
      return sourceDetail(t.tx, (await visibleSource(t.tx, ctx.identity, v.row.id))!, ctx.now);
    },
  }),

  [API.evidence.requestAccess.id]: command(API.evidence.requestAccess, {
    load: (ctx, tx) => requireVisible(tx, ctx.identity, ctx.params.ref),
    authorize: (ctx) => sourceReadable(ctx),
    handle: async (ctx, t, v) => {
      await t.audit({
        action: 'source.access_requested',
        objectType: 'source',
        objectId: v.row.id,
        summary: `Requested access to ${v.row.display_key}`,
        details: {
          sourceKey: v.row.display_key,
          licenseId: v.row.license_id,
          reason: ctx.body.reason.slice(0, 160),
        },
      });
      return { requested: true as const };
    },
  }),
};

/** Entitlements for a set of sources (search, export): licence access reduced by availability. */
export async function accessBySource(
  tx: Tx,
  identity: Identity,
  rows: readonly Pick<SourceRow, 'id' | 'license_id' | 'availability' | 'deleted_at'>[],
): Promise<Map<string, EntitlementAccess>> {
  const byLicense = await entitlementsFor(
    tx,
    identity,
    rows.map((r) => r.license_id),
  );
  return new Map(rows.map((r) => [r.id, effectiveAccess(byLicense.get(r.license_id) ?? 'none', r)]));
}
