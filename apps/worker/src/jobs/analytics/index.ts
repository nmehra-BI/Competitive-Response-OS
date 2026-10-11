/** graphile-worker task owned by WS1: deliver analytics events (PRD §17) and stamp emitted_at. */
import type { Task } from 'graphile-worker';
import type { Db } from '@growth-os/db';
import { JOBS } from '../catalog';
import { tenantIds } from '../evidence/freshness';
import { flushAnalytics, tableSink, type AnalyticsSink } from './flush';

export function analyticsTasks(deps: {
  db: Db;
  sink?: AnalyticsSink;
  now?: () => Date;
}): Record<string, Task> {
  const now = deps.now ?? (() => new Date());
  return {
    [JOBS.analyticsFlush]: async (_payload, helpers) => {
      let total = 0;
      for (const tenantId of await tenantIds(deps.db))
        total += await flushAnalytics(
          deps.db,
          tenantId,
          now(),
          `job:${helpers.job.id}`,
          deps.sink ?? tableSink,
        );
      if (total) helpers.logger.info(`analytics.flush delivered ${total} events`);
    },
  };
}
