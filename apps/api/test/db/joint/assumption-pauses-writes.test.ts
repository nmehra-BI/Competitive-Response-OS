/**
 * Joint test (WS4a → materiality → WS4b → WS6, D-080, never-rule 10): with the pilot activated and
 * tasks queued, a new version of the decision-critical Base adoption assumption (`assumptions.update`)
 * is material for the approved G2 snapshot that pins it. The approval is invalidated in the same
 * transaction, unsent outbox rows pause, the worker sends nothing more, and tasks already confirmed
 * stay confirmed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { call, login, seedTenant, type SeededTenant } from '../../../src/platform/testing';
import { activatePilot, ids } from '../../../src/modules/me/gates/testkit';
import {
  drain,
  harness,
  inTenant,
  pass,
  send,
  simIssues,
  taskSet,
  type Harness,
} from '../../connector-faults/support';

let h: Harness;
let s: SeededTenant;
const k = {} as Record<'maya' | 'elena' | 'jonas' | 'priya' | 'admin' | 'mayaDemo', string>;
let setId = '';
let connectionId = '';

beforeAll(async () => {
  h = await harness();
  s = await seedTenant(h.t.db, 'aster-demo');
  for (const p of ['jonas', 'maya'] as const) k[p] = await login(h.t.app, s.user(p));
  await activatePilot(h.t, s);
  const set = await inTenant(h.t.db, s, (tx) =>
    tx
      .selectFrom('platform.task_set')
      .select(['id', 'connection_id'])
      .where('owner_type', '=', 'pilot_plan_version')
      .where('authorizing_gate_request_id', '=', ids(s).g2)
      .executeTakeFirstOrThrow(),
  );
  setId = set.id;
  connectionId = set.connection_id!;
});
afterAll(async () => {
  await h.close();
});

describe('a material assumption commit pauses unsent external writes', () => {
  it('two tasks confirmed, four queued; then Maya commits a new Base adoption version', async () => {
    await send(h, k.jonas, setId);
    await pass(h, s, undefined, 2); // the worker gets through two tasks before the change
    expect((await taskSet(h, k.jonas, setId)).summary).toMatchObject({ confirmed: 2 });

    const list = API.assumptions.list.response.parse(
      (await call(h.t.app, API.assumptions.list, { params: { caseRef: 'ME-104' }, cookie: k.maya })).json(),
    );
    const base = list.items.find((a) => a.key === 'ASM-01')!;
    expect(base.decisionCritical).toBe(true);
    const res = await call(h.t.app, API.assumptions.update, {
      params: { id: base.id },
      ifMatch: base.rowVersion,
      body: { value: '0.12', changeReason: 'First pilot weeks show slower uptake' },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    const out = API.assumptions.update.response.parse(res.json());
    // Field names say what they hold (D-068): approval ids, not gate ids.
    expect(out.invalidatedApprovalIds.length).toBeGreaterThan(0);
    const g2 = await inTenant(h.t.db, s, (tx) =>
      tx
        .selectFrom('platform.gate_request')
        .select('status')
        .where('id', '=', ids(s).g2)
        .executeTakeFirstOrThrow(),
    );
    expect(g2.status).toBe('invalidated');
    const inv = await inTenant(h.t.db, s, (tx) =>
      tx
        .selectFrom('platform.approval_invalidation as i')
        .innerJoin('platform.approval as a', 'a.id', 'i.approval_id')
        .select(['i.kind', 'i.reason'])
        .where('a.gate_request_id', '=', ids(s).g2)
        .execute(),
    );
    expect(inv).toHaveLength(1);
    expect(inv[0]!.reason).toMatch(/^adoption assumption changed on \d{1,2} \w{3}$/);
  });

  it('unsent rows are paused; the worker sends nothing more; confirmed tasks stay confirmed', async () => {
    const outbox = await inTenant(h.t.db, s, (tx) =>
      tx.selectFrom('platform.outbox_message').select('status').execute(),
    );
    expect(outbox.filter((o) => o.status === 'paused')).toHaveLength(4);
    await drain(h, s);
    const v = await taskSet(h, k.jonas, setId);
    expect(v.summary).toMatchObject({ total: 6, confirmed: 2, paused: 4 });
    expect(v.summaryText).toContain('2 of 6 tasks confirmed in Jira');
    expect(v.summaryText).toContain('paused');
    expect(
      v.tasks
        .filter((t) => t.sync.status === 'confirmed')
        .every((t) => /^PIL-\d+$/.test(t.sync.externalKey!)),
    ).toBe(true);
    expect(await simIssues(h, connectionId)).toHaveLength(2);
    // A retry cannot resend under an invalidated approval.
    const retry = await call(h.t.app, API.taskSync.retry, {
      params: { id: setId },
      body: {},
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(retry.statusCode).toBeGreaterThanOrEqual(400);
    expect(await simIssues(h, connectionId)).toHaveLength(2);
  });
});
