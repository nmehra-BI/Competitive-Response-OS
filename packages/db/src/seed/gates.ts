/**
 * Gate history for seeds: gate requests, hashed snapshots and approvals. Approvals go through the
 * real database guard (human approver, own interactive session, current snapshot, grant, not self),
 * so seeded history obeys the same invariants as live decisions.
 */
import { randomUUID } from 'node:crypto';
import { SnapshotContent, type GateDisposition } from '@growth-os/contracts';
import { hashCanonical } from '@growth-os/domain';
import type { SeedCtx } from './context';
import { at } from './context';

export async function insertSnapshot(
  s: SeedCtx,
  input: {
    id: string;
    gateRequestId: string;
    caseId: string | null;
    subjectId: string;
    version: number;
    content: SnapshotContent;
    createdBy: string;
    createdAt: string;
  },
): Promise<string> {
  const content = SnapshotContent.parse(input.content);
  const { canonical, hash } = await hashCanonical(content);
  await s.tx
    .insertInto('platform.decision_snapshot')
    .values({
      id: input.id,
      tenant_id: s.tenantId,
      gate_request_id: input.gateRequestId,
      case_id: input.caseId,
      version: input.version,
      subject_id: input.subjectId,
      content_canonical: canonical,
      content_hash: hash,
      created_by: input.createdBy,
      created_at: at(input.createdAt),
    })
    .execute();
  for (const c of content.components)
    await s.tx
      .insertInto('platform.snapshot_component')
      .values({
        tenant_id: s.tenantId,
        snapshot_id: input.id,
        component_type: c.type,
        component_id: c.id,
        component_version: c.version,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  return hash;
}

export async function setSnapshotStatus(
  s: SeedCtx,
  id: string,
  status: 'superseded',
  supersededBy: string,
): Promise<void> {
  await s.tx
    .updateTable('platform.decision_snapshot')
    .set({ status, superseded_by_snapshot_id: supersededBy })
    .where('id', '=', id)
    .execute();
}

export async function setGateStatus(
  s: SeedCtx,
  id: string,
  status: string,
  extra: { decidedAt?: string; submittedAt?: string; submittedBy?: string; currentSnapshotId?: string } = {},
): Promise<void> {
  await s.tx
    .updateTable('platform.gate_request')
    .set({
      status,
      ...(extra.decidedAt ? { decided_at: at(extra.decidedAt) } : {}),
      ...(extra.submittedAt ? { submitted_at: at(extra.submittedAt) } : {}),
      ...(extra.submittedBy ? { submitted_by: extra.submittedBy } : {}),
      ...(extra.currentSnapshotId ? { current_snapshot_id: extra.currentSnapshotId } : {}),
    })
    .where('id', '=', id)
    .execute();
}

/** Record one approval row as the approver, through a short-lived seed session that is then revoked. */
export async function decide(
  s: SeedCtx,
  d: {
    gateRequestId: string;
    snapshotId: string;
    snapshotHash: string;
    approverId: string;
    approverRole: string;
    authorityGrantId: string | null;
    disposition: GateDisposition;
    rationale: string;
    decidedAt: string;
  },
): Promise<string> {
  const sessionId = randomUUID();
  await s.tx
    .insertInto('platform.session')
    .values({
      id: sessionId,
      tenant_id: s.tenantId,
      user_id: d.approverId,
      token_hash: `seed-${sessionId}`,
      auth_method: 'dev_persona',
      interactive: true,
      created_at: at(d.decidedAt),
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    })
    .execute();
  const id = randomUUID();
  await s.tx
    .insertInto('platform.approval')
    .values({
      id,
      tenant_id: s.tenantId,
      gate_request_id: d.gateRequestId,
      snapshot_id: d.snapshotId,
      snapshot_hash: d.snapshotHash,
      approver_user_id: d.approverId,
      approver_role: d.approverRole,
      authority_grant_id: d.authorityGrantId,
      session_id: sessionId,
      disposition: d.disposition,
      rationale: d.rationale,
      idempotency_key: `seed:${id}`,
      decided_at: at(d.decidedAt),
    })
    .execute();
  await s.tx
    .updateTable('platform.session')
    .set({ revoked_at: at(d.decidedAt) })
    .where('id', '=', sessionId)
    .execute();
  return id;
}
