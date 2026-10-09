/**
 * Pure outbox rules (unit-tested): backoff, connector error → stored error code, approval
 * effectiveness from gate facts, and the actor re-check against the frozen role table.
 */
import type { ConnectorErrorKind } from '@growth-os/connectors';
import type { GateRequestStatus, RoleAssignment } from '@growth-os/contracts';
import { ROLE_ACTIONS, type ApprovalEffectiveness } from '@growth-os/domain';

/** Default backoff: 30 s, 1 min, 2 min, 4 min … capped at 15 min; never sooner than Retry-After. */
export function defaultBackoffMs(attempts: number, retryAfterMs: number | null = null): number {
  const exp = Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
  return Math.max(exp, retryAfterMs ?? 0);
}

/** `ExternalSync.lastErrorCode` values (contract comment: permission_denied, timeout, token_expired, http_5xx). */
export const ERROR_CODE_BY_KIND: Readonly<Record<ConnectorErrorKind, string>> = {
  timeout_ambiguous: 'timeout',
  transient: 'http_5xx',
  rate_limited: 'rate_limited',
  permission_denied: 'permission_denied',
  validation: 'validation',
  token_expired: 'token_expired',
  unavailable: 'unavailable',
};

/** Error codes the send-time re-check writes (never from the connector). */
export const RECHECK_CODES = {
  approvalInvalidated: 'approval_invalidated',
  approvalExpired: 'approval_expired',
  approvalMissing: 'approval_missing',
  planChanged: 'plan_changed',
  connectorUnavailable: 'connector_unavailable',
  actorNotAuthorized: 'actor_not_authorized',
  attemptsExhausted: 'attempts_exhausted',
} as const;

export interface GateFacts {
  status: GateRequestStatus;
  expiresAt: string | null;
  /** An approve / approve-with-conditions approval without an invalidation row. */
  hasEffectiveApproval: boolean;
  hasExpiredInvalidation: boolean;
  hasInvalidation: boolean;
  /** The approval was already used (pilot activated, experiment started, a task write left the outbox). */
  executed: boolean;
}

/**
 * Whether the gate approval still authorizes external writes (never-rule 10). An approval past its
 * expiry that was never used is expired even before the expiry timer has run (fail closed).
 */
export function approvalEffectiveness(g: GateFacts | null, now: Date): ApprovalEffectiveness {
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

/** Does the user still hold a role that may send tasks for this case (scope: business unit / case)? */
export function mayStillSend(
  roles: readonly Pick<RoleAssignment, 'role' | 'businessUnitId' | 'caseId' | 'revokedAt'>[],
  scope: { businessUnitId: string; caseId: string },
): boolean {
  return roles.some(
    (r) =>
      !r.revokedAt &&
      ROLE_ACTIONS[r.role].includes('task_sync.send') &&
      (r.businessUnitId === null || r.businessUnitId === scope.businessUnitId) &&
      (r.caseId === null || r.caseId === scope.caseId),
  );
}
