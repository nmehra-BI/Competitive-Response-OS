/**
 * outbox.sweep (cron, every minute). Per tenant, in one transaction each:
 *
 *   1. recover   rows left `sending` with an expired lease (the worker died mid-send) → `checking`:
 *                the write may have happened, so the next pass searches by key before anything else
 *   2. resume    rows paused for the connection once it is connected again and the approval is still
 *                effective → `retry_scheduled` (attempts > 0, so the dispatcher reconciles first)
 *   3. align     task links still showing Sending/Retry/Checking whose outbox row another writer paused
 *                (approval expiry timer) → "Paused — approval changed"
 *
 * Then it claims due rows across tenants with `platform.claim_outbox_batch` (SECURITY DEFINER, ids
 * only, migration 0002) and processes each with `processOutboxMessage`.
 */
import { randomUUID } from 'node:crypto';
import { auditWriter, sql, withTenant, type Db, type Tx } from '@growth-os/db';
import type { SyncStatus } from '@growth-os/contracts';
import { syncMachine } from '@growth-os/domain';
import {
  PAUSED_CHECKED,
  processOutboxMessage,
  reconcilePausedWrite,
  type OutboxDeps,
  type ProcessResult,
} from './dispatch';
import { loadGateFacts, planIsCurrent, type TaskSetRef } from './facts';
import { approvalEffectiveness } from './policy';

const SYSTEM = { kind: 'system', reason: 'worker' } as const;

export interface SweepSummary {
  recovered: number;
  resumed: number;
  aligned: number;
  processed: {
    tenantId: string;
    messageId: string;
    result: ProcessResult | { status: 'error'; error: string };
  }[];
}

async function systemAudit(
  tx: Tx,
  action: string,
  objectId: string,
  caseId: string | null,
  summary: string,
  details: Record<string, string | number | boolean | null>,
): Promise<void> {
  await auditWriter.record(tx, {
    actorUserId: null,
    actorKind: 'system',
    actorRole: null,
    action,
    objectType: 'external_task_link',
    objectId,
    objectVersion: null,
    caseId,
    beforeHash: null,
    afterHash: null,
    summary,
    details,
    authz: { decision: 'allow', rule: 'worker:outbox.sweep', authorityGrantId: null },
  });
}

interface RowFacts {
  message_id: string;
  link_id: string;
  sync_status: SyncStatus;
  case_id: string;
  ordinal: number;
  set_id: string;
  owner_type: TaskSetRef['ownerType'];
  owner_id: string;
  gate_id: string;
  connection_status: string;
}

const ROW_FACTS = sql`
  m.id AS message_id, k.id AS link_id, k.sync_status, t.case_id, t.ordinal, s.id AS set_id, s.owner_type,
  s.owner_id, coalesce(m.authorization_ref->>'gateRequestId', s.authorizing_gate_request_id::text) AS gate_id,
  c.status AS connection_status`;

/** 1. Rows a dead worker left in `sending`: the write is ambiguous, so reconcile first. */
export async function recoverStaleSends(tx: Tx): Promise<number> {
  const rows = await sql<RowFacts>`
    SELECT ${ROW_FACTS}
      FROM platform.outbox_message m
      JOIN platform.external_task_link k ON k.id = m.aggregate_id
      JOIN platform.task t ON t.id = k.task_id
      JOIN platform.task_set s ON s.id = t.task_set_id
      JOIN platform.connection c ON c.id = k.connection_id
     WHERE m.kind = 'task.create' AND m.status = 'sending' AND m.locked_until < now()
     FOR UPDATE OF m, k SKIP LOCKED`.execute(tx);
  for (const r of rows.rows) {
    await sql`
      UPDATE platform.outbox_message
         SET status = 'checking', locked_until = NULL, next_attempt_at = now(), updated_at = now(),
             last_error = ${JSON.stringify({ code: 'worker_lost', message: 'The worker stopped mid-send.' })}::jsonb
       WHERE id = ${r.message_id}`.execute(tx);
    const t = syncMachine.apply(r.sync_status, 'send_timeout', SYSTEM, {});
    if (t.ok)
      await tx
        .updateTable('platform.external_task_link')
        .set({ sync_status: t.to, updated_at: sql<Date>`now()` })
        .where('id', '=', r.link_id)
        .execute();
    await systemAudit(
      tx,
      'task_sync.checking',
      r.link_id,
      r.case_id,
      `Task ${r.ordinal} · Checking (worker restarted mid-send)`,
      {
        outboxMessageId: r.message_id,
        code: 'worker_lost',
      },
    );
  }
  return rows.rows.length;
}

