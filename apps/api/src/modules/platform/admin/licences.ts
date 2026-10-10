/**
 * S14 › Licences (D-120, D-129). Fail closed: a licence without a written confirmation of rights, or
 * whose term has ended, allows metadata only — no excerpt, model context, embedding or export. The
 * database refuses anything else (`license_fail_closed`); this handler refuses it first with business
 * copy. At the term end the `timers.license_expiry` job runs the on-expiry action.
 */
import {
  API,
  LICENSE_RIGHTS_STATUS_LABELS,
  type License,
  type LicenseExpiryAction,
  type LicenseRightsStatus,
} from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { roleAllows } from '../../../platform/authz';
import { ApiError, notFound } from '../../../platform/errors';
import { command, query, type HandlerMap } from '../../../platform/pipeline';
import { isoDate, isoDateTimeOrNull } from '../../../platform/serialize';

export interface LicenseRow {
  id: string;
  key: string;
  name: string;
  boundary_text: string;
  max_excerpt_sentences: number;
  allow_model_context: boolean;
  allow_embeddings: boolean;
  allow_export: boolean;
  rights_document_ref: string | null;
  rights_confirmed_on: Date | string | null;
  rights_recorded_by: string | null;
  term_ends_on: Date | string | null;
  on_expiry_action: string;
  expired_at: Date | null;
}

/** Derived rights status (D-129): expired beats confirmed; no written confirmation = unconfirmed. */
export function rightsStatusOf(
  l: Pick<LicenseRow, 'rights_document_ref' | 'expired_at'>,
): LicenseRightsStatus {
  if (l.expired_at) return 'expired';
  return l.rights_document_ref ? 'confirmed' : 'unconfirmed';
}

export function toLicense(l: LicenseRow): License {
  return {
    id: l.id,
    key: l.key,
    name: l.name,
    boundaryText: l.boundary_text,
    maxExcerptSentences: l.max_excerpt_sentences,
    allowModelContext: l.allow_model_context,
    allowEmbeddings: l.allow_embeddings,
    allowExport: l.allow_export,
    rightsConfirmation:
      l.rights_document_ref && l.rights_confirmed_on
        ? {
            documentRef: l.rights_document_ref,
            confirmedOn: isoDate(l.rights_confirmed_on),
            recordedBy: l.rights_recorded_by,
          }
        : null,
    termEndsOn: l.term_ends_on === null ? null : isoDate(l.term_ends_on),
    onExpiry: l.on_expiry_action as LicenseExpiryAction,
    rightsStatus: rightsStatusOf(l),
    expiredAt: isoDateTimeOrNull(l.expired_at),
  };
}

/** Anything above "metadata only" (D-120 §2). */
export const grantsContent = (l: {
  maxExcerptSentences: number;
  allowModelContext: boolean;
  allowEmbeddings: boolean;
  allowExport: boolean;
}) => l.maxExcerptSentences > 0 || l.allowModelContext || l.allowEmbeddings || l.allowExport;

async function licenceRow(tx: Tx, id: string): Promise<LicenseRow> {
  const r = (await tx.selectFrom('platform.license').selectAll().where('id', '=', id).executeTakeFirst()) as
    LicenseRow | undefined;
  if (!r) throw notFound();
  return r;
}

const invalid = (path: string, message: string) =>
  new ApiError('VALIDATION_FAILED', message, { errors: [{ path, code: 'invalid', message }] });

export const licenceHandlers: HandlerMap = {
  [API.admin.licenses.id]: query(API.admin.licenses, {
    authorize: (ctx) => roleAllows(ctx.identity.subject, 'admin.configure'),
    handle: async (_ctx, { tx }) => ({
      items: (
        (await tx.selectFrom('platform.license').selectAll().orderBy('key').execute()) as LicenseRow[]
      ).map(toLicense),
    }),
  }),

  [API.admin.setLicense.id]: command(API.admin.setLicense, {
    load: (ctx, tx) => licenceRow(tx, ctx.params.id),
    authorize: (ctx) => roleAllows(ctx.identity.subject, 'admin.configure'),
    handle: async (ctx, t, before) => {
      const b = ctx.body;
      const today = ctx.now.toISOString().slice(0, 10);
      const confirmation = b.rightsConfirmation;
      if (confirmation && confirmation.confirmedOn > today)
        throw invalid(
          'body.rightsConfirmation.confirmedOn',
          'The written confirmation cannot be dated in the future',
        );
      if (grantsContent(b) && !confirmation)
        throw invalid(
          'body.rightsConfirmation',
          'Record the written confirmation of rights before allowing excerpts, model context, embeddings or export',
        );
      const termEnded = b.termEndsOn !== null && b.termEndsOn < today;
      if (grantsContent(b) && termEnded)
        throw invalid('body.termEndsOn', 'The licence term has ended: metadata only until it is renewed');
      // A renewal (new confirmation, term not ended) clears a past expiry; otherwise an expiry stays.
      const renewed =
        before.expired_at !== null &&
        !!confirmation &&
        !termEnded &&
        (confirmation.documentRef !== before.rights_document_ref ||
          confirmation.confirmedOn !==
            (before.rights_confirmed_on ? isoDate(before.rights_confirmed_on) : null));
      const expiredAt = renewed ? null : before.expired_at;
      if (grantsContent(b) && expiredAt !== null)
        throw invalid(
          'body.rightsConfirmation',
          'The licence term ended: record a new written confirmation to allow content again',
        );
      const row = (await t.tx
        .updateTable('platform.license')
        .set({
          name: b.name,
          boundary_text: b.boundaryText,
          max_excerpt_sentences: b.maxExcerptSentences,
          allow_model_context: b.allowModelContext,
          allow_embeddings: b.allowEmbeddings,
          allow_export: b.allowExport,
          rights_document_ref: confirmation?.documentRef ?? null,
          rights_confirmed_on: confirmation?.confirmedOn ?? null,
          rights_recorded_by: confirmation
            ? confirmation.documentRef === before.rights_document_ref
              ? (before.rights_recorded_by ?? ctx.userId)
              : ctx.userId
            : null,
          term_ends_on: b.termEndsOn,
          on_expiry_action: b.onExpiry,
          expired_at: expiredAt,
        })
        .where('id', '=', before.id)
        .returningAll()
        .executeTakeFirstOrThrow()) as LicenseRow;
      const after = toLicense(row);
      await t.audit({
        action: renewed ? 'admin.license_renewed' : 'admin.license_changed',
        objectType: 'license',
        objectId: row.id,
        summary: `Licence ${row.name}: ${LICENSE_RIGHTS_STATUS_LABELS[after.rightsStatus!]}`.slice(0, 280),
        details: {
          rightsStatus: after.rightsStatus ?? null,
          termEndsOn: after.termEndsOn ?? null,
          onExpiry: after.onExpiry ?? null,
          maxExcerptSentences: row.max_excerpt_sentences,
          allowModelContext: row.allow_model_context,
          allowEmbeddings: row.allow_embeddings,
          allowExport: row.allow_export,
        },
        before: toLicense(before),
        after,
      });
      return after;
    },
  }),
};
