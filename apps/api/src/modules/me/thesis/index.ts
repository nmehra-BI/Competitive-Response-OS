/**
 * Thesis and claims (S05, ME-15). Field-level provenance: editing an AI-drafted field flips it to
 * `ai_edited`; a client can never mark text as AI (never-rule 11). Every claim has an epistemic kind;
 * evidence claims need a source. AI claims are accepted or discarded only by a person.
 */
import { API, ThesisFields, type ProvenancedText, type ReasonToWin } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { ApiError, notFound } from '../../../platform/errors';
import { applyMateriality } from '../../../platform/materiality';
import { assertIfMatch, command, query, type HandlerMap } from '../../../platform/pipeline';
import {
  authorizeOnCase,
  caseById,
  eventBase,
  findCase,
  peopleMap,
  readDecision,
  readableCase,
  who,
  type CaseRecord,
} from '../cases/access';
import { challengesWhere } from '../assumptions/read';
import { claimsByIds, EMPTY_THESIS, thesisVersions, thesisView, type ThesisRow } from './read';
import { insertClaim } from './writers';

async function loadCase(tx: Tx, ref: string): Promise<CaseRecord> {
  const c = await findCase(tx, ref);
  if (!c) throw notFound();
  return c;
}

function mergeText(old: ProvenancedText, incoming: ProvenancedText, userId: string): ProvenancedText {
  if (incoming.value === old.value) return old;
  return {
    value: incoming.value,
    origin: old.origin === 'human' ? 'human' : 'ai_edited',
    agentRunId: old.agentRunId,
    editedBy: userId,
  };
}

function mergeFields(old: ThesisFields, patch: Partial<ThesisFields>, userId: string): ThesisFields {
  const out: ThesisFields = { ...old };
  for (const k of ['proposition', 'intendedCustomer', 'whyNow'] as const)
    if (patch[k]) out[k] = mergeText(old[k], patch[k]!, userId);
  if (patch.recommendation !== undefined)
    out.recommendation =
      patch.recommendation === null
        ? null
        : mergeText(
            old.recommendation ?? { value: '', origin: 'human', agentRunId: null, editedBy: null },
            patch.recommendation,
            userId,
          );
  if (patch.recommendationBy !== undefined) out.recommendationBy = patch.recommendationBy;
  if (patch.reasonsToWin)
    out.reasonsToWin = patch.reasonsToWin.map((r): ReasonToWin => {
      const prev = old.reasonsToWin.find((x) => x.id === r.id);
      return {
        ...r,
        text: prev
          ? mergeText(prev.text, r.text, userId)
          : { value: r.text.value, origin: 'human', agentRunId: null, editedBy: null },
      };
    });
  if (patch.alternatives) out.alternatives = patch.alternatives;
  if (patch.claimIds) out.claimIds = patch.claimIds;
  return out;
}

async function loadClaim(tx: Tx, id: string) {
  const cl = await tx.selectFrom('platform.claim').selectAll().where('id', '=', id).executeTakeFirst();
  if (!cl || !cl.case_id) throw notFound();
  return { cl, c: await caseById(tx, cl.case_id) };
}

