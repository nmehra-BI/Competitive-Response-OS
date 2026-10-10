/**
 * Jira Cloud adapter against the local mock Jira server (no network): idempotency through the issue
 * entity property and label, reconcile by search, preview problem codes, token refresh (before
 * expiry, on 401, with rotation), and the HTTP → ConnectorError mapping table.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { externalTaskIdempotencyKey } from '../index';
import { ConnectorError, type ExternalTaskInput, type TaskConnector } from '../task-connector';
import { createJiraConnector, descriptionDoc, jiraLabel } from './adapter';
import { IDEMPOTENCY_PROPERTY, idempotencyLabel, type JiraConfig } from './config';
import { connectorErrorFor, connectorErrorForTransport, JiraTransportError, retryAfterMs } from './http';
import { startMockJira, type MockJira, type MockJiraOptions } from './mock-server';
import { createMemoryCredentialStore } from './store';
import { authorizedCredential, mockJiraConfig } from './testing';

const OPS = 'operations.lead@aster.example';
const JONAS = 'jonas.klein@aster.example';

let mock: MockJira;
let config: JiraConfig;
let store: ReturnType<typeof createMemoryCredentialStore>;
let c: TaskConnector;

async function setup(opts: MockJiraOptions = {}, cfg: Partial<JiraConfig> = {}) {
  mock = await startMockJira({
    projects: {
      PIL: { name: 'Pilot delivery', issueTypes: ['Task'], notAssignable: [OPS], keyStart: 11 },
      'ME-VAL': { name: 'Validation', issueTypes: ['Task'] },
      LOCKED: { name: 'Locked', issueTypes: ['Task'], permissions: { CREATE_ISSUES: false } },
    },
    unknownUsers: ['nobody@aster.example'],
    holdMs: 400,
    ...opts,
  });
  config = mockJiraConfig(mock, { timeoutMs: 150, ...cfg });
  store = createMemoryCredentialStore(await authorizedCredential(mock, config), ['PIL', 'ME-VAL']);
  c = createJiraConnector({ connectionId: 'c-1', config, store });
}

beforeEach(async () => setup());
afterEach(async () => {
  await mock.close();
});

function input(n: number, over: Partial<ExternalTaskInput> = {}): ExternalTaskInput {
  return {
    idempotencyKey: externalTaskIdempotencyKey({
      tenantId: 't',
      planVersionId: 'p',
      taskId: `task-${n}`,
      connectionId: 'c-1',
      project: 'PIL',
    }),
    project: 'PIL',
    issueType: 'Task',
    title: `Task ${n}`,
    description: 'ME-104 · G2 v3 · requested by Jonas Klein',
    assignee: JONAS,
    dueOn: '2026-12-04',
    labels: ['growth-os', 'ME-104'],
    links: { caseKey: 'ME-104', gateLabel: 'G2 · Snapshot v3', url: '/me/cases/ME-104/pilot' },
    ...over,
  };
}

async function kind(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ConnectorError ? e.kind : `other:${String(e)}`;
  }
}

async function failure(p: Promise<unknown>): Promise<ConnectorError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConnectorError) return e;
    throw e;
  }
  throw new Error('expected a ConnectorError');
}

const creates = () => mock.calls.filter((x) => x.op === 'create').length;

describe('createTask and reconcile', () => {
  it('creates the issue with the key as entity property and label; Jira assigns the key', async () => {
    const ref = await c.createTask(input(1));
    expect(ref).toEqual({ key: 'PIL-11', url: `${mock.siteUrl}/browse/PIL-11` });
    const [issue] = mock.issues('PIL');
    expect(issue!.properties[IDEMPOTENCY_PROPERTY]).toEqual({ key: input(1).idempotencyKey });
    expect(issue!.labels).toEqual(['growth-os', 'ME-104', idempotencyLabel(input(1).idempotencyKey)]);
    expect(issue!.assigneeAccountId).toBe(mock.accountIdOf(JONAS));
    expect(issue!.duedate).toBe('2026-12-04');
    expect(JSON.stringify(issue!.description)).toContain('ME-104 · approved under G2 · Snapshot v3');
    // The property is written in the create request and read back before success; no edit needed
    // (the integration account has Browse, Create and Assign only).
    expect(mock.calls.filter((x) => x.op === 'property_get')).toHaveLength(1);
    expect(mock.calls.filter((x) => x.op === 'property_put')).toHaveLength(0);
  });

  it('is idempotent by key: a repeat finds the issue instead of creating another', async () => {
    const a = await c.createTask(input(1));
    const again = await c.createTask(input(1));
    expect(again).toEqual(a);
    expect(mock.issues()).toHaveLength(1);
    expect(creates()).toBe(1);
    expect(await c.findByIdempotencyKey(input(1).idempotencyKey)).toEqual(a);
    expect(await c.findByIdempotencyKey(input(2).idempotencyKey)).toBeNull();
  });

  it('if Jira drops the property at create, it is set; without Edit issues the label still finds it', async () => {
    await mock.close();
    await setup({ dropCreateProperties: true });
    await c.createTask(input(1));
    expect(mock.issues()[0]!.properties[IDEMPOTENCY_PROPERTY]).toEqual({ key: input(1).idempotencyKey });
    mock.setFaults([{ mode: 'permission_denied', match: { op: 'property_put' } }]);
    const ref = await c.createTask(input(2));
    expect(mock.issues()[1]!.properties[IDEMPOTENCY_PROPERTY]).toBeUndefined();
    expect(await c.findByIdempotencyKey(input(2).idempotencyKey)).toEqual(ref);
    expect(mock.issues()).toHaveLength(2);
  });

  it('concurrent calls for one key create one issue', async () => {
    const refs = await Promise.all([1, 2, 3].map(() => c.createTask(input(5))));
    expect(new Set(refs.map((r) => r.key)).size).toBe(1);
    expect(mock.issues()).toHaveLength(1);
  });

  it('timeout after success → timeout_ambiguous; reconcile finds the issue, no second create', async () => {
    mock.setFaults([{ mode: 'timeout_after_success', match: { titleContains: 'Task 2' } }]);
    expect(await kind(c.createTask(input(2)))).toBe('timeout_ambiguous');
    expect(mock.issues()).toHaveLength(1);
    const found = await c.findByIdempotencyKey(input(2).idempotencyKey);
    expect(found?.key).toBe('PIL-11');
    // A retry of the same key (after reconcile) returns the same issue.
    expect((await c.createTask(input(2))).key).toBe('PIL-11');
    expect(creates()).toBe(1);
  });

  it('reconcile searches the mapped projects by label and confirms the entity property', async () => {
    await c.createTask(input(1));
    await c.findByIdempotencyKey(input(1).idempotencyKey);
    const searches = mock.calls.filter((x) => x.op === 'search');
    expect(searches.length).toBeGreaterThan(0);
    expect(mock.calls.filter((x) => x.op === 'property_get').length).toBeGreaterThan(0);
  });

  it('an issue whose property names another key is not taken as ours', async () => {
    await c.createTask(input(1));
    // Someone copied our label onto another issue by hand: the property disagrees.
    const res = await fetch(
      `${mock.url}/ex/jira/${mock.cloudId}/rest/api/3/issue/PIL-11/properties/${IDEMPOTENCY_PROPERTY}`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${(await store.load())!.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ key: 'someone-else' }),
      },
    );
    expect(res.status).toBe(200);
    expect(await c.findByIdempotencyKey(input(1).idempotencyKey)).toBeNull();
  });

  it('an assignee who is not assignable in the project fails that task only (permission)', async () => {
    const err = await failure(c.createTask(input(2, { assignee: OPS })));
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.kind).toBe('permission_denied');
    expect(err.message).toBe(`assignee ${OPS} is not a member of project PIL`);
    expect(err.retryable).toBe(false);
    expect(await kind(c.createTask(input(3)))).toBe('ok');
    expect(mock.issues().map((i) => i.summary)).toEqual(['Task 3']);
  });

  it('5xx, 429 with Retry-After and 403 map to the typed errors and create nothing', async () => {
    mock.setFaults([
      { mode: 'http_5xx', match: { nthCall: 1 } },
      { mode: 'rate_limited', match: { nthCall: 2 } },
      { mode: 'permission_denied', match: { nthCall: 3 } },
    ]);
    const e1 = await failure(c.createTask(input(1)));
    expect([e1.kind, e1.retryable]).toEqual(['transient', true]);
    const e2 = await failure(c.createTask(input(1)));
    expect([e2.kind, e2.retryAfterMs]).toEqual(['rate_limited', 1000]);
    const e3 = await failure(c.createTask(input(1)));
    expect([e3.kind, e3.retryable]).toEqual(['permission_denied', false]);
    expect(mock.issues()).toHaveLength(0);
    expect((await c.createTask(input(1))).key).toBe('PIL-11');
  });

  it('an unknown project or issue type is a validation error (fix the mapping)', async () => {
    expect(await kind(c.createTask(input(1, { project: 'NOPE' })))).toBe('validation');
    expect(await kind(c.createTask(input(1, { issueType: 'Epic' })))).toBe('validation');
    expect(mock.issues()).toHaveLength(0);
  });

  it('labels with spaces are made Jira-safe', () => {
    expect(jiraLabel(' pilot sites ')).toBe('pilot-sites');
    expect(descriptionDoc(input(1))).toMatchObject({ type: 'doc', version: 1 });
  });
});

describe('tokens', () => {
  it('refreshes before expiry and stores the rotated tokens', async () => {
    const cur = (await store.load())!;
    store.current = { ...cur, expiresAt: new Date(Date.now() + 10_000) };
    await c.createTask(input(1));
    const after = (await store.load())!;
    expect(store.updates).toBe(1);
    expect(after.accessToken).not.toBe(cur.accessToken);
    expect(after.refreshToken).not.toBe(cur.refreshToken);
    expect(mock.liveRefreshTokens()).toBe(1);
  });

  it('refreshes once on a 401 and retries the call', async () => {
    const before = (await store.load())!.accessToken;
    mock.setFaults([{ mode: 'access_token_expired', match: { op: 'search' } }]);
    expect((await c.createTask(input(1))).key).toBe('PIL-11');
    expect((await store.load())!.accessToken).not.toBe(before);
    expect(mock.calls.filter((x) => x.op === 'token').length).toBeGreaterThanOrEqual(1);
  });

  it('concurrent refreshes rotate once (no second use of a spent refresh token)', async () => {
    const cur = (await store.load())!;
    store.current = { ...cur, expiresAt: new Date(Date.now() - 1000) };
    await Promise.all([c.findByIdempotencyKey('a'), c.findByIdempotencyKey('b'), c.health()]);
    expect(store.updates).toBe(1);
    expect((await c.health()).status).toBe('connected');
  });

  it('a revoked grant → token_expired everywhere; health says Expired', async () => {
    mock.setFaults([{ mode: 'token_expired' }]);
    expect(await kind(c.createTask(input(1)))).toBe('token_expired');
    expect(await kind(c.findByIdempotencyKey(input(1).idempotencyKey))).toBe('token_expired');
    expect(await kind(c.preview([input(1)]))).toBe('token_expired');
    const h = await c.health();
    expect(h.status).toBe('expired');
    expect(h.message).toBe('Jira connection expired. Reconnect it or export CSV instead.');
    const err = await failure(c.createTask(input(1)));
    expect(err.connectionLevel).toBe(true);
    expect(mock.issues()).toHaveLength(0);
  });

  it('no stored or a disconnected credential → token_expired', async () => {
    const none = createJiraConnector({
      connectionId: 'c-2',
      config,
      store: createMemoryCredentialStore(null),
    });
    expect(await kind(none.createTask(input(1)))).toBe('token_expired');
    store.current = { ...store.current!, revokedAt: new Date() };
    expect(await kind(c.createTask(input(1)))).toBe('token_expired');
  });
});

describe('preview and health', () => {
  it('checks project, issue type, permissions and assignees without writing', async () => {
    const out = await c.preview([
      input(1),
      input(2, { assignee: OPS }),
      input(3, { assignee: 'nobody@aster.example' }),
      input(4, { assignee: null }),
      input(5, { project: 'NOPE' }),
      input(6, { issueType: 'Epic' }),
      input(7, { project: 'LOCKED' }),
    ]);
    expect(out.map((o) => o.problems)).toEqual([
      [],
      [`assignee ${OPS} is not a member of project PIL`],
      ['assignee nobody@aster.example was not found in Jira'],
      ['no assignee is mapped for "Task 4"'],
      ['project NOPE was not found in Jira'],
      ['issue type Epic is not available in project PIL'],
      ['the integration account cannot create issues in project LOCKED'],
    ]);
    expect(out.map((o) => o.problemCodes ?? [])).toEqual([
      [],
      ['assignee_not_in_project'],
      ['assignee_not_found'],
      [],
      ['project_not_found'],
      ['issue_type_not_found'],
      ['permission_denied'],
    ]);
    expect(out[0]!.fields).toEqual({
      project: 'PIL',
      issueType: 'Task',
      dueOn: '2026-12-04',
      labels: 'growth-os, ME-104',
    });
    expect(mock.issues()).toHaveLength(0);
    expect(mock.calls.some((x) => x.op === 'create' || x.op === 'property_put')).toBe(false);
  });

  it('assignees are matched even when Jira hides email addresses', async () => {
    await mock.close();
    await setup({ hideEmails: true });
    const out = await c.preview([input(1)]);
    expect(out[0]!.problems).toEqual([]);
    await c.createTask(input(1));
    expect(mock.issues()[0]!.assigneeAccountId).toBe(mock.accountIdOf(JONAS));
  });

  it('health: connected; missing permission in a mapped project; unavailable on outage', async () => {
    expect((await c.health()).status).toBe('connected');
    const locked = createJiraConnector({
      connectionId: 'c-1',
      config,
      store: createMemoryCredentialStore((await store.load())!, ['PIL', 'LOCKED']),
    });
    const h = await locked.health();
    expect(h.status).toBe('missing_permission');
    expect(h.message).toBe('The integration account lacks: create issues in LOCKED.');
    mock.setFaults([{ mode: 'http_5xx', match: { op: 'myself' } }]);
    expect((await c.health()).status).toBe('unavailable');
  });
});

describe('HTTP → ConnectorError mapping table', () => {
  const h = (status: number, body: unknown = null, headers: Record<string, string> = {}) => ({
    status,
    body,
    headers: new Headers(headers),
  });
  const d = {
    write: true,
    action: 'create an issue in project PIL',
    project: 'PIL',
    issueType: 'Task',
    assignee: OPS,
  };

  it.each([
    [401, null, {}, 'token_expired'],
    [403, null, {}, 'permission_denied'],
    [404, null, {}, 'validation'],
    [400, { errors: { assignee: 'x' } }, {}, 'permission_denied'],
    [400, { errors: { project: 'x' } }, {}, 'validation'],
    [400, { errors: { issuetype: 'x' } }, {}, 'validation'],
    [400, { errors: { summary: 'x' } }, {}, 'validation'],
    [429, null, { 'retry-after': '7' }, 'rate_limited'],
    [500, null, {}, 'transient'],
    [502, null, {}, 'transient'],
    [503, null, {}, 'transient'],
  ] as const)('%i %j → %s', (status, body, headers, expected) => {
    expect(connectorErrorFor(h(status, body, headers), d).kind).toBe(expected);
  });

  it('429 honours Retry-After (seconds or HTTP date); messages carry no values but keys and fields', () => {
    expect(connectorErrorFor(h(429, null, { 'retry-after': '7' }), d).retryAfterMs).toBe(7000);
    const now = new Date('2026-10-10T10:00:00Z');
    expect(retryAfterMs('Sat, 10 Oct 2026 10:00:30 GMT', now)).toBe(30_000);
    expect(retryAfterMs(null)).toBe(5000);
    expect(retryAfterMs('soon')).toBe(5000);
    expect(connectorErrorFor(h(404), { ...d, issueType: undefined }).message).toBe(
      'Jira project PIL was not found.',
    );
    expect(connectorErrorFor(h(400, { errors: { summary: 'secret text' } }), d).message).toBe(
      'Jira refused to create an issue in project PIL (fields: summary).',
    );
  });

  it('a timeout on a write is ambiguous; on a read it is transient', () => {
    expect(connectorErrorForTransport(new JiraTransportError('timeout'), d).kind).toBe('timeout_ambiguous');
    expect(connectorErrorForTransport(new JiraTransportError('network'), d).kind).toBe('timeout_ambiguous');
    expect(connectorErrorForTransport(new JiraTransportError('timeout'), { ...d, write: false }).kind).toBe(
      'transient',
    );
  });
});
