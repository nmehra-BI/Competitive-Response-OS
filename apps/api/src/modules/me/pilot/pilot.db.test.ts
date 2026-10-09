/**
 * Pilot plan and tasks (S11): steps 21–22 (activation blockers listed together, then activation with the
 * task set for WS6), task updates, message drafts, and the scope-change path that invalidates G2.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, type PilotPlanView } from '@growth-os/contracts';
import { pilotTasks } from '@growth-os/fixtures-aster';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';
import {
  activatePilot,
  analyticsFor,
  approveG2,
  auditActions,
  caseStage,
  currentPackage,
  ids,
  inTenant,
  problem,
  type Cookies,
} from '../gates/testkit';

let t: TestApp;
let a: SeededTenant;
let b: SeededTenant;
const k = {} as Cookies;

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  for (const p of ['maya', 'elena', 'daniel', 'jonas', 'priya', 'opsLead'] as const)
    k[p] = await login(t.app, a.user(p));
  k.jonasB = await login(t.app, b.user('jonas'));
});
afterAll(async () => {
  await t.close();
});

const view = async (cookie: string): Promise<PilotPlanView> => {
  const res = await call(t.app, API.pilot.get, { params: { caseRef: 'ME-104' }, cookie });
  expect(res.statusCode).toBe(200);
  return API.pilot.get.response.parse(res.json());
};

function draftTasks(v: PilotPlanView) {
  return v.taskSet!.tasks.map((x) => ({
    id: x.id,
    title: x.title,
    milestoneId: x.milestoneId,
    function: x.function,
    ownerId: x.owner?.id ?? null,
    dependsOnTaskIds: x.dependsOnTaskIds,
    dueOn: x.dueOn,
    dueRule: x.dueRule,
    deliverable: x.deliverable,
    conditionKey: x.conditionKey,
  }));
}

describe('pilot plan before approval', () => {
  it('reads the draft: 6 tasks, milestones, message draft, activation blocked by the stage; 404 cross-tenant', async () => {
    const v = await view(k.jonas);
    expect(v.status).toBe('draft');
    expect(v.baseline).toBeNull();
    expect(v.taskSet!.tasks).toHaveLength(6);
    expect(v.taskSet!.tasks[1]!.dependsOnLabel).toBe('Task 1');
    expect(v.taskSet!.tasks[5]!.dependsOnLabel).toBe('Tasks 4, 5');
    expect(v.draft!.milestones.map((m) => m.name)).toEqual([
      'M1 · Kick-off',
      'M2 · Run and measure',
      'M3 · Review',
    ]);
    expect(v.messageDrafts[0]!.notice).toBe('Draft — not authorized to send');
    expect(v.activationBlockers[0]!.key).toBe('case_stage');
    const other = await call(t.app, API.pilot.get, { params: { caseRef: ids(a).case }, cookie: k.jonasB });
    expect(other.statusCode).toBe(404);
  });

  it('rejects dependency cycles (400) and stale drafts (412); Daniel cannot edit (403)', async () => {
    const v = await view(k.jonas);
    const tasks = draftTasks(v);
    tasks[0]!.dependsOnTaskIds = [tasks[5]!.id];
    const cyc = await call(t.app, API.pilot.saveDraft, {
      params: { caseRef: 'ME-104' },
      body: { tasks },
      cookie: k.jonas,
      ifMatch: v.draft!.rowVersion,
    });
    expect(cyc.statusCode).toBe(400);
    const stale = await call(t.app, API.pilot.saveDraft, {
      params: { caseRef: 'ME-104' },
      body: { tasks: draftTasks(v) },
      cookie: k.jonas,
      ifMatch: 999,
    });
    expect(stale.statusCode).toBe(412);
    const daniel = await call(t.app, API.pilot.saveDraft, {
      params: { caseRef: 'ME-104' },
      body: {},
      cookie: k.daniel,
      ifMatch: v.draft!.rowVersion,
    });
    expect(daniel.statusCode).toBe(403);
  });
});

describe('steps 21–22: activation', () => {
  beforeAll(async () => {
    await approveG2(t, a);
    // Variant: task 2 has no owner.
    const v = await view(k.jonas);
    const tasks = draftTasks(v);
    tasks[1]!.ownerId = null;
    const res = await call(t.app, API.pilot.saveDraft, {
      params: { caseRef: 'ME-104' },
      body: { tasks },
      cookie: k.jonas,
      ifMatch: v.draft!.rowVersion,
    });
    expect(res.statusCode).toBe(200);
  });

  it('step 21: activation is blocked by the unowned task 2 AND the open C1, listed together', async () => {
    expect(await caseStage(t, a)).toBe('pilot_approved');
    const v = await view(k.jonas);
    expect(v.baseline!.statusText).toMatch(/^G2 · Approved with conditions · \d+ \w+$/);
    expect(v.budget!.approved.amount).toBe('120000.00');
    expect(v.activationBlockers.map((x) => x.key)).toEqual(['all_tasks_owned', 'blocking_conditions_met']);
    const res = await call(t.app, API.pilot.activate, {
      params: { caseRef: 'ME-104' },
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(409);
    const p = problem(res.body);
    expect(p.code).toBe('PRECONDITIONS_UNMET');
    expect(p.blockers!.map((x) => x.message)).toEqual([
      `Task 2 · ${pilotTasks[1].title} has no owner`,
      'C1 · Pilot limited to 4 sites as signed by the specialist · open',
    ]);
    expect(await analyticsFor(t, a, 'pilot_activated')).toEqual([]);
  });

  it('only the pilot owner activates (Maya 403); other tenants 404', async () => {
    expect(
      (
        await call(t.app, API.pilot.activate, {
          params: { caseRef: 'ME-104' },
          cookie: k.maya,
          idempotencyKey: true,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(t.app, API.pilot.activate, {
          params: { caseRef: ids(a).case },
          cookie: k.jonasB,
          idempotencyKey: true,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('step 22: assign the owner, mark C1 met → activated, pilot_activated, task set ready for WS6', async () => {
    const v = await view(k.jonas);
    const tasks = draftTasks(v);
    tasks[1]!.ownerId = a.user('opsLead');
    const saved = await call(t.app, API.pilot.saveDraft, {
      params: { caseRef: 'ME-104' },
      body: { tasks },
      cookie: k.jonas,
      ifMatch: v.draft!.rowVersion,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers.etag).toBe(`"${v.draft!.rowVersion + 1}"`);
    const stillC1 = await call(t.app, API.pilot.activate, {
      params: { caseRef: 'ME-104' },
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(problem(stillC1.body).blockers!.map((x) => x.key)).toEqual(['blocking_conditions_met']);
    const c1 = v.conditions.find((x) => x.key === 'C1')!;
    await call(t.app, API.gates.markConditionMet, {
      params: { id: c1.id },
      body: { evidence: 'Signed site list (4 sites)' },
      cookie: k.jonas,
      idempotencyKey: true,
    });
    const res = await call(t.app, API.pilot.activate, {
      params: { caseRef: 'ME-104' },
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(200);
    const out = API.pilot.activate.response.parse(res.json());
    expect(out.status).toBe('active');
    expect(out.draft).toBeNull();
    expect(out.current!.state).toBe('committed');
    expect(out.current!.baselineSnapshotId).toBe(out.baseline!.snapshotId);
    expect(out.activationBlockers).toEqual([]);
    expect(out.taskSet!.summaryText).toBe('6 tasks not sent to Jira');
    expect(await caseStage(t, a)).toBe('pilot_running');
    expect((await analyticsFor(t, a, 'pilot_activated')).map((e) => e.props)).toEqual([{ tasks: 6 }]);
    expect(await auditActions(t, a, out.current!.id)).toContain('pilot.activated');
    // The WS6 contract: task set owned by the committed plan version, authorized by G2, no sends here.
    const set = await inTenant(t, a, (tx) =>
      tx
        .selectFrom('platform.task_set')
        .selectAll()
        .where('id', '=', out.taskSet!.id)
        .executeTakeFirstOrThrow(),
    );
    expect(set).toMatchObject({
      owner_type: 'pilot_plan_version',
      owner_id: out.current!.id,
      authorizing_gate_request_id: ids(a).g2,
    });
    const outbox = await inTenant(t, a, (tx) =>
      tx.selectFrom('platform.outbox_message').select('id').execute(),
    );
    expect(outbox).toEqual([]);
    // Editing an active plan is refused: use a scope change.
    const edit = await call(t.app, API.pilot.saveDraft, {
      params: { caseRef: 'ME-104' },
      body: {},
      cookie: k.jonas,
      ifMatch: 0,
    });
    expect(edit.statusCode).toBe(409);
  });

  it('tasks: the owner updates internal status (If-Match); reports a blocker; others 403; cross-tenant 404', async () => {
    const v = await view(k.jonas);
    const task3 = v.taskSet!.tasks[2]!; // Priya's
    const jonasOnPriya = await call(t.app, API.pilot.updateTask, {
      params: { id: task3.id },
      body: { status: 'in_progress' },
      cookie: k.opsLead,
      ifMatch: task3.rowVersion,
    });
    expect(jonasOnPriya.statusCode).toBe(403);
    const ok = await call(t.app, API.pilot.updateTask, {
      params: { id: task3.id },
      body: { status: 'done', note: 'Adaptation list shared' },
      cookie: k.priya,
      ifMatch: task3.rowVersion,
    });
    expect(ok.statusCode).toBe(200);
    const done = API.pilot.updateTask.response.parse(ok.json());
    expect(done.status).toBe('done');
    expect(done.sync.status).toBe('not_sent');
    expect(await caseStage(t, a)).toBe('pilot_running'); // task completion never passes a gate
    const stale = await call(t.app, API.pilot.updateTask, {
      params: { id: task3.id },
      body: { status: 'in_progress' },
      cookie: k.priya,
      ifMatch: task3.rowVersion,
    });
    expect(stale.statusCode).toBe(412);
    const task2 = v.taskSet!.tasks[1]!;
    const blk = await call(t.app, API.pilot.reportBlocker, {
      params: { id: task2.id },
      body: { text: 'Site 3 has no power at the meter.' },
      cookie: k.opsLead,
      idempotencyKey: true,
    });
    expect(blk.statusCode).toBe(201);
    expect(API.pilot.reportBlocker.response.parse(blk.json()).status).toBe('blocked');
    expect(await auditActions(t, a, task2.id)).toEqual(['task.blocker_reported']);
    const audit = await inTenant(t, a, (tx) =>
      tx
        .selectFrom('platform.audit_event')
        .select(['summary', 'details'])
        .where('object_id', '=', task2.id)
        .execute(),
    );
    expect(JSON.stringify(audit)).not.toContain('no power');
    const cross = await call(t.app, API.pilot.reportBlocker, {
      params: { id: task2.id },
      body: { text: 'x' },
      cookie: k.jonasB,
      idempotencyKey: true,
    });
    expect(cross.statusCode).toBe(404);
  });

  it('message drafts stay drafts (edit → ai_edited); readers cannot edit; cross-tenant 404', async () => {
    const list = await call(t.app, API.pilot.messageDrafts, {
      params: { caseRef: 'ME-104' },
      cookie: k.jonas,
    });
    const d = API.pilot.messageDrafts.response.parse(list.json()).items[0]!;
    // The draft carries its own row version for If-Match (D-068).
    expect(d.rowVersion).toBe(0);
    const ok = await call(t.app, API.pilot.updateMessageDraft, {
      params: { id: d.id },
      body: { body: 'Thank you for joining.' },
      cookie: k.jonas,
      ifMatch: d.rowVersion,
    });
    expect(ok.statusCode).toBe(200);
    const edited = API.pilot.updateMessageDraft.response.parse(ok.json());
    expect(edited).toMatchObject({ origin: 'ai_edited', status: 'draft', rowVersion: 1 });
    // A stale row version is refused (412), never a silent overwrite.
    expect(
      (
        await call(t.app, API.pilot.updateMessageDraft, {
          params: { id: d.id },
          body: { body: 'Stale edit' },
          cookie: k.jonas,
          ifMatch: d.rowVersion,
        })
      ).statusCode,
    ).toBe(412);
    expect(
      (
        await call(t.app, API.pilot.updateMessageDraft, {
          params: { id: d.id },
          body: { body: 'x' },
          cookie: k.daniel,
          ifMatch: 1,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(t.app, API.pilot.updateMessageDraft, {
          params: { id: d.id },
          body: { body: 'x' },
          cookie: k.jonasB,
          ifMatch: 1,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call(t.app, API.pilot.messageDrafts, { params: { caseRef: ids(a).case }, cookie: k.jonasB }))
        .statusCode,
    ).toBe(404);
  });
});

describe('WS6 hand-off: task set shape after activation (WAVE3 §6–§7)', () => {
  it('owner = committed current plan version, authorized by G2, destination set, conditions recorded', async () => {
    const s = await seedTenant(t.db, 'aster-demo');
    await activatePilot(t, s);
    await inTenant(t, s, async (tx) => {
      const plan = await tx
        .selectFrom('me.pilot_plan')
        .selectAll()
        .where('case_id', '=', ids(s).case)
        .executeTakeFirstOrThrow();
      expect(plan.status).toBe('active');
      const version = await tx
        .selectFrom('me.pilot_plan_version')
        .selectAll()
        .where('id', '=', plan.current_version_id!)
        .executeTakeFirstOrThrow();
      expect(version.state).toBe('committed');
      const sets = await tx
        .selectFrom('platform.task_set')
        .selectAll()
        .where('owner_type', '=', 'pilot_plan_version')
        .execute();
      expect(sets).toHaveLength(1);
      const set = sets[0]!;
      expect(set.owner_id).toBe(plan.current_version_id);
      expect(version.task_set_id).toBe(set.id);
      expect(set.authorizing_gate_request_id).toBe(ids(s).g2);
      expect(set.connection_id).not.toBeNull();
      const mapping = await tx
        .selectFrom('platform.connector_mapping')
        .selectAll()
        .where('id', '=', set.mapping_id!)
        .executeTakeFirstOrThrow();
      expect(mapping).toMatchObject({ purpose: 'pilot_tasks', connection_id: set.connection_id });
      const tasks = await tx
        .selectFrom('platform.task')
        .select(['owner_user_id'])
        .where('task_set_id', '=', set.id)
        .execute();
      expect(tasks).toHaveLength(6);
      expect(tasks.every((x) => x.owner_user_id !== null)).toBe(true);
      const conds = await tx
        .selectFrom('platform.condition')
        .select(['key', 'blocks_execution', 'status', 'approval_id'])
        .where('gate_request_id', '=', ids(s).g2)
        .orderBy('key')
        .execute();
      expect(conds.map((c) => [c.key, c.blocks_execution, c.status])).toEqual([
        ['C1', true, 'met'],
        ['C2', false, 'open'],
      ]);
      expect(conds.every((c) => c.approval_id !== null)).toBe(true);
      // No outbox rows are written by WS4b: sending is WS6's.
      expect(await tx.selectFrom('platform.outbox_message').select('id').execute()).toEqual([]);
    });
  });
});

describe('scope change after activation', () => {
  it('invalidates G2, pauses unsent outbox rows, preserves confirmed tasks, case → Pilot approval pending', async () => {
    const s = await seedTenant(t.db, 'aster-demo');
    await activatePilot(t, s);
    const jonas = await login(t.app, s.user('jonas'));
    const daniel = await login(t.app, s.user('daniel'));
    const v = await view(jonas);
    const [t1, t2] = v.taskSet!.tasks;
    // WS6 state: task 1 confirmed (PIL-11), task 2 queued in the outbox (outbox conventions, WAVE3 §6).
    const linkIds = await inTenant(t, s, async (tx) => {
      const conn = v.taskSet!.connectionId!;
      const l1 = await tx
        .insertInto('platform.external_task_link')
        .values({
          tenant_id: s.tenantId,
          task_id: t1!.id,
          connection_id: conn,
          idempotency_key: 'a'.repeat(64),
          sync_status: 'confirmed',
          external_key: 'PIL-11',
          attempts: 1,
          confirmed_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const l2 = await tx
        .insertInto('platform.external_task_link')
        .values({
          tenant_id: s.tenantId,
          task_id: t2!.id,
          connection_id: conn,
          idempotency_key: 'b'.repeat(64),
          sync_status: 'sending',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('platform.outbox_message')
        .values({
          tenant_id: s.tenantId,
          kind: 'task.create',
          aggregate_type: 'external_task_link',
          aggregate_id: l2.id,
          idempotency_key: 'b'.repeat(64),
          payload: JSON.stringify({ taskId: t2!.id }),
          authorization_ref: JSON.stringify({ gateRequestId: ids(s).g2 }),
          correlation_id: randomUUID(),
        })
        .execute();
      return [l1.id, l2.id];
    });
    const no = await call(t.app, API.pilot.requestScopeChange, {
      params: { caseRef: 'ME-104' },
      body: { description: 'x', requestedChanges: {} },
      cookie: daniel,
      idempotencyKey: true,
    });
    expect(no.statusCode).toBe(403);
    const res = await call(t.app, API.pilot.requestScopeChange, {
      params: { caseRef: 'ME-104' },
      body: { description: 'Add a fifth site', requestedChanges: { budgetCeiling: '150000.00' } },
      cookie: jonas,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(201);
    expect(API.pilot.requestScopeChange.response.parse(res.json())).toMatchObject({
      status: 'open',
      gateRequestId: null,
    });
    const g2 = API.gates.get.response.parse(
      (await call(t.app, API.gates.get, { params: { id: ids(s).g2 }, cookie: jonas })).json(),
    );
    expect(g2.status).toBe('invalidated');
    expect(await caseStage(t, s)).toBe('pilot_approval_pending');
    const rows = await inTenant(t, s, (tx) =>
      tx
        .selectFrom('platform.external_task_link')
        .select(['id', 'sync_status', 'external_key'])
        .where('id', 'in', linkIds)
        .orderBy('external_key')
        .execute(),
    );
    expect(rows.find((r) => r.id === linkIds[0])).toMatchObject({
      sync_status: 'confirmed',
      external_key: 'PIL-11',
    });
    expect(rows.find((r) => r.id === linkIds[1])!.sync_status).toBe('paused_approval_changed');
    const outbox = await inTenant(t, s, (tx) =>
      tx.selectFrom('platform.outbox_message').select('status').execute(),
    );
    expect(outbox.map((o) => o.status)).toEqual(['paused']);
    expect((await analyticsFor(t, s, 'approval_invalidated')).map((e) => e.props)).toEqual([
      { gate: 'G2', changeType: 'spend_ceiling_changed' },
    ]);
    const pkg = await currentPackage(t, jonas, ids(s).g2);
    expect(pkg.approvals[0]!.effective).toBe(false);
    expect(pkg.approvals[0]!.invalidation!.reason).toMatch(/^spend ceiling changed on/);
  });
});
