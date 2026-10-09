/**
 * Case stage moves driven by the case machine, and the invalidation side of a materiality resolution.
 * Gate events drive stages (system actor); task completion never does. A follow-on that targets the
 * stage the case is already in is skipped (D-035).
 */
import type { AnalyticsEventName, AnalyticsProps, CaseStage, GateCode, MaterialChangeType } from '@growth-os/contracts';
import { sql } from '@growth-os/db';
import {
  caseMachine,
  followOnForGate,
  gateRequestMachine,
  type Actor,
  type CaseStageCommand,
  type LifecycleFacts,
  type MaterialityOutcome,
  type SnapshotPin,
} from '@growth-os/domain';
import type { z } from 'zod';
import type { Tools } from '../../../../platform/pipeline';
import { refuse, tenantIdSql } from './common';

export const SYSTEM_GATE: Actor = { kind: 'system', reason: 'gate_decision' };

type PropsFor = { [N in AnalyticsEventName]?: z.input<(typeof AnalyticsProps)[N]> };

/**
 * Apply a case machine command and persist it. System follow-ons (`strict: false`) are skipped when the
 * machine refuses or the case is already there; human commands (`strict: true`) throw the refusal.
 */
export async function moveCase(
  t: Tools,
  caseId: string,
  command: CaseStageCommand,
  opts: {
    actor?: Actor;
    facts?: LifecycleFacts;
    strict?: boolean;
    props?: PropsFor;
    summary?: string;
    reason?: string;
  } = {},
): Promise<{ from: CaseStage; to: CaseStage } | null> {
  const row = await t.tx
    .selectFrom('platform.workflow_case')
    .select(['stage', 'held_from_stage'])
    .where('id', '=', caseId)
    .executeTakeFirst();
  if (!row) return null;
  const from = row.stage as CaseStage;
  const r = caseMachine.apply(from, command, opts.actor ?? SYSTEM_GATE, {
    heldFromStage: (row.held_from_stage as CaseStage | null) ?? null,
    ...opts.facts,
  });
  if (!r.ok) {
    if (opts.strict) refuse(r);
    return null;
  }
  if (!r.changed) return null;
  const moved = await t.tx
    .updateTable('platform.workflow_case')
    .set({ stage: r.to, held_from_stage: null })
    .where('id', '=', caseId)
    .where('stage', '=', from)
    .returning('row_version')
    .executeTakeFirst();
  if (!moved) return null;
  await t.audit({
    action: 'case.stage_changed',
    objectType: 'case',
    objectId: caseId,
    objectVersion: moved.row_version,
    caseId,
    summary: (opts.summary ?? `Stage moved from ${from.replace(/_/g, ' ')} to ${r.to.replace(/_/g, ' ')}`).slice(
      0,
      280,
    ),
    details: { from, to: r.to, reason: opts.reason ?? command },
  });
  for (const ev of r.events) {
    const props = opts.props?.[ev];
    if (props === undefined) continue;
    await t.analytics(ev, { objectType: 'case', objectId: caseId, caseId, stage: r.to }, props as never);
  }
  return { from, to: r.to };
}

export interface PinRow extends SnapshotPin {
  caseId: string;
  gateCode: GateCode;
}

/** Pins (snapshot + gate + effective approvals) for a set of snapshots. */
export async function pinsForSnapshots(t: Tools, snapshotIds: readonly string[]): Promise<PinRow[]> {
  if (snapshotIds.length === 0) return [];
  const rows = await t.tx
    .selectFrom('platform.decision_snapshot as s')
    .innerJoin('platform.gate_request as g', 'g.id', 's.gate_request_id')
    .select(['s.id as snapshot_id', 's.status as snapshot_status', 'g.id as gate_id', 'g.status as gate_status', 'g.case_id', 'g.gate_code'])
    .where('s.id', 'in', [...snapshotIds])
    .execute();
  const out: PinRow[] = [];
  for (const r of rows) {
    const approvals = await t.tx
      .selectFrom('platform.approval as a')
      .leftJoin('platform.approval_invalidation as i', 'i.approval_id', 'a.id')
      .select('a.id')
      .where('a.snapshot_id', '=', r.snapshot_id)
      .where('a.disposition', 'in', ['approve', 'approve_with_conditions'])
      .where('i.id', 'is', null)
      .execute();
    out.push({
      snapshotId: r.snapshot_id,
      gateRequestId: r.gate_id,
      snapshotStatus: r.snapshot_status as SnapshotPin['snapshotStatus'],
      gateStatus: r.gate_status,
      effectiveApprovalIds: approvals.map((a) => a.id),
      caseId: r.case_id ?? '',
      gateCode: r.gate_code as GateCode,
    });
  }
  return out;
}

