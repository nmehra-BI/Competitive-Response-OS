/**
 * Jira Cloud · concurrent retries, racing workers and a crash mid-send: one issue per key whatever
 * the interleaving, and a write whose answer was lost in a crash is reconciled, never repeated.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { sql } from '@growth-os/db';
import { processOutboxMessage } from '../../../../worker/src/jobs/outbox';
import { call } from '../../../src/platform/testing';
import {
  crashingAfterCreate,
  dueMessages,
  drain,
  inTenant,
  outboxDeps,
  preview,
  send,
  sweep,
  taskSet,
} from '../support';
import {
  createCalls,
  expectNoJiraDuplicates,
  jiraHarness,
  jiraIssues,
  jiraPilotScenario,
  OPS_LEAD_EMAIL,
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

describe('Jira Cloud · concurrent clicks and workers', () => {
  it('two workers on one row: one Jira create; double retry clicks retry once; zero duplicates', async () => {
    const p = await jiraPilotScenario(h);
    setJiraFaults(h, [{ mode: 'permission_denied', match: { assignee: OPS_LEAD_EMAIL } }]);
    const pv = await preview(h, p.jonas, p.taskSetId);
    const body = { previewId: pv.id, previewHash: pv.contentHash };
    const [a, b] = await Promise.all(
      [1, 2].map(() =>
        call(h.t.app, API.taskSync.send, {
          params: { id: p.taskSetId },
          body,
          cookie: p.jonas,
          idempotencyKey: true,
        }),
      ),
    );
    expect([a!.statusCode, b!.statusCode].sort()).toEqual([202, 409]);

    const [first] = await dueMessages(h, p.s);
    const deps = outboxDeps(h);
    const before = createCalls(h);
    const results = await Promise.all([
      processOutboxMessage(deps, p.s.tenantId, first!),
      processOutboxMessage(deps, p.s.tenantId, first!),
    ]);
    expect(results.filter((r) => r.status === 'confirmed')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'skipped')).toHaveLength(1);
    expect(createCalls(h) - before).toBe(1);
    await drain(h, p.s);
    expect((await taskSet(h, p.jonas, p.taskSetId)).summaryText).toBe(
      '5 of 6 tasks confirmed in Jira · 1 failed (permission)',
    );

    // The permission fault is spent (the account was fixed in Jira); three clicks at once.
    const key = randomUUID();
    const clicks = await Promise.all(
      [key, key, randomUUID()].map((k) =>
        call(h.t.app, API.taskSync.retry, {
          params: { id: p.taskSetId },
          body: {},
          cookie: p.jonas,
          idempotencyKey: k,
        }),
      ),
    );
    expect(clicks.map((c) => c.statusCode)).toContain(202);
    for (const c of clicks.filter((x) => x.statusCode !== 202))
      expect(['IDEMPOTENCY_IN_PROGRESS', 'INVALID_TRANSITION']).toContain(c.json().code);
    const due = await dueMessages(h, p.s);
    expect(due).toHaveLength(1);
    await Promise.all([1, 2, 3].map(() => processOutboxMessage(deps, p.s.tenantId, due[0]!)));
    await drain(h, p.s);
    expect((await taskSet(h, p.jonas, p.taskSetId)).summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(jiraIssues(h)).toHaveLength(6);
    expectNoJiraDuplicates(h);
  });
});

describe('Jira Cloud · worker crash between create and confirm', () => {
  it('the sweep reclaims the leased row after expiry and reconciles instead of creating again', async () => {
    const p = await jiraPilotScenario(h);
    const startIssues = h.mock.issues().length;
    await send(h, p.jonas, p.taskSetId);
    const [first] = await dueMessages(h, p.s);
    const base = outboxDeps(h);
    const crashing = { ...base, connectors: crashingAfterCreate(base.connectors, () => true) };
    await expect(processOutboxMessage(crashing, p.s.tenantId, first!)).rejects.toThrow('worker process died');
    expect(h.mock.issues().length - startIssues).toBe(1); // the write happened in Jira

    // While the lease holds, nobody touches the row.
    expect(await processOutboxMessage(base, p.s.tenantId, first!)).toEqual({
      status: 'skipped',
      reason: 'status sending',
    });
    await inTenant(h.worker, p.s, (tx) =>
      sql`UPDATE platform.outbox_message SET locked_until = now() - interval '1 second' WHERE id = ${first!}`.execute(
        tx,
      ),
    );
    const creates = createCalls(h);
    const s = await sweep(h, p.s);
    expect(s.recovered).toBe(1);
    const mine = s.processed.find((x) => x.messageId === first)!;
    expect(mine.result).toMatchObject({
      status: 'confirmed',
      externalKey: expect.stringMatching(/^PIL-\d+$/),
    });
    await drain(h, p.s);
    // The recovered task was found by its key, not created again (only the other five were created).
    expect(createCalls(h) - creates).toBe(5);
    expect((await taskSet(h, p.jonas, p.taskSetId)).summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(h.mock.issues().length - startIssues).toBe(6);
    expectNoJiraDuplicates(h);
  });
});
