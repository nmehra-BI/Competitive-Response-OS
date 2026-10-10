/**
 * `analysis.run` (JOBS.analysisRun): execute or resume one analysis run within its budget. The API
 * enqueues it in the same transaction that creates, resumes or answers the run. A thrown error (worker
 * crash, database outage) fails the job attempt; graphile-worker retries it and the harness continues
 * from the last committed checkpoint, reusing committed tool results.
 */
import {
  createFileSkillLoader,
  createHarness,
  createToolGateway,
  providerFromEnv,
  ZERO_USAGE,
  type AnalysisProvider,
  type SkillLoader,
} from '@growth-os/ai';
import type { RunStatus } from '@growth-os/contracts';
import { withTenant, type Db } from '@growth-os/db';
import type { AnalysisRunPayload } from '../catalog';
import { createPgRunStore } from './store';
import { createScopeChecker, createToolHandlers } from './tools';

export interface AnalysisDeps {
  db: Db;
  /** Defaults to the configured provider (fixture unless ANALYSIS_PROVIDER=claude). */
  provider?: AnalysisProvider;
  skills?: SkillLoader;
  now?: () => number;
  concurrency?: number;
}

/** The business reason a run stops when the tenant has not turned live analysis on (D-120 §4). */
export const LIVE_ANALYSIS_OFF =
  'Live analysis is off for this workspace. An administrator turns it on after the signed data-processing addendum is recorded and an eval run passes.';

/**
 * Provider gate (D-120 §4, D-130): a live provider is called only for a tenant whose "Live analysis"
 * setting is on. Otherwise the run stops before any provider call ("Stopped — your work is saved",
 * error `provider_refused` with the business reason). The fixture provider is never gated.
 */
export function gateLiveProvider(
  provider: AnalysisProvider,
  db: Db,
  tenant: { tenantId: string; correlationId: string },
): AnalysisProvider {
  if (provider.name === 'fixture') return provider;
  return {
    name: provider.name,
    modelConfig: provider.modelConfig,
    async generate(request) {
      const on = await withTenant(
        db,
        { tenantId: tenant.tenantId, userId: null, correlationId: tenant.correlationId },
        async (tx) =>
          (await tx.selectFrom('platform.tenant_ai_setting').select('live_enabled').executeTakeFirst())
            ?.live_enabled ?? false,
      );
      if (!on) return { type: 'error', code: 'refused', message: LIVE_ANALYSIS_OFF, usage: ZERO_USAGE };
      return provider.generate(request);
    },
  };
}

export function createAnalysisRunner(deps: AnalysisDeps) {
  const provider = deps.provider ?? providerFromEnv();
  const skills = deps.skills ?? createFileSkillLoader();
  const env = { db: deps.db };
  const gateway = createToolGateway(createToolHandlers(env), {
    scope: createScopeChecker(env),
    now: deps.now,
  });
  return {
    provider,
    async run(payload: Pick<AnalysisRunPayload, 'tenantId' | 'correlationId' | 'runId'>): Promise<RunStatus> {
      const store = createPgRunStore(deps.db, {
        tenantId: payload.tenantId,
        correlationId: payload.correlationId,
        concurrency: deps.concurrency,
      });
      const gated = gateLiveProvider(provider, deps.db, payload);
      return createHarness({ provider: gated, gateway, skills, store, now: deps.now }).execute(payload.runId);
    },
  };
}
