/** Auth and viewer: dev persona picker, dev login, sessions, logout, GET /me (D-017, API.md §2). */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, Viewer } from '@growth-os/contracts';
import { withTenant } from '@growth-os/db';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';

let t: TestApp;
let a: SeededTenant;

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db);
});
afterAll(async () => {
  await t.close();
});

async function sessionAudit(userId: string) {
  return withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, (tx) =>
    tx
      .selectFrom('platform.audit_event')
      .select(['action', 'actor_user_id', 'object_type'])
      .where('actor_user_id', '=', userId)
      .where('object_type', '=', 'session')
      .orderBy('seq')
      .execute(),
  );
}

describe('dev persona picker', () => {
  it('lists the Aster personas in order (six + two committee members, D-109 §5), then the tenant administrator', async () => {
    // The canonical tenant may not be seeded in this database; point the picker at our isolated copy.
    const app = await createTestApp();
    app.app.platform.config.devTenantSlug = a.tenantSlug;
    const res = await call(app.app, API.auth.listDevPersonas);
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = API.auth.listDevPersonas.response.parse(res.json());
    expect(body.tenantName).toBe('Aster Industrial Systems');
    expect(body.personas.map((p) => p.person.displayName)).toEqual([
      'Elena Fischer',
      'Maya Rao',
      'Daniel Weber',
      'Jonas Klein',
      'Priya Shah',
      'Lena Hoffmann',
      'Katrin Vogel',
      'Thomas Berger',
      '[Tenant administrator]',
    ]);
    expect(body.personas[0]).toMatchObject({
      roleSummary: 'BU VP · Sponsor',
      landing: '/reviews?tab=awaiting',
    });
    expect(body.personas[8]?.landing).toBe('/admin/health');
  });

  it('does not register dev routes outside AUTH_MODE=dev', async () => {
    const app = await createTestApp({ authMode: 'oidc' });
    const res = await call(app.app, API.auth.devLogin, { body: { userId: a.user('maya') } });
    const personas = await call(app.app, API.auth.listDevPersonas);
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(personas.statusCode).toBe(404);
  });
});

describe('dev login and sessions', () => {
  it('signs in, sets an httpOnly SameSite=Lax cookie and returns the viewer', async () => {
    const res = await call(t.app, API.auth.devLogin, { body: { userId: a.user('elena') } });
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^gos_session=[\w-]{40,};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    const viewer = Viewer.parse(res.json());
    expect(viewer.user.displayName).toBe('Elena Fischer');
    expect(viewer.tenant.illustrative).toBe(true);
    expect(viewer.authority.map((g) => g.gateCode).sort()).toEqual(['G0', 'G1', 'G2', 'X']);
    expect(viewer.isAdmin).toBe(false);
    expect(await sessionAudit(a.user('elena'))).toContainEqual(
      expect.objectContaining({ action: 'auth.session_started' }),
    );
  });

  it('stores only the token hash, never the cookie token', async () => {
    const cookie = await login(t.app, a.user('daniel'));
    const token = cookie.split('=')[1]!;
    const rows = await withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, (tx) =>
      tx
        .selectFrom('platform.session')
        .select(['token_hash', 'interactive'])
        .where('user_id', '=', a.user('daniel'))
        .execute(),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.token_hash !== token && /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
    expect(rows.every((r) => r.interactive)).toBe(true);
  });

  it('GET /me returns roles, delegated authority, landing and admin flag', async () => {
    const maya = await login(t.app, a.user('maya'));
    const me = Viewer.parse((await call(t.app, API.auth.me, { cookie: maya })).json());
    expect(me.roles.map((r) => r.role)).toEqual(['case_owner']);
    expect(me.authority).toEqual([]);
    expect(me.landing).toBe('/me/overview?view=operator');

    const admin = await login(t.app, a.user('admin'));
    const am = Viewer.parse((await call(t.app, API.auth.me, { cookie: admin })).json());
    expect(am.isAdmin).toBe(true);
    expect(am.authority).toEqual([]); // admins configure, they never hold approval authority
    expect(am.landing).toBe('/admin/health');
  });

  it('refuses the agent principal (AGENT_IDENTITY_FORBIDDEN) and unknown users (404)', async () => {
    const agent = await call(t.app, API.auth.devLogin, { body: { userId: a.user('analysisAgent') } });
    expect(agent.statusCode).toBe(403);
    expect(agent.json().code).toBe('AGENT_IDENTITY_FORBIDDEN');
    const unknown = await call(t.app, API.auth.devLogin, { body: { userId: randomUUID() } });
    expect(unknown.statusCode).toBe(404);
  });

  it('refuses dev login into a non-illustrative tenant (404)', async () => {
    const b = await seedTenant(t.db);
    await withTenant(t.db, { tenantId: b.tenantId, userId: null, correlationId: 'test' }, (tx) =>
      tx.updateTable('platform.tenant').set({ illustrative: false }).where('id', '=', b.tenantId).execute(),
    );
    const res = await call(t.app, API.auth.devLogin, { body: { userId: b.user('maya') } });
    expect(res.statusCode).toBe(404);
  });

  it('logout revokes the session (then 401) and is audited; persona switch ends the old session', async () => {
    const jonas = await login(t.app, a.user('jonas'));
    expect((await call(t.app, API.auth.me, { cookie: jonas })).statusCode).toBe(200);

    // Switching persona with the same browser revokes the previous session.
    const switched = await call(t.app, API.auth.devLogin, {
      body: { userId: a.user('priya') },
      cookie: jonas,
    });
    expect(switched.statusCode).toBe(200);
    expect((await call(t.app, API.auth.me, { cookie: jonas })).statusCode).toBe(401);
    expect((await sessionAudit(a.user('jonas'))).map((r) => r.action)).toEqual([
      'auth.session_started',
      'auth.session_ended',
    ]);

    const priya = String(switched.headers['set-cookie']).split(';')[0]!;
    const out = await call(t.app, API.auth.logout, { cookie: priya });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/gos_session=;/);
    expect((await call(t.app, API.auth.me, { cookie: priya })).statusCode).toBe(401);
    expect((await call(t.app, API.auth.logout, { cookie: priya })).statusCode).toBe(401);
  });

  it('expired sessions are refused', async () => {
    const lena = await login(t.app, a.user('lena'));
    await withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, (tx) =>
      tx
        .updateTable('platform.session')
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where('user_id', '=', a.user('lena'))
        .execute(),
    );
    expect((await call(t.app, API.auth.me, { cookie: lena })).statusCode).toBe(401);
  });

  it('a session only ever sees its own tenant', async () => {
    const b = await seedTenant(t.db);
    const mayaB = await login(t.app, b.user('maya'));
    const me = Viewer.parse((await call(t.app, API.auth.me, { cookie: mayaB })).json());
    expect(me.tenant.id).toBe(b.tenantId);
    expect(me.user.id).toBe(b.user('maya'));
  });
});
