/**
 * W4-E5 · Jira Cloud connections (D-121, D-135) against the local mock Jira server: create →
 * authorize → complete; the state is single use, bound to the tenant, connection and admin; tokens are
 * stored only as ciphertext; admin only; cross-tenant 404; agents refused; audit without secrets;
 * health, reconnect and the Jira-off refusal. Simulated connections keep their WS1 behaviour
 * (admin.db.test.ts and the connector fault suite).
 */
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, Connection } from '@growth-os/contracts';
import { parseTokenKey, readCredential } from '@growth-os/connectors';
import {
  applyJiraEnv,
  consent,
  mockJiraEnv,
  startMockJira,
  type MockJira,
} from '@growth-os/connectors/jira-mock';
import { sql, withTenant, type Tx } from '@growth-os/db';
import { connections } from '@growth-os/fixtures-aster';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';

let t: TestApp;
let mock: MockJira;
let env: Record<string, string>;
let restoreEnv: () => void;
let a: SeededTenant;
let b: SeededTenant;
const k: Record<'admin' | 'maya' | 'adminB' | 'agent', string> = {
  admin: '',
  maya: '',
  adminB: '',
  agent: '',
};
const log: string[] = [];
const secrets: string[] = [];

const inTenant = <T>(s: SeededTenant, fn: (tx: Tx) => Promise<T>) =>
  withTenant(t.db, { tenantId: s.tenantId, userId: null, correlationId: 'connections-test' }, fn);

async function agentCookie(s: SeededTenant): Promise<string> {
  const { randomBytes, createHash } = await import('node:crypto');
  const token = randomBytes(24).toString('base64url');
  await inTenant(s, (tx) =>
    tx
      .insertInto('platform.session')
      .values({
        tenant_id: s.tenantId,
        user_id: s.user('analysisAgent'),
        token_hash: createHash('sha256').update(token).digest('hex'),
        auth_method: 'oidc',
        interactive: false,
        expires_at: new Date(Date.now() + 3600_000),
      })
      .execute(),
  );
  return `gos_session=${token}`;
}

beforeAll(async () => {
  mock = await startMockJira();
  env = mockJiraEnv(mock);
  restoreEnv = applyJiraEnv(env);
  t = await createTestApp({
    logStream: new Writable({
      write(chunk, _enc, cb) {
        log.push(String(chunk));
        cb();
      },
    }),
  });
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-start');
  k.admin = await login(t.app, a.user('admin'));
  k.maya = await login(t.app, a.user('maya'));
  k.adminB = await login(t.app, b.user('admin'));
  k.agent = await agentCookie(a);
});
afterAll(async () => {
  restoreEnv();
  await t.close();
  await mock.close();
});

const create = (cookie: string, over: Record<string, unknown> = {}, key: string | true = true) =>
  call(t.app, API.admin.createConnection, {
    body: {
      kind: 'task_tool',
      provider: 'jira_cloud',
      name: 'Jira Cloud · PIL, ME-VAL',
      siteUrl: mock.siteUrl,
      usedFor: 'Validation and pilot tasks',
      ...over,
    },
    cookie,
    idempotencyKey: key,
  });
const authorize = (cookie: string, id: string) =>
  call(t.app, API.admin.authorizeConnection, { params: { id }, cookie, idempotencyKey: true });
const complete = (cookie: string, id: string, body: { code: string; state: string }) =>
  call(t.app, API.admin.completeAuthorization, { params: { id }, body, cookie, idempotencyKey: true });

async function auditOf(s: SeededTenant, objectId: string) {
  return inTenant(s, (tx) =>
    tx
      .selectFrom('platform.audit_event')
      .select(['action', 'summary', 'details', 'actor_user_id'])
      .where('object_id', '=', objectId)
      .orderBy('seq')
      .execute(),
  );
}

let connId = '';

