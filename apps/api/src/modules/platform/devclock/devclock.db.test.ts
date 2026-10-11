/**
 * Dev clock (D-091): forward-only, audited, dev-only, illustrative tenants only; business time moves for
 * that tenant's commands and reads, never for another tenant, and the routes do not exist outside dev.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { sql, withTenant } from '@growth-os/db';
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
let b: SeededTenant;
const k: Record<string, string> = {};
const DAY = 86_400_000;

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  k.maya = await login(t.app, a.user('maya'));
  k.mayaB = await login(t.app, b.user('maya'));
});
afterAll(() => t.close());

const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, fn);

describe('dev clock', () => {
  it('starts at real time and moves forward by days or to a moment, audited, with the timers enqueued', async () => {
    const before = API.dev.clock.response.parse(
      (await call(t.app, API.dev.clock, { cookie: k.maya })).json(),
    );
    expect(before.offsetMs).toBe(0);
    const res = await call(t.app, API.dev.setClock, { body: { advanceDays: 10 }, cookie: k.maya });
    expect(res.statusCode).toBe(200);
    const c = API.dev.setClock.response.parse(res.json());
    expect(c.offsetMs).toBeGreaterThanOrEqual(10 * DAY - 1000);
    expect(new Date(c.now).getTime() - Date.now()).toBeGreaterThan(9 * DAY);
    const rows = await inA(async (tx) => ({
      audit: await tx
        .selectFrom('platform.audit_event')
        .select('action')
        .where('action', '=', 'dev.clock_set')
        .execute(),
      jobs: await sql<{ n: number }>`SELECT count(*)::int AS n FROM graphile_worker._private_jobs j
        JOIN graphile_worker._private_tasks k ON k.id = j.task_id
        WHERE k.identifier IN ('timers.pilot_window','timers.approval_expiry')
          AND j.payload->>'tenantId' = ${a.tenantId}`.execute(tx),
    }));
    expect(rows.audit).toHaveLength(1);
    expect(rows.jobs.rows[0]!.n).toBeGreaterThanOrEqual(2);
  });

  it('never moves back (API 400 and the database refuses a smaller offset)', async () => {
    const back = await call(t.app, API.dev.setClock, {
      body: { to: new Date().toISOString() },
      cookie: k.maya,
    });
    expect(back.statusCode).toBe(400);
    await expect(inA((tx) => sql`UPDATE platform.dev_clock SET offset_ms = 0`.execute(tx))).rejects.toThrow(
      /only moves forward/,
    );
  });

  it('business time follows the clock for this tenant only', async () => {
    const mine = API.dev.clock.response.parse((await call(t.app, API.dev.clock, { cookie: k.maya })).json());
    const theirs = API.dev.clock.response.parse(
      (await call(t.app, API.dev.clock, { cookie: k.mayaB })).json(),
    );
    expect(new Date(mine.now).getTime() - new Date(theirs.now).getTime()).toBeGreaterThan(9 * DAY);
    expect(theirs.offsetMs).toBe(0);
  });

  it('is refused for a tenant that is not illustrative (API and database)', async () => {
    await withTenant(t.db, { tenantId: b.tenantId, userId: null, correlationId: 'test' }, (tx) =>
      sql`UPDATE platform.tenant SET illustrative = false`.execute(tx),
    );
    const res = await call(t.app, API.dev.setClock, { body: { advanceDays: 1 }, cookie: k.mayaB });
    expect(res.statusCode).toBe(403);
    await expect(
      withTenant(t.db, { tenantId: b.tenantId, userId: null, correlationId: 'test' }, (tx) =>
        sql`INSERT INTO platform.dev_clock (tenant_id, offset_ms, set_by)
            VALUES (${b.tenantId}, 1000, ${b.user('maya')})`.execute(tx),
      ),
    ).rejects.toThrow(/illustrative tenants only/);
  });

  it('does not exist outside AUTH_MODE=dev', async () => {
    const prod = await createTestApp({ authMode: 'oidc' });
    try {
      const res = await prod.app.inject({ method: 'GET', url: '/api/v1/dev/clock' });
      expect(res.statusCode).toBe(404);
    } finally {
      await prod.close();
    }
  });
});
