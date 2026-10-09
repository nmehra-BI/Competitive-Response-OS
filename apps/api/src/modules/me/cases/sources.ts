/**
 * Source chips beside claims, ledger inputs and opportunities. Chips carry metadata only (key, a short
 * title, date); restricted sources (licence none / restricted / deleted) are flagged and never carry text
 * from the source itself.
 */
import type { EvidenceQuality, SourceChip } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import type { Identity } from '../../../platform/context';
import { effectiveAccess, entitlementsFor } from '../../../platform/entitlements';
import { shortDate } from './access';

const QUALITY_BY_ORIGIN: Record<string, EvidenceQuality> = {
  licensed: 'strong',
  authorized_upload: 'some',
  internal_system: 'some',
  public_web: 'weak',
};

export async function sourceChips(
  tx: Tx,
  identity: Identity,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, SourceChip>> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === 'string'))];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .selectFrom('platform.source')
    .select(['id', 'display_key', 'title', 'published_on', 'origin_kind', 'availability', 'deleted_at', 'license_id'])
    .where('id', 'in', unique)
    .execute();
  const ent = await entitlementsFor(
    tx,
    identity,
    rows.map((r) => r.license_id),
  );
  const out = new Map<string, SourceChip>();
  for (const r of rows) {
    const access = effectiveAccess(ent.get(r.license_id) ?? 'none', r);
    const restricted = r.availability !== 'available' || r.deleted_at !== null || access === 'none';
    const short = r.title.split(',')[0]!.slice(0, 60);
    out.set(r.id, {
      sourceId: r.id,
      key: r.display_key,
      label: restricted
        ? `${r.display_key} · restricted`
        : `${short}${r.published_on ? ` · ${shortDate(String(r.published_on))}` : ''}`,
      quality: restricted ? 'none' : (QUALITY_BY_ORIGIN[r.origin_kind] ?? 'some'),
      restricted,
    });
  }
  return out;
}

export function chipsFor(map: Map<string, SourceChip>, ids: readonly (string | null | undefined)[]): SourceChip[] {
  return ids.flatMap((id) => (id && map.has(id) ? [map.get(id)!] : []));
}
