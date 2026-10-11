/**
 * Comments on case objects (shared component, ME-17). Anyone who can read the case may comment.
 * Comments are never material changes: they write a comment and an audit event, nothing else.
 * The target must exist inside the same case (no attaching comments to other cases' objects).
 */
import { API } from '@growth-os/contracts';
import { sql, type Tx } from '@growth-os/db';
import { caseVisible } from '../../../platform/authz';
import { resolveCase, type CaseRow } from '../../../platform/cases';
import { ApiError, notFound } from '../../../platform/errors';
import { command, type HandlerMap } from '../../../platform/pipeline';

/** Commentable target types → table and its case column (null: the case itself). */
const TARGETS: Record<string, { table: string; caseColumn: string | null }> = {
  case: { table: 'platform.workflow_case', caseColumn: null },
  claim: { table: 'platform.claim', caseColumn: 'case_id' },
  assumption: { table: 'platform.assumption', caseColumn: 'case_id' },
  challenge: { table: 'platform.challenge', caseColumn: 'case_id' },
  gate_request: { table: 'platform.gate_request', caseColumn: 'case_id' },
  decision_snapshot: { table: 'platform.decision_snapshot', caseColumn: 'case_id' },
  task: { table: 'platform.task', caseColumn: 'case_id' },
  thesis_version: { table: 'me.thesis_version', caseColumn: 'case_id' },
  sizing_version: { table: 'me.sizing_version', caseColumn: 'case_id' },
  economics_version: { table: 'me.economics_version', caseColumn: 'case_id' },
  feasibility_assessment: { table: 'me.feasibility_assessment', caseColumn: 'case_id' },
  experiment: { table: 'me.experiment', caseColumn: 'case_id' },
  pilot_plan: { table: 'me.pilot_plan', caseColumn: 'case_id' },
  outcome_review: { table: 'me.outcome_review', caseColumn: 'case_id' },
};

async function targetInCase(tx: Tx, c: CaseRow, targetType: string, targetId: string): Promise<boolean> {
  const t = TARGETS[targetType];
  if (!t) return false;
  if (t.caseColumn === null) return targetId === c.id;
  const [schema, table] = t.table.split('.') as [string, string];
  const r = await sql<{ ok: boolean }>`SELECT EXISTS (
      SELECT 1 FROM ${sql.table(`${schema}.${table}`)} WHERE id = ${targetId} AND ${sql.ref(t.caseColumn)} = ${c.id}
    ) AS ok`.execute(tx);
  return r.rows[0]?.ok === true;
}

export const commentHandlers: HandlerMap = {
  [API.comments.addComment.id]: command(API.comments.addComment, {
    load: (ctx, tx) => resolveCase(tx, ctx.params.caseRef),
    authorize: (ctx, c) =>
      c
        ? caseVisible(ctx.identity.subject, c, 'comment.case_reader')
        : { allow: false, rule: 'case.read', code: 'NOT_FOUND', reason: 'Not found' },
    handle: async (ctx, t, c) => {
      if (ctx.identity.kind !== 'human')
        throw new ApiError('AGENT_IDENTITY_FORBIDDEN', 'Only people can comment.');
      if (!TARGETS[ctx.body.targetType])
        throw new ApiError('VALIDATION_FAILED', 'Unknown comment target', {
          errors: [
            {
              path: 'body.targetType',
              code: 'invalid_enum_value',
              message: `Use one of: ${Object.keys(TARGETS).join(', ')}`,
            },
          ],
        });
      if (!(await targetInCase(t.tx, c!, ctx.body.targetType, ctx.body.targetId))) throw notFound();
      const row = await t.tx
        .insertInto('platform.comment')
        .values({
          tenant_id: ctx.tenantId,
          case_id: c!.id,
          target_type: ctx.body.targetType,
          target_id: ctx.body.targetId,
          author_id: ctx.userId,
          body: ctx.body.body,
          created_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'comment.added',
        objectType: 'comment',
        objectId: row.id,
        caseId: c!.id,
        summary: `Commented on ${ctx.body.targetType.replace(/_/g, ' ')} in ${c!.key}`,
        details: { targetType: ctx.body.targetType, targetId: ctx.body.targetId },
      });
      return { id: row.id };
    },
  }),
};
