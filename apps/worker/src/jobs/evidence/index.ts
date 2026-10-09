/** graphile-worker tasks owned by WS1: evidence ingestion and the daily freshness recompute. */
import type { Task } from 'graphile-worker';
import type { Db, ObjectStore } from '@growth-os/db';
import { JOBS, type EvidenceIngestPayload } from '../catalog';
import { recomputeFreshness, tenantIds } from './freshness';
import { ingestSource } from './ingest';

export function evidenceTasks(deps: {
  db: Db;
  objects: ObjectStore;
  now?: () => Date;
}): Record<string, Task> {
  const now = deps.now ?? (() => new Date());
  return {
    [JOBS.evidenceIngest]: async (payload, helpers) => {
      const p = payload as EvidenceIngestPayload;
      const result = await ingestSource(deps.db, deps.objects, p);
      helpers.logger.info(`evidence.ingest ${p.sourceId}: ${result}`);
    },
    [JOBS.evidenceFreshness]: async (_payload, helpers) => {
      const at = now();
      for (const tenantId of await tenantIds(deps.db)) {
        const { aged } = await recomputeFreshness(deps.db, tenantId, at, `job:${helpers.job.id}`);
        if (aged.length) helpers.logger.info(`evidence.freshness ${tenantId}: ageing ${aged.join(', ')}`);
      }
    },
  };
}
