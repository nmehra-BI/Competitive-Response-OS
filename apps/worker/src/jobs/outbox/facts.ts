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
import { loadApprovalGateFacts, sql, type Tx } from '@growth-os/db';
import type { ConnectorStatus, RoleCode } from '@growth-os/contracts';
import type { ApprovalEffectiveness } from '@growth-os/domain';
import { approvalEffectiveness, mayStillSend } from './policy';

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

/** Send-time gate facts: the shared reader in `@growth-os/db` (D-075). */
export const loadGateFacts = loadApprovalGateFacts;

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
  /** For a validation task set: its experiment's owner may send while they may edit experiments (D-098). */
  experimentId: string | null = null,
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
  const held = roles.map((r) => ({
    role: r.role as RoleCode,
    businessUnitId: r.business_unit_id,
    caseId: r.case_id,
    revokedAt: null,
  }));
  if (mayStillSend(held, scope)) return true;
  if (!experimentId) return false;
  const e = await tx
    .selectFrom('me.experiment')
    .select('owner_user_id')
    .where('id', '=', experimentId)
    .executeTakeFirst();
  return e?.owner_user_id === userId && mayStillSend(held, scope, 'experiment.edit');
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
    actorAuthorized: await actorMayStillSend(
      tx,
      input.actorUserId,
      { businessUnitId: input.businessUnitId, caseId: input.set.caseId },
      input.set.ownerType === 'experiment' ? input.set.ownerId : null,
    ),
  };
}
