/**
 * applyMateriality with the real WS3 MaterialityEvaluator: effects are written in the caller's
 * transaction (material change, impacts, stale snapshot and gate request through the machines,
 * escalation, approval invalidation with paused unsent writes, analytics and audit). The API paths
 * that commit a change to a pinned source (mark stale, replace) succeed end to end.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, MaterialityPolicyBody, SourceDetail } from '@growth-os/contracts';
import { withTenant } from '@growth-os/db';
import { createMaterialityEvaluator, type MaterialityEvaluator } from '@growth-os/domain';
import { gates, materialityRules, sources } from '@growth-os/fixtures-aster';
import { applyMateriality, findPins } from './materiality';
import { systemTools } from './pipeline';
import { call, createTestApp, login, seedTenant, type SeededTenant, type TestApp } from './testing';

let t: TestApp;
const now = new Date('2026-11-26T12:00:00+01:00');

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const inTenant = <T>(s: SeededTenant, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(t.db, { tenantId: s.tenantId, userId: null, correlationId: 'materiality-test' }, fn);
const src = (s: SeededTenant, key: string) => s.id(sources.find((x) => x.key === key)!.id);
const tools = (s: SeededTenant, tx: Parameters<typeof systemTools>[0]) =>
  systemTools(tx, { tenantId: s.tenantId, correlationId: 'materiality-test', now, rule: 'test' });
const sourceChange = (s: SeededTenant, key: string) => ({
  changeType: 'source_superseded_or_deleted' as const,
  objectType: 'source',
  objectId: src(s, key),
  componentType: 'source',
  label: `source ${key}`,
});

/** The real evaluator under a policy that classifies source changes as material. */
const materialSources: MaterialityEvaluator = (() => {
  const real = createMaterialityEvaluator();
  const policy = MaterialityPolicyBody.parse({
    rules: materialityRules.map((r) =>
      r.changeType === 'source_superseded_or_deleted' ? { ...r, classification: 'material' } : r,
    ),
    escalateTo: 'sponsor',
  });
  return { ...real, evaluate: (c, _p, pins) => real.evaluate(c, policy, pins) };
})();

const gateStatus = (s: SeededTenant, key: string) =>
  inTenant(s, (tx) =>
    tx
      .selectFrom('platform.gate_request')
      .select(['status', 'current_snapshot_id'])
      .where('display_key', '=', key)
      .executeTakeFirstOrThrow(),
  );

