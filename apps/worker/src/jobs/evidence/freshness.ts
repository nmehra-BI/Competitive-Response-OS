/**
 * evidence.freshness (daily, ARCHITECTURE.md §11). Moves sources from Current to Ageing when their
 * age passes the threshold for their origin. Age counts from the publication date (or retrieval
 * when unpublished). Stale and Superseded are human acts (mark stale, replace) because they run the
 * materiality check; this job never sets them and never moves a source back to Current.
 *
 * Thresholds (pilot defaults; Aster: the 2 Sep 2026 trade survey shows "Ageing" at 41 days):
 *   licensed annual editions 365 days · authorized uploads and public web 30 days · internal 90 days
 */
import { auditWriter, sql, withTenant, type Db } from '@growth-os/db';

export const AGEING_AFTER_DAYS: Readonly<Record<string, number>> = {
  licensed: 365,
  authorized_upload: 30,
  public_web: 30,
  internal_system: 90,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function tenantIds(db: Db): Promise<string[]> {
  const r = await sql<{ id: string }>`SELECT platform.list_tenant_ids() AS id`.execute(db);
  return r.rows.map((x) => x.id);
}

export async function recomputeFreshness(
  db: Db,
  tenantId: string,
  now: Date,
  correlationId: string,
): Promise<{ aged: string[] }> {
  return withTenant(db, { tenantId, userId: null, correlationId }, async (tx) => {
    const rows = await tx
      .selectFrom('platform.source')
      .select(['id', 'display_key', 'origin_kind', 'published_on', 'retrieved_at'])
      .where('freshness', '=', 'current')
      .where('deleted_at', 'is', null)
      .execute();
    const aged: string[] = [];
    for (const r of rows) {
      const since = r.published_on ?? r.retrieved_at;
      if (!since) continue;
      const days = Math.floor((now.getTime() - new Date(since).getTime()) / DAY_MS);
      const threshold = AGEING_AFTER_DAYS[r.origin_kind] ?? 30;
      if (days < threshold) continue;
      await tx
        .updateTable('platform.source')
        .set({ freshness: 'ageing' })
        .where('id', '=', r.id)
        .where('freshness', '=', 'current')
        .execute();
      await auditWriter.record(tx, {
        actorUserId: null,
        actorKind: 'system',
        actorRole: null,
        action: 'source.freshness_changed',
        objectType: 'source',
        objectId: r.id,
        objectVersion: null,
        caseId: null,
        beforeHash: null,
        afterHash: null,
        summary: `${r.display_key} is ageing (${days} days old)`,
        details: { sourceKey: r.display_key, from: 'current', to: 'ageing', days, threshold },
        authz: { decision: 'allow', rule: 'worker:evidence.freshness', authorityGrantId: null },
        occurredAt: now,
      });
      aged.push(r.display_key);
    }
    return { aged };
  });
}
