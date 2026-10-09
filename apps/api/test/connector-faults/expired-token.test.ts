/**
 * Expired token (WF-07 failure path): the connection turns Expired, every unsent row for it pauses
 * ("Paused — connection expired"), internal tasks continue, and the CSV export works as the outage
 * fallback. After reconnecting, the sweep resumes the rows (search first) and nothing is duplicated.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, SYNC_STATUS_LABELS } from '@growth-os/contracts';
import { call } from '../../src/platform/testing';
import {
  drain,
  expectNoDuplicates,
  harness,
  inTenant,
  pass,
  pilotScenario,
  preview,
  send,
  setFaults,
  simIssues,
  sweep,
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

describe('expired token', () => {
  it('pauses every unsent task for the connection and marks the connection Expired', async () => {
    await send(h, p.jonas, p.taskSetId);
    // Two tasks go out before the token expires.
    const results = await pass(h, p.s, undefined, 2);
    expect(results.map((r) => r.status)).toEqual(['confirmed', 'confirmed']);
    await setFaults(h, p.jonas, p.connectionId, [{ mode: 'token_expired', match: {}, times: 1 }]);
    const more = await pass(h, p.s);
    expect(more[0]).toMatchObject({ status: 'paused_connector', errorCode: 'token_expired' });
    // Everything else was paused in the same transaction: nothing is due any more.
    expect(more.slice(1).every((r) => r.status === 'skipped')).toBe(true);

    const view = await taskSet(h, p.jonas, p.taskSetId);
    const confirmed = view.tasks.filter((t) => t.sync.status === 'confirmed').length;
    expect(confirmed).toBeGreaterThan(0);
    expect(view.summary.paused).toBe(6 - confirmed);
    expect(view.summaryText).toBe(
      `${confirmed} of 6 tasks confirmed in Jira · ${6 - confirmed} paused — connection expired`,
    );
    const paused = view.tasks.find((t) => t.sync.status === 'paused_connector')!;
    expect(SYNC_STATUS_LABELS[paused.sync.status]).toBe('Paused — connection expired');
    // Internal tasks continue: their own status is untouched and still editable by their owners.
    expect(view.tasks.every((t) => t.status === 'not_started')).toBe(true);
    const conn = await inTenant(h.t.db, p.s, (tx) =>
      tx
        .selectFrom('platform.connection')
        .select('status')
        .where('id', '=', p.connectionId)
        .executeTakeFirstOrThrow(),
    );
    expect(conn.status).toBe('expired');
    expect(await simIssues(h, p.connectionId)).toHaveLength(confirmed);
  });

  it('CSV export works while the connection is expired', async () => {
    const res = await call(h.t.app, API.taskSync.exportCsv, { params: { id: p.taskSetId }, cookie: p.jonas });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="ME-104-tasks.csv"');
    const lines = res.body.trim().split('\r\n');
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe(
      'Task,Title,Milestone,Function,Owner,Assignee,Due,Due rule,Deliverable,Depends on,Condition,Internal status,External status,External key,Reference',
    );
    expect(lines[1]).toMatch(
      /^Task 1,Confirm 4 pilot sites and contacts,M1 · Kick-off · weeks 1–2,sales,Jonas Klein,/,
    );
    expect(res.body).toContain('Paused — connection expired');
    expect(lines.slice(1).every((l) => /,[0-9a-f]{64}$/.test(l))).toBe(true); // fixed reference per task
  });

  it('a preview reports the expired connection; retry is refused while it is expired', async () => {
    const pv = await preview(h, p.jonas, p.taskSetId);
    expect(pv.connectionStatus).toBe('expired');
    expect(pv.willCreate).toBe(0); // everything is already queued or sent
    // Fail one task so there is something to retry, then try while expired.
    await inTenant(h.t.db, p.s, async (tx) => {
      const link = await tx
        .selectFrom('platform.external_task_link')
        .select('id')
        .where('sync_status', '=', 'paused_connector')
        .executeTakeFirstOrThrow();
      await tx
        .updateTable('platform.external_task_link')
        .set({ sync_status: 'failed' })
        .where('id', '=', link.id)
        .execute();
      await tx
        .updateTable('platform.outbox_message')
        .set({ status: 'failed' })
        .where('aggregate_id', '=', link.id)
        .execute();
    });
    const res = await call(h.t.app, API.taskSync.retry, {
      params: { id: p.taskSetId },
      body: {},
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'CONNECTOR_UNAVAILABLE' });
  });

  it('after reconnecting, the sweep resumes paused rows (search first) and ends with one issue per task', async () => {
    await setFaults(h, p.jonas, p.connectionId, []);
    const reconnect = await call(h.t.app, API.admin.reconnect, {
      params: { id: p.connectionId },
      cookie: p.admin,
      idempotencyKey: true,
    });
    expect(reconnect.statusCode, reconnect.body).toBe(200);
    const s = await sweep(h, p.s);
    expect(s.resumed).toBeGreaterThan(0);
    const retry = await call(h.t.app, API.taskSync.retry, {
      params: { id: p.taskSetId },
      body: {},
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
