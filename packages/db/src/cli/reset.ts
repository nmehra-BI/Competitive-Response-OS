/** Dev only: drop the app schemas so `db:migrate` can rebuild them. Refuses outside development. */
import pg from 'pg';
import { DB_URLS } from '../config';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('db:reset is disabled in production');
  const client = new pg.Client({ connectionString: DB_URLS.owner });
  await client.connect();
  try {
    await client.query(
      'DROP SCHEMA IF EXISTS me CASCADE; DROP SCHEMA IF EXISTS platform CASCADE; DROP SCHEMA IF EXISTS sim CASCADE;',
    );
    await client.query('DROP TABLE IF EXISTS public.schema_migration');
    console.log('schemas dropped');
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
