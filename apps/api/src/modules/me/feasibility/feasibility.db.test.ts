/**
 * Feasibility (S07, step 15): only the named reviewer signs, with a structured scope; Lena's sign-off
 * covers G2 ("pilot only: up to 4 sites, 90 days"), never G3; a changed scope runs materiality.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, FeasibilityView } from '@growth-os/contracts';
import { specialistQuestion } from '@growth-os/fixtures-aster';
import { analyticsFor, api, auditFor, inTenant, world, type World } from '../cases/test-support';
import { caseById } from '../cases/access';
import { caseByRef } from '../gates/lib/common';
import { caseGateState } from '../gates/lib/facts';
import { agentCookie } from '../gates/testkit';

let w: World;
beforeAll(async () => {
  w = await world({ demo: 'aster-demo', b: 'aster-start' });
});
afterAll(() => w.close());

const D = () => w.tenants.demo!;
const pilotOnly = {
  position: 'supports' as const,
  scopeText: 'Signed for pilot only: up to 4 sites, 90 days',
  coversGate: 'G2' as const,
  maxSites: 4,
  maxDays: 90,
  statement: 'Requirements can be met for the bounded pilot.',
  evidenceSourceIds: [],
};

describe('feasibility', () => {
  it('reads the readiness table with named reviewers and no score', async () => {
    const v = FeasibilityView.parse(
      (
        await api(w, API.feasibility.get, await w.cookie('demo', 'priya'), { params: { caseRef: 'ME-104' } })
      ).json(),
    );
    expect(v.rows.map((r) => r.dimension)).toEqual([
      'product_fit',
      'differentiation',
      'commercial_access',
      'operations',
      'specialist_review',
      'channel',
      'competition',
    ]);
    const spec = v.rows.find((r) => r.dimension === 'specialist_review')!;
    expect(spec).toMatchObject({
      humanOnly: true,
      status: 'signed',
      reviewer: { displayName: 'Lena Hoffmann' },
    });
    // The full specialist question is served for the S07 quote (D-068).
    expect(spec.questionDetail).toBe(specialistQuestion);
    expect(v.rows.every((r) => typeof r.questionDetail === 'string' && r.questionDetail.length > 0)).toBe(
      true,
    );
    expect(JSON.stringify(v)).not.toMatch(/score/i);
    expect(
      (await api(w, API.feasibility.get, await w.cookie('demo', 'admin'), { params: { caseRef: 'ME-104' } }))
        .statusCode,
    ).toBe(404);
  });

  it('step 15: Lena signs "pilot only: up to 4 sites, 90 days" (covers G2, not G3); anyone else → 403', async () => {
    for (const who of ['maya', 'jonas', 'elena'] as const) {
      const res = await api(w, API.feasibility.sign, await w.cookie('demo', who), {
        params: { caseRef: 'ME-104', dimension: 'specialist_review' },
        body: pilotOnly,
      });
      expect([who, res.statusCode]).toEqual([who, 403]);
    }
    const res = await api(w, API.feasibility.sign, await w.cookie('demo', 'lena'), {
      params: { caseRef: 'ME-104', dimension: 'specialist_review' },
      body: pilotOnly,
    });
    expect(res.statusCode).toBe(201);
    const spec = FeasibilityView.parse(res.json()).rows.find((r) => r.dimension === 'specialist_review')!;
    expect(spec.currentReview).toMatchObject({
      version: 2,
      scope: { coversGate: 'G2', maxSites: 4, maxDays: 90 },
      signedBy: { displayName: 'Lena Hoffmann' },
    });
    expect((await analyticsFor(w, D(), 'feasibility_review_recorded')).map((e) => e.props)).toEqual([
      { area: 'specialist', scoped: true },
    ]);
    expect((await auditFor(w, D(), spec.currentReview!.id)).map((e) => e.action)).toEqual([
      'feasibility.review_signed',
    ]);
    // Same scope → no material change. The sign-off satisfies G2 but never G3 readiness.
    expect(
      await inTenant(w, D(), (tx) => tx.selectFrom('platform.material_change').select('id').execute()),
    ).toEqual([]);
    const [g2, g3] = await inTenant(w, D(), async (tx) => {
      const c = (await caseByRef(tx, 'ME-104'))!;
      return [(await caseGateState(tx, c, 'G2')).evaluation, (await caseGateState(tx, c, 'G3')).evaluation];
    });
    expect(g2.preconditions.find((p) => p.key === 'specialist_sign_off')!.met).toBe(true);
    expect(g3.preconditions.find((p) => p.key === 'readiness_reassessment')!.met).toBe(false);
  });

  it('a changed scope runs materiality (specialist_scope_changed): G2 v3 goes stale', async () => {
    const res = await api(w, API.feasibility.sign, await w.cookie('demo', 'lena'), {
      params: { caseRef: 'ME-104', dimension: 'specialist_review' },
      body: {
        ...pilotOnly,
        scopeText: 'Signed for pilot only: up to 2 sites, 60 days',
        maxSites: 2,
        maxDays: 60,
      },
    });
    expect(res.statusCode).toBe(201);
    const mc = await inTenant(w, D(), (tx) =>
      tx.selectFrom('platform.material_change').select(['change_type', 'classification']).execute(),
    );
    expect(mc).toEqual([{ change_type: 'specialist_scope_changed', classification: 'material' }]);
    const g2 = await inTenant(w, D(), (tx) =>
      tx
        .selectFrom('platform.gate_request')
        .select('status')
        .where('display_key', '=', 'ME-104-G2')
        .executeTakeFirstOrThrow(),
    );
    expect(g2.status).toBe('stale');
  });

  it('records signed disagreements and resolves blockers (scope restriction needs an approved gate)', async () => {
    const dis = await api(w, API.feasibility.recordDisagreement, await w.cookie('demo', 'daniel'), {
      params: { caseRef: 'ME-104', dimension: 'operations' },
      body: { statement: 'Support capacity is unproven for 4 sites.' },
    });
    expect(dis.statusCode).toBe(201);
    expect(
      FeasibilityView.parse(dis.json()).rows.find((r) => r.dimension === 'operations')!.disagreements[0]!
        .statement,
    ).toContain('unproven');
    expect(
      (
        await api(w, API.feasibility.recordDisagreement, await w.cookie('demo', 'opsLead'), {
          params: { caseRef: 'ME-104', dimension: 'operations' },
          body: { statement: 'x' },
        })
      ).statusCode,
    ).toBe(403);

    const { blockerId, g1 } = await inTenant(w, D(), async (tx) => {
      const c = await caseById(tx, 'ME-104');
      const b = await tx
        .insertInto('me.blocker')
        .values({
          tenant_id: D().tenantId,
          case_id: c.id,
          text: 'Installer capacity unconfirmed',
          blocks_gate: 'G2',
          owner_user_id: D().user('opsLead'),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const g = await tx
        .selectFrom('platform.gate_request')
        .select('id')
        .where('display_key', '=', 'ME-104-G1')
        .executeTakeFirstOrThrow();
      return { blockerId: b.id, g1: g.id };
    });
    const m = await w.cookie('demo', 'maya');
    const noGate = await api(w, API.feasibility.resolveBlocker, m, {
      params: { id: blockerId },
      body: { kind: 'scope_restricted', resolution: 'x', scopeRestrictionGateRequestId: null },
    });
    expect(noGate.statusCode).toBe(409);
    const ok = await api(w, API.feasibility.resolveBlocker, m, {
      params: { id: blockerId },
      body: {
        kind: 'scope_restricted',
        resolution: 'Pilot limited to 2 sites',
        scopeRestrictionGateRequestId: g1,
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(
      (
        await api(w, API.feasibility.resolveBlocker, m, {
          params: { id: blockerId },
          body: { kind: 'resolved', resolution: 'x', scopeRestrictionGateRequestId: null },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await api(w, API.feasibility.resolveBlocker, await w.cookie('demo', 'priya'), {
          params: { id: blockerId },
          body: { kind: 'resolved', resolution: 'x', scopeRestrictionGateRequestId: null },
        })
      ).statusCode,
    ).toBe(403);
  });
});

// Wave 4 (D-112 §4, D-132): S07 "Add dimension / Request review" on ME-102 (no readiness rows yet).
describe('feasibility.addDimension', () => {
  const add = (over: Record<string, unknown> = {}) => ({
    dimension: 'product_fit',
    reviewerId: D().user('priya'),
    dueOn: '2026-11-30',
    question: 'Does the monitoring kit fit brewery CIP lines?',
    questionDetail: 'Check sensor placement on CIP return lines and the cleaning chemistry limits.',
    scopeText: 'Two reference breweries; CIP lines only',
    humanOnly: false,
    ...over,
  });

  it('adds a dimension with a named reviewer, question and scope; the reviewer is asked in Reviews', async () => {
    const key = crypto.randomUUID();
    const res = await api(w, API.feasibility.addDimension, await w.cookie('demo', 'maya'), {
      params: { caseRef: 'ME-102' },
      body: add(),
      idempotencyKey: key,
    });
    expect(res.statusCode).toBe(201);
    const v = API.feasibility.addDimension.response.parse(res.json());
    const row = v.rows.find((r) => r.dimension === 'product_fit')!;
    expect(row).toMatchObject({
      question: 'Does the monitoring kit fit brewery CIP lines?',
      questionDetail: 'Check sensor placement on CIP return lines and the cleaning chemistry limits.',
      scopeText: 'Two reference breweries; CIP lines only',
      status: 'in_review',
      dueOn: '2026-11-30',
      humanOnly: false,
      reviewer: { displayName: 'Priya Shah' },
      currentReview: null,
    });
    expect((await auditFor(w, D(), row.id)).map((e) => e.action)).toEqual(['feasibility.dimension_added']);
    const replay = await api(w, API.feasibility.addDimension, await w.cookie('demo', 'maya'), {
      params: { caseRef: 'ME-102' },
      body: add(),
      idempotencyKey: key,
    });
    expect(replay.statusCode).toBe(201);
    const inbox = API.work.reviewsInbox.response.parse(
      (
        await api(w, API.work.reviewsInbox, await w.cookie('demo', 'priya'), { query: { tab: 'awaiting' } })
      ).json(),
    );
    const asked = inbox.reviewRequests.filter((r) => r.targetType === 'feasibility.product_fit');
    expect(asked.map((r) => [r.caseKey, r.area, r.question, r.whatToCheck])).toEqual([
      [
        'ME-102',
        'product',
        'Check sensor placement on CIP return lines and the cleaning chemistry limits.',
        ['Scope of review: Two reference breweries; CIP lines only'],
      ],
    ]);
  });

  it('one row per dimension per case (409); a specialist review is always human-only', async () => {
    const dup = await api(w, API.feasibility.addDimension, await w.cookie('demo', 'maya'), {
      params: { caseRef: 'ME-102' },
      body: add({ reviewerId: D().user('jonas') }),
    });
    expect(dup.statusCode).toBe(409);
    const onJourney = await api(w, API.feasibility.addDimension, await w.cookie('demo', 'maya'), {
      params: { caseRef: 'ME-104' },
      body: add(),
    });
    expect(onJourney.statusCode).toBe(409);
    const spec = await api(w, API.feasibility.addDimension, await w.cookie('demo', 'maya'), {
      params: { caseRef: 'ME-102' },
      body: add({ dimension: 'specialist_review', reviewerId: D().user('lena'), humanOnly: false }),
    });
    expect(spec.statusCode).toBe(201);
    expect(
      FeasibilityView.parse(spec.json()).rows.find((r) => r.dimension === 'specialist_review')!.humanOnly,
    ).toBe(true);
  });

  it('the named reviewer must be a person who is a member of the case (400)', async () => {
    for (const who of ['admin', 'analysisAgent'] as const) {
      const res = await api(w, API.feasibility.addDimension, await w.cookie('demo', 'maya'), {
        params: { caseRef: 'ME-102' },
        body: add({ dimension: 'channel', reviewerId: D().user(who) }),
      });
      expect([who, res.statusCode]).toEqual([who, 400]);
      expect((res.json() as { errors: { path: string }[] }).errors[0]!.path).toBe('body.reviewerId');
    }
    const foreign = await api(w, API.feasibility.addDimension, await w.cookie('demo', 'maya'), {
      params: { caseRef: 'ME-102' },
      body: add({ dimension: 'channel', reviewerId: w.tenants.b!.user('priya') }),
    });
    expect(foreign.statusCode).toBe(400);
  });

  it('cross-tenant 404; read-only reviewer 403; the agent principal is refused', async () => {
    const caseId = await inTenant(w, D(), async (tx) => (await caseById(tx, 'ME-102')).id);
    const cross = await api(w, API.feasibility.addDimension, await w.cookie('b', 'maya'), {
      params: { caseRef: caseId },
      body: add({ dimension: 'competition' }),
    });
    expect(cross.statusCode).toBe(404);
    const ro = await api(w, API.feasibility.addDimension, await w.cookie('demo', 'opsLead'), {
      params: { caseRef: 'ME-102' },
      body: add({ dimension: 'competition' }),
    });
    expect(ro.statusCode).toBe(403);
    const agent = await api(w, API.feasibility.addDimension, await agentCookie(w.t, D()), {
      params: { caseRef: 'ME-102' },
      body: add({ dimension: 'competition' }),
    });
    expect(agent.statusCode).toBe(403);
    expect((agent.json() as { code: string }).code).toBe('AGENT_IDENTITY_FORBIDDEN');
    const rows = await inTenant(w, D(), async (tx) =>
      tx
        .selectFrom('me.feasibility_assessment')
        .select('dimension')
        .where('case_id', '=', caseId)
        .orderBy('dimension')
        .execute(),
    );
    expect(rows.map((r) => r.dimension)).toEqual(['product_fit', 'specialist_review']);
  });
});
