/**
 * applyMateriality: given the evaluator's outcome (WS3 owns the real evaluator; a stand-in is used
 * here), effects are written in the caller's transaction: material change, stale snapshot with its
 * gate request, escalation, approval invalidation with paused unsent writes, analytics and audit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@growth-os/db';
import type { MaterialityEvaluator } from '@growth-os/domain';
import { gates, sources } from '@growth-os/fixtures-aster';
import { applyMateriality, findPins } from './materiality';
import { systemTools } from './pipeline';
import { createTestApp, seedTenant, type SeededTenant, type TestApp } from './testing';

let t: TestApp;
let a: SeededTenant;
const now = new Date('2026-11-26T12:00:00+01:00');

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
});
afterAll(async () => {
  await t.close();
});

const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'materiality-test' }, fn);

const evaluator = (
  overrides: Partial<ReturnType<MaterialityEvaluator['evaluate']>>,
): MaterialityEvaluator => ({
  classify: () => ({ classification: 'uncertain', ruleKey: 'test' }),
  evaluate: (_c, _p, pins) => ({
    classification: 'uncertain',
    ruleKey: 'source_superseded_or_deleted',
    staleSnapshotIds: pins.filter((p) => p.gateStatus === 'awaiting_decision').map((p) => p.snapshotId),
    invalidateApprovalIds: [],
    escalate: true,
    reason: 'source SRC-014 changed on 26 Nov',
    ...overrides,
  }),
});

describe('applyMateriality', () => {
  it('finds the snapshots that pin a source', async () => {
    const pins = await run((tx) =>
      findPins(tx, 'source', a.id(sources.find((s) => s.key === 'SRC-014')!.id)),
    );
    expect(pins.map((p) => p.gateCode).sort()).toEqual(['G1', 'G2']); // G1 v1 (approved) and G2 v3 (current)
  });

  it('marks the current snapshot stale, escalates, and invalidates the effective approval in one transaction', async () => {
    const srcId = a.id(sources.find((s) => s.key === 'SRC-014')!.id);
    const out = await run(async (tx) => {
      const tools = systemTools(tx, {
        tenantId: a.tenantId,
        correlationId: 'materiality-test',
        now,
        rule: 'test',
      });
      const pins = await findPins(tx, 'source', srcId);
      const g1Approval = pins.find((p) => p.gateCode === 'G1')!.effectiveApprovalIds;
      return applyMateriality(
        tools,
        {
          changeType: 'source_superseded_or_deleted',
          objectType: 'source',
          objectId: srcId,
          componentType: 'source',
        },
        { now, actorUserId: null, evaluator: evaluator({ invalidateApprovalIds: [...g1Approval] }) },
      );
    });
    expect(out).toHaveLength(1);
    await run(async (tx) => {
      const g2 = await tx
        .selectFrom('platform.gate_request')
        .selectAll()
        .where('display_key', '=', gates.g2.key)
        .executeTakeFirstOrThrow();
      expect(g2.status).toBe('stale');
      const v3 = await tx
        .selectFrom('platform.decision_snapshot')
        .selectAll()
        .where('id', '=', g2.current_snapshot_id!)
        .executeTakeFirstOrThrow();
      expect(v3).toMatchObject({ status: 'stale', stale_reason: 'source SRC-014 changed on 26 Nov' });
      const g1 = await tx
        .selectFrom('platform.gate_request')
        .select('status')
        .where('display_key', '=', gates.g1.key)
        .executeTakeFirstOrThrow();
      expect(g1.status).toBe('invalidated');
      const inv = await tx.selectFrom('platform.approval_invalidation').selectAll().execute();
      expect(inv).toHaveLength(1);
      const impacts = await tx.selectFrom('platform.material_change_impact').select('effect').execute();
      expect(impacts.map((i) => i.effect).sort()).toEqual([
        'approval_invalidated',
        'escalated',
        'snapshot_stale',
      ]);
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
      const audit = await tx
        .selectFrom('platform.audit_event')
        .select('action')
        .where('action', '=', 'material_change.detected')
        .execute();
      expect(audit).toHaveLength(1);
    });
  });

  it('writes nothing for an object no snapshot pins', async () => {
    const out = await run((tx) =>
      applyMateriality(
        systemTools(tx, { tenantId: a.tenantId, correlationId: 'materiality-test', now, rule: 'test' }),
        {
          changeType: 'source_superseded_or_deleted',
          objectType: 'source',
          objectId: a.id(sources.find((s) => s.key === 'SRC-009')!.id),
          componentType: 'source',
        },
        { now, actorUserId: null, evaluator: evaluator({}) },
      ),
    );
    expect(out).toEqual([]);
  });
});
