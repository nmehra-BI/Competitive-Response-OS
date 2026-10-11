/**
 * Acceptance step 2 (WS5): discovery run on MD-21 → partial ("1 source unavailable"), candidates stored
 * as proposals ("Proposed · AI"), OPP-12-style duplicate flagged, accepting one creates a Detected
 * opportunity with provenance. Plus cross-tenant, unauthorized-role and agent attempts.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, AnalysisRun, Proposal, type RunStep } from '@growth-os/contracts';
import { withTenant } from '@growth-os/db';
import { z } from 'zod';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../platform/testing';
import { createWorkerHarness, queuedJobs, type WorkerHarness } from './testing';

let t: TestApp;
let w: WorkerHarness;
let a: SeededTenant;
let b: SeededTenant;
const cookie: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestApp();
  w = createWorkerHarness();
  a = await seedTenant(t.db, 'aster-start');
  b = await seedTenant(t.db, 'aster-start');
  for (const who of ['maya', 'daniel', 'admin', 'jonas'] as const)
    cookie[who] = await login(t.app, a.user(who));
  cookie.mayaB = await login(t.app, b.user('maya'));
});
afterAll(async () => {
  await w.close();
  await t.close();
});

const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, fn);

const discover = (c: string, ref = 'MD-21', key: string | true = true) =>
  call(t.app, API.opportunities.requestDiscovery, { params: { ref }, cookie: c, idempotencyKey: key });
const proposals = (c: string, ref = 'MD-21', status?: 'proposed' | 'accepted' | 'rejected') =>
  call(t.app, API.analysis.proposals, { params: { caseRef: ref }, cookie: c, query: { status } });

describe('discovery on MD-21 (step 2)', () => {
  let runId: string;

  it('acknowledges with 202, queues the job in the same transaction and replays the same key', async () => {
    const key = randomUUID();
    const res = await discover(cookie.maya!, 'MD-21', key);
    expect(res.statusCode).toBe(202);
    runId = z.object({ runId: z.string().uuid() }).parse(res.json()).runId;
    expect(await queuedJobs(t.db, runId)).toBe(1);
    const again = await discover(cookie.maya!, 'MD-21', key);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.json()).toEqual({ runId });
    const get = await call(t.app, API.analysis.get, { params: { id: runId }, cookie: cookie.maya });
    const body = API.analysis.get.response.parse(get.json());
    expect(body.run).toMatchObject({
      status: 'queued',
      statusLabel: 'Queued',
      skill: 'mandate-to-search-plan',
      provider: 'fixture',
      modelConfig: null,
    });
    const audit = await inA((tx) =>
      tx
        .selectFrom('platform.audit_event')
        .select(['action', 'summary'])
        .where('object_id', '=', runId)
        .execute(),
    );
    expect(audit.map((x) => x.action)).toEqual(['analysis_run.requested']);
  });

  it('runs partial because the trade registry is unavailable, with candidates as proposals', async () => {
    expect(await w.run(a.tenantId, runId)).toBe('partial');
    const res = await call(t.app, API.analysis.get, { params: { id: runId }, cookie: cookie.maya });
    const { run, steps } = API.analysis.get.response.parse(res.json());
    expect(run).toMatchObject({
      status: 'partial',
      statusLabel: 'Partial results',
      statusDetail: '1 source unavailable',
    });
    expect(run.usage.toolCalls).toBe(5);
    expect(
      steps.some(
        (s: RunStep) =>
          s.kind === 'tool_call' && s.status === 'failed' && /Trade registry unavailable/.test(s.summary),
      ),
    ).toBe(true);
    // Diagnostics trace: redacted args and hashes only.
    const calls = await inA((tx) =>
      tx.selectFrom('platform.tool_call').selectAll().where('run_id', '=', runId).execute(),
    );
    expect(calls.map((c) => c.tool_name).sort()).toEqual(
      [
        'evidence.get',
        'evidence.get',
        'intelligence.search',
        'intelligence.search',
        'portfolio.get_product',
      ].sort(),
    );
    expect(JSON.stringify(calls.map((c) => c.args_redacted))).not.toContain('food');

    const list = await proposals(cookie.maya!);
    expect(list.statusCode).toBe(200);
    const items = z.object({ items: z.array(Proposal) }).parse(list.json()).items;
    expect(items.map((p) => p.payload.type)).toEqual([
      'search_plan',
      'opportunity_candidate',
      'opportunity_candidate',
      'opportunity_candidate',
    ]);
    expect(items.every((p) => p.status === 'proposed' && p.caseId === null && p.decidedBy === null)).toBe(
      true,
    );
    const opp07 = await inA((tx) =>
      tx
        .selectFrom('me.opportunity')
        .select('id')
        .where('display_key', '=', 'OPP-07')
        .executeTakeFirstOrThrow(),
    );
    const dairy = items.find(
      (p) => p.payload.type === 'opportunity_candidate' && p.payload.name === 'German dairy plants',
    )!;
    expect(dairy.payload).toMatchObject({ likelyDuplicateOfOpportunityId: opp07.id });
    // Citations are the passage ids returned in this run (SRC-021's passage).
    const p021 = await inA((tx) =>
      tx
        .selectFrom('platform.evidence_passage as p')
        .innerJoin('platform.source as s', 's.id', 'p.source_id')
        .select('p.id')
        .where('s.display_key', '=', 'SRC-021')
        .executeTakeFirstOrThrow(),
    );
    expect(dairy.payload).toMatchObject({ evidenceIds: [p021.id] });
    // Nothing became a business record.
    const opps = await inA((tx) => tx.selectFrom('me.opportunity').select('id').execute());
    expect(opps).toHaveLength(6);
  });

  it('accepting a candidate creates a Detected opportunity with provenance (origin ai, run id)', async () => {
    const items = z.object({ items: z.array(Proposal) }).parse((await proposals(cookie.maya!)).json()).items;
    const meat = items.find(
      (p) => p.payload.type === 'opportunity_candidate' && p.payload.name === 'German meat-processing plants',
    )!;
    const res = await call(t.app, API.analysis.decideProposal, {
      params: { id: meat.id },
      cookie: cookie.maya,
      idempotencyKey: true,
      body: { decision: 'accept', reason: null },
    });
    expect(res.statusCode).toBe(200);
    const decided = Proposal.parse(res.json());
    expect(decided).toMatchObject({
      status: 'accepted',
      targetType: 'opportunity',
      decidedBy: { id: a.user('maya') },
    });
    const opp = await inA((tx) =>
      tx
        .selectFrom('me.opportunity')
        .selectAll()
        .where('id', '=', decided.targetId!)
        .executeTakeFirstOrThrow(),
    );
    expect(opp).toMatchObject({
      origin: 'ai',
      status: 'detected',
      agent_run_id: runId,
      display_key: 'OPP-17',
      name: 'German meat-processing plants',
    });
    const srcs = await inA((tx) =>
      tx
        .selectFrom('me.opportunity_source')
        .select('source_id')
        .where('opportunity_id', '=', opp.id)
        .execute(),
    );
    expect(srcs).toHaveLength(1);
    // Edited acceptance keeps the duplicate hint and records ai_edited status.
    const dairy = items.find(
      (p) => p.payload.type === 'opportunity_candidate' && p.payload.name === 'German dairy plants',
    )!;
    const edited = { ...dairy.payload, name: 'German dairy plants (subset of OPP-07)' };
    const res2 = await call(t.app, API.analysis.decideProposal, {
      params: { id: dairy.id },
      cookie: cookie.maya,
      idempotencyKey: true,
      body: { decision: 'accept', editedPayload: edited, reason: 'Keep as a subset' },
    });
    expect(Proposal.parse(res2.json()).status).toBe('edited_and_accepted');
    const dup = await inA((tx) =>
      tx
        .selectFrom('me.opportunity')
        .select(['likely_duplicate_of_id', 'name'])
        .where('id', '=', Proposal.parse(res2.json()).targetId!)
        .executeTakeFirstOrThrow(),
    );
    expect(dup.name).toBe('German dairy plants (subset of OPP-07)');
    expect(dup.likely_duplicate_of_id).not.toBeNull();
    // Deciding again is refused; audit records the decisions.
    const again = await call(t.app, API.analysis.decideProposal, {
      params: { id: meat.id },
      cookie: cookie.maya,
      idempotencyKey: true,
      body: { decision: 'reject', reason: 'no' },
    });
    expect(again.statusCode).toBe(409);
    const audit = await inA((tx) =>
      tx.selectFrom('platform.audit_event').select('action').where('object_id', '=', meat.id).execute(),
    );
    expect(audit.map((x) => x.action)).toEqual(['proposal.accepted']);
  });

  it('edits cannot add citations the run did not return', async () => {
    const items = z.object({ items: z.array(Proposal) }).parse((await proposals(cookie.maya!)).json()).items;
    const cand = items.find((p) => p.payload.type === 'opportunity_candidate')!;
    const res = await call(t.app, API.analysis.decideProposal, {
      params: { id: cand.id },
      cookie: cookie.maya,
      idempotencyKey: true,
      body: {
        decision: 'accept',
        editedPayload: { ...cand.payload, evidenceIds: [randomUUID()] },
        reason: null,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('regeneration supersedes pending proposals and keeps accepted ones', async () => {
    const res = await discover(cookie.maya!);
    const second = z.object({ runId: z.string() }).parse(res.json()).runId;
    expect(await w.run(a.tenantId, second)).toBe('partial');
    const accepted = z
      .object({ items: z.array(Proposal) })
      .parse((await proposals(cookie.maya!, 'MD-21', 'accepted')).json()).items;
    expect(accepted.map((p) => p.status).sort()).toEqual(['accepted', 'edited_and_accepted']);
    const pending = z
      .object({ items: z.array(Proposal) })
      .parse((await proposals(cookie.maya!)).json()).items;
    expect(pending.every((p) => p.runId === second)).toBe(true);
    expect(pending).toHaveLength(4);
  });

  it('refuses another tenant (404), a role without analysis rights (403), an admin (404/403) and an unapproved mandate', async () => {
    expect((await discover(cookie.mayaB!, a.id('00000000-0000-4000-8000-000000000000'))).statusCode).toBe(
      404,
    );
    const mdA = await inA((tx) =>
      tx.selectFrom('me.mandate').select('id').where('display_key', '=', 'MD-21').executeTakeFirstOrThrow(),
    );
    expect((await discover(cookie.mayaB!, mdA.id)).statusCode).toBe(404);
    expect((await proposals(cookie.mayaB!, mdA.id)).statusCode).toBe(404);
    const daniel = await discover(cookie.daniel!);
    expect(daniel.statusCode).toBe(403);
    expect(daniel.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect((await discover(cookie.admin!)).statusCode).toBe(404);
    const anyProposal = z.object({ items: z.array(Proposal) }).parse((await proposals(cookie.maya!)).json())
      .items[0]!;
    const crossDecide = await call(t.app, API.analysis.decideProposal, {
      params: { id: anyProposal.id },
      cookie: cookie.mayaB,
      idempotencyKey: true,
      body: { decision: 'reject', reason: null },
    });
    expect(crossDecide.statusCode).toBe(404);
    const jonasDecide = await call(t.app, API.analysis.decideProposal, {
      params: { id: anyProposal.id },
      cookie: cookie.jonas,
      idempotencyKey: true,
      body: { decision: 'reject', reason: null },
    });
    expect(jonasDecide.statusCode).toBe(403);
    expect(
      (await call(t.app, API.analysis.get, { params: { id: anyProposal.runId }, cookie: cookie.mayaB }))
        .statusCode,
    ).toBe(404);
    expect((await discover('')).statusCode).toBe(401);
  });
});

describe('run payload shape', () => {
  it('serializes runs against the frozen contract', async () => {
    const res = await discover(cookie.maya!);
    const { runId } = z.object({ runId: z.string() }).parse(res.json());
    const got = await call(t.app, API.analysis.get, { params: { id: runId }, cookie: cookie.maya });
    expect(AnalysisRun.safeParse(got.json().run).success).toBe(true);
  });
});
