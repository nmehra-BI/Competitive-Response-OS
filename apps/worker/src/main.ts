/**
 * Worker entry point. TODO(WS1/WS5/WS6): register task handlers for every JOBS entry and start
 * graphile-worker `run({ connectionString: DB_URLS.worker, crontab: CRONTAB, taskList })`.
 * The worker role (me_worker) has no BYPASSRLS; each task sets tenant context first.
 */
import { CRONTAB, JOBS } from './jobs/catalog';

console.warn(`worker skeleton: ${Object.keys(JOBS).length} jobs declared, crontab:\n${CRONTAB}`);
