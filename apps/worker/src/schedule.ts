/**
 * The frozen CRONTAB uses dotted task names (`evidence.freshness`), which graphile-worker's crontab
 * text grammar does not accept. This turns each line into a structured cron item (any task name is
 * valid there) and keeps only tasks this worker registered, so a stream's job only runs once its
 * handler exists.
 */
import type { CronItem } from 'graphile-worker';

export function cronItemsFrom(crontab: string, registered: readonly string[]): CronItem[] {
  return crontab
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split(/\s+/);
      if (parts.length < 6) throw new Error(`crontab line needs 5 time fields and a task: "${line}"`);
      return { match: parts.slice(0, 5).join(' '), task: parts[5]! };
    })
    .filter((item) => registered.includes(item.task))
    .map((item) => ({ ...item, identifier: item.task }));
}
