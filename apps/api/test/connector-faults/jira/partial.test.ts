/**
 * Jira Cloud · acceptance steps 22–23 (WF-07): the operations lead is not assignable in PIL, so task 2
 * fails ("5 of 6 tasks confirmed in Jira · 1 failed (permission)"); after the mapping is fixed,
 * "Retry 1 failed task" re-sends only task 2 with the same idempotency key → 6 of 6, and Jira holds
 * exactly six issues, one per key. Every key comes from Jira's answer.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { call } from '../../../src/platform/testing';
import { analyticsCount, drain, inTenant, send, taskSet, type PilotScenario } from '../support';
import {
  createCalls,
  expectNoJiraDuplicates,
  jiraHarness,
  jiraIssues,
  jiraPilotScenario,
  OPS_LEAD_EMAIL,
  type JiraHarness,
} from './support';

let h: JiraHarness;
let p: PilotScenario;
let firstKeys: Map<string, string>;

beforeAll(async () => {
  h = await jiraHarness({
    projects: {
      PIL: { name: 'Pilot delivery', issueTypes: ['Task'], notAssignable: [OPS_LEAD_EMAIL], keyStart: 11 },
      'ME-VAL': { name: 'Market validation', issueTypes: ['Task'] },
    },
  });
  p = await jiraPilotScenario(h);
});
afterAll(async () => {
  await h.close();
});

describe('Jira Cloud · partial sync and retry of the failed task only', () => {
  it('step 22: the preview names the problem; the send ends "5 of 6 … · 1 failed (permission)"', async () => {
    const pv = await call(h.t.app, API.taskSync.preview, {
      params: { id: p.taskSetId },
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(pv.statusCode, pv.body).toBe(201);
    expect(JSON.stringify(pv.json())).toContain(`assignee ${OPS_LEAD_EMAIL} is not a member of project PIL`);
    expect(h.mock.issues()).toHaveLength(0); // preview writes nothing

    const sent = await send(h, p.jonas, p.taskSetId);
    expect(sent.summaryText).toBe('0 of 6 tasks confirmed in Jira · 6 sending');
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
    const task2 = view.tasks.find((t) => t.ordinal === 2)!;
    expect(task2.sync).toMatchObject({
      status: 'failed',
      externalKey: null,
      lastErrorCode: 'permission_denied',
      lastErrorMessage: `assignee ${OPS_LEAD_EMAIL} is not a member of project PIL`,
      retryable: true,
    });
    const issues = jiraIssues(h);
    expect(issues).toHaveLength(5);
    // "Confirmed · PIL-n" carries exactly the keys Jira returned.
    for (const t of view.tasks.filter((x) => x.ordinal !== 2)) {
      expect(t.sync.status).toBe('confirmed');
      expect(issues.map((i) => i.key)).toContain(t.sync.externalKey);
      expect(t.sync.externalUrl).toBe(`${h.mock.siteUrl}/browse/${t.sync.externalKey}`);
    }
    expect(issues.map((i) => i.key)).toEqual(['PIL-11', 'PIL-12', 'PIL-13', 'PIL-14', 'PIL-15']);
    expect(task2.status).toBe('not_started'); // internal status is separate
    expect(await analyticsCount(h, p.s, 'external_task_failed')).toBe(1);
    expect(await analyticsCount(h, p.s, 'external_task_confirmed')).toBe(5);
    expectNoJiraDuplicates(h);
  });

  it('step 23: fix the mapping, retry → 6 of 6 with exactly six issues and the same keys', async () => {
    const list = await call(h.t.app, API.admin.connections, { cookie: p.admin });
    const pil = API.admin.connections.response
      .parse(list.json())
      .mappings.find((m) => m.purpose === 'pilot_tasks')!;
    const fixed = await call(h.t.app, API.admin.setMapping, {
      params: { id: pil.id },
      body: {
        connectionId: p.connectionId,
        purpose: 'pilot_tasks',
        destinationProject: 'PIL',
        issueType: 'Task',
        assigneeMap: { ...pil.assigneeMap, [p.s.user('opsLead')]: 'ops.pilot@aster.example' },
      },
      cookie: p.admin,
      idempotencyKey: true,
    });
    expect(fixed.statusCode, fixed.body).toBe(200);

    const before = createCalls(h);
    const retried = await call(h.t.app, API.taskSync.retry, {
      params: { id: p.taskSetId },
      body: {},
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(retried.statusCode, retried.body).toBe(202);
    expect(API.taskSync.retry.response.parse(retried.json()).summaryText).toBe(
      '5 of 6 tasks confirmed in Jira · 1 sending',
    );

    await drain(h, p.s);

    const view = await taskSet(h, p.jonas, p.taskSetId);
    expect(view.summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(createCalls(h) - before).toBe(1); // only the failed task was sent again
    const issues = jiraIssues(h);
    expect(issues).toHaveLength(6);
    expectNoJiraDuplicates(h);
    const keys = await inTenant(h.t.db, p.s, (tx) =>
      tx.selectFrom('platform.external_task_link').select(['task_id', 'idempotency_key']).execute(),
    );
    for (const k of keys) expect(k.idempotency_key).toBe(firstKeys.get(k.task_id));
    // Each issue carries the key of one task link of this send (the tenant also has validation links).
    const linkKeys = new Set(keys.map((k) => k.idempotency_key));
    for (const i of issues) expect(linkKeys.has(i.idempotencyKey!)).toBe(true);
    expect(issues.find((i) => i.assignee === h.mock.accountIdOf('ops.pilot@aster.example'))).toBeDefined();
  });

  it('retry with nothing failed is refused and never re-sends confirmed tasks', async () => {
    const res = await call(h.t.app, API.taskSync.retry, {
      params: { id: p.taskSetId },
      body: {},
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(409);
    expect(jiraIssues(h)).toHaveLength(6);
  });
});
