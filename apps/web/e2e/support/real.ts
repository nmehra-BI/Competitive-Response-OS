/**
 * Real-stack helpers (D-092): reset + seed the e2e database, read audit and analytics rows the way an
 * auditor would (owner role, tenant context set, RLS on), and call the API from the signed-in page.
 * Test-only; never imported by the app.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import pg from 'pg';
import { REAL } from './real-env';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Aster Industrial Systems (fixtures/aster ids are stable in the canonical seed). */
export const ASTER_TENANT = 'a57e0001-0000-4000-8000-000000000001';

export type SeedProfile = 'aster-start' | 'aster-demo';

/** Drop, migrate and seed the e2e database. Call in `test.beforeAll` of every real spec file. */
export function resetStack(profile: SeedProfile = 'aster-start'): void {
  execFileSync('npx', ['tsx', 'src/cli/e2e-reset.ts', profile], {
    cwd: resolve(root, 'packages/db'),
    env: { ...process.env, ...REAL.dbEnv, E2E_DB_RESET: '1', NODE_ENV: 'development' },
    stdio: 'pipe',
    timeout: 120_000,
  });
}

/** Run read-only SQL as the owner inside the Aster tenant context (RLS applies). */
export async function sqlRows<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: REAL.dbEnv.DATABASE_OWNER_URL });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [ASTER_TENANT]);
    const r = await client.query<T>(text, params);
    await client.query('COMMIT');
    return r.rows;
  } finally {
    await client.end();
  }
}

/** Analytics events by name, oldest first (PRD §17 names). */
export async function analytics(
  name: string,
): Promise<{ props: Record<string, unknown>; envelope: Record<string, unknown> }[]> {
  return sqlRows(
    `SELECT props, envelope FROM platform.analytics_event WHERE name = $1 ORDER BY occurred_at, id`,
    [name],
  );
}

/** Audit actions (in audit order) for one case, or for the tenant when `caseKey` is omitted. */
export async function auditActions(caseKey?: string): Promise<string[]> {
  const rows = caseKey
    ? await sqlRows<{ action: string }>(
        `SELECT a.action FROM platform.audit_event a JOIN platform.workflow_case c ON c.id = a.case_id
          WHERE c.display_key = $1 ORDER BY a.seq`,
        [caseKey],
      )
    : await sqlRows<{ action: string }>(`SELECT action FROM platform.audit_event ORDER BY seq`);
  return rows.map((r) => r.action);
}

export interface ApiResult<T = unknown> {
  status: number;
  json: T;
}

/** Call the API as the signed-in persona (cookie of the page's context). Writes get an Idempotency-Key. */
export async function apiCall<T = Record<string, unknown>>(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  const h: Record<string, string> = { ...headers };
  if (method !== 'GET') h['Idempotency-Key'] ??= crypto.randomUUID();
  if (body !== undefined) h['content-type'] = 'application/json';
  const r = await page.request.fetch(`/api/v1${path}`, {
    method,
    headers: h,
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status(), json: (text ? JSON.parse(text) : null) as T };
}

/** The simulated Jira connection id of the Aster tenant. */
export async function taskToolConnectionId(): Promise<string> {
  const rows = await sqlRows<{ id: string }>(
    `SELECT id FROM platform.connection WHERE kind = 'task_tool' ORDER BY name LIMIT 1`,
  );
  return rows[0]!.id;
}

/** Issues the simulated tool holds for a project key prefix (e.g. `PIL-`). */
export async function simulatedIssues(
  page: Page,
  prefix: string,
): Promise<{ key: string; idempotencyKey: string }[]> {
  const id = await taskToolConnectionId();
  const r = await apiCall<{ items: { key: string; idempotencyKey: string }[] }>(
    page,
    'GET',
    `/dev/simulator/issues?connectionId=${id}`,
  );
  return r.json.items.filter((i) => i.key.startsWith(prefix));
}

/** Inject connector faults (dev route; illustrative tenants only). */
export async function setConnectorFaults(
  page: Page,
  rules: { mode: string; match: Record<string, unknown>; times?: number }[],
): Promise<void> {
  const r = await apiCall(page, 'PUT', '/dev/simulator/faults', {
    connectionId: await taskToolConnectionId(),
    rules,
  });
  if (r.status !== 200) throw new Error(`setFaults ${r.status} ${JSON.stringify(r.json)}`);
}

/** Move the dev clock (D-091) and wait until the timers it enqueues have run. */
export async function advanceClock(page: Page, to: string): Promise<void> {
  const r = await apiCall(page, 'PUT', '/dev/clock', { to });
  if (r.status !== 200) throw new Error(`dev clock ${r.status} ${JSON.stringify(r.json)}`);
}
