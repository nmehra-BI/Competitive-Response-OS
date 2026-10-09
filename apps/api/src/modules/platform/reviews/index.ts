/**
 * Reviews inbox and review responses (ME-06, ME-11). The inbox lists gate requests the viewer can
 * decide now (policy approval panel) and review requests addressed to the viewer. Only the named
 * reviewer responds; a dispute on an assumption opens a dispute thread.
 */
import { API, type ReviewRequest } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { canReadCase, signedIn } from '../../../platform/authz';
import { ApiError, notFound } from '../../../platform/errors';
import { command, query, type HandlerMap } from '../../../platform/pipeline';
import { isoDateOrNull, isoDateTimeOrNull } from '../../../platform/serialize';
import { caseById, peopleOf, subjectOf, tenantIdSql } from '../../me/gates/lib/common';
import { awaitingDecisions } from '../../me/gates/lib/inbox';

type RRRow = {
  id: string;
  case_id: string;
  area: string;
  target_type: string;
  target_id: string | null;
  question: string;
  what_to_check: string[];
  requested_by: string;
  reviewer_user_id: string;
  due_on: unknown;
  status: string;
  response: string | null;
  response_reason: string | null;
  responded_at: Date | null;
};

export async function toReviewRequests(tx: Tx, rows: RRRow[]): Promise<ReviewRequest[]> {
  if (rows.length === 0) return [];
  const cases = await tx
    .selectFrom('platform.workflow_case')
    .select(['id', 'display_key'])
    .where('id', 'in', [...new Set(rows.map((r) => r.case_id))])
    .execute();
  const people = await peopleOf(tx, rows.flatMap((r) => [r.requested_by, r.reviewer_user_id]));
  return rows.map((r) => ({
    id: r.id,
    caseId: r.case_id,
    caseKey: cases.find((c) => c.id === r.case_id)?.display_key ?? 'ME-0',
    area: r.area as ReviewRequest['area'],
    targetType: r.target_type,
    targetId: r.target_id,
    question: r.question,
    whatToCheck: r.what_to_check,
    requestedBy: people(r.requested_by),
    reviewer: people(r.reviewer_user_id),
    dueOn: isoDateOrNull(r.due_on as string | null),
    status: r.status as ReviewRequest['status'],
    response: r.response as ReviewRequest['response'],
    responseReason: r.response_reason,
    respondedAt: isoDateTimeOrNull(r.responded_at),
  }));
}

/** Review requests addressed to the viewer in cases the viewer can read. */
export async function myReviewRequests(tx: Tx, subject: Parameters<typeof canReadCase>[0], viewerId: string) {
  const rows = (await tx
    .selectFrom('platform.review_request')
    .selectAll()
    .where('reviewer_user_id', '=', viewerId)
    .orderBy('created_at')
    .execute()) as RRRow[];
  const visible: RRRow[] = [];
  for (const r of rows) {
    const c = await caseById(tx, r.case_id);
    if (c && canReadCase(subject, c)) visible.push(r);
  }
  return visible;
}

export const reviewHandlers: HandlerMap = {
  [API.work.reviewsInbox.id]: query(API.work.reviewsInbox, {
    authorize: () => signedIn,
    handle: async (ctx, { tx }) => {
      const tab = ctx.query.tab ?? 'awaiting';
      const subject = subjectOf(ctx);
      const gateDecisions =
        tab === 'awaiting'
          ? (await awaitingDecisions(tx, subject, ctx.userId)).map((d) => ({
              gateRequestId: d.gateRequestId,
              caseKey: d.caseKey,
              buttonLabel: d.buttonLabel,
              dueText: d.dueText,
              href: d.href,
            }))
          : [];
      const all = await myReviewRequests(tx, subject, ctx.userId);
      const rows = all.filter((r) =>
        tab === 'done'
          ? r.status !== 'open'
          : tab === 'economics'
            ? r.status === 'open' && r.area === 'finance'
            : r.status === 'open',
      );
      return { gateDecisions, reviewRequests: await toReviewRequests(tx, rows) };
    },
  }),

  [API.work.respondToReview.id]: command(API.work.respondToReview, {
    load: async (ctx, tx) => {
      const r = (await tx.selectFrom('platform.review_request').selectAll().where('id', '=', ctx.params.id).executeTakeFirst()) as RRRow | undefined;
      if (!r) throw notFound();
      const c = await caseById(tx, r.case_id);
      if (!c) throw notFound();
      return { r, c };
    },
    authorize: (ctx, { r, c }) => {
      if (!canReadCase(ctx.identity.subject, c) && r.reviewer_user_id !== ctx.userId)
        return { allow: false, rule: 'case.read', code: 'NOT_FOUND', reason: 'Not found' };
      return r.reviewer_user_id === ctx.userId
        ? { allow: true, rule: 'review.named_reviewer', authorityGrantId: null }
        : { allow: false, rule: 'review.named_reviewer', code: 'FORBIDDEN', reason: 'Only the named reviewer can respond.' };
    },
    handle: async (ctx, t, { r, c }) => {
      if (r.status !== 'open') throw new ApiError('INVALID_TRANSITION', 'This review request is already answered or cancelled.');
      const row = (await t.tx
        .updateTable('platform.review_request')
        .set({ status: 'responded', response: ctx.body.response, response_reason: ctx.body.reason, responded_at: ctx.now })
        .where('id', '=', r.id)
        .returningAll()
        .executeTakeFirstOrThrow()) as RRRow;
      let challengeId: string | null = null;
      if (ctx.body.response === 'dispute' && r.target_type === 'assumption' && r.target_id) {
        const ch = await t.tx
          .insertInto('platform.challenge')
          .values({
            tenant_id: tenantIdSql,
            kind: 'dispute',
            target_type: 'assumption',
            target_id: r.target_id,
            case_id: c.id,
            raised_by: ctx.userId,
            statement: ctx.body.reason,
            status: 'open',
            created_at: ctx.now,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        challengeId = ch.id;
      }
      await t.audit({
        action: 'review_request.responded',
        objectType: 'review_request',
        objectId: r.id,
        caseId: c.id,
        summary: `${r.area} review answered: ${ctx.body.response}`,
        details: { response: ctx.body.response, challengeId },
      });
      return (await toReviewRequests(t.tx, [row]))[0]!;
    },
  }),
};
