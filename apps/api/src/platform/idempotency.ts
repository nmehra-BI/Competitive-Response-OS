/**
 * Idempotency-Key store (API.md §3, D-028) on platform.idempotency_record, per (tenant, user, key).
 *
 *   begin     own short transaction, committed before the business transaction starts, so a
 *             concurrent duplicate sees `in_progress` (409 IDEMPOTENCY_IN_PROGRESS).
 *   complete  inside the business transaction: the stored response commits with the change.
 *   release   after a failed request: the key is freed so the same user intent can be retried.
 *
 * Same key + same request hash after success → the stored response is replayed.
 * Same key + different request hash → 422 IDEMPOTENCY_KEY_REUSED.
 * An `in_progress` row older than the lease (a crashed request) can be taken over.
 */
import { sql, withTenant, type Db, type Tx } from '@growth-os/db';

export const IN_PROGRESS_LEASE_MS = 2 * 60 * 1000;

export interface IdempotencyScope {
  tenantId: string;
  userId: string;
  key: string;
}

export type BeginResult =
  | { kind: 'new' }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'in_progress' }
  | { kind: 'reused' };

export async function beginIdempotent(
  db: Db,
  s: IdempotencyScope & { method: string; route: string; requestHash: string; correlationId: string },
  now: Date,
  ttlMs: number,
): Promise<BeginResult> {
  return withTenant(
    db,
    { tenantId: s.tenantId, userId: s.userId, correlationId: s.correlationId },
    async (tx) => {
      const inserted = await tx
        .insertInto('platform.idempotency_record')
        .values({
          tenant_id: s.tenantId,
          user_id: s.userId,
          key: s.key,
          method: s.method,
          route: s.route,
          request_hash: s.requestHash,
          status: 'in_progress',
          created_at: now,
          expires_at: new Date(now.getTime() + ttlMs),
        })
        .onConflict((oc) => oc.columns(['tenant_id', 'user_id', 'key']).doNothing())
        .returning('key')
        .executeTakeFirst();
      if (inserted) return { kind: 'new' };

      const row = await tx
        .selectFrom('platform.idempotency_record')
        .selectAll()
        .where('tenant_id', '=', s.tenantId)
        .where('user_id', '=', s.userId)
        .where('key', '=', s.key)
        .forUpdate()
        .executeTakeFirstOrThrow();

      const expired = row.expires_at.getTime() <= now.getTime();
      const abandoned =
        row.status === 'in_progress' && row.created_at.getTime() <= now.getTime() - IN_PROGRESS_LEASE_MS;
      if (expired || abandoned) {
        await tx
          .updateTable('platform.idempotency_record')
          .set({
            method: s.method,
            route: s.route,
            request_hash: s.requestHash,
            status: 'in_progress',
            response_status: null,
            response_body: null,
            created_at: now,
            expires_at: new Date(now.getTime() + ttlMs),
          })
          .where('tenant_id', '=', s.tenantId)
          .where('user_id', '=', s.userId)
          .where('key', '=', s.key)
          .execute();
        return { kind: 'new' };
      }
      if (row.request_hash !== s.requestHash || row.route !== s.route || row.method !== s.method)
        return { kind: 'reused' };
      if (row.status === 'in_progress') return { kind: 'in_progress' };
      return { kind: 'replay', status: row.response_status ?? 200, body: row.response_body };
    },
  );
}

/** Store the response in the business transaction, so it exists iff the change committed. */
export async function completeIdempotent(
  tx: Tx,
  s: IdempotencyScope,
  status: number,
  body: unknown,
): Promise<void> {
  await tx
    .updateTable('platform.idempotency_record')
    .set({
      status: 'completed',
      response_status: status,
      response_body: body === undefined ? null : JSON.stringify(body),
    })
    .where('tenant_id', '=', s.tenantId)
    .where('user_id', '=', s.userId)
    .where('key', '=', s.key)
    .execute();
}

export async function releaseIdempotent(db: Db, s: IdempotencyScope, correlationId: string): Promise<void> {
  await withTenant(db, { tenantId: s.tenantId, userId: s.userId, correlationId }, async (tx) => {
    await tx
      .deleteFrom('platform.idempotency_record')
      .where('tenant_id', '=', s.tenantId)
      .where('user_id', '=', s.userId)
      .where('key', '=', s.key)
      .where('status', '=', 'in_progress')
      .execute();
  });
}

/** Housekeeping: drop expired records for one tenant (called by a worker or tests). */
export async function purgeExpiredIdempotency(tx: Tx): Promise<number> {
  const r = await tx
    .deleteFrom('platform.idempotency_record')
    .where('expires_at', '<=', sql<Date>`now()`)
    .executeTakeFirst();
  return Number(r.numDeletedRows);
}
