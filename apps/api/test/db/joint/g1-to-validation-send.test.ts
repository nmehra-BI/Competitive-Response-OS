/**
 * Joint test (WS4a → WS4b → WS6, D-080): acceptance step 12 from a fresh `aster-start` workspace.
 * WS4a builds the assessment (convert OPP-07, assumptions, sizing commit, a feasibility row, start
 * assessment); WS4b submits G1 and Elena approves it, which locks the experiment and creates the
 * validation task set; WS6 previews and sends; the outbox worker confirms VAL-1…VAL-5 in the
 * simulated Jira only after keys come back.
 *
 * One seam has no endpoint yet: nothing authors the tasks of a validation task set (the G1 lock
 * creates the set empty; PQ-13). The five fixture tasks are inserted into the set the lock created.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { gates, validationTasks } from '@growth-os/fixtures-aster';
import { call, login, seedTenant, type SeededTenant } from '../../../src/platform/testing';
import {
  convertOpp07,
  enterSizing,
  registerAssumptions,
  type World,
} from '../../../src/modules/me/cases/test-support';
import { currentPackage, decideBody, exp03Plan } from '../../../src/modules/me/gates/testkit';
import {
  analyticsCount,
  drain,
  expectNoDuplicates,
  harness,
  inTenant,
  preview,
  simIssues,
  taskSet,
  type Harness,
} from '../../connector-faults/support';

let h: Harness;
let s: SeededTenant;
let w: World;
let caseKey = '';
let gateId = '';
let setId = '';
let connectionId = '';
const k = {} as Record<'maya' | 'elena' | 'jonas' | 'priya' | 'admin' | 'mayaDemo', string>;

beforeAll(async () => {
  h = await harness();
  s = await seedTenant(h.t.db, 'aster-start');
  const cache = new Map<string, string>();
  w = {
    t: h.t,
    tenants: { a: s },
    async cookie(_tenant, who) {
      if (!cache.has(who)) cache.set(who, await login(h.t.app, s.user(who)));
      return cache.get(who)!;
    },
    close: async () => undefined,
  };
  for (const p of ['maya', 'elena', 'jonas', 'priya'] as const) k[p] = await w.cookie('a', p);
});
afterAll(async () => {
  await h.close();
});

describe('step 12: G1 lock → validation task set → send (WS4a, WS4b, WS6)', () => {
  it('builds the assessment through the WS4a endpoints; G1 preconditions are met', async () => {
    caseKey = await convertOpp07(w, 'a');
    const asm = await registerAssumptions(w, 'a', caseKey);
    await enterSizing(w, 'a', caseKey, asm);
    const commit = await call(h.t.app, API.sizing.commit, {
      params: { caseRef: caseKey },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(commit.statusCode, commit.body).toBe(201);
    const review = await call(h.t.app, API.cases.requestReview, {
      params: { caseRef: caseKey },
      body: {
        area: 'product',
        reviewerId: s.user('priya'),
        targetType: 'feasibility.product_fit',
        targetId: null,
        question: 'Does the product fit the target workflow?',
        whatToCheck: ['Process fit'],
        dueOn: '2026-10-19',
      },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(review.statusCode, review.body).toBe(201);
    const moved = await call(h.t.app, API.cases.transition, {
      params: { caseRef: caseKey },
      body: { command: 'start_assessment', rationale: 'Sized on a common boundary' },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const exp = await call(h.t.app, API.experiments.create, {
      params: { caseRef: caseKey },
      body: {
        title: 'Validation outreach · 20 sites',
        assumptionIds: [asm['adoption_rate.base']!],
        ownerId: s.user('maya'),
        fieldworkOwnerId: s.user('jonas'),
        plan: exp03Plan(),
      },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(exp.statusCode, exp.body).toBe(201);
    const pre = API.gates.rail.response.parse(
      (
        await call(h.t.app, API.gates.rail, { params: { caseRef: caseKey, gateCode: 'G1' }, cookie: k.maya })
      ).json(),
    );
    expect(pre.preconditions.every((p) => p.met)).toBe(true);
    expect(pre.canSubmit).toBe(true);
  });

  it('G1 submitted by Maya and approved by Elena → Validation, plan locked, validation task set created', async () => {
    const cr = await call(h.t.app, API.gates.createRequest, {
      params: { caseRef: caseKey },
      body: {
        gateCode: 'G1',
        scope: {
          amount: '15000.00',
          currency: 'EUR',
          durationDays: null,
          windowStart: '2026-10-19',
          windowEnd: '2026-11-13',
          countryCodes: ['DE'],
          segmentLabel: 'Food processing',
          maxSites: 20,
          milestones: [],
          ownerId: s.user('maya'),
          authorizes: [...gates.g1.authorizes],
          doesNotAuthorize: [...gates.g1.doesNotAuthorize],
        },
        parentGateRequestId: null,
        proposedConditions: [],
      },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(cr.statusCode, cr.body).toBe(201);
    gateId = API.gates.createRequest.response.parse(cr.json()).id;
    const sub = await call(h.t.app, API.gates.submit, {
      params: { id: gateId },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(sub.statusCode, sub.body).toBe(200);
    const pkg = await currentPackage(h.t, k.elena, gateId);
    expect(pkg.gateRequest.buttonLabel).toBe('Approve validation €15k');
    const dec = await call(h.t.app, API.gates.decide, {
      params: { id: gateId },
      body: decideBody(pkg, { rationale: gates.g1.decision.rationale }),
      cookie: k.elena,
      idempotencyKey: true,
    });
    expect(dec.statusCode, dec.body).toBe(201);
    const list = API.experiments.list.response.parse(
      (await call(h.t.app, API.experiments.list, { params: { caseRef: caseKey }, cookie: k.maya })).json(),
    );
    expect(list.items[0]).toMatchObject({ lifecycle: 'locked', lockedByGateRequestId: gateId });
    setId = list.items[0]!.taskSetId!;
    const set = await inTenant(h.t.db, s, (tx) =>
      tx.selectFrom('platform.task_set').selectAll().where('id', '=', setId).executeTakeFirstOrThrow(),
    );
    expect(set).toMatchObject({ owner_type: 'experiment', authorizing_gate_request_id: gateId });
    connectionId = set.connection_id!;
    expect(await analyticsCount(h, s, 'validation_authorized')).toBe(1);
    // The seam with no endpoint yet (PQ-13): the five fixture validation tasks join the locked set.
    await inTenant(h.t.db, s, async (tx) => {
      for (const v of validationTasks)
        await tx
          .insertInto('platform.task')
          .values({
            tenant_id: s.tenantId,
            case_id: set.case_id,
            task_set_id: setId,
            ordinal: v.ordinal,
            title: v.title,
            function: v.function,
            owner_user_id: s.id(v.ownerId),
            due_on: v.dueOn,
            deliverable: v.deliverable,
          })
          .execute();
    });
  });

  it('step 12: preview shows destination and assignees; "Confirmed · VAL-n" only after the tool returns keys', async () => {
    const p = await preview(h, k.jonas, setId);
    expect(p.destination.project).toBe('ME-VAL');
    expect(p.willCreate).toBe(5);
    expect(p.problems).toEqual([]);
    const res = await call(h.t.app, API.taskSync.send, {
      params: { id: setId },
      body: { previewId: p.id, previewHash: p.contentHash },
      cookie: k.jonas,
      idempotencyKey: true,
    });
    expect(res.statusCode, res.body).toBe(202);
    const sending = API.taskSync.send.response.parse(res.json());
    expect(sending.tasks.every((t) => t.sync.externalKey === null)).toBe(true);
    await drain(h, s);
    const v = await taskSet(h, k.jonas, setId);
    expect(v.summaryText).toBe('5 of 5 tasks confirmed in Jira');
    expect(v.tasks.map((t) => t.sync.externalKey).sort()).toEqual([
      'VAL-1',
      'VAL-2',
      'VAL-3',
      'VAL-4',
      'VAL-5',
    ]);
    expect(await simIssues(h, connectionId, 'ME-VAL')).toHaveLength(5);
    await expectNoDuplicates(h, connectionId);
    expect(await analyticsCount(h, s, 'external_task_confirmed')).toBe(5);
  });
});
