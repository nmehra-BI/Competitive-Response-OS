/**
 * Credential storage for Jira Cloud connections (D-135): `platform.connection_credential` holds the
 * AES-256-GCM ciphertext of the access and refresh tokens and the key id — never a plaintext token.
 * Rows are tenant-scoped (RLS forced), so every statement runs in a transaction that sets
 * `app.tenant_id` first, as `withTenant()` does (never-rule 15).
 *
 * Refresh is serialised per connection with `SELECT … FOR UPDATE`: Atlassian rotates refresh tokens,
 * so two workers refreshing at once with the same refresh token would make the second one fail and
 * wrongly expire the connection. The lock holder refreshes; the next one sees the new token.
 *
 * The connector factory only receives `{ id, provider }` for a connection (frozen call sites), so
 * the tenant is resolved once per connection: from `ConnectionRef.tenantId` when the caller passes it,
 * otherwise through `platform.list_tenant_ids()` (worker role only; SECURITY DEFINER, ids only) and a
 * tenant-scoped lookup of the connection. The answer is cached: a connection never changes tenant.
 */
import { CompiledQuery } from 'kysely';
import type { SimExecutor } from '../simulated/pg-store';
import { decryptToken, encryptToken, type TokenKey } from './crypto';

export interface JiraCredential {
  connectionId: string;
  tenantId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
  siteUrl: string;
  cloudId: string;
  accountId: string | null;
  accountDisplayName: string | null;
  revokedAt: Date | null;
}

export interface TokenUpdate {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes?: string[];
}

/** One connection's credential, as the adapter sees it. */
export interface CredentialStore {
  load(): Promise<JiraCredential | null>;
  /**
   * Exclusive update: re-reads the credential under a row lock and persists what `fn` returns (null
   * keeps the row). Errors thrown by `fn` propagate and change nothing.
   */
  update(fn: (current: JiraCredential) => Promise<TokenUpdate | null>): Promise<JiraCredential | null>;
  /** Destination projects of the connection's mappings (reconcile searches only these). */
  mappedProjects(): Promise<string[]>;
}

// ---------------------------------------------------------------------------------------------------
// Memory store (unit tests)
// ---------------------------------------------------------------------------------------------------

export function createMemoryCredentialStore(
  initial: JiraCredential | null,
  projects: string[] = [],
): CredentialStore & { current: JiraCredential | null; updates: number } {
  let chain: Promise<unknown> = Promise.resolve();
  const s = {
    current: initial,
    updates: 0,
    async load() {
      return s.current ? { ...s.current } : null;
    },
    update(fn: (c: JiraCredential) => Promise<TokenUpdate | null>) {
      const run = chain.then(async () => {
        if (!s.current) return null;
        const u = await fn({ ...s.current });
        if (u) {
          s.updates += 1;
          s.current = { ...s.current, ...u, scopes: u.scopes ?? s.current.scopes };
        }
        return { ...s.current };
      });
      chain = run.catch(() => undefined);
      return run;
    },
    async mappedProjects() {
      return [...projects];
    },
  };
  return s;
}

// ---------------------------------------------------------------------------------------------------
// Postgres store
// ---------------------------------------------------------------------------------------------------

/** A Kysely instance (pool): runs a callback in one transaction. */
export interface TxRunner extends SimExecutor {
  transaction(): { execute<T>(cb: (trx: SimExecutor) => Promise<T>): Promise<T> };
}

export function canRunTransactions(exec: SimExecutor): exec is TxRunner {
  return typeof (exec as Partial<TxRunner>).transaction === 'function';
}

async function q<R>(exec: SimExecutor, text: string, params: readonly unknown[] = []): Promise<R[]> {
  return (await exec.executeQuery<R>(CompiledQuery.raw(text, [...params]))).rows;
}

/** Run `fn` in a transaction with the tenant context set (the `withTenant()` contract). */
export function inTenantTx<T>(
  db: TxRunner,
  tenantId: string,
  fn: (trx: SimExecutor) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await q(
      trx,
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.correlation_id', 'connector.jira', true)`,
      [tenantId],
    );
    return fn(trx);
  });
}

interface CredentialRow {
  connection_id: string;
  tenant_id: string;
  access_token_ciphertext: Buffer | Uint8Array;
  refresh_token_ciphertext: Buffer | Uint8Array | null;
  key_id: string;
  token_expires_at: Date | string;
  scopes: string[];
  site_url: string;
  cloud_id: string;
  account_id: string | null;
  account_display_name: string | null;
  revoked_at: Date | string | null;
}

const asDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

function decode(row: CredentialRow, keys: readonly TokenKey[]): JiraCredential {
  const bind = { tenantId: row.tenant_id, connectionId: row.connection_id };
  const revoked = row.revoked_at !== null;
  return {
    connectionId: row.connection_id,
    tenantId: row.tenant_id,
    // A revoked row keeps no usable token (wiped on revoke); never decrypt it.
    accessToken: revoked
      ? ''
      : decryptToken(keys, row.key_id, row.access_token_ciphertext, { ...bind, field: 'access' }),
    refreshToken:
      revoked || row.refresh_token_ciphertext === null
        ? null
        : decryptToken(keys, row.key_id, row.refresh_token_ciphertext, { ...bind, field: 'refresh' }),
    expiresAt: asDate(row.token_expires_at),
    scopes: row.scopes ?? [],
    siteUrl: row.site_url,
    cloudId: row.cloud_id,
    accountId: row.account_id,
    accountDisplayName: row.account_display_name,
    revokedAt: row.revoked_at === null ? null : asDate(row.revoked_at),
  };
}

const SELECT_CREDENTIAL = `SELECT connection_id, tenant_id, access_token_ciphertext, refresh_token_ciphertext, key_id,
         token_expires_at, scopes, site_url, cloud_id, account_id, account_display_name, revoked_at
    FROM platform.connection_credential WHERE connection_id = $1`;

/** Read and decrypt a credential (executor already in the tenant context). */
export async function readCredential(
  exec: SimExecutor,
  connectionId: string,
  keys: readonly TokenKey[],
  opts: { forUpdate?: boolean } = {},
): Promise<JiraCredential | null> {
  const [row] = await q<CredentialRow>(exec, `${SELECT_CREDENTIAL}${opts.forUpdate ? ' FOR UPDATE' : ''}`, [
    connectionId,
  ]);
  return row ? decode(row, keys) : null;
}

export interface CredentialWrite {
  tenantId: string;
  connectionId: string;
  tokens: TokenUpdate & { scopes: string[] };
  siteUrl: string;
  cloudId: string;
  accountId: string | null;
  accountDisplayName: string | null;
  authorizedBy: string;
  authorizedAt: Date;
}

/** Store the tokens of a completed authorization (encrypted; executor in the tenant context). */
export async function writeCredential(exec: SimExecutor, w: CredentialWrite, key: TokenKey): Promise<void> {
  const bind = { tenantId: w.tenantId, connectionId: w.connectionId };
  const access = encryptToken(key, w.tokens.accessToken, { ...bind, field: 'access' });
  const refresh = w.tokens.refreshToken
    ? encryptToken(key, w.tokens.refreshToken, { ...bind, field: 'refresh' })
    : null;
  await q(
    exec,
    `INSERT INTO platform.connection_credential
       (connection_id, tenant_id, kind, access_token_ciphertext, refresh_token_ciphertext, key_id, token_expires_at,
        scopes, site_url, cloud_id, account_id, account_display_name, authorized_by, authorized_at, refreshed_at, revoked_at)
     VALUES ($1, $2, 'oauth2_3lo', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL, NULL)
     ON CONFLICT (connection_id) DO UPDATE SET
       access_token_ciphertext = EXCLUDED.access_token_ciphertext,
       refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
       key_id = EXCLUDED.key_id, token_expires_at = EXCLUDED.token_expires_at, scopes = EXCLUDED.scopes,
       site_url = EXCLUDED.site_url, cloud_id = EXCLUDED.cloud_id, account_id = EXCLUDED.account_id,
       account_display_name = EXCLUDED.account_display_name, authorized_by = EXCLUDED.authorized_by,
       authorized_at = EXCLUDED.authorized_at, refreshed_at = NULL, revoked_at = NULL`,
    [
      w.connectionId,
      w.tenantId,
      access,
      refresh,
      key.id,
      w.tokens.expiresAt,
      w.tokens.scopes,
      w.siteUrl,
      w.cloudId,
      w.accountId,
      w.accountDisplayName,
      w.authorizedBy,
      w.authorizedAt,
    ],
  );
}

