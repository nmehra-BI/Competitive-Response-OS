/**
 * Test support for the WS4b DB suites (imported only by *.db.test.ts files). Helpers read audit and
 * analytics rows, create an agent session, and set up an assessment-stage case for the G1 path on an
 * isolated tenant (direct inserts of committed records, standing in for the WS4a endpoints).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { API, ProblemDetails, type EndpointDef } from '@growth-os/contracts';
import { sql, withTenant, type Db, type Tx } from '@growth-os/db';
import { assumptions, cases, exp03, gates, sources } from '@growth-os/fixtures-aster';
import { hashToken } from '../../../platform/session';
import { call, login, type SeededTenant, type TestApp } from '../../../platform/testing';

export const problem = (body: string) => ProblemDetails.parse(JSON.parse(body));

export function inTenant<T>(t: TestApp, a: SeededTenant, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: `test-${randomUUID()}` }, fn);
}

export async function auditActions(t: TestApp, a: SeededTenant, objectId: string): Promise<string[]> {
  return inTenant(t, a, async (tx) =>
    (
      await tx
        .selectFrom('platform.audit_event')
        .select('action')
        .where('object_id', '=', objectId)
        .orderBy('seq')
        .execute()
    ).map((r) => r.action),
  );
}

export async function analyticsFor(t: TestApp, a: SeededTenant, name: string) {
  return inTenant(t, a, (tx) =>
    tx
      .selectFrom('platform.analytics_event')
      .selectAll()
      .where('name', '=', name)
      .orderBy('occurred_at')
      .execute(),
  );
}

/** A session for the seeded analysis agent (non-interactive, as the gateway would hold). */
export async function agentCookie(t: TestApp, a: SeededTenant): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await inTenant(t, a, (tx) =>
    tx
      .insertInto('platform.session')
      .values({
        tenant_id: a.tenantId,
        user_id: a.user('analysisAgent'),
        token_hash: hashToken(token),
        auth_method: 'oidc',
        interactive: false,
        expires_at: new Date(Date.now() + 3600_000),
      })
      .execute(),
  );
  return `gos_session=${token}`;
}

export const ids = (a: SeededTenant) => ({
  case: a.id(cases[0].id),
  g1: a.id(gates.g1.id),
  g2: a.id(gates.g2.id),
  exp03: a.id(exp03.id),
  asm: (key: string) => a.id(assumptions.find((x) => x.key === key)!.id),
  src: (key: string) => a.id(sources.find((x) => x.key === key)!.id),
});

export async function caseStage(t: TestApp, a: SeededTenant, key = 'ME-104'): Promise<string> {
  return inTenant(
    t,
    a,
    async (tx) =>
      (
        await tx
          .selectFrom('platform.workflow_case')
          .select('stage')
          .where('display_key', '=', key)
          .executeTakeFirstOrThrow()
      ).stage,
  );
}

export async function setStage(t: TestApp, a: SeededTenant, key: string, stage: string): Promise<void> {
  await inTenant(t, a, (tx) =>
    tx.updateTable('platform.workflow_case').set({ stage }).where('display_key', '=', key).execute(),
  );
}

/**
 * ME-110 in Assessment on an aster-demo tenant: one decision-critical assumption, one feasibility row,
 * a committed sizing version (the demo's unblocked engine result) citing SRC-014. G1 preconditions met.
 */
