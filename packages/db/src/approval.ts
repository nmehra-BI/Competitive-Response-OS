/**
 * Approval effectiveness — one definition for the API, the outbox worker and the expiry timer
 * (D-075, CR-WS6-5). Never-rule 10: an invalidated or expired approval authorizes nothing; an
 * approval past `expires_at` that was never used counts as expired even before the timer runs
 * (fail closed).
 *
 * "Used" (executed) means: G0 and G3 always (the decision moves the stage at once); otherwise the
 * pilot was activated under the gate, an experiment it locked was started, or a task write it
 * authorized left the outbox (sent, sending, checking or confirmed).
 */
import { sql } from 'kysely';
import type { GateRequestStatus } from '@growth-os/contracts';
import type { ApprovalEffectiveness } from '@growth-os/domain';
import type { Tx } from './index';

/** SQL predicate over `platform.gate_request g`: the gate's approval was already used. */
export const APPROVAL_EXECUTED_SQL = sql<boolean>`(g.gate_code IN ('G0','G3')
  OR EXISTS (SELECT 1 FROM me.pilot_plan pp WHERE pp.gate_request_id = g.id AND pp.activated_at IS NOT NULL)
  OR EXISTS (SELECT 1 FROM me.experiment e WHERE e.locked_by_gate_request_id = g.id
               AND e.lifecycle IN ('running','result_recorded'))
  OR EXISTS (SELECT 1 FROM platform.outbox_message o
              WHERE o.authorization_ref->>'gateRequestId' = g.id::text
                AND (o.sent_at IS NOT NULL OR o.status IN ('sending','checking','confirmed'))))`;

export interface ApprovalGateFacts {
  status: GateRequestStatus;
  expiresAt: string | null;
  /** An approve / approve-with-conditions approval without an invalidation row. */
  hasEffectiveApproval: boolean;
  hasExpiredInvalidation: boolean;
  hasInvalidation: boolean;
  /** The approval was already used (see the module comment). */
  executed: boolean;
}

/** Pure rule (unit-tested in the worker's policy tests). */
export function approvalEffectivenessOf(g: ApprovalGateFacts | null, now: Date): ApprovalEffectiveness {
  if (!g) return 'missing';
  if (g.status === 'invalidated') return 'invalidated';
  if (g.status === 'expired') return 'expired';
  if (g.status !== 'approved' && g.status !== 'approved_with_conditions') {
    if (g.hasInvalidation) return 'invalidated';
    return 'missing';
  }
  if (!g.hasEffectiveApproval) {
    if (g.hasExpiredInvalidation) return 'expired';
    if (g.hasInvalidation) return 'invalidated';
    return 'missing';
  }
  if (g.expiresAt && Date.parse(g.expiresAt) <= now.getTime() && !g.executed) return 'expired';
  return 'effective';
}

const iso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

/** Read the facts for one gate request inside the caller's tenant transaction. */
export async function loadApprovalGateFacts(
  tx: Tx,
  gateRequestId: string,
): Promise<ApprovalGateFacts | null> {
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
      ${APPROVAL_EXECUTED_SQL} AS executed
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

/** Whether a gate's approval still authorizes execution at `now`. */
export async function approvalEffectivenessFor(
  tx: Tx,
  gateRequestId: string | null,
  now: Date,
): Promise<ApprovalEffectiveness> {
  if (!gateRequestId) return 'missing';
  return approvalEffectivenessOf(await loadApprovalGateFacts(tx, gateRequestId), now);
}
