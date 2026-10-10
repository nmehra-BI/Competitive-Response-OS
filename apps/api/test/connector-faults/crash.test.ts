/**
 * Worker crash mid-send: the tool created the issue but the worker died before recording it. The
 * row stays `sending` under its lease; nobody else may touch it until the lease expires; then the
 * sweep moves it to Checking, reconciles by key and confirms — never a second issue.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@growth-os/db';
import { processOutboxMessage } from '../../../worker/src/jobs/outbox';
import {
  crashingAfterCreate,
  dueMessages,
  expectNoDuplicates,
  harness,
  inTenant,
  outboxDeps,
  pilotScenario,
  send,
  simIssues,
  sweep,
  taskSet,
  type Harness,
} from './support';

let h: Harness;

beforeAll(async () => {
  h = await harness();
});
afterAll(async () => {
  await h.close();
});

describe('worker crash mid-send', () => {
  it('the sweep reclaims the leased row after expiry and reconciles instead of creating again', async () => {
    const p = await pilotScenario(h);
    await send(h, p.jonas, p.taskSetId);
    const [first] = await dueMessages(h, p.s);
    const base = outboxDeps(h);
    const crashing = { ...base, connectors: crashingAfterCreate(base.connectors, () => true) };

    await expect(processOutboxMessage(crashing, p.s.tenantId, first!)).rejects.toThrow('worker process died');
    expect(await simIssues(h, p.connectionId)).toHaveLength(1); // the write happened in the tool

    // While the lease holds, neither a dispatch job nor the sweep touches the row.
    expect(await processOutboxMessage(base, p.s.tenantId, first!)).toEqual({
      status: 'skipped',
      reason: 'status sending',
    });
    const early = await sweep(h, p.s);
    expect(early.recovered).toBe(0);
    let view = await taskSet(h, p.jonas, p.taskSetId);
    expect(view.tasks.find((t) => t.ordinal === 1)!.sync).toMatchObject({
      status: 'sending',
      externalKey: null,
    });

    // The lease expires (the worker is gone).
    await inTenant(h.worker, p.s, (tx) =>
      sql`UPDATE platform.outbox_message SET locked_until = now() - interval '1 second' WHERE id = ${first!}`.execute(
        tx,
      ),
    );
    const s = await sweep(h, p.s);
    expect(s.recovered).toBe(1);
    const mine = s.processed.find((x) => x.messageId === first)!;
    expect(mine.result).toMatchObject({
      status: 'confirmed',
      externalKey: expect.stringMatching(/^PIL-\d+$/),
    });

    view = await taskSet(h, p.jonas, p.taskSetId);
    expect(view.summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(await simIssues(h, p.connectionId)).toHaveLength(6);
    await expectNoDuplicates(h, p.connectionId);
    const recovered = await inTenant(h.t.db, p.s, (tx) =>
      tx
        .selectFrom('platform.audit_event')
        .select(['action', 'summary'])
        .where('action', '=', 'task_sync.checking')
        .execute(),
    );
    expect(recovered).toEqual([
      { action: 'task_sync.checking', summary: 'Task 1 · Checking (worker restarted mid-send)' },
    ]);
  });

  it('a crash between claim and call (nothing sent) also ends with exactly one issue', async () => {
    const p = await pilotScenario(h);
    await send(h, p.jonas, p.taskSetId);
    const [first] = await dueMessages(h, p.s);
    const base = outboxDeps(h);
    const dying = {
      ...base,
      connectors: (c: { id: string; provider: string }) => ({
        ...base.connectors(c),
        createTask: async () => {
          throw new Error('worker process died before the call');
        },
        findByIdempotencyKey: async () => {
          throw new Error('worker process died before the call');
        },
      }),
    };
    await expect(processOutboxMessage(dying, p.s.tenantId, first!)).rejects.toThrow('worker process died');
    expect(await simIssues(h, p.connectionId)).toHaveLength(0);
    await inTenant(h.worker, p.s, (tx) =>
      sql`UPDATE platform.outbox_message SET locked_until = now() - interval '1 second' WHERE id = ${first!}`.execute(
        tx,
      ),
    );
    // Recovered to Checking → not found → retry scheduled → sent once.
    await sweep(h, p.s);
    await sweep(h, p.s);
    expect((await taskSet(h, p.jonas, p.taskSetId)).summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(await simIssues(h, p.connectionId)).toHaveLength(6);
    await expectNoDuplicates(h, p.connectionId);
  });
});
