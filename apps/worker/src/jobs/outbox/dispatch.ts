/**
 * outbox.dispatch / outbox.reconcile — one `task.create` outbox row through the TaskConnector
 * (ARCHITECTURE.md §13, D-021, WF-07). Three steps, so a crash never produces a duplicate:
 *
 *   1. claim   (tenant tx) lock the row; re-check authorization at send time — approval effective and
 *              unexpired, plan version current, connection connected, sender still authorized —
 *              then mark it `sending` with a lease (attempts + 1) and commit.
 *   2. call    (no tx) reconcile first whenever an earlier attempt may have reached the tool
 *              (attempts > 0 or status `checking`): find by idempotency key; only then create.
 *   3. record  (tenant tx) the outcome through `syncMachine` with a system actor, plus audit and
 *              analytics (`external_task_confirmed` / `external_task_failed`) in the same transaction.
 *
 * If the process dies between 1 and 3 the row stays `sending` with an expired lease; `outbox.sweep`
 * moves it to `checking`, and the next pass reconciles by key instead of creating again.
 * "Confirmed" is written only with the key the tool returned (never-rule 9).
 */
import { randomUUID } from 'node:crypto';
import { auditWriter, businessNow, enqueueJob, sql, withTenant, type Db, type Tx } from '@growth-os/db';
import {
  ConnectorError,
  type ConnectorFactory,
  type ExternalTaskInput,
  type ExternalTaskRef,
} from '@growth-os/connectors';
import type { AnalyticsEventName, CaseStage, ConnectorStatus, SyncStatus } from '@growth-os/contracts';
import { syncMachine, type Actor, type SyncCommand, type WorkflowFacts } from '@growth-os/domain';
import { JOBS } from '../catalog';
import { loadSendFacts, type SendFacts, type TaskSetRef } from './facts';
import { defaultBackoffMs, ERROR_CODE_BY_KIND, RECHECK_CODES } from './policy';

export interface OutboxDeps {
  /** Worker-role pool (me_worker, NOBYPASSRLS). */
  db: Db;
  connectors: ConnectorFactory;
  /** How long a claimed row is leased to one worker. Default 60 s. */
  leaseMs?: number;
  backoffMs?: (attempts: number, retryAfterMs: number | null) => number;
  now?: () => Date;
  correlationId?: string;
}

export type ProcessResult =
  | { status: 'skipped'; reason: string }
  | { status: SyncStatus; externalKey: string | null; errorCode: string | null };

const SYSTEM: Actor = { kind: 'system', reason: 'worker' };
const DEFAULT_LEASE_MS = 60_000;

interface MessageRow {
  id: string;
  tenant_id: string;
  kind: string;
  aggregate_type: string;
  aggregate_id: string;
  idempotency_key: string;
  payload: unknown;
  status: string;
  attempts: number;
  max_attempts: number;
  actor_user_id: string | null;
  authorization_ref: unknown;
  due: boolean;
  unlocked: boolean;
}

interface LinkRow {
  id: string;
  task_id: string;
  connection_id: string;
  sync_status: SyncStatus;
  attempts: number;
}

interface Loaded {
  msg: MessageRow;
  link: LinkRow;
  task: { id: string; ordinal: number };
  set: TaskSetRef;
  kase: { id: string; stage: CaseStage; businessUnitId: string };
  connection: { id: string; provider: string; status: ConnectorStatus; name: string };
  gateRequestId: string;
}

type Outcome =
  | { kind: 'confirmed'; ref: ExternalTaskRef }
  | { kind: 'not_found' }
  | { kind: 'error'; error: ConnectorError };

// ---------------------------------------------------------------------------
// Loading and small writers
// ---------------------------------------------------------------------------

