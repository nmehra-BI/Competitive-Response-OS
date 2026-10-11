/**
 * Shared helpers for the WS4a Market Expansion modules: case loading under RLS, case-scoped policy
 * decisions (WS3 PolicyEngine with the tenant-local decision date), people lookups and the
 * WorkflowCase serializer. Hidden cases are NOT_FOUND, never FORBIDDEN.
 */
import type { CaseStage, PersonRef, RoleCode, WorkflowCase } from '@growth-os/contracts';
import { createPolicyEngine, type Action, type PolicySubject, type ResourceRef } from '@growth-os/domain';
import type { Tx } from '@growth-os/db';
import { canReadCase, matchingRole } from '../../../platform/authz';
import { isUuid } from '../../../platform/cases';
import type { Authorization, Identity } from '../../../platform/context';
import { ApiError, notFound } from '../../../platform/errors';
import { tenantLocalIso } from '../../../platform/materiality';
import { isoDateTime, personRef } from '../../../platform/serialize';
import type { Ctx } from '../../../platform/pipeline';
import type { EndpointDef } from '@growth-os/contracts';

/** The request facts helpers need (independent of the endpoint). */
export type BaseCtx = Pick<
  Ctx<EndpointDef>,
  'tenantId' | 'userId' | 'now' | 'correlationId' | 'identity' | 'idempotencyKey'
>;

/** Domain event envelope fields. */
export function eventBase(ctx: BaseCtx, caseId: string | null) {
  return {
    eventId: crypto.randomUUID(),
    tenantId: ctx.tenantId,
    caseId,
    actorId: ctx.userId,
    occurredAt: ctx.now.toISOString(),
    correlationId: ctx.correlationId,
  };
}

export const policy = createPolicyEngine();

export type CaseRecord = {
  id: string;
  display_key: string;
  title: string;
  stage: string;
  held_from_stage: string | null;
  business_unit_id: string;
  owner_user_id: string;
  sponsor_user_id: string;
  origin_type: string;
  origin_id: string | null;
  mandate_id: string | null;
  app_type: string;
  row_version: number;
  created_at: Date;
  updated_at: Date;
};

/** Tenant-local decision date for authority checks (D-045), in the tenant's zone (D-077). */
export const asOf = (now: Date, timeZone?: string): string => tenantLocalIso(now, timeZone);

export function subjectAt(identity: Identity, now: Date): PolicySubject {
  return { ...identity.subject, asOf: asOf(now, identity.tenant.timeZone) };
}

export async function findCase(tx: Tx, ref: string): Promise<CaseRecord | undefined> {
  return tx
    .selectFrom('platform.workflow_case')
    .selectAll()
    .where(isUuid(ref) ? 'id' : 'display_key', '=', ref)
    .executeTakeFirst() as Promise<CaseRecord | undefined>;
}

export async function caseById(tx: Tx, id: string): Promise<CaseRecord> {
  const c = await findCase(tx, id);
  if (!c) throw notFound();
  return c;
}

export const caseFacts = (c: CaseRecord) => ({
  id: c.id,
  businessUnitId: c.business_unit_id,
  ownerUserId: c.owner_user_id,
  sponsorUserId: c.sponsor_user_id,
});

export const canRead = (identity: Identity, c: CaseRecord): boolean =>
  canReadCase(identity.subject, caseFacts(c));

/** The case if the caller may read it, else 404 (other tenants' rows are invisible through RLS). */
export async function readableCase(tx: Tx, identity: Identity, ref: string): Promise<CaseRecord> {
  const c = await findCase(tx, ref);
  if (!c || !canRead(identity, c)) throw notFound();
  return c;
}

export function caseResource(
  c: CaseRecord,
  facts: ResourceRef['facts'] = {},
  type: ResourceRef['type'] = 'case',
): ResourceRef {
  return {
    type,
    id: c.id,
    businessUnitId: c.business_unit_id,
    caseId: c.id,
    facts: { caseOwnerId: c.owner_user_id, sponsorId: c.sponsor_user_id, ...facts },
  };
}

/**
 * Case-scoped decision: visibility first (NOT_FOUND), then the WS3 policy for the action. The role
 * recorded on audit and analytics is the first in-scope role granting the action.
 */
export function authorizeOnCase(
  identity: Identity,
  now: Date,
  c: CaseRecord,
  action: Action,
  facts: ResourceRef['facts'] = {},
): Authorization {
  if (!canRead(identity, c))
    return { allow: false, rule: 'case.read', code: 'NOT_FOUND', reason: 'Not found' };
  const d = policy.check(subjectAt(identity, now), action, caseResource(c, facts));
  if (!d.allow) return { allow: false, rule: d.rule, code: d.code, reason: d.reason };
  return {
    allow: true,
    rule: d.rule,
    authorityGrantId: d.authorityGrantId,
    role: matchingRole(identity.subject, action, { businessUnitId: c.business_unit_id, caseId: c.id }),
  };
}

/** Allow when ANY of the actions is allowed (first allowed wins); otherwise the first denial. */
export function authorizeAny(
  identity: Identity,
  now: Date,
  c: CaseRecord,
  actions: readonly Action[],
  facts: ResourceRef['facts'] = {},
): Authorization {
  let first: Authorization | null = null;
  for (const a of actions) {
    const d = authorizeOnCase(identity, now, c, a, facts);
    if (d.allow) return d;
    first ??= d;
  }
  return first!;
}