export async function assessmentCase(
  t: TestApp,
  a: SeededTenant,
): Promise<{ caseId: string; asmId: string }> {
  return inTenant(t, a, async (tx) => {
    const demo = await tx
      .selectFrom('platform.workflow_case')
      .select(['business_unit_id', 'owner_user_id', 'sponsor_user_id', 'mandate_id'])
      .where('display_key', '=', 'ME-104')
      .executeTakeFirstOrThrow();
    const caseId = randomUUID();
    await tx
      .insertInto('platform.workflow_case')
      .values({
        id: caseId,
        tenant_id: a.tenantId,
        app_type: 'market_expansion',
        display_key: 'ME-110',
        title: 'Process-water monitoring · Austrian dairies',
        business_unit_id: demo.business_unit_id,
        owner_user_id: demo.owner_user_id,
        sponsor_user_id: demo.sponsor_user_id,
        stage: 'assessment',
        origin_type: 'direct',
        mandate_id: demo.mandate_id,
        created_by: demo.owner_user_id,
      })
      .execute();
    const asmId = randomUUID();
    await tx
      .insertInto('platform.assumption')
      .values({
        id: asmId,
        tenant_id: a.tenantId,
        case_id: caseId,
        display_key: 'ASM-90',
        input_key: 'adoption_rate.base',
        name: 'Base adoption',
        scenario: 'base',
        owner_user_id: demo.owner_user_id,
        sensitivity: 'high',
        decision_critical: true,
        consequence_if_false: 'SOM halves',
        validation_method: 'Paid commitments',
        created_by: demo.owner_user_id,
      })
      .execute();
    const v = await tx
      .insertInto('platform.assumption_version')
      .values({
        tenant_id: a.tenantId,
        assumption_id: asmId,
        version: 1,
        value: '0.20',
        unit: 'rate',
        basis: 'Analogue',
        evidence_quality: 'some',
        origin: 'human',
        created_by: demo.owner_user_id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await tx
      .updateTable('platform.assumption')
      .set({ current_version_id: v.id })
      .where('id', '=', asmId)
      .execute();
    await tx
      .insertInto('me.feasibility_assessment')
      .values({
        tenant_id: a.tenantId,
        case_id: caseId,
        dimension: 'product_fit',
        question: 'Does the product fit dairy processes?',
        reviewer_user_id: a.user('priya'),
      })
      .execute();
    const boundary = await tx.selectFrom('me.market_boundary').select('id').executeTakeFirstOrThrow();
    const calc = await tx
      .selectFrom('platform.calculation_result')
      .select('id')
      .where('engine', '=', 'sizing')
      .where('blocked', '=', false)
      .executeTakeFirstOrThrow();
    const sv = randomUUID();
    await tx
      .insertInto('me.sizing_version')
      .values({
        id: sv,
        tenant_id: a.tenantId,
        case_id: caseId,
        version: 1,
        state: 'draft',
        method: 'aggregate_overlap',
        horizon_years: 3,
        market_boundary_id: boundary.id,
        dedup_rule_text: 'Shared site IDs',
        created_by: demo.owner_user_id,
      })
      .execute();
    await tx
      .insertInto('me.sizing_input')
      .values({
        tenant_id: a.tenantId,
        sizing_version_id: sv,
        input_key: 'tam_site_count',
        label: 'TAM site count',
        kind: 'evidence',
        value: '5000',
        unit: 'sites',
        source_id: ids(a).src('SRC-014'),
      })
      .execute();
    await tx
      .updateTable('me.sizing_version')
      .set({
        state: 'committed',
        calculation_result_id: calc.id,
        committed_at: sql`now()`,
        committed_by: demo.owner_user_id,
      })
      .where('id', '=', sv)
      .execute();
    return { caseId, asmId };
  });
}

/** The EXP-03 plan as the API takes it. */
export const exp03Plan = () => ({
  ...exp03.originalPlan,
  metrics: exp03.originalPlan.metrics.map((m) => ({ ...m })),
  decisionRules: exp03.originalPlan.decisionRules.map((r) => ({ ...r })),
});

/** Read the current G2 package (id + hash the approver reads). */
export async function currentPackage(t: TestApp, cookie: string, gateId: string) {
  const res = await call(t.app, API.gates.package, { params: { id: gateId }, cookie });
  if (res.statusCode !== 200) throw new Error(`package ${res.statusCode} ${res.body}`);
  return API.gates.package.response.parse(res.json());
}

export function decideBody(
  pkg: { snapshot: { id: string; contentHash: string } },
  over: Partial<{
    disposition: string;
    rationale: string;
    conditions: unknown[];
    snapshotId: string;
    snapshotHash: string;
  }> = {},
) {
  return {
    snapshotId: pkg.snapshot.id,
    snapshotHash: pkg.snapshot.contentHash,
    disposition: 'approve',
    rationale: 'Bounded and owned.',
    note: null,
    conditions: [],
    delegateToUserId: null,
    ...over,
  };
}

/** The two G2 conditions of the fixture, as Elena repeats them on approval. */
export function g2Conditions(a: SeededTenant) {
  return gates.g2.conditions.map((c) => ({
    text: c.text,
    ownerId: a.id(c.ownerId),
    dueOn: c.dueOn,
    dueRule: c.dueRule,
    flag: c.blocksExecution ? 'blocks_execution' : 'monitor_only',
  }));
}

export type Endpoint = EndpointDef;

/** Session cookies by persona (tenant B personas end with B). */
export type Cookies = Record<
  | 'maya'
  | 'elena'
  | 'daniel'
  | 'jonas'
  | 'priya'
  | 'lena'
  | 'admin'
  | 'opsLead'
  | 'agent'
  | 'mayaB'
  | 'elenaB'
  | 'jonasB'
  | 'danielB',
  string
>;
export type { Db };

/** aster-demo: Elena approves G2 v3 with C1/C2 (API). */
export async function approveG2(t: TestApp, s: SeededTenant): Promise<void> {
  const elena = await login(t.app, s.user('elena'));
  const pkg = await currentPackage(t, elena, ids(s).g2);
  const res = await call(t.app, API.gates.decide, {
    params: { id: ids(s).g2 },
    body: decideBody(pkg, { disposition: 'approve_with_conditions', conditions: g2Conditions(s) }),
    cookie: elena,
    idempotencyKey: true,
  });
  if (res.statusCode !== 201) throw new Error(`approve ${res.statusCode} ${res.body}`);
}

/** aster-demo: G2 approved, C1 met by Jonas and the pilot activated (all through the API). */
export async function activatePilot(t: TestApp, s: SeededTenant): Promise<void> {
  await approveG2(t, s);
  const jonas = await login(t.app, s.user('jonas'));
  const pkg = await currentPackage(t, jonas, ids(s).g2);
  const c1 = pkg.gateRequest.conditions.find((c) => c.key === 'C1')!;
  await call(t.app, API.gates.markConditionMet, {
    params: { id: c1.id },
    body: { evidence: 'Signed site list (4 sites)' },
    cookie: jonas,
    idempotencyKey: true,
  });
  const res = await call(t.app, API.pilot.activate, {
    params: { caseRef: 'ME-104' },
    cookie: jonas,
    idempotencyKey: true,
  });
  if (res.statusCode !== 200) throw new Error(`activate ${res.statusCode} ${res.body}`);
}