describe('applyMateriality (real evaluator)', () => {
  let a: SeededTenant;
  beforeAll(async () => {
    a = await seedTenant(t.db, 'aster-demo');
  });

  it('finds the snapshots that pin a source', async () => {
    const pins = await inTenant(a, (tx) => findPins(tx, 'source', src(a, 'SRC-014')));
    expect(pins.map((p) => p.gateCode).sort()).toEqual(['G1', 'G2']); // G1 v1 (approved) and G2 v3 (current)
  });

  it('default policy: a source change is uncertain — current snapshot stale, escalated, approvals untouched', async () => {
    const out = await inTenant(a, (tx) =>
      applyMateriality(tools(a, tx), sourceChange(a, 'SRC-014'), { now, actorUserId: null }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.outcome).toMatchObject({
      classification: 'uncertain',
      escalate: true,
      escalateTo: 'sponsor',
    });
    expect(out[0]!.caseStage).toBeUndefined();

    const g2 = await gateStatus(a, gates.g2.key);
    expect(g2.status).toBe('stale');
    expect((await gateStatus(a, gates.g1.key)).status).toMatch(/^approved/);
    await inTenant(a, async (tx) => {
      const v3 = await tx
        .selectFrom('platform.decision_snapshot')
        .selectAll()
        .where('id', '=', g2.current_snapshot_id!)
        .executeTakeFirstOrThrow();
      expect(v3).toMatchObject({ status: 'stale', stale_reason: 'source SRC-014 changed on 26 Nov' });
      expect(await tx.selectFrom('platform.approval_invalidation').selectAll().execute()).toHaveLength(0);
      const mc = await tx.selectFrom('platform.material_change').selectAll().execute();
      expect(mc.map((m) => m.classification)).toEqual(['uncertain']);
      const impacts = await tx.selectFrom('platform.material_change_impact').select('effect').execute();
      expect(impacts.map((i) => i.effect).sort()).toEqual(['escalated', 'escalated', 'snapshot_stale']);
      const audit = await tx
        .selectFrom('platform.audit_event')
        .select('action')
        .where('action', '=', 'material_change.detected')
        .execute();
      expect(audit).toHaveLength(1);
      expect(
        await tx
          .selectFrom('platform.analytics_event')
          .where('name', '=', 'approval_invalidated')
          .selectAll()
          .execute(),
      ).toHaveLength(0);
    });
  });

  it('writes nothing for an object no snapshot pins', async () => {
    const out = await inTenant(a, (tx) =>
      applyMateriality(tools(a, tx), sourceChange(a, 'SRC-009'), { now, actorUserId: null }),
    );
    expect(out).toEqual([]);
  });
});

describe('applyMateriality (material policy)', () => {
  let a: SeededTenant;
  beforeAll(async () => {
    a = await seedTenant(t.db, 'aster-demo');
  });

  it('marks the current snapshot stale and invalidates the effective approval in one transaction', async () => {
    const out = await inTenant(a, (tx) =>
      applyMateriality(tools(a, tx), sourceChange(a, 'SRC-014'), {
        now,
        actorUserId: null,
        evaluator: materialSources,
      }),
    );
    expect(out[0]!.outcome.classification).toBe('material');
    // ME-104 is in Pilot approval pending: the G1 follow-on (validation → assessment) does not apply.
    expect(out[0]!.caseStage).toBeUndefined();
    expect((await gateStatus(a, gates.g2.key)).status).toBe('stale');
    expect((await gateStatus(a, gates.g1.key)).status).toBe('invalidated');
    await inTenant(a, async (tx) => {
      const inv = await tx.selectFrom('platform.approval_invalidation').selectAll().execute();
      expect(inv).toHaveLength(1);
      expect(inv[0]!.reason).toBe('source SRC-014 changed on 26 Nov');
      const impacts = await tx.selectFrom('platform.material_change_impact').select('effect').execute();
      expect(impacts.map((i) => i.effect).sort()).toEqual(['approval_invalidated', 'snapshot_stale']);
      // Executed external writes are preserved: confirmed VAL tasks stay confirmed.
      const links = await tx.selectFrom('platform.external_task_link').select('sync_status').execute();
      expect(links.every((l) => l.sync_status === 'confirmed')).toBe(true);
      const ev = await tx
        .selectFrom('platform.analytics_event')
        .select(['name', 'props'])
        .where('name', '=', 'approval_invalidated')
        .execute();
      expect(ev).toEqual([
        { name: 'approval_invalidated', props: { gate: 'G1', changeType: 'source_superseded_or_deleted' } },
      ]);
    });
  });
});

describe('evidence commands on a pinned source no longer fail', () => {
  let a: SeededTenant;
  let maya: string;
  let priya: string;
  beforeAll(async () => {
    a = await seedTenant(t.db, 'aster-demo');
    maya = await login(t.app, a.user('maya'));
    priya = await login(t.app, a.user('priya'));
  });

  it('mark stale on SRC-014 (pinned by G1 v1 and G2 v3) succeeds and stales the G2 package', async () => {
    const denied = await call(t.app, API.evidence.markStale, {
      params: { ref: 'SRC-014' },
      body: { reason: 'x' },
      cookie: priya,
      idempotencyKey: true,
    });
    expect(denied.statusCode).toBe(403);
    const res = await call(t.app, API.evidence.markStale, {
      params: { ref: 'SRC-014' },
      body: { reason: 'Census 2027 edition announced' },
      cookie: maya,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(200);
    expect(SourceDetail.parse(res.json()).source.freshness).toBe('stale');
    expect((await gateStatus(a, gates.g2.key)).status).toBe('stale');
    await inTenant(a, async (tx) => {
      const actions = (
        await tx
          .selectFrom('platform.audit_event')
          .select('action')
          .where('action', 'in', ['source.marked_stale', 'material_change.detected'])
          .execute()
      ).map((r) => r.action);
      expect(actions.sort()).toEqual(['material_change.detected', 'source.marked_stale']);
    });
  });

  it('replacing a pinned source succeeds and records a second material change', async () => {
    const res = await call(t.app, API.evidence.replace, {
      params: { ref: 'SRC-014' },
      body: { replacementSourceId: src(a, 'SRC-040') },
      cookie: maya,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(200);
    expect(SourceDetail.parse(res.json()).source.freshness).toBe('superseded');
    await inTenant(a, async (tx) => {
      const mc = await tx.selectFrom('platform.material_change').select('classification').execute();
      expect(mc).toHaveLength(2);
    });
  });
});
