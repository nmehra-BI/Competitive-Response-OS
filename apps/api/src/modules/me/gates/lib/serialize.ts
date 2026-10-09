/** Row → contract serializers for gate requests, snapshots, approvals, conditions, positions, dissent. */
import {
  ConditionInput,
  GateScope,
  RoleCode,
  SnapshotContent,
  toFingerprint,
  type Approval,
  type Condition,
  type DecisionSnapshot,
  type Dissent,
  type GateCode,
  type GateRequest,
  type GateRequestStatus,
  type GateStatus,
  type ReviewerPositionRecord,
} from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { deriveGateDisplayStatus, ME_GATES, type GateEvaluation } from '@growth-os/domain';
import { z } from 'zod';
import { isoDate, isoDateOrNull, isoDateTime, isoDateTimeOrNull } from '../../../../platform/serialize';
import { fmtMoneyShort, peopleOf, type People } from './common';

export interface GateRow {
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
  created_by: string;
  created_at: Date;
}

export const GATE_COLUMNS = [
  'id',
  'display_key',
  'case_id',
  'subject_type',
  'subject_id',
  'business_unit_id',
  'gate_code',
  'status',
  'scope',
  'requested_amount',
  'currency',
  'duration_days',
  'parent_gate_request_id',
  'current_snapshot_id',
  'submitted_by',
  'submitted_at',
  'decided_at',
  'expires_at',
  'row_version',
  'created_by',
  'created_at',
] as const;

export async function gateById(tx: Tx, id: string): Promise<GateRow | null> {
  return (
    ((await tx
      .selectFrom('platform.gate_request')
      .select([...GATE_COLUMNS])
      .where('id', '=', id)
      .executeTakeFirst()) as GateRow | undefined) ?? null
  );
}

/** Stored scope jsonb = GateScope + the proposed conditions of the request (WS4b decision). */
const StoredScope = GateScope.extend({ proposedConditions: z.array(ConditionInput).default([]) });

export function scopeOf(g: Pick<GateRow, 'scope'>): GateScope {
  return GateScope.parse(g.scope);
}

export function proposedConditionsOf(g: Pick<GateRow, 'scope'>): ConditionInput[] {
  return StoredScope.parse(g.scope).proposedConditions;
}

export function buttonLabel(gateCode: GateCode, scope: GateScope): string {
  return ME_GATES[gateCode].buttonLabel(scope, fmtMoneyShort);
}

export function displayStatus(
  g: Pick<GateRow, 'gate_code' | 'status'>,
  evaluation?: Pick<GateEvaluation, 'allMet' | 'metCount'>,
): GateStatus {
  return deriveGateDisplayStatus({
    gateCode: g.gate_code as GateCode,
    requestStatus: g.status as GateRequestStatus,
    evaluation: evaluation ?? { allMet: false, metCount: 1 },
  });
}

export interface ConditionRow {
  id: string;
  key: string;
  text: string;
  owner_user_id: string;
  due_on: unknown;
  due_rule: string | null;
  blocks_execution: boolean;
  status: string;
  added_by: string;
  met_evidence: string | null;
  met_at: Date | null;
  gate_request_id: string;
  approval_id: string | null;
}

export async function conditionRows(tx: Tx, gateIds: readonly string[]): Promise<ConditionRow[]> {
  if (gateIds.length === 0) return [];
  return (await tx
    .selectFrom('platform.condition')
    .select([
      'id',
      'key',
      'text',
      'owner_user_id',
      'due_on',
      'due_rule',
      'blocks_execution',
      'status',
      'added_by',
      'met_evidence',
      'met_at',
      'gate_request_id',
      'approval_id',
    ])
    .where('gate_request_id', 'in', [...gateIds])
    .orderBy('created_at')
    .orderBy('key')
    .execute()) as ConditionRow[];
}

export function toCondition(c: ConditionRow, people: People): Condition {
  return {
    id: c.id,
    key: c.key,
    text: c.text,
    owner: people(c.owner_user_id),
    dueOn: c.due_on === null ? null : isoDate(c.due_on as string),
    dueRule: c.due_rule,
    flag: c.blocks_execution ? 'blocks_execution' : 'monitor_only',
    status: c.status as Condition['status'],
    addedBy: people(c.added_by),
    metEvidence: c.met_evidence,
    metAt: isoDateTimeOrNull(c.met_at),
  };
}

