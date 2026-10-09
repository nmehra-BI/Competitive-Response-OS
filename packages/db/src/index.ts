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

/** Map Postgres guard errors raised by triggers to stable API error codes. */
export function guardErrorCode(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : '';
  const m =
    /^(SNAPSHOT_STALE|INVALID_TRANSITION|AGENT_IDENTITY_FORBIDDEN|SELF_APPROVAL_PROHIBITED|AUTHORITY_INSUFFICIENT)\b/.exec(
      msg,
    );
  return m?.[1] ?? null;
}
