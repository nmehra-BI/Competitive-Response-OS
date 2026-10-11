/**
 * Shared setup for the connector fault suite (WS6). Each suite seeds its own isolated `aster-demo`
 * tenant, approves G2 v3 through the real approval guard (Elena, own interactive session, grant)
 * and activates the pilot the way WS4b's `pilot.activate` hands over (WAVE3 §7): plan version
 * committed and current, C1 met, case Pilot running, task set owned by that plan version and
 * authorized by G2. Then it drives the real API (preview, send, retry) and the real worker code
 * (`processOutboxMessage`, `sweepOutbox`) against the simulated tool in the `sim` schema.
 */
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { API, TaskSet, TaskSyncPreview, type SimFaultRule } from '@growth-os/contracts';
import { createConnectorFactory, type ConnectorFactory, type ExternalTaskInput } from '@growth-os/connectors';
import { createDb, sql, withTenant, type Db, type Tx } from '@growth-os/db';
import { authorityGrants, cases, gates, people } from '@growth-os/fixtures-aster';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../src/platform/testing';
import {
  processOutboxMessage,
  sweepOutbox,
  type OutboxDeps,
  type ProcessResult,
} from '../../../worker/src/jobs/outbox';

export interface Harness {
  t: TestApp;
  worker: Db;
  close(): Promise<void>;
}

export async function harness(): Promise<Harness> {
  const t = await createTestApp();
  const worker = createDb('worker', 4);
  return {
    t,
    worker,
    async close() {
      await worker.destroy();
      await t.close();
    },
  };
}