/** Read access to a case, with the reading role for audit. */
export function readDecision(identity: Identity, c: CaseRecord): Authorization {
  return canRead(identity, c)
    ? {
        allow: true,
        rule: 'case.read',
        authorityGrantId: null,
        role: matchingRole(identity.subject, 'case.read', {
          businessUnitId: c.business_unit_id,
          caseId: c.id,
        }),
      }
    : { allow: false, rule: 'case.read', code: 'NOT_FOUND', reason: 'Not found' };
}

/** A named person: allow only that user (on a visible case). */
export function allowSelf(
  identity: Identity,
  c: CaseRecord,
  userId: string | null,
  reason: string,
): Authorization {
  if (!canRead(identity, c))
    return { allow: false, rule: 'case.read', code: 'NOT_FOUND', reason: 'Not found' };
  if (userId !== null && identity.user.id === userId)
    return { allow: true, rule: 'self', authorityGrantId: null, role: firstRoleOnCase(identity, c) };
  return { allow: false, rule: 'self', code: 'FORBIDDEN', reason };
}

export function firstRoleOnCase(identity: Identity, c: CaseRecord): RoleCode | null {
  return matchingRole(identity.subject, 'case.read', { businessUnitId: c.business_unit_id, caseId: c.id });
}

export async function peopleMap(
  tx: Tx,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === 'string'))];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .selectFrom('platform.app_user')
    .select(['id', 'display_name', 'title', 'initials'])
    .where('id', 'in', unique)
    .execute();
  return new Map(rows.map((r) => [r.id, personRef(r)]));
}

/** PersonRef for an id that must exist (falls back to a neutral reference, never throws in serializers). */
export function who(map: Map<string, PersonRef>, id: string): PersonRef {
  return map.get(id) ?? { id, displayName: 'Unknown person', title: null, initials: '?' };
}

/** Assert a user id is an active human in this tenant (owner pickers). */
export async function assertHuman(tx: Tx, userId: string, field: string): Promise<void> {
  const u = await tx
    .selectFrom('platform.app_user')
    .select(['kind', 'is_active'])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!u || u.kind !== 'human' || !u.is_active)
    throw new ApiError('VALIDATION_FAILED', 'Choose a person in this workspace.', {
      errors: [{ path: field, code: 'invalid_person', message: 'Not a person in this workspace' }],
    });
}

export function toWorkflowCase(c: CaseRecord, people: Map<string, PersonRef>): WorkflowCase {
  return {
    id: c.id,
    key: c.display_key,
    appType: c.app_type as WorkflowCase['appType'],
    title: c.title,
    businessUnitId: c.business_unit_id,
    mandateId: c.mandate_id ?? c.id,
    owner: who(people, c.owner_user_id),
    sponsor: who(people, c.sponsor_user_id),
    stage: c.stage as CaseStage,
    heldFromStage: (c.held_from_stage as CaseStage | null) ?? null,
    originType: c.origin_type as WorkflowCase['originType'],
    originId: c.origin_id,
    rowVersion: c.row_version,
    createdAt: isoDateTime(c.created_at),
    updatedAt: isoDateTime(c.updated_at),
  };
}

export async function serializeCase(tx: Tx, c: CaseRecord): Promise<WorkflowCase> {
  return toWorkflowCase(c, await peopleMap(tx, [c.owner_user_id, c.sponsor_user_id]));
}

/** Map a refused machine transition to problem+json (D-046): first failure decides the code. */
export function machineRefusal(r: {
  code: string;
  failed: { key: string; message?: string }[];
  reasons: string[];
}): ApiError {
  return new ApiError(r.code as ConstructorParameters<typeof ApiError>[0], r.reasons[0] ?? 'Not possible', {
    blockers: r.failed.map((f) => ({ key: f.key, message: f.message ?? f.key })),
  });
}

/** Display a decimal string without trailing fraction zeros ("0.20000000" → "0.2"). Text only. */
export function trimDecimal(v: string): string {
  if (!v.includes('.')) return v;
  const t = v.replace(/0+$/, '').replace(/\.$/, '');
  return t === '-0' ? '0' : t;
}

/** Money amounts keep two fraction digits ("20000.00000000" → "20000.00"). Text only, no arithmetic. */
export function moneyString(v: string): string {
  const t = trimDecimal(v);
  const [i, f = ''] = t.split('.');
  return `${i}.${(f + '00').slice(0, Math.max(2, f.length))}`;
}

const CURRENCY_SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

/**
 * Compact money label for captions and button labels ("€120k", "€2.4m"). Display formatting of a
 * stored amount only; never used for calculation.
 */
export function moneyLabel(amount: string | null, currency: string | null): string {
  if (amount === null || currency === null) return `${CURRENCY_SYMBOL[currency ?? ''] ?? ''}[cap]`;
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const n = Number(amount);
  if (Math.abs(n) >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(1)}m`;
  if (Math.abs(n) >= 1_000) return `${sym}${Math.round(n / 1_000)}k`;
  return `${sym}${trimDecimal(amount)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "27 Nov" in the tenant's calendar. */
export function shortDate(at: Date | string): string {
  const iso = typeof at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : tenantLocalIso(new Date(at));
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

export const caseHref = (key: string, tab = '') => `/me/cases/${key}${tab ? `/${tab}` : ''}`;
