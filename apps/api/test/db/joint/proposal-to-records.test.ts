/**
 * Joint test (WS5 → WS4a, D-076, D-080): accepting an analysis proposal writes the business record
 * through WS4a's record writers inside the decision's pipeline, with provenance. A discovery candidate
 * becomes a Detected opportunity ("Proposed · AI") that the WS4a endpoints then treat like any other;
 * a claim becomes an AI draft claim on the case that only `claims.accept` turns into a fact.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, Proposal } from '@growth-os/contracts';
import { withTenant } from '@growth-os/db';
import { z } from 'zod';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../src/platform/testing';
import { createWorkerHarness, type WorkerHarness } from '../../../src/modules/analysis/testing';

let t: TestApp;
let w: WorkerHarness;
let start: SeededTenant;
let demo: SeededTenant;
const k = {} as Record<'maya' | 'elena' | 'jonas' | 'priya' | 'admin' | 'mayaDemo', string>;

beforeAll(async () => {
  t = await createTestApp();
  w = createWorkerHarness();
  start = await seedTenant(t.db, 'aster-start');
  demo = await seedTenant(t.db, 'aster-demo');
  k.maya = await login(t.app, start.user('maya'));
  k.mayaDemo = await login(t.app, demo.user('maya'));
});
afterAll(async () => {
  await w.close();
  await t.close();
});

const inT = <T>(s: SeededTenant, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(t.db, { tenantId: s.tenantId, userId: null, correlationId: 'joint' }, fn);
const Items = z.object({ items: z.array(Proposal) });

describe('proposal accept → WS4a writers → records with provenance', () => {
  it('a discovery candidate becomes a Detected opportunity with run provenance, usable by WS4a', async () => {
    const res = await call(t.app, API.opportunities.requestDiscovery, {
      params: { ref: 'MD-21' },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(202);
    const runId = z.object({ runId: z.string() }).parse(res.json()).runId;
    expect(await w.run(start.tenantId, runId)).toBe('partial');
    const items = Items.parse(
      (await call(t.app, API.analysis.proposals, { params: { caseRef: 'MD-21' }, cookie: k.maya })).json(),
    ).items;
    const cand = items.find((p) => p.payload.type === 'opportunity_candidate')!;
    const dec = await call(t.app, API.analysis.decideProposal, {
      params: { id: cand.id },
      body: { decision: 'accept', reason: null },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(dec.statusCode, dec.body).toBe(200);
    const decided = Proposal.parse(dec.json());
    expect(decided).toMatchObject({ status: 'accepted', targetType: 'opportunity' });
    // The WS4a read model serves the record the writer created.
    const opp = API.opportunities.get.response.parse(
      (
        await call(t.app, API.opportunities.get, { params: { ref: decided.targetId! }, cookie: k.maya })
      ).json(),
    );
    expect(opp).toMatchObject({ origin: 'ai', status: 'detected' });
    const row = await inT(start, (tx) =>
      tx
        .selectFrom('me.opportunity')
        .selectAll()
        .where('id', '=', decided.targetId!)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toMatchObject({ agent_run_id: runId, created_by: start.user('maya') });
    const audit = await inT(start, (tx) =>
      tx
        .selectFrom('platform.audit_event')
        .select(['action', 'details'])
        .where('object_id', '=', decided.targetId!)
        .execute(),
    );
    expect(audit.map((a) => a.action)).toEqual(['opportunity.created_from_proposal']);
    expect(audit[0]!.details).toMatchObject({ proposalId: cand.id, agentRunId: runId, edited: false });
    // It is an ordinary opportunity for the WS4a commands: a person can shortlist it.
    const sl = await call(t.app, API.opportunities.shortlist, {
      params: { ref: opp.key },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(sl.statusCode, sl.body).toBe(200);
  });

  it('an edited claim proposal becomes an AI-edited draft claim; only claims.accept makes it a fact', async () => {
    const res = await call(t.app, API.analysis.start, {
      params: { caseRef: 'ME-104' },
      cookie: k.mayaDemo,
      idempotencyKey: true,
      body: { skill: 'scenario-economics', goal: 'Explain the scenarios' },
    });
    expect(res.statusCode).toBe(202);
    const runId = (res.json() as { id: string }).id;
    expect(await w.run(demo.tenantId, runId)).toBe('completed');
    const p = Items.parse(
      (
        await call(t.app, API.analysis.proposals, { params: { caseRef: 'ME-104' }, cookie: k.mayaDemo })
      ).json(),
    ).items[0]!;
    if (p.payload.type !== 'claim') throw new Error('expected a claim proposal');
    const edited = {
      ...p.payload,
      claim: { ...p.payload.claim, statement: `${p.payload.claim.statement} (checked)` },
    };
    const dec = await call(t.app, API.analysis.decideProposal, {
      params: { id: p.id },
      body: { decision: 'accept', editedPayload: edited, reason: 'Clarified' },
      cookie: k.mayaDemo,
      idempotencyKey: true,
    });
    expect(dec.statusCode, dec.body).toBe(200);
    const decided = Proposal.parse(dec.json());
    expect(decided).toMatchObject({ status: 'edited_and_accepted', targetType: 'claim' });
    const thesis = API.thesis.get.response.parse(
      (await call(t.app, API.thesis.get, { params: { caseRef: 'ME-104' }, cookie: k.mayaDemo })).json(),
    );
    const claim = thesis.claims.find((c) => c.id === decided.targetId)!;
    expect(claim).toMatchObject({
      origin: 'ai_edited',
      status: 'proposed',
      agentRunId: runId,
      acceptedBy: null,
      statement: edited.claim.statement,
    });
    const acc = await call(t.app, API.thesis.acceptClaim, {
      params: { id: claim.id },
      body: { as: 'inference', editedStatement: null },
      cookie: k.mayaDemo,
      idempotencyKey: true,
    });
    expect(acc.statusCode, acc.body).toBe(200);
    expect(API.thesis.acceptClaim.response.parse(acc.json())).toMatchObject({
      status: 'accepted',
      acceptedBy: demo.user('maya'),
      origin: 'ai_edited',
    });
  });
});
