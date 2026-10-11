/**
 * Concurrent retry clicks and racing workers: one issue per key, whatever the interleaving.
 *   - double click with the same Idempotency-Key → one retry (replay or in progress)
 *   - two clicks with different keys at once → one 202, one "nothing to retry"
 *   - two workers dispatching the same row at once → one sends, the other is skipped
 *   - two sends of the same preview → the second finds nothing left to send
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { processOutboxMessage } from '../../../worker/src/jobs/outbox';
import { call } from '../../src/platform/testing';
import {
  dueMessages,
  drain,
  expectNoDuplicates,
  harness,
  OPS_LEAD_EMAIL,
  outboxDeps,
  pilotScenario,
  preview,
  setFaults,
  simIssues,
  taskSet,
  type Harness,
  type PilotScenario,
} from './support';

let h: Harness;
let p: PilotScenario;

beforeAll(async () => {
  h = await harness();
  p = await pilotScenario(h);
});
afterAll(async () => {
  await h.close();
});

const retry = (key: string) =>
  call(h.t.app, API.taskSync.retry, {
    params: { id: p.taskSetId },
    body: {},
    cookie: p.jonas,
    idempotencyKey: key,
  });

describe('concurrent clicks and workers', () => {
  it('two sends of one preview at once: one 202, the other finds nothing left to send', async () => {
    await setFaults(h, p.jonas, p.connectionId, [
      { mode: 'permission_denied', match: { assignee: OPS_LEAD_EMAIL }, times: 1 },
    ]);
    const pv = await preview(h, p.jonas, p.taskSetId);
    const body = { previewId: pv.id, previewHash: pv.contentHash };
    const [a, b] = await Promise.all([
      call(h.t.app, API.taskSync.send, {
        params: { id: p.taskSetId },
        body,
        cookie: p.jonas,
        idempotencyKey: true,
      }),
      call(h.t.app, API.taskSync.send, {
        params: { id: p.taskSetId },
        body,
        cookie: p.jonas,
        idempotencyKey: true,
      }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([202, 409]);
    expect((await dueMessages(h, p.s)).length).toBe(6);
  });

  it('two workers on the same row at once: exactly one call reaches the tool', async () => {
    const [first] = await dueMessages(h, p.s);
    const deps = outboxDeps(h);
    const results = await Promise.all([
      processOutboxMessage(deps, p.s.tenantId, first!),
      processOutboxMessage(deps, p.s.tenantId, first!),
    ]);
    expect(results.filter((r) => r.status === 'confirmed')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'skipped')).toHaveLength(1);
    await drain(h, p.s);
    expect((await taskSet(h, p.jonas, p.taskSetId)).summaryText).toBe(
      '5 of 6 tasks confirmed in Jira · 1 failed (permission)',
    );
  });

  it('double click with one Idempotency-Key retries once', async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([retry(key), retry(key)]);
    const codes = [a.statusCode, b.statusCode].sort();
    // Either the second replays the stored 202, or it arrives while the first is still running.
    expect(codes[0]).toBe(202);
    expect([202, 409]).toContain(codes[1]);
    if (codes[1] === 409)
      expect((a.statusCode === 409 ? a : b).json()).toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
    await drain(h, p.s);
    expect((await taskSet(h, p.jonas, p.taskSetId)).summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(await simIssues(h, p.connectionId)).toHaveLength(6);
  });

  it('two retry clicks with different keys at once: one 202, one "no failed tasks"', async () => {
    const q = await pilotScenario(h);
    await setFaults(h, q.jonas, q.connectionId, [
      { mode: 'permission_denied', match: { assignee: OPS_LEAD_EMAIL }, times: 1 },
    ]);
    const pv = await preview(h, q.jonas, q.taskSetId);
    const sent = await call(h.t.app, API.taskSync.send, {
      params: { id: q.taskSetId },
      body: { previewId: pv.id, previewHash: pv.contentHash },
      cookie: q.jonas,
      idempotencyKey: true,
    });
    expect(sent.statusCode).toBe(202);
    await drain(h, q.s);
    const clicks = await Promise.all(
      [0, 1, 2].map(() =>
        call(h.t.app, API.taskSync.retry, {
          params: { id: q.taskSetId },
          body: {},
          cookie: q.jonas,
          idempotencyKey: true,
        }),
      ),
    );
    const codes = clicks.map((c) => c.statusCode).sort();
    expect(codes).toEqual([202, 409, 409]);
    for (const c of clicks.filter((x) => x.statusCode === 409))
      expect(c.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
    // Racing workers on top of it.
    const due = await dueMessages(h, q.s);
    expect(due).toHaveLength(1);
    const deps = outboxDeps(h);
    await Promise.all([1, 2, 3].map(() => processOutboxMessage(deps, q.s.tenantId, due[0]!)));
    await drain(h, q.s);
    expect((await taskSet(h, q.jonas, q.taskSetId)).summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(await simIssues(h, q.connectionId)).toHaveLength(6);
    await expectNoDuplicates(h, q.connectionId);
  });
});
