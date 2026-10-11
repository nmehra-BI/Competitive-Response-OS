/**
 * Test-only: rebuild an e2e database from scratch and seed one Aster profile (decisions.md D-092).
 *
 *   E2E_DB_RESET=1 DATABASE_OWNER_URL=…/growth_os_pe tsx src/cli/e2e-reset.ts aster-start
 *
 * Pass `--with-other-tenant` to add an isolated second tenant (cross-tenant specs).
 * Drops the app schemas, re-applies every migration, empties the job queue (jobs from the previous
 * run must never act on the new seed; cron bookkeeping is kept) and seeds the profile. Refuses unless
 * E2E_DB_RESET=1, outside NODE_ENV=production, and only for a database whose name ends in `_pe` or
 * contains `e2e`, so it can never touch `growth_os` or another stream's database.
 */
import pg from 'pg';
import { createDb } from '../index';
import { DB_URLS } from '../config';
import { migrateDatabase } from '../migrate';
import { SEED_PROFILES, seedAster, type SeedProfile } from '../seed';

const profile = (process.argv[2] ?? 'aster-start') as SeedProfile;
/** `--with-other-tenant`: also seed an isolated aster-demo copy (random ids) for cross-tenant specs. */
const withOther = process.argv.includes('--with-other-tenant');

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

async function main(): Promise<void> {
  if (process.env.E2E_DB_RESET !== '1') throw new Error('e2e-reset needs E2E_DB_RESET=1');
  if (process.env.NODE_ENV === 'production') throw new Error('e2e-reset is disabled in production');
  if (!SEED_PROFILES.includes(profile))
    throw new Error(`Unknown seed profile "${profile}". Use one of: ${SEED_PROFILES.join(', ')}`);
  const name = databaseName(DB_URLS.owner);
  if (!/(_pe$|e2e)/.test(name)) throw new Error(`e2e-reset refuses database "${name}" (needs *_pe or *e2e*)`);

  const client = new pg.Client({ connectionString: DB_URLS.owner });
  await client.connect();
  try {
    await client.query(
      'DROP SCHEMA IF EXISTS me CASCADE; DROP SCHEMA IF EXISTS platform CASCADE; DROP SCHEMA IF EXISTS sim CASCADE;',
    );
    await client.query('DROP TABLE IF EXISTS public.schema_migration');
    const queue = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'graphile_worker' AND table_name = '_private_jobs'`,
    );
    if (queue.rows[0]?.n) {
      await client.query('DELETE FROM graphile_worker._private_jobs');
      await client.query('DELETE FROM graphile_worker._private_job_queues');
    }
  } finally {
    await client.end();
  }
  await migrateDatabase(DB_URLS.owner);
  const db = createDb('owner', 2);
  try {
    const r = await seedAster(db, { profile });
    console.warn(`e2e-reset: ${name} · ${r.profile} · ${r.audits} audit events`);
    if (withOther) {
      const o = await seedAster(db, { profile: 'aster-demo', isolated: true });
      console.warn(`e2e-reset: other tenant ${o.tenantSlug} (${o.tenantId})`);
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