/** 2. Connection back: resume paused rows whose approval and plan still hold. */
export async function resumeReconnected(tx: Tx, now: Date): Promise<number> {
  const rows = await sql<RowFacts>`
    SELECT ${ROW_FACTS}
      FROM platform.outbox_message m
      JOIN platform.external_task_link k ON k.id = m.aggregate_id
      JOIN platform.task t ON t.id = k.task_id
      JOIN platform.task_set s ON s.id = t.task_set_id
      JOIN platform.connection c ON c.id = k.connection_id
     WHERE m.kind = 'task.create' AND m.status = 'paused' AND k.sync_status = 'paused_connector'
       AND c.status = 'connected'
     FOR UPDATE OF m, k SKIP LOCKED`.execute(tx);
  let resumed = 0;
  for (const r of rows.rows) {
    const gate = await loadGateFacts(tx, r.gate_id);
    const approval = approvalEffectiveness(gate, now);
    const set: TaskSetRef = {
      id: r.set_id,
      caseId: r.case_id,
      ownerType: r.owner_type,
      ownerId: r.owner_id,
      authorizingGateRequestId: r.gate_id,
    };
    if (approval !== 'effective' || !(await planIsCurrent(tx, set))) continue; // stays paused; the send-time check would pause it anyway
    const t = syncMachine.apply('paused_connector', 'resume', SYSTEM, { approval, connector: 'connected' });
    if (!t.ok) continue;
    // Keep attempts: attempts > 0 makes the dispatcher search by key before creating.
    await sql`
      UPDATE platform.outbox_message
         SET status = 'pending', next_attempt_at = now(), locked_until = NULL, updated_at = now(),
             max_attempts = greatest(max_attempts, attempts + 5)
       WHERE id = ${r.message_id}`.execute(tx);
    await tx
      .updateTable('platform.external_task_link')
      .set({ sync_status: t.to, updated_at: sql<Date>`now()` })
      .where('id', '=', r.link_id)
      .execute();
    await systemAudit(
      tx,
      'task_sync.resumed',
      r.link_id,
      r.case_id,
      `Task ${r.ordinal} · Resumed after reconnect`,
      {
        outboxMessageId: r.message_id,
      },
    );
    resumed += 1;
  }
  return resumed;
}

/** 3. Links another writer left showing progress although their outbox row is paused. */
export async function alignPausedLinks(tx: Tx, now: Date): Promise<number> {
  const rows = await sql<RowFacts>`
    SELECT ${ROW_FACTS}
      FROM platform.outbox_message m
      JOIN platform.external_task_link k ON k.id = m.aggregate_id
      JOIN platform.task t ON t.id = k.task_id
      JOIN platform.task_set s ON s.id = t.task_set_id
      JOIN platform.connection c ON c.id = k.connection_id
     WHERE m.kind = 'task.create' AND m.status = 'paused'
       AND k.sync_status IN ('not_sent','in_preview','sending','retry_scheduled','checking')
     FOR UPDATE OF k SKIP LOCKED`.execute(tx);
  let aligned = 0;
  for (const r of rows.rows) {
    const approval = approvalEffectiveness(await loadGateFacts(tx, r.gate_id), now);
    const command =
      approval !== 'effective' || r.connection_status === 'connected'
        ? 'pause_approval_changed'
        : 'pause_connector';
    const t = syncMachine.apply(r.sync_status, command, SYSTEM, {});
    if (!t.ok) continue;
    await tx
      .updateTable('platform.external_task_link')
      .set({ sync_status: t.to, updated_at: sql<Date>`now()` })
      .where('id', '=', r.link_id)
      .execute();
    aligned += 1;
  }
  return aligned;
}

