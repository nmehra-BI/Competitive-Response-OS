/**
 * D-120 §4 / D-130: with a live provider configured and the tenant's "Live analysis" setting off, a run
 * stops before ANY provider call ("Stopped — your work is saved", with the business reason). With the
 * setting on (addendum and eval recorded), the provider is called. The fixture provider is never gated.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { providerFromEnv, type AnalysisProvider } from '@growth-os/ai';
import { createDb, withTenant, type Db } from '@growth-os/db';
import { seedAster, type SeedResult } from '@growth-os/db/seed';
import { people } from '@growth-os/fixtures-aster';
import { createAnalysisRunner, gateLiveProvider, LIVE_ANALYSIS_OFF } from './run';
import { insertRun, readRun } from './testing';

let app: Db;
let worker: Db;
let s: SeedResult;

beforeAll(async () => {
  app = createDb('app', 2);
  worker = createDb('worker', 2);
  s = await seedAster(app, { profile: 'aster-start', isolated: true });
});
afterAll(async () => {
  await app.destroy();
  await worker.destroy();
});

/** A stand-in for a live provider that counts calls and delegates to the fixture responses. */
function countingLive(): { provider: AnalysisProvider; calls: () => number } {
  const inner = providerFromEnv({});
  let n = 0;
  return {
    provider: {
      name: 'claude',
      modelConfig: 'configured-model',
      async generate(req) {
        n += 1;
        return inner.generate(req);
      },
    },
    calls: () => n,
  };
}

describe('live provider gate', () => {
  it('tenant off: zero provider calls; the run stops with the business reason', async () => {
    const live = countingLive();
    const runId = await insertRun(app, s.tenantId, {
      skill: 'mandate-to-search-plan',
      requestedBy: s.id(people.maya.id),
    });
    const runner = createAnalysisRunner({ db: worker, provider: live.provider });
    expect(await runner.run({ tenantId: s.tenantId, correlationId: 'test', runId })).toBe('failed');
    expect(live.calls()).toBe(0);
    const r = await readRun(app, s.tenantId, runId);
    expect(r.run.status_detail).toBe('Stopped — your work is saved');
    expect(r.run.error).toMatchObject({ code: 'provider_refused', message: LIVE_ANALYSIS_OFF.slice(0, 200) });
  });

  it('tenant on (addendum + eval recorded): the live provider is called', async () => {
    await withTenant(app, { tenantId: s.tenantId, userId: null, correlationId: 'test' }, (tx) =>
      tx
        .insertInto('platform.tenant_ai_setting')
        .values({
          tenant_id: s.tenantId,
          live_enabled: true,
          addendum_ref: 'DPA addendum · synthetic',
          addendum_signed_on: '2026-10-01',
          eval_run_ref: 'eval-smoke-42',
          eval_passed_at: new Date('2026-10-02T10:00:00Z'),
        })
        .execute(),
    );
    const live = countingLive();
    const runId = await insertRun(app, s.tenantId, {
      skill: 'mandate-to-search-plan',
      requestedBy: s.id(people.maya.id),
    });
    await createAnalysisRunner({ db: worker, provider: live.provider }).run({
      tenantId: s.tenantId,
      correlationId: 'test',
      runId,
    });
    expect(live.calls()).toBeGreaterThan(0);
  });

  it('the fixture provider is never gated', () => {
    const fixture = providerFromEnv({});
    expect(gateLiveProvider(fixture, worker, { tenantId: s.tenantId, correlationId: 'x' })).toBe(fixture);
  });
});
