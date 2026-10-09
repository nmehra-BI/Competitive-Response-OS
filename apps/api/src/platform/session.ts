/**
 * Sessions (D-017). The cookie holds a random 256-bit token; only its SHA-256 is stored in
 * platform.session. Resolution goes through platform.resolve_session() (migration 0002) because
 * the tenant is unknown until the session is found. Agents and services never get interactive
 * sessions; dev persona login is only possible for illustrative tenants.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { sql, type Db, type Tx } from '@growth-os/db';
import type { SessionRef } from './context';
import { sha256Hex } from './hash';

export function hashToken(token: string): string {
  return sha256Hex(token);
}

/** Insert a session row inside the caller's tenant transaction. Returns the cookie token (never stored). */
export async function insertSession(
  tx: Tx,
  input: {
    tenantId: string;
    userId: string;
    method: 'dev_persona' | 'oidc';
    interactive: boolean;
    ttlMs: number;
    now: Date;
  },
): Promise<{ token: string; session: SessionRef; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  const expiresAt = new Date(input.now.getTime() + input.ttlMs);
  await tx
    .insertInto('platform.session')
    .values({
      id,
      tenant_id: input.tenantId,
      user_id: input.userId,
      token_hash: hashToken(token),
      auth_method: input.method,
      interactive: input.interactive,
      created_at: input.now,
      expires_at: expiresAt,
    })
    .execute();
  return { token, session: { sessionId: id, tenantId: input.tenantId, userId: input.userId }, expiresAt };
}

/** Live session for a cookie token, or null when missing, unknown, expired or revoked. */
export async function resolveSession(db: Db, token: string | undefined): Promise<SessionRef | null> {
  if (!token || token.length > 200) return null;
  const r = await sql<{ session_id: string; tenant_id: string; user_id: string }>`
    SELECT session_id, tenant_id, user_id FROM platform.resolve_session(${hashToken(token)})`.execute(db);
  const row = r.rows[0];
  return row ? { sessionId: row.session_id, tenantId: row.tenant_id, userId: row.user_id } : null;
}

export async function revokeSession(tx: Tx, s: SessionRef, now: Date): Promise<boolean> {
  const r = await tx
    .updateTable('platform.session')
    .set({ revoked_at: now })
    .where('id', '=', s.sessionId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return Number(r.numUpdatedRows) > 0;
}

/** Tenant of a dev persona; null unless the user is active in an illustrative tenant. */
export async function devLoginTenant(db: Db, userId: string): Promise<string | null> {
  const r = await sql<{ t: string | null }>`SELECT platform.dev_login_tenant(${userId}::uuid) AS t`.execute(
    db,
  );
  return r.rows[0]?.t ?? null;
}

export async function illustrativeTenantId(db: Db, slug: string): Promise<string | null> {
  const r = await sql<{ t: string | null }>`SELECT platform.illustrative_tenant_id(${slug}) AS t`.execute(db);
  return r.rows[0]?.t ?? null;
}
