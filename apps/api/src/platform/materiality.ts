/**
 * Applying materiality (ARCHITECTURE.md §9.3) to a committed change, in the caller's transaction.
 *
 *   pins      snapshots that pin the changed object (platform.snapshot_component), still current or stale
 *   decide    MaterialityEvaluator from @growth-os/domain (WS3) with the tenant's active policy
 *   apply     material_change + impacts; current snapshots → stale (gate request → stale);
 *             approvals → approval_invalidation (gate request → invalidated), unsent outbox rows and
 *             external task links paused; analytics approval_invalidated; audit material_change.detected
 *
 * Moving the case stage back (§8.2) belongs to the case machine (WS3/WS4); callers do it from the
 * returned outcome. With no pins nothing is evaluated or written.
 */
import { sql, type Tx } from '@growth-os/db';
import {
  MaterialityPolicyBody,
  type GateCode,
  type MaterialChangeType,
  type MaterialityPolicyBody as PolicyBody,
} from '@growth-os/contracts';
import {
  createMaterialityEvaluator,
  type ChangeDescriptor,
  type MaterialityEvaluator,
  type MaterialityOutcome,
  type SnapshotPin,
} from '@growth-os/domain';
import type { Tools } from './pipeline';

export interface PinnedChange {
  changeType: MaterialChangeType;
  objectType: string;
  objectId: string;
  /** snapshot_component.component_type to look up, e.g. 'source', 'assumption_version'. */
  componentType: string;
  fromVersion?: number | null;
  toVersion?: number | null;
  decisionCritical?: boolean;
}

export interface AppliedMateriality {
  caseId: string;
  materialChangeId: string;
  outcome: MaterialityOutcome;
}

async function activePolicy(tx: Tx): Promise<{ id: string | null; body: PolicyBody }> {
  const row = await tx
    .selectFrom('platform.policy')
    .select(['id', 'body'])
    .where('kind', '=', 'materiality')
    .where('status', '=', 'active')
    .orderBy('version', 'desc')
    .executeTakeFirst();
  // No policy configured → empty rule table: every change classifies as uncertain (fail safe).
  return row
    ? { id: row.id, body: MaterialityPolicyBody.parse(row.body) }
    : { id: null, body: { rules: [], escalateTo: 'sponsor' } };
}

export async function findPins(
  tx: Tx,
  componentType: string,
  componentId: string,
): Promise<(SnapshotPin & { caseId: string; gateCode: GateCode })[]> {
  const rows = await tx
    .selectFrom('platform.snapshot_component as c')
    .innerJoin('platform.decision_snapshot as s', 's.id', 'c.snapshot_id')
    .innerJoin('platform.gate_request as g', 'g.id', 's.gate_request_id')
    .select([
      's.id as snapshot_id',
      's.status as snapshot_status',
      'g.id as gate_id',
      'g.status as gate_status',
      'g.case_id',
      'g.gate_code',
    ])
    .where('c.component_type', '=', componentType)
    .where('c.component_id', '=', componentId)
    .where('s.status', '<>', 'superseded')
    .where('g.case_id', 'is not', null)
    .execute();
  const pins = [];
  for (const r of rows) {
    const approvals = await tx
      .selectFrom('platform.approval as a')
      .leftJoin('platform.approval_invalidation as i', 'i.approval_id', 'a.id')
      .select('a.id')
      .where('a.snapshot_id', '=', r.snapshot_id)
      .where('a.disposition', 'in', ['approve', 'approve_with_conditions'])
      .where('i.id', 'is', null)
      .execute();
    pins.push({
      snapshotId: r.snapshot_id,
      gateRequestId: r.gate_id,
      snapshotStatus: r.snapshot_status as SnapshotPin['snapshotStatus'],
      gateStatus: r.gate_status,
      effectiveApprovalIds: approvals.map((a) => a.id),
      caseId: r.case_id!,
      gateCode: r.gate_code as GateCode,
    });
  }
  return pins;
}

