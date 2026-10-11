/**
 * The one Vercel function (decisions.md D-160). It wraps the existing Fastify app (every endpoint of
 * the frozen registry under /api/v1), reuses one app per warm instance, and adds two operator routes:
 *
 *   GET|POST /api/internal/jobs/run   bounded job drain; Bearer CRON_SECRET (Vercel Cron sends it)
 *   GET      /api/internal/health     liveness plus one `SELECT 1` through the app role
 *
 * After every successful state change the handler starts a bounded drain with waitUntil(), so the
 * outbox, analysis runs and timers move without an always-on worker (D-161).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitUntil } from '@vercel/functions';
import type { FastifyInstance } from 'fastify';
import { checkJobsAuth, isCommand } from './jobs-auth';

// The build copies skills/ next to the bundle; uploads go to the instance's writable /tmp (D-166).
const here = dirname(fileURLToPath(import.meta.url));
process.env.ANALYSIS_SKILLS_DIR ??= join(here, 'skills');
process.env.OBJECT_STORE_DIR ??= '/tmp/growth-os-objects';

const DRAIN_BUDGET_MS = Number(process.env.DRAIN_BUDGET_MS ?? 20_000);
const CRON_DRAIN_BUDGET_MS = Number(process.env.CRON_DRAIN_BUDGET_MS ?? 45_000);

let appPromise: Promise<FastifyInstance> | null = null;

async function createApp(): Promise<FastifyInstance> {
  const [{ buildServer }, { handlers }, { loadConfig }, { createDb }, { drainJobs }] = await Promise.all([
    import('@growth-os/api/server'),
    import('@growth-os/api/handlers'),
    import('@growth-os/api/config'),
    import('@growth-os/db'),
    import('@growth-os/worker/drain'),
  ]);
  // Transaction pooler: a small pool per instance; withTenant() only uses transaction-local settings.
  const db = createDb('app', Number(process.env.DB_POOL_MAX ?? 3), { idleTimeoutMillis: 5_000 });
  const app = await buildServer({ handlers, authMode: loadConfig().authMode, logger: true, deps: { db } });
  app.addHook('onClose', async () => db.destroy());

  app.get('/api/internal/health', async () => {
    const { sql } = await import('@growth-os/db');
    await sql`SELECT 1`.execute(db);
    return { ok: true, db: 'ok' };
  });

  app.route({
    method: ['GET', 'POST'],
    url: '/api/internal/jobs/run',
    handler: async (req, reply) => {
      const auth = checkJobsAuth(req.headers.authorization, process.env.CRON_SECRET);
      if (auth !== 'ok') {
        return reply
          .status(auth === 'not_configured' ? 503 : 401)
          .type('application/problem+json')
          .send({
            type: 'about:blank',
            title: auth === 'not_configured' ? 'Job runner is not configured' : 'Unauthorized',
            status: auth === 'not_configured' ? 503 : 401,
          });
      }
      const result = await drainJobs({ budgetMs: CRON_DRAIN_BUDGET_MS });
      req.log.info({ drain: result }, 'job drain (http)');
      return { ok: true, ...result };
    },
  });

  await app.ready();
  return app;
}

function getApp(): Promise<FastifyInstance> {
  appPromise ??= createApp().catch((err: unknown) => {
    appPromise = null; // let the next request retry a failed cold start
    throw err;
  });
  return appPromise;
}

/** One drain per instance at a time; a request that lands mid-drain asks for one more pass. */
let draining: Promise<void> | null = null;
let again = false;

function triggerDrain(): Promise<void> {
  if (draining) {
    again = true;
    return draining;
  }
  draining = (async () => {
    const { drainJobs } = await import('@growth-os/worker/drain');
    do {
      again = false;
      try {
        const r = await drainJobs({ budgetMs: DRAIN_BUDGET_MS });
        if (r.completed || r.failed) console.warn(`job drain: ${JSON.stringify(r)}`);
      } catch (err) {
        console.error(`job drain failed: ${err instanceof Error ? err.message : String(err)}`);
        again = false;
      }
    } while (again);
  })().finally(() => {
    draining = null;
  });
  return draining;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  const finished = new Promise<void>((resolve) => {
    res.on('finish', resolve);
    res.on('close', resolve);
  });
  app.server.emit('request', req, res);
  await finished;
  if (isCommand(req.method, req.url, res.statusCode)) waitUntil(triggerDrain());
}
