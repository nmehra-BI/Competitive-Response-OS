/** graphile-worker tasks owned by WS5: `analysis.run` (execute or resume an analysis run). */
import type { Task } from 'graphile-worker';
import { JOBS, type AnalysisRunPayload } from '../catalog';
import { createAnalysisRunner, type AnalysisDeps } from './run';

export { createAnalysisRunner, type AnalysisDeps } from './run';
export { createPgRunStore } from './store';
export { createScopeChecker, createToolHandlers } from './tools';
export { loadCaseContext } from './context';

export function analysisTasks(deps: AnalysisDeps): Record<string, Task> {
  const runner = createAnalysisRunner(deps);
  return {
    [JOBS.analysisRun]: async (payload, helpers) => {
      const p = payload as AnalysisRunPayload;
      const status = await runner.run(p);
      helpers.logger.info(`analysis.run ${p.runId}: ${status}`);
      // No capacity yet: fail this attempt so graphile-worker retries it with backoff.
      if (status === 'queued') throw new Error(`analysis run ${p.runId} waiting for tenant capacity`);
    },
  };
}
