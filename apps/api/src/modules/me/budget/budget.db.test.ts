/** Budget entries against the approved G2 budget (S11 meter): over-cap refused, append-only, scoped. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, type BudgetEntry } from '@growth-os/contracts';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';
import { activatePilot, auditActions, ids, inTenant, problem, type Cookies } from '../gates/testkit';

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

// ---------------------------------------------------------------------------------------------------
// Wave 4: S11 "Record spend" (D-114 §2, D-133) — reference, task link, reversing entries, list + meter.
// ---------------------------------------------------------------------------------------------------

describe('record spend: reference, task, reversals (append-only)', () => {
  let s: SeededTenant;
  const c = {} as Record<'jonas' | 'maya' | 'daniel' | 'opsLead', string>;
  let taskId: string;
  let first: BudgetEntry;
  let reversal: BudgetEntry;
  const list = (cookie: string, caseRef = 'ME-104') =>
    call(t.app, API.budget.listEntries, { params: { caseRef }, cookie });

  beforeAll(async () => {
    s = await seedTenant(t.db, 'aster-demo');
    for (const p of ['jonas', 'maya', 'daniel', 'opsLead'] as const) c[p] = await login(t.app, s.user(p));
    await activatePilot(t, s);
    const v = API.pilot.get.response.parse(
      (await call(t.app, API.pilot.get, { params: { caseRef: 'ME-104' }, cookie: c.jonas })).json(),
    );
    taskId = v.taskSet!.tasks[0]!.id;
  });

  it('records €8k spent with a PO number and a task link; listEntries returns it and the meter', async () => {
    const res = await call(t.app, API.budget.recordEntry, {
      params: { caseRef: 'ME-104' },
      body: { ...entry(ids(s).g2, '8000.00'), reference: 'PO-4471', taskId, sourceText: 'Sensor kits' },
      cookie: c.jonas,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(201);
    first = API.budget.recordEntry.response.parse(res.json());
    expect(first).toMatchObject({
      kind: 'spent',
      amount: '8000.00',
      currency: 'EUR',
      reference: 'PO-4471',
      taskId,
      reversesEntryId: null,
      reversedByEntryId: null,
      recordedBy: { displayName: 'Jonas Klein' },
    });
    expect(await auditActions(t, s, first.id)).toEqual(['budget.entry_recorded']);
    const l = await list(c.opsLead); // a read-only reviewer may read the entries
    expect(l.statusCode).toBe(200);
    const out = API.budget.listEntries.response.parse(l.json());
    expect(out.items.map((e) => e.id)).toEqual([first.id]);
    expect(out.meter).toMatchObject({
      approved: { amount: '120000.00' },
      spent: { amount: '8000.00' },
      remaining: { amount: '112000.00' },
    });
  });

  it('refuses a task of another tenant (400) and spend above the remaining amount with "Request scope change"', async () => {
    const otherTask = await inTenant(t, b, (tx) =>
      tx.selectFrom('platform.task').select('id').executeTakeFirstOrThrow(),
    );
    const foreign = await call(t.app, API.budget.recordEntry, {
      params: { caseRef: 'ME-104' },
      body: { ...entry(ids(s).g2, '10.00'), taskId: otherTask.id },
      cookie: c.jonas,
      idempotencyKey: true,
    });
    expect(foreign.statusCode).toBe(400);
    const over = await call(t.app, API.budget.recordEntry, {
      params: { caseRef: 'ME-104' },
      body: { ...entry(ids(s).g2, '130000.00'), reference: 'PO-4480' },
      cookie: c.jonas,
      idempotencyKey: true,
    });
    expect(over.statusCode).toBe(409);
    const p = problem(over.body);
    expect(p.code).toBe('PRECONDITIONS_UNMET');
    expect(p.title).toBe('This would exceed the approved €120k. Request a scope change.');
    expect(p.blockers![0]).toMatchObject({
      key: 'budget_ceiling',
      gate: 'G2',
      href: '/me/cases/ME-104/pilot?view=scope',
    });
    expect(p.blockers![0]!.message).toBe('Spend above the remaining €112k needs a scope-change request');
    const zero = await call(t.app, API.budget.recordEntry, {
      params: { caseRef: 'ME-104' },
      body: entry(ids(s).g2, '0.00'),
      cookie: c.jonas,
      idempotencyKey: true,
    });
    expect(zero.statusCode).toBe(400);
  });

  it('reverses with a reason (reason required); the meter subtracts; replay returns the same reversal', async () => {
    const noReason = await call(t.app, API.budget.reverseEntry, {
      params: { id: first.id },
      body: { reason: '   ' },
      cookie: c.jonas,
      idempotencyKey: true,
    });
    expect(noReason.statusCode).toBe(400);
    const key = randomUUID();
    const res = await call(t.app, API.budget.reverseEntry, {
      params: { id: first.id },
      body: { reason: 'Invoice booked twice' },
      cookie: c.jonas,
      idempotencyKey: key,
    });
    expect(res.statusCode).toBe(201);
    reversal = API.budget.reverseEntry.response.parse(res.json());
    expect(reversal).toMatchObject({
      kind: 'spent',
      amount: '8000.00',
      reversesEntryId: first.id,
      reversalReason: 'Invoice booked twice',
      reference: 'PO-4471',
    });
    const replay = await call(t.app, API.budget.reverseEntry, {
      params: { id: first.id },
      body: { reason: 'Invoice booked twice' },
      cookie: c.jonas,
      idempotencyKey: key,
    });
    expect(API.budget.reverseEntry.response.parse(replay.json()).id).toBe(reversal.id);
    expect(await auditActions(t, s, reversal.id)).toEqual(['budget.entry_reversed']);
    const out = API.budget.listEntries.response.parse((await list(c.jonas)).json());
    expect(out.items.map((e) => [e.id, e.reversedByEntryId ?? null])).toEqual([
      [first.id, reversal.id],
      [reversal.id, null],
    ]);
    expect(out.meter!.spent).toMatchObject({ amount: '0.00' });
    expect(out.meter!.remaining).toMatchObject({ amount: '120000.00' });
    const pilot = API.pilot.get.response.parse(
      (await call(t.app, API.pilot.get, { params: { caseRef: 'ME-104' }, cookie: c.jonas })).json(),
    );
    expect(pilot.budget!.spent).toMatchObject({ amount: '0.00' });
    expect(pilot.budgetEntries!.map((e) => e.id)).toEqual([first.id, reversal.id]);
    // Every row stays: the original is never deleted or changed.
    const rows = await inTenant(t, s, (tx) =>
      tx.selectFrom('me.budget_entry').select(['id', 'amount']).orderBy('recorded_at').execute(),
    );
    expect(rows.map((r) => r.amount)).toEqual(['8000.00', '8000.00']);
  });

  it('a second reversal and a reversal of a reversal are refused by the API (409) and by the database guard', async () => {
    const twice = await call(t.app, API.budget.reverseEntry, {
      params: { id: first.id },
      body: { reason: 'again' },
      cookie: c.jonas,
      idempotencyKey: true,
    });
    expect(twice.statusCode).toBe(409);
    const ofReversal = await call(t.app, API.budget.reverseEntry, {
      params: { id: reversal.id },
      body: { reason: 'undo' },
      cookie: c.jonas,
      idempotencyKey: true,
    });
    expect(ofReversal.statusCode).toBe(409);
    expect(problem(ofReversal.body).code).toBe('INVALID_TRANSITION');
    const raw = (reverses: string) =>
      inTenant(t, s, (tx) =>
        tx
          .insertInto('me.budget_entry')
          .values({
            tenant_id: s.tenantId,
            case_id: ids(s).case,
            gate_request_id: ids(s).g2,
            kind: 'spent',
            amount: '8000.00',
            currency: 'EUR',
            as_of: '2026-12-15',
            source_text: 'raw',
            recorded_by: s.user('jonas'),
            reverses_entry_id: reverses,
            reversal_reason: 'raw',
          })
          .execute(),
      );
    await expect(raw(first.id)).rejects.toThrow(/budget_entry_reversed_once_idx|duplicate key/);
    await expect(raw(reversal.id)).rejects.toThrow(/a reversal cannot be reversed/);
    await expect(
      inTenant(t, s, (tx) => tx.deleteFrom('me.budget_entry').where('id', '=', first.id).execute()),
    ).rejects.toThrow();
  });

  it('after the reversal the full €120k can be spent again; cross-tenant 404; reviewers 403', async () => {
    const full = await call(t.app, API.budget.recordEntry, {
      params: { caseRef: 'ME-104' },
      body: entry(ids(s).g2, '120000.00'),
      cookie: c.jonas,
      idempotencyKey: true,
    });
    expect(full.statusCode).toBe(201);
    expect(
      (await call(t.app, API.budget.listEntries, { params: { caseRef: ids(s).case }, cookie: k.jonasB }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await call(t.app, API.budget.reverseEntry, {
          params: { id: first.id },
          body: { reason: 'x' },
          cookie: k.jonasB,
          idempotencyKey: true,
        })
      ).statusCode,
    ).toBe(404);
    for (const who of ['daniel', 'opsLead'] as const) {
      const rec = await call(t.app, API.budget.recordEntry, {
        params: { caseRef: 'ME-104' },
        body: entry(ids(s).g2, '1.00'),
        cookie: c[who],
        idempotencyKey: true,
      });
      expect([who, rec.statusCode]).toEqual([who, 403]);
      const rev = await call(t.app, API.budget.reverseEntry, {
        params: { id: (JSON.parse(full.body) as { id: string }).id },
        body: { reason: 'x' },
        cookie: c[who],
        idempotencyKey: true,
      });
      expect([who, rev.statusCode]).toEqual([who, 403]);
    }
  });
});
