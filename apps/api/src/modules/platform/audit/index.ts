/**
 * Admin audit search (S14, ME-17). Tenant administrators read the audit log; nobody can change it
 * (append-only by trigger and privilege). Cursor = last seq, tenant- and operation-bound.
 */
import { API } from '@growth-os/contracts';
import { readAudit } from '../../../platform/audit-read';
import { roleAllows } from '../../../platform/authz';
import { ApiError } from '../../../platform/errors';
import { decodeCursor, encodeCursor } from '../../../platform/pagination';
import { query, type HandlerMap } from '../../../platform/pipeline';

function parseInstant(v: string | undefined, field: string): Date | undefined {
  if (v === undefined) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime()))
    throw new ApiError('VALIDATION_FAILED', 'Request validation failed', {
      errors: [{ path: `query.${field}`, code: 'invalid_date', message: 'Use an ISO date or date-time' }],
    });
  return d;
}

export const auditHandlers: HandlerMap = {
  [API.admin.audit.id]: query(API.admin.audit, {
    authorize: (ctx) => roleAllows(ctx.identity.subject, 'audit.read'),
    handle: async (ctx, { tx }) => {
      const q = ctx.query;
      const after = decodeCursor(q.cursor, ctx.tenantId, API.admin.audit.id, ctx.now);
      const rows = await readAudit(tx, {
        caseId: q.caseId,
        actorId: q.actorId,
        action: q.action,
        from: parseInstant(q.from, 'from'),
        to: parseInstant(q.to, 'to'),
        beforeSeq: after ? Number(after.key) : undefined,
        limit: q.limit + 1,
      });
      const items = rows.slice(0, q.limit);
      const last = items[items.length - 1];
      return {
        items,
        nextCursor:
          rows.length > q.limit && last
            ? encodeCursor(ctx.tenantId, API.admin.audit.id, last.seq, last.id, ctx.now)
            : null,
      };
    },
  }),
};
