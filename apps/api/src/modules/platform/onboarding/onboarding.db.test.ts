/**
 * First-run onboarding (CR-ONB-1, D-190 onward): GET derives the role guide from the viewer's own records,
 * PATCH records one change with an audit event, the dev-only reset clears the row in an illustrative
 * workspace. Cross-tenant isolation, unauthorized and agent attempts are refused by the API and the database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, OnboardingState } from '@growth-os/contracts';
import { sql, withTenant, type Tx } from '@growth-os/db';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';
import { agentCookie } from '../../me/gates/testkit';

let t: TestApp;
let a: SeededTenant;
let b: SeededTenant;
const k = {} as Record<'maya' | 'elena' | 'jonas' | 'daniel' | 'lena' | 'admin' | 'mayaB' | 'agent', string>;

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  for (const p of ['maya', 'elena', 'jonas', 'daniel', 'lena', 'admin'] as const)
    k[p] = await login(t.app, a.user(p));
  k.mayaB = await login(t.app, b.user('maya'));
  k.agent = await agentCookie(t, a);
});
afterAll(() => t.close());

const inTenant = <T>(s: SeededTenant, fn: (tx: Tx) => Promise<T>) =>
  withTenant(t.db, { tenantId: s.tenantId, userId: null, correlationId: 'onboarding-test' }, fn);

async function get(cookie: string) {
  const res = await call(t.app, API.onboarding.get, { cookie });
  expect(res.statusCode, res.body).toBe(200);
  return OnboardingState.parse(res.json());
}

async function patch(cookie: string, body: unknown) {
  return call(t.app, API.onboarding.update, { cookie, body, idempotencyKey: true });
}

const audits = (s: SeededTenant, action: string, userId: string) =>
  inTenant(s, (tx) =>
    tx
      .selectFrom('platform.audit_event')
      .select(['action', 'summary', 'actor_user_id'])
      .where('action', '=', action)
      .where('object_id', '=', userId)
      .execute(),
  );

describe('GET /me/onboarding', () => {
  it('a fresh person sees the welcome, their role path and steps derived from their own records', async () => {
    const maya = await get(k.maya);
    expect(maya).toMatchObject({
      path: 'build',
      welcomeSeen: false,
      explainer: 'not_started',
      guideDismissed: false,
      coachMarksDismissed: [],
      canReset: true,
      updatedAt: null,
    });
    expect(maya.steps.map((s) => s.key)).toEqual([
      'build.shortlist',
      'build.case',
      'build.sizing',
      'build.validation',
      'build.submitG2',
    ]);
    // aster-demo (26 Nov 2026): Maya owns ME-104 with committed sizing, EXP-03 and G2 v3 submitted.
    expect(maya.steps.every((s) => s.done)).toBe(true);
    expect(maya.steps.find((s) => s.key === 'build.sizing')!.href).toBe('/me/cases/ME-104/sizing');

    expect((await get(k.elena)).path).toBe('decide');
    expect((await get(k.jonas)).path).toBe('run');
    expect((await get(k.daniel)).path).toBe('review');
    expect((await get(k.lena)).path).toBe('review');
    expect((await get(k.admin)).path).toBe('configure');
  });

  it('decide: G1 was decided by Elena, so "Decide within your authority" is complete; visit steps are not', async () => {
    const elena = await get(k.elena);
    expect(elena.steps.map((s) => [s.key, s.completion, s.done])).toEqual([
      ['decide.reviews', 'visit', false],
      ['decide.package', 'visit', false],
      ['decide.decide', 'state', true],
    ]);
  });

  it('run: task sync completes only when one of the viewer’s tasks is Confirmed with an external key', async () => {
    // A fresh aster-demo copy: Jonas's validation tasks VAL-2…VAL-4 are Confirmed, so the step is complete.
    const c = await seedTenant(t.db, 'aster-demo');
    const jonasC = await login(t.app, c.user('jonas'));
    const taskSync = async () => (await get(jonasC)).steps.find((s) => s.key === 'run.taskSync')!.done;
    expect(await taskSync()).toBe(true);
    // Hand those tasks to Maya: Jonas has no Confirmed task left.
    await inTenant(c, (tx) =>
      sql`UPDATE platform.task t SET owner_user_id = ${c.user('maya')}
           WHERE t.owner_user_id = ${c.user('jonas')}
             AND EXISTS (SELECT 1 FROM platform.external_task_link l WHERE l.task_id = t.id)`.execute(tx),
    );
    expect(await taskSync()).toBe(false);
    // A pilot task that is still sending does not count…
    await inTenant(c, async (tx) => {
      const task = await tx
        .selectFrom('platform.task')
        .select('id')
        .where('owner_user_id', '=', c.user('jonas'))
        .where('title', '=', 'Confirm 4 pilot sites and contacts')
        .executeTakeFirstOrThrow();
      const conn = await tx
        .selectFrom('platform.connection')
        .select('id')
        .where('kind', '=', 'task_tool')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('platform.external_task_link')
        .values({
          tenant_id: c.tenantId,
          task_id: task.id,
          connection_id: conn.id,
          idempotency_key: 'onboarding-test-1',
          sync_status: 'sending',
        })
        .execute();
    });
    expect(await taskSync()).toBe(false);
    // …only "Confirmed · PIL-11" does (the table refuses Confirmed without a key).
    await inTenant(c, (tx) =>
      sql`UPDATE platform.external_task_link SET sync_status = 'confirmed', external_key = 'PIL-11',
            confirmed_at = now() WHERE idempotency_key = 'onboarding-test-1'`.execute(tx),
    );
    expect(await taskSync()).toBe(true);
  });
});

describe('PATCH /me/onboarding', () => {
  it('records the welcome and the explainer, audited, and the next sign-in reads it', async () => {
    const res = await patch(k.maya, { welcomeSeen: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(OnboardingState.parse(res.json()).welcomeSeen).toBe(true);
    await patch(k.maya, { explainer: 'completed' });
    await patch(k.maya, { explainer: 'skipped' }); // a skipped replay keeps the completion
    const again = await login(t.app, a.user('maya')); // another device
    const s = await get(again);
    expect(s).toMatchObject({ welcomeSeen: true, explainer: 'completed' });
    expect(s.updatedAt).not.toBeNull();
    const rows = await audits(a, 'onboarding.updated', a.user('maya'));
    expect(rows.map((r) => r.summary)).toEqual([
      'Getting started: welcome seen',
      'Getting started: tour watched',
      'Getting started: tour skipped',
    ]);
    expect(rows.every((r) => r.actor_user_id === a.user('maya'))).toBe(true);
  });

  it('a visit step completes by visiting; a state step and another path’s step are refused', async () => {
    const ok = await patch(k.elena, { visitedStep: 'decide.reviews' });
    expect(ok.statusCode).toBe(200);
    expect(OnboardingState.parse(ok.json()).steps[0]!.done).toBe(true);
    const derived = await patch(k.elena, { visitedStep: 'decide.decide' });
    expect(derived.statusCode).toBe(400);
    expect(derived.json().code).toBe('VALIDATION_FAILED');
    const other = await patch(k.elena, { visitedStep: 'build.shortlist' });
    expect(other.statusCode).toBe(400);
  });

  it('skips and resumes the guide and stores dismissed coach marks', async () => {
    await patch(k.daniel, { guideDismissed: true });
    await patch(k.daniel, { dismissCoachMark: 'review.requests' });
    expect(await get(k.daniel)).toMatchObject({
      guideDismissed: true,
      coachMarksDismissed: ['review.requests'],
    });
    await patch(k.daniel, { guideDismissed: false });
    expect((await get(k.daniel)).guideDismissed).toBe(false);
  });

  it('needs an Idempotency-Key and at least one change', async () => {
    const noKey = await call(t.app, API.onboarding.update, { cookie: k.lena, body: { welcomeSeen: true } });
    expect(noKey.statusCode).toBe(428);
    const empty = await patch(k.lena, {});
    expect(empty.statusCode).toBe(400);
    const unknown = await patch(k.lena, { approve: true });
    expect(unknown.statusCode).toBe(400);
  });

  it('without a session it is 401', async () => {
    expect((await call(t.app, API.onboarding.get)).statusCode).toBe(401);
  });
});

describe('isolation and refusals', () => {
  it('cross-tenant: another tenant’s person never sees or changes this tenant’s row (API and RLS)', async () => {
    // Maya A has a row (welcome seen). Maya B, same fixture person in tenant B, still gets a fresh state.
    expect((await get(k.mayaB)).welcomeSeen).toBe(false);
    await patch(k.mayaB, { welcomeSeen: true });
    expect((await get(k.maya)).explainer).toBe('completed'); // A untouched by B's write
    // Inside tenant B the database shows only B's rows, and refuses a row for A's person.
    const visible = await inTenant(b, (tx) =>
      tx.selectFrom('platform.user_onboarding').select(['tenant_id', 'user_id']).execute(),
    );
    expect(visible.every((r) => r.tenant_id === b.tenantId)).toBe(true);
    expect(visible.some((r) => r.user_id === a.user('maya'))).toBe(false);
    await expect(
      inTenant(b, (tx) =>
        sql`INSERT INTO platform.user_onboarding (tenant_id, user_id) VALUES (${a.tenantId}, ${a.user('elena')})`.execute(
          tx,
        ),
      ),
    ).rejects.toThrow(/row-level security|people only/); // the guard or RLS, whichever runs first
    await expect(
      inTenant(b, (tx) =>
        sql`INSERT INTO platform.user_onboarding (tenant_id, user_id) VALUES (${b.tenantId}, ${a.user('elena')})`.execute(
          tx,
        ),
      ),
    ).rejects.toThrow(/people only|person's tenant/);
  });

  it('agents are refused by the API (403) and by the database', async () => {
    const g = await call(t.app, API.onboarding.get, { cookie: k.agent });
    expect(g.statusCode).toBe(403);
    expect(g.json().code).toBe('AGENT_IDENTITY_FORBIDDEN');
    const p = await patch(k.agent, { welcomeSeen: true });
    expect(p.statusCode).toBe(403);
    expect(p.json().code).toBe('AGENT_IDENTITY_FORBIDDEN');
    const r = await call(t.app, API.onboarding.reset, { cookie: k.agent, idempotencyKey: true });
    expect(r.statusCode).toBe(403);
    await expect(
      inTenant(a, (tx) =>
        sql`INSERT INTO platform.user_onboarding (tenant_id, user_id)
            VALUES (${a.tenantId}, ${a.user('analysisAgent')})`.execute(tx),
      ),
    ).rejects.toThrow(/people only/);
  });

  it('a row cannot be moved to another person', async () => {
    await expect(
      inTenant(a, (tx) =>
        sql`UPDATE platform.user_onboarding SET user_id = ${a.user('jonas')} WHERE user_id = ${a.user('maya')}`.execute(
          tx,
        ),
      ),
    ).rejects.toThrow(/another person/);
  });
});

describe('POST /dev/onboarding/reset (demo only)', () => {
  it('clears the person’s own row, audited; others keep theirs', async () => {
    const res = await call(t.app, API.onboarding.reset, { cookie: k.maya, idempotencyKey: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(OnboardingState.parse(res.json())).toMatchObject({
      welcomeSeen: false,
      explainer: 'not_started',
      updatedAt: null,
    });
    expect(await audits(a, 'onboarding.reset', a.user('maya'))).toHaveLength(1);
    expect((await get(k.elena)).steps[0]!.done).toBe(true); // Elena's visit is kept
  });

  it('is forbidden (403) in a workspace that is not illustrative, and canReset says so', async () => {
    await inTenant(b, (tx) => sql`UPDATE platform.tenant SET illustrative = false`.execute(tx));
    expect((await get(k.mayaB)).canReset).toBe(false);
    const res = await call(t.app, API.onboarding.reset, { cookie: k.mayaB, idempotencyKey: true });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
    expect((await get(k.mayaB)).welcomeSeen).toBe(true); // nothing was cleared
  });

  it('does not exist outside dev auth mode', async () => {
    const prod = await createTestApp({ authMode: 'oidc' });
    try {
      const res = await prod.app.inject({ method: 'POST', url: '/api/v1/dev/onboarding/reset' });
      expect(res.statusCode).toBe(404);
    } finally {
      await prod.close();
    }
  });
});
