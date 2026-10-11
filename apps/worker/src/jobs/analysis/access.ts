/**
 * The requesting human's access, re-read on every tool call (the agent never has more access than the
 * person it acts for). Same semantics as the API's `canReadCase`, `resolveEntitlement` and
 * `effectiveAccess` (apps/api/src/platform), re-stated here because the worker must not import the API
 * app (CR-WS5-1 proposes moving them to a shared package).
 *
 *  - Case visibility: a role with `case.read` in the case's business unit (or on the case), or owner,
 *    sponsor or listed participant. Mandates: a `case.read` role in the mandate's business unit.
 *  - Licence entitlement: user rows › role rows › `case_member` › `*` › none (fail closed); most
 *    permissive within a level. Restricted sources reduce excerpt to aggregate-only; deleted → none.
 *  - Model context: excerpts reach the model only when the licence allows model context.
 *  - A source used only by cases the requester cannot read is hidden (not found), never counted.
 */
import type { EntitlementAccess, RoleCode } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { ROLE_ACTIONS } from '@growth-os/domain';

export interface Requester {
  userId: string;
  kind: 'human' | 'service' | 'agent';
  active: boolean;
  roles: { role: RoleCode; businessUnitId: string | null; caseId: string | null }[];
  participantCaseIds: string[];
}

export interface CaseFacts {
  id: string;
  businessUnitId: string;
  ownerUserId: string;
  sponsorUserId: string;
}

export async function loadRequester(tx: Tx, userId: string): Promise<Requester | null> {
  const user = await tx
    .selectFrom('platform.app_user')
    .select(['id', 'kind', 'is_active'])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!user) return null;
  const [roles, participant] = await Promise.all([
    tx
      .selectFrom('platform.role_assignment')
      .select(['role', 'business_unit_id', 'case_id'])
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute(),
    tx.selectFrom('platform.case_participant').select('case_id').where('user_id', '=', userId).execute(),
  ]);
  return {
    userId,
    kind: user.kind as Requester['kind'],
    active: user.is_active,
    roles: roles.map((r) => ({
      role: r.role as RoleCode,
      businessUnitId: r.business_unit_id,
      caseId: r.case_id,
    })),
    participantCaseIds: participant.map((p) => p.case_id),
  };
}

const readsIn = (r: Requester, businessUnitId: string | null, caseId: string | null) =>
  r.roles.some(
    (ra) =>
      ROLE_ACTIONS[ra.role].includes('case.read') &&
      (ra.businessUnitId === null || businessUnitId === null || ra.businessUnitId === businessUnitId) &&
      (ra.caseId === null || ra.caseId === caseId),
  );

export function canReadCase(r: Requester, c: CaseFacts): boolean {
  if (r.kind !== 'human' || !r.active) return false;
  if (readsIn(r, c.businessUnitId, c.id)) return true;
  return c.ownerUserId === r.userId || c.sponsorUserId === r.userId || r.participantCaseIds.includes(c.id);
}

export function canReadMandate(r: Requester, m: { businessUnitId: string }): boolean {
  return r.kind === 'human' && r.active && readsIn(r, m.businessUnitId, null);
}

const RANK: Record<EntitlementAccess, number> = { none: 0, aggregate_only: 1, excerpt: 2 };

export function resolveEntitlement(
  rows: readonly { principal_type: string; principal: string; access: string }[],
  r: Requester,
): EntitlementAccess {
  if (r.kind !== 'human' || !r.active) return 'none';
  const roles = new Set(r.roles.map((x) => x.role as string));
  const caseMember = r.roles.some((x) => ROLE_ACTIONS[x.role].includes('case.read'));
  const levels: ((row: (typeof rows)[number]) => boolean)[] = [
    (row) => row.principal_type === 'user' && row.principal === r.userId,
    (row) => row.principal_type === 'role' && roles.has(row.principal),
    (row) => row.principal_type === 'role' && row.principal === 'case_member' && caseMember,
    (row) => row.principal_type === 'role' && row.principal === '*',
  ];
  for (const match of levels) {
    const hits = rows.filter(match);
    if (hits.length > 0)
      return hits
        .map((h) => h.access as EntitlementAccess)
        .reduce((best, a) => (RANK[a] > RANK[best] ? a : best), 'none' as EntitlementAccess);
  }
  return 'none';
}

