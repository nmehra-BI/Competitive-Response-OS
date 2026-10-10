/**
 * A G2 request drafts the pilot plan it asks to approve and pre-registers its pilot thresholds
 * (D-102, found by the real-stack journey: nothing else created a pilot plan).
 */
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
import { assessmentCase, inTenant } from './testkit';

let t: TestApp;
let a: SeededTenant;
let maya = '';

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  await assessmentCase(t, a);
  maya = await login(t.app, a.user('maya'));
});
afterAll(() => t.close());

const scope = {
  amount: '80000.00',
  currency: 'EUR',
  durationDays: 60,
  windowStart: '2027-01-04',
  windowEnd: '2027-03-04',
  countryCodes: ['AT'],
  segmentLabel: 'dairy',
  maxSites: 3,
  milestones: [],
  ownerId: null,
  authorizes: ['Pilot at up to 3 Austrian dairies'],
  doesNotAuthorize: ['Not scale'],
};
const target = {
  metricKey: 'paid_use_and_continuation',
  name: 'Paid use and continuation',
  thresholdText: '3 of 3 pilot customers',
  operator: 'gte' as const,
  thresholdValue: '3',
  unit: 'customers',
  windowText: 'Jan – Mar 2027',
};

describe('G2 request drafts the pilot plan (D-102)', () => {
  it('refuses thresholds on another gate and duplicate measures', async () => {
    const g1 = await call(t.app, API.gates.createRequest, {
      params: { caseRef: 'ME-110' },
      body: {
        gateCode: 'G1',
        scope,
        parentGateRequestId: null,
        proposedConditions: [],
        outcomeTargets: [target],
      },
      cookie: maya,
      idempotencyKey: true,
    });
    expect(g1.statusCode).toBe(400);
    const dup = await call(t.app, API.gates.createRequest, {
      params: { caseRef: 'ME-110' },
      body: {
        gateCode: 'G2',
        scope,
        parentGateRequestId: null,
        proposedConditions: [],
        outcomeTargets: [target, target],
      },
      cookie: maya,
      idempotencyKey: true,
    });
    expect(dup.statusCode).toBe(400);
  });

  it('creates the plan draft, its empty task set and keeps the thresholds out of contract reads', async () => {
    const res = await call(t.app, API.gates.createRequest, {
      params: { caseRef: 'ME-110' },
      body: {
        gateCode: 'G2',
        scope,
        parentGateRequestId: null,
        proposedConditions: [],
        outcomeTargets: [target],
      },
      cookie: maya,
      idempotencyKey: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    const gate = API.gates.createRequest.response.parse(res.json());
    expect(JSON.stringify(gate)).not.toContain('outcomeTargets');
    const rows = await inTenant(t, a, async (tx) => {
      const plan = await tx
        .selectFrom('me.pilot_plan as p')
        .innerJoin('platform.workflow_case as c', 'c.id', 'p.case_id')
        .innerJoin('me.pilot_plan_version as v', 'v.id', 'p.draft_version_id')
        .select([
          'p.gate_request_id',
          'p.status',
          'v.budget_ceiling',
          'v.thresholds_text',
          'v.task_set_id',
          'v.scope_text',
        ])
        .where('c.display_key', '=', 'ME-110')
        .executeTakeFirstOrThrow();
      const set = await tx
        .selectFrom('platform.task_set')
        .selectAll()
        .where('id', '=', plan.task_set_id!)
        .executeTakeFirstOrThrow();
      const audit = await tx
        .selectFrom('platform.audit_event')
        .select('action')
        .where('action', '=', 'pilot_plan.drafted')
        .execute();
      return { plan, set, audit };
    });
    expect(rows.plan).toMatchObject({
      gate_request_id: gate.id,
      status: 'draft',
      budget_ceiling: '80000.00',
      thresholds_text: ['Paid use and continuation: 3 of 3 pilot customers'],
      scope_text: 'Up to 3 dairy sites · 60 days',
    });
    expect(rows.set).toMatchObject({
      owner_type: 'pilot_plan_version',
      authorizing_gate_request_id: gate.id,
    });
    expect(rows.audit).toHaveLength(1);
  });
});
