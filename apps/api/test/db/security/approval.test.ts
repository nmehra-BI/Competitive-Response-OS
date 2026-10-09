/**
 * Approval integrity (BUILD_PLAN §8 steps 18 and 29; CLAUDE.md never-rules 1, 2 and 6). A forced
 * decision is refused by the API in the D-046 order, and the database guard refuses what the API
 * would have refused (defence in depth).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../src/platform/testing';
import {
  agentCookie,
  analyticsFor,
  currentPackage,
  decideBody,
  g2Conditions,
  ids,
  inTenant,
  problem,
  type Cookies,
} from '../../../src/modules/me/gates/testkit';

let t: TestApp;
let a: SeededTenant;
let b: SeededTenant;
const k = {} as Cookies;

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  for (const p of ['maya', 'elena', 'daniel', 'admin', 'jonas'] as const)
    k[p] = await login(t.app, a.user(p));
  k.agent = await agentCookie(t, a);
  k.elenaB = await login(t.app, b.user('elena'));
});
afterAll(async () => {
  await t.close();
});

async function force(cookie: string, body: object, gateId = ids(a).g2) {
  return call(t.app, API.gates.decide, { params: { id: gateId }, body, cookie, idempotencyKey: true });
}

async function noDecisionWritten() {
  const rows = await inTenant(t, a, (tx) =>
    tx.selectFrom('platform.approval').select('id').where('gate_request_id', '=', ids(a).g2).execute(),
  );
  expect(rows).toEqual([]);
  expect(await analyticsFor(t, a, 'gate_approved')).toEqual([]);
}

describe('step 18: forced decisions on G2 v3 are refused', () => {
  it('Maya (case owner and package author) → SELF_APPROVAL_PROHIBITED', async () => {
    const pkg = await currentPackage(t, k.maya, ids(a).g2);
    expect(pkg.panel.canDecide).toBe(false);
    const res = await force(
      k.maya,
      decideBody(pkg, { disposition: 'approve_with_conditions', conditions: g2Conditions(a) }),
    );
    expect(res.statusCode).toBe(403);
    expect(problem(res.body)).toMatchObject({
      code: 'SELF_APPROVAL_PROHIBITED',
      title: 'You authored this package and cannot approve it.',
    });
    await noDecisionWritten();
  });

  it('the tenant administrator → FORBIDDEN ("Administrators … cannot approve gates")', async () => {
    const pkg = await currentPackage(t, k.elena, ids(a).g2);
    const res = await force(k.admin, decideBody(pkg));
    expect(res.statusCode).toBe(403);
    expect(problem(res.body)).toMatchObject({
      code: 'FORBIDDEN',
      title: 'Administrators configure roles and policies but cannot approve gates.',
    });
    await noDecisionWritten();
  });

  it('the analysis agent → AGENT_IDENTITY_FORBIDDEN', async () => {
    const pkg = await currentPackage(t, k.elena, ids(a).g2);
    const res = await force(k.agent, decideBody(pkg));
    expect(res.statusCode).toBe(403);
    expect(problem(res.body).code).toBe('AGENT_IDENTITY_FORBIDDEN');
    await noDecisionWritten();
  });

  it('a reviewer without a deciding role (Daniel) → FORBIDDEN; task ownership (Jonas) grants nothing', async () => {
    const pkg = await currentPackage(t, k.elena, ids(a).g2);
    for (const who of [k.daniel, k.jonas]) {
      const res = await force(who, decideBody(pkg));
      expect(res.statusCode).toBe(403);
      expect(problem(res.body).code).toBe('FORBIDDEN');
    }
    await noDecisionWritten();
  });

  it('a wrong hash → SNAPSHOT_HASH_MISMATCH; another snapshot id → SNAPSHOT_STALE (stale beats hash)', async () => {
    const pkg = await currentPackage(t, k.elena, ids(a).g2);
    const wrongHash = await force(k.elena, decideBody(pkg, { snapshotHash: 'f'.repeat(64) }));
    expect(wrongHash.statusCode).toBe(409);
    expect(problem(wrongHash.body).code).toBe('SNAPSHOT_HASH_MISMATCH');
    const v2 = await call(t.app, API.gates.package, {
      params: { id: ids(a).g2 },
      query: { version: 2 },
      cookie: k.elena,
    });
    const old = API.gates.package.response.parse(v2.json());
    expect(old.snapshot.status).toBe('superseded');
    const stale = await force(k.elena, decideBody(old, { snapshotHash: 'f'.repeat(64) }));
    expect(stale.statusCode).toBe(409);
    expect(problem(stale.body).code).toBe('SNAPSHOT_STALE');
    // Even the admin sees the stale snapshot refused before the admin check (D-046 order).
    const adminStale = await force(k.admin, decideBody(old));
    expect(problem(adminStale.body).code).toBe('SNAPSHOT_STALE');
    await noDecisionWritten();
  });

  it('a decision without a date-scoped grant is never written by the database guard either', async () => {
    const pkg = await currentPackage(t, k.elena, ids(a).g2);
    // Defence in depth: insert as Maya directly (bypassing the API) and expect the trigger to refuse.
    await expect(
      inTenant(t, a, async (tx) => {
        const s = await tx
          .insertInto('platform.session')
          .values({
            tenant_id: a.tenantId,
            user_id: a.user('maya'),
            token_hash: `test-${randomUUID()}`,
            auth_method: 'dev_persona',
            interactive: true,
            expires_at: new Date(Date.now() + 60_000),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await tx
          .insertInto('platform.approval')
          .values({
            tenant_id: a.tenantId,
            gate_request_id: ids(a).g2,
            snapshot_id: pkg.snapshot.id,
            snapshot_hash: pkg.snapshot.contentHash,
            approver_user_id: a.user('maya'),
            approver_role: 'case_owner',
            authority_grant_id: null,
            session_id: s.id,
            disposition: 'approve',
            rationale: 'forced',
            idempotency_key: randomUUID(),
          })
          .execute();
      }),
    ).rejects.toThrow(/SELF_APPROVAL_PROHIBITED|AUTHORITY_INSUFFICIENT|check/);
    await noDecisionWritten();
  });

  it('cross-tenant: Elena of another tenant gets 404, never a decision', async () => {
    const pkg = await currentPackage(t, k.elena, ids(a).g2);
    const res = await force(k.elenaB, decideBody(pkg));
    expect(res.statusCode).toBe(404);
    await noDecisionWritten();
  });

  it('then Elena approves exactly what she read; replaying the same key writes once', async () => {
    const pkg = await currentPackage(t, k.elena, ids(a).g2);
    const key = randomUUID();
    const body = decideBody(pkg, { disposition: 'approve_with_conditions', conditions: g2Conditions(a) });
    const r1 = await call(t.app, API.gates.decide, {
      params: { id: ids(a).g2 },
      body,
      cookie: k.elena,
      idempotencyKey: key,
    });
    const r2 = await call(t.app, API.gates.decide, {
      params: { id: ids(a).g2 },
      body,
      cookie: k.elena,
      idempotencyKey: key,
    });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    const rows = await inTenant(t, a, (tx) =>
      tx
        .selectFrom('platform.approval')
        .select(['snapshot_id', 'snapshot_hash', 'approver_user_id'])
        .where('gate_request_id', '=', ids(a).g2)
        .execute(),
    );
    expect(rows).toEqual([
      {
        snapshot_id: pkg.snapshot.id,
        snapshot_hash: pkg.snapshot.contentHash,
        approver_user_id: a.user('elena'),
      },
    ]);
    // A second decision on a decided gate is an invalid transition.
    const again = await force(k.elena, body);
    expect(problem(again.body).code).toBe('INVALID_TRANSITION');
  });
});

describe('step 29: the administrator cannot approve any gate', () => {
  it('admin deciding an open G2 (every disposition) or the approved G1 → FORBIDDEN or INVALID_TRANSITION, never a write', async () => {
    const s = await seedTenant(t.db, 'aster-demo');
    const admin = await login(t.app, s.user('admin'));
    const elena = await login(t.app, s.user('elena'));
    const pkg = await currentPackage(t, elena, ids(s).g2);
    for (const disposition of [
      'approve',
      'approve_with_conditions',
      'return_for_revision',
      'not_approved',
      'abstain',
    ]) {
      const res = await call(t.app, API.gates.decide, {
        params: { id: ids(s).g2 },
        body: decideBody(pkg, {
          disposition,
          conditions: disposition === 'approve_with_conditions' ? g2Conditions(s) : [],
        }),
        cookie: admin,
        idempotencyKey: true,
      });
      expect(res.statusCode).toBe(403);
      expect(problem(res.body).code).toBe('FORBIDDEN');
    }
    const g1 = await call(t.app, API.gates.decide, {
      params: { id: ids(s).g1 },
      body: decideBody(pkg),
      cookie: admin,
      idempotencyKey: true,
    });
    expect(g1.statusCode).toBe(409);
    const inbox = API.work.reviewsInbox.response.parse(
      (await call(t.app, API.work.reviewsInbox, { cookie: admin })).json(),
    );
    expect(inbox.gateDecisions).toEqual([]);
    const rows = await inTenant(t, s, (tx) =>
      tx
        .selectFrom('platform.approval')
        .select('id')
        .where('approver_user_id', '=', s.user('admin'))
        .execute(),
    );
    expect(rows).toEqual([]);
  });
});
