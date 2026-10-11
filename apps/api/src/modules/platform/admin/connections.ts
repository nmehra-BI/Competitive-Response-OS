/**
 * S14 connections with Jira Cloud (W4-E5, D-121, D-135). Three new endpoints and three handlers that
 * replace the WS1 ones in `./index.ts` (spread after `adminHandlers`), so `Connection.jira` is filled
 * and Jira connections are checked live through the connector:
 *
 *   admin.connections            health rows + mappings; Jira rows carry site, cloud id, integration
 *                                account, scopes, token expiry and who authorized — never a token
 *   admin.testConnection         Jira: live health (/myself + permissions in the mapped projects)
 *   admin.reconnect              Jira: refresh the grant; a revoked grant needs a new authorization
 *   admin.createConnection       a Jira Cloud connection, Expired until authorized
 *   admin.authorizeConnection    consent URL + one-time state (sha256 stored, 10 minutes, single use)
 *   admin.completeAuthorization  state checked once (same tenant, connection and admin), code exchanged,
 *                                tokens stored encrypted, site/account/scopes recorded, health-checked
 *
 * Simulated connections keep the WS1 behaviour exactly. Administrators configure; nothing here grants
 * approval authority (never-rule 6). Audit rows name the connection, site and account — never tokens,
 * codes or the state. Paused sync is not resumed here: the outbox sweep resumes paused rows only after
 * its own send-time re-check (never-rule 10).
 */
import { API, type Connection, type ConnectorMapping, type ConnectorStatus } from '@growth-os/contracts';
import {
  authorizeUrl,
  accessibleResources,
  connectionIdOfState,
  createConnectorFactory,
  createJiraConnector,
  createMemoryCredentialStore,
  exchangeCode,
  integrationAccount,
  JIRA_CLOUD_PROVIDER,
  JIRA_SCOPES,
  jiraDepsFromEnv,
  mappedProjectsOf,
  newOAuthState,
  normaliseSiteUrl,
  OAUTH_STATE_TTL_MS,
  OAuthGrantError,
  OAuthUnavailableError,
  sha256Hex,
  writeCredential,
  type JiraFactoryDeps,
} from '@growth-os/connectors';
import { sql, withTenant, type Tx } from '@growth-os/db';
import { matchingRole, roleAllows } from '../../../platform/authz';
import type { Authorization, Identity } from '../../../platform/context';
import { ApiError, notFound } from '../../../platform/errors';
import { command, query, type HandlerMap } from '../../../platform/pipeline';
import { isoDateTimeOrNull, personRef } from '../../../platform/serialize';

const configure = (identity: Identity): Authorization => roleAllows(identity.subject, 'admin.configure');

/** Jira as configured for this process, or a 503 that says why it is off. */
function jira(): JiraFactoryDeps {
  const deps = jiraDepsFromEnv();
  if (!deps) throw new ApiError('CONNECTOR_UNAVAILABLE', 'Jira Cloud is not enabled on this server.');
  if ('unavailable' in deps)
    throw new ApiError('CONNECTOR_UNAVAILABLE', 'Jira Cloud is not configured on this server.');
  return deps;
}

const invalid = (path: string, message: string) =>
  new ApiError('VALIDATION_FAILED', message, { errors: [{ path, code: 'invalid', message }] });

// ----- rows and serialization ---------------------------------------------------------------------

type ConnRow = {
  id: string;
  kind: string;
  provider: string;
  name: string;
  scope_text: string;
  status: string;
  last_success_at: Date | null;
  last_checked_at: Date | null;
  used_for: string;
  config: unknown;
};

type JiraInfo = NonNullable<Connection['jira']>;

const siteOfConfig = (config: unknown): string | null => {
  const s = (config as { siteUrl?: unknown } | null)?.siteUrl;
  return typeof s === 'string' ? s : null;
};

