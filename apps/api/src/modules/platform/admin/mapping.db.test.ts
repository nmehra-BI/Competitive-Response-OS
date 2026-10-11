/**
 * S14 task mapping editor (D-114 §1, D-134): "Check with Jira" reads Mapped / Unmapped / Not found from
 * the simulated connector's dry run and writes nothing; a project or issue-type change on a mapping used
 * by an approved, unsent task set shows its impact, is refused until acknowledged, and then runs
 * materiality (`plan_destination_changed`): the G2 approval is invalidated and unsent tasks pause.
 * Assignee edits are not material. Admin only; another tenant's references are not found.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, ConnectorMapping, ConnectorMappingCheck, TaskSyncPreview } from '@growth-os/contracts';
import { createPgSimStore } from '@growth-os/connectors';
import { connections, people } from '@growth-os/fixtures-aster';
import { sql, withTenant } from '@growth-os/db';
import { activatePilot, agentCookie } from '../../me/gates/testkit';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';

let t: TestApp;
let a: SeededTenant;
let b: SeededTenant;
const c: Record<string, string> = {};
let pil: ConnectorMapping;
let pilotSetId: string;

const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'mapping-test' }, fn);

const body = (m: ConnectorMapping, over: Partial<ConnectorMapping> = {}) => ({
  connectionId: m.connectionId,
  purpose: m.purpose,
  destinationProject: m.destinationProject,
  issueType: m.issueType,
  assigneeMap: m.assigneeMap,
  ...over,
});

const check = (b2: ReturnType<typeof body>, cookie = c.admin) =>
  call(t.app, API.admin.checkMapping, { params: { id: pil.id }, body: b2, cookie });

const save = (b2: ReturnType<typeof body> & { acknowledgeMaterialImpact?: boolean }, cookie = c.admin) =>
  call(t.app, API.admin.setMapping, { params: { id: pil.id }, body: b2, cookie, idempotencyKey: true });

const facts = () =>
  inA(async (tx) => ({
    changes: await tx
      .selectFrom('platform.material_change')
      .select(['change_type', 'classification', 'object_type'])
      .where('change_type', '=', 'plan_destination_changed')
      .execute(),
    invalidations: (await tx.selectFrom('platform.approval_invalidation').select('id').execute()).length,
    g2: (
      await tx
        .selectFrom('platform.gate_request')
        .select('status')
        .where('gate_code', '=', 'G2')
        .executeTakeFirstOrThrow()
    ).status,
    links: (
      await tx
        .selectFrom('platform.external_task_link')
        .innerJoin('platform.task', 'platform.task.id', 'platform.external_task_link.task_id')
        .select('platform.external_task_link.sync_status as status')
        .where('platform.task.task_set_id', '=', pilotSetId)
        .execute()
    ).map((r) => r.status),
  }));

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  for (const k of ['admin', 'jonas', 'elena', 'maya'] as const) c[k] = await login(t.app, a.user(k));
  c.adminB = await login(t.app, b.user('admin'));
  const list = await call(t.app, API.admin.connections, { cookie: c.admin });
  pil = API.admin.connections.response.parse(list.json()).mappings.find((m) => m.purpose === 'pilot_tasks')!;
  pilotSetId = await inA(
    async (tx) =>
      (
        await tx
          .selectFrom('platform.task_set')
          .select('id')
          .where('owner_type', '=', 'pilot_plan_version')
          .executeTakeFirstOrThrow()
      ).id,
  );
});
afterAll(() => t.close());

describe('Check with Jira (dry run, no writes)', () => {
  it('reads Mapped, Unmapped and Not found from the simulated connector', async () => {
    const opsLead = a.user('opsLead');
    // The project refuses the operations lead's account (as in journey step 22).
    await createPgSimStore(t.db).setFaultRules(a.id(connections[1].id), [
      { mode: 'permission_denied', match: { assignee: people.opsLead.email }, times: 10 },
    ]);
    const issuesBefore = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM sim.external_issue WHERE connection_id = ${a.id(connections[1].id)}`.execute(
      t.db,
    );
    const map = { ...pil.assigneeMap };
    delete map[a.user('daniel')];
    const res = await check(body(pil, { assigneeMap: map }));
    expect(res.statusCode, res.body).toBe(200);
    const r = ConnectorMappingCheck.parse(res.json());
    expect(r).toMatchObject({
      mappingId: pil.id,
      project: { key: 'PIL', found: true },
      issueType: { name: 'Task', found: true },
      impact: null,
      connectionStatus: 'connected',
    });
    const row = (id: string) => r.assignees.find((x) => x.userId === id)!;
    expect(row(a.user('jonas'))).toMatchObject({
      status: 'mapped',
      externalAccount: people.jonas.email,
      roleText: 'Pilot owner',
      message: null,
    });
    expect(row(opsLead)).toMatchObject({
      status: 'not_found',
      externalAccount: people.opsLead.email,
      message: `assignee ${people.opsLead.email} is not a member of project PIL`,
    });
    // Daniel owns no pilot task and has no account now: not in the table; a task owner without one is Unmapped.
    const noOps = { ...pil.assigneeMap };
    delete noOps[opsLead];
    const unmapped = ConnectorMappingCheck.parse((await check(body(pil, { assigneeMap: noOps }))).json());
    expect(unmapped.assignees.find((x) => x.userId === opsLead)).toMatchObject({
      status: 'unmapped',
      externalAccount: null,
    });
    // Nothing written: no issue in the tool, no audit row, the mapping unchanged.
    const issuesAfter = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM sim.external_issue WHERE connection_id = ${a.id(connections[1].id)}`.execute(
      t.db,
    );
    expect(issuesAfter.rows[0]!.n).toBe(issuesBefore.rows[0]!.n);
    const audit = await inA((tx) =>
      tx.selectFrom('platform.audit_event').select('action').where('object_id', '=', pil.id).execute(),
    );
    expect(audit).toHaveLength(0);
    await createPgSimStore(t.db).setFaultRules(a.id(connections[1].id), []);
  });

  it('while no approved, active plan uses the mapping, a destination change has no approval impact', async () => {
    // aster-demo: G2 v3 awaits Elena's decision and the pilot plan is a draft: nothing is authorized yet
    // and nothing can be sent, so there is no approval to re-approve and no unsent write to pause.
    const r = ConnectorMappingCheck.parse((await check(body(pil, { destinationProject: 'PIL2' }))).json());
    expect(r.impact).toBeNull();
  });
});

describe('Save: a material destination change needs the acknowledgement', () => {
  let unsent: number;

  beforeAll(async () => {
    // G2 approved with C1 met and the pilot plan activated: its tasks are approved and unsent.
    await activatePilot(t, a);
    // Jonas previews the approved pilot tasks: unsent writes now exist (in preview).
    const preview = await call(t.app, API.taskSync.preview, {
      params: { id: pilotSetId },
      cookie: c.jonas,
      idempotencyKey: true,
    });
    expect(preview.statusCode, preview.body).toBe(201);
    unsent = TaskSyncPreview.parse(preview.json()).willCreate;
  });

  it('shows the impact: the G2 approval needs re-approval and the unsent tasks pause', async () => {
    const r = ConnectorMappingCheck.parse(
      (await check(body(pil, { destinationProject: 'PIL2', issueType: 'Story' }))).json(),
    );
    expect(r.impact).toMatchObject({
      material: true,
      changeType: 'plan_destination_changed',
      lines: ['Approval G2 · Snapshot v3 needs re-approval', `${unsent} unsent tasks pause`],
    });
    expect(unsent).toBeGreaterThan(1);
  });

  it('assignee edits are not material: saved, no material change, the approval stays effective', async () => {
    const before = await facts();
    const res = await save(
      body(pil, { assigneeMap: { ...pil.assigneeMap, [a.user('opsLead')]: 'ops.pilot@aster.example' } }),
    );
    expect(res.statusCode, res.body).toBe(200);
    pil = ConnectorMapping.parse(res.json());
    expect(pil.assigneeMap[a.user('opsLead')]).toBe('ops.pilot@aster.example');
    expect(await facts()).toEqual(before);
    const audit = await inA((tx) =>
      tx
        .selectFrom('platform.audit_event')
        .select(['action', 'summary', 'details'])
        .where('object_id', '=', pil.id)
        .execute(),
    );
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'admin.mapping_set',
        summary: 'Set pilot tasks destination to PIL · assignees updated (not material)',
      }),
    ]);
  });

  it('without the acknowledgement the save is refused (409) with the impact lines, and nothing changes', async () => {
    const before = await facts();
    const res = await save(body(pil, { destinationProject: 'PIL2' }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'PRECONDITIONS_UNMET',
      blockers: [
        { message: 'Approval G2 · Snapshot v3 needs re-approval' },
        { message: `${unsent} unsent tasks pause` },
      ],
    });
    expect(await facts()).toEqual(before);
    const stored = await inA((tx) =>
      tx
        .selectFrom('platform.connector_mapping')
        .select('destination_project')
        .where('id', '=', pil.id)
        .executeTakeFirstOrThrow(),
    );
    expect(stored.destination_project).toBe('PIL');
  });

  it('with it: material change recorded, the G2 approval invalidated and the unsent tasks paused', async () => {
    const before = await facts();
    expect(before.g2).toBe('approved_with_conditions');
    expect(before.links.every((s) => s === 'in_preview')).toBe(true);
    const res = await save({ ...body(pil, { destinationProject: 'PIL2' }), acknowledgeMaterialImpact: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(ConnectorMapping.parse(res.json()).destinationProject).toBe('PIL2');
    const after = await facts();
    expect(after.changes).toEqual([
      {
        change_type: 'plan_destination_changed',
        classification: 'material',
        object_type: 'pilot_plan_version',
      },
    ]);
    expect(after.invalidations).toBe(before.invalidations + 1);
    expect(after.g2).toBe('invalidated');
    expect(after.links).toHaveLength(unsent);
    expect(after.links.every((s) => s === 'paused_approval_changed')).toBe(true);
    const audit = await inA((tx) =>
      tx
        .selectFrom('platform.audit_event')
        .select(['action', 'details'])
        .where('action', 'in', ['admin.mapping_set', 'material_change.detected'])
        .orderBy('seq')
        .execute(),
    );
    expect(audit.map((x) => x.action).slice(-2)).toEqual(['admin.mapping_set', 'material_change.detected']);
    expect(audit.at(-2)!.details).toMatchObject({
      destinationChanged: true,
      material: true,
      acknowledged: true,
    });
    // The send re-checks authorization: the paused tasks cannot be sent on the invalidated approval.
    const send = await call(t.app, API.taskSync.send, {
      params: { id: pilotSetId },
      body: { previewId: '00000000-0000-4000-8000-000000000000', previewHash: 'a'.repeat(64) },
      cookie: c.jonas,
      idempotencyKey: true,
    });
    expect(send.statusCode).toBe(409);
  });
});

describe('access', () => {
  it('administrators only: the pilot owner and the sponsor are refused (403); agents are refused', async () => {
    for (const who of [c.jonas!, c.elena!, c.maya!]) {
      expect((await check(body(pil), who)).statusCode).toBe(403);
      expect((await save(body(pil), who)).statusCode).toBe(403);
    }
    const agent = await agentCookie(t, a);
    const res = await save(body(pil), agent);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'AGENT_IDENTITY_FORBIDDEN' });
  });

  it("another tenant's connection or mapping is not found (404) and is never overwritten", async () => {
    const asB = await check(body(pil), c.adminB);
    expect(asB.statusCode).toBe(404);
    expect(asB.json()).toMatchObject({ code: 'NOT_FOUND' });
    const saveB = await save(body(pil), c.adminB);
    expect(saveB.statusCode).toBe(404);
    // B's own connection, A's mapping id: B cannot see or overwrite A's row.
    const ownConn = await save(
      body(pil, { connectionId: b.id(connections[1].id), assigneeMap: {} }),
      c.adminB,
    );
    expect(ownConn.statusCode).toBe(404);
    const stored = await inA((tx) =>
      tx
        .selectFrom('platform.connector_mapping')
        .select(['connection_id', 'destination_project'])
        .where('id', '=', pil.id)
        .executeTakeFirstOrThrow(),
    );
    expect(stored).toEqual({ connection_id: a.id(connections[1].id), destination_project: 'PIL2' });
  });
});
