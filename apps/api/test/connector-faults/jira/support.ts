/**
 * Jira Cloud fault suite support (W4-E5): the same scenarios as `connector-faults/*`, with the
 * seeded task-tool connection switched to `jira_cloud` and authorized through the real OAuth endpoints
 * against the local mock Jira server. The API (preview, send, retry, CSV) and the worker code
 * (`processOutboxMessage`, `sweepOutbox`) build their connectors from the environment exactly as in
 * production (`TASK_CONNECTOR=jira`); nothing in the outbox or task-sync code knows it is Jira.
 */
import { expect } from 'vitest';
import { API, Connection } from '@growth-os/contracts';
import {
  applyJiraEnv,
  consent,
  mockJiraEnv,
  startMockJira,
  type MockJira,
  type MockJiraFault,
  type MockJiraOptions,
} from '@growth-os/connectors/jira-mock';
import { IDEMPOTENCY_PROPERTY } from '@growth-os/connectors';
import { call } from '../../../src/platform/testing';
import {
  harness,
  inTenant,
  OPS_LEAD_EMAIL,
  pilotScenario,
  type Harness,
  type PilotScenario,
} from '../support';

export interface JiraHarness extends Harness {
  mock: MockJira;
  env: Record<string, string>;
}

/** Client timeout short enough for timeout-after-success tests; the mock holds answers longer. */
const TIMEOUT_MS = '400';

export async function jiraHarness(opts: MockJiraOptions = {}): Promise<JiraHarness> {
  const mock = await startMockJira({
    projects: {
      PIL: { name: 'Pilot delivery', issueTypes: ['Task'] },
      'ME-VAL': { name: 'Market validation', issueTypes: ['Task'] },
    },
    holdMs: 1500,
    ...opts,
  });
  const env = mockJiraEnv(mock, { JIRA_TIMEOUT_MS: TIMEOUT_MS });
  const restore = applyJiraEnv(env);
  const h = await harness();
  return {
    ...h,
    mock,
    env,
    async close() {
      await h.close();
      restore();
      await mock.close();
    },
  };
}

/** Admin: authorize the connection as the integration account (consent on the mock, then callback). */
export async function authorizeJira(h: JiraHarness, p: PilotScenario): Promise<Connection> {
  const started = await call(h.t.app, API.admin.authorizeConnection, {
    params: { id: p.connectionId },
    cookie: p.admin,
    idempotencyKey: true,
  });
  expect(started.statusCode, started.body).toBe(201);
  const { code, state } = await consent(
    API.admin.authorizeConnection.response.parse(started.json()).authorizeUrl,
  );
  const done = await call(h.t.app, API.admin.completeAuthorization, {
    params: { id: p.connectionId },
    body: { code, state },
    cookie: p.admin,
    idempotencyKey: true,
  });
  expect(done.statusCode, done.body).toBe(200);
  return Connection.parse(done.json());
}

/**
 * The fault-suite pilot (aster-demo, G2 approved, pilot active) on a Jira Cloud connection: the
 * seeded task-tool connection becomes `jira_cloud` (Expired until authorized), then the admin
 * authorizes it. Mappings (PIL, ME-VAL, assignee emails) are the seeded ones.
 */
export async function jiraPilotScenario(h: JiraHarness): Promise<PilotScenario> {
  const p = await pilotScenario(h);
  await inTenant(h.t.db, p.s, (tx) =>
    tx
      .updateTable('platform.connection')
      .set({ provider: 'jira_cloud', status: 'expired', config: JSON.stringify({ siteUrl: h.mock.siteUrl }) })
      .where('id', '=', p.connectionId)
      .execute(),
  );
  const c = await authorizeJira(h, p);
  expect(c.status).toBe('connected');
  return p;
}

export function setJiraFaults(h: JiraHarness, rules: MockJiraFault[]): void {
  h.mock.setFaults(rules);
}

/** Issues the mock holds in one project, in creation order. */
export function jiraIssues(h: JiraHarness, project = 'PIL') {
  return h.mock.issues(project).map((i) => ({
    key: i.key,
    title: i.summary,
    assignee: i.assigneeAccountId,
    idempotencyKey: (i.properties[IDEMPOTENCY_PROPERTY] as { key?: string } | undefined)?.key ?? null,
  }));
}

/** The release-gate invariant on Jira: one issue per idempotency key, each carrying its key. */
export function expectNoJiraDuplicates(h: JiraHarness): void {
  const issues = h.mock.issues();
  const keys = issues.map((i) => (i.properties[IDEMPOTENCY_PROPERTY] as { key?: string } | undefined)?.key);
  expect(keys.every((k) => typeof k === 'string' && k.length === 64)).toBe(true);
  expect(new Set(keys).size).toBe(issues.length);
  expect(new Set(issues.map((i) => i.key)).size).toBe(issues.length);
}

export const createCalls = (h: JiraHarness) => h.mock.calls.filter((c) => c.op === 'create').length;

export { OPS_LEAD_EMAIL };