async function load(tx: Tx, messageId: string): Promise<Loaded | null> {
  const m = await sql<MessageRow>`
    SELECT m.id, m.tenant_id, m.kind, m.aggregate_type, m.aggregate_id, m.idempotency_key, m.payload,
           m.status, m.attempts, m.max_attempts, m.actor_user_id, m.authorization_ref,
           (m.next_attempt_at <= now()) AS due,
           (m.locked_until IS NULL OR m.locked_until < now()) AS unlocked
      FROM platform.outbox_message m WHERE m.id = ${messageId} FOR UPDATE`.execute(tx);
  const msg = m.rows[0];
  if (!msg || msg.kind !== 'task.create' || msg.aggregate_type !== 'external_task_link') return null;
  const link = await tx
    .selectFrom('platform.external_task_link')
    .select(['id', 'task_id', 'connection_id', 'sync_status', 'attempts'])
    .where('id', '=', msg.aggregate_id)
    .forUpdate()
    .executeTakeFirst();
  if (!link) return null;
  const row = await tx
    .selectFrom('platform.task as t')
    .innerJoin('platform.task_set as s', 's.id', 't.task_set_id')
    .innerJoin('platform.workflow_case as c', 'c.id', 't.case_id')
    .select([
      't.id as task_id',
      't.ordinal',
      's.id as set_id',
      's.owner_type',
      's.owner_id',
      's.authorizing_gate_request_id',
      'c.id as case_id',
      'c.stage',
      'c.business_unit_id',
    ])
    .where('t.id', '=', link.task_id)
    .executeTakeFirst();
  const conn = await tx
    .selectFrom('platform.connection')
    .select(['id', 'provider', 'status', 'name'])
    .where('id', '=', link.connection_id)
    .executeTakeFirst();
  if (!row || !conn) return null;
  const ref = (msg.authorization_ref ?? {}) as { gateRequestId?: unknown };
  return {
    msg,
    link: { ...link, sync_status: link.sync_status as SyncStatus },
    task: { id: row.task_id, ordinal: row.ordinal },
    set: {
      id: row.set_id,
      caseId: row.case_id,
      ownerType: row.owner_type as TaskSetRef['ownerType'],
      ownerId: row.owner_id,
      authorizingGateRequestId: row.authorizing_gate_request_id,
    },
    kase: { id: row.case_id, stage: row.stage as CaseStage, businessUnitId: row.business_unit_id },
    connection: { ...conn, status: conn.status as ConnectorStatus },
    gateRequestId:
      typeof ref.gateRequestId === 'string' ? ref.gateRequestId : row.authorizing_gate_request_id,
  };
}

async function updateMessage(
  tx: Tx,
  id: string,
  patch: {
    status?: string;
    lastError?: { code: string; message: string } | null;
    nextAttemptAt?: Date;
    releaseLock?: boolean;
    externalRef?: string;
    sent?: boolean;
  },
): Promise<void> {
  await tx
    .updateTable('platform.outbox_message')
    .set({
      updated_at: sql<Date>`now()`,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.lastError !== undefined
        ? { last_error: patch.lastError ? JSON.stringify(patch.lastError) : null }
        : {}),
      ...(patch.nextAttemptAt ? { next_attempt_at: patch.nextAttemptAt } : {}),
      ...(patch.releaseLock ? { locked_until: null } : {}),
      ...(patch.externalRef ? { external_ref: patch.externalRef } : {}),
      ...(patch.sent ? { sent_at: sql<Date>`now()` } : {}),
    })
    .where('id', '=', id)
    .execute();
}

async function updateLink(
  tx: Tx,
  id: string,
  patch: {
    status: SyncStatus;
    error?: { code: string; message: string; retryable: boolean } | null;
    ref?: ExternalTaskRef;
    incrementAttempts?: boolean;
  },
): Promise<void> {
  await tx
    .updateTable('platform.external_task_link')
    .set({
      sync_status: patch.status,
      updated_at: sql<Date>`now()`,
      ...(patch.incrementAttempts ? { attempts: sql<number>`attempts + 1` } : {}),
      ...(patch.error !== undefined
        ? {
            last_error_code: patch.error?.code ?? null,
            last_error_message: patch.error?.message ?? null,
            retryable: patch.error?.retryable ?? true,
          }
        : {}),
      ...(patch.ref
        ? {
            external_key: patch.ref.key,
            external_url: patch.ref.url,
            confirmed_at: sql<Date>`now()`,
          }
        : {}),
    })
    .where('id', '=', id)
    .execute();
}

