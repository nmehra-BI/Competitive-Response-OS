/**
 * Acceptance step 24: timeout after success. The tool creates the issue but the answer is lost; the
 * task shows "Checking", the reconcile job finds the issue by its idempotency key and records
 * "Confirmed" with that key. No second create, no duplicate. Plus the other transient faults
 * (5xx, rate limit) and exhausted attempts — each ends with one issue per key.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, SYNC_STATUS_LABELS } from '@growth-os/contracts';
import { sql } from '@growth-os/db';
import { call } from '../../src/platform/testing';
import {
  analyticsCount,
  drain,
  expectNoDuplicates,
  harness,
  pass,
  pilotScenario,
  send,
  setFaults,
  simIssues,
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

describe('timeout after success', () => {
  it('step 24: Checking → reconcile by key → Confirmed; exactly one issue for the task', async () => {
    const p = await pilotScenario(h);
    await setFaults(h, p.jonas, p.connectionId, [
      { mode: 'timeout_after_success', match: { titleContains: 'Install monitoring' }, times: 1 },
    ]);
    await send(h, p.jonas, p.taskSetId);

    const first = await pass(h, p.s);
    expect(first.map((r) => r.status)).toEqual([
      'confirmed',
      'checking',
      'confirmed',
      'confirmed',
      'confirmed',
      'confirmed',
    ]);
    const checking = await taskSet(h, p.jonas, p.taskSetId);
    const task2 = checking.tasks.find((t) => t.ordinal === 2)!;
    expect(task2.sync).toMatchObject({ status: 'checking', externalKey: null, lastErrorCode: 'timeout' });
    expect(SYNC_STATUS_LABELS[task2.sync.status]).toBe('Checking');
    expect(checking.summaryText).toBe('5 of 6 tasks confirmed in Jira · 1 checking');
    // The issue already exists in the tool although we do not know its key yet.
    expect(await simIssues(h, p.connectionId)).toHaveLength(6);

    // A retry click while Checking does nothing: only failed tasks are retried.
    const retry = await call(h.t.app, API.taskSync.retry, {
      params: { id: p.taskSetId },
      body: {},
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(retry.statusCode).toBe(409);

    const second = await pass(h, p.s); // outbox.reconcile
    expect(second).toEqual([
      { status: 'confirmed', externalKey: expect.stringMatching(/^PIL-\d+$/), errorCode: null },
    ]);
    const view = await taskSet(h, p.jonas, p.taskSetId);
    expect(view.summaryText).toBe('6 of 6 tasks confirmed in Jira');
    const issues = await simIssues(h, p.connectionId);
    expect(issues).toHaveLength(6);
    expect(view.tasks.find((t) => t.ordinal === 2)!.sync.externalKey).toBe(
      issues.find((i) => i.title === 'Install monitoring at 4 sites')!.key,
    );
    await expectNoDuplicates(h, p.connectionId);
    // The reconcile searched and never created again.
    const calls = (
      await sql<{ operation: string; outcome: string }>`
        SELECT operation, outcome FROM sim.call_log WHERE connection_id = ${p.connectionId} ORDER BY id`.execute(
        h.t.db,
      )
    ).rows;
    expect(calls.filter((c) => c.operation === 'create')).toHaveLength(6);
    expect(calls.filter((c) => c.operation === 'find').map((c) => c.outcome)).toEqual([
      expect.stringMatching(/^found:PIL-\d+$/),
    ]);
    expect(await analyticsCount(h, p.s, 'external_task_confirmed')).toBe(6);
    expect(await analyticsCount(h, p.s, 'external_task_failed')).toBe(0);
  });

  it('5xx and rate limit back off and retry with the same key (reconcile first) → no duplicates', async () => {
    const p = await pilotScenario(h);
    await setFaults(h, p.jonas, p.connectionId, [
      { mode: 'http_5xx', match: { nthCall: 1 }, times: 1 },
      { mode: 'rate_limited', match: { nthCall: 2 }, times: 1 },
      { mode: 'timeout_after_success', match: { nthCall: 3 }, times: 1 },
      { mode: 'http_5xx', match: { titleContains: 'Day-90' }, times: 2 },
    ]);
    await send(h, p.jonas, p.taskSetId);
    const first = await pass(h, p.s);
    expect(first.map((r) => r.status)).toEqual([
      'retry_scheduled',
      'retry_scheduled',
      'checking',
      'confirmed',
      'confirmed',
      'retry_scheduled',
    ]);
    const mid = await taskSet(h, p.jonas, p.taskSetId);
    expect(mid.tasks.find((t) => t.ordinal === 1)!.sync).toMatchObject({
      status: 'retry_scheduled',
      lastErrorCode: 'http_5xx',
      attempts: 1,
    });
    await drain(h, p.s);
    const view = await taskSet(h, p.jonas, p.taskSetId);
    expect(view.summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(await simIssues(h, p.connectionId)).toHaveLength(6);
    await expectNoDuplicates(h, p.connectionId);
  });

  it('5 failed attempts → Failed (retryable); manual retry reconciles first and keeps one issue', async () => {
    const p = await pilotScenario(h);
    await setFaults(h, p.jonas, p.connectionId, [
      { mode: 'http_5xx', match: { titleContains: 'Weekly deployment' }, times: 5 },
    ]);
    await send(h, p.jonas, p.taskSetId);
    await drain(h, p.s);
    const failed = await taskSet(h, p.jonas, p.taskSetId);
    expect(failed.summaryText).toBe('5 of 6 tasks confirmed in Jira · 1 failed (task tool unavailable)');
    expect(failed.tasks.find((t) => t.ordinal === 4)!.sync).toMatchObject({
      status: 'failed',
      attempts: 5,
      lastErrorCode: 'attempts_exhausted',
      retryable: true,
    });
    expect(await analyticsCount(h, p.s, 'external_task_failed')).toBe(1);

    const retry = await call(h.t.app, API.taskSync.retry, {
      params: { id: p.taskSetId },
      body: { taskIds: [failed.tasks.find((t) => t.ordinal === 4)!.id] },
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(retry.statusCode, retry.body).toBe(202);
    await drain(h, p.s);
    expect((await taskSet(h, p.jonas, p.taskSetId)).summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(await simIssues(h, p.connectionId)).toHaveLength(6);
    await expectNoDuplicates(h, p.connectionId);
  });
});
