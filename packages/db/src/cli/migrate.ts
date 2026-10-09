/**
 * Minimal forward-only migration runner. Applies packages/db/migrations/*.sql in name order,
 * each in its own transaction, as the owner role. Records name + sha256 in public.schema_migration
 * and refuses to run if an applied file was edited (migrations are append-only).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DB_URLS } from '../config';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: DB_URLS.owner });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migration (
      name text PRIMARY KEY, sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map<string, string>(
      (
        await client.query<{ name: string; sha256: string }>(
          'SELECT name, sha256 FROM public.schema_migration',
        )
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
        console.log(`applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    console.log('migrations up to date');
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
