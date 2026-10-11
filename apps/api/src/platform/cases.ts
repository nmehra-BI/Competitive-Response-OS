/**
 * Case references (API.md §1): `caseRef` accepts a UUID or the display key (ME-104). Resolution
 * runs under RLS, so another tenant's case is simply not found. Callers then apply `caseVisible`.
 */
import type { Tx } from '@growth-os/db';
import type { CaseFacts } from './authz';

export interface CaseRow extends CaseFacts {
  key: string;
  title: string;
  stage: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (ref: string): boolean => UUID.test(ref);

export async function resolveCase(tx: Tx, ref: string): Promise<CaseRow | null> {
  const row = await tx
    .selectFrom('platform.workflow_case')
    .select(['id', 'display_key', 'title', 'stage', 'business_unit_id', 'owner_user_id', 'sponsor_user_id'])
    .where(isUuid(ref) ? 'id' : 'display_key', '=', ref)
    .executeTakeFirst();
  return row
    ? {
        id: row.id,
        key: row.display_key,
        title: row.title,
        stage: row.stage,
        businessUnitId: row.business_unit_id,
        ownerUserId: row.owner_user_id,
        sponsorUserId: row.sponsor_user_id,
      }
    : null;
}

export async function casesByIds(tx: Tx, ids: readonly string[]): Promise<CaseRow[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .selectFrom('platform.workflow_case')
    .select(['id', 'display_key', 'title', 'stage', 'business_unit_id', 'owner_user_id', 'sponsor_user_id'])
    .where('id', 'in', [...new Set(ids)])
    .execute();
  return rows.map((row) => ({
    id: row.id,
    key: row.display_key,
    title: row.title,
    stage: row.stage,
    businessUnitId: row.business_unit_id,
    ownerUserId: row.owner_user_id,
    sponsorUserId: row.sponsor_user_id,
  }));
}
