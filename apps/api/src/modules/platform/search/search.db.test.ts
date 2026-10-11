/** ⌘K search: access-filtered hits, no content search, no cross-tenant results. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, type SearchHit } from '@growth-os/contracts';
import { withTenant } from '@growth-os/db';
import { businessUnits } from '@growth-os/fixtures-aster';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';
import { likePattern } from '.';

let t: TestApp;
let a: SeededTenant;
let b: SeededTenant;
let maya: string;
let admin: string;
let mayaB: string;

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-start');
  maya = await login(t.app, a.user('maya'));
  admin = await login(t.app, a.user('admin'));
  mayaB = await login(t.app, b.user('maya'));
  await withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, (tx) =>
    tx
      .insertInto('platform.workflow_case')
      .values({
        id: randomUUID(),
        tenant_id: a.tenantId,
        app_type: 'market_expansion',
        display_key: 'ME-901',
        title: 'German secret air programme',
        business_unit_id: a.id(businessUnits[1].id),
        owner_user_id: a.user('opsLead'),
        sponsor_user_id: a.user('opsLead'),
        stage: 'discovery',
        origin_type: 'direct',
        created_by: a.user('admin'),
      })
      .execute(),
  );
});
afterAll(async () => {
  await t.close();
});

const search = async (cookie: string, q: string, limit = 25) => {
  const res = await call(t.app, API.search.search, { cookie, query: { q, limit } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { hits: SearchHit[] }).hits;
};

describe('search', () => {
  it('finds cases, opportunities, assumptions, experiments, sources and mandates the viewer can access', async () => {
    const hits = await search(maya, 'German');
    const types = new Set(hits.map((h) => h.type));
    expect(types).toEqual(new Set(['case', 'mandate', 'opportunity', 'source']));
    expect(hits.find((h) => h.key === 'ME-104')?.href).toBe('/me/cases/ME-104/thesis');
    expect((await search(maya, 'EXP-03')).map((h) => h.key)).toEqual(['EXP-03']);
    expect((await search(maya, 'ASM-01')).map((h) => h.type)).toEqual(['assumption']);
  });

  it('never matches source content: passage text is not searched', async () => {
    expect(await search(maya, 'process-water treatment step')).toEqual([]);
  });

  it('does not return or count cases the viewer cannot access', async () => {
    const hits = await search(maya, 'German');
    expect(hits.map((h) => h.key)).not.toContain('ME-901');
    expect(await search(maya, 'secret air')).toEqual([]);
  });

  it('gives an administrator no business hits (admins read no cases)', async () => {
    expect(await search(admin, 'German')).toEqual([]);
  });

  it('cross-tenant: results come only from the caller tenant', async () => {
    const hitsB = await search(mayaB, 'OPP-07');
    expect(hitsB).toHaveLength(1);
    expect(hitsB[0]!.id).toBe(b.id('a57e000f-0000-4000-8000-000000000007'));
    expect(await search(mayaB, 'ME-104')).toEqual([]); // ME-104 exists only in tenant A
  });

  it('treats wildcards literally and validates the query', async () => {
    expect(likePattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%');
    expect(await search(maya, '%%%')).toEqual([]);
    expect((await search(maya, '20%')).map((h) => h.key)).toContain('ASM-01');
    const bad = await call(t.app, API.search.search, { cookie: maya, query: { q: '' } });
    expect(bad.statusCode).toBe(400);
    const anon = await call(t.app, API.search.search, { query: { q: 'German' } });
    expect(anon.statusCode).toBe(401);
  });
});