async function jiraInfo(tx: Tx, rows: readonly ConnRow[]): Promise<Map<string, JiraInfo>> {
  const ids = rows.filter((r) => r.provider === JIRA_CLOUD_PROVIDER).map((r) => r.id);
  const out = new Map<string, JiraInfo>();
  if (!ids.length) return out;
  const creds = await tx
    .selectFrom('platform.connection_credential as c')
    .leftJoin('platform.app_user as u', 'u.id', 'c.authorized_by')
    .select([
      'c.connection_id',
      'c.site_url',
      'c.cloud_id',
      'c.account_display_name',
      'c.scopes',
      'c.token_expires_at',
      'c.authorized_at',
      'c.revoked_at',
      'u.id as user_id',
      'u.display_name',
      'u.title',
      'u.initials',
    ])
    .where('c.connection_id', 'in', ids)
    .execute();
  const byId = new Map(creds.map((c) => [c.connection_id, c]));
  for (const r of rows) {
    if (r.provider !== JIRA_CLOUD_PROVIDER) continue;
    const c = byId.get(r.id);
    const live = c && c.revoked_at === null ? c : null;
    out.set(r.id, {
      siteUrl: live?.site_url ?? siteOfConfig(r.config) ?? 'https://invalid.atlassian.net',
      cloudId: live?.cloud_id ?? null,
      accountDisplayName: live?.account_display_name ?? null,
      scopes: live?.scopes ?? [],
      tokenExpiresAt: isoDateTimeOrNull(live?.token_expires_at ?? null),
      authorizedBy:
        live && live.user_id
          ? personRef({
              id: live.user_id,
              display_name: live.display_name!,
              title: live.title,
              initials: live.initials!,
            })
          : null,
      authorizedAt: isoDateTimeOrNull(live?.authorized_at ?? null),
    });
  }
  return out;
}

const toConnection = (c: ConnRow, info?: Map<string, JiraInfo>): Connection => ({
  id: c.id,
  kind: c.kind as Connection['kind'],
  provider: c.provider,
  name: c.name,
  scopeText: c.scope_text,
  status: c.status as Connection['status'],
  lastSuccessAt: isoDateTimeOrNull(c.last_success_at),
  lastCheckedAt: isoDateTimeOrNull(c.last_checked_at),
  usedFor: c.used_for,
  ...(c.provider === JIRA_CLOUD_PROVIDER ? { jira: info?.get(c.id) ?? null } : {}),
});

async function withJira(tx: Tx, row: ConnRow): Promise<Connection> {
  return toConnection(row, await jiraInfo(tx, [row]));
}

const toMapping = (m: {
  id: string;
  connection_id: string;
  purpose: string;
  destination_project: string;
  issue_type: string;
  assignee_map: unknown;
}): ConnectorMapping => ({
  id: m.id,
  connectionId: m.connection_id,
  purpose: m.purpose as ConnectorMapping['purpose'],
  destinationProject: m.destination_project,
  issueType: m.issue_type,
  assigneeMap: (m.assignee_map ?? {}) as Record<string, string>,
});

async function connectionRow(tx: Tx, id: string): Promise<ConnRow> {
  const c = await tx.selectFrom('platform.connection').selectAll().where('id', '=', id).executeTakeFirst();
  if (!c) throw notFound();
  return c;
}

function requireJiraConnection(c: ConnRow): void {
  if (c.provider !== JIRA_CLOUD_PROVIDER)
    throw new ApiError('INVALID_TRANSITION', 'Only Jira Cloud connections are authorized with Atlassian.');
}

/** Live health through the connector (Jira only); the store reads in the caller's tenant. */
async function liveHealth(
  ctx: { tenantId: string; deps: { db: Parameters<typeof createConnectorFactory>[0]['sim'] } },
  c: ConnRow,
) {
  const deps = jira();
  return createConnectorFactory({ sim: ctx.deps.db, jira: deps })({
    id: c.id,
    provider: c.provider,
    tenantId: ctx.tenantId,
  }).health();
}

