import { afterAll, describe, expect, it } from 'vitest';
import type { TaskList } from 'graphile-worker';
import { createDb, sql } from '@growth-os/db';
import { closeDrain, drainJobs } from './drain';
import { JOBS } from './jobs/catalog';

const db = createDb('worker', 2);

afterAll(async () => {
  await sql`SELECT graphile_worker.remove_job(${`cron:${JOBS.outboxSweep}`})`.execute(db);
  await closeDrain();
  await db.destroy();
});

describe('drainJobs (bounded drain for Vercel, D-161)', () => {
  it('runs due jobs, schedules overdue periodic occurrences and stops when idle', async () => {
    const seen: string[] = [];
    const tag = `drain-${Date.now()}`;
    const taskList: TaskList = {
      [JOBS.outboxSweep]: async () => void seen.push('sweep'),
      'test.drain_echo': async (payload) => void seen.push((payload as { tag: string }).tag),
    };
    await sql`SELECT graphile_worker.add_job('test.drain_echo', ${JSON.stringify({ tag })}::json)`.execute(
      db,
    );

    // Two minutes ago: the every-minute sweep occurrence is already due.
    const r = await drainJobs({ budgetMs: 10_000, taskList, now: () => new Date(Date.now() - 120_000) });

    expect(r.stoppedBy).toBe('idle');
    expect(seen).toContain(tag);
    expect(seen).toContain('sweep');
    expect(r.failed).toBe(0);

    // The next drain schedules the following occurrence, not yet due: nothing runs twice.
    seen.length = 0;
    const r2 = await drainJobs({ budgetMs: 10_000, taskList });
    expect(r2.stoppedBy).toBe('idle');
    expect(seen).toEqual([]);
    const pending = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM graphile_worker.jobs WHERE key = ${`cron:${JOBS.outboxSweep}`}`.execute(
      db,
    );
    expect(pending.rows[0]!.n).toBe(1);
  });
});
