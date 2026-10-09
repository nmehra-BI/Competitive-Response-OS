/**
 * Gates, snapshots, decisions, positions, dissent, conditions and material changes (WS4b).
 * Acceptance steps 10, 11, 17, 19, 20, 28 (BUILD_PLAN §8) plus the coordinator notes on proposed
 * conditions and on current-snapshot decision fields after return → resubmit.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, toFingerprint } from '@growth-os/contracts';
import { sql } from '@growth-os/db';
import { gates, mandate, outcomeTargets, people } from '@growth-os/fixtures-aster';
import { applyMateriality } from '../../../platform/materiality';
import { systemTools } from '../../../platform/pipeline';
import { call, createTestApp, login, seedTenant, type SeededTenant, type TestApp } from '../../../platform/testing';
import {
  analyticsFor,
  assessmentCase,
  auditActions,
  caseStage,
  currentPackage,
  decideBody,
  exp03Plan,
  g2Conditions,
  ids,
  inTenant,
  problem,
  setStage,
} from './testkit';

let t: TestApp;
let a: SeededTenant; // G2 stale → refresh → approve
let b: SeededTenant; // other tenant (cross-tenant) and read-only checks
const k: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  for (const p of ['maya', 'elena', 'daniel', 'jonas', 'priya', 'lena', 'admin', 'opsLead'] as const)
    k[p] = await login(t.app, a.user(p));
  k.mayaB = await login(t.app, b.user('maya'));
  k.elenaB = await login(t.app, b.user('elena'));
});
afterAll(async () => {
  await t.close();
});

/** Simulates WS4a `assumptions.update`: a new Base adoption version + materiality in one transaction. */
async function changeBaseAdoption(s: SeededTenant, value: string) {
  return inTenant(t, s, async (tx) => {
    const asm = await tx
      .selectFrom('platform.assumption as x')
      .innerJoin('platform.assumption_version as v', 'v.id', 'x.current_version_id')
      .select(['x.id', 'x.current_version_id', 'v.version', 'v.unit', 'v.basis', 'x.owner_user_id'])
      .where('x.display_key', '=', 'ASM-01')
      .executeTakeFirstOrThrow();
    const nv = await tx
      .insertInto('platform.assumption_version')
      .values({
        tenant_id: s.tenantId,
        assumption_id: asm.id,
        version: asm.version + 1,
        value,
        unit: asm.unit,
        basis: asm.basis,
        evidence_quality: 'some',
        origin: 'human',
        change_reason: 'Re-estimated after interviews',
        created_by: asm.owner_user_id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await tx.updateTable('platform.assumption').set({ current_version_id: nv.id }).where('id', '=', asm.id).execute();
    const now = new Date();
    return applyMateriality(
      systemTools(tx, { tenantId: s.tenantId, correlationId: 'test-assumption', now, rule: 'test' }),
      {
        changeType: 'decision_critical_assumption_changed',
        objectType: 'assumption',
        objectId: asm.current_version_id!,
        componentType: 'assumption_version',
        fromVersion: asm.version,
        toVersion: asm.version + 1,
        decisionCritical: true,
        label: 'adoption assumption',
      },
      { now, actorUserId: asm.owner_user_id },
    );
  });
}

describe('G2 package (step 17) and reads', () => {
  it('step 17: the G2 package v3 carries the fingerprint, the scoped ask, C1 proposed and Daniel’s dissent in his words', async () => {
    const pkg = await currentPackage(t, k.elena, ids(a).g2);
    expect(pkg.snapshot.version).toBe(3);
    expect(pkg.snapshot.fingerprint).toBe(toFingerprint(pkg.snapshot.contentHash));
    expect(pkg.gateRequest.buttonLabel).toBe('Approve pilot €120k · 90 days');
    expect(pkg.gateRequest.displayStatus).toBe('awaiting_decision');
    expect(pkg.snapshot.content.conditionsProposed.map((c) => c.flag)).toEqual(['blocks_execution', 'monitor_only']);
    expect(pkg.dissent[0]!.statement).toBe(gates.g2.dissent.statement);
    expect(pkg.dissent[0]!.author.displayName).toBe('Daniel Weber');
    expect(pkg.panel.canDecide).toBe(true);
    expect(pkg.panel.allowedDispositions).toContain('approve_with_conditions');
    expect(pkg.panel.viewerAuthorityText).toContain('€[limit]');
    expect(pkg.approvals).toEqual([]);
    expect(pkg.gateHistory.some((h) => h.gateCode === 'G1' && h.status === 'approved')).toBe(true);
    expect(await caseStage(t, a)).toBe('pilot_approval_pending');
  });

  it('shows Maya the self-approval reason and no dispositions', async () => {
    const pkg = await currentPackage(t, k.maya, ids(a).g2);
    expect(pkg.panel.canDecide).toBe(false);
    expect(pkg.panel.allowedDispositions).toEqual([]);
    expect(pkg.panel.cannotDecideReason).toBe('You authored this package and cannot approve it.');
  });

  it('gates.get and gates.preconditions read the request and the "Why?" list', async () => {
    const g = await call(t.app, API.gates.get, { params: { id: ids(a).g2 }, cookie: k.daniel });
    expect(g.statusCode).toBe(200);
    expect(API.gates.get.response.parse(g.json()).key).toBe('ME-104-G2');
    const pre = await call(t.app, API.gates.rail, { params: { caseRef: 'ME-104', gateCode: 'G2' }, cookie: k.maya });
    expect(pre.statusCode).toBe(200);
    const view = API.gates.rail.response.parse(pre.json());
    expect(view.preconditions.every((p) => p.met)).toBe(true);
    expect(view.status).toBe('awaiting_decision');
    expect(view.canSubmit).toBe(false);
  });

  it('is 404 across tenants and for hidden subjects; admins read no packages', async () => {
    for (const [def, params] of [
      [API.gates.get, { id: ids(a).g2 }],
      [API.gates.package, { id: ids(a).g2 }],
      [API.gates.rail, { caseRef: ids(a).case, gateCode: 'G2' }],
      [API.gates.materialChanges, { caseRef: ids(a).case }],
    ] as const) {
      const res = await call(t.app, def, { params: params as never, cookie: k.mayaB });
      expect(res.statusCode).toBe(404);
    }
    const admin = await call(t.app, API.gates.package, { params: { id: ids(a).g2 }, cookie: k.admin });
    expect(admin.statusCode).toBe(404);
  });
});

describe('stale → refresh v4 → approve with conditions (steps 19, 20)', () => {
  it('step 19: a Base adoption change makes v3 stale; deciding on v3 → SNAPSHOT_STALE', async () => {
    const v3 = await currentPackage(t, k.elena, ids(a).g2);
    const applied = await changeBaseAdoption(a, '0.25');
    expect(applied[0]!.outcome.staleSnapshotIds).toEqual([v3.snapshot.id]);
    const pkg = await currentPackage(t, k.elena, ids(a).g2);
    expect(pkg.snapshot.status).toBe('stale');
    expect(pkg.staleBanner!.title).toMatch(/^This snapshot is out of date: adoption assumption changed on \d+ \w+\. Approval is disabled\.$/);
    expect(pkg.panel.canDecide).toBe(false);
    const res = await call(t.app, API.gates.decide, {
      params: { id: ids(a).g2 },
      body: decideBody(v3, { disposition: 'approve_with_conditions', conditions: g2Conditions(a) }),
      cookie: k.elena,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(409);
    expect(problem(res.body).code).toBe('SNAPSHOT_STALE');
    expect(problem(res.body).title).toContain('adoption assumption changed');
  });

  it('only the case owner refreshes (403), never across tenants (404)', async () => {
    const elena = await call(t.app, API.gates.refresh, { params: { id: ids(a).g2 }, cookie: k.elena, idempotencyKey: true });
    expect(elena.statusCode).toBe(403);
    const other = await call(t.app, API.gates.refresh, { params: { id: ids(a).g2 }, cookie: k.mayaB, idempotencyKey: true });
    expect(other.statusCode).toBe(404);
  });

  it('step 19: refresh creates v4 current, v3 superseded; the diff shows the adoption change', async () => {
    const before = await currentPackage(t, k.maya, ids(a).g2);
    const key = randomUUID();
    const res = await call(t.app, API.gates.refresh, { params: { id: ids(a).g2 }, cookie: k.maya, idempotencyKey: key });
    expect(res.statusCode).toBe(200);
    const out = API.gates.refresh.response.parse(res.json());
    expect(out.snapshot.version).toBe(4);
    expect(out.snapshot.status).toBe('current');
    expect(out.gateRequest.status).toBe('awaiting_decision');
    expect(out.gateRequest.currentSnapshotId).toBe(out.snapshot.id);
    // Replay with the same key returns the same snapshot (no v5).
    const replay = await call(t.app, API.gates.refresh, { params: { id: ids(a).g2 }, cookie: k.maya, idempotencyKey: key });
    expect(replay.json()).toEqual(res.json());
    const old = await currentPackage(t, k.elena, ids(a).g2);
    expect(old.snapshot.version).toBe(4);
    const v3 = await call(t.app, API.gates.package, { params: { id: ids(a).g2 }, query: { version: 3 }, cookie: k.elena });
    expect(API.gates.package.response.parse(v3.json()).snapshot.status).toBe('superseded');
    expect(old.changesSinceViewerLastSaw.some((l) => l.startsWith('Adoption 20% by year 3: 20% → 25%'))).toBe(true);

    const diff = await call(t.app, API.gates.diff, {
      params: { id: before.snapshot.id },
      query: { against: out.snapshot.id },
      cookie: k.daniel,
    });
    expect(diff.statusCode).toBe(200);
    const changes = API.gates.diff.response.parse(diff.json()).changes;
    expect(changes).toContainEqual(
      expect.objectContaining({ label: 'Adoption 20% by year 3', from: '20%', to: '25%', material: true }),
    );
    // Positions and dissent recorded on v3 are carried, never lost.
    expect(out.snapshot.content.dissent[0]!.statement).toBe(gates.g2.dissent.statement);
    expect(out.snapshot.content.signOffs.map((s) => s.area).sort()).toEqual(['finance', 'pilot_owner', 'product', 'specialist']);
    expect(await auditActions(t, a, ids(a).g2)).toContain('gate_request.refresh');
    const ev = await analyticsFor(t, a, 'gate_submitted');
    expect(ev.at(-1)!.props).toEqual({ gate: 'G2', snapshotVersion: 4 });
    const cross = await call(t.app, API.gates.diff, { params: { id: before.snapshot.id }, query: { against: 'current_inputs' }, cookie: k.mayaB });
    expect(cross.statusCode).toBe(404);
    const vsInputs = await call(t.app, API.gates.diff, { params: { id: out.snapshot.id }, query: { against: 'current_inputs' }, cookie: k.maya });
    expect(API.gates.diff.response.parse(vsInputs.json()).changes).toEqual([]);
  });

  it('step 20: Elena approves v4 with C1 (blocks) and C2 (monitor) → Pilot approved, expiry set, gate_approved', async () => {
    const v4 = await currentPackage(t, k.elena, ids(a).g2);
    const res = await call(t.app, API.gates.decide, {
      params: { id: ids(a).g2 },
      body: decideBody(v4, {
        disposition: 'approve_with_conditions',
        rationale: gates.g2.decision.rationale,
        conditions: g2Conditions(a),
      }),
      cookie: k.elena,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(201);
    const pkg = API.gates.decide.response.parse(res.json());
    expect(pkg.gateRequest.status).toBe('approved_with_conditions');
    expect(pkg.gateRequest.expiresAt).not.toBeNull();
    const days = (Date.parse(pkg.gateRequest.expiresAt!) - Date.parse(pkg.gateRequest.decidedAt!)) / 86_400_000;
    expect(days).toBe(14);
    expect(pkg.approvals).toHaveLength(1);
    expect(pkg.approvals[0]).toMatchObject({ snapshotId: v4.snapshot.id, snapshotHash: v4.snapshot.contentHash, effective: true });
    // Coordinator note (WS8c): conditions repeated word for word are the proposed C1/C2, not duplicates.
    expect(pkg.gateRequest.conditions.map((c) => [c.key, c.flag])).toEqual([
      ['C1', 'blocks_execution'],
      ['C2', 'monitor_only'],
    ]);
    expect(pkg.panel.canDecide).toBe(false);
    expect(await caseStage(t, a)).toBe('pilot_approved');
    expect(await auditActions(t, a, ids(a).g2)).toContain('gate_request.approve_with_conditions');
    const ga = await analyticsFor(t, a, 'gate_approved');
    expect(ga.at(-1)!.props).toMatchObject({ gate: 'G2', withConditions: true });
    expect(JSON.stringify(ga)).not.toContain('Thresholds met');
    const audits = await inTenant(t, a, (tx) =>
      tx.selectFrom('platform.audit_event').select(['summary', 'details']).where('object_id', '=', ids(a).g2).execute(),
    );
    expect(JSON.stringify(audits)).not.toContain(gates.g2.decision.rationale);
  });

  it('marks C1 met only by its owner (Jonas) or the case owner; others 403; cross-tenant 404', async () => {
    const pkg = await currentPackage(t, k.jonas, ids(a).g2);
    const c1 = pkg.gateRequest.conditions.find((c) => c.key === 'C1')!;
    const priya = await call(t.app, API.gates.markConditionMet, { params: { id: c1.id }, body: { evidence: 'Site list' }, cookie: k.priya, idempotencyKey: true });
    expect(priya.statusCode).toBe(403);
    const other = await call(t.app, API.gates.markConditionMet, { params: { id: c1.id }, body: { evidence: 'Site list' }, cookie: k.mayaB, idempotencyKey: true });
    expect(other.statusCode).toBe(404);
    const ok = await call(t.app, API.gates.markConditionMet, {
      params: { id: c1.id },
      body: { evidence: 'Signed site list limited to 4 sites' },
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(ok.statusCode).toBe(200);
    expect(API.gates.markConditionMet.response.parse(ok.json())).toMatchObject({ key: 'C1', status: 'met' });
    expect(await auditActions(t, a, c1.id)).toEqual(['condition.met']);
    const again = await call(t.app, API.gates.markConditionMet, { params: { id: c1.id }, body: { evidence: 'x' }, cookie: k.jonas, idempotencyKey: true });
    expect(again.statusCode).toBe(409);
  });

  it('lists material changes with affected snapshots; resolving needs an uncertain change and the sponsor', async () => {
    const res = await call(t.app, API.gates.materialChanges, { params: { caseRef: 'ME-104' }, cookie: k.maya });
    expect(res.statusCode).toBe(200);
    const items = API.gates.materialChanges.response.parse(res.json()).items;
    const mc = items.find((i) => i.changeType === 'decision_critical_assumption_changed')!;
    expect(mc.classification).toBe('material');
    // v3 (awaiting → stale) and the approved G1 v1, which pins the same assumption version.
    expect(mc.affectedSnapshotIds).toHaveLength(2);
    const maya = await call(t.app, API.gates.resolveMateriality, {
      params: { id: mc.id },
      body: { classification: 'material', rationale: 'x' },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(maya.statusCode).toBe(403);
    const elena = await call(t.app, API.gates.resolveMateriality, {
      params: { id: mc.id },
      body: { classification: 'material', rationale: 'x' },
      cookie: k.elena,
      idempotencyKey: true,
    });
    expect(elena.statusCode).toBe(409);
    const other = await call(t.app, API.gates.resolveMateriality, {
      params: { id: mc.id },
      body: { classification: 'material', rationale: 'x' },
      cookie: k.elenaB,
      idempotencyKey: true,
    });
    expect(other.statusCode).toBe(404);
  });
});

describe('uncertain changes: escalation resolved by the sponsor', () => {
  it('a source change on an approved G1 escalates; the sponsor classifies it material → G1 invalidated', async () => {
    const s = await seedTenant(t.db, 'aster-demo');
    const elena = await login(t.app, s.user('elena'));
    const mcId = await inTenant(t, s, async (tx) => {
      const out = await applyMateriality(
        systemTools(tx, { tenantId: s.tenantId, correlationId: 'test-src', now: new Date(), rule: 'test' }),
        {
          changeType: 'source_superseded_or_deleted',
          objectType: 'source',
          objectId: ids(s).src('SRC-014'),
          componentType: 'source',
          label: 'source SRC-014',
        },
        { now: new Date(), actorUserId: s.user('maya') },
      );
      return out[0]!.materialChangeId;
    });
    const res = await call(t.app, API.gates.resolveMateriality, {
      params: { id: mcId },
      body: { classification: 'material', rationale: 'The census edition was replaced; validation must be re-authorized.' },
      cookie: elena,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(200);
    const mc = API.gates.resolveMateriality.response.parse(res.json());
    expect(mc.resolvedClassification).toBe('material');
    expect(mc.affectedApprovalIds.length).toBeGreaterThan(0);
    const g1 = await call(t.app, API.gates.get, { params: { id: ids(s).g1 }, cookie: elena });
    expect(API.gates.get.response.parse(g1.json()).status).toBe('invalidated');
    expect(await auditActions(t, s, mcId)).toEqual(['material_change.detected', 'material_change.resolved']);
    expect((await analyticsFor(t, s, 'approval_invalidated')).at(-1)!.props).toEqual({
      gate: 'G1',
      changeType: 'source_superseded_or_deleted',
    });
  });
});

describe('positions and dissent', () => {
  it('a reviewer signs a position on the current snapshot; read-only reviewers 403; cross-tenant 404', async () => {
    const daniel = await login(t.app, b.user('daniel'));
    const pkg = await currentPackage(t, daniel, ids(b).g2);
    const ops = await login(t.app, b.user('opsLead'));
    const ok = await call(t.app, API.gates.recordPosition, {
      params: { id: pkg.snapshot.id },
      body: { area: 'finance', position: 'supports_with_conditions', scopeText: 'Margin and opex scope checked' },
      cookie: daniel,
      idempotencyKey: true,
    });
    expect(ok.statusCode).toBe(201);
    const view = API.gates.recordPosition.response.parse(ok.json());
    expect(view.positions.find((p) => p.area === 'finance')!.scopeText).toBe('Margin and opex scope checked');
    const no = await call(t.app, API.gates.recordPosition, {
      params: { id: pkg.snapshot.id },
      body: { area: 'operations', position: 'supports', scopeText: 'x' },
      cookie: ops,
      idempotencyKey: true,
    });
    expect(no.statusCode).toBe(403);
    const cross = await call(t.app, API.gates.recordPosition, {
      params: { id: pkg.snapshot.id },
      body: { area: 'finance', position: 'supports', scopeText: 'x' },
      cookie: k.daniel,
      idempotencyKey: true,
    });
    expect(cross.statusCode).toBe(404);
  });

  it('records signed dissent bound to the current snapshot and carries it into the package', async () => {
    const priya = await login(t.app, b.user('priya'));
    const ops = await login(t.app, b.user('opsLead'));
    const res = await call(t.app, API.gates.recordDissent, {
      params: { caseRef: 'ME-104' },
      body: { statement: 'Install effort is underestimated for older plants.', scopeText: 'Scope: deployment effort · v3' },
      cookie: priya,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(201);
    const d = API.gates.recordDissent.response.parse(res.json());
    expect(d.signedSnapshotVersion).toBe(3);
    const audit = await auditActions(t, b, d.id);
    expect(audit).toEqual(['dissent.recorded']);
    const raw = await inTenant(t, b, (tx) => tx.selectFrom('platform.audit_event').select('summary').where('object_id', '=', d.id).execute());
    expect(JSON.stringify(raw)).not.toContain('underestimated');
    const pkg = await currentPackage(t, k.elenaB, ids(b).g2);
    expect(pkg.dissent.map((x) => x.statement)).toContain('Install effort is underestimated for older plants.');
    expect((await call(t.app, API.gates.recordDissent, { params: { caseRef: 'ME-104' }, body: { statement: 'x', scopeText: 'y' }, cookie: ops, idempotencyKey: true })).statusCode).toBe(403);
    expect((await call(t.app, API.gates.recordDissent, { params: { caseRef: ids(b).case }, body: { statement: 'x', scopeText: 'y' }, cookie: k.priya, idempotencyKey: true })).statusCode).toBe(404);
  });
});

describe('G1 path (steps 10, 11)', () => {
  let s: SeededTenant;
  const c: Record<string, string> = {};
  let gateId = '';
  beforeAll(async () => {
    s = await seedTenant(t.db, 'aster-demo');
    await assessmentCase(t, s);
    c.maya = await login(t.app, s.user('maya'));
    c.elena = await login(t.app, s.user('elena'));
    c.daniel = await login(t.app, s.user('daniel'));
  });

  it('step 10: EXP-03-style plan + G1 request → submit freezes snapshot v1 (hashed); preconditions met', async () => {
    const asm = await inTenant(t, s, (tx) => tx.selectFrom('platform.assumption').select('id').where('display_key', '=', 'ASM-90').executeTakeFirstOrThrow());
    const exp = await call(t.app, API.experiments.create, {
      params: { caseRef: 'ME-110' },
      body: { title: 'Validation outreach · 20 sites', assumptionIds: [asm.id], ownerId: s.user('maya'), fieldworkOwnerId: s.user('jonas'), plan: exp03Plan() },
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(exp.statusCode).toBe(201);
    const pre = API.gates.rail.response.parse(
      (await call(t.app, API.gates.rail, { params: { caseRef: 'ME-110', gateCode: 'G1' }, cookie: c.maya })).json(),
    );
    expect(pre.preconditions.map((p) => [p.key, p.met])).toEqual([
      ['evidence_inventory', true],
      ['comparable_sizing', true],
      ['material_unknowns_listed', true],
      ['feasibility_blockers_listed', true],
    ]);
    expect(pre.canSubmit).toBe(true);
    const daniel = await call(t.app, API.gates.createRequest, {
      params: { caseRef: 'ME-110' },
      body: { gateCode: 'G1', scope: g1Scope(s), parentGateRequestId: null, proposedConditions: [] },
      cookie: c.daniel,
      idempotencyKey: true,
    });
    expect(daniel.statusCode).toBe(403);
    const cr = await call(t.app, API.gates.createRequest, {
      params: { caseRef: 'ME-110' },
      body: { gateCode: 'G1', scope: g1Scope(s), parentGateRequestId: null, proposedConditions: [] },
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(cr.statusCode).toBe(201);
    const gr = API.gates.createRequest.response.parse(cr.json());
    expect(gr).toMatchObject({ key: 'ME-110-G1', status: 'draft', buttonLabel: 'Approve validation €15k' });
    gateId = gr.id;
    const crossSubmit = await call(t.app, API.gates.submit, { params: { id: gateId }, cookie: k.maya, idempotencyKey: true });
    expect(crossSubmit.statusCode).toBe(404);
    const danielSubmit = await call(t.app, API.gates.submit, { params: { id: gateId }, cookie: c.daniel, idempotencyKey: true });
    expect(danielSubmit.statusCode).toBe(403);
    const sub = await call(t.app, API.gates.submit, { params: { id: gateId }, cookie: c.maya, idempotencyKey: true });
    expect(sub.statusCode).toBe(200);
    const out = API.gates.submit.response.parse(sub.json());
    expect(out.snapshot.version).toBe(1);
    expect(out.snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.snapshot.content.subject).toEqual({ type: 'case', id: out.gateRequest.caseId, key: 'ME-110' });
    expect(out.snapshot.content.components.some((x) => x.type === 'experiment_plan_version')).toBe(true);
    expect(out.snapshot.content.outcomeTargets.map((x) => x.thresholdText)).toEqual(['≥ 8', '≥ 4']);
    expect(out.gateRequest.status).toBe('awaiting_decision');
    expect(await auditActions(t, s, gateId)).toEqual(['gate_request.created', 'gate_request.submit']);
    expect((await analyticsFor(t, s, 'gate_submitted')).at(-1)!.props).toEqual({ gate: 'G1', snapshotVersion: 1 });
  });

  it('step 11: Elena approves "Approve validation €15k" → stage Validation, plan locked, validation_authorized + gate_approved', async () => {
    const pkg = await currentPackage(t, c.elena, gateId);
    const res = await call(t.app, API.gates.decide, {
      params: { id: gateId },
      body: decideBody(pkg, { rationale: gates.g1.decision.rationale }),
      cookie: c.elena,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(201);
    expect(API.gates.decide.response.parse(res.json()).gateRequest.status).toBe('approved');
    expect(await caseStage(t, s, 'ME-110')).toBe('validation');
    const list = API.experiments.list.response.parse(
      (await call(t.app, API.experiments.list, { params: { caseRef: 'ME-110' }, cookie: c.maya })).json(),
    );
    expect(list.items[0]).toMatchObject({ lifecycle: 'locked', lockedByGateRequestId: gateId });
    expect(list.items[0]!.original!.isOriginal).toBe(true);
    expect((await analyticsFor(t, s, 'validation_authorized')).length).toBe(1);
    expect((await analyticsFor(t, s, 'gate_approved')).at(-1)!.props).toMatchObject({ gate: 'G1', withConditions: false });
  });
});

function g1Scope(s: SeededTenant) {
  return {
    amount: '15000.00',
    currency: 'EUR',
    durationDays: null,
    windowStart: '2026-10-19',
    windowEnd: '2026-11-13',
    countryCodes: ['AT'],
    segmentLabel: 'Dairy',
    maxSites: 20,
    milestones: [],
    ownerId: s.user('maya'),
    authorizes: [...gates.g1.authorizes],
    doesNotAuthorize: [...gates.g1.doesNotAuthorize],
  };
}

function g2Scope(s: SeededTenant, amount = '120000.00') {
  return {
    amount,
    currency: 'EUR',
    durationDays: 90,
    windowStart: gates.g2.windowStart,
    windowEnd: gates.g2.windowEnd,
    countryCodes: ['DE'],
    segmentLabel: 'Food processing',
    maxSites: 4,
    milestones: [],
    ownerId: s.user('jonas'),
    authorizes: [...gates.g2.authorizes],
    doesNotAuthorize: [...gates.g2.doesNotAuthorize],
  };
}

describe('withdraw, new request, return → resubmit (coordinator note: current-snapshot decisions only)', () => {
  let s: SeededTenant;
  const c: Record<string, string> = {};
  let newG2 = '';
  beforeAll(async () => {
    s = await seedTenant(t.db, 'aster-demo');
    for (const p of ['maya', 'elena', 'daniel'] as const) c[p] = await login(t.app, s.user(p));
  });

  it('withdraw is the author’s: Elena 403; Maya withdraws → case back to Validation', async () => {
    const no = await call(t.app, API.gates.withdraw, { params: { id: ids(s).g2 }, body: { rationale: 'x' }, cookie: c.elena, idempotencyKey: true });
    expect(no.statusCode).toBe(403);
    const cross = await call(t.app, API.gates.withdraw, { params: { id: ids(s).g2 }, body: { rationale: 'x' }, cookie: k.maya, idempotencyKey: true });
    expect(cross.statusCode).toBe(404);
    const ok = await call(t.app, API.gates.withdraw, { params: { id: ids(s).g2 }, body: { rationale: 'Rework the package' }, cookie: c.maya, idempotencyKey: true });
    expect(ok.statusCode).toBe(200);
    expect(API.gates.withdraw.response.parse(ok.json()).status).toBe('withdrawn');
    expect(await caseStage(t, s)).toBe('validation');
    expect(await auditActions(t, s, ids(s).g2)).toContain('gate_request.withdraw');
  });

  it('a new G2 with proposed conditions is submitted → stage Pilot approval pending, gate_submitted', async () => {
    const cr = await call(t.app, API.gates.createRequest, {
      params: { caseRef: 'ME-104' },
      body: { gateCode: 'G2', scope: g2Scope(s), parentGateRequestId: null, proposedConditions: g2Conditions(s) },
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(cr.statusCode).toBe(201);
    newG2 = API.gates.createRequest.response.parse(cr.json()).id;
    const dup = await call(t.app, API.gates.createRequest, {
      params: { caseRef: 'ME-104' },
      body: { gateCode: 'G2', scope: g2Scope(s), parentGateRequestId: null, proposedConditions: [] },
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(dup.statusCode).toBe(409);
    const sub = await call(t.app, API.gates.submit, { params: { id: newG2 }, cookie: c.maya, idempotencyKey: true });
    expect(sub.statusCode).toBe(200);
    const out = API.gates.submit.response.parse(sub.json());
    expect(out.gateRequest.key).toBe('ME-104-G2-2');
    expect(out.snapshot.version).toBe(4);
    expect(out.snapshot.content.conditionsProposed).toHaveLength(2);
    expect(out.snapshot.content.dissent[0]!.statement).toBe(gates.g2.dissent.statement);
    expect(await caseStage(t, s)).toBe('pilot_approval_pending');
    expect((await analyticsFor(t, s, 'gate_submitted')).at(-1)!.props).toEqual({ gate: 'G2', snapshotVersion: 4 });
  });

  it('Elena returns it; after resubmit the package lists only the new snapshot’s decisions and is approvable', async () => {
    const v4 = await currentPackage(t, c.elena, newG2);
    const ret = await call(t.app, API.gates.decide, {
      params: { id: newG2 },
      body: decideBody(v4, { disposition: 'return_for_revision', rationale: 'Add the install effort log.' }),
      cookie: c.elena,
      idempotencyKey: true,
    });
    expect(ret.statusCode).toBe(201);
    expect(API.gates.decide.response.parse(ret.json()).gateRequest.status).toBe('returned_for_revision');
    expect(await caseStage(t, s)).toBe('validation');
    expect((await analyticsFor(t, s, 'gate_returned')).at(-1)!.props).toMatchObject({ gate: 'G2', disposition: 'return_for_revision' });
    const re = await call(t.app, API.gates.submit, { params: { id: newG2 }, cookie: c.maya, idempotencyKey: true });
    expect(re.statusCode).toBe(200);
    expect(API.gates.submit.response.parse(re.json()).snapshot.version).toBe(5);
    const v5 = await currentPackage(t, c.elena, newG2);
    expect(v5.approvals).toEqual([]);
    expect(v5.panel.canDecide).toBe(true);
    expect(v5.panel.allowedDispositions).toContain('approve');
    expect(v5.gateHistory.some((h) => h.gateRequestId === newG2 && h.status === 'returned_for_revision' && h.snapshotVersion === 4)).toBe(true);
    // Approving with a proposed condition repeated plus one new one: C1 kept, new is C3 (C2 not adopted).
    const conds = [g2Conditions(s)[0]!, { text: 'Weekly budget report', ownerId: s.user('jonas'), dueOn: null, dueRule: 'Weekly', flag: 'monitor_only' }];
    const ok = await call(t.app, API.gates.decide, {
      params: { id: newG2 },
      body: decideBody(v5, { disposition: 'approve_with_conditions', conditions: [...conds, conds[0]] }),
      cookie: c.elena,
      idempotencyKey: true,
    });
    expect(ok.statusCode).toBe(201);
    const pkg = API.gates.decide.response.parse(ok.json());
    expect(pkg.gateRequest.conditions.map((x) => x.key)).toEqual(['C1', 'C3']);
    expect(pkg.approvals.map((x) => x.disposition)).toEqual(['approve_with_conditions']);
    expect(await caseStage(t, s)).toBe('pilot_approved');
  });

  it('above the authority ceiling → AUTHORITY_INSUFFICIENT (Elena’s G2 grant is €[limit])', async () => {
    const s2 = await seedTenant(t.db, 'aster-demo');
    const maya = await login(t.app, s2.user('maya'));
    const elena = await login(t.app, s2.user('elena'));
    await call(t.app, API.gates.withdraw, { params: { id: ids(s2).g2 }, body: { rationale: 'Bigger pilot' }, cookie: maya, idempotencyKey: true });
    const cr = await call(t.app, API.gates.createRequest, {
      params: { caseRef: 'ME-104' },
      body: { gateCode: 'G2', scope: g2Scope(s2, '300000.00'), parentGateRequestId: null, proposedConditions: [] },
      cookie: maya,
      idempotencyKey: true,
    });
    const id = API.gates.createRequest.response.parse(cr.json()).id;
    expect((await call(t.app, API.gates.submit, { params: { id }, cookie: maya, idempotencyKey: true })).statusCode).toBe(200);
    const pkg = await currentPackage(t, elena, id);
    expect(pkg.panel.allowedDispositions).not.toContain('approve');
    expect(pkg.panel.cannotDecideReason).toBe('This request is above your delegated authority (up to €[limit]).');
    const res = await call(t.app, API.gates.decide, { params: { id }, body: decideBody(pkg), cookie: elena, idempotencyKey: true });
    expect(res.statusCode).toBe(403);
    expect(problem(res.body).code).toBe('AUTHORITY_INSUFFICIENT');
    // Returning stays possible for the designated approver.
    const ret = await call(t.app, API.gates.decide, {
      params: { id },
      body: decideBody(pkg, { disposition: 'return_for_revision', rationale: 'Above my authority; route to the committee.' }),
      cookie: elena,
      idempotencyKey: true,
    });
    expect(ret.statusCode).toBe(201);
  });
});

describe('G0 for MD-21 (coordinator note): history vs current-decision fields', () => {
  let s: SeededTenant;
  const c: Record<string, string> = {};
  beforeAll(async () => {
    s = await seedTenant(t.db, 'aster-start');
    for (const p of ['maya', 'elena', 'daniel'] as const) c[p] = await login(t.app, s.user(p));
  });

  it('MD-21-G0 package shows only v2’s approval; v1’s return lives in history', async () => {
    const pkg = await currentPackage(t, c.elena, s.id(gates.g0.id));
    expect(pkg.snapshot.version).toBe(2);
    expect(pkg.snapshot.content.subject).toMatchObject({ type: 'mandate', key: 'MD-21' });
    expect(pkg.approvals.map((x) => x.disposition)).toEqual(['approve']);
    expect(pkg.gateHistory.map((h) => [h.status, h.snapshotVersion])).toEqual([
      ['returned_for_revision', 1],
      ['approved', 2],
    ]);
  });

  it('a mandate returned at G0 and resubmitted is approvable again on the new snapshot', async () => {
    const gateId = await inTenant(t, s, async (tx) => {
      const v2 = mandate.versions[1];
      const mId = randomUUID();
      const vId = randomUUID();
      await tx
        .insertInto('me.mandate')
        .values({ id: mId, tenant_id: s.tenantId, display_key: 'MD-90', business_unit_id: s.id(mandate.businessUnitId), title: 'Mandate · Austrian dairies', status: 'draft', created_by: s.user('maya') })
        .execute();
      await tx
        .insertInto('me.mandate_version')
        .values({
          id: vId,
          tenant_id: s.tenantId,
          mandate_id: mId,
          version: 1,
          state: 'committed',
          objective: 'Evaluate Austrian dairies',
          product_id: s.id(v2.productId),
          segment_ids: v2.segmentIds.map((x) => s.id(x)),
          geography_codes: ['AT'],
          exclusions: [...v2.exclusions],
          horizon_years: 3,
          pilot_duration_days: 90,
          currency: 'EUR',
          owner_user_id: s.user('maya'),
          sponsor_user_id: s.user('elena'),
          success_definition: v2.successDefinition,
          committed_at: sql`now()`,
          created_by: s.user('maya'),
        })
        .execute();
      await tx.updateTable('me.mandate').set({ current_version_id: vId }).where('id', '=', mId).execute();
      const g = await tx
        .insertInto('platform.gate_request')
        .values({
          tenant_id: s.tenantId,
          display_key: 'MD-90-G0',
          subject_type: 'mandate',
          subject_id: mId,
          business_unit_id: s.id(mandate.businessUnitId),
          gate_code: 'G0',
          scope: JSON.stringify({
            amount: null, currency: 'EUR', durationDays: null, windowStart: null, windowEnd: null, countryCodes: ['AT'],
            segmentLabel: 'Dairy', maxSites: null, milestones: [], ownerId: s.user('maya'), authorizes: ['Search and assessment within this scope'],
            doesNotAuthorize: ['No spend'],
          }),
          created_by: s.user('maya'),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return g.id;
    });
    expect((await call(t.app, API.gates.submit, { params: { id: gateId }, cookie: c.maya, idempotencyKey: true })).statusCode).toBe(200);
    const v1 = await currentPackage(t, c.elena, gateId);
    expect(v1.panel.canDecide).toBe(true);
    const ret = await call(t.app, API.gates.decide, {
      params: { id: gateId },
      body: decideBody(v1, { disposition: 'return_for_revision', rationale: 'State the exclusions for Austria.' }),
      cookie: c.elena,
      idempotencyKey: true,
    });
    expect(ret.statusCode).toBe(201);
    const afterReturn = await currentPackage(t, c.elena, gateId);
    expect(afterReturn.panel.canDecide).toBe(false);
    expect((await call(t.app, API.gates.submit, { params: { id: gateId }, cookie: c.maya, idempotencyKey: true })).statusCode).toBe(200);
    const v2 = await currentPackage(t, c.elena, gateId);
    expect(v2.snapshot.version).toBe(2);
    expect(v2.approvals).toEqual([]);
    expect(v2.panel.canDecide).toBe(true);
    expect(v2.panel.allowedDispositions).toContain('approve');
    const ok = await call(t.app, API.gates.decide, { params: { id: gateId }, body: decideBody(v2, { rationale: 'Bounded and owned.' }), cookie: c.elena, idempotencyKey: true });
    expect(ok.statusCode).toBe(201);
    const done = API.gates.decide.response.parse(ok.json());
    expect(done.gateRequest.status).toBe('approved');
    expect(done.gateRequest.expiresAt).toBeNull();
    expect(done.approvals.map((x) => x.disposition)).toEqual(['approve']);
    const m = await inTenant(t, s, (tx) => tx.selectFrom('me.mandate').select('status').where('display_key', '=', 'MD-90').executeTakeFirstOrThrow());
    expect(m.status).toBe('approved');
    expect((await analyticsFor(t, s, 'mandate_approved')).length).toBe(1);
  });
});

describe('G3 blocked (step 28)', () => {
  it('G3 request → 409 PRECONDITIONS_UNMET with four blockers and the D-039 summary', async () => {
    const s = await seedTenant(t.db, 'aster-demo');
    const maya = await login(t.app, s.user('maya'));
    const elena = await login(t.app, s.user('elena'));
    const pkg = await currentPackage(t, elena, ids(s).g2);
    expect(
      (await call(t.app, API.gates.decide, {
        params: { id: ids(s).g2 },
        body: decideBody(pkg, { disposition: 'approve_with_conditions', conditions: g2Conditions(s) }),
        cookie: elena,
        idempotencyKey: true,
      })).statusCode,
    ).toBe(201);
    // Actuals for the pre-registered targets (step 25 values) and the review-due stage.
    await inTenant(t, s, async (tx) => {
      const target = await tx.selectFrom('platform.outcome_target').select(['id']).where('metric_key', '=', outcomeTargets[0].metricKey).where('snapshot_id', '=', pkg.snapshot.id).executeTakeFirstOrThrow();
      await tx
        .insertInto('platform.outcome_observation')
        .values({ tenant_id: s.tenantId, case_id: ids(s).case, target_id: target.id, label: 'Paid use and continuation', value: '3', value_text: '3 of 4', unit: 'customers', period_start: '2026-12-01', period_end: '2027-02-28', source_text: 'Source: billing records', result: 'not_met', recorded_by: s.user('jonas') })
        .execute();
    });
    await setStage(t, s, 'ME-104', 'review_due');
    const res = await call(t.app, API.gates.createRequest, {
      params: { caseRef: 'ME-104' },
      body: { gateCode: 'G3', scope: { ...g2Scope(s), amount: null, currency: null, durationDays: null }, parentGateRequestId: null, proposedConditions: [] },
      cookie: maya,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(409);
    const p = problem(res.body);
    expect(p.code).toBe('PRECONDITIONS_UNMET');
    expect(p.title).toBe(
      'G3 preconditions unmet: demand threshold 3 of 4 (4 of 4 required); specialist scale-readiness review incomplete; economics and capacity not updated after the pilot; no scale budget stated',
    );
    expect(p.blockers!.map((x) => x.key)).toEqual([
      'pilot_actuals_vs_thresholds',
      'readiness_reassessment',
      'updated_economics_and_capacity',
      'approved_scale_budget',
    ]);
    expect(p.blockers!.slice(0, 2).map((x) => x.message)).toEqual(gates.g3.blockedBy.map((x) => x.message));
    const rail = API.gates.rail.response.parse((await call(t.app, API.gates.rail, { params: { caseRef: 'ME-104', gateCode: 'G3' }, cookie: maya })).json());
    expect(rail.status).toBe('blocked');
    expect(rail.canSubmit).toBe(false);
    expect(people.maya.displayName).toBe('Maya Rao');
  });
});
