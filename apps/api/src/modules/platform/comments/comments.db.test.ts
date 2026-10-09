/** Comments: case readers may comment; never material; cross-tenant and hidden cases refused. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { withTenant } from '@growth-os/db';
import { assumptions, cases } from '@growth-os/fixtures-aster';
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
const c: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  c.daniel = await login(t.app, a.user('daniel'));
  c.admin = await login(t.app, a.user('admin'));
  c.danielB = await login(t.app, b.user('daniel'));
});
afterAll(async () => {
  await t.close();
});

const caseA = () => a.id(cases[0].id);
const asm01 = (s: SeededTenant) => s.id(assumptions[0].id);

describe('comments', () => {
  it('adds a comment on a case object, audits it and records no material change', async () => {
    const res = await call(t.app, API.comments.addComment, {
      params: { caseRef: 'ME-104' },
      body: { targetType: 'assumption', targetId: asm01(a), body: 'Please add the installed-base figure.' },
      cookie: c.daniel,
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json() as { id: string };
    await withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, async (tx) => {
      const row = await tx
        .selectFrom('platform.comment')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ case_id: caseA(), author_id: a.user('daniel'), target_type: 'assumption' });
      const audit = await tx
        .selectFrom('platform.audit_event')
        .selectAll()
        .where('object_id', '=', id)
        .execute();
      expect(audit.map((e) => e.action)).toEqual(['comment.added']);
      expect(JSON.stringify(audit)).not.toContain('installed-base');
      const mc = await tx.selectFrom('platform.material_change').select('id').execute();
      expect(mc).toEqual([]);
    });
  });

  it('accepts the case UUID as caseRef', async () => {
    const res = await call(t.app, API.comments.addComment, {
      params: { caseRef: caseA() },
      body: { targetType: 'case', targetId: caseA(), body: 'Looks good.' },
      cookie: c.daniel,
    });
    expect(res.statusCode).toBe(201);
  });

  it('refuses targets outside the case (404) and unknown target types (400)', async () => {
    const other = await call(t.app, API.comments.addComment, {
      params: { caseRef: 'ME-104' },
      body: { targetType: 'case', targetId: a.id(cases[1].id), body: 'x' },
      cookie: c.daniel,
    });
    expect(other.statusCode).toBe(404);
    const unknown = await call(t.app, API.comments.addComment, {
      params: { caseRef: 'ME-104' },
      body: { targetType: 'spreadsheet', targetId: randomUUID(), body: 'x' },
      cookie: c.daniel,
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('cross-tenant: a case or target of another tenant is not found', async () => {
    const res = await call(t.app, API.comments.addComment, {
      params: { caseRef: caseA() },
      body: { targetType: 'case', targetId: caseA(), body: 'x' },
      cookie: c.danielB,
    });
    expect(res.statusCode).toBe(404);
    const target = await call(t.app, API.comments.addComment, {
      params: { caseRef: 'ME-104' },
      body: { targetType: 'assumption', targetId: asm01(a), body: 'x' },
      cookie: c.danielB,
    });
    expect(target.statusCode).toBe(404);
  });

  it('unauthorized: an administrator cannot read the case, so cannot comment (404); no session is 401', async () => {
    const res = await call(t.app, API.comments.addComment, {
      params: { caseRef: 'ME-104' },
      body: { targetType: 'case', targetId: caseA(), body: 'x' },
      cookie: c.admin,
    });
    expect(res.statusCode).toBe(404);
    const anon = await call(t.app, API.comments.addComment, {
      params: { caseRef: 'ME-104' },
      body: { targetType: 'case', targetId: caseA(), body: 'x' },
    });
    expect(anon.statusCode).toBe(401);
  });
});
