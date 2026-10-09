/**
 * Identity loading: the user, tenant, active roles, delegated authority and case participation of
 * the session principal, read inside the tenant transaction (RLS applies).
 */
import type { Tx } from '@growth-os/db';
import type { AuthorityGrant, RoleAssignment, RoleCode, Viewer } from '@growth-os/contracts';
import type { Actor } from '@growth-os/domain';
import type { Identity, SessionRef } from './context';
import { isoDate, isoDateTime, isoDateTimeOrNull, personRef } from './serialize';

export async function loadIdentity(tx: Tx, session: SessionRef): Promise<Identity | null> {
  const [user, tenant, sessionRow] = await Promise.all([
    tx.selectFrom('platform.app_user').selectAll().where('id', '=', session.userId).executeTakeFirst(),
    tx.selectFrom('platform.tenant').selectAll().where('id', '=', session.tenantId).executeTakeFirst(),
    tx
      .selectFrom('platform.session')
      .select(['interactive'])
      .where('id', '=', session.sessionId)
      .executeTakeFirst(),
  ]);
  if (!user || !tenant || !sessionRow || !user.is_active) return null;

  const [roleRows, grantRows, participantRows] = await Promise.all([
    tx
      .selectFrom('platform.role_assignment')
      .selectAll()
      .where('user_id', '=', user.id)
      .where('revoked_at', 'is', null)
      .orderBy('granted_at')
      .execute(),
    tx
      .selectFrom('platform.authority_grant')
      .selectAll()
      .where('user_id', '=', user.id)
      .where('revoked_at', 'is', null)
      .orderBy('created_at')
      .execute(),
    tx
      .selectFrom('platform.workflow_case')
      .select('id')
      .where((eb) =>
        eb.or([
          eb('owner_user_id', '=', user.id),
          eb('sponsor_user_id', '=', user.id),
          eb(
            'id',
            'in',
            eb.selectFrom('platform.case_participant').select('case_id').where('user_id', '=', user.id),
          ),
        ]),
      )
      .execute(),
  ]);

  const roles: RoleAssignment[] = roleRows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    role: r.role as RoleCode,
    businessUnitId: r.business_unit_id,
    caseId: r.case_id,
    grantedBy: r.granted_by,
    grantedAt: isoDateTime(r.granted_at),
    revokedAt: isoDateTimeOrNull(r.revoked_at),
  }));
  const authority: AuthorityGrant[] = grantRows.map((g) => ({
    id: g.id,
    userId: g.user_id,
    gateCode: g.gate_code as AuthorityGrant['gateCode'],
    businessUnitId: g.business_unit_id,
    ceilingAmount: g.ceiling_amount,
    currency: g.currency,
    validFrom: isoDate(g.valid_from),
    validTo: g.valid_to === null ? null : isoDate(g.valid_to),
    grantedBy: g.granted_by,
    revokedAt: isoDateTimeOrNull(g.revoked_at),
  }));

  const kind = user.kind as Identity['kind'];
  const interactive = sessionRow.interactive && kind === 'human';
  const actor: Actor =
    kind === 'human'
      ? { kind: 'human', userId: user.id, interactive }
      : kind === 'agent'
        ? { kind: 'agent', userId: user.id }
        : { kind: 'service', userId: user.id };
  const participantOfCaseIds = participantRows.map((p) => p.id);

  return {
    session,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      title: user.title,
      kind,
      isActive: user.is_active,
      initials: user.initials,
    },
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      dataResidency: tenant.data_residency,
      illustrative: tenant.illustrative,
      timeZone: tenant.time_zone,
    },
    kind,
    interactive,
    roles,
    authority,
    participantOfCaseIds,
    actor,
    subject: { actor, roles, authority, participantOfCaseIds },
  };
}

/**
 * Role-based landing route (research §8.2). Order matters for people with several roles: the first
 * matching role wins. Values match the Aster personas in fixtures/aster/src/org.ts.
 */
const LANDING_BY_ROLE: readonly [RoleCode, string][] = [
  ['sponsor', '/reviews?tab=awaiting'],
  ['investment_committee', '/reviews?tab=awaiting'],
  ['case_owner', '/me/overview?view=operator'],
  ['finance_reviewer', '/reviews?tab=economics'],
  ['pilot_owner', '/my-work'],
  ['product_reviewer', '/reviews?tab=assigned'],
  ['specialist_reviewer', '/reviews?tab=assigned'],
  ['commercial_reviewer', '/reviews?tab=assigned'],
  ['read_only_reviewer', '/me/overview'],
  ['tenant_admin', '/admin/health'],
];

export function landingFor(roles: readonly RoleAssignment[]): string {
  for (const [role, route] of LANDING_BY_ROLE) if (roles.some((r) => r.role === role)) return route;
  return '/me/overview';
}

export function toViewer(id: Identity): Viewer {
  return {
    user: {
      id: id.user.id,
      email: id.user.email,
      displayName: id.user.displayName,
      title: id.user.title,
      kind: id.user.kind,
      isActive: id.user.isActive,
    },
    person: personRef({
      id: id.user.id,
      display_name: id.user.displayName,
      title: id.user.title,
      initials: id.user.initials,
    }),
    tenant: id.tenant,
    roles: id.roles,
    authority: id.authority,
    landing: landingFor(id.roles),
    isAdmin: id.roles.some((r) => r.role === 'tenant_admin'),
  };
}
