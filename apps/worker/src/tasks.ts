/**
 * The worker's task list. Each stream's task map is registered here (WS1 evidence + analytics, WS3
 * timers; WS5 analysis and WS6 outbox add theirs). Crontab entries run only for registered tasks
 * (`cronItemsFrom`), so a job is scheduled exactly when its handler exists.
 */
import type { TaskList } from 'graphile-worker';
import type { Db, ObjectStore } from '@growth-os/db';
import { analyticsTasks } from './jobs/analytics';
import { evidenceTasks } from './jobs/evidence';
import { createTimerTasks, type TimerOptions } from './jobs/timers';

export interface WorkerDeps {
  db: Db;
  objects: ObjectStore;
  timers?: TimerOptions;
}

export function createTaskList(deps: WorkerDeps): TaskList {
  return {
    ...evidenceTasks({ db: deps.db, objects: deps.objects }),
    ...analyticsTasks({ db: deps.db }),
    ...createTimerTasks(deps.db, deps.timers),
  };
}
