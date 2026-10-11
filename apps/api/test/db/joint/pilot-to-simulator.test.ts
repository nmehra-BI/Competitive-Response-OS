/**
 * Joint test (WS4b → WS6, D-080): acceptance steps 21–23 in one database run with no stand-ins.
 * Elena approves G2 through `gates.decide`; `pilot.activate` refuses an unowned task and the open C1
 * together; after the owner is set and C1 is met, activation creates the task set; Jonas previews and
 * sends through `taskSync.*`; the real outbox worker dispatches to the simulated Jira with a permission
 * fault on task 2; after the mapping is fixed, the retry of the failed task only ends with exactly
 * 6 issues in the simulator, one per idempotency key.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, type PilotPlanView } from '@growth-os/contracts';
import { pilotTasks } from '@growth-os/fixtures-aster';
import { call, login, seedTenant, type SeededTenant } from '../../../src/platform/testing';
import { approveG2, ids, problem } from '../../../src/modules/me/gates/testkit';
import {
  analyticsCount,
  drain,
  expectNoDuplicates,
  harness,
  inTenant,
  OPS_LEAD_EMAIL,
  send,
  setFaults,
  simIssues,
  taskSet,
  type Harness,
} from '../../connector-faults/support';

let h: Harness;
let s: SeededTenant;
const k = {} as Record<'maya' | 'elena' | 'jonas' | 'priya' | 'admin' | 'mayaDemo', string>;
let taskSetId = '';
let connectionId = '';
let firstKeys = new Map<string, string>();

beforeAll(async () => {
  h = await harness();
  s = await seedTenant(h.t.db, 'aster-demo');
  for (const p of ['jonas', 'admin', 'maya'] as const) k[p] = await login(h.t.app, s.user(p));
});
afterAll(async () => {
  await h.close();
});

const view = async (): Promise<PilotPlanView> => {
  const res = await call(h.t.app, API.pilot.get, { params: { caseRef: 'ME-104' }, cookie: k.jonas });
  expect(res.statusCode).toBe(200);
  return API.pilot.get.response.parse(res.json());
};
const saveOwner = async (ordinal: number, ownerId: string | null) => {
  const v = await view();
  const tasks = v.taskSet!.tasks.map((x) => ({
    id: x.id,
    title: x.title,
    milestoneId: x.milestoneId,
    function: x.function,
    ownerId: x.ordinal === ordinal ? ownerId : (x.owner?.id ?? null),
    dependsOnTaskIds: x.dependsOnTaskIds,
    dueOn: x.dueOn,
    dueRule: x.dueRule,
    deliverable: x.deliverable,
    conditionKey: x.conditionKey,
  }));
  const res = await call(h.t.app, API.pilot.saveDraft, {
    params: { caseRef: 'ME-104' },
    body: { tasks },
    cookie: k.jonas,
    ifMatch: v.draft!.rowVersion,
  });
  expect(res.statusCode, res.body).toBe(200);
};
const activate = () =>
  call(h.t.app, API.pilot.activate, { params: { caseRef: 'ME-104' }, cookie: k.jonas, idempotencyKey: true });

describe('steps 21–23: pilot.activate → outbox → simulator (no stand-ins)', () => {
  it('step 21: G2 approved by Elena; activation lists the unowned task 2 and the open C1 together', async () => {
    await approveG2(h.t, s);
    await saveOwner(2, null);
    const res = await activate();
    expect(res.statusCode).toBe(409);
    expect(problem(res.body).blockers!.map((b) => b.message)).toEqual([
      `Task 2 · ${pilotTasks[1].title} has no owner`,
      'C1 · Pilot limited to 4 sites as signed by the specialist · open',
    ]);
  });

  it('step 22a: owner set, C1 met → activated; the task set is authorized by G2 and nothing is sent yet', async () => {
    await saveOwner(2, s.user('opsLead'));
    const c1 = (await view()).conditions.find((c) => c.key === 'C1')!;
    const met = await call(h.t.app, API.gates.markConditionMet, {
      params: { id: c1.id },
      body: { evidence: 'Signed site list (4 sites)' },
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(met.statusCode, met.body).toBeLessThan(300);
    const res = await activate();
    expect(res.statusCode, res.body).toBe(200);
    const out = API.pilot.activate.response.parse(res.json());
    expect(out.status).toBe('active');
    taskSetId = out.taskSet!.id;
    const set = await inTenant(h.t.db, s, (tx) =>
      tx.selectFrom('platform.task_set').selectAll().where('id', '=', taskSetId).executeTakeFirstOrThrow(),
    );
    expect(set).toMatchObject({
      owner_type: 'pilot_plan_version',
      owner_id: out.current!.id,
      authorizing_gate_request_id: ids(s).g2,
    });
    connectionId = set.connection_id!;
    expect((await taskSet(h, k.jonas, taskSetId)).summaryText).toBe('6 tasks not sent to Jira');
    expect(await simIssues(h, connectionId)).toEqual([]);
  });

  it('step 22b: send with a permission fault on task 2 → "5 of 6 tasks confirmed in Jira · 1 failed (permission)"', async () => {
    await setFaults(h, k.jonas, connectionId, [
      { mode: 'permission_denied', match: { assignee: OPS_LEAD_EMAIL }, times: 10 },
    ]);
    const sent = await send(h, k.jonas, taskSetId);
    expect(sent.tasks.every((t) => t.sync.status === 'sending' && t.sync.externalKey === null)).toBe(true);
    firstKeys = new Map(
      await inTenant(h.t.db, s, async (tx) =>
        (
          await tx.selectFrom('platform.external_task_link').select(['task_id', 'idempotency_key']).execute()
        ).map((r) => [r.task_id, r.idempotency_key] as [string, string]),
      ),
    );
    // Outbox rows carry the WS6 convention the expiry timer and materiality rely on.
    const refs = await inTenant(h.t.db, s, (tx) =>
      tx.selectFrom('platform.outbox_message').select(['authorization_ref', 'aggregate_type']).execute(),
    );
    expect(refs).toHaveLength(6);
    for (const r of refs) {
      expect(r.aggregate_type).toBe('external_task_link');
      expect((r.authorization_ref as { gateRequestId: string }).gateRequestId).toBe(ids(s).g2);
    }
    await drain(h, s);
    const v = await taskSet(h, k.jonas, taskSetId);
    expect(v.summaryText).toBe('5 of 6 tasks confirmed in Jira · 1 failed (permission)');
    expect(v.tasks.find((t) => t.ordinal === 2)!.sync).toMatchObject({
      status: 'failed',
      lastErrorCode: 'permission_denied',
    });
    expect(await simIssues(h, connectionId)).toHaveLength(5);
    expect(await analyticsCount(h, s, 'external_task_failed')).toBe(1);
  });

  it('step 23: fix the mapping, retry the failed task only → 6 of 6 and exactly 6 simulator issues', async () => {
    const conns = await call(h.t.app, API.admin.connections, { cookie: k.admin });
    const pil = (
      conns.json() as { mappings: { id: string; purpose: string; assigneeMap: Record<string, string> }[] }
    ).mappings.find((m) => m.purpose === 'pilot_tasks')!;
    const fixed = await call(h.t.app, API.admin.setMapping, {
      params: { id: pil.id },
      body: {
        connectionId,
        purpose: 'pilot_tasks',
        destinationProject: 'PIL',
        issueType: 'Task',
        assigneeMap: { ...pil.assigneeMap, [s.user('opsLead')]: 'ops.pilot@aster.example' },
      },
      cookie: k.admin,
      idempotencyKey: true,
    });
    expect(fixed.statusCode, fixed.body).toBe(200);
    const retried = await call(h.t.app, API.taskSync.retry, {
      params: { id: taskSetId },
      body: {},
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(retried.statusCode, retried.body).toBe(202);
    await drain(h, s);
    const v = await taskSet(h, k.jonas, taskSetId);
    expect(v.summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(v.tasks.every((t) => /^PIL-\d+$/.test(t.sync.externalKey ?? ''))).toBe(true);
    expect(await simIssues(h, connectionId)).toHaveLength(6);
    await expectNoDuplicates(h, connectionId);
    const keys = await inTenant(h.t.db, s, (tx) =>
      tx.selectFrom('platform.external_task_link').select(['task_id', 'idempotency_key']).execute(),
    );
    for (const x of keys) expect(x.idempotency_key).toBe(firstKeys.get(x.task_id));
    expect(await analyticsCount(h, s, 'external_task_confirmed')).toBe(6);
    expect(await analyticsCount(h, s, 'pilot_activated')).toBe(1);
  });
});
