/**
 * Pure outbox rules (unit-tested): backoff, connector error → stored error code, approval
 * effectiveness from gate facts, and the actor re-check against the frozen role table.
 */
import type { ConnectorErrorKind } from '@growth-os/connectors';
import type { RoleAssignment } from '@growth-os/contracts';
import { approvalEffectivenessOf, type ApprovalGateFacts } from '@growth-os/db';
import { ROLE_ACTIONS } from '@growth-os/domain';

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

/**
 * Approval effectiveness lives in `@growth-os/db` (D-075, CR-WS6-5) so the API's request-time check,
 * this worker's send-time check and the expiry timer share one definition.
 */
export type GateFacts = ApprovalGateFacts;
export const approvalEffectiveness = approvalEffectivenessOf;

/** Does the user still hold a role that may send tasks for this case (scope: business unit / case)? */
export function mayStillSend(
  roles: readonly Pick<RoleAssignment, 'role' | 'businessUnitId' | 'caseId' | 'revokedAt'>[],
  scope: { businessUnitId: string; caseId: string },
  action: 'task_sync.send' | 'experiment.edit' = 'task_sync.send',
): boolean {
  return roles.some(
    (r) =>
      !r.revokedAt &&
      ROLE_ACTIONS[r.role].includes(action) &&
      (r.businessUnitId === null || r.businessUnitId === scope.businessUnitId) &&
      (r.caseId === null || r.caseId === scope.caseId),
  );
}