/** Full GateRequest view (conditions and people loaded here). */
export async function toGateRequest(
  tx: Tx,
  g: GateRow,
  evaluation?: Pick<GateEvaluation, 'allMet' | 'metCount'>,
): Promise<GateRequest> {
  const conds = await conditionRows(tx, [g.id]);
  const people = await peopleOf(tx, [g.submitted_by, ...conds.flatMap((c) => [c.owner_user_id, c.added_by])]);
  const scope = scopeOf(g);
  return {
    id: g.id,
    key: g.display_key,
    caseId: g.case_id,
    mandateId: g.subject_type === 'mandate' ? g.subject_id : null,
    gateCode: g.gate_code as GateCode,
    status: g.status as GateRequestStatus,
    displayStatus: displayStatus(g, evaluation),
    scope,
    buttonLabel: buttonLabel(g.gate_code as GateCode, scope),
    parentGateRequestId: g.parent_gate_request_id,
    submittedBy: g.submitted_by ? people(g.submitted_by) : null,
    submittedAt: isoDateTimeOrNull(g.submitted_at),
    decidedAt: isoDateTimeOrNull(g.decided_at),
    expiresAt: isoDateTimeOrNull(g.expires_at),
    currentSnapshotId: g.current_snapshot_id,
    conditions: conds.map((c) => toCondition(c, people)),
    rowVersion: g.row_version,
  };
}

export interface SnapshotRow {
  id: string;
  gate_request_id: string;
  case_id: string | null;
  version: number;
  subject_id: string;
  content: unknown;
  content_hash: string;
  status: string;
  stale_reason: string | null;
  stale_at: Date | null;
  superseded_by_snapshot_id: string | null;
  created_by: string;
  created_at: Date;
}

export const SNAPSHOT_COLUMNS = [
  'id',
  'gate_request_id',
  'case_id',
  'version',
  'subject_id',
  'content',
  'content_hash',
  'status',
  'stale_reason',
  'stale_at',
  'superseded_by_snapshot_id',
  'created_by',
  'created_at',
] as const;

export async function snapshotById(tx: Tx, id: string): Promise<SnapshotRow | null> {
  return (
    ((await tx
      .selectFrom('platform.decision_snapshot')
      .select([...SNAPSHOT_COLUMNS])
      .where('id', '=', id)
      .executeTakeFirst()) as SnapshotRow | undefined) ?? null
  );
}

export function contentOf(s: Pick<SnapshotRow, 'content'>): SnapshotContent {
  return SnapshotContent.parse(s.content);
}

export function toSnapshot(s: SnapshotRow, people: People): DecisionSnapshot {
  return {
    id: s.id,
    gateRequestId: s.gate_request_id,
    caseId: s.case_id,
    version: s.version,
    status: s.status as DecisionSnapshot['status'],
    staleReason: s.stale_reason,
    staleAt: isoDateTimeOrNull(s.stale_at),
    supersededBySnapshotId: s.superseded_by_snapshot_id,
    content: contentOf(s),
    contentHash: s.content_hash,
    fingerprint: toFingerprint(s.content_hash),
    createdBy: people(s.created_by),
    createdAt: isoDateTime(s.created_at),
  };
}

export interface ApprovalRow {
  id: string;
  gate_request_id: string;
  snapshot_id: string;
  snapshot_hash: string;
  approver_user_id: string;
  approver_role: string;
  authority_grant_id: string | null;
  disposition: string;
  rationale: string;
  note: string | null;
  delegated_to_user_id: string | null;
  decided_at: Date;
  inv_kind: string | null;
  inv_reason: string | null;
  inv_at: Date | null;
  inv_mc: string | null;
}