async function audit(
  tx: Tx,
  l: Loaded,
  action: string,
  summary: string,
  details: Record<string, string | number | boolean | null>,
): Promise<void> {
  await auditWriter.record(tx, {
    actorUserId: null,
    actorKind: 'system',
    actorRole: null,
    action,
    objectType: 'external_task_link',
    objectId: l.link.id,
    objectVersion: null,
    caseId: l.kase.id,
    beforeHash: null,
    afterHash: null,
    summary: summary.slice(0, 280),
    details: { taskSetId: l.set.id, task: l.task.ordinal, outboxMessageId: l.msg.id, ...details },
    authz: { decision: 'allow', rule: 'worker:outbox', authorityGrantId: null },
  });
}

async function analytics<N extends AnalyticsEventName>(
  tx: Tx,
  l: Loaded,
  name: N,
  now: Date,
  correlationId: string,
  props: Record<string, unknown>,
): Promise<void> {
  await auditWriter.analytics(
    tx,
    name,
    {
      tenantId: l.msg.tenant_id,
      caseId: l.kase.id,
      actorRole: 'system',
      objectType: 'external_task_link',
      objectId: l.link.id,
      objectVersion: null,
      occurredAt: now.toISOString(),
      stage: l.kase.stage,
      correlationId,
    },
    props,
  );
}

/** Apply a sync-machine command with a system actor; returns the target state or null if refused. */
function transition(from: SyncStatus, command: SyncCommand, facts: WorkflowFacts): SyncStatus | null {
  const r = syncMachine.apply(from, command, SYSTEM, facts);
  return r.ok ? r.to : null;
}

