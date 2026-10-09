/**
 * Send-time authorization facts (never-rule 10, D-021), read inside the tenant transaction that
 * claims the outbox row: approval effectiveness and expiry, plan version, connection status and
 * whether the authorizing human may still send.
 *
 * Hand-off conventions (WAVE3 §6/§7): the outbox row carries `authorization_ref.gateRequestId`
 * (= task_set.authorizing_gate_request_id), `aggregate_type 'external_task_link'` and
 * `aggregate_id` = link id. A pilot task set is current while `me.pilot_plan.current_version_id`
 * is the plan version that owns it; an experiment task set while the experiment is locked by the
 * same gate and not cancelled.
 */
import { sql, type Tx } from '@growth-os/db';
import type { ConnectorStatus, GateRequestStatus, RoleCode } from '@growth-os/contracts';
import type { ApprovalEffectiveness } from '@growth-os/domain';
import { approvalEffectiveness, mayStillSend, type GateFacts } from './policy';

export interface TaskSetRef {
  id: string;
  caseId: string;
  ownerType: 'pilot_plan_version' | 'experiment';
  ownerId: string;
  authorizingGateRequestId: string;
}

export interface SendFacts {
  approval: ApprovalEffectiveness;
  planCurrent: boolean;
  connector: ConnectorStatus;
  actorAuthorized: boolean;
}

const iso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

export async function loadGateFacts(tx: Tx, gateRequestId: string): Promise<GateFacts | null> {
  const r = await sql<{
    status: GateRequestStatus;
    expires_at: Date | string | null;
    has_effective: boolean;
    has_expired: boolean;
    has_invalidation: boolean;
    executed: boolean;
  }>`
    SELECT g.status, g.expires_at,
      EXISTS (SELECT 1 FROM platform.approval a
               WHERE a.gate_request_id = g.id AND a.disposition IN ('approve','approve_with_conditions')
                 AND NOT EXISTS (SELECT 1 FROM platform.approval_invalidation i WHERE i.approval_id = a.id))
        AS has_effective,
      EXISTS (SELECT 1 FROM platform.approval a JOIN platform.approval_invalidation i ON i.approval_id = a.id
               WHERE a.gate_request_id = g.id AND i.kind = 'expired') AS has_expired,
      EXISTS (SELECT 1 FROM platform.approval a JOIN platform.approval_invalidation i ON i.approval_id = a.id
               WHERE a.gate_request_id = g.id) AS has_invalidation,
      (g.gate_code IN ('G0','G3')
        OR EXISTS (SELECT 1 FROM me.pilot_plan pp WHERE pp.gate_request_id = g.id AND pp.activated_at IS NOT NULL)
        OR EXISTS (SELECT 1 FROM me.experiment e WHERE e.locked_by_gate_request_id = g.id
                     AND e.lifecycle IN ('running','result_recorded'))
        OR EXISTS (SELECT 1 FROM platform.outbox_message o
                    WHERE o.authorization_ref->>'gateRequestId' = g.id::text
                      AND (o.sent_at IS NOT NULL OR o.status IN ('sending','checking','confirmed')))
      ) AS executed
    FROM platform.gate_request g WHERE g.id = ${gateRequestId}`.execute(tx);
  const row = r.rows[0];
  if (!row) return null;
  return {
    status: row.status,
    expiresAt: iso(row.expires_at),
    hasEffectiveApproval: row.has_effective,
    hasExpiredInvalidation: row.has_expired,
    hasInvalidation: row.has_invalidation,
    executed: row.executed,
  };
}

export async function planIsCurrent(tx: Tx, set: TaskSetRef): Promise<boolean> {
  if (set.ownerType === 'pilot_plan_version') {
    const r = await sql<{ ok: boolean }>`
      SELECT EXISTS (SELECT 1 FROM me.pilot_plan p WHERE p.current_version_id = ${set.ownerId}) AS ok`.execute(
      tx,
    );
    return r.rows[0]?.ok ?? false;
  }
  const r = await sql<{ ok: boolean }>`
    SELECT EXISTS (SELECT 1 FROM me.experiment e
                    WHERE e.id = ${set.ownerId} AND e.lifecycle <> 'cancelled'
                      AND e.locked_by_gate_request_id = ${set.authorizingGateRequestId}) AS ok`.execute(tx);
  return r.rows[0]?.ok ?? false;
}

export async function actorMayStillSend(
  tx: Tx,
  userId: string | null,
  scope: { businessUnitId: string; caseId: string },
): Promise<boolean> {
  if (!userId) return false;
  const user = await tx
    .selectFrom('platform.app_user')
    .select(['kind', 'is_active'])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!user || user.kind !== 'human' || !user.is_active) return false;
  const roles = await tx
    .selectFrom('platform.role_assignment')
    .select(['role', 'business_unit_id', 'case_id', 'revoked_at'])
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute();
  return mayStillSend(
    roles.map((r) => ({
      role: r.role as RoleCode,
      businessUnitId: r.business_unit_id,
      caseId: r.case_id,
      revokedAt: null,
    })),
    scope,
  );
}

export async function loadSendFacts(
  tx: Tx,
  input: {
    gateRequestId: string;
    set: TaskSetRef;
    businessUnitId: string;
    connectionStatus: ConnectorStatus;
    actorUserId: string | null;
    now: Date;
  },
): Promise<SendFacts> {
  const gate = await loadGateFacts(tx, input.gateRequestId);
  return {
    approval: approvalEffectiveness(gate, input.now),
    planCurrent: await planIsCurrent(tx, input.set),
    connector: input.connectionStatus,
    actorAuthorized: await actorMayStillSend(tx, input.actorUserId, {
      businessUnitId: input.businessUnitId,
      caseId: input.set.caseId,
    }),
  };
}
