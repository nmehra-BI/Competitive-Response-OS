/**
 * Ports and database of the real-stack e2e project (D-092). Unique ports so a developer's `pnpm dev`
 * (4000/5173) and other agents keep theirs. The database defaults to `growth_os_pe`; CI uses
 * `growth_os_e2e`. Both names pass the e2e-reset guard (`*_pe` or `*e2e*`).
 */
const db = process.env.E2E_DB_NAME ?? 'growth_os_pe';
const host = process.env.E2E_DB_HOST ?? 'localhost:5432';

export const REAL = {
  dbName: db,
  apiPort: Number(process.env.E2E_API_PORT ?? 4710),
  webPort: Number(process.env.E2E_WEB_PORT ?? 5710),
  aiDownApiPort: Number(process.env.E2E_AIDOWN_API_PORT ?? 4711),
  aiDownWebPort: Number(process.env.E2E_AIDOWN_WEB_PORT ?? 5711),
  get webUrl() {
    return `http://127.0.0.1:${this.webPort}`;
  },
  get aiDownWebUrl() {
    return `http://127.0.0.1:${this.aiDownWebPort}`;
  },
  dbEnv: {
    DATABASE_URL: `postgres://me_app:me_app_dev@${host}/${db}`,
    DATABASE_OWNER_URL: `postgres://me_owner:me_owner_dev@${host}/${db}`,
    DATABASE_WORKER_URL: `postgres://me_worker:me_worker_dev@${host}/${db}`,
  },
};