/** 4. Rows paused for an approval change after at least one attempt, not yet searched. */
export async function pausedAmbiguousWrites(tx: Tx): Promise<string[]> {
  const r = await sql<{ id: string }>`
    SELECT m.id FROM platform.outbox_message m
      JOIN platform.external_task_link k ON k.id = m.aggregate_id
      JOIN platform.connection c ON c.id = k.connection_id
     WHERE m.kind = 'task.create' AND m.status = 'paused' AND m.attempts > 0
       AND k.sync_status = 'paused_approval_changed' AND c.status = 'connected'
       AND coalesce(m.last_error->>'code', '') <> ${PAUSED_CHECKED}`.execute(tx);
  return r.rows.map((row) => row.id);
}

export async function listTenants(db: Db): Promise<string[]> {
  const r = await sql<{ id: string }>`SELECT id FROM platform.list_tenant_ids() AS id`.execute(db);
  return r.rows.map((row) => row.id);
}

export async function claimBatch(
  db: Db,
  batchSize: number,
  leaseMs: number,
): Promise<{ id: string; tenant_id: string }[]> {
  const r = await sql<{ id: string; tenant_id: string }>`
    SELECT id, tenant_id FROM platform.claim_outbox_batch(${batchSize}, ${leaseMs} * interval '1 millisecond')`.execute(
    db,
  );
  return r.rows;
}

export async function sweepOutbox(
  deps: OutboxDeps,
  opts: { batchSize?: number; maxBatches?: number; tenantIds?: readonly string[] } = {},
): Promise<SweepSummary> {
  const now = deps.now ?? (() => new Date());
  const correlationId = deps.correlationId ?? `outbox-sweep-${randomUUID()}`;
  const summary: SweepSummary = { recovered: 0, resumed: 0, aligned: 0, processed: [] };
  const tenants = opts.tenantIds ?? (await listTenants(deps.db));
  for (const tenantId of tenants) {
    try {
      const ambiguous = await withTenant(deps.db, { tenantId, userId: null, correlationId }, async (tx) => {
        summary.recovered += await recoverStaleSends(tx);
        summary.resumed += await resumeReconnected(tx, now());
        summary.aligned += await alignPausedLinks(tx, now());
        return pausedAmbiguousWrites(tx);
      });
      // 4. Paused after an attempt: search once so an executed write is preserved as Confirmed.
      for (const id of ambiguous) {
        const result = await reconcilePausedWrite({ ...deps, correlationId }, tenantId, id);
        summary.processed.push({ tenantId, messageId: id, result });
      }
    } catch {
      // One tenant failing never blocks the others; the next sweep retries it.
    }
  }

  const leaseMs = deps.leaseMs ?? 60_000;
  for (let i = 0; i < (opts.maxBatches ?? 10); i++) {
    const claimed = await claimBatch(deps.db, opts.batchSize ?? 50, leaseMs);
    const mine = opts.tenantIds ? claimed.filter((c) => opts.tenantIds!.includes(c.tenant_id)) : claimed;
    for (const c of mine) {
      try {
        const result = await processOutboxMessage({ ...deps, correlationId }, c.tenant_id, c.id, {
          claimed: true,
        });
        summary.processed.push({ tenantId: c.tenant_id, messageId: c.id, result });
      } catch (e) {
        summary.processed.push({
          tenantId: c.tenant_id,
          messageId: c.id,
          result: { status: 'error', error: e instanceof Error ? e.message : String(e) },
        });
      }
    }
    if (claimed.length < (opts.batchSize ?? 50)) break;
  }
  return summary;
}