describe('create a Jira Cloud connection', () => {
  it('admin adds it; it stays Expired until authorized; idempotent replay', async () => {
    const key = randomUUID();
    const res = await create(k.admin, {}, key);
    expect(res.statusCode, res.body).toBe(201);
    const c = Connection.parse(res.json());
    connId = c.id;
    expect(c).toMatchObject({
      provider: 'jira_cloud',
      kind: 'task_tool',
      status: 'expired',
      name: 'Jira Cloud · PIL, ME-VAL',
      scopeText:
        'Jira Cloud aster-industrial.atlassian.net · Browse, Create and Assign in the mapped projects only',
      jira: {
        siteUrl: mock.siteUrl,
        cloudId: null,
        accountDisplayName: null,
        scopes: [],
        tokenExpiresAt: null,
        authorizedBy: null,
        authorizedAt: null,
      },
    });
    const replay = await create(k.admin, {}, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json().id).toBe(c.id);
    expect((await auditOf(a, c.id)).map((x) => x.action)).toEqual(['admin.connection_created']);
  });

  it('non-admins get 403, agents are refused, plain http is refused', async () => {
    expect((await create(k.maya)).statusCode).toBe(403);
    const agent = await create(k.agent);
    expect(agent.statusCode).toBe(403);
    expect(agent.json()).toMatchObject({ code: 'AGENT_IDENTITY_FORBIDDEN' });
    const http = await create(k.admin, { siteUrl: 'http://aster.atlassian.net' });
    expect(http.statusCode).toBe(400);
    expect(http.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('authorize and complete (OAuth 2.0 3LO)', () => {
  it('returns the consent URL with the minimal scopes and a one-time state stored only as sha256', async () => {
    const res = await authorize(k.admin, connId);
    expect(res.statusCode, res.body).toBe(201);
    const body = API.admin.authorizeConnection.response.parse(res.json());
    const url = new URL(body.authorizeUrl);
    expect(url.searchParams.get('scope')).toBe(
      'read:jira-work write:jira-work read:jira-user offline_access',
    );
    expect(url.searchParams.get('client_id')).toBe(env.JIRA_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(env.JIRA_REDIRECT_URI);
    const state = url.searchParams.get('state')!;
    expect(state.startsWith(`${connId}.`)).toBe(true);
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    const rows = await inTenant(a, (tx) =>
      sql<{ state_hash: string; row: string }>`
        SELECT state_hash, s::text AS row FROM platform.connector_oauth_state s WHERE connection_id = ${connId}`.execute(
        tx,
      ),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.row).not.toContain(state);
    expect(rows.rows[0]!.state_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('only admins of the tenant may start it; simulated connections are not authorized with Atlassian', async () => {
    expect((await authorize(k.maya, connId)).statusCode).toBe(403);
    const cross = await authorize(k.adminB, connId);
    expect(cross.statusCode).toBe(404);
    expect(cross.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect((await authorize(k.agent, connId)).json()).toMatchObject({ code: 'AGENT_IDENTITY_FORBIDDEN' });
    const sim = await authorize(k.admin, a.id(connections[1].id));
    expect(sim.statusCode).toBe(409);
  });

  it('completes: tokens stored as ciphertext only; site, account and scopes recorded; Connected', async () => {
    const started = API.admin.authorizeConnection.response.parse((await authorize(k.admin, connId)).json());
    const { code, state, redirect } = await consent(started.authorizeUrl);
    secrets.push(code, state);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(env.JIRA_REDIRECT_URI);
    // Cross-tenant and non-admin attempts on the callback, before the real one.
    expect((await complete(k.adminB, connId, { code, state })).statusCode).toBe(404);
    expect((await complete(k.maya, connId, { code, state })).statusCode).toBe(403);
    const res = await complete(k.admin, connId, { code, state });
    expect(res.statusCode, res.body).toBe(200);
    const c = Connection.parse(res.json());
    expect(c.status).toBe('connected');
    expect(c.jira).toMatchObject({
      siteUrl: mock.siteUrl,
      cloudId: mock.cloudId,
      accountDisplayName: 'Growth OS integration',
      scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'],
      authorizedBy: { id: a.user('admin') },
    });
    expect(c.jira!.tokenExpiresAt).not.toBeNull();
    expect(c.lastSuccessAt).not.toBeNull();

    // The row holds ciphertext and a key id; decrypting with the configured key gives a token that
    // appears nowhere in plain text (row, audit, responses, log).
    const key = parseTokenKey(env.CONNECTOR_TOKEN_KEY!);
    const cred = await inTenant(a, (tx) => readCredential(tx, connId, [key]));
    expect(cred).not.toBeNull();
    secrets.push(cred!.accessToken, cred!.refreshToken!);
    const raw = await inTenant(a, (tx) =>
      sql<{ row: string; key_id: string }>`
        SELECT c::text AS row, key_id FROM platform.connection_credential c WHERE connection_id = ${connId}`.execute(
        tx,
      ),
    );
    expect(raw.rows[0]!.key_id).toBe(key.id);
    for (const s of [cred!.accessToken, cred!.refreshToken!]) {
      expect(raw.rows[0]!.row).not.toContain(s);
      expect(raw.rows[0]!.row).not.toContain(Buffer.from(s).toString('hex'));
      expect(res.body).not.toContain(s);
    }
    const audit = await auditOf(a, connId);
    expect(audit.map((x) => x.action)).toEqual([
      'admin.connection_created',
      'admin.connection_authorization_started',
      'admin.connection_authorization_started',
      'admin.connection_authorized',
    ]);
    expect(audit.at(-1)).toMatchObject({
      summary:
        'Authorized Jira Cloud · PIL, ME-VAL as Growth OS integration on aster-industrial.atlassian.net',
      actor_user_id: a.user('admin'),
    });
    const auditText = JSON.stringify(audit);
    for (const s of secrets) expect(auditText).not.toContain(s);
  });

  it('a state replay is refused, even with a fresh code', async () => {
    const started = API.admin.authorizeConnection.response.parse((await authorize(k.admin, connId)).json());
    const first = await consent(started.authorizeUrl);
    expect((await complete(k.admin, connId, first)).statusCode).toBe(200);
    const again = await complete(k.admin, connId, {
      code: mock.issueCode(env.JIRA_REDIRECT_URI!),
      state: first.state,
    });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({ code: 'VALIDATION_FAILED', errors: [{ path: 'state' }] });
  });

  it('a foreign state is refused: another connection, another tenant, forged, or expired', async () => {
    // Another connection of the same tenant.
    const other = Connection.parse((await create(k.admin, { name: 'Second Jira' })).json());
    const forOther = API.admin.authorizeConnection.response.parse(
      (await authorize(k.admin, other.id)).json(),
    );
    const o = await consent(forOther.authorizeUrl);
    const crossConn = await complete(k.admin, connId, o);
    expect(crossConn.statusCode).toBe(400);
    // It was consumed by that attempt: it cannot be used on its own connection afterwards either.
    expect((await complete(k.admin, other.id, o)).statusCode).toBe(400);

    // Another tenant's state is invisible here.
    const bConn = Connection.parse((await create(k.adminB)).json());
    const forB = API.admin.authorizeConnection.response.parse((await authorize(k.adminB, bConn.id)).json());
    const fromB = await consent(forB.authorizeUrl);
    expect((await complete(k.admin, connId, fromB)).statusCode).toBe(400);
    expect((await complete(k.adminB, bConn.id, fromB)).statusCode).toBe(200);

    // A forged state.
    const forged = await complete(k.admin, connId, {
      code: mock.issueCode(env.JIRA_REDIRECT_URI!),
      state: `${connId}.${'A'.repeat(43)}`,
    });
    expect(forged.statusCode).toBe(400);

    // An expired state (ten minutes).
    const late = API.admin.authorizeConnection.response.parse((await authorize(k.admin, connId)).json());
    const l = await consent(late.authorizeUrl);
    await inTenant(a, (tx) =>
      sql`UPDATE platform.connector_oauth_state
             SET created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes'
           WHERE used_at IS NULL AND connection_id = ${connId}`.execute(tx),
    );
    expect((await complete(k.admin, connId, l)).statusCode).toBe(400);
  });

  it('a code Jira refuses is a validation error; the connection keeps its state', async () => {
    const started = API.admin.authorizeConnection.response.parse((await authorize(k.admin, connId)).json());
    const { state } = await consent(started.authorizeUrl);
    const res = await complete(k.admin, connId, { code: 'code-forged', state });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED', errors: [{ path: 'code' }] });
  });
});

describe('health, reconnect and the read model', () => {
  it('connections list carries the Jira block for admins and case roles, never a secret', async () => {
    for (const cookie of [k.admin, k.maya]) {
      const res = await call(t.app, API.admin.connections, { cookie });
      expect(res.statusCode).toBe(200);
      const body = API.admin.connections.response.parse(res.json());
      const jira = body.items.find((x) => x.id === connId)!;
      expect(jira.jira?.accountDisplayName).toBe('Growth OS integration');
      // Simulated connections have no Jira block (unchanged shape).
      expect(body.items.find((x) => x.provider === 'jira_simulated')!.jira).toBeUndefined();
      for (const s of secrets) expect(res.body).not.toContain(s);
    }
    const bList = await call(t.app, API.admin.connections, { cookie: k.adminB });
    expect(API.admin.connections.response.parse(bList.json()).items.some((x) => x.id === connId)).toBe(false);
  });

  it('test connection is a live check; a revoked grant turns the connection Expired', async () => {
    const ok = await call(t.app, API.admin.testConnection, {
      params: { id: connId },
      cookie: k.admin,
      idempotencyKey: true,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(Connection.parse(ok.json()).status).toBe('connected');
    mock.setFaults([{ mode: 'token_expired' }]);
    const bad = await call(t.app, API.admin.testConnection, {
      params: { id: connId },
      cookie: k.admin,
      idempotencyKey: true,
    });
    expect(Connection.parse(bad.json()).status).toBe('expired');
    // Reconnect cannot revive a revoked grant: it stays Expired and says a new authorization is needed.
    mock.setFaults([]);
    const re = await call(t.app, API.admin.reconnect, {
      params: { id: connId },
      cookie: k.admin,
      idempotencyKey: true,
    });
    expect(re.statusCode).toBe(200);
    expect(Connection.parse(re.json()).status).toBe('expired');
    const audit = await auditOf(a, connId);
    expect(audit.at(-1)).toMatchObject({
      action: 'admin.connection_tested',
      summary: 'Reconnect Jira Cloud · PIL, ME-VAL: expired — a new authorization is needed',
    });
    // Authorizing again as the integration account brings it back.
    const started = API.admin.authorizeConnection.response.parse((await authorize(k.admin, connId)).json());
    const done = await complete(k.admin, connId, await consent(started.authorizeUrl));
    expect(Connection.parse(done.json()).status).toBe('connected');
    const again = await call(t.app, API.admin.reconnect, {
      params: { id: connId },
      cookie: k.admin,
      idempotencyKey: true,
    });
    expect(Connection.parse(again.json()).status).toBe('connected');
    expect((await auditOf(a, connId)).at(-1)!.action).toBe('admin.connection_reconnected');
  });

  it('test and reconnect stay admin-only and tenant-scoped', async () => {
    for (const def of [API.admin.testConnection, API.admin.reconnect]) {
      expect(
        (await call(t.app, def, { params: { id: connId }, cookie: k.maya, idempotencyKey: true })).statusCode,
      ).toBe(403);
      expect(
        (await call(t.app, def, { params: { id: connId }, cookie: k.adminB, idempotencyKey: true }))
          .statusCode,
      ).toBe(404);
    }
  });

  it('the server log never carries a token, code or state', () => {
    const text = log.join('');
    expect(secrets.length).toBeGreaterThanOrEqual(4);
    for (const s of secrets) expect(text).not.toContain(s);
  });
});

describe('Jira off', () => {
  it('without the Jira configuration, adding a Jira connection is refused (503)', async () => {
    const restore = applyJiraEnv({ TASK_CONNECTOR: 'simulated' });
    try {
      const res = await create(k.admin, { name: 'Off' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ code: 'CONNECTOR_UNAVAILABLE' });
    } finally {
      restore();
      applyJiraEnv(env);
    }
  });
});