export function effectiveAccess(
  licence: EntitlementAccess,
  source: { availability: string; deleted_at: Date | string | null },
): EntitlementAccess {
  if (source.deleted_at !== null || source.availability === 'deleted_by_provider') return 'none';
  if (source.availability === 'restricted' && licence === 'excerpt') return 'aggregate_only';
  return licence;
}

/** Case ids that use each source (sizing inputs, cohorts, claims, converted opportunities, observations). */
export async function caseIdsBySource(tx: Tx, sourceIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (sourceIds.length === 0) return out;
  const ids = [...new Set(sourceIds)];
  const [inputs, cohorts, claims, opps, obs] = await Promise.all([
    tx
      .selectFrom('me.sizing_input as i')
      .innerJoin('me.sizing_version as v', 'v.id', 'i.sizing_version_id')
      .select(['i.source_id as sid', 'v.case_id as cid'])
      .where('i.source_id', 'in', ids)
      .execute(),
    tx
      .selectFrom('me.cohort as c')
      .innerJoin('me.sizing_version as v', 'v.id', 'c.sizing_version_id')
      .select(['c.source_id as sid', 'v.case_id as cid'])
      .where('c.source_id', 'in', ids)
      .execute(),
    tx
      .selectFrom('platform.claim_evidence_link as l')
      .innerJoin('platform.claim as c', 'c.id', 'l.claim_id')
      .select(['l.source_id as sid', 'c.case_id as cid'])
      .where('l.source_id', 'in', ids)
      .execute(),
    tx
      .selectFrom('me.opportunity_source as os')
      .innerJoin('me.opportunity as o', 'o.id', 'os.opportunity_id')
      .select(['os.source_id as sid', 'o.converted_case_id as cid'])
      .where('os.source_id', 'in', ids)
      .execute(),
    tx
      .selectFrom('platform.outcome_observation')
      .select(['source_id as sid', 'case_id as cid'])
      .where('source_id', 'in', ids)
      .execute(),
  ]);
  for (const row of [...inputs, ...cohorts, ...claims, ...opps, ...obs]) {
    if (!row.sid || !row.cid) continue;
    const list = out.get(row.sid) ?? [];
    if (!list.includes(row.cid)) list.push(row.cid);
    out.set(row.sid, list);
  }
  return out;
}

export async function casesByIds(tx: Tx, ids: readonly string[]): Promise<CaseFacts[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .selectFrom('platform.workflow_case')
    .select(['id', 'business_unit_id', 'owner_user_id', 'sponsor_user_id'])
    .where('id', 'in', [...new Set(ids)])
    .execute();
  return rows.map((r) => ({
    id: r.id,
    businessUnitId: r.business_unit_id,
    ownerUserId: r.owner_user_id,
    sponsorUserId: r.sponsor_user_id,
  }));
}

/** Sources the requester may know exist: not used only by cases they cannot read. */
export async function visibleSourceIds(
  tx: Tx,
  r: Requester,
  sourceIds: readonly string[],
): Promise<Set<string>> {
  const uses = await caseIdsBySource(tx, sourceIds);
  const cases = await casesByIds(tx, [...uses.values()].flat());
  const readable = new Set(cases.filter((c) => canReadCase(r, c)).map((c) => c.id));
  return new Set(
    sourceIds.filter((id) => {
      const used = uses.get(id) ?? [];
      return used.length === 0 || used.some((c) => readable.has(c));
    }),
  );
}
