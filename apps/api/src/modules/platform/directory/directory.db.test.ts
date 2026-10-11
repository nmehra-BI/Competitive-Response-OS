/**
 * Directory reads added by D-068 (§12–13), D-079: `people.list` and `catalogue.scopeOptions`.
 * People are active humans with a role (never agents or services; an admin only with the admin role);
 * scope options list the business units the viewer can see. Cross-tenant ids → 404; agents and people
 * without a role → 403; no session → 401.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { withTenant } from '@growth-os/db';
import { businessUnits } from '@growth-os/fixtures-aster';
import { hashToken } from '../../../platform/session';
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

const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'directory-test' }, fn);

/** A session for a principal that cannot use dev login (agent, or a person without a role). */
async function sessionFor(userId: string, interactive: boolean): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await inA((tx) =>
    tx
      .insertInto('platform.session')
      .values({
        tenant_id: a.tenantId,
        user_id: userId,
        token_hash: hashToken(token),
        auth_method: 'oidc',
        interactive,
        expires_at: new Date(Date.now() + 3600_000),
      })
      .execute(),
  );
  return `gos_session=${token}`;
}

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  for (const p of ['maya', 'elena', 'admin'] as const) k[p] = await login(t.app, a.user(p));
  k.agent = await sessionFor(a.user('analysisAgent'), false);
  const noRole = randomUUID();
  await inA((tx) =>
    tx
      .insertInto('platform.app_user')
      .values({
        id: noRole,
        tenant_id: a.tenantId,
        email: `norole-${noRole}@example.test`,
        display_name: 'No Role',
        initials: 'NR',
        kind: 'human',
      })
      .execute(),
  );
  k.noRole = await sessionFor(noRole, true);
});
afterAll(async () => {
  await t.close();
});

const people = (cookie: string | undefined, query?: Record<string, string>) =>
  call(t.app, API.directory.people, { cookie, query });
const scope = (cookie: string | undefined, query?: Record<string, string>) =>
  call(t.app, API.directory.scopeOptions, { cookie, query });

describe('people.list', () => {
  it('lists active people with roles; never agents or services; an admin only with the admin role', async () => {
    const res = await people(k.maya);
    expect(res.statusCode).toBe(200);
    const items = API.directory.people.response.parse(res.json()).items;
    const names = items.map((p) => p.displayName);
    expect(names).toEqual(
      expect.arrayContaining(['Elena Fischer', 'Maya Rao', 'Jonas Klein', 'Lena Hoffmann']),
    );
    expect(names).not.toContain('Analysis assistant');
    expect(names).not.toContain('No Role');
    expect(items.find((p) => p.displayName === 'Jonas Klein')!.roles).toEqual([
      'commercial_reviewer',
      'pilot_owner',
    ]);
    const admin = items.find((p) => p.id === a.user('admin'))!;
    expect(admin).toMatchObject({ roles: ['tenant_admin'], businessUnitIds: [] });
    // Sorted by name; no other tenant's people.
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
    expect(items.some((p) => p.id === b.user('maya'))).toBe(false);
  });

  it('filters by role and by business unit', async () => {
    const sponsors = API.directory.people.response.parse((await people(k.maya, { role: 'sponsor' })).json());
    expect(sponsors.items.map((p) => p.displayName)).toEqual(['Elena Fischer']);
    const water = a.id(businessUnits[0].id);
    const inWater = API.directory.people.response.parse(
      (await people(k.maya, { businessUnitId: water })).json(),
    ).items;
    expect(inWater.find((p) => p.displayName === 'Maya Rao')!.businessUnitIds).toEqual([water]);
    const air = API.directory.people.response.parse(
      (await people(k.maya, { businessUnitId: a.id(businessUnits[1].id) })).json(),
    ).items;
    // Nobody but the tenant-wide admin role reaches BU Air.
    expect(air.map((p) => p.id)).toEqual([a.user('admin')]);
  });

  it('cross-tenant 404, unauthorized 403 (agent, person without a role), no session 401', async () => {
    expect((await people(k.maya, { businessUnitId: b.id(businessUnits[0].id) })).statusCode).toBe(404);
    const agent = await people(k.agent);
    expect(agent.statusCode).toBe(403);
    expect(agent.json()).toMatchObject({ code: 'AGENT_IDENTITY_FORBIDDEN' });
    const none = await people(k.noRole);
    expect(none.statusCode).toBe(403);
    expect(none.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect((await people(undefined)).statusCode).toBe(401);
  });
});

describe('catalogue.scopeOptions', () => {
  it('lists the business units the viewer can see, products, segments and countries in use', async () => {
    const res = await scope(k.maya);
    expect(res.statusCode).toBe(200);
    const o = API.directory.scopeOptions.response.parse(res.json());
    expect(o.businessUnits.map((x) => x.name)).toEqual(['BU Water']); // BU Air is not Maya's
    expect(o.products.map((x) => x.key)).toContain('water-monitoring');
    expect(o.segments.map((x) => x.key)).toEqual(expect.arrayContaining(['food-processing', 'beverages']));
    expect(o.countries).toContain('DE');
    expect(o.countries).toEqual([...o.countries].sort());
    // A tenant administrator configures every business unit.
    const admin = API.directory.scopeOptions.response.parse((await scope(k.admin)).json());
    expect(admin.businessUnits.map((x) => x.name).sort()).toEqual(['BU Air', 'BU Water']);
  });

  it('cross-tenant and hidden business units 404, unauthorized 403, no session 401', async () => {
    expect((await scope(k.maya, { businessUnitId: b.id(businessUnits[0].id) })).statusCode).toBe(404);
    expect((await scope(k.maya, { businessUnitId: a.id(businessUnits[1].id) })).statusCode).toBe(404);
    expect((await scope(k.maya, { businessUnitId: a.id(businessUnits[0].id) })).statusCode).toBe(200);
    const agent = await scope(k.agent);
    expect(agent.statusCode).toBe(403);
    expect(agent.json()).toMatchObject({ code: 'AGENT_IDENTITY_FORBIDDEN' });
    expect((await scope(k.noRole)).statusCode).toBe(403);
    expect((await scope(undefined)).statusCode).toBe(401);
  });
});
