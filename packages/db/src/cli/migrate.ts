/**
 * `pnpm db:migrate` — applies packages/db/migrations/*.sql (append-only, checksummed), the job queue
 * schema and the role grants as the owner role. See ../migrate.ts.
 */
import { migrateDatabase } from '../migrate';

migrateDatabase()
  .then(() => console.log('migrations up to date (including job queue schema)'))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
