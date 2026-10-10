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
  type AnalysisProvider,
  type SkillLoader,
} from '@growth-os/ai';
import type { RunStatus } from '@growth-os/contracts';
import type { Db } from '@growth-os/db';
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
      return createHarness({ provider, gateway, skills, store, now: deps.now }).execute(payload.runId);
    },
  };
}
