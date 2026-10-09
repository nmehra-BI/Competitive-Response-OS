/**
 * Outcome review (S12): steps 25, 26 and 27. Actuals against the thresholds of the approved G2
 * snapshot; the recommendation is not a decision; Elena decides "Revise and extend"; X1 is requested
 * with the €[cap] placeholder and can never be approved without an amount (D-040).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { outcomeObservations, outcomeReview, outcomeTargets } from '@growth-os/fixtures-aster';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';
import {
  activatePilot,
  analyticsFor,
  auditActions,
  caseStage,
  currentPackage,
  decideBody,
  ids,
  problem,
  setStage,
  type Cookies,
} from '../gates/testkit';

let t: TestApp;
let a: SeededTenant;
let b: SeededTenant;
const k = {} as Cookies;

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  await activatePilot(t, a);
  for (const p of ['maya', 'elena', 'daniel', 'jonas'] as const) k[p] = await login(t.app, a.user(p));
  k.jonasB = await login(t.app, b.user('jonas'));
  k.elenaB = await login(t.app, b.user('elena'));
});
afterAll(async () => {
  await t.close();
});

const review = async (cookie = k.maya) =>
  API.outcomes.get.response.parse(
    (await call(t.app, API.outcomes.get, { params: { caseRef: 'ME-104' }, cookie })).json(),
  );

describe('outcomes', () => {
  it('opens with the three pre-registered targets of the approved snapshot, no data yet; 404 cross-tenant', async () => {
    const r = await review();
    expect(r.status).toBe('incomplete');
    expect(r.rows.map((x) => x.target!.metricKey)).toEqual([
      'buyer_fit',
      'deployment_effort',
      'paid_use_continuation',
    ]);
    expect(r.incompleteReasons).toHaveLength(3);
    expect(r.causalLimitations.length).toBeGreaterThan(0);
    expect(
      (await call(t.app, API.outcomes.get, { params: { caseRef: ids(a).case }, cookie: k.jonasB }))
        .statusCode,
    ).toBe(404);
    // aster-demo tenant B has no active pilot: no review yet.
    expect(
      (await call(t.app, API.outcomes.get, { params: { caseRef: 'ME-104' }, cookie: k.jonasB })).statusCode,
    ).toBe(404);
  });

  it('step 25: actuals 3 of 4 (billing), effort above (effort log), buyer fit mixed → Not met · Not met · Inconclusive', async () => {
    const r0 = await review(k.jonas);
    const targetOf = (key: string) => r0.rows.find((x) => x.target!.metricKey === key)!.target!.id;
    const body = (o: (typeof outcomeObservations)[number]) => ({
      targetId: targetOf(o.targetKey),
      valueText: o.valueText,
      value: o.value,
      unit: o.unit,
      periodStart: o.periodStart,
      periodEnd: o.periodEnd,
      sourceText: o.sourceText,
      sourceId: null,
      supersedesId: null,
    });
    const denied = await call(t.app, API.outcomes.recordObservation, {
      params: { caseRef: 'ME-104' },
      body: body(outcomeObservations[0]),
      cookie: k.daniel,
      idempotencyKey: true,
    });
    expect(denied.statusCode).toBe(403);
    const cross = await call(t.app, API.outcomes.recordObservation, {
      params: { caseRef: ids(a).case },
      body: body(outcomeObservations[0]),
      cookie: k.jonasB,
      idempotencyKey: true,
    });
    expect(cross.statusCode).toBe(404);
    const { periodStart: _x, ...noPeriod } = body(outcomeObservations[0]);
    expect(
      (
        await call(t.app, API.outcomes.recordObservation, {
          params: { caseRef: 'ME-104' },
          body: noPeriod,
          cookie: k.jonas,
          idempotencyKey: true,
        })
      ).statusCode,
    ).toBe(400);
    const results = [];
    for (const o of outcomeObservations) {
      const res = await call(t.app, API.outcomes.recordObservation, {
        params: { caseRef: 'ME-104' },
        body: body(o),
        cookie: k.jonas,
        idempotencyKey: true,
      });
      expect(res.statusCode).toBe(201);
      results.push(API.outcomes.recordObservation.response.parse(res.json()).result);
    }
    expect(results).toEqual(['not_met', 'not_met', 'inconclusive']);
    expect((await analyticsFor(t, a, 'outcome_recorded')).map((e) => e.props)).toEqual([
      { result: 'not_met' },
      { result: 'not_met' },
      { result: 'inconclusive' },
    ]);
    const r = await review();
    expect(r.status).toBe('ready');
    const paid = r.rows.find((x) => x.target!.metricKey === 'paid_use_continuation')!;
    expect(paid.latest).toMatchObject({
      valueText: '3 of 4',
      sourceText: 'Source: billing records',
      periodStart: '2026-12-01',
    });
    expect(r.scaleGate.blocked).toBe(true);
    expect(r.scaleGate.unmet.map((x) => x.key)).toContain('pilot_actuals_vs_thresholds');
    // Edits append a new version; the earlier actual stays in history.
    const fix = await call(t.app, API.outcomes.recordObservation, {
      params: { caseRef: 'ME-104' },
      body: { ...body(outcomeObservations[0]), supersedesId: paid.latest!.id },
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(API.outcomes.recordObservation.response.parse(fix.json()).version).toBe(2);
    const twice = await call(t.app, API.outcomes.recordObservation, {
      params: { caseRef: 'ME-104' },
      body: { ...body(outcomeObservations[0]), supersedesId: paid.latest!.id },
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(twice.statusCode).toBe(409);
    expect(
      (await review()).rows.find((x) => x.target!.metricKey === 'paid_use_continuation')!.history,
    ).toHaveLength(2);
    expect(outcomeTargets).toHaveLength(3);
  });

  it('step 26: review draft with causal limitations; the recommendation is not a decision (If-Match)', async () => {
    const r = await review();
    // The view carries the review's own row version for If-Match (D-068), and no X request yet.
    expect(r.rowVersion).toBe(0);
    expect(r.extensionRequest).toBeNull();
    const res = await call(t.app, API.outcomes.saveReviewDraft, {
      params: { caseRef: 'ME-104' },
      body: {
        whatWeLearned: [...outcomeReview.whatWeLearned],
        whatChangesNext: [...outcomeReview.whatChangesNext],
        causalLimitations: [...outcomeReview.causalLimitations],
        recommendation: { outcome: 'extend', text: outcomeReview.recommendation.text },
      },
      cookie: k.maya,
      ifMatch: r.rowVersion,
    });
    expect(res.statusCode).toBe(200);
    const v = API.outcomes.saveReviewDraft.response.parse(res.json());
    expect(v.recommendation).toMatchObject({
      outcome: 'extend',
      label: 'Revise and extend validation',
      accepted: false,
    });
    expect(v.decision).toBeNull();
    expect(v.causalLimitations).toEqual([...outcomeReview.causalLimitations]);
    expect(v.rowVersion).toBe(r.rowVersion! + 1);
    expect(res.headers.etag).toContain(String(v.rowVersion));
    expect(await caseStage(t, a)).toBe('pilot_running');
    expect(
      (
        await call(t.app, API.outcomes.saveReviewDraft, {
          params: { caseRef: 'ME-104' },
          body: {},
          cookie: k.maya,
          ifMatch: 0,
        })
      ).statusCode,
    ).toBe(412);
    expect(
      (
        await call(t.app, API.outcomes.saveReviewDraft, {
          params: { caseRef: 'ME-104' },
          body: {},
          cookie: k.daniel,
          ifMatch: 1,
        })
      ).statusCode,
    ).toBe(403);
    expect(r.id).toBe(v.id);
  });

  it('"scale" is not an outcome decision (400); Maya cannot decide (403); other tenants 404', async () => {
    await setStage(t, a, 'ME-104', 'review_due'); // the pilot-window timer's move (WS3 timers)
    const scale = await call(t.app, API.outcomes.decide, {
      params: { caseRef: 'ME-104' },
      body: { outcome: 'scale', label: 'Scale', rationale: 'x' },
      cookie: k.elena,
      idempotencyKey: true,
    });
    expect(scale.statusCode).toBe(400);
    const maya = await call(t.app, API.outcomes.decide, {
      params: { caseRef: 'ME-104' },
      body: { outcome: 'extend', label: 'x', rationale: 'x' },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(maya.statusCode).toBe(403);
    const cross = await call(t.app, API.outcomes.decide, {
      params: { caseRef: ids(a).case },
      body: { outcome: 'extend', label: 'x', rationale: 'x' },
      cookie: k.elenaB,
      idempotencyKey: true,
    });
    expect(cross.statusCode).toBe(404);
  });

  it('step 27: Elena records "Revise and extend" → stage Validation, extension_requested', async () => {
    const res = await call(t.app, API.outcomes.decide, {
      params: { caseRef: 'ME-104' },
      body: {
        outcome: 'extend',
        label: outcomeReview.decision.label,
        rationale: outcomeReview.decision.rationale,
      },
      cookie: k.elena,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(201);
    const out = API.outcomes.decide.response.parse(res.json());
    expect(out.decision).toMatchObject({ outcome: 'extend', label: 'Revise and extend validation' });
    expect(out.decision.onRecommendationOf!.displayName).toBe('Maya Rao');
    expect(out.review.status).toBe('decided');
    expect(out.review.recommendation!.accepted).toBe(true);
    expect(await caseStage(t, a)).toBe(outcomeReview.stageAfterDecision);
    expect(await auditActions(t, a, out.decision.id)).toEqual(['outcome.decided']);
    // The decision alone requests no extension: `extension_requested` comes with the X request (D-071).
    expect(await analyticsFor(t, a, 'extension_requested')).toEqual([]);
  });

  it('step 27: Maya requests X1 with €[cap] → Awaiting decision; Elena’s approve is refused (no amount)', async () => {
    const body = {
      parentGateRequestId: ids(a).g2,
      spendCap: null,
      currency: 'EUR',
      durationDays: null,
      ownerId: a.user('jonas'),
      scopeItems: ['Extension work within €[cap] and the chosen scope', 'The existing 4 pilot sites'],
    };
    expect(
      (
        await call(t.app, API.outcomes.requestExtension, {
          params: { caseRef: 'ME-104' },
          body,
          cookie: k.daniel,
          idempotencyKey: true,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(t.app, API.outcomes.requestExtension, {
          params: { caseRef: ids(a).case },
          body,
          cookie: k.elenaB,
          idempotencyKey: true,
        })
      ).statusCode,
    ).toBe(404);
    // Zero never stands for "missing": a stated cap must be positive (null is the placeholder).
    const zero = await call(t.app, API.outcomes.requestExtension, {
      params: { caseRef: 'ME-104' },
      body: { ...body, spendCap: '0' },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(zero.statusCode).toBe(400);
    expect(await analyticsFor(t, a, 'extension_requested')).toEqual([]);
    const res = await call(t.app, API.outcomes.requestExtension, {
      params: { caseRef: 'ME-104' },
      body,
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(201);
    const x1 = API.outcomes.requestExtension.response.parse(res.json());
    expect(x1).toMatchObject({
      key: 'ME-104-X1',
      gateCode: 'X',
      status: 'awaiting_decision',
      buttonLabel: 'Approve extension €[cap]',
    });
    expect(x1.scope.amount).toBeNull();
    // The outcome review links the X request it led to (D-068).
    expect((await review()).extensionRequest).toMatchObject({ id: x1.id, key: 'ME-104-X1' });
    expect(x1.scope.doesNotAuthorize).toContain('Does not unblock G3');
    // Exactly one `extension_requested` per extension, carrying the X request (D-071).
    const ext = await analyticsFor(t, a, 'extension_requested');
    expect(ext.map((e) => e.props)).toEqual([{ parentGate: 'G2' }]);
    expect(x1.scope.durationDays).toBeNull();
    expect(await caseStage(t, a)).toBe('validation'); // X never moves the case
    const pkg = await currentPackage(t, k.elena, x1.id);
    expect(pkg.panel.allowedDispositions).not.toContain('approve');
    const approve = await call(t.app, API.gates.decide, {
      params: { id: x1.id },
      body: decideBody(pkg),
      cookie: k.elena,
      idempotencyKey: true,
    });
    expect(approve.statusCode).toBe(403);
    expect(problem(approve.body)).toMatchObject({
      code: 'AUTHORITY_INSUFFICIENT',
      title:
        'This request has no stated amount yet (placeholder). It cannot be approved until the amount is set.',
    });
    const r = await review();
    expect(r.scaleGate.blocked).toBe(true);
  });
});
