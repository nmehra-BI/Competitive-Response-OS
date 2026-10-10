/** Budget entries against the approved G2 budget (S11 meter): over-cap refused, append-only, scoped. */
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
import { activatePilot, auditActions, ids, problem, type Cookies } from '../gates/testkit';

let t: TestApp;
let a: SeededTenant;
let b: SeededTenant;
const k = {} as Cookies;

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  for (const p of ['jonas', 'daniel'] as const) k[p] = await login(t.app, a.user(p));
  k.jonasB = await login(t.app, b.user('jonas'));
});
afterAll(async () => {
  await t.close();
});

const entry = (gateRequestId: string, amount: string, kind = 'spent') => ({
  gateRequestId,
  kind,
  amount,
  currency: 'EUR',
  asOf: '2026-12-15',
  sourceText: 'Purchase order PO-118',
});

describe('budget.recordEntry', () => {
  it('needs an effective approval: G2 still awaiting → 409', async () => {
    const res = await call(t.app, API.budget.recordEntry, {
      params: { caseRef: 'ME-104' },
      body: entry(ids(a).g2, '1000.00'),
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(409);
    expect(problem(res.body).code).toBe('PRECONDITIONS_UNMET');
  });

  it('records spend; the meter shows spent and remaining; above €120k is refused (scope change)', async () => {
    await activatePilot(t, a);
    const daniel = await call(t.app, API.budget.recordEntry, {
      params: { caseRef: 'ME-104' },
      body: entry(ids(a).g2, '1000.00'),
      cookie: k.daniel,
      idempotencyKey: true,
    });
    expect(daniel.statusCode).toBe(403);
    const cross = await call(t.app, API.budget.recordEntry, {
      params: { caseRef: ids(a).case },
      body: entry(ids(a).g2, '1000.00'),
      cookie: k.jonasB,
      idempotencyKey: true,
    });
    expect(cross.statusCode).toBe(404);
    const usd = await call(t.app, API.budget.recordEntry, {
      params: { caseRef: 'ME-104' },
      body: { ...entry(ids(a).g2, '1000.00'), currency: 'USD' },
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(usd.statusCode).toBe(400);
    const ok = await call(t.app, API.budget.recordEntry, {
      params: { caseRef: 'ME-104' },
      body: entry(ids(a).g2, '45000.50'),
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(ok.statusCode).toBe(201);
    const e = API.budget.recordEntry.response.parse(ok.json());
    expect(e).toMatchObject({ kind: 'spent', amount: '45000.50', asOf: '2026-12-15' });
    expect(await auditActions(t, a, e.id)).toEqual(['budget.entry_recorded']);
    const over = await call(t.app, API.budget.recordEntry, {
      params: { caseRef: 'ME-104' },
      body: entry(ids(a).g2, '75000.00'),
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(over.statusCode).toBe(409);
    expect(problem(over.body).blockers![0]!.key).toBe('budget_ceiling');
    const exact = await call(t.app, API.budget.recordEntry, {
      params: { caseRef: 'ME-104' },
      body: entry(ids(a).g2, '74999.50'),
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(exact.statusCode).toBe(201);
    const pilot = API.pilot.get.response.parse(
      (await call(t.app, API.pilot.get, { params: { caseRef: 'ME-104' }, cookie: k.jonas })).json(),
    );
    expect(pilot.budget).toMatchObject({
      approved: { amount: '120000.00', measure: 'approved_budget', timeBasis: 'budget' },
      spent: { amount: '120000.00', measure: 'spent_to_date' },
      remaining: { amount: '0.00', measure: 'remaining_budget' },
      committed: { amount: '0.00' },
    });
  });
});
