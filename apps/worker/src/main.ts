/**
 * Worker entry point: graphile-worker over Postgres as the worker role (me_worker, NOBYPASSRLS).
 * Each task sets tenant context before touching data. Streams add their task maps here as they land
 * (WS3 timers, WS5 analysis, WS6 outbox). Crontab entries run only for registered tasks.
 */
import { run, type TaskList } from 'graphile-worker';
import { createDb, createObjectStore, DB_URLS } from '@growth-os/db';
import { CRONTAB } from './jobs/catalog';
import { analyticsTasks } from './jobs/analytics';
import { evidenceTasks } from './jobs/evidence';

const db = createDb('worker', 5);
const objects = createObjectStore();

const taskList: TaskList = {
  ...evidenceTasks({ db, objects }),
  ...analyticsTasks({ db }),
};

const crontab = CRONTAB.split('\n')
  .filter((line) => Object.keys(taskList).includes(line.trim().split(/\s+/)[5] ?? ''))
  .join('\n');

const runner = await run({
  connectionString: DB_URLS.worker,
  concurrency: 4,
  noHandleSignals: false,
  pollInterval: 1000,
  taskList,
  crontab,
});

console.warn(`worker running: ${Object.keys(taskList).join(', ')}`);
await runner.promise;
await db.destroy();