/** Persist refreshed tokens (re-encrypted with the current key: rotation happens on refresh). */
async function writeRefreshed(
  exec: SimExecutor,
  cur: JiraCredential,
  u: TokenUpdate,
  key: TokenKey,
): Promise<void> {
  const bind = { tenantId: cur.tenantId, connectionId: cur.connectionId };
  await q(
    exec,
    `UPDATE platform.connection_credential
        SET access_token_ciphertext = $2, refresh_token_ciphertext = $3, key_id = $4, token_expires_at = $5,
            scopes = $6, refreshed_at = now()
      WHERE connection_id = $1`,
    [
      cur.connectionId,
      encryptToken(key, u.accessToken, { ...bind, field: 'access' }),
      u.refreshToken ? encryptToken(key, u.refreshToken, { ...bind, field: 'refresh' }) : null,
      key.id,
      u.expiresAt,
      u.scopes ?? cur.scopes,
    ],
  );
}

/**
 * Disconnect: wipe both tokens and mark the credential revoked (the row stays for the record; the
 * audit event says who disconnected). The executor is in the tenant context.
 */
export async function revokeCredential(exec: SimExecutor, connectionId: string, at: Date): Promise<boolean> {
  const r = await q<{ connection_id: string }>(
    exec,
    `UPDATE platform.connection_credential
        SET access_token_ciphertext = '\\x'::bytea, refresh_token_ciphertext = NULL, revoked_at = $2
      WHERE connection_id = $1 AND revoked_at IS NULL
      RETURNING connection_id`,
    [connectionId, at],
  );
  return r.length > 0;
}

export async function mappedProjectsOf(exec: SimExecutor, connectionId: string): Promise<string[]> {
  const rows = await q<{ destination_project: string }>(
    exec,
    `SELECT DISTINCT destination_project FROM platform.connector_mapping WHERE connection_id = $1 ORDER BY 1`,
    [connectionId],
  );
  return rows.map((r) => r.destination_project);
}

/** connection id → tenant id, resolved once per process (a connection never changes tenant). */
const tenantCache = new Map<string, string>();

export class TenantUnresolvedError extends Error {
  constructor() {
    super('The tenant of this connection could not be resolved.');
    this.name = 'TenantUnresolvedError';
  }
}

export async function resolveConnectionTenant(
  db: TxRunner,
  connectionId: string,
  hint?: string,
): Promise<string> {
  if (hint) {
    tenantCache.set(connectionId, hint);
    return hint;
  }
  const cached = tenantCache.get(connectionId);
  if (cached) return cached;
  let tenants: string[];
  try {
    tenants = (await q<{ id: string }>(db, 'SELECT id FROM platform.list_tenant_ids() AS id')).map(
      (r) => r.id,
    );
  } catch {
    // The API role cannot enumerate tenants (by design); callers there pass the tenant.
    throw new TenantUnresolvedError();
  }
  // One read-only transaction; the tenant context is switched per probe (RLS applies to each).
  const owner = await db.transaction().execute(async (trx) => {
    for (const tenantId of tenants) {
      await q(trx, `SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const [hit] = await q<{ id: string }>(trx, 'SELECT id FROM platform.connection WHERE id = $1', [
        connectionId,
      ]);
      if (hit) return tenantId;
    }
    return null;
  });
  if (!owner) throw new TenantUnresolvedError();
  tenantCache.set(connectionId, owner);
  return owner;
}

export function createPgCredentialStore(opts: {
  db: TxRunner;
  connectionId: string;
  tenantId?: string;
  keys: { current: TokenKey; previous: readonly TokenKey[] };
}): CredentialStore {
  const keys = [opts.keys.current, ...opts.keys.previous];
  const tenant = () => resolveConnectionTenant(opts.db, opts.connectionId, opts.tenantId);
  return {
    async load() {
      return inTenantTx(opts.db, await tenant(), (trx) => readCredential(trx, opts.connectionId, keys));
    },
    async update(fn) {
      return inTenantTx(opts.db, await tenant(), async (trx) => {
        const cur = await readCredential(trx, opts.connectionId, keys, { forUpdate: true });
        if (!cur) return null;
        const u = await fn(cur);
        if (!u) return cur;
        await writeRefreshed(trx, cur, u, opts.keys.current);
        return { ...cur, ...u, scopes: u.scopes ?? cur.scopes };
      });
    },
    async mappedProjects() {
      return inTenantTx(opts.db, await tenant(), (trx) => mappedProjectsOf(trx, opts.connectionId));
    },
  };
}