export const inTenant = <T>(db: Db, s: SeededTenant, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withTenant(db, { tenantId: s.tenantId, userId: null, correlationId: 'connector-faults' }, fn);

export interface PilotScenario {
  s: SeededTenant;
  caseId: string;
  g2Id: string;
  approvalId: string;
  taskSetId: string;
  connectionId: string;
  jonas: string;
  admin: string;
}

/** aster-demo + G2 approved (with conditions) by Elena + pilot activated (WS4b hand-off shape). */
export async function pilotScenario(h: Harness, opts: { pilCounter?: number } = {}): Promise<PilotScenario> {
  const s = await seedTenant(h.t.db, 'aster-demo');
  const g2Id = s.id(gates.g2.id);
  const caseId = s.id(cases[0].id);
  const elena = s.user('elena');
  const jonasId = s.user('jonas');
  const out = await inTenant(h.t.db, s, async (tx) => {
    const gate = await tx
      .selectFrom('platform.gate_request as g')
      .innerJoin('platform.decision_snapshot as d', 'd.id', 'g.current_snapshot_id')
      .select(['d.id as snapshot_id', 'd.content_hash'])
      .where('g.id', '=', g2Id)
      .executeTakeFirstOrThrow();
    const sessionId = randomUUID();
    await tx
      .insertInto('platform.session')
      .values({
        id: sessionId,
        tenant_id: s.tenantId,
        user_id: elena,
        token_hash: `test-${sessionId}`,
        auth_method: 'dev_persona',
        interactive: true,
        expires_at: new Date(Date.now() + 3600_000),
      })
      .execute();
    const approval = await tx
      .insertInto('platform.approval')
      .values({
        tenant_id: s.tenantId,
        gate_request_id: g2Id,
        snapshot_id: gate.snapshot_id,
        snapshot_hash: gate.content_hash,
        approver_user_id: elena,
        approver_role: 'sponsor',
        authority_grant_id: s.id(authorityGrants[2].id),
        session_id: sessionId,
        disposition: 'approve_with_conditions',
        rationale: 'Approve pilot €120k · 90 days',
        idempotency_key: `test:${sessionId}`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await tx
      .updateTable('platform.session')
      .set({ revoked_at: new Date() })
      .where('id', '=', sessionId)
      .execute();
    await tx
      .updateTable('platform.gate_request')
      .set({
        status: 'approved_with_conditions',
        decided_at: new Date(),
        expires_at: new Date(Date.now() + 14 * 86_400_000),
      })
      .where('id', '=', g2Id)
      .execute();
    // Conditions recorded with the decision (C1 blocks execution, C2 monitor); C1 met before activation.
    for (const c of gates.g2.conditions)
      await tx
        .insertInto('platform.condition')
        .values({
          tenant_id: s.tenantId,
          gate_request_id: g2Id,
          approval_id: approval.id,
          key: c.key,
          text: c.text,
          owner_user_id: s.id(c.ownerId),
          due_on: c.dueOn,
          due_rule: c.dueRule,
          blocks_execution: c.blocksExecution,
          added_by: elena,
          ...(c.blocksExecution
            ? { status: 'met', met_evidence: 'Site list signed', met_by: jonasId, met_at: new Date() }
            : {}),
        })
        .execute();
    const set = await tx
      .selectFrom('platform.task_set')
      .select(['id', 'owner_id', 'connection_id'])
      .where('case_id', '=', caseId)
      .where('owner_type', '=', 'pilot_plan_version')
      .executeTakeFirstOrThrow();
    await tx
      .updateTable('me.pilot_plan_version')
      .set({ state: 'committed', committed_at: new Date() })
      .where('id', '=', set.owner_id)
      .execute();
    await tx
      .updateTable('me.pilot_plan')
      .set({
        current_version_id: set.owner_id,
        draft_version_id: null,
        status: 'active',
        activated_at: new Date(),
        activated_by: jonasId,
      })
      .where('case_id', '=', caseId)
      .execute();
    await tx
      .updateTable('platform.workflow_case')
      .set({ stage: 'pilot_running' })
      .where('id', '=', caseId)
      .execute();
    return { approvalId: approval.id, taskSetId: set.id, connectionId: set.connection_id! };
  });
  if (opts.pilCounter)
    await sql`INSERT INTO sim.project_counter (connection_id, project, next_value)
              VALUES (${out.connectionId}, 'PIL', ${opts.pilCounter})`.execute(h.t.db);
  return {
    s,
    caseId,
    g2Id,
    ...out,
    jonas: await login(h.t.app, jonasId),
    admin: await login(h.t.app, s.user('admin')),
  };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export async function setFaults(
  h: Harness,
  cookie: string,
  connectionId: string,
  rules: SimFaultRule[],
): Promise<void> {
  const res = await call(h.t.app, API.dev.setFaults, { body: { connectionId, rules }, cookie });
  expect(res.statusCode, res.body).toBe(200);
}

export async function preview(h: Harness, cookie: string, taskSetId: string): Promise<TaskSyncPreview> {
  const res = await call(h.t.app, API.taskSync.preview, {
    params: { id: taskSetId },
    cookie,
    idempotencyKey: true,
  });
  expect(res.statusCode, res.body).toBe(201);
  return TaskSyncPreview.parse(res.json());
}

export async function send(h: Harness, cookie: string, taskSetId: string): Promise<TaskSet> {
  const p = await preview(h, cookie, taskSetId);
  const res = await call(h.t.app, API.taskSync.send, {
    params: { id: taskSetId },
    body: { previewId: p.id, previewHash: p.contentHash },
    cookie,
    idempotencyKey: true,
  });
  expect(res.statusCode, res.body).toBe(202);
  return TaskSet.parse(res.json());
}

export async function taskSet(h: Harness, cookie: string, taskSetId: string): Promise<TaskSet> {
  const res = await call(h.t.app, API.taskSync.get, { params: { id: taskSetId }, cookie });
  expect(res.statusCode, res.body).toBe(200);
  return TaskSet.parse(res.json());
}

// ---------------------------------------------------------------------------
// Worker helpers
// ---------------------------------------------------------------------------

export function outboxDeps(h: Harness, over: Partial<OutboxDeps> = {}): OutboxDeps {
  return {
    db: h.worker,
    connectors: createConnectorFactory({ sim: h.worker }),
    backoffMs: () => 0,
    ...over,
  };
}

/** Due outbox rows of the tenant, in task order. */
export async function dueMessages(h: Harness, s: SeededTenant): Promise<string[]> {
  return inTenant(h.worker, s, async (tx) => {
    const r = await sql<{ id: string }>`
      SELECT m.id FROM platform.outbox_message m
        JOIN platform.external_task_link k ON k.id = m.aggregate_id
        JOIN platform.task t ON t.id = k.task_id
       WHERE m.status IN ('pending','checking') AND m.next_attempt_at <= now()
       ORDER BY t.ordinal`.execute(tx);
    return r.rows.map((row) => row.id);
  });
}

/** Run the dispatcher over every due row once (one worker pass, in task order). */
export async function pass(
  h: Harness,
  s: SeededTenant,
  deps = outboxDeps(h),
  limit = Infinity,
): Promise<ProcessResult[]> {
  const out: ProcessResult[] = [];
  for (const id of (await dueMessages(h, s)).slice(0, limit))
    out.push(await processOutboxMessage(deps, s.tenantId, id));
  return out;
}

/** Passes until nothing is due (bounded). */
export async function drain(h: Harness, s: SeededTenant, deps = outboxDeps(h), max = 12): Promise<void> {
  for (let i = 0; i < max; i++) if ((await pass(h, s, deps)).length === 0) return;
  throw new Error('outbox did not drain');
}

export async function sweep(h: Harness, s: SeededTenant, deps = outboxDeps(h)) {
  return sweepOutbox(deps, { tenantIds: [s.tenantId] });
}

// ---------------------------------------------------------------------------
// Simulator inspection
// ---------------------------------------------------------------------------

/** Issues in one project of the simulated tool (the seeded connection also holds VAL-1…5 in ME-VAL). */
export async function simIssues(
  h: Harness,
  connectionId: string,
  project = 'PIL',
): Promise<{ key: string; idempotency_key: string; title: string; assignee: string | null }[]> {
  const r = await sql<{ key: string; idempotency_key: string; title: string; assignee: string | null }>`
    SELECT key, idempotency_key, title, assignee FROM sim.external_issue
     WHERE connection_id = ${connectionId} AND project = ${project} ORDER BY created_at, key`.execute(h.t.db);
  return r.rows;
}

/** The release-gate invariant: at most one external issue per idempotency key (whole connection). */
export async function expectNoDuplicates(h: Harness, connectionId: string): Promise<void> {
  const r = await sql<{ key: string; idempotency_key: string }>`
    SELECT key, idempotency_key FROM sim.external_issue WHERE connection_id = ${connectionId}`.execute(
    h.t.db,
  );
  const issues = r.rows;
  expect(new Set(issues.map((i) => i.idempotency_key)).size).toBe(issues.length);
  expect(new Set(issues.map((i) => i.key)).size).toBe(issues.length);
}

export async function analyticsCount(h: Harness, s: SeededTenant, name: string): Promise<number> {
  return inTenant(h.t.db, s, async (tx) => {
    const r = await tx.selectFrom('platform.analytics_event').select('id').where('name', '=', name).execute();
    return r.length;
  });
}

export async function auditActions(h: Harness, s: SeededTenant, prefix: string): Promise<string[]> {
  return inTenant(h.t.db, s, async (tx) => {
    const r = await tx
      .selectFrom('platform.audit_event')
      .select('action')
      .where('action', 'like', `${prefix}%`)
      .orderBy('occurred_at')
      .execute();
    return r.map((a) => a.action);
  });
}

export const OPS_LEAD_EMAIL = people.opsLead.email;

/** Wrap a factory so `createTask` performs the write and then "crashes" before anything is recorded. */
export function crashingAfterCreate(
  base: ConnectorFactory,
  crashOn: (i: ExternalTaskInput) => boolean,
): ConnectorFactory {
  return (conn) => {
    const c = base(conn);
    return {
      ...c,
      async createTask(input) {
        const ref = await c.createTask(input);
        if (crashOn(input)) throw new Error('worker process died mid-send');
        return ref;
      },
    };
  };
}
