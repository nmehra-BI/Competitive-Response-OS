/**
 * Reading the audit log (ME-17): admin audit search (S14) and the case History tab (WS4) share this
 * query and serializer. Ordered by `seq` (global insertion order), newest first.
 */
import type { Tx } from '@growth-os/db';
import { AuditEvent, RoleCode, type AuditEvent as AuditEventT } from '@growth-os/contracts';
import { isoDateTime, personRef } from './serialize';

export interface AuditFilter {
  caseId?: string;
  actorId?: string;
  action?: string;
  objectType?: string;
  objectId?: string;
  from?: Date;
  to?: Date;
  /** Return events with seq below this value (cursor). */
  beforeSeq?: number;
  limit: number;
}

export async function readAudit(tx: Tx, f: AuditFilter): Promise<AuditEventT[]> {
  let q = tx
    .selectFrom('platform.audit_event as e')
    .leftJoin('platform.app_user as u', 'u.id', 'e.actor_user_id')
    .select([
      'e.id',
      'e.seq',
      'e.occurred_at',
      'e.actor_kind',
      'e.actor_role',
      'e.action',
      'e.object_type',
      'e.object_id',
      'e.object_version',
      'e.case_id',
      'e.before_hash',
      'e.after_hash',
      'e.summary',
      'e.authz_context',
      'e.correlation_id',
      'u.id as user_id',
      'u.display_name',
      'u.title',
      'u.initials',
    ])
    .orderBy('e.seq', 'desc')
    .limit(f.limit);
  if (f.caseId) q = q.where('e.case_id', '=', f.caseId);
  if (f.actorId) q = q.where('e.actor_user_id', '=', f.actorId);
  if (f.action) q = q.where('e.action', '=', f.action);
  if (f.objectType) q = q.where('e.object_type', '=', f.objectType);
  if (f.objectId) q = q.where('e.object_id', '=', f.objectId);
  if (f.from) q = q.where('e.occurred_at', '>=', f.from);
  if (f.to) q = q.where('e.occurred_at', '<=', f.to);
  if (f.beforeSeq !== undefined) q = q.where('e.seq', '<', String(f.beforeSeq));
  const rows = await q.execute();
  return rows.map((r) => {
    const authz = r.authz_context as { decision?: string; rule?: string; authorityGrantId?: string | null };
    const role = RoleCode.safeParse(r.actor_role);
    return AuditEvent.parse({
      id: r.id,
      seq: Number(r.seq),
      occurredAt: isoDateTime(r.occurred_at),
      actor:
        r.user_id && r.display_name && r.initials
          ? personRef({ id: r.user_id, display_name: r.display_name, title: r.title, initials: r.initials })
          : null,
      actorKind: r.actor_kind,
      actorRole: role.success ? role.data : null,
      action: r.action,
      objectType: r.object_type,
      objectId: r.object_id,
      objectVersion: r.object_version,
      caseId: r.case_id,
      beforeHash: r.before_hash,
      afterHash: r.after_hash,
      summary: r.summary,
      authzContext: {
        decision: authz.decision === 'deny' ? 'deny' : 'allow',
        rule: authz.rule ?? 'unknown',
        authorityGrantId: authz.authorityGrantId ?? null,
      },
      correlationId: r.correlation_id,
    });
  });
}
