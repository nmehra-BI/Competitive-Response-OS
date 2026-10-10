/**
 * Outcome review (S12): steps 25, 26 and 27. Actuals against the thresholds of the approved G2
 * snapshot; the recommendation is not a decision; Elena decides "Revise and extend"; X1 is requested
 * with the €[cap] placeholder and can never be approved without an amount (D-040).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import {
  expectedExtension,
  expectedScaleGate,
  gates,
  outcomeObservations,
  outcomeReview,
  outcomeTargets,
} from '@growth-os/fixtures-aster';
import { caseByRef } from '../gates/lib/common';
import { caseGateState } from '../gates/lib/facts';
import { cookiesFor, extendDecided, gateRow, x1Body } from '../gates/committeekit';
import { inTenant } from '../gates/testkit';
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
    // A stated result cannot override a numeric pre-registered threshold (D-081, never-rule 12).
    const overridden = await call(t.app, API.outcomes.recordObservation, {
      params: { caseRef: 'ME-104' },
      body: { ...body(outcomeObservations[0]), result: 'met' },
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(overridden.statusCode).toBe(400);
    const results = [];
    for (const [i, o] of outcomeObservations.entries()) {
      const res = await call(t.app, API.outcomes.recordObservation, {
        params: { caseRef: 'ME-104' },
        // The effort target's threshold is a placeholder ("[hours per site]"): Jonas states the reading.
        body: i === 1 ? { ...body(o), result: 'not_met' } : body(o),
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

describe('the extension rule and the G3 summary (D-110, D-111; tickets 4 and 13)', () => {
  let s: SeededTenant;
  let c: Awaited<ReturnType<typeof cookiesFor>>;
  beforeAll(async () => {
    s = await seedTenant(t.db, 'aster-demo');
    await extendDecided(t, s);
    // The journey activates the pilot on 1 Dec 2026, after economics v2 was committed (the test clock is
    // real time, earlier than the fixture dates).
    await inTenant(t, s, (tx) =>
      tx
        .updateTable('me.pilot_plan')
        .set({ activated_at: new Date('2026-12-01T09:00:00+01:00') })
        .where('case_id', '=', ids(s).case)
        .execute(),
    );
    c = await cookiesFor(t, s, ['maya', 'elena', 'jonas', 'admin']);
  });
  const view = async (cookie: string) =>
    API.outcomes.get.response.parse(
      (await call(t.app, API.outcomes.get, { params: { caseRef: 'ME-104' }, cookie })).json(),
    );

  it('S12 shows the limits of the €120k · 90-day pilot: "Up to €30k (25% of €120k) · up to 45 days"', async () => {
    const r = await view(c.maya);
    expect(r.extensionLimits).toMatchObject({
      parentGateRequestId: ids(s).g2,
      parentAmount: '120000.00',
      currency: 'EUR',
      parentDurationDays: 90,
      maxAmount: expectedExtension.maxAmount,
      maxDurationDays: expectedExtension.maxDurationDays,
      minDurationDays: 14,
      extensionsUsed: 0,
      extensionsAllowed: expectedExtension.extensionsAllowed,
      cumulativeCeiling: expectedExtension.cumulativeCeiling,
      text: expectedExtension.limitsText,
    });
    // Every amount here is one-time pilot money: no /year figure in the limits.
    expect(r.extensionLimits!.text).not.toMatch(/year/);
  });

  it('the G3 summary lists the four blockers in D-039 order; the fourth names the €400k one-time investment', async () => {
    const r = await view(c.maya);
    expect(r.scaleGate.blocked).toBe(true);
    expect(r.scaleGate.unmet.map((b) => b.key)).toEqual([...expectedScaleGate.blockerKeys]);
    expect(r.scaleGate.unmet.at(-1)!.message).toBe(expectedScaleGate.scaleBudgetBlocker);
    expect(r.scaleGate.summary).toContain(
      'no scale budget requested · economics v2 carries €400k one-time scale-entry investment',
    );
    expect(r.scaleGate.summary).not.toMatch(/\/year|per year/);
  });

  it('a viewer who cannot read the committed economics gets no investment text', async () => {
    const plain = await inTenant(t, s, async (tx) => {
      const caseRow = (await caseByRef(tx, 'ME-104'))!;
      return (await caseGateState(tx, caseRow, 'G3', { economicsReadable: false })).evaluation;
    });
    expect(plain.blockers.at(-1)!.message).toBe('Scale budget · not stated');
    expect(plain.summary).not.toContain('€400k');
  });

  it('X1 at €30k · 45 days is within the rule; Elena approves it (€120k + €30k = her €150k ceiling)', async () => {
    const res = await call(t.app, API.outcomes.requestExtension, {
      params: { caseRef: 'ME-104' },
      body: x1Body(s),
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    const x1 = API.outcomes.requestExtension.response.parse(res.json());
    expect(x1).toMatchObject({
      key: 'ME-104-X1',
      status: 'awaiting_decision',
      buttonLabel: expectedExtension.buttonLabel,
      route: 'sponsor',
    });
    expect(x1.scope).toMatchObject({
      amount: '30000.00',
      durationDays: 45,
      windowStart: gates.x1.windowStart,
      windowEnd: gates.x1.windowEnd,
      maxSites: 4,
    });
    expect(x1.scope.doesNotAuthorize).toContain('No prospect outreach');
    expect((await view(c.maya)).extensionLimits!.extensionsUsed).toBe(1);
    const pkg = await currentPackage(t, c.elena, x1.id);
    expect(pkg.panel.allowedDispositions).toContain('approve');
    expect(pkg.snapshot.content.ask).toBeTruthy();
    const ok = await call(t.app, API.gates.decide, {
      params: { id: x1.id },
      body: decideBody(pkg, { rationale: 'Bounded re-test of effort and the fourth site.' }),
      cookie: c.elena,
      idempotencyKey: true,
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(API.gates.decide.response.parse(ok.json()).gateRequest.status).toBe('approved');
    const row = await gateRow(t, s, x1.id);
    expect(row.expires_at!.getTime() - row.decided_at!.getTime()).toBe(14 * 86_400_000); // X: 14 days
    // An approved extension never unblocks G3.
    expect((await view(c.maya)).scaleGate.blocked).toBe(true);
  });

  it('a second X → refused; Daniel (no gate.submit) 403; another tenant 404', async () => {
    const second = await call(t.app, API.outcomes.requestExtension, {
      params: { caseRef: 'ME-104' },
      body: x1Body(s, { spendCap: '5000.00', durationDays: 14 }),
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(second.statusCode).toBe(409);
    const daniel = await call(t.app, API.outcomes.requestExtension, {
      params: { caseRef: 'ME-104' },
      body: x1Body(s),
      cookie: k.daniel,
      idempotencyKey: true,
    });
    expect([403, 404]).toContain(daniel.statusCode);
    const cross = await call(t.app, API.outcomes.requestExtension, {
      params: { caseRef: ids(s).case },
      body: x1Body(s),
      cookie: k.elenaB,
      idempotencyKey: true,
    });
    expect(cross.statusCode).toBe(404);
  });
});
