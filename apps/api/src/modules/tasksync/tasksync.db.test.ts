/**
 * Task-sync endpoints (WS6). Acceptance step 12: Jonas previews the five validation tasks
 * (destination, assignees, permission) and sends them; each shows "Confirmed · VAL-n" only after the
 * simulated Jira returned the key. Plus: idempotent replay, cross-tenant 404, unauthorized roles,
 * agents refused, audit/analytics without restricted text, and dev routes only in AUTH_MODE=dev.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, Task, TaskSet, TaskSyncPreview } from '@growth-os/contracts';
import { createConnectorFactory } from '@growth-os/connectors';
import { createDb, sql, withTenant, type Db } from '@growth-os/db';
import { cases, connections, exp03, gates, people, validationTasks } from '@growth-os/fixtures-aster';
import { processOutboxMessage } from '../../../../worker/src/jobs/outbox';
import { hashToken } from '../../platform/session';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../platform/testing';

let t: TestApp;
let worker: Db;
let a: SeededTenant;
let b: SeededTenant;
const c: Record<string, string> = {};
let freshSet: string;
let freshConnection: string;

const inTenant = <T>(s: SeededTenant, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(t.db, { tenantId: s.tenantId, userId: null, correlationId: 'tasksync-test' }, fn);
const valSet = (s: SeededTenant) =>
  inTenant(
    s,
    async (tx) =>
      (
        await tx
          .selectFrom('platform.task_set')
          .select('id')
          .where('owner_type', '=', 'experiment')
          .where('connection_id', '=', s.id(connections[1].id))
          .executeTakeFirstOrThrow()
      ).id,
  );

/**
 * A fresh validation task set for step 12: a new simulated Jira connection (its ME-VAL project is
 * empty, so keys start at VAL-1) and a new locked experiment under the approved G1, with the five
 * fixture validation tasks.
 */