const SYSTEM_MC: Actor = { kind: 'system', reason: 'material_change' };

/**
 * Apply the approval side of a materiality outcome (used by `gates.resolveMateriality`): impacts,
 * gate invalidation through the machine, approval_invalidation rows, paused unsent writes, analytics
 * and the case follow-on. Mirrors platform `applyMateriality` (CR-WS4b-1 asks for a shared helper).
 */
export async function applyInvalidations(
  t: Tools,
  a: {
    caseId: string;
    materialChangeId: string;
    changeType: MaterialChangeType;
    outcome: MaterialityOutcome;
    pins: readonly PinRow[];
    now: Date;
  },
): Promise<{ invalidated: number; caseStage: { from: CaseStage; to: CaseStage } | null }> {
  const { tx } = t;
  for (const im of a.outcome.impacts)
    await tx
      .insertInto('platform.material_change_impact')
      .values({
        tenant_id: tenantIdSql,
        material_change_id: a.materialChangeId,
        snapshot_id: im.snapshotId,
        effect: im.effect,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  const invalidatedGates: PinRow[] = [];
  for (const gc of a.outcome.gateCommands) {
    const pin = a.pins.find((p) => p.gateRequestId === gc.gateRequestId);
    if (!pin) continue;
    const r = gateRequestMachine.apply(
      pin.gateStatus as Parameters<typeof gateRequestMachine.apply>[0],
      gc.command,
      SYSTEM_MC,
      { materialChange: { affectsSnapshot: true } },
    );
    if (!r.ok) continue;
    await tx
      .updateTable('platform.gate_request')
      .set({ status: r.to })
      .where('id', '=', pin.gateRequestId)
      .where('status', '=', pin.gateStatus)
      .execute();
    if (gc.command === 'invalidate') invalidatedGates.push(pin);
  }
  for (const approvalId of a.outcome.invalidateApprovalIds) {
    const pin = a.pins.find((p) => p.effectiveApprovalIds.includes(approvalId));
    if (!pin) continue;
    await tx
      .insertInto('platform.approval_invalidation')
      .values({
        tenant_id: tenantIdSql,
        approval_id: approvalId,
        kind: 'invalidated',
        reason: a.outcome.reason,
        material_change_id: a.materialChangeId,
        created_at: a.now,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
    if (a.outcome.pauseUnsentWrites) await pauseUnsent(t, pin.gateRequestId, a.now);
    await t.analytics(
      'approval_invalidated',
      { objectType: 'approval', objectId: approvalId, caseId: a.caseId },
      { gate: pin.gateCode, changeType: a.changeType },
    );
  }
  let caseStage: { from: CaseStage; to: CaseStage } | null = null;
  for (const g of invalidatedGates) {
    const follow = followOnForGate(g.gateCode, 'invalidate');
    if (!follow.case) continue;
    caseStage =
      (await moveCase(t, a.caseId, follow.case, {
        actor: SYSTEM_MC,
        summary: `Approval no longer applies: ${a.outcome.reasonShort}. Case returned for review.`,
      })) ?? caseStage;
  }
  return { invalidated: a.outcome.invalidateApprovalIds.length, caseStage };
}

/** Never-rule 10: unsent external writes authorized by the gate pause; executed ones are preserved. */
export async function pauseUnsent(t: Tools, gateRequestId: string, now: Date): Promise<void> {
  await t.tx
    .updateTable('platform.outbox_message')
    .set({ status: 'paused', updated_at: now })
    .where('status', 'in', ['pending', 'checking'])
    .where(sql<string>`authorization_ref->>'gateRequestId'`, '=', gateRequestId)
    .execute();
  await t.tx
    .updateTable('platform.external_task_link')
    .set({ sync_status: 'paused_approval_changed', updated_at: now })
    .where('sync_status', 'in', ['not_sent', 'in_preview', 'sending', 'retry_scheduled', 'checking'])
    .where('task_id', 'in', (eb) =>
      eb
        .selectFrom('platform.task as tk')
        .innerJoin('platform.task_set as ts', 'ts.id', 'tk.task_set_id')
        .select('tk.id')
        .where('ts.authorizing_gate_request_id', '=', gateRequestId),
    )
    .execute();
}
