/**
 * Worker entry point: graphile-worker over Postgres as the worker role (me_worker, NOBYPASSRLS).
 * Each task sets tenant context before touching data. Streams add their task maps here as they land
 * (WS3 timers, WS5 analysis, WS6 outbox). Crontab entries run only for registered tasks.
 */
import { parseCronItems, run, type TaskList } from 'graphile-worker';
import { createDb, createObjectStore, DB_URLS } from '@growth-os/db';
import { CRONTAB } from './jobs/catalog';
import { analyticsTasks } from './jobs/analytics';
import { evidenceTasks } from './jobs/evidence';
import { cronItemsFrom } from './schedule';

const db = createDb('worker', 5);
const objects = createObjectStore();

const taskList: TaskList = {
  ...evidenceTasks({ db, objects }),
  ...analyticsTasks({ db }),
};

const runner = await run({
  connectionString: DB_URLS.worker,
  concurrency: 4,
  noHandleSignals: false,
  pollInterval: 1000,
  taskList,
  parsedCronItems: parseCronItems(cronItemsFrom(CRONTAB, Object.keys(taskList))),
});

console.warn(`worker running: ${Object.keys(taskList).join(', ')}`);
await runner.promise;
await db.destroy();
