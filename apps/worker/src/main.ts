/**
 * Worker entry point: graphile-worker over Postgres as the worker role (me_worker, NOBYPASSRLS).
 * Each task sets tenant context before touching data. Streams add their task maps in `tasks.ts`
 * (WS5 analysis and WS6 outbox still to come). Crontab entries run only for registered tasks.
 */
import { parseCronItems, run } from 'graphile-worker';
import { createDb, createObjectStore, DB_URLS } from '@growth-os/db';
import { CRONTAB } from './jobs/catalog';
import { cronItemsFrom } from './schedule';
import { createTaskList } from './tasks';

const db = createDb('worker', 5);
const objects = createObjectStore();

const taskList = createTaskList({ db, objects });

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
