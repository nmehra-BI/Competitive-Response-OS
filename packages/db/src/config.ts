/** Connection settings. Three roles: owner (migrations), app (API), worker (jobs). See decisions.md D-003. */
export const DB_URLS = {
  owner: process.env.DATABASE_OWNER_URL ?? 'postgres://me_owner:me_owner_dev@localhost:5432/growth_os',
  app: process.env.DATABASE_URL ?? 'postgres://me_app:me_app_dev@localhost:5432/growth_os',
  worker: process.env.DATABASE_WORKER_URL ?? 'postgres://me_worker:me_worker_dev@localhost:5432/growth_os',
} as const;
