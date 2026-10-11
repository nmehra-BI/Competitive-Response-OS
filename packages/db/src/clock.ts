/**
 * Business time with the dev clock (decisions.md D-091). Production code never sees an offset: the clock
 * is honoured only when the process runs with AUTH_MODE=dev outside NODE_ENV=production, and only for an
 * illustrative tenant (the table refuses rows for any other). Audit timestamps never use it.
 */
import { sql } from 'kysely';
import type { Tx } from './index';

export function devClockAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTH_MODE === 'dev' && env.NODE_ENV !== 'production';
}

/** The current tenant's dev-clock offset in ms (0 when none is set). Runs inside withTenant(). */
export async function devClockOffsetMs(tx: Tx): Promise<number> {
  const r = await sql<{ offset_ms: string | number }>`
    SELECT c.offset_ms FROM platform.dev_clock c
      JOIN platform.tenant t ON t.id = c.tenant_id AND t.illustrative
     WHERE c.tenant_id = platform.current_tenant_id()`.execute(tx);
  return r.rows[0] ? Number(r.rows[0].offset_ms) : 0;
}

/** `base` moved by the tenant's dev clock when it is allowed; `base` otherwise. */
export async function businessNow(tx: Tx, base: Date, allowed: boolean = devClockAllowed()): Promise<Date> {
  if (!allowed) return base;
  const offset = await devClockOffsetMs(tx);
  return offset === 0 ? base : new Date(base.getTime() + offset);
}
