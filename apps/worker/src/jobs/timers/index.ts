/**
 * Timer jobs (owner WS3): `timers.approval_expiry` (every 15 min) and `timers.pilot_window` (hourly).
 * Register with graphile-worker in apps/worker/src/main.ts:
 *
 *   const db = createDb('worker');
 *   run({ connectionString: DB_URLS.worker, crontab: CRONTAB, taskList: { ...createTimerTasks(db), ... } });
 */
import { randomUUID } from 'node:crypto';
import type { Task } from 'graphile-worker';
import type { Db } from '@growth-os/db';
import { JOBS } from '../catalog';
import {
  advancePilotWindowsInTenant,
  expireApprovalsInTenant,
  forEachTenant,
  type TimerContext,
} from './store';

export * from './plan';
export * from './store';

export interface TimerOptions {
  /** Tenant-local zone for calendar dates. Default Europe/Berlin (pilot region, D-003). */
  timeZone?: string;
  /** Clock, injectable for tests. */
  now?: () => string;
}

function context(payload: unknown, opts: TimerOptions): TimerContext {
  const p = (payload ?? {}) as { correlationId?: unknown };
  return {
    now: opts.now ? opts.now() : new Date().toISOString(),
    timeZone: opts.timeZone ?? 'Europe/Berlin',
    correlationId: typeof p.correlationId === 'string' ? p.correlationId : `timer-${randomUUID()}`,
  };
}

export function createTimerTasks(db: Db, opts: TimerOptions = {}): Record<string, Task> {
  return {
    [JOBS.timersApprovalExpiry]: async (payload, helpers) => {
      const results = await forEachTenant(db, context(payload, opts), expireApprovalsInTenant);
      const failed = results.filter((r) => r.error);
      const expired = results.reduce((n, r) => n + (r.result?.expired ?? 0), 0);
      helpers.logger.info(`approval expiry: ${expired} expired across ${results.length} tenants`);
      if (failed.length > 0) throw new Error(`approval expiry failed for ${failed.length} tenant(s)`);
    },
    [JOBS.timersPilotWindow]: async (payload, helpers) => {
      const results = await forEachTenant(db, context(payload, opts), advancePilotWindowsInTenant);
      const failed = results.filter((r) => r.error);
      const advanced = results.reduce((n, r) => n + (r.result?.advanced ?? 0), 0);
      const overdue = results.reduce((n, r) => n + (r.result?.overdueExperiments ?? 0), 0);
      helpers.logger.info(
        `pilot window: ${advanced} case(s) to review due; ${overdue} overdue experiment(s)`,
      );
      if (failed.length > 0) throw new Error(`pilot window failed for ${failed.length} tenant(s)`);
    },
  };
}
