/**
 * @growth-os/db — typed Postgres access with tenant context.
 *
 * Rule: application code never queries outside `withTenant`. It opens a transaction and sets
 * app.tenant_id / app.user_id / app.correlation_id with SET LOCAL, so RLS applies to every
 * statement and the settings cannot leak to another request on a pooled connection.
 */
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { DB } from './generated/db';
import { DB_URLS } from './config';

export type { DB } from './generated/db';
export { DB_URLS } from './config';
export { sql };

export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;

// Return numeric and bigint columns as strings: money never passes through a JS float (D-010).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);
// Keep dates as ISO strings (YYYY-MM-DD) rather than local-time Date objects.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export function createDb(role: 'app' | 'worker' | 'owner' = 'app', max = 10): Db {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: DB_URLS[role], max }) }),
  });
}

export interface TenantContext {
  tenantId: string;
  userId: string | null;
  correlationId: string;
}

/** Run `fn` in one transaction with RLS context set. All writes, audit and outbox rows commit together. */
export async function withTenant<T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true),
                     set_config('app.user_id', ${ctx.userId ?? ''}, true),
                     set_config('app.correlation_id', ${ctx.correlationId}, true)`.execute(tx);
    return fn(tx);
  });
}

/**
 * Enqueue a background job INSIDE the caller's transaction (transactional enqueue, D-007): the job
 * exists if and only if the business change commits. Payloads must carry tenantId and correlationId.
 */
export async function enqueueJob(
  tx: Tx,
  name: string,
  payload: { tenantId: string; correlationId: string } & Record<string, unknown>,
  opts: { runAt?: Date; maxAttempts?: number; jobKey?: string } = {},
): Promise<string> {
  const r = await sql<{ id: string }>`SELECT (graphile_worker.add_job(
      identifier => ${name},
      payload => ${JSON.stringify(payload)}::json,
      run_at => ${opts.runAt ?? null}::timestamptz,
      max_attempts => ${opts.maxAttempts ?? null}::int,
      job_key => ${opts.jobKey ?? null}::text)).id::text AS id`.execute(tx);
  return r.rows[0]!.id;
}

/** Zero padding per display-key prefix, matching the fixture and prototype (ME-104, OPP-07, SRC-014). */
export const DISPLAY_KEY_PAD: Readonly<Record<string, number>> = {
  ME: 3,
  MD: 2,
  OPP: 2,
  EXP: 2,
  SRC: 3,
  ASM: 2,
  CMP: 2,
};

/**
 * Allocate the next per-tenant display key for a prefix (ME-105, SRC-041 …) from
 * platform.display_key_counter. Keys already taken (seeded or imported rows) are skipped, so a
 * counter that starts below existing keys never produces a duplicate. Must run inside withTenant.
 */
export async function allocateDisplayKey(
  tx: Tx,
  tenantId: string,
  prefix: string,
  isTaken: (key: string) => Promise<boolean>,
): Promise<string> {
  const pad = DISPLAY_KEY_PAD[prefix] ?? 2;
  for (let i = 0; i < 1000; i++) {
    const r = await sql<{ value: number }>`
      INSERT INTO platform.display_key_counter (tenant_id, prefix, next_value)
      VALUES (${tenantId}, ${prefix}, 2)
      ON CONFLICT (tenant_id, prefix)
        DO UPDATE SET next_value = platform.display_key_counter.next_value + 1
      RETURNING next_value - 1 AS value`.execute(tx);
    const key = `${prefix}-${String(r.rows[0]!.value).padStart(pad, '0')}`;
    if (!(await isTaken(key))) return key;
  }
  throw new Error(`allocateDisplayKey: no free key for ${prefix}`);
}

export { createObjectStore, type ObjectStore, type StoredObject } from './object-store';

/** Map Postgres guard errors raised by triggers to stable API error codes. */
export function guardErrorCode(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : '';
  const m =
    /^(SNAPSHOT_STALE|INVALID_TRANSITION|AGENT_IDENTITY_FORBIDDEN|SELF_APPROVAL_PROHIBITED|AUTHORITY_INSUFFICIENT)\b/.exec(
      msg,
    );
  return m?.[1] ?? null;
}

export {
  assertAuditEntrySafe,
  auditWriter,
  createAuditWriter,
  AuditGuardError,
  AUDIT_DETAIL_STRING_MAX,
  AUDIT_SUMMARY_MAX,
  RESTRICTED_DETAIL_KEYS,
  type AuditRecord,
  type PlatformAuditWriter,
} from './audit';
