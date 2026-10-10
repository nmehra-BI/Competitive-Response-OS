import { describe, expect, it } from 'vitest';
import { parseCronItems } from 'graphile-worker';
import { CRONTAB, JOBS } from './jobs/catalog';
import { cronItemsFrom } from './schedule';

describe('cronItemsFrom', () => {
  it('turns the frozen crontab into cron items for registered tasks only', () => {
    const items = cronItemsFrom(CRONTAB, [JOBS.evidenceFreshness, JOBS.analyticsFlush]);
    expect(items).toEqual([
      { match: '30 3 * * *', task: 'evidence.freshness', identifier: 'evidence.freshness' },
      { match: '*/1 * * * *', task: 'analytics.flush', identifier: 'analytics.flush' },
    ]);
    // graphile-worker accepts dotted task names in structured items.
    expect(() => parseCronItems(items)).not.toThrow();
  });
});

describe('worker task list', () => {
  it('registers the WS1 evidence/analytics tasks, the WS3 timers, the WS5 analysis run and the WS6 outbox, and schedules all of them', async () => {
    const { createTaskList } = await import('./tasks');
    const { createDb, createObjectStore } = await import('@growth-os/db');
    // createDb does not connect until a query runs; no database is needed here.
    const db = createDb('worker', 1);
    const taskList = createTaskList({ db, objects: createObjectStore() });
    const names = Object.keys(taskList).sort();
    expect(names).toEqual(
      [
        JOBS.analysisRun, // WS5
        JOBS.analyticsFlush,
        JOBS.evidenceFreshness,
        JOBS.evidenceIngest,
        JOBS.timersApprovalExpiry,
        JOBS.timersPilotWindow,
        JOBS.outboxDispatch,
        JOBS.outboxReconcile,
        JOBS.outboxSweep,
      ].sort(),
    );
    const scheduled = cronItemsFrom(CRONTAB, names).map((i) => i.task);
    expect(scheduled).toEqual(
      expect.arrayContaining([
        JOBS.timersApprovalExpiry,
        JOBS.timersPilotWindow,
        JOBS.evidenceFreshness,
        JOBS.outboxSweep,
      ]),
    );
    await db.destroy();
  });
});
