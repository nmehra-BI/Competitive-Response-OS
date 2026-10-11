/**
 * Jira Cloud · expired token mid-send (WF-07 failure path, D-104): the customer revokes the grant;
 * the refresh is refused, the connection turns Expired and every unsent task pauses ("Paused —
 * connection expired"); internal tasks continue and the CSV export works. Reconnect cannot revive a
 * revoked grant; the admin authorizes again as the integration account, and only then does the sweep
 * resume the paused rows (search first, send-time re-check) — one issue per task, no duplicates.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, Connection, SYNC_STATUS_LABELS } from '@growth-os/contracts';
import { call } from '../../../src/platform/testing';
import { drain, inTenant, pass, preview, send, sweep, taskSet, type PilotScenario } from '../support';
import {
  authorizeJira,
  expectNoJiraDuplicates,
  jiraHarness,
  jiraIssues,
  jiraPilotScenario,
  setJiraFaults,
  type JiraHarness,
} from './support';

let h: JiraHarness;
let p: PilotScenario;

beforeAll(async () => {
  h = await jiraHarness();
  p = await jiraPilotScenario(h);
});
afterAll(async () => {
  await h.close();
});

const connectionStatus = () =>
  inTenant(h.t.db, p.s, (tx) =>
    tx
      .selectFrom('platform.connection')
      .select('status')
      .where('id', '=', p.connectionId)
      .executeTakeFirstOrThrow(),
  );

describe('Jira Cloud · expired token', () => {
  it('pauses every unsent task for the connection and marks the connection Expired', async () => {
    await send(h, p.jonas, p.taskSetId);
    const results = await pass(h, p.s, undefined, 2);
    expect(results.map((r) => r.status)).toEqual(['confirmed', 'confirmed']);
    setJiraFaults(h, [{ mode: 'token_expired' }]); // the grant is revoked in Atlassian
    const more = await pass(h, p.s);
    expect(more[0]).toMatchObject({ status: 'paused_connector', errorCode: 'token_expired' });
    expect(more.slice(1).every((r) => r.status === 'skipped')).toBe(true);

    const view = await taskSet(h, p.jonas, p.taskSetId);
    expect(view.summaryText).toBe('2 of 6 tasks confirmed in Jira · 4 paused — connection expired');
    const paused = view.tasks.find((t) => t.sync.status === 'paused_connector')!;
    expect(SYNC_STATUS_LABELS[paused.sync.status]).toBe('Paused — connection expired');
    expect(view.tasks.every((t) => t.status === 'not_started')).toBe(true);
    expect((await connectionStatus()).status).toBe('expired');
    expect(jiraIssues(h)).toHaveLength(2);
    // A refresh was tried and refused before giving up (never a silent success).
    expect(h.mock.calls.some((c) => c.op === 'token' && c.status === 403)).toBe(true);
  });

  it('CSV export works while the connection is expired', async () => {
    const res = await call(h.t.app, API.taskSync.exportCsv, { params: { id: p.taskSetId }, cookie: p.jonas });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    const lines = res.body.trim().split('\r\n');
    expect(lines).toHaveLength(7);
    expect(res.body).toContain('Paused — connection expired');
  });

  it('a preview reports the expired connection; reconnect cannot revive a revoked grant', async () => {
    const pv = await preview(h, p.jonas, p.taskSetId);
    expect(pv.connectionStatus).toBe('expired');
    setJiraFaults(h, []);
    const re = await call(h.t.app, API.admin.reconnect, {
      params: { id: p.connectionId },
      cookie: p.admin,
      idempotencyKey: true,
    });
    expect(re.statusCode, re.body).toBe(200);
    expect(Connection.parse(re.json()).status).toBe('expired');
    // Nothing resumes while it is expired.
    const s = await sweep(h, p.s);
    expect(s.resumed).toBe(0);
    expect(jiraIssues(h)).toHaveLength(2);
  });

  it('after a new authorization, the sweep resumes paused rows (search first): one issue per task', async () => {
    const c = await authorizeJira(h, p);
    expect(c.status).toBe('connected');
    const s = await sweep(h, p.s);
    expect(s.resumed).toBeGreaterThan(0);
    await drain(h, p.s);
    expect((await taskSet(h, p.jonas, p.taskSetId)).summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(jiraIssues(h)).toHaveLength(6);
    expectNoJiraDuplicates(h);
  });
});