async function setStatus(tx: Tx, c: ConnRow, status: ConnectorStatus, now: Date): Promise<ConnRow> {
  return tx
    .updateTable('platform.connection')
    .set({ status, last_checked_at: now, ...(status === 'connected' ? { last_success_at: now } : {}) })
    .where('id', '=', c.id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

// ----- handlers -------------------------------------------------------------------------------------

export const connectionHandlers: HandlerMap = {
  [API.admin.connections.id]: query(API.admin.connections, {
    // Health rows are also shown on S03 and S11, so case roles may read them (no secrets in the shape).
    authorize: (ctx) => {
      const admin = configure(ctx.identity);
      if (admin.allow) return admin;
      const role = matchingRole(ctx.identity.subject, 'case.read', { businessUnitId: null, caseId: null });
      return role ? { allow: true, rule: 'connections.health_read', authorityGrantId: null, role } : admin;
    },
    handle: async (_ctx, { tx }) => {
      const rows = await tx
        .selectFrom('platform.connection')
        .selectAll()
        .orderBy('created_at')
        .orderBy('name')
        .execute();
      const info = await jiraInfo(tx, rows);
      return {
        items: rows.map((r) => toConnection(r, info)),
        mappings: (
          await tx.selectFrom('platform.connector_mapping').selectAll().orderBy('purpose').execute()
        ).map(toMapping),
      };
    },
  }),

  [API.admin.testConnection.id]: command(API.admin.testConnection, {
    load: (ctx, tx) => connectionRow(tx, ctx.params.id),
    authorize: (ctx) => configure(ctx.identity),
    handle: async (ctx, t, c) => {
      if (c.provider !== JIRA_CLOUD_PROVIDER) {
        // Simulated and other connections: the stored state (WS1 behaviour, unchanged).
        const healthy = c.status === 'connected';
        const row = await t.tx
          .updateTable('platform.connection')
          .set({ last_checked_at: ctx.now, ...(healthy ? { last_success_at: ctx.now } : {}) })
          .where('id', '=', c.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await t.audit({
          action: 'admin.connection_tested',
          objectType: 'connection',
          objectId: c.id,
          summary: `Tested connection ${c.name}: ${c.status}`,
          details: { status: c.status, kind: c.kind },
        });
        return toConnection(row);
      }
      const health = await liveHealth(ctx, c);
      const row = await setStatus(t.tx, c, health.status, ctx.now);
      await t.audit({
        action: 'admin.connection_tested',
        objectType: 'connection',
        objectId: c.id,
        summary: `Tested connection ${c.name}: ${health.status}`,
        details: { status: health.status, kind: c.kind, from: c.status, provider: c.provider },
      });
      return withJira(t.tx, row);
    },
  }),

  [API.admin.reconnect.id]: command(API.admin.reconnect, {
    load: (ctx, tx) => connectionRow(tx, ctx.params.id),
    authorize: (ctx) => configure(ctx.identity),
    handle: async (ctx, t, c) => {
      if (c.provider !== JIRA_CLOUD_PROVIDER) {
        // Re-authorization is simulated in dev (WS1 behaviour, unchanged).
        const row = await t.tx
          .updateTable('platform.connection')
          .set({ status: 'connected', last_checked_at: ctx.now, last_success_at: ctx.now })
          .where('id', '=', c.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await t.audit({
          action: 'admin.connection_reconnected',
          objectType: 'connection',
          objectId: c.id,
          summary: `Reconnected ${c.name}`,
          details: { from: c.status, kind: c.kind },
          before: { status: c.status },
          after: { status: 'connected' },
        });
        return toConnection(row);
      }
      // Jira: the health check refreshes the grant when it can. A revoked grant stays Expired and
      // the admin connects again (authorizeConnection) as the integration account.
      const health = await liveHealth(ctx, c);
      const row = await setStatus(t.tx, c, health.status, ctx.now);
      const ok = health.status === 'connected';
      await t.audit({
        action: ok ? 'admin.connection_reconnected' : 'admin.connection_tested',
        objectType: 'connection',
        objectId: c.id,
        summary: ok
          ? `Reconnected ${c.name}`
          : `Reconnect ${c.name}: ${health.status} — a new authorization is needed`,
        details: { from: c.status, to: health.status, kind: c.kind, provider: c.provider },
        before: { status: c.status },
        after: { status: health.status },
      });
      return withJira(t.tx, row);
    },
  }),

  [API.admin.createConnection.id]: command(API.admin.createConnection, {
    authorize: (ctx) => configure(ctx.identity),
    handle: async (ctx, t) => {
      jira();
      const b = ctx.body;
      const site = new URL(b.siteUrl);
      if (site.protocol !== 'https:')
        throw invalid('siteUrl', 'Use the https address of your Jira Cloud site.');
      const siteUrl = normaliseSiteUrl(b.siteUrl);
      const row = await t.tx
        .insertInto('platform.connection')
        .values({
          tenant_id: ctx.tenantId,
          kind: 'task_tool',
          provider: JIRA_CLOUD_PROVIDER,
          name: b.name,
          scope_text: `Jira Cloud ${site.host} · Browse, Create and Assign in the mapped projects only`,
          used_for: b.usedFor,
          // Not usable until the integration account authorizes it (D-135).
          status: 'expired',
          config: JSON.stringify({ siteUrl }),
          created_by: ctx.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'admin.connection_created',
        objectType: 'connection',
        objectId: row.id,
        summary: `Added Jira Cloud connection ${row.name} (${site.host})`,
        details: { provider: JIRA_CLOUD_PROVIDER, site: site.host },
        after: { name: row.name, siteUrl, status: row.status },
      });
      return withJira(t.tx, row);
    },
  }),

  [API.admin.authorizeConnection.id]: command(API.admin.authorizeConnection, {
    load: (ctx, tx) => connectionRow(tx, ctx.params.id),
    authorize: (ctx) => configure(ctx.identity),
    handle: async (ctx, t, c) => {
      requireJiraConnection(c);
      const { config } = jira();
      const state = newOAuthState(c.id);
      const created = ctx.deps.now();
      const expiresAt = new Date(created.getTime() + OAUTH_STATE_TTL_MS);
      await t.tx
        .insertInto('platform.connector_oauth_state')
        .values({
          state_hash: sha256Hex(state),
          tenant_id: ctx.tenantId,
          connection_id: c.id,
          user_id: ctx.userId,
          created_at: created,
          expires_at: expiresAt,
        })
        .execute();
      await t.audit({
        action: 'admin.connection_authorization_started',
        objectType: 'connection',
        objectId: c.id,
        summary: `Started Jira authorization for ${c.name}`,
        details: { provider: c.provider, scopes: JIRA_SCOPES.join(' ') },
      });
      return { authorizeUrl: authorizeUrl(config, state), expiresAt: expiresAt.toISOString() };
    },
  }),

  [API.admin.completeAuthorization.id]: command(API.admin.completeAuthorization, {
    load: (ctx, tx) => connectionRow(tx, ctx.params.id),
    authorize: (ctx) => configure(ctx.identity),
    handle: async (ctx, t, c) => {
      requireJiraConnection(c);
      const deps = jira();
      const { config } = deps;
      const fetchImpl = deps.fetch ?? ((u: string, i?: RequestInit) => fetch(u, i));
      const now = ctx.deps.now();

      // 1. The state, exactly once: consumed in its own transaction so a failed exchange cannot
      //    leave it reusable. Another tenant's state is invisible (RLS) and refused like a forged one.
      const used = await withTenant(
        ctx.deps.db,
        { tenantId: ctx.tenantId, userId: ctx.userId, correlationId: ctx.correlationId },
        (tx) =>
          sql<{ connection_id: string; user_id: string; expires_at: Date }>`
            UPDATE platform.connector_oauth_state SET used_at = ${now}
             WHERE state_hash = ${sha256Hex(ctx.body.state)} AND used_at IS NULL
         RETURNING connection_id, user_id, expires_at`.execute(tx),
      );
      const st = used.rows[0];
      const refused = 'This authorization link is not valid any more. Start the connection again.';
      if (
        !st ||
        st.connection_id !== c.id ||
        connectionIdOfState(ctx.body.state) !== c.id ||
        st.user_id !== ctx.userId ||
        new Date(st.expires_at).getTime() <= now.getTime()
      )
        throw invalid('state', refused);

      // 2. Code → tokens; the site this connection names → cloud id; the account the grant acts as.
      let tokens, site, account;
      try {
        tokens = await exchangeCode(config, fetchImpl, ctx.body.code, now);
        const want = siteOfConfig(c.config);
        site = (await accessibleResources(config, fetchImpl, tokens.accessToken)).find(
          (r) => want === null || normaliseSiteUrl(r.url) === normaliseSiteUrl(want),
        );
        if (!site) throw invalid('code', 'The authorized account has no access to this Jira site.');
        account = await integrationAccount(config, fetchImpl, tokens.accessToken, site.id);
      } catch (e) {
        if (e instanceof OAuthGrantError)
          throw invalid('code', 'Jira did not accept this authorization. Start again.');
        if (e instanceof OAuthUnavailableError)
          throw new ApiError(
            'CONNECTOR_UNAVAILABLE',
            'The Atlassian authorization service is not available. Try again.',
          );
        throw e;
      }
      const missing = JIRA_SCOPES.filter((s) => !tokens.scopes.includes(s));
      if (missing.length)
        throw invalid('code', `The authorization is missing scopes: ${missing.join(', ')}.`);

      // 3. Store the tokens encrypted (ciphertext + key id only).
      await writeCredential(
        t.tx,
        {
          tenantId: ctx.tenantId,
          connectionId: c.id,
          tokens,
          siteUrl: normaliseSiteUrl(site.url),
          cloudId: site.id,
          accountId: account.accountId,
          accountDisplayName: account.displayName,
          authorizedBy: ctx.userId,
          authorizedAt: now,
        },
        config.tokenKey,
      );

      // 4. Health-check with the new tokens (in memory: the row commits with this transaction).
      const health = await createJiraConnector({
        connectionId: c.id,
        config,
        fetch: fetchImpl,
        store: createMemoryCredentialStore(
          {
            connectionId: c.id,
            tenantId: ctx.tenantId,
            ...tokens,
            siteUrl: normaliseSiteUrl(site.url),
            cloudId: site.id,
            accountId: account.accountId,
            accountDisplayName: account.displayName,
            revokedAt: null,
          },
          await mappedProjectsOf(t.tx, c.id),
        ),
      }).health();
      const status: ConnectorStatus = health.status === 'expired' ? 'expired' : health.status;
      const row = await t.tx
        .updateTable('platform.connection')
        .set({
          status,
          last_checked_at: now,
          ...(status === 'connected' ? { last_success_at: now } : {}),
          config: JSON.stringify({ siteUrl: normaliseSiteUrl(site.url), cloudId: site.id }),
        })
        .where('id', '=', c.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'admin.connection_authorized',
        objectType: 'connection',
        objectId: c.id,
        summary: `Authorized ${c.name} as ${account.displayName ?? 'the integration account'} on ${new URL(site.url).host}`,
        details: {
          provider: c.provider,
          site: new URL(site.url).host,
          account: account.displayName,
          scopes: tokens.scopes.join(' '),
          status,
        },
        before: { status: c.status },
        after: { status },
      });
      return withJira(t.tx, row);
    },
  }),
};
