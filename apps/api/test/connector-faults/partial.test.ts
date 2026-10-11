/**
 * Acceptance steps 22–23 (WF-07): a permission failure on task 2 leaves "5 of 6 tasks confirmed in
 * Jira · 1 failed (permission)"; after fixing the assignee mapping, "Retry 1 failed task" re-sends
 * only task 2 with the same idempotency key → 6 of 6, and the simulator holds exactly 6 issues.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { call } from '../../src/platform/testing';
import {
  analyticsCount,
  auditActions,
  drain,
  expectNoDuplicates,
  harness,
  inTenant,
  OPS_LEAD_EMAIL,
  pilotScenario,
  send,
  setFaults,
  simIssues,
  taskSet,
  type Harness,
  type PilotScenario,
} from './support';

let h: Harness;
let p: PilotScenario;
let firstKeys: Map<string, string>;

beforeAll(async () => {
  h = await harness();
  p = await pilotScenario(h, { pilCounter: 11 });
});
afterAll(async () => {
  await h.close();
});

describe('partial sync and retry of the failed task only', () => {
  it('step 22: permission fault on task 2 → "5 of 6 tasks confirmed in Jira · 1 failed (permission)"', async () => {
    // The operations lead's account is not a member of project PIL (the rule stays until "fixed").
    await setFaults(h, p.jonas, p.connectionId, [
      { mode: 'permission_denied', match: { assignee: OPS_LEAD_EMAIL }, times: 10 },
    ]);
    const sent = await send(h, p.jonas, p.taskSetId);
    expect(sent.summaryText).toBe('0 of 6 tasks confirmed in Jira · 6 sending');
    // Nothing is confirmed before the tool returns keys.
    expect(sent.tasks.every((t) => t.sync.status === 'sending' && t.sync.externalKey === null)).toBe(true);
    firstKeys = new Map(
      await inTenant(h.t.db, p.s, async (tx) =>
        (
          await tx.selectFrom('platform.external_task_link').select(['task_id', 'idempotency_key']).execute()
        ).map((r) => [r.task_id, r.idempotency_key] as [string, string]),
      ),
    );

    await drain(h, p.s);

    const view = await taskSet(h, p.jonas, p.taskSetId);
    expect(view.summaryText).toBe('5 of 6 tasks confirmed in Jira · 1 failed (permission)');
    expect(view.summary).toEqual({ total: 6, confirmed: 5, failed: 1, pending: 0, paused: 0 });
    const task2 = view.tasks.find((t) => t.ordinal === 2)!;
    expect(task2.sync).toMatchObject({
      status: 'failed',
      externalKey: null,
      lastErrorCode: 'permission_denied',
      lastErrorMessage: `assignee ${OPS_LEAD_EMAIL} is not a member of project PIL`,
      retryable: true,
    });
    for (const t of view.tasks.filter((x) => x.ordinal !== 2)) {
      expect(t.sync.status).toBe('confirmed');
      expect(t.sync.externalKey).toMatch(/^PIL-\d+$/);
    }
    // Internal task status is separate from external sync status (honest sync).
    expect(task2.status).toBe('not_started');
    expect(await analyticsCount(h, p.s, 'external_task_failed')).toBe(1);
    expect(await analyticsCount(h, p.s, 'external_task_confirmed')).toBe(5);
    expect(await simIssues(h, p.connectionId)).toHaveLength(5);
  });

  it('step 23: fix the mapping, "Retry 1 failed task" → 6 of 6 with exactly 6 issues, one per key', async () => {
    // Fix the mapping (admin): the operations lead now maps to an account that is a project member.
    const mappings = await call(h.t.app, API.admin.connections, { cookie: p.admin });
    expect(mappings.statusCode).toBe(200);
    const pil = (
      mappings.json() as { mappings: { id: string; purpose: string; assigneeMap: Record<string, string> }[] }
    ).mappings.find((m) => m.purpose === 'pilot_tasks')!;
    const opsLeadId = p.s.user('opsLead');
    const fixed = await call(h.t.app, API.admin.setMapping, {
      params: { id: pil.id },
      body: {
        connectionId: p.connectionId,
        purpose: 'pilot_tasks',
        destinationProject: 'PIL',
        issueType: 'Task',
        assigneeMap: { ...pil.assigneeMap, [opsLeadId]: 'ops.pilot@aster.example' },
      },
      cookie: p.admin,
      idempotencyKey: true,
    });
    expect(fixed.statusCode, fixed.body).toBe(200);

    const retried = await call(h.t.app, API.taskSync.retry, {
      params: { id: p.taskSetId },
      body: {},
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(retried.statusCode, retried.body).toBe(202);
    const afterRetry = API.taskSync.retry.response.parse(retried.json());
    expect(afterRetry.summaryText).toBe('5 of 6 tasks confirmed in Jira · 1 sending');

    await drain(h, p.s);

    const view = await taskSet(h, p.jonas, p.taskSetId);
    expect(view.summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(
      view.tasks.every((t) => t.sync.status === 'confirmed' && /^PIL-\d+$/.test(t.sync.externalKey!)),
    ).toBe(true);
    const issues = await simIssues(h, p.connectionId);
    expect(issues).toHaveLength(6);
    await expectNoDuplicates(h, p.connectionId);
    // Same keys as the first send; task 2 went to the fixed assignee.
    const keys = await inTenant(h.t.db, p.s, (tx) =>
      tx.selectFrom('platform.external_task_link').select(['task_id', 'idempotency_key']).execute(),
    );
    for (const k of keys) expect(k.idempotency_key).toBe(firstKeys.get(k.task_id));
    expect(issues.find((i) => i.assignee === 'ops.pilot@aster.example')).toBeDefined();
    expect(await analyticsCount(h, p.s, 'external_task_confirmed')).toBe(6);
    expect(await auditActions(h, p.s, 'task_sync.')).toEqual(
      expect.arrayContaining([
        'task_sync.previewed',
        'task_sync.requested',
        'task_sync.failed',
        'task_sync.retried',
      ]),
    );
  });

  it('retry with nothing failed is refused and never re-sends confirmed tasks', async () => {
    const res = await call(h.t.app, API.taskSync.retry, {
      params: { id: p.taskSetId },
      body: {},
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(await simIssues(h, p.connectionId)).toHaveLength(6);
  });
});
