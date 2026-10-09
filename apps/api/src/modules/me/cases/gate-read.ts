/**
 * Read-side gate helpers shared by WS4a (mandate submit, case header rail, overview). WS4b owns the
 * gate endpoints; these serializers only read committed rows.
 */
import {
  GateScope,
  type Condition,
  type GateCode,
  type GateRequest,
  type GateRequestStatus,
  type GateStatus,
} from '@growth-os/contracts';
import { deriveGateDisplayStatus, type GateEvaluation } from '@growth-os/domain';
import type { Tx } from '@growth-os/db';
import { isoDateOrNull, isoDateTimeOrNull } from '../../../platform/serialize';
import { moneyLabel, peopleMap, who } from './access';

export type GateRow = {
  id: string;
  display_key: string;
  case_id: string | null;
  subject_type: string;
  subject_id: string;
  business_unit_id: string;
  gate_code: string;
  status: string;
  scope: unknown;
  requested_amount: string | null;
  currency: string | null;
  duration_days: number | null;
  parent_gate_request_id: string | null;
  current_snapshot_id: string | null;
  submitted_by: string | null;
  submitted_at: Date | null;
  decided_at: Date | null;
  expires_at: Date | null;
  row_version: number;
  created_at: Date;
  created_by: string;
};

/** Scoped approval label — never a bare "Approve" (research §6.12). */
export function gateButtonLabel(
  gate: GateCode,
  amount: string | null,
  currency: string | null,
  durationDays: number | null,
): string {
  const money = moneyLabel(amount, currency ?? 'EUR');
  switch (gate) {
    case 'G0':
      return 'Approve mandate (G0)';
    case 'G1':
      return `Approve validation ${money}`;
    case 'G2':
      return `Approve pilot ${money}${durationDays ? ` · ${durationDays} days` : ''}`;
    case 'G3':
      return `Approve scale ${money}`;
    case 'X':
      return `Approve extension ${money}${durationDays ? ` · ${durationDays} days` : ''}`;
  }
}

export function displayStatusOf(
  gate: GateCode,
  status: GateRequestStatus | null,
  evaluation?: Pick<GateEvaluation, 'allMet' | 'metCount'>,
): GateStatus {
  return deriveGateDisplayStatus({
    gateCode: gate,
    requestStatus: status,
    evaluation: evaluation ?? { allMet: false, metCount: 0 },
  });
}

export async function toGateRequest(
  tx: Tx,
  g: GateRow,
  evaluation?: Pick<GateEvaluation, 'allMet' | 'metCount'>,
): Promise<GateRequest> {
  const conds = await tx
    .selectFrom('platform.condition')
    .selectAll()
    .where('gate_request_id', '=', g.id)
    .orderBy('key')
    .execute();
  const people = await peopleMap(tx, [
    g.submitted_by,
    ...conds.flatMap((c) => [c.owner_user_id, c.added_by]),
  ]);
  const conditions: Condition[] = conds.map((c) => ({
    id: c.id,
    key: c.key,
    text: c.text,
    owner: who(people, c.owner_user_id),
    dueOn: isoDateOrNull(c.due_on),
    dueRule: c.due_rule,
    flag: c.blocks_execution ? 'blocks_execution' : 'monitor_only',
    status: c.status as Condition['status'],
    addedBy: who(people, c.added_by),
    metEvidence: c.met_evidence,
    metAt: isoDateTimeOrNull(c.met_at),
  }));
  const gate = g.gate_code as GateCode;
  const scope = GateScope.parse(typeof g.scope === 'string' ? JSON.parse(g.scope) : g.scope);
  return {
    id: g.id,
    key: g.display_key,
    caseId: g.case_id,
    mandateId: g.subject_type === 'mandate' ? g.subject_id : null,
    gateCode: gate,
    status: g.status as GateRequestStatus,
    displayStatus: displayStatusOf(gate, g.status as GateRequestStatus, evaluation),
    scope,
    buttonLabel: gateButtonLabel(gate, g.requested_amount, g.currency ?? scope.currency, g.duration_days),
    parentGateRequestId: g.parent_gate_request_id,
    submittedBy: g.submitted_by ? who(people, g.submitted_by) : null,
    submittedAt: isoDateTimeOrNull(g.submitted_at),
    decidedAt: isoDateTimeOrNull(g.decided_at),
    expiresAt: isoDateTimeOrNull(g.expires_at),
    currentSnapshotId: g.current_snapshot_id,
    conditions,
    rowVersion: g.row_version,
  };
}

export async function gateRows(tx: Tx, caseId: string): Promise<GateRow[]> {
  return (await tx
    .selectFrom('platform.gate_request')
    .selectAll()
    .where('case_id', '=', caseId)
    .orderBy('created_at')
    .execute()) as GateRow[];
}
