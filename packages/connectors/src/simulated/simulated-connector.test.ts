/** Simulated task tool over the in-memory store: every fault mode, idempotency, key allocation. */
import { describe, expect, it } from 'vitest';
import { ConnectorError, type ExternalTaskInput } from '../task-connector';
import { externalTaskIdempotencyKey } from '../index';
import { issueKeyPrefix } from './faults';
import { createMemorySimStore } from './memory-store';
import { createSimulatedConnector } from './simulated-connector';

const CONN = 'conn-1';

function input(n: number, over: Partial<ExternalTaskInput> = {}): ExternalTaskInput {
  return {
    idempotencyKey: externalTaskIdempotencyKey({
      tenantId: 't',
      planVersionId: 'p',
      taskId: `task-${n}`,
      connectionId: CONN,
      project: 'PIL',
    }),
    project: 'PIL',
    issueType: 'Task',
    title: `Task ${n}`,
    description: 'ME-104 · G2 v4',
    assignee: 'jonas.klein@aster.example',
    dueOn: '2026-12-04',
    labels: ['growth-os', 'ME-104'],
    links: { caseKey: 'ME-104', gateLabel: 'G2 v4', url: '/me/cases/ME-104' },
    ...over,
  };
}

async function kind(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ConnectorError ? e.kind : 'other';
  }
}

describe('simulated connector', () => {
  it('creates Jira-like keys per project and is idempotent by key', async () => {
    const store = createMemorySimStore();
    const c = createSimulatedConnector(CONN, store);
    const a = await c.createTask(input(1));
    const b = await c.createTask(input(2));
    const again = await c.createTask(input(1));
    expect([a.key, b.key, again.key]).toEqual(['PIL-1', 'PIL-2', 'PIL-1']);
    expect(store.issues).toHaveLength(2);
    expect(await c.findByIdempotencyKey(input(2).idempotencyKey)).toEqual(b);
    expect(await c.findByIdempotencyKey('missing')).toBeNull();
    expect(issueKeyPrefix('ME-VAL')).toBe('VAL');
  });

  it('timeout_after_success creates the issue, then times out ambiguously; reconcile finds it', async () => {
    const store = createMemorySimStore();
    store.addRule(CONN, 'timeout_after_success');
    const c = createSimulatedConnector(CONN, store);
    expect(await kind(c.createTask(input(1)))).toBe('timeout_ambiguous');
    expect(store.issues).toHaveLength(1);
    expect((await c.findByIdempotencyKey(input(1).idempotencyKey))?.key).toBe('PIL-1');
    // The rule is consumed: the next create of the same key returns the same issue.
    expect((await c.createTask(input(1))).key).toBe('PIL-1');
    expect(store.issues).toHaveLength(1);
  });

  it('http_5xx and rate_limited create nothing and are retryable', async () => {
    const store = createMemorySimStore();
    store.addRule(CONN, 'http_5xx');
    store.addRule(CONN, 'rate_limited');
    const c = createSimulatedConnector(CONN, store);
    let err: unknown;
    try {
      await c.createTask(input(1));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConnectorError);
    expect((err as ConnectorError).kind).toBe('transient');
    expect((err as ConnectorError).retryable).toBe(true);
    try {
      await c.createTask(input(1));
    } catch (e) {
      err = e;
    }
    expect((err as ConnectorError).kind).toBe('rate_limited');
    expect((err as ConnectorError).retryAfterMs).toBeGreaterThan(0);
    expect(store.issues).toHaveLength(0);
    expect((await c.createTask(input(1))).key).toBe('PIL-1');
  });

  it('permission_denied matched on the assignee fails that task only', async () => {
    const store = createMemorySimStore();
    store.addRule(CONN, 'permission_denied', { assignee: 'operations.lead@aster.example' }, 5);
    const c = createSimulatedConnector(CONN, store);
    expect(await kind(c.createTask(input(1)))).toBe('ok');
    const err = await c
      .createTask(input(2, { assignee: 'operations.lead@aster.example' }))
      .catch((e: unknown) => e as ConnectorError);
    expect(err).toBeInstanceOf(ConnectorError);
    expect((err as ConnectorError).kind).toBe('permission_denied');
    expect((err as ConnectorError).retryable).toBe(false);
    expect((err as ConnectorError).message).toBe(
      'assignee operations.lead@aster.example is not a member of project PIL',
    );
    expect(await kind(c.createTask(input(3)))).toBe('ok');
    expect(store.issues.map((i) => i.title)).toEqual(['Task 1', 'Task 3']);
  });

  it('token_expired is sticky and connection-level for every operation until cleared', async () => {
    const store = createMemorySimStore();
    store.addRule(CONN, 'token_expired');
    const c = createSimulatedConnector(CONN, store);
    for (let i = 0; i < 3; i++) expect(await kind(c.createTask(input(1)))).toBe('token_expired');
    expect(await kind(c.findByIdempotencyKey('k'))).toBe('token_expired');
    expect(await kind(c.preview([input(1)]))).toBe('token_expired');
    expect((await c.health()).status).toBe('expired');
    const err = await c.createTask(input(1)).catch((e: unknown) => e as ConnectorError);
    expect((err as ConnectorError).connectionLevel).toBe(true);
    store.clearRules(CONN);
    expect((await c.health()).status).toBe('connected');
    expect(await kind(c.createTask(input(1)))).toBe('ok');
  });

  it('matches by title and by the nth create call', async () => {
    const store = createMemorySimStore();
    store.addRule(CONN, 'http_5xx', { titleContains: 'Task 2' });
    store.addRule(CONN, 'http_5xx', { nthCall: 4 });
    const c = createSimulatedConnector(CONN, store);
    const results = [];
    for (const n of [1, 2, 3, 4]) results.push(await kind(c.createTask(input(n))));
    expect(results).toEqual(['ok', 'transient', 'ok', 'transient']);
  });

  it('preview writes nothing and reports unmapped or non-member assignees', async () => {
    const store = createMemorySimStore();
    store.setMembers(CONN, 'PIL', ['jonas.klein@aster.example']);
    const c = createSimulatedConnector(CONN, store);
    const out = await c.preview([
      input(1),
      input(2, { assignee: 'operations.lead@aster.example' }),
      input(3, { assignee: null }),
    ]);
    expect(out.map((o) => o.problems)).toEqual([
      [],
      ['assignee operations.lead@aster.example is not a member of project PIL'],
      ['no assignee is mapped for "Task 3"'],
    ]);
    expect(out[0]!.fields).toMatchObject({ project: 'PIL', issueType: 'Task' });
    expect(store.issues).toHaveLength(0);
  });
});
