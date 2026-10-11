/** Connection settings. Three roles: owner (migrations), app (API), worker (jobs). See decisions.md D-003. */
import type { ConnectionOptions } from 'node:tls';

export const DB_URLS = {
  owner: process.env.DATABASE_OWNER_URL ?? 'postgres://me_owner:me_owner_dev@localhost:5432/growth_os',
  app: process.env.DATABASE_URL ?? 'postgres://me_app:me_app_dev@localhost:5432/growth_os',
  worker: process.env.DATABASE_WORKER_URL ?? 'postgres://me_worker:me_worker_dev@localhost:5432/growth_os',
} as const;

export type DbRole = keyof typeof DB_URLS;

/**
 * TLS for hosted Postgres (decisions.md D-163). `DATABASE_SSL` is unset or `disable` locally (no TLS),
 * `require` encrypts without verifying the certificate chain, and `verify` verifies it against
 * `DATABASE_CA_CERT` (PEM) or the system roots. Set in the environment, never in the URL, so
 * every client (pg, Kysely, graphile-worker) gets the same setting.
 */
export function sslConfig(env: NodeJS.ProcessEnv = process.env): false | ConnectionOptions {
  const mode = (env.DATABASE_SSL ?? 'disable').toLowerCase();
  if (mode === 'disable' || mode === 'false' || mode === '') return false;
  if (mode === 'require') return { rejectUnauthorized: false };
  if (mode === 'verify') return env.DATABASE_CA_CERT ? { ca: env.DATABASE_CA_CERT } : {};
  throw new Error(`DATABASE_SSL must be disable, require or verify (got "${mode}")`);
}

/** pg client/pool settings for a role: its URL plus the shared TLS setting. */
export function pgConfig(role: DbRole): { connectionString: string; ssl: false | ConnectionOptions } {
  return { connectionString: DB_URLS[role], ssl: sslConfig() };
}
