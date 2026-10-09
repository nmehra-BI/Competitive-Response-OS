/**
 * Analysis runs on ME-104 (aster-demo): start → worker → proposals; cancel, resume, answer; and the
 * AI-down guarantee — with the provider failing or analysis turned off, runs stop with "Stopped — your
 * work is saved" and every manual command still works (nothing outside this module depends on runs).
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { API, AnalysisRun, Proposal } from '@growth-os/contracts';
import { withTenant } from '@growth-os/db';
import type { AnalysisProvider } from '@growth-os/ai';
import { z } from 'zod';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../platform/testing';
import { agentCookie, createWorkerHarness, queuedJobs, type WorkerHarness } from './testing';

let t: TestApp;
let w: WorkerHarness;
let a: SeededTenant;
let b: SeededTenant;
const cookie: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestApp();
  w = createWorkerHarness();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  for (const who of ['maya', 'daniel', 'elena', 'jonas', 'admin'] as const)
    cookie[who] = await login(t.app, a.user(who));
  cookie.mayaB = await login(t.app, b.user('maya'));
  cookie.agent = await agentCookie(t.db, a.tenantId, a.user('analysisAgent'));
});
afterAll(async () => {
  await w.close();
  await t.close();
});
afterEach(() => {
  delete process.env.ANALYSIS_ENABLED;
});

const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, fn);

const start = (c: string, body: Record<string, unknown> = {}, caseRef = 'ME-104') =>
  call(t.app, API.analysis.start, {
    params: { caseRef },
    cookie: c,
    idempotencyKey: true,
    body: { skill: 'scenario-economics', goal: 'Explain the scenarios', ...body },
  });
const get = (id: string, c = cookie.maya!) =>
  call(t.app, API.analysis.get, { params: { id }, cookie: c }).then((r) => ({
    status: r.statusCode,
    body: r.statusCode === 200 ? API.analysis.get.response.parse(r.json()) : null,
  }));
const cmd = (def: typeof API.analysis.cancel | typeof API.analysis.resume, id: string, c: string) =>
  call(t.app, def, { params: { id }, cookie: c, idempotencyKey: true });

describe('analysis runs on a case', () => {
  it('start → 202 queued with the skill budget, job queued; the worker completes it with proposals', async () => {
    const res = await start(cookie.maya!);
    expect(res.statusCode).toBe(202);
    const run = AnalysisRun.parse(res.json());
    expect(run).toMatchObject({
      status: 'queued',
      skill: 'scenario-economics',
      skillVersion: '1.0.0',
      requestedBy: { id: a.user('maya') },
      budget: { wallTimeMs: 300000, maxToolCalls: 30 },
      provider: 'fixture',
      modelConfig: null,
      lastCheckpointSeq: 0,
    });
    expect(await queuedJobs(t.db, run.id)).toBe(1);
    expect(await w.run(a.tenantId, run.id)).toBe('completed');
    const after = await get(run.id);
    expect(after.body!.run).toMatchObject({ status: 'completed', statusLabel: 'Done' });
    expect(after.body!.run.lastCheckpointSeq).toBeGreaterThan(0);
    expect(after.body!.steps.map((s) => s.kind)).toEqual([
      'checkpoint',
      'provider_call',
      'tool_call',
      'provider_call',
      'validation',
      'proposal_write',
    ]);
    const list = await call(t.app, API.analysis.latestForCase, {
      params: { caseRef: 'ME-104' },
      cookie: cookie.daniel,
    });
    expect(API.analysis.latestForCase.response.parse(list.json()).items[0]!.id).toBe(run.id);
    const props = await call(t.app, API.analysis.proposals, {
      params: { caseRef: 'ME-104' },
      cookie: cookie.maya,
    });
    const items = z.object({ items: z.array(Proposal) }).parse(props.json()).items;
    expect(items).toHaveLength(5);
    expect(items.every((p) => p.payload.type === 'claim' && p.payload.claim.kind !== 'evidence')).toBe(true);
    // The worker's status changes are audited as the system, never as a person.
    const audit = await inA((tx) =>
      tx
        .selectFrom('platform.audit_event')
        .select(['action', 'actor_kind'])
        .where('object_id', '=', run.id)
        .orderBy('occurred_at')
        .execute(),
    );
    expect(audit.map((x) => `${x.actor_kind}:${x.action}`)).toEqual([
      'human:analysis_run.requested',
      'system:analysis_run.start',
      'system:proposal.created',
      'system:analysis_run.complete',
    ]);
  });

  it('accepting an AI claim writes an AI draft claim with provenance; it becomes a fact only through claims.accept', async () => {
    const props = await call(t.app, API.analysis.proposals, {
      params: { caseRef: 'ME-104' },
      cookie: cookie.maya,
    });
    const p = z.object({ items: z.array(Proposal) }).parse(props.json()).items[0]!;
    const res = await call(t.app, API.analysis.decideProposal, {
      params: { id: p.id },
      cookie: cookie.maya,
      idempotencyKey: true,
      body: { decision: 'accept', reason: null },
    });
    const d = Proposal.parse(res.json());
    expect(d).toMatchObject({ status: 'accepted', targetType: 'claim' });
    const claim = await inA((tx) =>
      tx.selectFrom('platform.claim').selectAll().where('id', '=', d.targetId!).executeTakeFirstOrThrow(),
    );
    // WS4a's writer (D-076): the claim enters the case as an AI draft, never an accepted fact.
    expect(claim).toMatchObject({
      origin: 'ai',
      accepted_by: null,
      created_by: a.user('maya'),
      agent_run_id: p.runId,
      status: 'proposed',
    });
    const audit = await inA((tx) =>
      tx.selectFrom('platform.audit_event').select('action').where('object_id', '=', claim.id).execute(),
    );
    expect(audit.map((e) => e.action)).toEqual(['claim.created_from_proposal']);
    // A person accepts it as a fact with the human command (never-rule 11).
    const accepted = await call(t.app, API.thesis.acceptClaim, {
      params: { id: claim.id },
      cookie: cookie.maya,
      idempotencyKey: true,
      body: { as: 'inference', editedStatement: null },
    });
    expect(accepted.statusCode).toBe(200);
    const after = await inA((tx) =>
      tx.selectFrom('platform.claim').selectAll().where('id', '=', claim.id).executeTakeFirstOrThrow(),
    );
    expect(after).toMatchObject({ status: 'accepted', accepted_by: a.user('maya'), origin: 'ai' });
  });

  it('refuses a mandate skill on a case and unknown skills', async () => {
    expect((await start(cookie.maya!, { skill: 'mandate-to-search-plan' })).statusCode).toBe(400);
    expect((await start(cookie.maya!, { skill: 'gate-approver' })).statusCode).toBe(400);
  });

  it('cancel: requester or case owner only; the worker then writes nothing more', async () => {
    const run = AnalysisRun.parse((await start(cookie.maya!)).json());
    const daniel = await cmd(API.analysis.cancel, run.id, cookie.daniel!);
    expect(daniel.statusCode).toBe(403);
    expect(daniel.json()).toMatchObject({ code: 'FORBIDDEN' });
    const res = await cmd(API.analysis.cancel, run.id, cookie.maya!);
    expect(AnalysisRun.parse(res.json())).toMatchObject({
      status: 'cancelled',
      statusLabel: 'Stopped — your work is saved',
    });
    expect(await w.run(a.tenantId, run.id)).toBe('cancelled');
    const props = await inA((tx) =>
      tx.selectFrom('platform.proposal').select('id').where('run_id', '=', run.id).execute(),
    );
    expect(props).toHaveLength(0);
    expect((await cmd(API.analysis.cancel, run.id, cookie.maya!)).statusCode).toBe(409);
  });

  it('needs input → only the requester answers → the worker continues', async () => {
    const run = AnalysisRun.parse((await start(cookie.maya!, { focus: { fixture: 'needs-input' } })).json());
    expect(await w.run(a.tenantId, run.id)).toBe('waiting_for_input');
    const waiting = await get(run.id);
    expect(waiting.body!.run).toMatchObject({
      status: 'waiting_for_input',
      statusLabel: 'Needs your input',
      needsInput: { options: ['Base', 'Downside'] },
    });
    const answer = (c: string) =>
      call(t.app, API.analysis.provideInput, {
        params: { id: run.id },
        cookie: c,
        idempotencyKey: true,
        body: { answer: 'Base' },
      });
    expect((await answer(cookie.elena!)).statusCode).toBe(403);
    const ok = await answer(cookie.maya!);
    expect(ok.statusCode).toBe(202);
    expect(AnalysisRun.parse(ok.json())).toMatchObject({ status: 'running', needsInput: null });
    expect(await queuedJobs(t.db, run.id)).toBe(2);
    expect(await w.run(a.tenantId, run.id)).toBe('completed');
  });

  it('refuses other tenants (404), agents (403 AGENT_IDENTITY_FORBIDDEN) and admins (404)', async () => {
    const run = AnalysisRun.parse((await start(cookie.maya!)).json());
    expect((await get(run.id, cookie.mayaB!)).status).toBe(404);
    expect((await cmd(API.analysis.cancel, run.id, cookie.mayaB!)).statusCode).toBe(404);
    const caseA = await inA((tx) =>
      tx
        .selectFrom('platform.workflow_case')
        .select('id')
        .where('display_key', '=', 'ME-104')
        .executeTakeFirstOrThrow(),
    );
    expect((await start(cookie.mayaB!, {}, caseA.id)).statusCode).toBe(404);
    expect(
      (await call(t.app, API.analysis.proposals, { params: { caseRef: caseA.id }, cookie: cookie.mayaB }))
        .statusCode,
    ).toBe(404);
    const agent = await start(cookie.agent!);
    expect(agent.statusCode).toBe(403);
    expect(agent.json()).toMatchObject({ code: 'AGENT_IDENTITY_FORBIDDEN' });
    const agentCancel = await cmd(API.analysis.cancel, run.id, cookie.agent!);
    expect(agentCancel.json()).toMatchObject({ code: 'AGENT_IDENTITY_FORBIDDEN' });
    const p = await inA((tx) =>
      tx
        .selectFrom('platform.proposal')
        .select('id')
        .where('status', '=', 'proposed')
        .executeTakeFirstOrThrow(),
    );
    const agentDecide = await call(t.app, API.analysis.decideProposal, {
      params: { id: p.id },
      cookie: cookie.agent,
      idempotencyKey: true,
      body: { decision: 'accept', reason: null },
    });
    expect(agentDecide.json()).toMatchObject({ code: 'AGENT_IDENTITY_FORBIDDEN' });
    expect((await start(cookie.admin!)).statusCode).toBe(404);
    expect((await start(cookie.jonas!)).statusCode).toBe(403);
  });
});

describe('AI down: analysis failing or turned off never blocks the manual workflow', () => {
  const failing: AnalysisProvider = {
    name: 'fixture',
    modelConfig: null,
    generate: async () => {
      throw new Error('provider outage');
    },
  };

  it('a failing provider stops the run with "Stopped — your work is saved"; resume is offered', async () => {
    const run = AnalysisRun.parse((await start(cookie.maya!)).json());
    expect(await w.run(a.tenantId, run.id, failing)).toBe('failed');
    const r = (await get(run.id)).body!.run;
    expect(r).toMatchObject({
      status: 'failed',
      statusLabel: 'Stopped — your work is saved',
      error: { code: 'provider_provider_unavailable' },
    });
    const resumed = await cmd(API.analysis.resume, run.id, cookie.maya!);
    expect(resumed.statusCode).toBe(202);
    expect(AnalysisRun.parse(resumed.json()).status).toBe('queued');
    expect(await w.run(a.tenantId, run.id)).toBe('completed');
    // A completed run cannot be resumed.
    expect((await cmd(API.analysis.resume, run.id, cookie.maya!)).statusCode).toBe(409);
  });

  it('with analysis turned off, requests are refused clearly and manual commands still work', async () => {
    process.env.ANALYSIS_ENABLED = 'false';
    const off = await start(cookie.maya!);
    expect(off.statusCode).toBe(503);
    expect(off.json().title).toMatch(/Continue by hand/);
    const disc = await call(t.app, API.opportunities.requestDiscovery, {
      params: { ref: 'MD-21' },
      cookie: cookie.maya,
      idempotencyKey: true,
    });
    expect(disc.statusCode).toBe(503);
    // Manual work on the same case goes on.
    const caseRow = await inA((tx) =>
      tx
        .selectFrom('platform.workflow_case')
        .select('id')
        .where('display_key', '=', 'ME-104')
        .executeTakeFirstOrThrow(),
    );
    const comment = await call(t.app, API.comments.addComment, {
      params: { caseRef: 'ME-104' },
      cookie: cookie.daniel,
      body: { targetType: 'case', targetId: caseRow.id, body: 'Checked the scenarios by hand.' },
    });
    expect(comment.statusCode).toBe(201);
    const challenge = await call(t.app, API.evidence.challenge, {
      params: { ref: 'SRC-021' },
      cookie: cookie.daniel,
      idempotencyKey: true,
      body: { statement: 'Survey sample is small.' },
    });
    expect(challenge.statusCode).toBe(201);
  });

  it('no other module reads runs or proposals (no dependency on analysis)', async () => {
    const modules = join(dirname(fileURLToPath(import.meta.url)), '..');
    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (p !== dirname(fileURLToPath(import.meta.url))) await walk(p);
        } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
          const src = await readFile(p, 'utf8');
          if (/platform\.(agent_run|proposal|tool_call)\b|modules\/analysis|from '\.\.\/analysis/.test(src))
            offenders.push(p);
        }
      }
    }
    await walk(modules);
    // Only the registry and the admin Diagnostics page (read-only trace view, S14) may mention runs.
    expect(
      offenders.filter((p) => !p.endsWith('/modules/index.ts') && !p.includes('/platform/admin/')),
    ).toEqual([]);
  });
});
