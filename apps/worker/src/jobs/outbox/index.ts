/**
 * Outbox jobs (owner WS6): `outbox.dispatch` (enqueued by the API in the send/retry transaction),
 * `outbox.reconcile` (after an ambiguous timeout) and `outbox.sweep` (cron every minute: crash
 * recovery, resume after reconnect, due retries via platform.claim_outbox_batch).
 */
import type { Task } from 'graphile-worker';
import { createConnectorFactory, type ConnectorFactory } from '@growth-os/connectors';
import type { Db } from '@growth-os/db';
import { JOBS, type OutboxDispatchPayload } from '../catalog';
import { processOutboxMessage, type OutboxDeps } from './dispatch';
import { sweepOutbox } from './sweep';

export * from './dispatch';
export * from './facts';
export * from './policy';
export * from './sweep';

export interface OutboxTaskOptions {
  /** Defaults to the simulated connector over the worker pool (sim schema). */
  connectors?: ConnectorFactory;
  leaseMs?: number;
  backoffMs?: OutboxDeps['backoffMs'];
}

function payloadOf(payload: unknown): OutboxDispatchPayload {
  const p = (payload ?? {}) as Partial<OutboxDispatchPayload>;
  if (typeof p.tenantId !== 'string' || typeof p.outboxMessageId !== 'string')
    throw new Error('outbox job payload needs tenantId and outboxMessageId');
  return {
    tenantId: p.tenantId,
    outboxMessageId: p.outboxMessageId,
    correlationId: typeof p.correlationId === 'string' ? p.correlationId : `outbox-${p.outboxMessageId}`,
  };
}

export function createOutboxTasks(db: Db, opts: OutboxTaskOptions = {}): Record<string, Task> {
  const base: OutboxDeps = {
    db,
    connectors: opts.connectors ?? createConnectorFactory({ sim: db }),
    leaseMs: opts.leaseMs,
    backoffMs: opts.backoffMs,
  };
  const one: Task = async (payload, helpers) => {
    const p = payloadOf(payload);
    const r = await processOutboxMessage(
      { ...base, correlationId: p.correlationId },
      p.tenantId,
      p.outboxMessageId,
    );
    helpers.logger.info(`outbox ${p.outboxMessageId}: ${r.status}`);
  };
  return {
    [JOBS.outboxDispatch]: one,
    [JOBS.outboxReconcile]: one,
    [JOBS.outboxSweep]: async (_payload, helpers) => {
      const s = await sweepOutbox(base);
      const errors = s.processed.filter((p) => p.result.status === 'error').length;
      if (s.recovered || s.resumed || s.aligned || s.processed.length)
        helpers.logger.info(
          `outbox.sweep: ${s.recovered} recovered, ${s.resumed} resumed, ${s.aligned} aligned, ${s.processed.length} processed, ${errors} errors`,
        );
    },
  };
}
