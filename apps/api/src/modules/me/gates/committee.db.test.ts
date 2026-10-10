/**
 * G3 committee quorum and approval-policy defaults (ticket 3; D-109, D-124). 2 of 3 approvals on the
 * SAME snapshot hash, the finance seat required; author, case owner and the case's economics finance
 * reviewer excluded; admins and agents refused; approvals lapse when the snapshot goes stale; per-gate
 * expiry from the policy; a €200k G2 routes to the committee. Aster seeds no G3 grant (the authority gap
 * stays visible), so the tests grant one to the seat holders. Nobody is given the committee role ad hoc:
 * Katrin (finance) and Thomas (operations) are the fixture's committee members.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { expectedCommittee } from '@growth-os/fixtures-aster';
import { call, createTestApp, seedTenant, type SeededTenant, type TestApp } from '../../../platform/testing';
import {
  agentCookie,
  analyticsFor,
  approveG2,
  auditActions,
  currentPackage,
  decideBody,
  g2StopRules,
  g2Targets,
  ids,
  inTenant,
  problem,
} from './testkit';
import { changeBaseAdoption, cookiesFor, g3Awaiting, gateRow, grant, type Persona } from './committeekit';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const ALL: Persona[] = ['maya', 'elena', 'daniel', 'jonas', 'admin', 'katrin', 'thomas'];
const decide = (cookie: string, id: string, body: object, key?: string) =>
  call(t.app, API.gates.decide, { params: { id }, body, cookie, idempotencyKey: key ?? true });

async function g3World() {
  const s = await seedTenant(t.db, 'aster-demo');
  for (const p of ['elena', 'katrin', 'thomas'] as const) await grant(t, s, p, 'G3', '2000000.00');
  const g3 = await g3Awaiting(t, s);
  return { s, g3, c: await cookiesFor(t, s, ALL) };
}

describe('G3 quorum: 2 of 3 on one snapshot with the finance seat', () => {
  let w: Awaited<ReturnType<typeof g3World>>;
  beforeAll(async () => {
    w = await g3World();
  });

  it('routes G3 to the committee and shows the seats, the quorum and the viewer’s authority', async () => {
    const pkg = await currentPackage(t, w.c.katrin, w.g3);
    expect(pkg.gateRequest.route).toBe('committee');
    expect(pkg.panel.route).toBe('committee');
    expect(pkg.panel.requiredApprovals).toBe(expectedCommittee.quorum);
    expect(pkg.panel.committee).toMatchObject({
      quorum: 2,
      requiredSeats: expectedCommittee.requiredSeats,
      statusText: 'Waiting on 2 of 3 approvers · finance seat required',
    });
    expect(
      pkg.panel.committee!.seats.map((x) => [x.seat, x.member?.displayName, x.state, x.isViewer]),
    ).toEqual([
      ['chair', 'Elena Fischer', 'waiting', false],
      ['finance', 'Katrin Vogel', 'waiting', true],
      ['operations', 'Thomas Berger', 'waiting', false],
    ]);
    expect(pkg.panel.viewerAuthorityText).toBe('Up to €2m · BU Water');
    expect(pkg.panel.canDecide).toBe(true);
    expect(pkg.panel.chain.map((x) => x.routingReason)).toContain(
      'G3 · Scale / enter market in BU Water routes to the investment committee · Finance seat',
    );
  });

  it('one approval (chair) records the seat and waits: "Waiting on second approver · finance seat"', async () => {
    const pkg = await currentPackage(t, w.c.elena, w.g3);
    const res = await decide(w.c.elena, w.g3, decideBody(pkg));
    expect(res.statusCode).toBe(201);
    const out = API.gates.decide.response.parse(res.json());
    expect(out.gateRequest.status).toBe('awaiting_decision');
    expect(out.approvals.map((a) => [a.approver.displayName, a.seat])).toEqual([['Elena Fischer', 'chair']]);
    expect(out.panel.committee!.statusText).toBe(expectedCommittee.waitingText);
    expect(out.panel.receivedApprovals).toBe(1);
    expect(await auditActions(t, w.s, w.g3)).toEqual(['gate_request.committee_decision_recorded']);
    expect(
      (await analyticsFor(t, w.s, 'gate_approved')).filter(
        (e) => (e.props as { gate?: string }).gate === 'G3',
      ),
    ).toEqual([]);
    // Elena cannot decide twice on this snapshot.
    const again = await decide(w.c.elena, w.g3, decideBody(pkg));
    expect(again.statusCode).toBe(409);
    expect(problem(again.body).code).toBe('INVALID_TRANSITION');
  });

  it('chair + operations (no finance) is not approved yet', async () => {
    const pkg = await currentPackage(t, w.c.thomas, w.g3);
    const res = await decide(w.c.thomas, w.g3, decideBody(pkg));
    expect(res.statusCode).toBe(201);
    const out = API.gates.decide.response.parse(res.json());
    expect(out.gateRequest.status).toBe('awaiting_decision');
    expect(out.panel.committee!.statusText).toBe('Waiting on the finance seat');
    expect((await gateRow(t, w.s, w.g3)).status).toBe('awaiting_decision');
  });

  it('finance + one → approved on this snapshot; G3 never expires; gate_approved once', async () => {
    const pkg = await currentPackage(t, w.c.katrin, w.g3);
    const res = await decide(w.c.katrin, w.g3, decideBody(pkg, { rationale: 'Within the scale budget.' }));
    expect(res.statusCode).toBe(201);
    const out = API.gates.decide.response.parse(res.json());
    expect(out.gateRequest.status).toBe('approved');
    expect(out.panel.committee!.statusText).toBe('Quorum reached · 3 of 3 with the finance seat');
    expect(out.approvals.every((a) => a.snapshotHash === pkg.snapshot.contentHash)).toBe(true);
    const row = await gateRow(t, w.s, w.g3);
    expect(row.expires_at).toBeNull(); // D-109 §4: G3 never expires in the MVP
    expect(
      (await analyticsFor(t, w.s, 'gate_approved')).filter(
        (e) => (e.props as { gate?: string }).gate === 'G3',
      ),
    ).toHaveLength(1);
    expect(await auditActions(t, w.s, w.g3)).toEqual([
      'gate_request.committee_decision_recorded',
      'gate_request.committee_decision_recorded',
      'gate_request.approve',
    ]);
  });
});

describe('Not approved, exclusions, admins and agents', () => {
  it('finance "Not approved" ends the request as Not approved (quorum cannot be reached)', async () => {
    const w = await g3World();
    const pkg = await currentPackage(t, w.c.katrin, w.g3);
    const res = await decide(
      w.c.katrin,
      w.g3,
      decideBody(pkg, { disposition: 'not_approved', rationale: 'The scale budget is not covered.' }),
    );
    expect(res.statusCode).toBe(201);
    const out = API.gates.decide.response.parse(res.json());
    expect(out.gateRequest.status).toBe('not_approved');
    expect(out.panel.committee!.statusText).toBe('Quorum cannot be reached · finance seat did not approve');
    expect((await analyticsFor(t, w.s, 'gate_returned')).at(-1)!.props).toMatchObject({
      gate: 'G3',
      disposition: 'not_approved',
    });
  });

  it('two "Not approved" seats end it; one alone does not', async () => {
    const w = await g3World();
    const pkg = await currentPackage(t, w.c.elena, w.g3);
    const no = (who: 'elena' | 'thomas') =>
      decide(w.c[who], w.g3, decideBody(pkg, { disposition: 'not_approved', rationale: 'Too early.' }));
    expect(API.gates.decide.response.parse((await no('elena')).json()).gateRequest.status).toBe(
      'awaiting_decision',
    );
    expect(API.gates.decide.response.parse((await no('thomas')).json()).gateRequest.status).toBe(
      'not_approved',
    );
  });

  it('author/owner → SELF_APPROVAL_PROHIBITED; the economics finance reviewer → CONFLICT_OF_INTEREST', async () => {
    const w = await g3World();
    // Seat Maya (case owner, package author) and Daniel (signed this case's economics review) through
    // the admin endpoint, with the committee role and a G3 grant — they are still excluded.
    const seat = async (who: 'maya' | 'daniel', revokeId: string, seatName: 'operations' | 'finance') => {
      const members = API.admin.committee.response.parse(
        (await call(t.app, API.admin.committee, { cookie: w.c.admin })).json(),
      );
      const holder = members.items.find((m) => m.seat === seatName && m.revokedAt === null)!;
      await call(t.app, API.admin.setCommitteeMember, {
        params: { id: holder.id },
        body: {
          userId: holder.userId,
          businessUnitId: holder.businessUnitId,
          seat: seatName,
          validFrom: holder.validFrom,
          validTo: null,
          doaReference: holder.doaReference,
          revoked: true,
        },
        cookie: w.c.admin,
        idempotencyKey: true,
      });
      const named = await call(t.app, API.admin.setCommitteeMember, {
        params: { id: revokeId },
        body: {
          userId: w.s.user(who),
          businessUnitId: holder.businessUnitId,
          seat: seatName,
          validFrom: '2026-01-01',
          validTo: null,
          doaReference: 'DoA-TEST',
          revoked: false,
        },
        cookie: w.c.admin,
        idempotencyKey: true,
      });
      expect(named.statusCode).toBe(200);
      await inTenant(t, w.s, (tx) =>
        tx
          .insertInto('platform.role_assignment')
          .values({
            tenant_id: w.s.tenantId,
            user_id: w.s.user(who),
            role: 'investment_committee',
            business_unit_id: holder.businessUnitId,
            granted_by: w.s.user('admin'),
          })
          .execute(),
      );
      await grant(t, w.s, who, 'G3', '2000000.00');
    };
    await seat('maya', randomUUID(), 'operations');
    await seat('daniel', randomUUID(), 'finance');
    const c = await cookiesFor(t, w.s, ['maya', 'daniel']);
    const pkg = await currentPackage(t, c.daniel, w.g3);
    expect(pkg.panel.canDecide).toBe(false);
    expect(pkg.panel.cannotDecideReason).toBe(
      'You are marked as conflicted for this decision and cannot take part.',
    );
    expect(pkg.panel.committee!.seats.find((x) => x.seat === 'finance')!.state).toBe('excluded');
    expect(pkg.panel.committee!.statusText).toBe(
      'Quorum cannot be reached · finance seat excluded (conflict)',
    );
    const daniel = await decide(c.daniel, w.g3, decideBody(pkg));
    expect(daniel.statusCode).toBe(403);
    expect(problem(daniel.body).code).toBe('CONFLICT_OF_INTEREST');
    const maya = await decide(c.maya, w.g3, decideBody(pkg));
    expect(maya.statusCode).toBe(403);
    expect(problem(maya.body).code).toBe('SELF_APPROVAL_PROHIBITED');
    expect((await gateRow(t, w.s, w.g3)).status).toBe('awaiting_decision');
  });

  it('the administrator → FORBIDDEN; the agent → refused by the API and by the database', async () => {
    const w = await g3World();
    const pkg = await currentPackage(t, w.c.katrin, w.g3);
    const admin = await decide(w.c.admin, w.g3, decideBody(pkg));
    expect(admin.statusCode).toBe(403);
    expect(problem(admin.body)).toMatchObject({
      code: 'FORBIDDEN',
      title: 'Administrators configure roles and policies but cannot approve gates.',
    });
    const agent = await decide(await agentCookie(t, w.s), w.g3, decideBody(pkg));
    expect(agent.statusCode).toBe(403);
    expect(problem(agent.body).code).toBe('AGENT_IDENTITY_FORBIDDEN');
    // Defence in depth: the database refuses an agent decision even with a seat value.
    await expect(
      inTenant(t, w.s, async (tx) => {
        const session = await tx
          .insertInto('platform.session')
          .values({
            tenant_id: w.s.tenantId,
            user_id: w.s.user('analysisAgent'),
            token_hash: `test-${randomUUID()}`,
            auth_method: 'oidc',
            interactive: false,
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
            approver_user_id: w.s.user('analysisAgent'),
            approver_role: 'investment_committee',
            session_id: session.id,
            disposition: 'not_approved',
            rationale: 'agent',
            idempotency_key: randomUUID(),
            committee_seat: 'operations',
          })
          .execute();
      }),
    ).rejects.toThrow(/AGENT_IDENTITY_FORBIDDEN/);
    // The database also refuses seating an agent on the committee.
    await expect(
      inTenant(t, w.s, async (tx) => {
        const bu = await tx.selectFrom('platform.business_unit').select('id').executeTakeFirstOrThrow();
        await tx
          .insertInto('platform.committee_member')
          .values({
            tenant_id: w.s.tenantId,
            business_unit_id: bu.id,
            user_id: w.s.user('analysisAgent'),
            seat: 'chair',
            valid_from: '2026-01-01',
            entered_by: w.s.user('admin'),
          })
          .execute();
      }),
    ).rejects.toThrow(/AGENT_IDENTITY_FORBIDDEN/);
  });

  it('is 404 across tenants', async () => {
    const w = await g3World();
    const other = await seedTenant(t.db, 'aster-demo');
    const katrinB = (await cookiesFor(t, other, ['katrin'])).katrin;
    const pkg = await currentPackage(t, w.c.katrin, w.g3);
    expect((await call(t.app, API.gates.package, { params: { id: w.g3 }, cookie: katrinB })).statusCode).toBe(
      404,
    );
    expect((await decide(katrinB, w.g3, decideBody(pkg))).statusCode).toBe(404);
  });
});

describe('a €200k G2 routes to the committee; approvals lapse on a stale snapshot (never-rule 2)', () => {
  let s: SeededTenant;
  let c: Record<Persona, string>;
  let g2 = '';
  beforeAll(async () => {
    s = await seedTenant(t.db, 'aster-demo');
    for (const p of ['katrin', 'thomas'] as const) await grant(t, s, p, 'G2', '1000000.00');
    c = await cookiesFor(t, s, ALL);
    await call(t.app, API.gates.withdraw, {
      params: { id: ids(s).g2 },
      body: { rationale: 'A bigger pilot' },
      cookie: c.maya,
      idempotencyKey: true,
    });
    const g2Gate = await inTenant(t, s, (tx) =>
      tx
        .selectFrom('platform.gate_request')
        .select('scope')
        .where('id', '=', ids(s).g2)
        .executeTakeFirstOrThrow(),
    );
    const scope: Record<string, unknown> = {
      ...(g2Gate.scope as Record<string, unknown>),
      amount: '200000.00',
    };
    delete scope.proposedConditions;
    delete scope.outcomeTargets;
    delete scope.stopRules;
    const cr = await call(t.app, API.gates.createRequest, {
      params: { caseRef: 'ME-104' },
      body: {
        gateCode: 'G2',
        scope,
        parentGateRequestId: null,
        proposedConditions: [],
        outcomeTargets: g2Targets(),
        stopRules: g2StopRules(s),
      },
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(cr.statusCode, cr.body).toBe(201);
    g2 = API.gates.createRequest.response.parse(cr.json()).id;
    expect(API.gates.createRequest.response.parse(cr.json()).route).toBe('committee');
    const sub = await call(t.app, API.gates.submit, {
      params: { id: g2 },
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(sub.statusCode, sub.body).toBe(200);
  });

  it('Elena (chair, €150k G2 grant) cannot approve €200k; the panel routes to the committee', async () => {
    const pkg = await currentPackage(t, c.elena, g2);
    expect(pkg.panel.route).toBe('committee');
    expect(pkg.panel.allowedDispositions).not.toContain('approve');
    expect(pkg.panel.cannotDecideReason).toBe(
      'This request is above your delegated authority (up to €150k).',
    );
  });

  it('finance approves v4; a Base adoption change makes it stale; deciding on it → SNAPSHOT_STALE', async () => {
    const v4 = await currentPackage(t, c.katrin, g2);
    expect((await decide(c.katrin, g2, decideBody(v4))).statusCode).toBe(201);
    await changeBaseAdoption(t, s, '0.22');
    const stale = await decide(c.thomas, g2, decideBody(v4));
    expect(stale.statusCode).toBe(409);
    expect(problem(stale.body).code).toBe('SNAPSHOT_STALE');
  });

  it('after refresh the finance approval lapses: the refreshed snapshot needs two fresh approvals', async () => {
    const r = await call(t.app, API.gates.refresh, {
      params: { id: g2 },
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(r.statusCode, r.body).toBe(200);
    const v5 = await currentPackage(t, c.thomas, g2);
    expect(v5.approvals).toEqual([]);
    expect(v5.panel.receivedApprovals).toBe(0);
    expect(v5.panel.committee!.seats.find((x) => x.seat === 'finance')!.state).toBe('lapsed');
    const thomas = API.gates.decide.response.parse((await decide(c.thomas, g2, decideBody(v5))).json());
    expect(thomas.gateRequest.status).toBe('awaiting_decision');
    expect(thomas.panel.committee!.statusText).toBe(expectedCommittee.waitingText);
    const katrin = API.gates.decide.response.parse((await decide(c.katrin, g2, decideBody(v5))).json());
    expect(katrin.gateRequest.status).toBe('approved');
    // G2 approvals expire 30 days after the decision when unused (D-109 §4).
    const row = await gateRow(t, s, g2);
    expect(row.expires_at!.getTime() - row.decided_at!.getTime()).toBe(30 * 86_400_000);
  });
});

describe('per-gate expiry (D-109 §4)', () => {
  it('Elena’s G2 €120k approval (sponsor route) expires unused after 30 days', async () => {
    const s = await seedTenant(t.db, 'aster-demo');
    await approveG2(t, s);
    const row = await gateRow(t, s, ids(s).g2);
    expect(row.status).toBe('approved_with_conditions');
    expect(row.expires_at!.getTime() - row.decided_at!.getTime()).toBe(30 * 86_400_000);
  });
});
