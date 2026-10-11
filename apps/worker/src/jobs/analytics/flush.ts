/**
 * analytics.flush (every minute). Analytics events are written by the API in the business
 * transaction with `emitted_at = NULL` — the table is the analytics outbox. This job delivers them
 * to the sink and stamps `emitted_at`. Dev/pilot sink: the table itself (no third-party tracker),
 * plus a count in the worker log. Only the worker role may set emitted_at (0001 grants).
 */
import { sql, withTenant, type Db } from '@growth-os/db';

export interface AnalyticsSink {
  deliver(
    tenantId: string,
    events: readonly { id: string; name: string; envelope: unknown; props: unknown }[],
  ): Promise<void>;
}

/** The pilot sink keeps events in platform.analytics_event (read by reporting); nothing leaves the system. */
export const tableSink: AnalyticsSink = { deliver: async () => undefined };

export async function flushAnalytics(
  db: Db,
  tenantId: string,
  now: Date,
  correlationId: string,
  sink: AnalyticsSink = tableSink,
  batch = 500,
): Promise<number> {
  return withTenant(db, { tenantId, userId: null, correlationId }, async (tx) => {
    const rows = await tx
      .selectFrom('platform.analytics_event')
      .select(['id', 'name', 'envelope', 'props'])
      .where('emitted_at', 'is', null)
      .orderBy('occurred_at')
      .limit(batch)
      .forUpdate()
      .skipLocked()
      .execute();
    if (rows.length === 0) return 0;
    await sink.deliver(tenantId, rows);
    await tx
      .updateTable('platform.analytics_event')
      .set({ emitted_at: now })
      .where(
        'id',
        'in',
        rows.map((r) => r.id),
      )
      .where('emitted_at', 'is', null)
      .execute();
    return rows.length;
  });
}

export async function pendingAnalytics(db: Db, tenantId: string): Promise<number> {
  return withTenant(db, { tenantId, userId: null, correlationId: 'analytics.pending' }, async (tx) => {
    const r = await sql<{
      n: string;
    }>`SELECT count(*)::text AS n FROM platform.analytics_event WHERE emitted_at IS NULL`.execute(tx);
    return Number(r.rows[0]!.n);
  });
}
