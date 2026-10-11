/**
 * Experiments (S09): steps 10, 13 and 14. Draft edits until G1 locks the plan; amendments keep the
 * pre-registered original; results append with period and source.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { exp03 } from '@growth-os/fixtures-aster';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';
import {
  analyticsFor,
  assessmentCase,
  auditActions,
  currentPackage,
  decideBody,
  exp03Plan,
  ids,
  inTenant,
  problem,
  type Cookies,
} from '../gates/testkit';

let t: TestApp;
let a: SeededTenant;
let b: SeededTenant;
const k = {} as Cookies;
let expId = '';
let asmId = '';

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  ({ asmId } = await assessmentCase(t, a));
  for (const p of ['maya', 'elena', 'daniel', 'jonas'] as const) k[p] = await login(t.app, a.user(p));
  k.mayaB = await login(t.app, b.user('maya'));
});
afterAll(async () => {
  await t.close();
});

const parse = (res: { json(): unknown }) => API.experiments.create.response.parse(res.json());

describe('experiments', () => {
  it('step 10: creates EXP-04 as a draft (20 sites, ≥ 8 interviews, ≥ 4 commitments, €15k); 403 and 404 otherwise', async () => {
    const body = {
      title: exp03.title,
      assumptionIds: [asmId],
      ownerId: a.user('maya'),
      fieldworkOwnerId: a.user('jonas'),
      plan: exp03Plan(),
    };
    const daniel = await call(t.app, API.experiments.create, {
      params: { caseRef: 'ME-110' },
      body,
      cookie: k.daniel,
      idempotencyKey: true,
    });
    expect(daniel.statusCode).toBe(403);
    const other = await call(t.app, API.experiments.create, {
      params: { caseRef: 'ME-110' },
      body,
      cookie: k.mayaB,
      idempotencyKey: true,
    });
    expect(other.statusCode).toBe(404);
    const res = await call(t.app, API.experiments.create, {
      params: { caseRef: 'ME-110' },
      body,
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(201);
    const e = parse(res);
    expId = e.id;
    expect(e).toMatchObject({ key: 'EXP-04', lifecycle: 'draft', displayResult: 'planned', original: null });
    expect(e.current.plan.sampleSize).toBe(20);
    expect(e.current.plan.budgetAmount).toBe('15000.00');
    expect(e.current.plan.metrics.map((m) => [m.thresholdText, m.thresholdValue])).toEqual([
      ['≥ 8', '8'],
      ['≥ 4', '4'],
    ]);
    expect(await auditActions(t, a, expId)).toEqual(['experiment.created']);
  });

  it('edits the draft with If-Match (412 on a stale version); invalid window → 400', async () => {
    const stale = await call(t.app, API.experiments.updateDraft, {
      params: { id: expId },
      body: { title: 'x' },
      cookie: k.maya,
      ifMatch: 99,
    });
    expect(stale.statusCode).toBe(412);
    const bad = await call(t.app, API.experiments.updateDraft, {
      params: { id: expId },
      body: { plan: { windowEnd: '2026-01-01' } },
      cookie: k.maya,
      ifMatch: 0,
    });
    expect(bad.statusCode).toBe(400);
    const ok = await call(t.app, API.experiments.updateDraft, {
      params: { id: expId },
      body: { plan: { nonresponseNote: 'Declines are recorded with a reason.' } },
      cookie: k.maya,
      ifMatch: 0,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.etag).toBe('"1"');
    expect(parse(ok).current.plan.nonresponseNote).toBe('Declines are recorded with a reason.');
    const jonas = await call(t.app, API.experiments.updateDraft, {
      params: { id: expId },
      body: { title: 'x' },
      cookie: k.jonas,
      ifMatch: 1,
    });
    expect(jonas.statusCode).toBe(403);
  });

  it('a draft cannot be amended (409) or started (409): only the G1 decision locks it', async () => {
    const am = await call(t.app, API.experiments.amend, {
      params: { id: expId },
      body: { reason: 'x', plan: { windowEnd: '2026-11-20' } },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(am.statusCode).toBe(409);
    const st = await call(t.app, API.experiments.start, {
      params: { id: expId },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(st.statusCode).toBe(409);
  });

  it('G1 approval locks the plan; editing a locked plan → INVALID_TRANSITION (step 13)', async () => {
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
    const gateId = API.gates.createRequest.response.parse(cr.json()).id;
    await call(t.app, API.gates.submit, { params: { id: gateId }, cookie: k.maya, idempotencyKey: true });
    const pkg = await currentPackage(t, k.elena, gateId);
    expect(
      (
        await call(t.app, API.gates.decide, {
          params: { id: gateId },
          body: decideBody(pkg),
          cookie: k.elena,
          idempotencyKey: true,
        })
      ).statusCode,
    ).toBe(201);
    const edit = await call(t.app, API.experiments.updateDraft, {
      params: { id: expId },
      body: { title: 'Changed' },
      cookie: k.maya,
      ifMatch: 2,
    });
    expect(edit.statusCode).toBe(409);
    expect(problem(edit.body).code).toBe('INVALID_TRANSITION');
  });

  it('step 13: amendment 1 moves the window to 20 Nov with a reason; the original stays visible', async () => {
    const noReason = await call(t.app, API.experiments.amend, {
      params: { id: expId },
      body: { reason: '', plan: {} },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(noReason.statusCode).toBe(400);
    const res = await call(t.app, API.experiments.amend, {
      params: { id: expId },
      body: { reason: exp03.amendment1.reason, plan: { windowEnd: exp03.amendment1.newWindowEnd } },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(201);
    const e = parse(res);
    expect(e.amendments).toEqual([
      expect.objectContaining({
        number: 1,
        fromPlanVersion: 1,
        toPlanVersion: 2,
        changedFields: ['windowEnd'],
        thresholdsChanged: false,
        afterResultsSeen: false,
      }),
    ]);
    expect(e.original!.isOriginal).toBe(true);
    expect(e.original!.plan.windowEnd).toBe(exp03.originalPlan.windowEnd);
    expect(e.current.plan.windowEnd).toBe('2026-11-20');
    expect(e.displayResult).toBe('amended');
    expect(await auditActions(t, a, expId)).toContain('experiment.amend');
    // The amendment is a pinned-plan change: classified by the tenant policy (unlisted → uncertain).
    const mc = await inTenant(t, a, (tx) =>
      tx
        .selectFrom('platform.material_change')
        .select(['classification', 'object_type'])
        .where('object_type', '=', 'experiment_plan_version')
        .execute(),
    );
    expect(mc).toEqual([{ classification: 'uncertain', object_type: 'experiment_plan_version' }]);
  });

  it('starts once G1 is effective', async () => {
    const res = await call(t.app, API.experiments.start, {
      params: { id: expId },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(200);
    expect(parse(res).lifecycle).toBe('running');
  });

  it('step 14: results 9 / 4 with period and source → Met · Met, experiment_completed; no period → 400', async () => {
    const r = exp03.result;
    const base = {
      observations: r.observations.map((o) => ({
        metricKey: o.metricKey,
        observed: o.observed,
        observedText: o.observedText,
      })),
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      sourceText: r.sourceText,
      interpretation: r.interpretation,
      limitations: r.limitations,
    };
    const { periodStart: _p, ...noPeriod } = base;
    const bad = await call(t.app, API.experiments.recordResult, {
      params: { id: expId },
      body: noPeriod,
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(bad.statusCode).toBe(400);
    const cross = await call(t.app, API.experiments.recordResult, {
      params: { id: expId },
      body: base,
      cookie: k.mayaB,
      idempotencyKey: true,
    });
    expect(cross.statusCode).toBe(404);
    const elena = await call(t.app, API.experiments.recordResult, {
      params: { id: expId },
      body: base,
      cookie: k.elena,
      idempotencyKey: true,
    });
    expect(elena.statusCode).toBe(403);
    const res = await call(t.app, API.experiments.recordResult, {
      params: { id: expId },
      body: base,
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(201);
    const e = parse(res);
    expect(e.lifecycle).toBe('result_recorded');
    expect(e.displayResult).toBe('met');
    expect(e.results[0]!.observations.map((o) => [o.observedText, o.result])).toEqual([
      ['9', 'met'],
      ['4', 'met'],
    ]);
    const ev = await analyticsFor(t, a, 'experiment_completed');
    expect(ev.at(-1)!.props).toEqual({ metrics: 2, met: 2, notMet: 0, inconclusive: 0 });
    // A second result version appends; the first never disappears.
    const v2 = await call(t.app, API.experiments.recordResult, {
      params: { id: expId },
      body: {
        ...base,
        observations: [
          { metricKey: 'paid_commitments', observed: '3', observedText: '3' },
          { metricKey: 'completed_interviews', observed: null, observedText: 'Too early' },
        ],
      },
      cookie: k.maya,
      idempotencyKey: true,
    });
    const e2 = parse(v2);
    expect(e2.results.map((x) => x.version)).toEqual([1, 2]);
    expect(e2.displayResult).toBe('too_early_to_read');
  });

  it('records the decision taken under the pre-registered rule; lists original, current, amendments and results', async () => {
    const res = await call(t.app, API.experiments.recordDecision, {
      params: { id: expId },
      body: { decisionText: exp03.decisionTaken.text },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(201);
    expect(parse(res).decisionTaken!.text).toBe('Prepare G2 pilot request');
    const list = await call(t.app, API.experiments.list, { params: { caseRef: 'ME-104' }, cookie: k.daniel });
    expect(list.statusCode).toBe(200);
    const demo = API.experiments.list.response.parse(list.json()).items.find((x) => x.key === 'EXP-03')!;
    expect(demo.original!.plan.windowEnd).toBe('2026-11-13');
    expect(demo.current.plan.windowEnd).toBe('2026-11-20');
    expect(demo.results).toHaveLength(1);
    expect(demo.taskSetId).not.toBeNull();
    const cross = await call(t.app, API.experiments.list, {
      params: { caseRef: ids(a).case },
      cookie: k.mayaB,
    });
    expect(cross.statusCode).toBe(404);
    const denied = await call(t.app, API.experiments.recordDecision, {
      params: { id: expId },
      body: { decisionText: 'x' },
      cookie: k.elena,
      idempotencyKey: true,
    });
    expect(denied.statusCode).toBe(403);
  });
});