function machineFacts(l: Loaded, f: SendFacts | null, extra: WorkflowFacts = {}): WorkflowFacts {
  return {
    approval: f?.approval,
    connector: f?.connector ?? l.connection.status,
    attempts: l.msg.attempts,
    maxAttempts: l.msg.max_attempts,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Shared pause / fail writers (also used by the sweep)
// ---------------------------------------------------------------------------

export async function pauseForApproval(
  tx: Tx,
  l: Loaded,
  code: string,
  message: string,
): Promise<SyncStatus> {
  const to = transition(l.link.sync_status, 'pause_approval_changed', {}) ?? 'paused_approval_changed';
  await updateMessage(tx, l.msg.id, { status: 'paused', lastError: { code, message }, releaseLock: true });
  await updateLink(tx, l.link.id, { status: to, error: { code, message, retryable: false } });
  await audit(
    tx,
    l,
    'task_sync.paused_approval_changed',
    `Task ${l.task.ordinal} · Paused — approval changed`,
    {
      code,
    },
  );
  return to;
}

/**
 * Connection-level failure: mark the connection, then pause every unsent write for it (pending or
 * checking rows; rows in flight elsewhere record their own result). Internal tasks are untouched.
 */
async function pauseConnection(
  tx: Tx,
  l: Loaded,
  error: ConnectorError | null,
  newStatus: ConnectorStatus,
): Promise<SyncStatus> {
  const code = error ? ERROR_CODE_BY_KIND[error.kind] : RECHECK_CODES.connectorUnavailable;
  const message = error?.message ?? 'The task tool connection is not usable.';
  if (l.connection.status !== newStatus) {
    await tx
      .updateTable('platform.connection')
      .set({ status: newStatus, last_checked_at: sql<Date>`now()` })
      .where('id', '=', l.connection.id)
      .execute();
    await auditWriter.record(tx, {
      actorUserId: null,
      actorKind: 'system',
      actorRole: null,
      action: 'connection.status_changed',
      objectType: 'connection',
      objectId: l.connection.id,
      objectVersion: null,
      caseId: null,
      beforeHash: null,
      afterHash: null,
      summary: `${l.connection.name}: ${newStatus === 'expired' ? 'Expired' : 'Unavailable'}`.slice(0, 280),
      details: { from: l.connection.status, to: newStatus, code },
      authz: { decision: 'allow', rule: 'worker:outbox', authorityGrantId: null },
    });
  }
  const paused = await sql<{ id: string; aggregate_id: string }>`
    UPDATE platform.outbox_message m SET status = 'paused', locked_until = NULL, updated_at = now(),
           last_error = ${JSON.stringify({ code, message })}::jsonb
     WHERE m.kind = 'task.create' AND m.aggregate_type = 'external_task_link'
       AND (m.id = ${l.msg.id} OR m.status IN ('pending','checking'))
       AND m.aggregate_id IN (SELECT k.id FROM platform.external_task_link k WHERE k.connection_id = ${l.connection.id})
     RETURNING m.id, m.aggregate_id`.execute(tx);
  const links = await tx
    .selectFrom('platform.external_task_link')
    .select(['id', 'sync_status'])
    .where(
      'id',
      'in',
      paused.rows.map((p) => p.aggregate_id),
    )
    .execute();
  let mine: SyncStatus = 'paused_connector';
  for (const link of links) {
    const to = transition(link.sync_status as SyncStatus, 'pause_connector', {});
    if (!to) continue;
    await updateLink(tx, link.id, { status: to, error: { code, message, retryable: true } });
    if (link.id === l.link.id) mine = to;
  }
  await audit(
    tx,
    l,
    'task_sync.paused_connector',
    `Paused — connection expired · ${paused.rows.length} task(s)`,
    {
      code,
      paused: paused.rows.length,
    },
  );
  return mine;
}

async function fail(
  tx: Tx,
  l: Loaded,
  now: Date,
  correlationId: string,
  code: string,
  message: string,
  retryable: boolean,
): Promise<SyncStatus> {
  const to = transition(l.link.sync_status, 'send_failed_permanent', {}) ?? 'failed';
  await updateMessage(tx, l.msg.id, { status: 'failed', lastError: { code, message }, releaseLock: true });
  await updateLink(tx, l.link.id, { status: to, error: { code, message, retryable } });
  await audit(tx, l, 'task_sync.failed', `Task ${l.task.ordinal} · Failed (${code})`, { code, retryable });
  await analytics(tx, l, 'external_task_failed', now, correlationId, { errorCode: code, retryable });
  return to;
}

/** Write "Confirmed · KEY" (only ever with the key the tool returned). */
async function recordConfirmed(
  tx: Tx,
  cur: Loaded,
  ref: ExternalTaskRef,
  now: Date,
  correlationId: string,
  via: 'create' | 'reconcile',
): Promise<ProcessResult> {
  // The machine allows confirmation from the state the link is really in, including a pause that
  // landed while the write was in flight (CR-WS6-1, D-083).
  const s = cur.link.sync_status;
  const paused = s === 'paused_approval_changed' || s === 'paused_connector';
  const from: SyncStatus = s === 'checking' || paused ? s : 'sending';
  const command =
    from === 'checking' || (paused && via === 'reconcile')
      ? ('reconcile_found' as const)
      : ('send_ok' as const);
  const r = syncMachine.apply(from, command, SYSTEM, { externalKey: ref.key });
  if (!r.ok) throw new Error(`sync machine refused confirmation: ${r.reasons.join('; ')}`);
  await updateMessage(tx, cur.msg.id, {
    status: 'confirmed',
    externalRef: ref.key,
    sent: true,
    lastError: null,
    releaseLock: true,
  });
  await updateLink(tx, cur.link.id, { status: r.to, ref, error: null });
  await audit(tx, cur, 'task_sync.confirmed', `Task ${cur.task.ordinal} · Confirmed · ${ref.key}`, {
    externalKey: ref.key,
    attempts: cur.msg.attempts,
    via,
  });
  await analytics(tx, cur, 'external_task_confirmed', now, correlationId, {
    attempts: Math.max(1, cur.msg.attempts),
  });
  return { status: r.to, externalKey: ref.key, errorCode: null };
}

/**
 * A row paused for an approval change after an attempt may already exist in the tool (an ambiguous
 * send that was paused while Checking). Searching writes nothing, so it needs no approval: if the
 * issue exists, the executed write is recorded as Confirmed and preserved; otherwise the row stays
 * paused and is marked as checked so the sweep does not search again.
 */
export async function reconcilePausedWrite(
  deps: OutboxDeps,
  tenantId: string,
  messageId: string,
): Promise<ProcessResult> {
  const now = deps.now ?? (() => new Date());
  const correlationId = deps.correlationId ?? `outbox-${randomUUID()}`;
  const ctx = { tenantId, userId: null, correlationId };
  const l = await withTenant(deps.db, ctx, (tx) => load(tx, messageId));
  if (!l || l.msg.status !== 'paused' || l.msg.attempts === 0 || l.connection.status !== 'connected')
    return { status: 'skipped', reason: 'nothing to reconcile' };
  let found: ExternalTaskRef | null;
  try {
    found = await deps
      .connectors({ id: l.connection.id, provider: l.connection.provider })
      .findByIdempotencyKey(l.msg.idempotency_key);
  } catch (e) {
    if (e instanceof ConnectorError) return { status: 'skipped', reason: `search failed: ${e.kind}` };
    throw e;
  }
  return withTenant(deps.db, ctx, async (tx) => {
    const cur = await load(tx, messageId);
    if (!cur || cur.msg.status !== 'paused') return { status: 'skipped', reason: 'row changed' };
    if (found) return recordConfirmed(tx, cur, found, now(), correlationId, 'reconcile');
    await updateMessage(tx, cur.msg.id, {
      lastError: { code: PAUSED_CHECKED, message: 'No issue exists for this task; it stays paused.' },
    });
    return { status: cur.link.sync_status, externalKey: null, errorCode: PAUSED_CHECKED };
  });
}

/** Outbox `last_error.code` marking a paused row whose ambiguous earlier attempt was searched. */
export const PAUSED_CHECKED = 'paused_checked';

// ---------------------------------------------------------------------------
// Process one row
// ---------------------------------------------------------------------------

export async function processOutboxMessage(
  deps: OutboxDeps,
  tenantId: string,
  messageId: string,
  opts: { claimed?: boolean } = {},
): Promise<ProcessResult> {
  const now = deps.now ?? (() => new Date());
  const correlationId = deps.correlationId ?? `outbox-${randomUUID()}`;
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
  const backoff = deps.backoffMs ?? defaultBackoffMs;
  const ctx = { tenantId, userId: null, correlationId };

  // ---- 1. claim and re-check -------------------------------------------------------------------
  type Claim =
    | { skip: string }
    | { done: ProcessResult }
    | { go: { mode: 'send' | 'reconcile'; l: Loaded; attemptsBefore: number } };
  const claim = await withTenant(deps.db, ctx, async (tx): Promise<Claim> => {
    const l = await load(tx, messageId);
    if (!l) return { skip: 'not a task write' };
    const { msg } = l;
    if (msg.status !== 'pending' && msg.status !== 'checking') return { skip: `status ${msg.status}` };
    if (!msg.due) return { skip: 'not due' };
    if (!opts.claimed && !msg.unlocked) return { skip: 'leased to another worker' };
    if (l.link.sync_status === 'confirmed') {
      await updateMessage(tx, msg.id, { status: 'confirmed', releaseLock: true });
      return { skip: 'already confirmed' };
    }

    const facts = await loadSendFacts(tx, {
      gateRequestId: l.gateRequestId,
      set: l.set,
      businessUnitId: l.kase.businessUnitId,
      connectionStatus: l.connection.status,
      actorUserId: msg.actor_user_id,
      // Approval expiry is business time: the dev clock applies in AUTH_MODE=dev only (D-091).
      now: await businessNow(tx, now()),
    });
    const mode: 'send' | 'reconcile' = msg.status === 'checking' ? 'reconcile' : 'send';

    // A search writes nothing, so reconciling only needs a usable connection: it tells us whether an
    // ambiguous write happened, which must be shown even if the approval changed meanwhile.
    if (facts.connector !== 'connected') {
      const status = await pauseConnection(tx, l, null, facts.connector);
      return { done: { status, externalKey: null, errorCode: RECHECK_CODES.connectorUnavailable } };
    }
    if (mode === 'send') {
      if (facts.approval !== 'effective' || !facts.planCurrent) {
        const code = !facts.planCurrent
          ? RECHECK_CODES.planChanged
          : facts.approval === 'expired'
            ? RECHECK_CODES.approvalExpired
            : facts.approval === 'invalidated'
              ? RECHECK_CODES.approvalInvalidated
              : RECHECK_CODES.approvalMissing;
        const message = !facts.planCurrent
          ? 'The plan changed after approval. Unsent tasks are paused.'
          : facts.approval === 'expired'
            ? 'The approval expired unused. Unsent tasks are paused.'
            : 'The approval no longer applies. Unsent tasks are paused.';
        const status = await pauseForApproval(tx, l, code, message);
        return { done: { status, externalKey: null, errorCode: code } };
      }
      if (!facts.actorAuthorized) {
        const status = await fail(
          tx,
          l,
          now(),
          correlationId,
          RECHECK_CODES.actorNotAuthorized,
          'The person who sent these tasks may no longer send them. Someone who can should retry.',
          true,
        );
        return { done: { status, externalKey: null, errorCode: RECHECK_CODES.actorNotAuthorized } };
      }
      if (l.link.sync_status === 'retry_scheduled') {
        const to = transition('retry_scheduled', 'retry_due', machineFacts(l, facts));
        if (!to) return { skip: 'retry refused by the sync machine' };
      } else if (l.link.sync_status !== 'sending') {
        return { skip: `link is ${l.link.sync_status}` };
      }
      await sql`
        UPDATE platform.outbox_message
           SET status = 'sending', attempts = attempts + 1, updated_at = now(),
               locked_until = now() + (${leaseMs} * interval '1 millisecond')
         WHERE id = ${msg.id}`.execute(tx);
      await updateLink(tx, l.link.id, { status: 'sending', incrementAttempts: true });
    } else {
      if (l.link.sync_status !== 'checking') await updateLink(tx, l.link.id, { status: 'checking' });
      await sql`
        UPDATE platform.outbox_message
           SET locked_until = now() + (${leaseMs} * interval '1 millisecond'), updated_at = now()
         WHERE id = ${msg.id}`.execute(tx);
    }
    return { go: { mode, l, attemptsBefore: msg.attempts } };
  });

  if ('skip' in claim) return { status: 'skipped', reason: claim.skip };
  if ('done' in claim) return claim.done;
  const { mode, l, attemptsBefore } = claim.go;

  // ---- 2. call the task tool (outside any transaction) ----------------------------------------
  const connector = deps.connectors({ id: l.connection.id, provider: l.connection.provider });
  const payload = l.msg.payload as ExternalTaskInput;
  const input: ExternalTaskInput = { ...payload, idempotencyKey: l.msg.idempotency_key };
  let outcome: Outcome | null = null;
  try {
    // Reconcile before retry: an earlier attempt (or a crashed worker) may have created the issue.
    if (mode === 'reconcile' || attemptsBefore > 0) {
      const found = await connector.findByIdempotencyKey(input.idempotencyKey);
      if (found) outcome = { kind: 'confirmed', ref: found };
      else if (mode === 'reconcile') outcome = { kind: 'not_found' };
    }
    if (!outcome) outcome = { kind: 'confirmed', ref: await connector.createTask(input) };
  } catch (e) {
    // Anything that is not a typed connector error is treated like a crash: the row keeps its
    // lease and state, and the sweep reconciles it later.
    if (!(e instanceof ConnectorError)) throw e;
    outcome = { kind: 'error', error: e };
  }

  // ---- 3. record ---------------------------------------------------------------------------------
  return withTenant(deps.db, ctx, async (tx) => {
    const cur = await load(tx, messageId);
    if (!cur) return { status: 'skipped', reason: 'row disappeared' };
    const expected = mode === 'send' ? 'sending' : 'checking';
    const o = outcome!;

    if (o.kind === 'confirmed') {
      // The tool returned a key: the write happened. Record it even if the row was paused or
      // reclaimed meanwhile — an executed external write is preserved and shown (never-rule 9/10).
      const via = mode === 'reconcile' || attemptsBefore > 0 ? 'reconcile' : 'create';
      return recordConfirmed(tx, cur, o.ref, now(), correlationId, via);
    }

    // Someone else took the row over (sweep after lease expiry, pause): leave their state alone.
    if (cur.msg.status !== expected) return { status: 'skipped', reason: `row is now ${cur.msg.status}` };

    if (o.kind === 'not_found') return scheduleRetry(tx, cur, null, 'reconcile_not_found');

    const e = o.error;
    const code = ERROR_CODE_BY_KIND[e.kind];
    if (e.connectionLevel) {
      const status = await pauseConnection(
        tx,
        cur,
        e,
        e.kind === 'token_expired' ? 'expired' : 'unavailable',
      );
      return { status, externalKey: null, errorCode: code };
    }
    if (e.kind === 'timeout_ambiguous') {
      const to = transition(cur.link.sync_status, 'send_timeout', {}) ?? 'checking';
      await updateMessage(tx, cur.msg.id, {
        status: 'checking',
        lastError: { code, message: e.message },
        nextAttemptAt: now(),
        releaseLock: true,
      });
      await updateLink(tx, cur.link.id, { status: to, error: { code, message: e.message, retryable: true } });
      await audit(tx, cur, 'task_sync.checking', `Task ${cur.task.ordinal} · Checking (ambiguous timeout)`, {
        code,
      });
      await enqueueJob(tx, JOBS.outboxReconcile, { tenantId, correlationId, outboxMessageId: cur.msg.id });
      return { status: to, externalKey: null, errorCode: code };
    }
    if (e.retryable) {
      if (mode === 'reconcile') {
        // The search itself failed: stay in Checking and search again later.
        await updateMessage(tx, cur.msg.id, {
          lastError: { code, message: e.message },
          nextAttemptAt: new Date(now().getTime() + backoff(cur.msg.attempts, e.retryAfterMs)),
          releaseLock: true,
        });
        return { status: 'checking', externalKey: null, errorCode: code };
      }
      return scheduleRetry(tx, cur, e, 'send_failed_retryable');
    }
    const status = await fail(tx, cur, now(), correlationId, code, e.message, true);
    return { status, externalKey: null, errorCode: code };
  });

  async function scheduleRetry(
    tx: Tx,
    cur: Loaded,
    e: ConnectorError | null,
    command: 'send_failed_retryable' | 'reconcile_not_found',
  ): Promise<ProcessResult> {
    const to = transition(cur.link.sync_status, command, machineFacts(cur, null));
    const code = e ? ERROR_CODE_BY_KIND[e.kind] : 'not_found';
    const message = e?.message ?? 'The task tool has no issue for this task yet; it will be sent again.';
    if (!to) {
      const status = await fail(
        tx,
        cur,
        now(),
        correlationId,
        RECHECK_CODES.attemptsExhausted,
        `The task tool did not accept the task after ${cur.msg.attempts} attempts. ${message}`.slice(0, 500),
        true,
      );
      return { status, externalKey: null, errorCode: RECHECK_CODES.attemptsExhausted };
    }
    const runAt = new Date(now().getTime() + backoff(cur.msg.attempts, e?.retryAfterMs ?? null));
    await updateMessage(tx, cur.msg.id, {
      status: 'pending',
      lastError: { code, message },
      nextAttemptAt: runAt,
      releaseLock: true,
    });
    await updateLink(tx, cur.link.id, { status: to, error: { code, message, retryable: true } });
    await audit(
      tx,
      cur,
      'task_sync.retry_scheduled',
      `Task ${cur.task.ordinal} · Retry scheduled (${code})`,
      {
        code,
        attempts: cur.msg.attempts,
      },
    );
    await enqueueJob(
      tx,
      JOBS.outboxDispatch,
      { tenantId, correlationId, outboxMessageId: cur.msg.id },
      { runAt, jobKey: `outbox:${cur.msg.id}` },
    );
    return { status: to, externalKey: null, errorCode: code };
  }
}
