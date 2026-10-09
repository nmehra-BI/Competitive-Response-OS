/**
 * WF-09 (analysis run lifecycle) against Postgres as the worker role: checkpoint and resume after a
 * simulated worker restart reuse committed tool results; tool budget exhausted → partial; provider
 * error → failed "Stopped — your work is saved"; the graphile task is registered and runs a job.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createFileSkillLoader,
  createHarness,
  createToolGateway,
  providerFromEnv,
  type ToolHandler,
} from '@growth-os/ai';
import { createDb, withTenant, type Db } from '@growth-os/db';
import { seedAster, type SeedResult } from '@growth-os/db/seed';
import { people } from '@growth-os/fixtures-aster';
import { JOBS } from '../catalog';
import { createTaskList } from '../../tasks';
import { analysisTasks } from './index';
import { createPgRunStore } from './store';
import { insertRun, readRun } from './testing';
import { createScopeChecker, createToolHandlers } from './tools';

let app: Db;
let worker: Db;
let s: SeedResult;
const maya = () => s.id(people.maya.id);

beforeAll(async () => {
  app = createDb('app', 2);
  worker = createDb('worker', 2);
  s = await seedAster(app, { profile: 'aster-start', isolated: true });
});
afterAll(async () => {
  await app.destroy();
  await worker.destroy();
});

/** A fresh "worker process": new harness, new store, real handlers wrapped to count (and crash). */
function workerProcess(crash?: { tool: string; times: number }) {
  const calls: Record<string, number> = {};
  const env = { db: worker };
  const handlers: ToolHandler[] = createToolHandlers(env).map((h) => ({
    ...h,
    async run(scope, args) {
      calls[h.name] = (calls[h.name] ?? 0) + 1;
      if (crash && crash.tool === h.name && crash.times > 0) {
        crash.times--;
        throw new Error('worker process killed');
      }
      return h.run(scope, args);
    },
  }));
  const gateway = createToolGateway(handlers, { scope: createScopeChecker(env) });
  const run = (runId: string) =>
    createHarness({
      provider: providerFromEnv({}),
      gateway,
      skills: createFileSkillLoader(),
      store: createPgRunStore(worker, { tenantId: s.tenantId, correlationId: 'test' }),
    }).execute(runId);
  return { run, calls };
}

describe('analysis.run lifecycle (WF-09)', () => {
  it('checkpoints every step and resumes after a worker restart, reusing committed tool results', async () => {
    const runId = await insertRun(app, s.tenantId, { skill: 'mandate-to-search-plan', requestedBy: maya() });
    const crash = { tool: 'evidence.get', times: 1 };
    const first = workerProcess(crash);
    await expect(first.run(runId)).rejects.toThrow('worker process killed');
    const mid = await readRun(app, s.tenantId, runId);
    expect(mid.run.status).toBe('running');
    expect((mid.run.checkpoint as { v: number }).v).toBe(1);
    expect(mid.run.last_checkpoint_seq).toBeGreaterThan(0);
    expect(mid.toolCalls.map((c) => c.tool_name)).toEqual([
      'portfolio.get_product',
      'intelligence.search',
      'intelligence.search',
    ]);
    expect(mid.proposals).toHaveLength(0);

    const second = workerProcess();
    expect(await second.run(runId)).toBe('partial');
    // Earlier results were reused: the restarted process called only the evidence tools.
    expect(second.calls).toEqual({ 'evidence.get': 2 });
    const done = await readRun(app, s.tenantId, runId);
    expect(done.proposals).toHaveLength(4);
    expect(done.toolCalls).toHaveLength(5);
    expect(new Set(done.steps.map((x) => x.seq)).size).toBe(done.steps.length);
    expect(done.audit.map((x) => `${x.actor_kind}:${x.action}`)).toEqual([
      'system:analysis_run.start',
      'system:proposal.created',
      'system:analysis_run.complete_partial',
    ]);
    // Running it again is a no-op: no duplicate proposals.
    expect(await workerProcess().run(runId)).toBe('partial');
    expect((await readRun(app, s.tenantId, runId)).proposals).toHaveLength(4);
  });

  it('stops tool calls at the budget and finishes partial', async () => {
    const runId = await insertRun(app, s.tenantId, {
      skill: 'mandate-to-search-plan',
      requestedBy: maya(),
      budget: { maxToolCalls: 2 },
    });
    expect(await workerProcess().run(runId)).toBe('partial');
    const r = await readRun(app, s.tenantId, runId);
    expect(r.run.status_detail).toContain('analysis budget reached');
    expect((r.run.usage as { toolCalls: number }).toolCalls).toBe(2);
    expect(
      r.toolCalls.filter(
        (c) => c.outcome === 'denied' && (c.scope_check as { budget: boolean }).budget === false,
      ).length,
    ).toBeGreaterThan(0);
  });

  it('a provider error fails the run with "Stopped — your work is saved" and keeps the checkpoint', async () => {
    const runId = await insertRun(app, s.tenantId, {
      skill: 'mandate-to-search-plan',
      requestedBy: maya(),
      focus: { fixture: 'provider-down' },
    });
    expect(await workerProcess().run(runId)).toBe('failed');
    const r = await readRun(app, s.tenantId, runId);
    expect(r.run.status_detail).toBe('Stopped — your work is saved');
    expect(r.run.error).toMatchObject({ code: 'provider_provider_unavailable' });
    expect((r.run.checkpoint as { v: number }).v).toBe(1);
    expect(r.run.finished_at).not.toBeNull();
  });

  it('malformed output after one repair fails without storing proposals', async () => {
    const runId = await insertRun(app, s.tenantId, {
      skill: 'mandate-to-search-plan',
      requestedBy: maya(),
      focus: { fixture: 'malformed' },
    });
    expect(await workerProcess().run(runId)).toBe('failed');
    const r = await readRun(app, s.tenantId, runId);
    expect(r.run.error).toMatchObject({ code: 'malformed_output' });
    expect(r.proposals).toHaveLength(0);
  });

  it('cannot run another tenant’s run (RLS: not found)', async () => {
    const other = await seedAster(app, { profile: 'aster-start', isolated: true });
    const runId = await insertRun(app, other.tenantId, {
      skill: 'mandate-to-search-plan',
      requestedBy: other.id(people.maya.id),
    });
    const store = createPgRunStore(worker, { tenantId: s.tenantId, correlationId: 'x' });
    await expect(store.loadRun(runId)).rejects.toThrow(/not found in tenant/);
  });

  it('registers analysis.run in the worker task list and runs a queued job', async () => {
    const list = createTaskList({ db: worker, objects: undefined as never });
    expect(Object.keys(list)).toContain(JOBS.analysisRun);
    const runId = await insertRun(app, s.tenantId, { skill: 'mandate-to-search-plan', requestedBy: maya() });
    const logs: string[] = [];
    const task = analysisTasks({ db: worker })[JOBS.analysisRun]!;
    await task({ tenantId: s.tenantId, correlationId: 'job', runId, resume: false }, {
      logger: { info: (m: string) => logs.push(m) },
    } as never);
    expect(logs[0]).toBe(`analysis.run ${runId}: partial`);
    const r = await withTenant(app, { tenantId: s.tenantId, userId: null, correlationId: 't' }, (tx) =>
      tx.selectFrom('platform.agent_run').select('status').where('id', '=', runId).executeTakeFirstOrThrow(),
    );
    expect(r.status).toBe('partial');
  });
});
