/**
 * Jira Cloud · acceptance step 24: timeout after success. Jira creates the issue but the answer is
 * lost (the mock holds it past the client timeout); the task shows "Checking", reconcile finds the
 * issue by the key label + entity property and records "Confirmed" with Jira's key — no second
 * create. Plus 5xx and 429 (Retry-After) on creates, and five failed attempts → Failed (retryable).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, SYNC_STATUS_LABELS } from '@growth-os/contracts';
import { call } from '../../../src/platform/testing';
import { analyticsCount, drain, pass, send, taskSet } from '../support';
import {
  createCalls,
  expectNoJiraDuplicates,
  jiraHarness,
  jiraIssues,
  jiraPilotScenario,
  setJiraFaults,
  type JiraHarness,
} from './support';

let h: JiraHarness;

beforeAll(async () => {
  h = await jiraHarness();
});
afterAll(async () => {
  await h.close();
});

describe('Jira Cloud · timeout after success', () => {
  it('step 24: Checking → reconcile by key → Confirmed; exactly one issue for the task', async () => {
    const p = await jiraPilotScenario(h);
    setJiraFaults(h, [{ mode: 'timeout_after_success', match: { titleContains: 'Install monitoring' } }]);
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
    // The issue exists in Jira although we do not know its key yet.
    expect(jiraIssues(h)).toHaveLength(6);

    // A retry click while Checking does nothing: only failed tasks are retried.
    const retry = await call(h.t.app, API.taskSync.retry, {
      params: { id: p.taskSetId },
      body: {},
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(retry.statusCode).toBe(409);

    const searchesBefore = h.mock.calls.filter((c) => c.op === 'search').length;
    const second = await pass(h, p.s); // outbox.reconcile
    expect(second).toEqual([
      { status: 'confirmed', externalKey: expect.stringMatching(/^PIL-\d+$/), errorCode: null },
    ]);
    const view = await taskSet(h, p.jonas, p.taskSetId);
    expect(view.summaryText).toBe('6 of 6 tasks confirmed in Jira');
    const issues = jiraIssues(h);
    expect(issues).toHaveLength(6);
    expect(view.tasks.find((t) => t.ordinal === 2)!.sync.externalKey).toBe(
      issues.find((i) => i.title === 'Install monitoring at 4 sites')!.key,
    );
    expectNoJiraDuplicates(h);
    // The reconcile searched (JQL) and confirmed the property; it never created again.
    expect(createCalls(h)).toBe(6);
    expect(h.mock.calls.filter((c) => c.op === 'search').length - searchesBefore).toBe(1);
    expect(await analyticsCount(h, p.s, 'external_task_confirmed')).toBe(6);
    expect(await analyticsCount(h, p.s, 'external_task_failed')).toBe(0);
  });

  it('5xx and 429 back off and retry with the same key (reconcile first) → no duplicates', async () => {
    const p = await jiraPilotScenario(h);
    const base = createCalls(h);
    setJiraFaults(h, [
      { mode: 'http_5xx', match: { nthCall: base + 1 } },
      { mode: 'rate_limited', match: { nthCall: base + 2 } },
      { mode: 'timeout_after_success', match: { nthCall: base + 3 } },
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
    expect(mid.tasks.find((t) => t.ordinal === 2)!.sync).toMatchObject({
      status: 'retry_scheduled',
      lastErrorCode: 'rate_limited',
    });
    await drain(h, p.s);
    expect((await taskSet(h, p.jonas, p.taskSetId)).summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(h.mock.issues('PIL')).toHaveLength(12); // six per scenario so far (one Jira site)
    expectNoJiraDuplicates(h);
  });

  it('5 failed attempts → Failed (retryable); manual retry reconciles first and keeps one issue', async () => {
    const p = await jiraPilotScenario(h);
    setJiraFaults(h, [{ mode: 'http_5xx', match: { titleContains: 'Weekly deployment' }, times: 5 }]);
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
    const retry = await call(h.t.app, API.taskSync.retry, {
      params: { id: p.taskSetId },
      body: { taskIds: [failed.tasks.find((t) => t.ordinal === 4)!.id] },
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(retry.statusCode, retry.body).toBe(202);
    await drain(h, p.s);
    expect((await taskSet(h, p.jonas, p.taskSetId)).summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(h.mock.issues('PIL')).toHaveLength(18);
    expectNoJiraDuplicates(h);
  });
});
