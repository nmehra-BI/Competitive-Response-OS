/**
 * Applying materiality (ARCHITECTURE.md §9.3, D-013) to a committed change, in the caller's transaction.
 *
 *   pins      snapshots that pin the changed object (platform.snapshot_component), still current or stale
 *   decide    the WS3 MaterialityEvaluator (@growth-os/domain) with the tenant's active policy
 *   apply     material_change + the evaluator's impacts; gate commands go through the gate-request and
 *             snapshot machines (system actor): `mark_stale` → snapshot + gate request stale;
 *             `invalidate` → approval_invalidation, gate request invalidated, unsent outbox rows and
 *             external task links paused, analytics approval_invalidated, and the case follow-on
 *             (`g1_invalidated` / `g2_invalidated`) when the case is in a stage that allows it;
 *             audit material_change.detected (+ case.stage_changed).
 *
 * Uncertain changes escalate: snapshots go stale, approvals stay effective until the sponsor resolves
 * the change (`gates.resolveMateriality`). With no pins nothing is evaluated or written.
 */
import { sql, type Tx } from '@growth-os/db';
import {
  MaterialityPolicyBody,
  type CaseStage,
  type GateCode,
  type MaterialChangeType,
  type MaterialityPolicyBody as PolicyBody,
} from '@growth-os/contracts';
import {
  caseMachine,
  createMaterialityEvaluator,
  followOnForGate,
  gateRequestMachine,
  snapshotMachine,
  type ChangeDescriptor,
  type MaterialityEvaluator,
  type MaterialityOutcome,
  type SnapshotPin,
} from '@growth-os/domain';
import type { Tools } from './pipeline';

/** Default tenant-local calendar; each tenant's own zone is `platform.tenant.time_zone` (D-077). */
export const TENANT_TIME_ZONE = 'Europe/Berlin';

/** The current tenant's IANA time zone (RLS: the tenant row of the transaction's tenant). */
export async function tenantTimeZone(tx: Tx): Promise<string> {
  const r = await tx.selectFrom('platform.tenant').select('time_zone').executeTakeFirst();
  return r?.time_zone ?? TENANT_TIME_ZONE;
}

export interface PinnedChange {
  changeType: MaterialChangeType;
  objectType: string;
  objectId: string;
  /** snapshot_component.component_type to look up, e.g. 'source', 'assumption_version'. */
  componentType: string;
  fromVersion?: number | null;
  toVersion?: number | null;
  decisionCritical?: boolean;
  /** Business name of what changed for the stale banner, e.g. "source SRC-014". */
  label?: string;
}

export interface AppliedMateriality {
  caseId: string;
  materialChangeId: string;
  outcome: MaterialityOutcome;
  /** Case stage move made by the invalidation follow-on, if any. */
  caseStage?: { from: CaseStage; to: CaseStage };
}

/** "2026-11-26T12:00:00+01:00"-style local timestamp for the evaluator's reason copy. */
export function tenantLocalIso(at: Date, timeZone = TENANT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
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

const SYSTEM = { kind: 'system', reason: 'material_change' } as const;
const AFFECTS = { materialChange: { affectsSnapshot: true } };

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
  const timeZone = await tenantTimeZone(tx);

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
      committed: true,
      label: change.label,
      at: tenantLocalIso(opts.now, timeZone),
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

    for (const im of outcome.impacts)
      await tx
        .insertInto('platform.material_change_impact')
        .values({
          tenant_id: sql<string>`platform.current_tenant_id()`,
          material_change_id: mc.id,
          snapshot_id: im.snapshotId,
          effect: im.effect,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

    // Snapshots: current → stale through the snapshot machine.
    for (const snapshotId of outcome.staleSnapshotIds) {
      const pin = casePins.find((p) => p.snapshotId === snapshotId);
      if (!pin || !snapshotMachine.apply(pin.snapshotStatus, 'mark_stale', SYSTEM, AFFECTS).ok) continue;
      await tx
        .updateTable('platform.decision_snapshot')
        .set({ status: 'stale', stale_reason: outcome.reason, stale_at: opts.now })
        .where('id', '=', snapshotId)
        .where('status', '=', 'current')
        .execute();
    }

    const invalidatedGates: { gateRequestId: string; gateCode: GateCode }[] = [];
    for (const gc of outcome.gateCommands) {
      const pin = casePins.find((p) => p.gateRequestId === gc.gateRequestId);
      if (!pin) continue;
      const r = gateRequestMachine.apply(
        pin.gateStatus as Parameters<typeof gateRequestMachine.apply>[0],
        gc.command,
        SYSTEM,
        AFFECTS,
      );
      if (!r.ok) continue;
      await tx
        .updateTable('platform.gate_request')
        .set({ status: r.to })
        .where('id', '=', pin.gateRequestId)
        .where('status', '=', pin.gateStatus)
        .execute();
      if (gc.command === 'invalidate')
        invalidatedGates.push({ gateRequestId: pin.gateRequestId, gateCode: pin.gateCode });
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
      if (outcome.pauseUnsentWrites) {
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
      }
      await t.analytics(
        'approval_invalidated',
        { objectType: 'approval', objectId: approvalId, caseId },
        { gate: pin.gateCode, changeType: change.changeType },
      );
    }

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

    // Case follow-on for invalidated gates (G1 → back to Assessment, G2 → Pilot approval pending).
    let caseStage: AppliedMateriality['caseStage'];
    for (const g of invalidatedGates) {
      const follow = followOnForGate(g.gateCode, 'invalidate');
      if (!follow.case) continue;
      const row = await tx
        .selectFrom('platform.workflow_case')
        .select('stage')
        .where('id', '=', caseId)
        .executeTakeFirst();
      if (!row) continue;
      const from = row.stage as CaseStage;
      const r = caseMachine.apply(from, follow.case, SYSTEM, {});
      if (!r.ok || !r.changed) continue;
      // The row_version trigger bumps the version.
      const moved = await tx
        .updateTable('platform.workflow_case')
        .set({ stage: r.to })
        .where('id', '=', caseId)
        .where('stage', '=', from)
        .returning('row_version')
        .executeTakeFirst();
      if (!moved) continue;
      await t.audit({
        action: 'case.stage_changed',
        objectType: 'case',
        objectId: caseId,
        objectVersion: moved.row_version,
        caseId,
        summary: `Approval no longer applies: ${outcome.reasonShort}. Case returned for review.`.slice(
          0,
          280,
        ),
        details: { from, to: r.to, reason: follow.case },
      });
      caseStage = { from, to: r.to };
    }

    results.push({ caseId, materialChangeId: mc.id, outcome, ...(caseStage ? { caseStage } : {}) });
  }
  return results;
}
