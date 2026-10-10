/**
 * Timer jobs (owner WS3): `timers.approval_expiry` (every 15 min), `timers.pilot_window` (hourly) and
 * `timers.license_expiry` (daily 02:15, E3 / D-129).
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
import { expireLicensesInTenant } from './license-expiry';

export * from './plan';
export * from './store';
export * from './license-expiry';

export interface TimerOptions {
  /**
   * Fallback zone for calendar dates when a tenant row has none. Each tenant's own zone is read from
   * `platform.tenant.time_zone` per run (D-077). Default Europe/Berlin (pilot region, D-003).
   */
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
    // D-129 (E3): run each ended licence's on-expiry action and drop it to metadata only.
    [JOBS.timersLicenseExpiry]: async (payload, helpers) => {
      const results = await forEachTenant(db, context(payload, opts), expireLicensesInTenant);
      const failed = results.filter((r) => r.error);
      const expired = results.reduce((n, r) => n + (r.result?.expired ?? 0), 0);
      helpers.logger.info(`licence expiry: ${expired} licence(s) expired across ${results.length} tenants`);
      if (failed.length > 0) throw new Error(`licence expiry failed for ${failed.length} tenant(s)`);
    },
  };
}
