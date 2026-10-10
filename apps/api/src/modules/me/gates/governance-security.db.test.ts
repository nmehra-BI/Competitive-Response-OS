/**
 * Security suite for the committee and extension rules (tickets 3 and 4; never-rules 1, 2, 3, 6). Every
 * test is an attempt to get around a rule and asserts it is refused — by the API and, where the database
 * holds the invariant, by the database too:
 *   quorum       replaying an approval, deciding twice, forging a seat (API + DB), a non-member with authority,
 *                swapping seats after deciding, two decisions in one seat (DB), seating oneself (API + DB)
 *   finance seat chair + operations never approve; a finance abstain cannot be bypassed
 *   cap          above 25% / 50%, a new site, prospect outreach, a null cap in a real tenant
 *   cumulative   splitting a pilot: G2 + X above the sponsor's pilot ceiling goes to the committee
 *   one per pilot a second extension of the same pilot
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { authorityGrants, businessUnits } from '@growth-os/fixtures-aster';
import { call, createTestApp, seedTenant, type SeededTenant, type TestApp } from '../../../platform/testing';
import { currentPackage, decideBody, inTenant, problem } from './testkit';
import { cookiesFor, extendDecided, g3Awaiting, gateRow, grant, x1Body, type Persona } from './committeekit';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const ALL: Persona[] = ['maya', 'elena', 'jonas', 'admin', 'katrin', 'thomas'];
const decide = (cookie: string, id: string, body: object, key: string | true = true) =>
  call(t.app, API.gates.decide, { params: { id }, body, cookie, idempotencyKey: key });

async function g3World() {
  const s = await seedTenant(t.db, 'aster-demo');
  for (const p of ['elena', 'katrin', 'thomas'] as const) await grant(t, s, p, 'G3', '2000000.00');
  const g3 = await g3Awaiting(t, s);
  return { s, g3, c: await cookiesFor(t, s, ALL) };
}

async function approvalsOn(s: SeededTenant, gateId: string) {
  return inTenant(t, s, (tx) =>
    tx
      .selectFrom('platform.approval')
      .select(['approver_user_id', 'committee_seat', 'disposition'])
      .where('gate_request_id', '=', gateId)
      .orderBy('decided_at')
      .execute(),
  );
}

async function setSeat(
  s: SeededTenant,
  admin: string,
  id: string,
  who: Persona,
  seat: 'chair' | 'finance' | 'operations',
  revoked = false,
) {
  return call(t.app, API.admin.setCommitteeMember, {
    params: { id },
    body: {
      userId: s.user(who),
      businessUnitId: s.id(businessUnits[0].id),
      seat,
      validFrom: '2026-01-01',
      validTo: null,
      doaReference: 'DoA-TEST',
      revoked,
    },
    cookie: admin,
    idempotencyKey: true,
  });
}

describe('quorum bypass attempts', () => {
  let w: Awaited<ReturnType<typeof g3World>>;
  beforeAll(async () => {
    w = await g3World();
  });

  it('replaying an approval (same Idempotency-Key) never counts twice', async () => {
    const pkg = await currentPackage(t, w.c.elena, w.g3);
    const key = randomUUID();
    const first = await decide(w.c.elena, w.g3, decideBody(pkg), key);
    const replay = await decide(w.c.elena, w.g3, decideBody(pkg), key);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(await approvalsOn(w.s, w.g3)).toHaveLength(1);
    expect((await gateRow(t, w.s, w.g3)).status).toBe('awaiting_decision');
  });

  it('deciding twice with a new key is refused; a forged seat in the body is ignored', async () => {
    const pkg = await currentPackage(t, w.c.elena, w.g3);
    const twice = await decide(w.c.elena, w.g3, decideBody(pkg));
    expect(twice.statusCode).toBe(409);
    expect(problem(twice.body).title).toBe('The chair has already recorded a decision on this snapshot.');
    // Thomas claims the finance seat in the body: the server records the seat he holds.
    const forged = await decide(w.c.thomas, w.g3, {
      ...decideBody(pkg),
      seat: 'finance',
      committeeSeat: 'finance',
    });
    expect([201, 400]).toContain(forged.statusCode);
    const rows = await approvalsOn(w.s, w.g3);
    expect(rows.map((r) => r.committee_seat)).toEqual(
      forged.statusCode === 201 ? ['chair', 'operations'] : ['chair'],
    );
    // Two approvals without the finance seat never approve.
    expect((await gateRow(t, w.s, w.g3)).status).toBe('awaiting_decision');
  });

  it('a person with the committee role and a G3 grant but no seat → FORBIDDEN', async () => {
    await inTenant(t, w.s, (tx) =>
      tx
        .insertInto('platform.role_assignment')
        .values({
          tenant_id: w.s.tenantId,
          user_id: w.s.user('jonas'),
          role: 'investment_committee',
          business_unit_id: w.s.id(businessUnits[0].id),
          granted_by: w.s.user('admin'),
        })
        .execute(),
    );
    await grant(t, w.s, 'jonas', 'G3', '2000000.00');
    const jonas = (await cookiesFor(t, w.s, ['jonas'])).jonas;
    const pkg = await currentPackage(t, jonas, w.g3);
    expect(pkg.panel.canDecide).toBe(false);
    const res = await decide(jonas, w.g3, decideBody(pkg));
    expect(res.statusCode).toBe(403);
    expect(problem(res.body)).toMatchObject({
      code: 'FORBIDDEN',
      title: 'This request routes to the investment committee. You hold no committee seat in BU Water.',
    });
  });

  it('moving a member who already decided into the finance seat does not give a second decision', async () => {
    const members = API.admin.committee.response.parse(
      (await call(t.app, API.admin.committee, { cookie: w.c.admin })).json(),
    );
    const finance = members.items.find((m) => m.seat === 'finance' && m.revokedAt === null)!;
    expect((await setSeat(w.s, w.c.admin, finance.id, 'katrin', 'finance', true)).statusCode).toBe(200);
    expect((await setSeat(w.s, w.c.admin, randomUUID(), 'thomas', 'finance')).statusCode).toBe(200);
    const pkg = await currentPackage(t, w.c.thomas, w.g3);
    const res = await decide(w.c.thomas, w.g3, decideBody(pkg));
    expect(res.statusCode).toBe(409);
    expect((await gateRow(t, w.s, w.g3)).status).toBe('awaiting_decision');
  });

  it('the database refuses a second decision in the same seat on the same snapshot', async () => {
    const pkg = await currentPackage(t, w.c.katrin, w.g3);
    await expect(
      inTenant(t, w.s, async (tx) => {
        const session = await tx
          .insertInto('platform.session')
          .values({
            tenant_id: w.s.tenantId,
            user_id: w.s.user('katrin'),
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
            tenant_id: w.s.tenantId,
            gate_request_id: w.g3,
            snapshot_id: pkg.snapshot.id,
            snapshot_hash: pkg.snapshot.contentHash,
            approver_user_id: w.s.user('katrin'),
            approver_role: 'investment_committee',
            session_id: session.id,
            disposition: 'abstain',
            rationale: 'Second chair decision',
            idempotency_key: randomUUID(),
            committee_seat: 'chair', // Elena already decided in the chair seat
          })
          .execute();
      }),
    ).rejects.toThrow(/approval_one_per_seat_idx/);
  });

  it('the database refuses a forged seat: the approver must hold that seat in the BU (0007, D-148)', async () => {
    const pkg = await currentPackage(t, w.c.jonas, w.g3);
    // A seat nobody decided in on this snapshot, so only the seat guard can refuse it.
    const taken = new Set(
      (await approvalsOn(w.s, w.g3))
        .filter((a) => a.committee_seat !== null)
        .map((a) => a.committee_seat as string),
    );
    const seat = (['chair', 'finance', 'operations'] as const).find((x) => !taken.has(x))!;
    expect(seat).toBeDefined();
    await expect(
      inTenant(t, w.s, async (tx) => {
        const session = await tx
          .insertInto('platform.session')
          .values({
            tenant_id: w.s.tenantId,
            user_id: w.s.user('jonas'),
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
            tenant_id: w.s.tenantId,
            gate_request_id: w.g3,
            snapshot_id: pkg.snapshot.id,
            snapshot_hash: pkg.snapshot.contentHash,
            approver_user_id: w.s.user('jonas'),
            approver_role: 'investment_committee',
            session_id: session.id,
            disposition: 'abstain',
            rationale: 'Claims a seat he does not hold',
            idempotency_key: randomUUID(),
            committee_seat: seat, // Jonas holds no committee seat; the API would never assign one
          })
          .execute();
      }),
    ).rejects.toThrow(/COMMITTEE_SEAT_NOT_HELD/);
  });

  it('an administrator cannot seat themselves (API and database) or seat another administrator', async () => {
    const self = await setSeat(w.s, w.c.admin, randomUUID(), 'admin', 'operations');
    expect(self.statusCode).toBe(403);
    await expect(
      inTenant(t, w.s, (tx) =>
        tx
          .insertInto('platform.committee_member')
          .values({
            tenant_id: w.s.tenantId,
            business_unit_id: w.s.id(businessUnits[1].id),
            user_id: w.s.user('admin'),
            seat: 'chair',
            valid_from: '2026-01-01',
            entered_by: w.s.user('admin'),
          })
          .execute(),
      ),
    ).rejects.toThrow(/check/i);
    // A second tenant administrator (opsLead) cannot be seated either.
    await call(t.app, API.admin.setRole, {
      params: { id: randomUUID() },
      body: {
        userId: w.s.user('opsLead'),
        role: 'tenant_admin',
        businessUnitId: null,
        caseId: null,
        revoked: false,
      },
      cookie: w.c.admin,
      idempotencyKey: true,
    });
    const otherAdmin = await setSeat(w.s, w.c.admin, randomUUID(), 'opsLead', 'operations');
    expect(otherAdmin.statusCode).toBe(403);
  });
});

describe('finance seat bypass attempts', () => {
  it('a finance abstain cannot be outvoted: chair + operations after it still never approve', async () => {
    const w = await g3World();
    const pkg = await currentPackage(t, w.c.katrin, w.g3);
    const abstain = await decide(
      w.c.katrin,
      w.g3,
      decideBody(pkg, { disposition: 'abstain', rationale: 'Not my call yet.' }),
    );
    expect(abstain.statusCode).toBe(201);
    expect(API.gates.decide.response.parse(abstain.json()).gateRequest.status).toBe('not_approved');
    const late = await decide(w.c.elena, w.g3, decideBody(pkg));
    expect(late.statusCode).toBe(409); // the request is no longer awaiting a decision
    expect((await gateRow(t, w.s, w.g3)).status).toBe('not_approved');
  });
});

describe('extension rule bypass attempts (D-110)', () => {
  let s: SeededTenant;
  let c: Record<Persona, string>;
  beforeAll(async () => {
    s = await seedTenant(t.db, 'aster-demo');
    await extendDecided(t, s);
    c = await cookiesFor(t, s, ALL);
  });
  const request = (over: Record<string, unknown>, cookie = c.maya) =>
    call(t.app, API.outcomes.requestExtension, {
      params: { caseRef: 'ME-104' },
      body: x1Body(s, over),
      cookie,
      idempotencyKey: true,
    });

  it('above the cap (€31k), above the window (46 days), below 14 days → refused with the rule', async () => {
    const over = await request({ spendCap: '31000.00' });
    expect(over.statusCode).toBe(400);
    expect(problem(over.body).title).toBe(
      'The extension asks €31k; the rule allows up to €30k (25% of €120k).',
    );
    const long = await request({ durationDays: 46 });
    expect(long.statusCode).toBe(400);
    expect(problem(long.body).title).toBe(
      'The extension asks 46 days; the rule allows up to 45 days (50% of the 90-day pilot).',
    );
    expect((await request({ durationDays: 10 })).statusCode).toBe(400);
  });

  it('a new site or prospect outreach widens the scope → refused', async () => {
    const sites = await request({ maxSites: 5 });
    expect(sites.statusCode).toBe(400);
    expect(problem(sites.body).title).toBe(
      'The extension covers the same or fewer sites: up to 4, no new sites.',
    );
    const outreach = await request({ scopeItems: ['Re-test paid use', 'Outreach to three new prospects'] });
    expect(outreach.statusCode).toBe(400);
    expect(problem(outreach.body).title).toContain('no new sites and no prospect outreach');
  });

  it('a null cap in a real (non-illustrative) tenant → "State the extension cap and duration"', async () => {
    await inTenant(t, s, (tx) => tx.updateTable('platform.tenant').set({ illustrative: false }).execute());
    try {
      const res = await request({ spendCap: null, durationDays: null });
      expect(res.statusCode).toBe(400);
      expect(problem(res.body).title).toBe('State the extension cap and duration');
    } finally {
      await inTenant(t, s, (tx) => tx.updateTable('platform.tenant').set({ illustrative: true }).execute());
    }
    expect(
      (
        await inTenant(t, s, (tx) =>
          tx.selectFrom('platform.gate_request').select('id').where('gate_code', '=', 'X').execute(),
        )
      ).length,
    ).toBe(0);
  });

  it('splitting the pilot: G2 + X above the sponsor’s pilot ceiling routes to the committee', async () => {
    // Lower Elena's G2 grant to €140k: €120k + €30k = €150k is above it, so X1 goes to the committee.
    const g2Grant = authorityGrants.find((g) => g.gateCode === 'G2')!;
    const set = await call(t.app, API.admin.setAuthority, {
      params: { id: s.id(g2Grant.id) },
      body: {
        userId: s.user('elena'),
        gateCode: 'G2',
        businessUnitId: s.id(businessUnits[0].id),
        ceilingAmount: '140000.00',
        currency: 'EUR',
        validFrom: '2026-01-01',
        validTo: null,
        revoked: false,
        doaReference: 'DoA-2026-01 · BU Water · illustrative',
      },
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(set.statusCode).toBe(200);
    const res = await request({});
    expect(res.statusCode, res.body).toBe(201);
    const x1 = API.outcomes.requestExtension.response.parse(res.json());
    expect(x1.route).toBe('committee');
    const pkg = await currentPackage(t, c.elena, x1.id);
    expect(pkg.panel.route).toBe('committee');
    // Elena (chair, X grant €50k) approving alone does not approve the extension.
    const elena = await decide(c.elena, x1.id, decideBody(pkg));
    expect(elena.statusCode).toBe(201);
    expect(API.gates.decide.response.parse(elena.json()).gateRequest.status).toBe('awaiting_decision');
  });

  it('one extension per pilot: a second X of the same G2 → refused', async () => {
    const second = await request({ spendCap: '10000.00', durationDays: 20 });
    expect(second.statusCode).toBe(409);
    expect(problem(second.body)).toMatchObject({
      code: 'INVALID_TRANSITION',
      title:
        'One extension per pilot: this pilot already has an extension. A bigger ask or a second extension is a new G2 with a full package and finance review.',
    });
  });
});
