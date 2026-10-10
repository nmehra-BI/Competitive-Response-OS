/**
 * Test support for the analysis DB suites: run the worker's `analysis.run` job body in-process (the
 * same harness, Postgres store and tool handlers the worker registers), as the worker role.
 */
import { randomBytes } from 'node:crypto';
import { createDb, sql, withTenant, type Db } from '@growth-os/db';
import { hashToken } from '../../platform/session';
import type { AnalysisProvider } from '@growth-os/ai';
import { createAnalysisRunner } from '../../../../worker/src/jobs/analysis/run';

export interface WorkerHarness {
  db: Db;
  run(tenantId: string, runId: string, provider?: AnalysisProvider): Promise<string>;
  close(): Promise<void>;
}

export function createWorkerHarness(opts: { now?: () => number } = {}): WorkerHarness {
  const db = createDb('worker', 2);
  const runner = createAnalysisRunner({ db, now: opts.now });
  return {
    db,
    run: (tenantId, runId, provider) =>
      (provider ? createAnalysisRunner({ db, provider, now: opts.now }) : runner).run({
        tenantId,
        runId,
        correlationId: `test-${runId}`,
      }),
    close: () => db.destroy(),
  };
}

/** Number of queued `analysis.run` jobs for a run (transactional enqueue check). */
export async function queuedJobs(db: Db, runId: string): Promise<number> {
  const r = await sql<{ n: string }>`SELECT count(*)::text AS n FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks k ON k.id = j.task_id
     WHERE k.identifier = 'analysis.run' AND j.payload->>'runId' = ${runId}`.execute(db);
  return Number(r.rows[0]!.n);
}

/** A session cookie for the tenant's analysis agent principal (non-interactive), to prove refusals. */
export async function agentCookie(db: Db, tenantId: string, agentUserId: string): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await withTenant(db, { tenantId, userId: null, correlationId: 'test' }, (tx) =>
    tx
      .insertInto('platform.session')
      .values({
        tenant_id: tenantId,
        user_id: agentUserId,
        token_hash: hashToken(token),
        auth_method: 'oidc',
        interactive: false,
        expires_at: new Date(Date.now() + 3600_000),
      })
      .execute(),
  );
  return `gos_session=${token}`;
}

/** Set a run's fixture script (focus) before the worker starts it. */
export async function setFocus(db: Db, tenantId: string, runId: string, focus: Record<string, string>) {
  await withTenant(db, { tenantId, userId: null, correlationId: 'test' }, (tx) =>
    tx
      .updateTable('platform.agent_run')
      .set({ checkpoint: JSON.stringify({ focus }) })
      .where('id', '=', runId)
      .execute(),
  );
}
