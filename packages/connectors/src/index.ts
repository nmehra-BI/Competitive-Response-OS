/**
 * @growth-os/connectors — external task tools. Shared Growth OS primitive (no app imports).
 */
import { createHash } from 'node:crypto';

export * from './task-connector';
export * from './simulated/simulated-connector';
export * from './simulated/faults';
export * from './simulated/memory-store';
export * from './simulated/pg-store';
export * from './factory';

/**
 * FROZEN idempotency key for an external task write (D-021): stable across retries, previews and
 * worker restarts, and different per destination so moving a plan to another tool is a new write.
 */
export function externalTaskIdempotencyKey(parts: {
  tenantId: string;
  planVersionId: string; // pilot plan version or experiment plan version
  taskId: string;
  connectionId: string;
  project: string;
}): string {
  return createHash('sha256')
    .update([parts.tenantId, parts.planVersionId, parts.taskId, parts.connectionId, parts.project].join('|'))
    .digest('hex');
}
