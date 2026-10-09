/**
 * Command pipeline integration tests (real Postgres, RLS on). Synthetic endpoints exercise each
 * step: session, validation, human-only, Idempotency-Key, If-Match, authorize, transaction,
 * audit requirement, analytics whitelist, response contract, error model.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { API, endpoint, ProblemDetails } from '@growth-os/contracts';
import { sql, withTenant } from '@growth-os/db';
import { roleAllows, signedIn } from './authz';
import { beginIdempotent } from './idempotency';
import { assertIfMatch, command, query, type HandlerMap } from './pipeline';
import { authHandlers } from '../modules/platform/auth';
import { hashToken } from './session';
import { call, createTestApp, login, seedTenant, type SeededTenant, type TestApp } from './testing';

const base = { summary: 'test', screens: ['SHELL' as const], prd: ['ME-17'] };
const E = {
  cmd: endpoint({
    ...base,
    id: 'test.cmd',
    method: 'POST',
    path: '/test/cmd',
    auth: 'human',
    idempotent: true,
    body: z.object({ n: z.number().int(), fail: z.boolean().default(false) }),
    response: z.object({ n: z.number().int(), objectId: z.string().uuid() }),
  }),
  draft: endpoint({
    ...base,
    id: 'test.draft',
    method: 'PATCH',
    path: '/test/draft',
    ifMatch: true,
    body: z.object({ title: z.string() }),
    response: z.object({ rowVersion: z.number().int() }),
  }),
  noAudit: endpoint({
    ...base,
    id: 'test.noAudit',
    method: 'POST',
    path: '/test/no-audit',
    response: z.object({}),
  }),
  adminOnly: endpoint({
    ...base,
    id: 'test.adminOnly',
    method: 'POST',
    path: '/test/admin',
    response: z.object({}),
  }),
  hidden: endpoint({
    ...base,
    id: 'test.hidden',
    method: 'GET',
    path: '/test/hidden',
    response: z.object({}),
  }),
  leak: endpoint({
    ...base,
    id: 'test.leak',
    method: 'POST',
    path: '/test/leak',
    response: z.object({}),
  }),
  read: endpoint({
    ...base,
    id: 'test.read',
    method: 'GET',
    path: '/test/read/:id',
    params: z.object({ id: z.string().uuid() }),
    query: z.object({ limit: z.coerce.number().int().min(1).max(5) }),
    response: z.object({ id: z.string(), tenantId: z.string() }),
  }),
  badResponse: endpoint({
    ...base,
    id: 'test.badResponse',
    method: 'GET',
    path: '/test/bad',
    response: z.object({ ok: z.boolean() }),
  }),
};

const objectIds = new Map<string, string>();
let draftVersion = 3;

const handlers: HandlerMap = {
  ...authHandlers,
  [E.cmd.id]: command(E.cmd, {
    authorize: () => signedIn,
    handle: async (ctx, t) => {
      const objectId = randomUUID();
      await t.audit({ action: 'test.done', objectType: 'test', objectId, summary: `n=${ctx.body.n}` });
      await t.analytics('mandate_created', { objectType: 'test', objectId }, { hasSponsor: true });
      await t.enqueue('test.noop', { objectId });
      objectIds.set(ctx.correlationId, objectId);
      if (ctx.body.fail) throw new Error('boom after writes');
      return { n: ctx.body.n, objectId };
    },
  }),
  [E.draft.id]: command(E.draft, {
    authorize: () => signedIn,
    handle: async (ctx, t) => {
      assertIfMatch(ctx, draftVersion);
      draftVersion++;
      ctx.setETag(draftVersion);
      await t.audit({
        action: 'test.draft_saved',
        objectType: 'test',
        objectId: randomUUID(),
        summary: 'saved',
      });
      return { rowVersion: draftVersion };
    },
  }),
  [E.noAudit.id]: command(E.noAudit, { authorize: () => signedIn, handle: async () => ({}) }),
  [E.adminOnly.id]: command(E.adminOnly, {
    authorize: (ctx) => roleAllows(ctx.identity.subject, 'admin.configure'),
    handle: async (_ctx, t) => {
      await t.audit({ action: 'test.admin', objectType: 'test', objectId: randomUUID(), summary: 'admin' });
      return {};
    },
  }),
  [E.hidden.id]: query(E.hidden, {
    authorize: () => ({ allow: false, rule: 'test', code: 'NOT_FOUND', reason: 'secret' }),
    handle: async () => ({}),
  }),
  [E.leak.id]: command(E.leak, {
    authorize: () => signedIn,
    handle: async (_ctx, t) => {
      await t.audit({ action: 'test.leak', objectType: 'test', objectId: randomUUID(), summary: 'leak' });
      // A restricted text field is not in the PRD §17 whitelist for this event.
      await t.analytics('evidence_reviewed', { objectType: 'source', objectId: randomUUID() }, {
        action: 'challenge',
        excerpt: 'licensed text',
      } as never);
      return {};
    },
  }),
  [E.read.id]: query(E.read, {
    authorize: () => signedIn,
    handle: async (ctx) => ({ id: ctx.params.id, tenantId: ctx.tenantId, extra: 'stripped' }) as never,
  }),
  [E.badResponse.id]: query(E.badResponse, {
    authorize: () => signedIn,
    handle: async () => ({ ok: 'yes' }) as never,
  }),
};

let t: TestApp;
let a: SeededTenant;
let maya: string;
let admin: string;

beforeAll(async () => {
  t = await createTestApp({ handlers, endpoints: [...Object.values(E), ...Object.values(API.auth)] });
  a = await seedTenant(t.db);
  maya = await login(t.app, a.user('maya'));
  admin = await login(t.app, a.user('admin'));
});
afterAll(async () => {
  await t.close();
});

const problem = (body: string) => ProblemDetails.parse(JSON.parse(body));

async function countRows(
  table: 'platform.audit_event' | 'platform.analytics_event',
  where: { correlationId?: string },
) {
  return withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, async (tx) => {
    if (table === 'platform.audit_event') {
      const r = await tx
        .selectFrom('platform.audit_event')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('correlation_id', '=', where.correlationId!)
        .executeTakeFirstOrThrow();
      return Number(r.n);
    }
    const r = await tx
      .selectFrom('platform.analytics_event')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where(sql<string>`envelope->>'correlationId'`, '=', where.correlationId!)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  });
}

describe('session and validation', () => {
  it('rejects a request without a session with 401 problem+json', async () => {
    const res = await call(t.app, E.cmd, { body: { n: 1 }, idempotencyKey: true });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(problem(res.body).code).toBe('UNAUTHENTICATED');
  });

  it('rejects an unknown cookie token', async () => {
    const res = await call(t.app, E.read, {
      params: { id: randomUUID() },
      query: { limit: 1 },
      cookie: 'gos_session=not-a-real-token',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns VALIDATION_FAILED with field paths for bad params, query and body', async () => {
    const res = await call(t.app, E.read, { params: { id: 'nope' }, query: { limit: 9 }, cookie: maya });
    expect(res.statusCode).toBe(400);
    const p = problem(res.body);
    expect(p.code).toBe('VALIDATION_FAILED');
    expect(p.errors?.map((e) => e.path)).toContain('params.id');

    const res2 = await call(t.app, E.cmd, { body: { n: 'x' }, cookie: maya, idempotencyKey: true });
    expect(problem(res2.body).errors?.[0]?.path).toBe('body.n');
  });

  it('refuses form posts (CSRF: application/json only)', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/test/no-audit',
      headers: { cookie: maya, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'a=1',
    });
    expect(res.statusCode).toBe(400);
    expect(problem(res.body).code).toBe('VALIDATION_FAILED');
  });

  it('strips fields the response contract does not declare and echoes the correlation id', async () => {
    const id = randomUUID();
    const res = await call(t.app, E.read, {
      params: { id },
      query: { limit: 2 },
      cookie: maya,
      headers: { 'x-correlation-id': 'corr-123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id, tenantId: a.tenantId });
    expect(res.headers['x-correlation-id']).toBe('corr-123');
  });

  it('turns a response that breaks its contract into INTERNAL without details', async () => {
    const res = await call(t.app, E.badResponse, { cookie: maya });
    expect(res.statusCode).toBe(500);
    expect(problem(res.body).title).toBe('Unexpected error');
  });
});

describe('human-only endpoints', () => {
  it('refuses an agent principal holding a session with AGENT_IDENTITY_FORBIDDEN', async () => {
    const token = randomBytes(24).toString('base64url');
    await withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, async (tx) => {
      await tx
        .insertInto('platform.session')
        .values({
          tenant_id: a.tenantId,
          user_id: a.user('analysisAgent'),
          token_hash: hashToken(token),
          auth_method: 'oidc',
          interactive: false,
          expires_at: new Date(Date.now() + 3600_000),
        })
        .execute();
    });
    const res = await call(t.app, E.cmd, {
      body: { n: 1 },
      cookie: `gos_session=${token}`,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(403);
    expect(problem(res.body).code).toBe('AGENT_IDENTITY_FORBIDDEN');
  });
});

describe('Idempotency-Key', () => {
  it('is required (428) on idempotent endpoints', async () => {
    const res = await call(t.app, E.cmd, { body: { n: 1 }, cookie: maya });
    expect(res.statusCode).toBe(428);
    expect(problem(res.body).code).toBe('PRECONDITION_REQUIRED');
  });

  it('replays the stored response for the same key and body, writing once', async () => {
    const key = randomUUID();
    const corr = `idem-${key}`;
    const r1 = await call(t.app, E.cmd, {
      body: { n: 7 },
      cookie: maya,
      idempotencyKey: key,
      headers: { 'x-correlation-id': corr },
    });
    const r2 = await call(t.app, E.cmd, {
      body: { n: 7 },
      cookie: maya,
      idempotencyKey: key,
      headers: { 'x-correlation-id': `${corr}-b` },
    });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r2.json()).toEqual(r1.json());
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(await countRows('platform.audit_event', { correlationId: corr })).toBe(1);
    expect(await countRows('platform.audit_event', { correlationId: `${corr}-b` })).toBe(0);
    expect(await countRows('platform.analytics_event', { correlationId: corr })).toBe(1);
  });

  it('refuses the same key with a different body (422 IDEMPOTENCY_KEY_REUSED)', async () => {
    const key = randomUUID();
    await call(t.app, E.cmd, { body: { n: 1 }, cookie: maya, idempotencyKey: key });
    const res = await call(t.app, E.cmd, { body: { n: 2 }, cookie: maya, idempotencyKey: key });
    expect(res.statusCode).toBe(422);
    expect(problem(res.body).code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('answers 409 IDEMPOTENCY_IN_PROGRESS while the first request is still running', async () => {
    const key = randomUUID();
    const body = { n: 3, fail: false };
    // Simulate a concurrent first request holding the key.
    const { sha256Hex, stableStringify } = await import('./hash');
    await beginIdempotent(
      t.db,
      {
        tenantId: a.tenantId,
        userId: a.user('maya'),
        key,
        method: 'POST',
        route: E.cmd.id,
        requestHash: sha256Hex(stableStringify({ op: E.cmd.id, params: {}, query: {}, body, files: [] })),
        correlationId: 'test',
      },
      new Date(),
      60_000,
    );
    const res = await call(t.app, E.cmd, { body, cookie: maya, idempotencyKey: key });
    expect(res.statusCode).toBe(409);
    expect(problem(res.body).code).toBe('IDEMPOTENCY_IN_PROGRESS');
  });

  it('rolls back every write when the handler fails, and frees the key for a retry', async () => {
    const key = randomUUID();
    const corr = `fail-${key}`;
    const r1 = await call(t.app, E.cmd, {
      body: { n: 4, fail: true },
      cookie: maya,
      idempotencyKey: key,
      headers: { 'x-correlation-id': corr },
    });
    expect(r1.statusCode).toBe(500);
    expect(await countRows('platform.audit_event', { correlationId: corr })).toBe(0);
    expect(await countRows('platform.analytics_event', { correlationId: corr })).toBe(0);
    const r2 = await call(t.app, E.cmd, { body: { n: 4 }, cookie: maya, idempotencyKey: key });
    expect(r2.statusCode).toBe(201);
  });

  it('scopes keys per user: the same key from another user is a new request', async () => {
    const key = randomUUID();
    const daniel = await login(t.app, a.user('daniel'));
    const r1 = await call(t.app, E.cmd, { body: { n: 5 }, cookie: maya, idempotencyKey: key });
    const r2 = await call(t.app, E.cmd, { body: { n: 5 }, cookie: daniel, idempotencyKey: key });
    expect(r2.statusCode).toBe(201);
    expect(r2.json().objectId).not.toBe(r1.json().objectId);
  });
});

describe('If-Match', () => {
  it('is required (428) on draft writes', async () => {
    const res = await call(t.app, E.draft, { body: { title: 'x' }, cookie: maya });
    expect(res.statusCode).toBe(428);
  });

  it('returns 412 VERSION_CONFLICT for a stale row version and sets ETag on success', async () => {
    const stale = await call(t.app, E.draft, {
      body: { title: 'x' },
      cookie: maya,
      ifMatch: draftVersion - 1,
    });
    expect(stale.statusCode).toBe(412);
    expect(problem(stale.body).code).toBe('VERSION_CONFLICT');
    const ok = await call(t.app, E.draft, { body: { title: 'x' }, cookie: maya, ifMatch: draftVersion });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.etag).toBe(`"${draftVersion}"`);
  });

  it('rejects a malformed If-Match value', async () => {
    const res = await call(t.app, E.draft, { body: { title: 'x' }, cookie: maya, ifMatch: 'banana' });
    expect(res.statusCode).toBe(400);
  });
});

describe('authorization, audit and analytics invariants', () => {
  it('denies by role with 403 FORBIDDEN, and an admin passes', async () => {
    const res = await call(t.app, E.adminOnly, { cookie: maya });
    expect(res.statusCode).toBe(403);
    expect(problem(res.body).code).toBe('FORBIDDEN');
    expect((await call(t.app, E.adminOnly, { cookie: admin })).statusCode).toBe(201);
  });

  it('hides resources with 404 and never echoes the deny reason', async () => {
    const res = await call(t.app, E.hidden, { cookie: maya });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('secret');
  });

  it('refuses to commit a command that wrote no audit event', async () => {
    const res = await call(t.app, E.noAudit, { cookie: maya });
    expect(res.statusCode).toBe(500);
  });

  it('refuses analytics properties outside the PRD §17 whitelist and rolls back the audit row', async () => {
    const corr = `leak-${randomUUID()}`;
    const res = await call(t.app, E.leak, { cookie: maya, headers: { 'x-correlation-id': corr } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('licensed text');
    expect(await countRows('platform.audit_event', { correlationId: corr })).toBe(0);
  });

  it('records actor, role, authz rule and correlation id on the audit event', async () => {
    const corr = `audit-${randomUUID()}`;
    const res = await call(t.app, E.adminOnly, { cookie: admin, headers: { 'x-correlation-id': corr } });
    expect(res.statusCode).toBe(201);
    const row = await withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, (tx) =>
      tx
        .selectFrom('platform.audit_event')
        .selectAll()
        .where('correlation_id', '=', corr)
        .executeTakeFirstOrThrow(),
    );
    expect(row.actor_user_id).toBe(a.user('admin'));
    expect(row.actor_kind).toBe('human');
    expect(row.actor_role).toBe('tenant_admin');
    expect(row.authz_context).toMatchObject({ decision: 'allow', rule: 'role:tenant_admin:admin.configure' });
  });

  it('enqueues jobs in the same transaction: present after commit, absent after rollback', async () => {
    const jobs = async (corr: string) => {
      const { sql } = await import('@growth-os/db');
      const r = await sql<{ n: string; tenant: string | null }>`
        SELECT count(*)::text AS n, max(j.payload->>'tenantId') AS tenant
          FROM graphile_worker._private_jobs j JOIN graphile_worker._private_tasks k ON k.id = j.task_id
         WHERE k.identifier = 'test.noop' AND j.payload->>'correlationId' = ${corr}`.execute(t.db);
      return { n: Number(r.rows[0]!.n), tenant: r.rows[0]!.tenant };
    };
    const ok = `job-ok-${randomUUID()}`;
    const failed = `job-fail-${randomUUID()}`;
    for (const [corr, fail] of [
      [ok, false],
      [failed, true],
    ] as const)
      await call(t.app, E.cmd, {
        body: { n: 9, fail },
        cookie: maya,
        idempotencyKey: true,
        headers: { 'x-correlation-id': corr },
      });
    expect(await jobs(ok)).toEqual({ n: 1, tenant: a.tenantId });
    expect((await jobs(failed)).n).toBe(0);
  });
});

describe('tenancy', () => {
  it('runs every handler inside the caller tenant (RLS context set)', async () => {
    const b = await seedTenant(t.db);
    const elenaB = await login(t.app, b.user('elena'));
    const res = await call(t.app, E.read, {
      params: { id: randomUUID() },
      query: { limit: 1 },
      cookie: elenaB,
    });
    expect(res.json().tenantId).toBe(b.tenantId);
    expect(b.tenantId).not.toBe(a.tenantId);
  });
});