export async function applyMateriality(
  t: Tools,
  change: PinnedChange,
  opts: { now: Date; actorUserId: string | null; evaluator?: MaterialityEvaluator },
): Promise<AppliedMateriality[]> {
  const { tx } = t;
  const pins = await findPins(tx, change.componentType, change.objectId);
  if (pins.length === 0) return [];
  const evaluator = opts.evaluator ?? createMaterialityEvaluator();
  const policy = await activePolicy(tx);
  const results: AppliedMateriality[] = [];

  for (const caseId of [...new Set(pins.map((p) => p.caseId))]) {
    const casePins = pins.filter((p) => p.caseId === caseId);
    const descriptor: ChangeDescriptor = {
      caseId,
      changeType: change.changeType,
      objectType: change.objectType,
      objectId: change.objectId,
      fromVersion: change.fromVersion ?? null,
      toVersion: change.toVersion ?? null,
      decisionCritical: change.decisionCritical,
    };
    const outcome = evaluator.evaluate(descriptor, policy.body, casePins);
    const mc = await tx
      .insertInto('platform.material_change')
      .values({
        tenant_id: sql<string>`platform.current_tenant_id()`,
        case_id: caseId,
        change_type: change.changeType,
        object_type: change.objectType,
        object_id: change.objectId,
        from_version: change.fromVersion ?? null,
        to_version: change.toVersion ?? null,
        classification: outcome.classification,
        rule_key: outcome.ruleKey,
        policy_id: policy.id,
        actor_user_id: opts.actorUserId,
        detected_at: opts.now,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const impact = (snapshotId: string, effect: 'snapshot_stale' | 'approval_invalidated' | 'escalated') =>
      tx
        .insertInto('platform.material_change_impact')
        .values({
          tenant_id: sql<string>`platform.current_tenant_id()`,
          material_change_id: mc.id,
          snapshot_id: snapshotId,
          effect,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

    for (const snapshotId of outcome.staleSnapshotIds) {
      const pin = casePins.find((p) => p.snapshotId === snapshotId);
      await tx
        .updateTable('platform.decision_snapshot')
        .set({ status: 'stale', stale_reason: outcome.reason, stale_at: opts.now })
        .where('id', '=', snapshotId)
        .where('status', '=', 'current')
        .execute();
      if (pin)
        await tx
          .updateTable('platform.gate_request')
          .set({ status: 'stale' })
          .where('id', '=', pin.gateRequestId)
          .where('status', '=', 'awaiting_decision')
          .execute();
      await impact(snapshotId, 'snapshot_stale');
      if (outcome.escalate) await impact(snapshotId, 'escalated');
    }

    for (const approvalId of outcome.invalidateApprovalIds) {
      const pin = casePins.find((p) => p.effectiveApprovalIds.includes(approvalId));
      if (!pin) continue;
      await tx
        .insertInto('platform.approval_invalidation')
        .values({
          tenant_id: sql<string>`platform.current_tenant_id()`,
          approval_id: approvalId,
          kind: 'invalidated',
          reason: outcome.reason,
          material_change_id: mc.id,
          created_at: opts.now,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await tx
        .updateTable('platform.gate_request')
        .set({ status: 'invalidated' })
        .where('id', '=', pin.gateRequestId)
        .execute();
      // Never-rule 10: unsent external writes pause; executed ones are preserved.
      await tx
        .updateTable('platform.outbox_message')
        .set({ status: 'paused', updated_at: opts.now })
        .where('status', 'in', ['pending', 'checking'])
        .where(sql<string>`authorization_ref->>'gateRequestId'`, '=', pin.gateRequestId)
        .execute();
      await tx
        .updateTable('platform.external_task_link')
        .set({ sync_status: 'paused_approval_changed', updated_at: opts.now })
        .where('sync_status', 'in', ['not_sent', 'in_preview', 'sending', 'retry_scheduled', 'checking'])
        .where('task_id', 'in', (eb) =>
          eb
            .selectFrom('platform.task as tk')
            .innerJoin('platform.task_set as ts', 'ts.id', 'tk.task_set_id')
            .select('tk.id')
            .where('ts.authorizing_gate_request_id', '=', pin.gateRequestId),
        )
        .execute();
      await impact(pin.snapshotId, 'approval_invalidated');
      await t.analytics(
        'approval_invalidated',
        { objectType: 'approval', objectId: approvalId, caseId },
        { gate: pin.gateCode, changeType: change.changeType },
      );
    }
    if (outcome.escalate && outcome.staleSnapshotIds.length === 0)
      for (const p of casePins) await impact(p.snapshotId, 'escalated');

    await t.audit({
      action: 'material_change.detected',
      objectType: 'material_change',
      objectId: mc.id,
      caseId,
      summary: `Change classified ${outcome.classification}: ${outcome.reason}`.slice(0, 280),
      details: {
        changeType: change.changeType,
        classification: outcome.classification,
        staleSnapshots: outcome.staleSnapshotIds.length,
        invalidatedApprovals: outcome.invalidateApprovalIds.length,
        escalated: outcome.escalate,
      },
    });
    results.push({ caseId, materialChangeId: mc.id, outcome });
  }
  return results;
}