export async function approvalRows(
  tx: Tx,
  where: { gateRequestIds?: readonly string[]; snapshotId?: string },
): Promise<ApprovalRow[]> {
  let q = tx
    .selectFrom('platform.approval as a')
    .leftJoin('platform.approval_invalidation as i', 'i.approval_id', 'a.id')
    .select([
      'a.id',
      'a.gate_request_id',
      'a.snapshot_id',
      'a.snapshot_hash',
      'a.approver_user_id',
      'a.approver_role',
      'a.authority_grant_id',
      'a.disposition',
      'a.rationale',
      'a.note',
      'a.delegated_to_user_id',
      'a.decided_at',
      'i.kind as inv_kind',
      'i.reason as inv_reason',
      'i.created_at as inv_at',
      'i.material_change_id as inv_mc',
    ])
    .orderBy('a.decided_at');
  if (where.gateRequestIds) {
    if (where.gateRequestIds.length === 0) return [];
    q = q.where('a.gate_request_id', 'in', [...where.gateRequestIds]);
  }
  if (where.snapshotId) q = q.where('a.snapshot_id', '=', where.snapshotId);
  return (await q.execute()) as ApprovalRow[];
}

export function toApproval(a: ApprovalRow, people: People): Approval {
  const role = RoleCode.safeParse(a.approver_role);
  return {
    id: a.id,
    gateRequestId: a.gate_request_id,
    snapshotId: a.snapshot_id,
    snapshotHash: a.snapshot_hash,
    approver: people(a.approver_user_id),
    approverRole: role.success ? role.data : 'sponsor',
    authorityGrantId: a.authority_grant_id,
    disposition: a.disposition as Approval['disposition'],
    rationale: a.rationale,
    note: a.note,
    delegatedTo: a.delegated_to_user_id ? people(a.delegated_to_user_id) : null,
    decidedAt: isoDateTime(a.decided_at),
    effective: a.inv_kind === null,
    invalidation:
      a.inv_kind === null
        ? null
        : {
            reason: a.inv_reason ?? a.inv_kind,
            at: isoDateTime(a.inv_at ?? a.decided_at),
            materialChangeId: a.inv_mc,
          },
  };
}

export async function positionsOn(tx: Tx, snapshotId: string): Promise<ReviewerPositionRecord[]> {
  const rows = await tx
    .selectFrom('platform.reviewer_position as p')
    .innerJoin('platform.decision_snapshot as s', 's.id', 'p.snapshot_id')
    .select([
      'p.id',
      'p.reviewer_user_id',
      'p.area',
      'p.position',
      'p.scope_text',
      'p.signed_at',
      's.version',
    ])
    .where('p.snapshot_id', '=', snapshotId)
    .orderBy('p.signed_at')
    .execute();
  const people = await peopleOf(
    tx,
    rows.map((r) => r.reviewer_user_id),
  );
  return rows.map((r) => ({
    id: r.id,
    reviewer: people(r.reviewer_user_id),
    area: r.area as ReviewerPositionRecord['area'],
    position: r.position as ReviewerPositionRecord['position'],
    scopeText: r.scope_text,
    signedVersion: r.version,
    signedAt: isoDateTime(r.signed_at),
  }));
}

/** Role label shown with a dissent ("Finance partner"): the person's title. */
export async function dissentOfCase(tx: Tx, caseId: string): Promise<Dissent[]> {
  const rows = await tx
    .selectFrom('platform.dissent as d')
    .innerJoin('platform.app_user as u', 'u.id', 'd.author_id')
    .leftJoin('platform.decision_snapshot as s', 's.id', 'd.signed_snapshot_id')
    .select([
      'd.id',
      'd.author_id',
      'd.statement',
      'd.scope_text',
      'd.signed_at',
      'u.title',
      's.version as snapshot_version',
    ])
    .where('d.case_id', '=', caseId)
    .orderBy('d.signed_at')
    .execute();
  const people = await peopleOf(
    tx,
    rows.map((r) => r.author_id),
  );
  return rows.map((r) => ({
    id: r.id,
    author: people(r.author_id),
    authorRole: r.title ?? 'Reviewer',
    statement: r.statement,
    scopeText: r.scope_text,
    signedAt: isoDateTime(r.signed_at),
    signedSnapshotVersion: r.snapshot_version ?? null,
  }));
}

export const isoDateOr = isoDateOrNull;
