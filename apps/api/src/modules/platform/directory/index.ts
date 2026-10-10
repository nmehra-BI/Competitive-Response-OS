/**
 * Directory (D-068 §12, D-079): `people.list` — the people a picker outside a case may name (mandate
 * owner, case owner on convert, names on Administration). Active human principals with at least one
 * unrevoked role; never agents or services. A tenant administrator is listed with the admin role only
 * (it grants no case or decision role). Readable by any person who holds a role in the tenant.
 */
import { API, type DirectoryPerson, type RoleCode } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import type { Authorization, Identity } from '../../../platform/context';
import { notFound } from '../../../platform/errors';
import { query, type HandlerMap } from '../../../platform/pipeline';
import { personRef } from '../../../platform/serialize';

/** Any person with an active role in the tenant may read the directory; agents and services never. */
export function directoryReader(identity: Identity, rule: string): Authorization {
  if (identity.kind !== 'human')
    return {
      allow: false,
      rule,
      code: 'AGENT_IDENTITY_FORBIDDEN',
      reason: 'Only people can read the directory.',
    };
  const role = identity.roles.find((r) => !r.revokedAt)?.role ?? null;
  return role
    ? { allow: true, rule, authorityGrantId: null, role }
    : { allow: false, rule, code: 'FORBIDDEN', reason: 'You have no role in this workspace.' };
}

/** 404 for a business unit that is not this tenant's (RLS hides other tenants' rows). */
export async function businessUnitOr404(tx: Tx, id: string | undefined): Promise<void> {
  if (!id) return;
  const bu = await tx
    .selectFrom('platform.business_unit')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  if (!bu) throw notFound();
}

export const directoryHandlers: HandlerMap = {
  [API.directory.people.id]: query(API.directory.people, {
    load: (ctx, tx) => businessUnitOr404(tx, ctx.query.businessUnitId),
    authorize: (ctx) => directoryReader(ctx.identity, 'directory.people'),
    handle: async (ctx, { tx }) => {
      const rows = await tx
        .selectFrom('platform.role_assignment as r')
        .innerJoin('platform.app_user as u', 'u.id', 'r.user_id')
        .leftJoin('platform.workflow_case as c', 'c.id', 'r.case_id')
        .select([
          'u.id',
          'u.display_name',
          'u.title',
          'u.initials',
          'r.role',
          'r.business_unit_id',
          'c.business_unit_id as case_bu',
          'r.case_id',
        ])
        .where('u.kind', '=', 'human')
        .where('u.is_active', '=', true)
        .where('r.revoked_at', 'is', null)
        .orderBy('u.display_name')
        .orderBy('u.id')
        .execute();
      const people = new Map<
        string,
        { person: DirectoryPerson; tenantWide: boolean; bus: Set<string>; roles: Set<RoleCode> }
      >();
      for (const r of rows) {
        const p =
          people.get(r.id) ??
          people
            .set(r.id, {
              person: { ...personRef(r), roles: [], businessUnitIds: [] },
              tenantWide: false,
              bus: new Set(),
              roles: new Set(),
            })
            .get(r.id)!;
        p.roles.add(r.role as RoleCode);
        const bu = r.business_unit_id ?? r.case_bu;
        if (bu) p.bus.add(bu);
        else if (!r.case_id) p.tenantWide = true;
      }
      const { businessUnitId, role } = ctx.query;
      const items: DirectoryPerson[] = [];
      for (const p of people.values()) {
        if (role && !p.roles.has(role)) continue;
        if (businessUnitId && !p.tenantWide && !p.bus.has(businessUnitId)) continue;
        items.push({
          ...p.person,
          roles: [...p.roles].sort(),
          // Empty = every business unit (a tenant-wide role), as the contract states.
          businessUnitIds: p.tenantWide ? [] : [...p.bus].sort(),
        });
      }
      items.sort((x, y) => x.displayName.localeCompare(y.displayName) || x.id.localeCompare(y.id));
      return { items };
    },
  }),
};