export const thesisHandlers: HandlerMap = {
  [API.thesis.get.id]: query(API.thesis.get, {
    load: (ctx, tx) => readableCase(tx, ctx.identity, ctx.params.caseRef),
    authorize: (ctx, c) => readDecision(ctx.identity, c),
    handle: async (ctx, { tx }, c) => {
      const v = await thesisView(tx, ctx.identity, c);
      const shown = v.draft ?? v.current;
      if (shown) ctx.setETag(shown.rowVersion);
      return v;
    },
  }),

  [API.thesis.saveDraft.id]: command(API.thesis.saveDraft, {
    load: (ctx, tx) => loadCase(tx, ctx.params.caseRef),
    authorize: (ctx, c) => authorizeOnCase(ctx.identity, ctx.now, c, 'case.edit'),
    handle: async (ctx, t, c) => {
      const { tx } = t;
      const versions = await thesisVersions(tx, c.id);
      let draft = versions.find((v) => v.state === 'draft');
      const current = versions.filter((v) => v.state === 'committed').pop();
      if (draft) assertIfMatch(ctx, draft.row_version);
      else {
        assertIfMatch(ctx, current?.row_version ?? 0);
        draft = (await tx
          .insertInto('me.thesis_version')
          .values({
            tenant_id: ctx.tenantId,
            case_id: c.id,
            version: (versions[versions.length - 1]?.version ?? 0) + 1,
            state: 'draft',
            fields: JSON.stringify(current ? current.fields : EMPTY_THESIS),
            created_by: ctx.userId,
            created_at: ctx.now,
          })
          .returningAll()
          .executeTakeFirstOrThrow()) as ThesisRow;
      }
      const fields = mergeFields(ThesisFields.parse(draft.fields), ctx.body.fields, ctx.userId);
      if (ctx.body.fields.claimIds) {
        const own = await tx.selectFrom('platform.claim').select('id').where('case_id', '=', c.id).execute();
        if (!fields.claimIds.every((id) => own.some((o) => o.id === id)))
          throw new ApiError('VALIDATION_FAILED', 'Link only claims of this case.');
        await tx.deleteFrom('me.thesis_claim').where('thesis_version_id', '=', draft.id).execute();
        for (const [i, id] of fields.claimIds.entries())
          await tx
            .insertInto('me.thesis_claim')
            .values({ tenant_id: ctx.tenantId, thesis_version_id: draft.id, claim_id: id, ordinal: i + 1 })
            .execute();
      }
      const after = await tx
        .updateTable('me.thesis_version')
        .set({ fields: JSON.stringify(fields) })
        .where('id', '=', draft.id)
        .returning(['row_version', 'version'])
        .executeTakeFirstOrThrow();
      ctx.setETag(after.row_version);
      await t.audit({
        action: 'thesis.draft_saved',
        objectType: 'thesis_version',
        objectId: draft.id,
        objectVersion: after.version,
        caseId: c.id,
        summary: `Thesis draft v${after.version} saved (${Object.keys(ctx.body.fields).join(', ') || 'no field'})`,
      });
      return thesisView(tx, ctx.identity, c);
    },
  }),

  [API.thesis.commit.id]: command(API.thesis.commit, {
    load: (ctx, tx) => loadCase(tx, ctx.params.caseRef),
    authorize: (ctx, c) => authorizeOnCase(ctx.identity, ctx.now, c, 'model.commit'),
    handle: async (ctx, t, c) => {
      const { tx } = t;
      const versions = await thesisVersions(tx, c.id);
      const draft = versions.find((v) => v.state === 'draft');
      if (!draft) throw new ApiError('INVALID_TRANSITION', 'There is no thesis draft to commit.');
      const f = ThesisFields.parse(draft.fields);
      const blockers = [
        ...(f.proposition.value.trim() ? [] : [{ key: 'proposition', message: 'State the proposition.' }]),
        ...(f.alternatives.some((a) => a.isNoEntry)
          ? []
          : [{ key: 'no_entry', message: 'Alternatives always include “No entry”.' }]),
      ];
      if (blockers.length) throw new ApiError('PRECONDITIONS_UNMET', blockers[0]!.message, { blockers });
      const prev = versions.filter((v) => v.state === 'committed').pop();
      await tx
        .updateTable('me.thesis_version')
        .set({ state: 'committed', committed_at: ctx.now })
        .where('id', '=', draft.id)
        .execute();
      await t.audit({
        action: 'thesis.version_committed',
        objectType: 'thesis_version',
        objectId: draft.id,
        objectVersion: draft.version,
        caseId: c.id,
        summary: `Thesis v${draft.version} committed (immutable)`,
      });
      await t.emit({
        type: 'model.version_committed',
        ...eventBase(ctx, c.id),
        modelType: 'thesis',
        modelVersionId: draft.id,
        version: draft.version,
      });
      if (prev)
        await applyMateriality(
          t,
          {
            changeType: 'other',
            objectType: 'thesis_version',
            objectId: prev.id,
            componentType: 'thesis_version',
            fromVersion: prev.version,
            toVersion: draft.version,
            label: `thesis v${prev.version}`,
          },
          { now: ctx.now, actorUserId: ctx.userId },
        );
      return thesisView(tx, ctx.identity, c);
    },
  }),

  [API.thesis.addClaim.id]: command(API.thesis.addClaim, {
    load: (ctx, tx) => loadCase(tx, ctx.params.caseRef),
    authorize: (ctx, c) => authorizeOnCase(ctx.identity, ctx.now, c, 'case.edit'),
    handle: async (ctx, t, c) => {
      const b = ctx.body;
      if (b.kind === 'evidence' && b.sourceIds.length === 0)
        throw new ApiError('VALIDATION_FAILED', 'An evidence claim needs at least one source.', {
          errors: [{ path: 'body.sourceIds', code: 'required', message: 'Link at least one source' }],
        });
      let kindDetail: string | null = null;
      if (b.kind === 'assumption') {
        if (!b.assumptionId)
          throw new ApiError('VALIDATION_FAILED', 'Link the assumption this claim rests on.');
        const a = await t.tx
          .selectFrom('platform.assumption')
          .select(['case_id', 'owner_user_id'])
          .where('id', '=', b.assumptionId)
          .executeTakeFirst();
        if (!a || a.case_id !== c.id)
          throw new ApiError('VALIDATION_FAILED', 'The assumption is not in this case register.');
        kindDetail = who(await peopleMap(t.tx, [a.owner_user_id]), a.owner_user_id).displayName;
      } else if (b.kind === 'evidence') {
        const s = await t.tx
          .selectFrom('platform.source')
          .select('title')
          .where('id', '=', b.sourceIds[0]!)
          .executeTakeFirst();
        kindDetail = s ? s.title.split(',')[0]!.slice(0, 60) : null;
      }
      const id = await insertClaim(
        t.tx,
        { tenantId: ctx.tenantId, actorUserId: ctx.userId, now: ctx.now },
        {
          caseId: c.id,
          statement: b.statement,
          kind: b.kind,
          kindDetail,
          origin: 'human',
          agentRunId: null,
          sourceIds: b.sourceIds,
          assumptionId: b.assumptionId,
          acceptedBy: ctx.userId,
        },
      );
      await t.audit({
        action: 'claim.created',
        objectType: 'claim',
        objectId: id,
        caseId: c.id,
        summary: `${b.kind} claim added`,
        details: { kind: b.kind },
      });
      return (await claimsByIds(t.tx, ctx.identity, [id]))[0]!;
    },
  }),

  [API.thesis.acceptClaim.id]: command(API.thesis.acceptClaim, {
    load: (ctx, tx) => loadClaim(tx, ctx.params.id),
    authorize: (ctx, { c }) => authorizeOnCase(ctx.identity, ctx.now, c, 'claim.accept_ai'),
    handle: async (ctx, t, { cl, c }) => {
      if (cl.status !== 'proposed')
        throw new ApiError('INVALID_TRANSITION', 'Only a proposed AI draft can be accepted.');
      const edited = ctx.body.editedStatement?.trim() && ctx.body.editedStatement !== cl.statement;
      await t.tx
        .updateTable('platform.claim')
        .set({
          status: 'accepted',
          accepted_by: ctx.userId,
          accepted_at: ctx.now,
          ...(edited ? { statement: ctx.body.editedStatement!, origin: 'ai_edited' } : {}),
          ...(ctx.body.as === 'assumption'
            ? { kind: 'assumption', kind_detail: ctx.identity.user.displayName }
            : {}),
        })
        .where('id', '=', cl.id)
        .execute();
      await t.audit({
        action: 'claim.accepted',
        objectType: 'claim',
        objectId: cl.id,
        caseId: c.id,
        summary: `AI draft claim accepted as ${ctx.body.as}${edited ? ' (edited)' : ''}`,
        before: { status: cl.status },
        after: { status: 'accepted' },
      });
      return (await claimsByIds(t.tx, ctx.identity, [cl.id]))[0]!;
    },
  }),

  [API.thesis.discardClaim.id]: command(API.thesis.discardClaim, {
    load: (ctx, tx) => loadClaim(tx, ctx.params.id),
    authorize: (ctx, { c }) => authorizeOnCase(ctx.identity, ctx.now, c, 'claim.accept_ai'),
    handle: async (ctx, t, { cl, c }) => {
      if (cl.status !== 'proposed')
        throw new ApiError('INVALID_TRANSITION', 'Only a proposed claim can be discarded.');
      await t.tx.updateTable('platform.claim').set({ status: 'discarded' }).where('id', '=', cl.id).execute();
      await t.audit({
        action: 'claim.discarded',
        objectType: 'claim',
        objectId: cl.id,
        caseId: c.id,
        summary: 'Proposed claim discarded (kept in history)',
      });
      return (await claimsByIds(t.tx, ctx.identity, [cl.id]))[0]!;
    },
  }),

  [API.thesis.challengeClaim.id]: command(API.thesis.challengeClaim, {
    load: (ctx, tx) => loadClaim(tx, ctx.params.id),
    authorize: (ctx, { c }) => authorizeOnCase(ctx.identity, ctx.now, c, 'assumption.dispute'),
    handle: async (ctx, t, { cl, c }) => {
      if (cl.status === 'discarded' || cl.status === 'superseded')
        throw new ApiError('INVALID_TRANSITION', 'This claim is no longer in use.');
      const ch = await t.tx
        .insertInto('platform.challenge')
        .values({
          tenant_id: ctx.tenantId,
          kind: 'challenge',
          target_type: 'claim',
          target_id: cl.id,
          case_id: c.id,
          raised_by: ctx.userId,
          statement: ctx.body.statement,
          created_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (cl.status === 'accepted')
        await t.tx
          .updateTable('platform.claim')
          .set({ status: 'challenged' })
          .where('id', '=', cl.id)
          .execute();
      await t.audit({
        action: 'claim.challenged',
        objectType: 'claim',
        objectId: cl.id,
        caseId: c.id,
        summary: 'Claim challenged; sent to the claim owner',
        details: { challengeId: ch.id },
      });
      return (await challengesWhere(t.tx, { ids: [ch.id] }))[0]!;
    },
  }),
};
