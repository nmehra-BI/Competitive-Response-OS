/**
 * Bounded job drain for hosts without an always-on worker (Vercel functions; decisions.md D-161, D-162).
 *
 * One call: (1) make sure every periodic task in the frozen CRONTAB has a pending "next occurrence"
 * job (job_key `cron:<task>`, mode `preserve_run_at`), so a missed occurrence runs at the first drain
 * after it was due and missed occurrences collapse into one; (2) run graphile-worker until no job is
 * due or the time budget is spent, then stop gracefully (running jobs finish; none is left locked).
 *
 * Wall-clock rules do not depend on drain timing: approval effectiveness is computed from
 * `expires_at` at send time (never-rule 10, packages/db/src/approval.ts) and the outbox re-checks it at
 * claim, so a late timer only delays the status change that people see, never what is authorized.
 */
import { EventEmitter } from 'node:events';
import pg from 'pg';
import {
  parseCronItems,
  run,
  type CronItem,
  type ParsedCronItem,
  type TaskList,
  type WorkerEvents,
} from 'graphile-worker';
import { createDb, createObjectStore, pgConfig, sql, type Db } from '@growth-os/db';
import { CRONTAB } from './jobs/catalog';
import { cronItemsFrom } from './schedule';
import { createTaskList } from './tasks';

const MINUTE_MS = 60_000;

/** The first minute at or after `from` (UTC, whole minutes) that the cron item matches; null if none within the horizon. */
export function nextOccurrence(item: ParsedCronItem, from: Date, horizonMinutes = 8 * 24 * 60): Date | null {
  let t = Math.ceil(from.getTime() / MINUTE_MS) * MINUTE_MS;
  for (let i = 0; i <= horizonMinutes; i++, t += MINUTE_MS) {
    const d = new Date(t);
    const digest = {
      min: d.getUTCMinutes(),
      hour: d.getUTCHours(),
      date: d.getUTCDate(),
      month: d.getUTCMonth() + 1,
      dow: d.getUTCDay(),
    };
    if (item.match(digest)) return d;
  }
  return null;
}

/** The periodic tasks this deployment runs (registered tasks only, like the long-running worker). */
export function periodicItems(taskNames: readonly string[], crontab: string = CRONTAB): ParsedCronItem[] {
  const items: CronItem[] = cronItemsFrom(crontab, taskNames);
  return parseCronItems(items);
}

/**
 * Ensure one pending job per periodic task at its next occurrence. `preserve_run_at` keeps an
 * existing pending job's (earlier) run time, so an overdue occurrence stays due.
 */
export async function schedulePeriodic(db: Db, items: readonly ParsedCronItem[], now: Date): Promise<number> {
  let n = 0;
  for (const item of items) {
    const at = nextOccurrence(item, now);
    if (!at) continue;
    await sql`SELECT graphile_worker.add_job(
        identifier => ${item.task},
        payload => ${JSON.stringify({ correlationId: `cron:${item.task}:${at.toISOString()}` })}::json,
        run_at => ${at.toISOString()}::timestamptz,
        job_key => ${`cron:${item.task}`}::text,
        job_key_mode => 'preserve_run_at')`.execute(db);
    n++;
  }
  return n;
}

export interface DrainResult {
  scheduled: number;
  completed: number;
  failed: number;
  stoppedBy: 'idle' | 'budget';
  ms: number;
}

export interface DrainOptions {
  /** Stop taking new jobs after this long (ms). Running jobs finish. */
  budgetMs: number;
  /** Override the clock (tests). */
  now?: () => Date;
  /** Override the task list (tests). */
  taskList?: TaskList;
}

let shared: { db: Db; pool: pg.Pool; taskList: TaskList; items: ParsedCronItem[] } | null = null;

function deps(override?: TaskList): NonNullable<typeof shared> {
  if (!shared) {
    const db = createDb('worker', 2, { idleTimeoutMillis: 10_000 });
    const taskList = createTaskList({ db, objects: createObjectStore() });
    shared = {
      db,
      pool: new pg.Pool({ ...pgConfig('worker'), max: 3, idleTimeoutMillis: 10_000 }),
      taskList,
      items: periodicItems(Object.keys(taskList)),
    };
  }
  return override ? { ...shared, taskList: override, items: periodicItems(Object.keys(override)) } : shared;
}

/** Run one bounded drain. Safe to call concurrently from several instances (graphile-worker locks jobs). */
export async function drainJobs(opts: DrainOptions): Promise<DrainResult> {
  const started = Date.now();
  const d = deps(opts.taskList);
  const scheduled = await schedulePeriodic(d.db, d.items, (opts.now ?? (() => new Date()))());

  const events: WorkerEvents = new EventEmitter() as WorkerEvents;
  let completed = 0;
  let failed = 0;
  events.on('job:success', () => void completed++);
  events.on('job:failed', () => void failed++);

  const runner = await run({
    pgPool: d.pool,
    concurrency: 1,
    noHandleSignals: true,
    pollInterval: 500,
    taskList: d.taskList,
    parsedCronItems: [],
    events,
  });

  const stoppedBy = await new Promise<'idle' | 'budget'>((resolve) => {
    const timer = setTimeout(() => resolve('budget'), opts.budgetMs);
    events.on('worker:getJob:empty', () => {
      clearTimeout(timer);
      resolve('idle');
    });
  });
  await runner.stop();
  await runner.promise.catch(() => undefined);
  return { scheduled, completed, failed, stoppedBy, ms: Date.now() - started };
}

/** Close the shared pools (tests and scripts). */
export async function closeDrain(): Promise<void> {
  if (!shared) return;
  const s = shared;
  shared = null;
  await s.db.destroy();
  await s.pool.end();
}
