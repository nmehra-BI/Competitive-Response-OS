/**
 * Minimal forward-only migration runner. Applies packages/db/migrations/*.sql in name order,
 * each in its own transaction, as the owner role. Records name + sha256 in public.schema_migration
 * and refuses to run if an applied file was edited (migrations are append-only).
 *
 * Then installs the job queue schema (graphile_worker) as the owner and grants the app and worker
 * roles what they need: the API enqueues jobs inside its business transaction (transactional
 * enqueue, D-007) and the worker runs them. Neither role can create schemas.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runMigrations } from 'graphile-worker';
import { DB_URLS } from './config';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function applySqlMigrations(client: pg.Client): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migration (
    name text PRIMARY KEY, sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Map<string, string>(
    (
      await client.query<{ name: string; sha256: string }>('SELECT name, sha256 FROM public.schema_migration')
    ).rows.map((r) => [r.name, r.sha256]),
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const sha = createHash('sha256').update(sql).digest('hex');
    const prior = applied.get(file);
    if (prior) {
      if (prior !== sha)
        throw new Error(`Migration ${file} was edited after it was applied. Add a new migration instead.`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO public.schema_migration (name, sha256) VALUES ($1, $2)', [file, sha]);
      await client.query('COMMIT');
      console.warn(`applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
}

/**
 * Grants are idempotent, so they run on every migrate (graphile-worker may add objects on upgrade).
 * graphile-worker enables RLS on its private tables and expects to connect as their owner; our
 * roles are not owners, so they get explicit policies. The queue is cross-tenant by design: every
 * payload carries tenantId and the job sets app.tenant_id before it touches business data.
 */
const JOB_QUEUE_GRANTS = `
  GRANT USAGE ON SCHEMA graphile_worker TO me_app, me_worker;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA graphile_worker TO me_app, me_worker;
  GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA graphile_worker TO me_app, me_worker;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA graphile_worker TO me_app, me_worker;
  DO $$
  DECLARE t record;
  BEGIN
    FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'graphile_worker' AND c.relkind = 'r' AND c.relrowsecurity
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS growth_os_roles ON graphile_worker.%I', t.relname);
      EXECUTE format('CREATE POLICY growth_os_roles ON graphile_worker.%I TO me_app, me_worker USING (true) WITH CHECK (true)', t.relname);
    END LOOP;
  END $$;
`;

/** Apply SQL migrations, the job queue schema and the role grants. Idempotent. */
export async function migrateDatabase(connectionString: string = DB_URLS.owner): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await applySqlMigrations(client);
    await runMigrations({ connectionString });
    await client.query(JOB_QUEUE_GRANTS);
  } finally {
    await client.end();
  }
}
