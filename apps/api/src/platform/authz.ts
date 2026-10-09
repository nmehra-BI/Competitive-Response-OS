/**
 * Baseline authorization helpers on the frozen role table (ROLE_ACTIONS) plus scope.
 *
 * These cover the shared platform modules (auth, evidence, search, comments, admin, audit). Gate
 * decisions, self-approval, authority ceilings and named-reviewer rules belong to the WS3
 * PolicyEngine; command handlers that need them call that engine from their `authorize` hook.
 * Hidden resources return NOT_FOUND, never FORBIDDEN (no existence leak).
 */
import { AGENT_ALLOWED_ACTIONS, ROLE_ACTIONS, type Action, type PolicySubject } from '@growth-os/domain';
import type { RoleCode } from '@growth-os/contracts';
import type { Authorization } from './context';

export interface Scope {
  /** null = tenant-level resource: a role in any business unit matches. */
  businessUnitId: string | null;
  caseId: string | null;
}

export const TENANT_SCOPE: Scope = { businessUnitId: null, caseId: null };

/** First active role assignment that grants `action` within `scope`, or null. */
export function matchingRole(subject: PolicySubject, action: Action, scope: Scope): RoleCode | null {
  for (const ra of subject.roles) {
    if (ra.revokedAt) continue;
    if (!ROLE_ACTIONS[ra.role].includes(action)) continue;
    const buOk =
      ra.businessUnitId === null ||
      scope.businessUnitId === null ||
      ra.businessUnitId === scope.businessUnitId;
    const caseOk = ra.caseId === null || ra.caseId === scope.caseId;
    if (buOk && caseOk) return ra.role;
  }
  return null;
}

/**
 * Role-table check. Agents may only perform AGENT_ALLOWED_ACTIONS (through the tool gateway);
 * services and system actors get nothing here. `hidden` = deny with NOT_FOUND (reads of things the
 * caller may not know exist).
 */
export function roleAllows(
  subject: PolicySubject,
  action: Action,
  scope: Scope = TENANT_SCOPE,
  opts: { hidden?: boolean } = {},
): Authorization {
  const deny = (
    reason: string,
    code: 'FORBIDDEN' | 'NOT_FOUND' | 'AGENT_IDENTITY_FORBIDDEN',
  ): Authorization => ({
    allow: false,
    rule: `role_table:${action}`,
    code: opts.hidden && code === 'FORBIDDEN' ? 'NOT_FOUND' : code,
    reason,
  });
  const { actor } = subject;
  if (actor.kind === 'agent') {
    return AGENT_ALLOWED_ACTIONS.includes(action)
      ? { allow: true, rule: `agent:${action}`, authorityGrantId: null, role: null }
      : deny('Agents cannot perform this action.', 'AGENT_IDENTITY_FORBIDDEN');
  }
  if (actor.kind !== 'human') return deny('Only people can perform this action.', 'AGENT_IDENTITY_FORBIDDEN');
  const role = matchingRole(subject, action, scope);
  if (!role) return deny('Your role does not allow this action.', 'FORBIDDEN');
  return { allow: true, rule: `role:${role}:${action}`, authorityGrantId: null, role };
}

export interface CaseFacts {
  id: string;
  businessUnitId: string;
  ownerUserId: string;
  sponsorUserId: string;
}

/** Case visibility: a role with case.read in the case's business unit (or on the case), or owner/sponsor/participant. */
export function canReadCase(subject: PolicySubject, c: CaseFacts): boolean {
  if (subject.actor.kind !== 'human' && subject.actor.kind !== 'agent') return false;
  if (matchingRole(subject, 'case.read', { businessUnitId: c.businessUnitId, caseId: c.id })) return true;
  if (subject.actor.kind === 'human') {
    const uid = subject.actor.userId;
    if (c.ownerUserId === uid || c.sponsorUserId === uid) return true;
  }
  return subject.participantOfCaseIds.includes(c.id);
}

/** Allow when the subject can read the case, else NOT_FOUND. */
export function caseVisible(subject: PolicySubject, c: CaseFacts, rule = 'case.read'): Authorization {
  return canReadCase(subject, c)
    ? {
        allow: true,
        rule,
        authorityGrantId: null,
        role: matchingRole(subject, 'case.read', { businessUnitId: c.businessUnitId, caseId: c.id }),
      }
    : { allow: false, rule, code: 'NOT_FOUND', reason: 'Not found' };
}

/** Explicit "any signed-in principal" decision, for endpoints whose only rule is a session. */
export const signedIn: Authorization = { allow: true, rule: 'session', authorityGrantId: null, role: null };
