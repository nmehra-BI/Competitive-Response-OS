/**
 * Licence entitlements (ARCHITECTURE.md §11, never-rule 8). Every read of source CONTENT (excerpts,
 * search, export, model context) asks `entitlementFor`. Resolution, most specific first:
 *
 *   1. user rows        (principal_type 'user', principal = user id)
 *   2. role rows        (principal = a role the user holds)
 *   3. 'case_member'    (any role that can read cases)
 *   4. '*'              (everyone)
 *   5. nothing matched → 'none' (fail closed)
 *
 * Within one level the most permissive row wins. Agents and services resolve to 'none' here; the
 * analysis tool gateway (WS5) applies its own licence + run-scope check.
 */
import type { Tx } from '@growth-os/db';
import type { EntitlementAccess } from '@growth-os/contracts';
import { ROLE_ACTIONS } from '@growth-os/domain';
import type { Identity } from './context';

const RANK: Record<EntitlementAccess, number> = { none: 0, aggregate_only: 1, excerpt: 2 };

export interface EntitlementRow {
  license_id: string;
  principal_type: string;
  principal: string;
  access: string;
}

export function resolveEntitlement(rows: readonly EntitlementRow[], identity: Identity): EntitlementAccess {
  if (identity.kind !== 'human') return 'none';
  const roles = new Set(identity.roles.filter((r) => !r.revokedAt).map((r) => r.role));
  const caseMember = [...roles].some((r) => ROLE_ACTIONS[r].includes('case.read'));
  const levels: ((r: EntitlementRow) => boolean)[] = [
    (r) => r.principal_type === 'user' && r.principal === identity.user.id,
    (r) => r.principal_type === 'role' && roles.has(r.principal as never),
    (r) => r.principal_type === 'role' && r.principal === 'case_member' && caseMember,
    (r) => r.principal_type === 'role' && r.principal === '*',
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

/** Entitlements for many licences at once (lists, search). Missing licence → 'none'. */
export async function entitlementsFor(
  tx: Tx,
  identity: Identity,
  licenseIds: readonly (string | null)[],
): Promise<Map<string | null, EntitlementAccess>> {
  const ids = [...new Set(licenseIds.filter((x): x is string => x !== null))];
  const rows = ids.length
    ? await tx
        .selectFrom('platform.source_entitlement')
        .select(['license_id', 'principal_type', 'principal', 'access'])
        .where('license_id', 'in', ids)
        .execute()
    : [];
  const out = new Map<string | null, EntitlementAccess>([[null, 'none']]);
  for (const id of ids)
    out.set(
      id,
      resolveEntitlement(
        rows.filter((r) => r.license_id === id),
        identity,
      ),
    );
  return out;
}

export async function entitlementFor(
  tx: Tx,
  identity: Identity,
  licenseId: string | null,
): Promise<EntitlementAccess> {
  return (await entitlementsFor(tx, identity, [licenseId])).get(licenseId) ?? 'none';
}

/**
 * Effective content access for one source: the licence entitlement, reduced to 'none' when the
 * source itself is restricted or gone (deleted by the provider, unavailable).
 */
export function effectiveAccess(
  licenceAccess: EntitlementAccess,
  source: { availability: string; deleted_at: Date | string | null },
): EntitlementAccess {
  if (source.deleted_at !== null || source.availability === 'deleted_by_provider') return 'none';
  if (source.availability === 'restricted' && licenceAccess === 'excerpt') return 'aggregate_only';
  return licenceAccess;
}
