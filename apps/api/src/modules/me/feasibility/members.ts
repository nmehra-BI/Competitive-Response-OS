/**
 * Case membership for the S07 named-reviewer picker (D-112 §4): an active person with a role that reaches
 * the case (tenant-wide, the case's business unit, or the case itself), a recorded participant, or the
 * case owner or sponsor. Tenant administrators configure and are never reviewers (never-rule 6).
 * Same rule as `cases.members`.
 */
import { ROLE_ACTIONS } from '@growth-os/domain';
import type { RoleCode } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';

export async function isCaseMember(
  tx: Tx,
  c: { id: string; business_unit_id: string; owner_user_id: string; sponsor_user_id: string },
  userId: string,
): Promise<boolean> {
  const u = await tx
    .selectFrom('platform.app_user')
    .select(['kind', 'is_active'])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!u || u.kind !== 'human' || !u.is_active) return false;
  if (userId === c.owner_user_id || userId === c.sponsor_user_id) return true;
  const roles = await tx
    .selectFrom('platform.role_assignment')
    .select(['role', 'business_unit_id', 'case_id'])
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute();
  const reaches = roles.some(
    (r) =>
      r.role !== 'tenant_admin' &&
      ROLE_ACTIONS[r.role as RoleCode].includes('case.read') &&
      (r.business_unit_id === null || r.business_unit_id === c.business_unit_id) &&
      (r.case_id === null || r.case_id === c.id),
  );
  if (reaches) return true;
  const part = await tx
    .selectFrom('platform.case_participant')
    .select('user_id')
    .where('case_id', '=', c.id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return !!part;
}