async function freshValidationSet(s: SeededTenant): Promise<{ setId: string; connectionId: string }> {
  return inTenant(s, async (tx) => {
    const admin = s.user('admin');
    const conn = await tx
      .insertInto('platform.connection')
      .values({
        tenant_id: s.tenantId,
        kind: 'task_tool',
        provider: 'jira_simulated',
        name: 'Jira · project ME-VAL',
        scope_text: 'Create and assign issues',
        used_for: 'Validation tasks',
        status: 'connected',
        config: JSON.stringify({ projectNames: { 'ME-VAL': 'Market validation' } }),
        created_by: admin,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const assignees = Object.fromEntries([people.maya, people.jonas].map((p) => [s.id(p.id), p.email]));
    const mapping = await tx
      .insertInto('platform.connector_mapping')
      .values({
        tenant_id: s.tenantId,
        connection_id: conn.id,
        purpose: 'validation_tasks',
        destination_project: 'ME-VAL',
        issue_type: 'Task',
        assignee_map: JSON.stringify(assignees),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const exp = await tx
      .insertInto('me.experiment')
      .values({
        tenant_id: s.tenantId,
        case_id: s.id(cases[0].id),
        display_key: 'EXP-09',
        title: exp03.title,
        lifecycle: 'locked',
        owner_user_id: s.user('maya'),
        locked_by_gate_request_id: s.id(gates.g1.id),
        locked_at: new Date(),
        created_by: s.user('maya'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const set = await tx
      .insertInto('platform.task_set')
      .values({
        tenant_id: s.tenantId,
        case_id: s.id(cases[0].id),
        owner_type: 'experiment',
        owner_id: exp.id,
        authorizing_gate_request_id: s.id(gates.g1.id),
        connection_id: conn.id,
        mapping_id: mapping.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const v of validationTasks)
      await tx
        .insertInto('platform.task')
        .values({
          tenant_id: s.tenantId,
          case_id: s.id(cases[0].id),
          task_set_id: set.id,
          ordinal: v.ordinal,
          title: v.title,
          function: v.function,
          owner_user_id: s.id(v.ownerId),
          due_on: v.dueOn,
          deliverable: v.deliverable,
        })
        .execute();
    return { setId: set.id, connectionId: conn.id };
  });
}

async function agentCookie(s: SeededTenant): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await inTenant(s, (tx) =>
    tx
      .insertInto('platform.session')
      .values({
        tenant_id: s.tenantId,
        user_id: s.user('analysisAgent'),
        token_hash: hashToken(token),
        auth_method: 'oidc',
        interactive: false,
        expires_at: new Date(Date.now() + 3600_000),
      })
      .execute(),
  );
  return `gos_session=${token}`;
}

async function drain(s: SeededTenant): Promise<void> {
  const deps = { db: worker, connectors: createConnectorFactory({ sim: worker }), backoffMs: () => 0 };
  for (let i = 0; i < 10; i++) {
    const due = await withTenant(
      worker,
      { tenantId: s.tenantId, userId: null, correlationId: 'drain' },
      (tx) =>
        sql<{ id: string }>`
        SELECT m.id FROM platform.outbox_message m
          JOIN platform.external_task_link k ON k.id = m.aggregate_id
          JOIN platform.task tk ON tk.id = k.task_id
         WHERE m.status IN ('pending','checking') ORDER BY tk.ordinal`.execute(tx),
    );
    if (due.rows.length === 0) return;
    for (const r of due.rows) await processOutboxMessage(deps, s.tenantId, r.id);
  }
}

beforeAll(async () => {
  t = await createTestApp();
  worker = createDb('worker', 2);
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  for (const k of ['jonas', 'daniel', 'admin', 'maya', 'elena'] as const)
    c[k] = await login(t.app, a.user(k));
  c.jonasB = await login(t.app, b.user('jonas'));
  c.mayaB = await login(t.app, b.user('maya'));
  ({ setId: freshSet, connectionId: freshConnection } = await freshValidationSet(a));
});
afterAll(async () => {
  await worker.destroy();
  await t.close();
});

describe('step 12: preview and send the validation tasks', () => {
  let previewed: TaskSyncPreview;

  it('preview (dry run) shows destination, assignees and permission, and writes nothing in the tool', async () => {
    const res = await call(t.app, API.taskSync.preview, {
      params: { id: freshSet },
      cookie: c.jonas,
      idempotencyKey: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    previewed = TaskSyncPreview.parse(res.json());
    expect(previewed).toMatchObject({
      taskSetId: freshSet,
      destination: { tool: 'Jira', project: 'ME-VAL', projectName: 'Market validation' },
      willCreate: 5,
      linkText: 'each linked to ME-104 · G1 · Snapshot v1', // D-118: gate and version paired
      assigneesText: 'Matched by directory: Maya Rao, Jonas Klein',
      permissionsText: 'Create and assign issues · as Jonas Klein',
      repeatsText: 'Each task has a fixed reference; retrying never duplicates',
      problems: [],
      connectionStatus: 'connected',
    });
    expect(previewed.items.map((i) => i.title)).toEqual(validationTasks.map((v) => v.title));
    expect(previewed.items[0]!.assignee).toBe(people.maya.email);
    const issues =
      await sql`SELECT 1 FROM sim.external_issue WHERE connection_id = ${freshConnection}`.execute(t.db);
    expect(issues.rows).toHaveLength(0);
    const view = TaskSet.parse(
      (await call(t.app, API.taskSync.get, { params: { id: freshSet }, cookie: c.jonas })).json(),
    );
    expect(view.tasks.every((x) => x.sync.status === 'in_preview')).toBe(true);
    expect(view.summaryText).toBe('5 tasks not sent to Jira');
  });

  it('replays the preview for the same Idempotency-Key', async () => {
    const key = randomUUID();
    const r1 = await call(t.app, API.taskSync.preview, {
      params: { id: freshSet },
      cookie: c.jonas,
      idempotencyKey: key,
    });
    const r2 = await call(t.app, API.taskSync.preview, {
      params: { id: freshSet },
      cookie: c.jonas,
      idempotencyKey: key,
    });
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.json()).toEqual(r1.json());
    previewed = TaskSyncPreview.parse(r1.json());
  });

  it('send → Sending… (no key yet) → "Confirmed · VAL-1…VAL-5" only after the tool returns keys', async () => {
    const key = randomUUID();
    const body = { previewId: previewed.id, previewHash: previewed.contentHash };
    const res = await call(t.app, API.taskSync.send, {
      params: { id: freshSet },
      body,
      cookie: c.jonas,
      idempotencyKey: key,
    });
    expect(res.statusCode, res.body).toBe(202);
    const sending = TaskSet.parse(res.json());
    expect(sending.summaryText).toBe('0 of 5 tasks confirmed in Jira · 5 sending');
    expect(sending.tasks.every((x) => x.sync.status === 'sending' && x.sync.externalKey === null)).toBe(true);
    expect(sending.destinationLabel).toBe('Jira · project ME-VAL · Market validation');
    // Double click with the same key replays: still one outbox row per task.
    const replay = await call(t.app, API.taskSync.send, {
      params: { id: freshSet },
      body,
      cookie: c.jonas,
      idempotencyKey: key,
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const rows = await inTenant(a, (tx) =>
      tx
        .selectFrom('platform.outbox_message')
        .select(['kind', 'aggregate_type', 'aggregate_id', 'authorization_ref', 'actor_user_id', 'status'])
        .where('aggregate_id', 'in', (eb) =>
          eb
            .selectFrom('platform.external_task_link')
            .select('id')
            .where('connection_id', '=', freshConnection),
        )
        .execute(),
    );
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r).toMatchObject({
        kind: 'task.create',
        aggregate_type: 'external_task_link',
        actor_user_id: a.user('jonas'),
        status: 'pending',
      });
      expect((r.authorization_ref as { gateRequestId: string }).gateRequestId).toBe(a.id(gates.g1.id));
    }

    await drain(a);
    const view = TaskSet.parse(
      (await call(t.app, API.taskSync.get, { params: { id: freshSet }, cookie: c.jonas })).json(),
    );
    expect(view.summaryText).toBe('5 of 5 tasks confirmed in Jira');
    expect(view.tasks.map((x) => x.sync.externalKey)).toEqual(['VAL-1', 'VAL-2', 'VAL-3', 'VAL-4', 'VAL-5']);
    expect(view.tasks.every((x) => x.sync.status === 'confirmed' && x.sync.confirmedAt !== null)).toBe(true);
    expect(view.tasks[0]!.sync.externalUrl).toMatch(/\/browse\/VAL-1$/);

    await inTenant(a, async (tx) => {
      const analytics = await tx
        .selectFrom('platform.analytics_event')
        .select(['name', 'props', 'envelope'])
        .where('name', '=', 'external_task_confirmed')
        .execute();
      expect(analytics).toHaveLength(5);
      expect(analytics[0]!.props).toEqual({ attempts: 1 });
      const audit = await tx
        .selectFrom('platform.audit_event')
        .select(['action', 'summary', 'details', 'actor_kind'])
        .where('action', 'like', 'task_sync.%')
        .execute();
      expect(audit.filter((x) => x.action === 'task_sync.confirmed')).toHaveLength(5);
      expect(audit.find((x) => x.action === 'task_sync.requested')).toMatchObject({ actor_kind: 'human' });
      expect(audit.find((x) => x.action === 'task_sync.confirmed')).toMatchObject({ actor_kind: 'system' });
      // Ids, keys and counts only: no task text, deliverables or assignee emails in audit or analytics.
      const text = JSON.stringify({ analytics, audit });
      for (const v of validationTasks) expect(text).not.toContain(v.deliverable);
      expect(text).not.toContain(people.maya.email);
    });
  });

  it('a second send of the same preview finds nothing left to send', async () => {
    const res = await call(t.app, API.taskSync.send, {
      params: { id: freshSet },
      body: { previewId: previewed.id, previewHash: previewed.contentHash },
      cookie: c.jonas,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('seeded validation set: VAL-1…VAL-5 confirmed; retry has nothing to re-send', async () => {
    const id = await valSet(a);
    const view = TaskSet.parse(
      (await call(t.app, API.taskSync.get, { params: { id }, cookie: c.jonas })).json(),
    );
    expect(view.summaryText).toBe('5 of 5 tasks confirmed in Jira');
    expect(view.tasks.map((x) => x.sync.externalKey)).toEqual(['VAL-1', 'VAL-2', 'VAL-3', 'VAL-4', 'VAL-5']);
    expect(view.tasks.map((x) => x.status)).toEqual(['done', 'done', 'done', 'done', 'done']);
    const retry = await call(t.app, API.taskSync.retry, {
      params: { id },
      body: {},
      cookie: c.jonas,
      idempotencyKey: true,
    });
    expect(retry.statusCode).toBe(409);
  });

  it('preview of the pilot set before G2 is approved is refused (no effective approval)', async () => {
    const pilot = await inTenant(
      a,
      async (tx) =>
        (
          await tx
            .selectFrom('platform.task_set')
            .select('id')
            .where('owner_type', '=', 'pilot_plan_version')
            .executeTakeFirstOrThrow()
        ).id,
    );
    const res = await call(t.app, API.taskSync.preview, {
      params: { id: pilot },
      cookie: c.jonas,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'PRECONDITIONS_UNMET' });
  });
});

describe('access', () => {
  it('cross-tenant: another tenant cannot read, preview, send, retry or export (404)', async () => {
    const id = await valSet(a);
    const asB = { params: { id }, cookie: c.jonasB };
    expect((await call(t.app, API.taskSync.get, asB)).statusCode).toBe(404);
    expect((await call(t.app, API.taskSync.preview, { ...asB, idempotencyKey: true })).statusCode).toBe(404);
    expect(
      (
        await call(t.app, API.taskSync.send, {
          ...asB,
          body: { previewId: randomUUID(), previewHash: 'a'.repeat(64) },
          idempotencyKey: true,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call(t.app, API.taskSync.retry, { ...asB, body: {}, idempotencyKey: true })).statusCode,
    ).toBe(404);
    expect((await call(t.app, API.taskSync.exportCsv, asB)).statusCode).toBe(404);
    const faults = await call(t.app, API.dev.setFaults, {
      body: { connectionId: a.id(connections[1].id), rules: [] },
      cookie: c.jonasB,
    });
    expect(faults.statusCode).toBe(404);
    const issues = await call(t.app, API.dev.simulatedIssues, {
      query: { connectionId: a.id(connections[1].id) },
      cookie: c.jonasB,
    });
    expect(issues.statusCode).toBe(404);
  });

  it('unauthorized roles: Daniel reads but cannot preview, send, retry or export (403); admin cannot see the case (404)', async () => {
    const id = await valSet(a);
    expect((await call(t.app, API.taskSync.get, { params: { id }, cookie: c.daniel })).statusCode).toBe(200);
    const preview = await call(t.app, API.taskSync.preview, {
      params: { id },
      cookie: c.daniel,
      idempotencyKey: true,
    });
    expect(preview.statusCode).toBe(403);
    expect(preview.json()).toMatchObject({ code: 'FORBIDDEN' });
    const send = await call(t.app, API.taskSync.send, {
      params: { id },
      body: { previewId: randomUUID(), previewHash: 'a'.repeat(64) },
      cookie: c.daniel,
      idempotencyKey: true,
    });
    expect(send.statusCode).toBe(403);
    expect(
      (
        await call(t.app, API.taskSync.retry, {
          params: { id },
          body: {},
          cookie: c.daniel,
          idempotencyKey: true,
        })
      ).statusCode,
    ).toBe(403);
    expect((await call(t.app, API.taskSync.exportCsv, { params: { id }, cookie: c.daniel })).statusCode).toBe(
      403,
    );
    // Maya owns EXP-03, so she may preview and send its validation tasks (D-098): the retry passes
    // authorization and is refused only because nothing has failed (409).
    expect((await call(t.app, API.taskSync.exportCsv, { params: { id }, cookie: c.maya })).statusCode).toBe(
      200,
    );
    expect(
      (
        await call(t.app, API.taskSync.retry, {
          params: { id },
          body: {},
          cookie: c.maya,
          idempotencyKey: true,
        })
      ).statusCode,
    ).toBe(409);
    expect((await call(t.app, API.taskSync.get, { params: { id }, cookie: c.admin })).statusCode).toBe(404);
    expect((await call(t.app, API.taskSync.get, { params: { id } })).statusCode).toBe(401);
  });

  it('agents and services are refused on send and retry (human only)', async () => {
    const id = await valSet(a);
    const agent = await agentCookie(a);
    const send = await call(t.app, API.taskSync.send, {
      params: { id },
      body: { previewId: randomUUID(), previewHash: 'a'.repeat(64) },
      cookie: agent,
      idempotencyKey: true,
    });
    expect(send.statusCode).toBe(403);
    expect(send.json()).toMatchObject({ code: 'AGENT_IDENTITY_FORBIDDEN' });
    const retry = await call(t.app, API.taskSync.retry, {
      params: { id },
      body: {},
      cookie: agent,
      idempotencyKey: true,
    });
    expect(retry.json()).toMatchObject({ code: 'AGENT_IDENTITY_FORBIDDEN' });
  });

  it('send and retry require an Idempotency-Key (428)', async () => {
    const id = await valSet(a);
    const res = await call(t.app, API.taskSync.retry, { params: { id }, body: {}, cookie: c.jonas });
    expect(res.statusCode).toBe(428);
  });
});

describe('dev simulator routes', () => {
  it('set faults and list issues for the caller’s own connection, audited', async () => {
    const connectionId = a.id(connections[1].id);
    const res = await call(t.app, API.dev.setFaults, {
      body: { connectionId, rules: [{ mode: 'http_5xx', match: { nthCall: 2 }, times: 1 }] },
      cookie: c.jonas,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(API.dev.setFaults.response.parse(res.json())).toEqual({
      rules: [{ mode: 'http_5xx', match: { nthCall: 2 }, times: 1 }],
    });
    const cleared = await call(t.app, API.dev.setFaults, {
      body: { connectionId, rules: [] },
      cookie: c.jonas,
    });
    expect(cleared.json()).toEqual({ rules: [] });
    const issues = await call(t.app, API.dev.simulatedIssues, { query: { connectionId }, cookie: c.jonas });
    expect(issues.statusCode).toBe(200);
    const items = API.dev.simulatedIssues.response.parse(issues.json()).items;
    expect(items.map((i) => i.key)).toEqual(['VAL-1', 'VAL-2', 'VAL-3', 'VAL-4', 'VAL-5']);
    const audit = await inTenant(a, (tx) =>
      tx
        .selectFrom('platform.audit_event')
        .select('action')
        .where('action', '=', 'dev.connector_faults_set')
        .execute(),
    );
    expect(audit).toHaveLength(2);
  });

  it('are absent when AUTH_MODE is not dev (404)', async () => {
    const prod = await createTestApp({ authMode: 'oidc' });
    try {
      const res = await call(prod.app, API.dev.setFaults, {
        body: { connectionId: randomUUID(), rules: [] },
        cookie: c.jonas,
      });
      expect(res.statusCode).toBe(404);
      const list = await call(prod.app, API.dev.simulatedIssues, {
        query: { connectionId: randomUUID() },
        cookie: c.jonas,
      });
      expect(list.statusCode).toBe(404);
    } finally {
      await prod.close();
    }
  });
});

// ---------------------------------------------------------------------------
// S09 "Validation tasks · Draft" (D-113, D-128): tasks.addDraft / editDraft / removeDraft
// ---------------------------------------------------------------------------

/**
 * A fresh, locked validation experiment (window 19 Oct – 13 Nov 2026) under the approved G1, on its own
 * simulated Jira connection (project ME-DRF → keys DRF-n), with the five fixture validation tasks.
 */
async function draftSet(s: SeededTenant): Promise<{ setId: string; connectionId: string }> {
  return inTenant(s, async (tx) => {
    const admin = s.user('admin');
    const conn = await tx
      .insertInto('platform.connection')
      .values({
        tenant_id: s.tenantId,
        kind: 'task_tool',
        provider: 'jira_simulated',
        name: 'Jira · project ME-DRF',
        scope_text: 'Create and assign issues',
        used_for: 'Validation tasks',
        status: 'connected',
        config: JSON.stringify({ projectNames: { 'ME-DRF': 'Draft validation' } }),
        created_by: admin,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const assignees = Object.fromEntries([people.maya, people.jonas].map((p) => [s.id(p.id), p.email]));
    const mapping = await tx
      .insertInto('platform.connector_mapping')
      .values({
        tenant_id: s.tenantId,
        connection_id: conn.id,
        purpose: 'validation_tasks',
        destination_project: 'ME-DRF',
        issue_type: 'Task',
        assignee_map: JSON.stringify(assignees),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const exp = await tx
      .insertInto('me.experiment')
      .values({
        tenant_id: s.tenantId,
        case_id: s.id(cases[0].id),
        display_key: 'EXP-10',
        title: exp03.title,
        lifecycle: 'locked',
        owner_user_id: s.user('maya'),
        locked_by_gate_request_id: s.id(gates.g1.id),
        locked_at: new Date(),
        created_by: s.user('maya'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await tx
      .insertInto('me.experiment_plan_version')
      .values({
        tenant_id: s.tenantId,
        experiment_id: exp.id,
        version: 1,
        is_original: true,
        hypothesis: 'At least 4 of 20 selected sites sign a paid pilot commitment.',
        method: 'Partner-led outreach',
        sample_text: '20 sites',
        sample_size: 20,
        selection_text: 'Selected from the reachable pool',
        nonresponse_note: 'Recorded',
        window_start: '2026-10-19',
        window_end: '2026-11-13',
        budget_amount: '15000.00',
        currency: 'EUR',
        created_by: s.user('maya'),
      })
      .execute();
    const set = await tx
      .insertInto('platform.task_set')
      .values({
        tenant_id: s.tenantId,
        case_id: s.id(cases[0].id),
        owner_type: 'experiment',
        owner_id: exp.id,
        authorizing_gate_request_id: s.id(gates.g1.id),
        connection_id: conn.id,
        mapping_id: mapping.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const v of validationTasks)
      await tx
        .insertInto('platform.task')
        .values({
          tenant_id: s.tenantId,
          case_id: s.id(cases[0].id),
          task_set_id: set.id,
          ordinal: v.ordinal,
          title: v.title,
          function: v.function,
          owner_user_id: s.id(v.ownerId),
          due_on: v.dueOn,
          deliverable: v.deliverable,
        })
        .execute();
    return { setId: set.id, connectionId: conn.id };
  });
}

const getSet = async (id: string, cookie = c.maya) =>
  TaskSet.parse((await call(t.app, API.taskSync.get, { params: { id }, cookie })).json());

const analyticsCount = () =>
  inTenant(a, async (tx) => (await tx.selectFrom('platform.analytics_event').select('id').execute()).length);

const simTitles = async (connectionId: string) =>
  (
    await sql<{
      title: string;
    }>`SELECT title FROM sim.external_issue WHERE connection_id = ${connectionId}`.execute(t.db)
  ).rows.map((r) => r.title);

describe('S09 validation task drafts (D-113, D-128)', () => {
  let setId: string;
  let connectionId: string;
  const newTask = {
    title: 'Call five sites from the reachable pool',
    ownerId: '',
    dueOn: '2026-11-06',
    deliverable: 'Call notes in the shared folder',
  };

  beforeAll(async () => {
    ({ setId, connectionId } = await draftSet(a));
    newTask.ownerId = a.user('jonas');
  });

  it('draftEditable: the experiment owner and case owner may edit; reviewers and the pilot owner may not', async () => {
    expect((await getSet(setId)).draftEditable).toBe(true);
    expect((await getSet(setId, c.daniel)).draftEditable).toBe(false);
    expect((await getSet(setId, c.jonas)).draftEditable).toBe(false);
    expect((await getSet(setId, c.elena)).draftEditable).toBe(false);
  });

  it('adds an unsent task (audited task.created, not material, no analytics); replay is idempotent', async () => {
    const before = await analyticsCount();
    const key = randomUUID();
    const r1 = await call(t.app, API.taskSync.addDraftTask, {
      params: { id: setId },
      body: newTask,
      cookie: c.maya,
      idempotencyKey: key,
    });
    expect(r1.statusCode, r1.body).toBe(201);
    const view = TaskSet.parse(r1.json());
    expect(view.tasks).toHaveLength(6);
    const added = view.tasks.at(-1)!;
    expect(added).toMatchObject({
      ordinal: 6,
      title: newTask.title,
      owner: { id: a.user('jonas') },
      dueOn: '2026-11-06',
      deliverable: newTask.deliverable,
      sync: { status: 'not_sent', externalKey: null },
    });
    expect(view.draftEditable).toBe(true);
    const r2 = await call(t.app, API.taskSync.addDraftTask, {
      params: { id: setId },
      body: newTask,
      cookie: c.maya,
      idempotencyKey: key,
    });
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.json()).toEqual(r1.json());
    expect((await getSet(setId)).tasks).toHaveLength(6);
    const audit = await inTenant(a, (tx) =>
      tx
        .selectFrom('platform.audit_event')
        .select(['action', 'summary', 'details', 'actor_kind'])
        .where('object_id', '=', added.id)
        .execute(),
    );
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'task.created',
        actor_kind: 'human',
        summary: 'Validation task 6 added as a draft (not sent until previewed and sent)',
      }),
    ]);
    expect(JSON.stringify(audit)).not.toContain(newTask.deliverable);
    expect(await analyticsCount()).toBe(before);
    // Not material: no material change is recorded and the G1 approval stays effective.
    const changes = await inTenant(a, (tx) =>
      tx.selectFrom('platform.material_change').select('id').where('object_id', '=', added.id).execute(),
    );
    expect(changes).toHaveLength(0);
  });

  it('refuses a due date outside the experiment window and a non-person owner (400)', async () => {
    const outside = await call(t.app, API.taskSync.addDraftTask, {
      params: { id: setId },
      body: { ...newTask, dueOn: '2026-11-20' },
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(outside.statusCode).toBe(400);
    expect(outside.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      title: 'The due date must be inside the experiment window (2026-10-19 to 2026-11-13).',
    });
    const agentOwner = await call(t.app, API.taskSync.addDraftTask, {
      params: { id: setId },
      body: { ...newTask, ownerId: a.user('analysisAgent') },
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(agentOwner.statusCode).toBe(400);
    expect((await getSet(setId)).tasks).toHaveLength(6);
  });

  it('edits title, owner, due date and deliverable with If-Match (task.updated); a stale version → 412', async () => {
    const set = await getSet(setId);
    const task1 = set.tasks[0]!;
    const res = await call(t.app, API.taskSync.editDraftTask, {
      params: { id: task1.id },
      body: {
        title: 'Select 20 sites for the sample (partner list)',
        ownerId: a.user('jonas'),
        dueOn: '2026-10-21',
        deliverable: 'Sample list with partner region',
      },
      cookie: c.maya,
      ifMatch: task1.rowVersion,
    });
    expect(res.statusCode, res.body).toBe(200);
    const edited = Task.parse(res.json());
    expect(edited).toMatchObject({
      title: 'Select 20 sites for the sample (partner list)',
      owner: { id: a.user('jonas') },
      dueOn: '2026-10-21',
      deliverable: 'Sample list with partner region',
      rowVersion: task1.rowVersion + 1,
    });
    expect(res.headers.etag).toBe(`"${task1.rowVersion + 1}"`);
    const stale = await call(t.app, API.taskSync.editDraftTask, {
      params: { id: task1.id },
      body: { title: 'Older edit' },
      cookie: c.maya,
      ifMatch: task1.rowVersion,
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
    const missing = await call(t.app, API.taskSync.editDraftTask, {
      params: { id: task1.id },
      body: { title: 'No version' },
      cookie: c.maya,
    });
    expect(missing.statusCode).toBe(428);
    const audit = await inTenant(a, (tx) =>
      tx
        .selectFrom('platform.audit_event')
        .select(['action', 'summary', 'details'])
        .where('object_id', '=', task1.id)
        .execute(),
    );
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'task.updated',
        summary: 'Validation task 1 draft edited: title, owner, due date, deliverable (not material)',
      }),
    ]);
    expect(JSON.stringify(audit)).not.toContain('partner region');
  });

  it('removes an unsent task by marking it (kept in history, hidden from the set); a second removal → 409', async () => {
    const set = await getSet(setId);
    const task4 = set.tasks.find((x) => x.ordinal === 4)!;
    const res = await call(t.app, API.taskSync.removeDraftTask, {
      params: { id: task4.id },
      cookie: c.maya,
      ifMatch: task4.rowVersion,
      idempotencyKey: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    const view = TaskSet.parse(res.json());
    expect(view.tasks.map((x) => x.ordinal)).toEqual([1, 2, 3, 5, 6]);
    const row = await inTenant(a, (tx) =>
      tx
        .selectFrom('platform.task')
        .select(['removed_at', 'removed_by', 'title'])
        .where('id', '=', task4.id)
        .executeTakeFirstOrThrow(),
    );
    expect(row.removed_at).not.toBeNull();
    expect(row.removed_by).toBe(a.user('maya'));
    expect(row.title).toBe(task4.title);
    const again = await call(t.app, API.taskSync.removeDraftTask, {
      params: { id: task4.id },
      cookie: c.maya,
      ifMatch: task4.rowVersion + 1,
      idempotencyKey: true,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
    const audit = await inTenant(a, (tx) =>
      tx.selectFrom('platform.audit_event').select('action').where('object_id', '=', task4.id).execute(),
    );
    expect(audit.map((x) => x.action)).toEqual(['task.removed']);
  });

  it('an edit after the preview: the send re-checks and refuses the old preview; the task is "Not sent" again', async () => {
    const preview = TaskSyncPreview.parse(
      (
        await call(t.app, API.taskSync.preview, {
          params: { id: setId },
          cookie: c.maya,
          idempotencyKey: true,
        })
      ).json(),
    );
    expect(preview.willCreate).toBe(5);
    const set = await getSet(setId);
    const task2 = set.tasks.find((x) => x.ordinal === 2)!;
    expect(task2.sync.status).toBe('in_preview');
    const edit = await call(t.app, API.taskSync.editDraftTask, {
      params: { id: task2.id },
      body: { deliverable: 'Fieldwork briefed and script signed off' },
      cookie: c.maya,
      ifMatch: task2.rowVersion,
    });
    expect(edit.statusCode, edit.body).toBe(200);
    expect(Task.parse(edit.json()).sync.status).toBe('not_sent');
    const send = await call(t.app, API.taskSync.send, {
      params: { id: setId },
      body: { previewId: preview.id, previewHash: preview.contentHash },
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(send.statusCode).toBe(409);
    const sending = await inTenant(a, (tx) =>
      tx
        .selectFrom('platform.external_task_link')
        .select('id')
        .where('connection_id', '=', connectionId)
        .where('sync_status', 'not in', ['not_sent', 'in_preview'])
        .execute(),
    );
    expect(sending).toHaveLength(0);
    expect(await simTitles(connectionId)).toHaveLength(0);
  });

  it('preview and send create only the remaining tasks: removed task 4 is never written', async () => {
    const preview = TaskSyncPreview.parse(
      (
        await call(t.app, API.taskSync.preview, {
          params: { id: setId },
          cookie: c.maya,
          idempotencyKey: true,
        })
      ).json(),
    );
    expect(preview.willCreate).toBe(5);
    expect(preview.items.map((i) => i.title)).not.toContain(validationTasks[3]!.title);
    expect(preview.items.map((i) => i.title)).toContain(newTask.title);
    const send = await call(t.app, API.taskSync.send, {
      params: { id: setId },
      body: { previewId: preview.id, previewHash: preview.contentHash },
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(send.statusCode, send.body).toBe(202);
    await drain(a);
    const view = await getSet(setId);
    expect(view.summaryText).toBe('5 of 5 tasks confirmed in Jira');
    expect(view.tasks.map((x) => x.sync.externalKey)).toEqual(['DRF-1', 'DRF-2', 'DRF-3', 'DRF-4', 'DRF-5']);
    const titles = await simTitles(connectionId);
    expect(titles).toHaveLength(5);
    expect(titles).not.toContain(validationTasks[3]!.title);
  });

  it('a sent task is read-only: edit or remove → 409 INVALID_TRANSITION, and the database guard refuses removal', async () => {
    const sent = (await getSet(setId)).tasks[0]!;
    expect(sent.sync.status).toBe('confirmed');
    const edit = await call(t.app, API.taskSync.editDraftTask, {
      params: { id: sent.id },
      body: { title: 'Changed after sending' },
      cookie: c.maya,
      ifMatch: sent.rowVersion,
    });
    expect(edit.statusCode).toBe(409);
    expect(edit.json()).toMatchObject({
      code: 'INVALID_TRANSITION',
      title: 'This task was sent to the task tool and is read-only here.',
    });
    const remove = await call(t.app, API.taskSync.removeDraftTask, {
      params: { id: sent.id },
      cookie: c.maya,
      ifMatch: sent.rowVersion,
      idempotencyKey: true,
    });
    expect(remove.statusCode).toBe(409);
    expect(remove.json()).toMatchObject({
      code: 'INVALID_TRANSITION',
      title: 'A sent task cannot be removed.',
    });
    await expect(
      inTenant(a, (tx) =>
        tx
          .updateTable('platform.task')
          .set({ removed_at: new Date(), removed_by: a.user('maya') })
          .where('id', '=', sent.id)
          .execute(),
      ),
    ).rejects.toThrow(/a sent task cannot be removed/);
  });

  it('a task added after sending is unsent until it is previewed and sent', async () => {
    const add = await call(t.app, API.taskSync.addDraftTask, {
      params: { id: setId },
      body: { ...newTask, title: 'Follow up with non-responding sites' },
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(add.statusCode, add.body).toBe(201);
    const view = TaskSet.parse(add.json());
    expect(view.tasks.at(-1)).toMatchObject({ ordinal: 7, sync: { status: 'not_sent' } });
    expect(view.summary).toMatchObject({ total: 6, confirmed: 5 });
    const preview = TaskSyncPreview.parse(
      (
        await call(t.app, API.taskSync.preview, {
          params: { id: setId },
          cookie: c.maya,
          idempotencyKey: true,
        })
      ).json(),
    );
    expect(preview.items.map((i) => i.title)).toEqual(['Follow up with non-responding sites']);
    const send = await call(t.app, API.taskSync.send, {
      params: { id: setId },
      body: { previewId: preview.id, previewHash: preview.contentHash },
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(send.statusCode, send.body).toBe(202);
    await drain(a);
    const after = await getSet(setId);
    expect(after.summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(after.tasks.at(-1)!.sync.externalKey).toBe('DRF-6');
  });

  it('cross-tenant 404; sponsor, reviewer and pilot owner 403; admin 404; agents refused', async () => {
    const draft = await call(t.app, API.taskSync.addDraftTask, {
      params: { id: setId },
      body: { ...newTask, title: 'Spare task' },
      cookie: c.maya,
      idempotencyKey: true,
    });
    const before = TaskSet.parse(draft.json());
    const spare = before.tasks.at(-1)!;
    const attempts = (cookie: string) => [
      call(t.app, API.taskSync.addDraftTask, {
        params: { id: setId },
        body: newTask,
        cookie,
        idempotencyKey: true,
      }),
      call(t.app, API.taskSync.editDraftTask, {
        params: { id: spare.id },
        body: { title: 'x' },
        cookie,
        ifMatch: spare.rowVersion,
      }),
      call(t.app, API.taskSync.removeDraftTask, {
        params: { id: spare.id },
        cookie,
        ifMatch: spare.rowVersion,
        idempotencyKey: true,
      }),
    ];
    for (const cookie of [c.mayaB!, c.jonasB!, c.admin!])
      for (const r of await Promise.all(attempts(cookie))) {
        expect(r.statusCode, r.body).toBe(404);
        expect(r.json()).toMatchObject({ code: 'NOT_FOUND' });
      }
    for (const cookie of [c.elena!, c.daniel!, c.jonas!])
      for (const r of await Promise.all(attempts(cookie))) {
        expect(r.statusCode, r.body).toBe(403);
        expect(r.json()).toMatchObject({ code: 'FORBIDDEN' });
      }
    const agent = await agentCookie(a);
    for (const r of await Promise.all(attempts(agent))) {
      expect(r.statusCode).toBe(403);
      expect(r.json()).toMatchObject({ code: 'AGENT_IDENTITY_FORBIDDEN' });
    }
    const after = await getSet(setId);
    expect(after.tasks).toHaveLength(before.tasks.length);
    expect(after.tasks.find((x) => x.id === spare.id)).toMatchObject({ title: 'Spare task' });
  });

  it('the pilot task set is not a validation draft (409); once the experiment is cancelled → 409', async () => {
    const pilot = await inTenant(
      a,
      async (tx) =>
        (
          await tx
            .selectFrom('platform.task_set')
            .select('id')
            .where('owner_type', '=', 'pilot_plan_version')
            .executeTakeFirstOrThrow()
        ).id,
    );
    const res = await call(t.app, API.taskSync.addDraftTask, {
      params: { id: pilot },
      body: newTask,
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect((await getSet(pilot)).draftEditable).toBeUndefined();
    await inTenant(a, (tx) =>
      tx
        .updateTable('me.experiment')
        .set({ lifecycle: 'cancelled' })
        .where('display_key', '=', 'EXP-10')
        .execute(),
    );
    const cancelled = await call(t.app, API.taskSync.addDraftTask, {
      params: { id: setId },
      body: newTask,
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(cancelled.statusCode).toBe(409);
    expect(cancelled.json()).toMatchObject({ code: 'PRECONDITIONS_UNMET' });
    expect((await getSet(setId)).draftEditable).toBe(false);
  });
});
