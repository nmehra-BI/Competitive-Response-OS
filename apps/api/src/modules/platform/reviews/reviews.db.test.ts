/** Reviews inbox (step 11) and review responses. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';
import { assessmentCase, auditActions, exp03Plan, ids, inTenant, type Cookies } from '../../me/gates/testkit';

let t: TestApp;
let a: SeededTenant;
let b: SeededTenant;
const k = {} as Cookies;
let requestId = '';

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  const { asmId } = await assessmentCase(t, a);
  for (const p of ['maya', 'elena', 'daniel', 'admin', 'priya'] as const)
    k[p] = await login(t.app, a.user(p));
  k.danielB = await login(t.app, b.user('daniel'));
  // G1 on ME-110 submitted by Maya (API).
  await call(t.app, API.experiments.create, {
    params: { caseRef: 'ME-110' },
    body: {
      title: 'Validation outreach · 20 sites',
      assumptionIds: [asmId],
      ownerId: a.user('maya'),
      fieldworkOwnerId: null,
      plan: exp03Plan(),
    },
    cookie: k.maya,
    idempotencyKey: true,
  });
  const cr = await call(t.app, API.gates.createRequest, {
    params: { caseRef: 'ME-110' },
    body: {
      gateCode: 'G1',
      scope: {
        amount: '15000.00',
        currency: 'EUR',
        durationDays: null,
        windowStart: null,
        windowEnd: null,
        countryCodes: ['AT'],
        segmentLabel: 'Dairy',
        maxSites: 20,
        milestones: [],
        ownerId: a.user('maya'),
        authorizes: ['Validation outreach'],
        doesNotAuthorize: ['Not a pilot'],
      },
      parentGateRequestId: null,
      proposedConditions: [],
    },
    cookie: k.maya,
    idempotencyKey: true,
  });
  await call(t.app, API.gates.submit, {
    params: { id: API.gates.createRequest.response.parse(cr.json()).id },
    cookie: k.maya,
    idempotencyKey: true,
  });
  // A review request for Daniel on the adoption assumption (WS4a `cases.requestReview` writes these).
  requestId = await inTenant(
    t,
    a,
    async (tx) =>
      (
        await tx
          .insertInto('platform.review_request')
          .values({
            tenant_id: a.tenantId,
            case_id: ids(a).case,
            area: 'finance',
            target_type: 'assumption',
            target_id: ids(a).asm('ASM-01'),
            question: 'Is 20% adoption supported?',
            what_to_check: ['Comparables', 'Ramp'],
            requested_by: a.user('maya'),
            reviewer_user_id: a.user('daniel'),
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id,
  );
});
afterAll(async () => {
  await t.close();
});

describe('reviews inbox', () => {
  it('step 11: Elena sees "Approve validation €15k" and "Approve pilot €120k · 90 days"', async () => {
    const res = await call(t.app, API.work.reviewsInbox, { cookie: k.elena });
    expect(res.statusCode).toBe(200);
    const inbox = API.work.reviewsInbox.response.parse(res.json());
    expect(inbox.gateDecisions.map((d) => [d.caseKey, d.buttonLabel])).toEqual(
      expect.arrayContaining([
        ['ME-110', 'Approve validation €15k'],
        ['ME-104', 'Approve pilot €120k · 90 days'],
      ]),
    );
    expect(inbox.gateDecisions.find((d) => d.caseKey === 'ME-104')!.href).toBe(
      `/me/cases/ME-104/decisions?gate=${ids(a).g2}`,
    );
  });

  it('authors, reviewers, admins and other tenants see no gate decisions', async () => {
    for (const c of [k.maya, k.daniel, k.admin, k.danielB]) {
      const inbox = API.work.reviewsInbox.response.parse(
        (await call(t.app, API.work.reviewsInbox, { cookie: c })).json(),
      );
      expect(inbox.gateDecisions).toEqual([]);
    }
    const other = API.work.reviewsInbox.response.parse(
      (await call(t.app, API.work.reviewsInbox, { cookie: k.danielB })).json(),
    );
    expect(other.reviewRequests.map((r) => r.id)).not.toContain(requestId);
  });

  it('Daniel’s economics tab lists his open finance review', async () => {
    const inbox = API.work.reviewsInbox.response.parse(
      (await call(t.app, API.work.reviewsInbox, { query: { tab: 'economics' }, cookie: k.daniel })).json(),
    );
    expect(inbox.reviewRequests.map((r) => [r.id, r.caseKey, r.status])).toEqual([
      [requestId, 'ME-104', 'open'],
    ]);
  });
});

describe('reviews.respond', () => {
  it('only the named reviewer responds (403); other tenants 404', async () => {
    const priya = await call(t.app, API.work.respondToReview, {
      params: { id: requestId },
      body: { response: 'confirm', reason: 'x' },
      cookie: k.priya,
      idempotencyKey: true,
    });
    expect(priya.statusCode).toBe(403);
    const cross = await call(t.app, API.work.respondToReview, {
      params: { id: requestId },
      body: { response: 'confirm', reason: 'x' },
      cookie: k.danielB,
      idempotencyKey: true,
    });
    expect(cross.statusCode).toBe(404);
  });

  it('a dispute on an assumption opens a dispute thread; answered once', async () => {
    const res = await call(t.app, API.work.respondToReview, {
      params: { id: requestId },
      body: { response: 'dispute', reason: 'No comparable evidence for 20%; plan on 10%.' },
      cookie: k.daniel,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(200);
    expect(API.work.respondToReview.response.parse(res.json())).toMatchObject({
      status: 'responded',
      response: 'dispute',
    });
    const disputes = await inTenant(t, a, (tx) =>
      tx
        .selectFrom('platform.challenge')
        .select(['kind', 'raised_by'])
        .where('target_id', '=', ids(a).asm('ASM-01'))
        .execute(),
    );
    expect(disputes.filter((d) => d.raised_by === a.user('daniel'))).toHaveLength(2); // seeded + new
    expect(await auditActions(t, a, requestId)).toEqual(['review_request.responded']);
    const again = await call(t.app, API.work.respondToReview, {
      params: { id: requestId },
      body: { response: 'confirm', reason: 'x' },
      cookie: k.daniel,
      idempotencyKey: true,
    });
    expect(again.statusCode).toBe(409);
    const done = API.work.reviewsInbox.response.parse(
      (await call(t.app, API.work.reviewsInbox, { query: { tab: 'done' }, cookie: k.daniel })).json(),
    );
    expect(done.reviewRequests.map((r) => r.id)).toEqual([requestId]);
  });
});
