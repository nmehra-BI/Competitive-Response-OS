/**
 * Task-sync endpoints (WS6). Acceptance step 12: Jonas previews the five validation tasks
 * (destination, assignees, permission) and sends them; each shows "Confirmed · VAL-n" only after the
 * simulated Jira returned the key. Plus: idempotent replay, cross-tenant 404, unauthorized roles,
 * agents refused, audit/analytics without restricted text, and dev routes only in AUTH_MODE=dev.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, TaskSet, TaskSyncPreview } from '@growth-os/contracts';
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
  for (const k of ['jonas', 'daniel', 'admin', 'maya'] as const) c[k] = await login(t.app, a.user(k));
  c.jonasB = await login(t.app, b.user('jonas'));
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
      linkText: 'each linked to ME-104 · G1 v1',
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
    // Maya (case owner) may update tasks, so she can export, but she cannot send.
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
    ).toBe(403);
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
