/**
 * Release gate · performance (BUILD_PLAN M5, PRD §10): p95 ≤ 2 s for the seeded reads the screens
 * make, measured against the real API on `aster-demo` (20 timed requests per read after one warm-up).
 */
import { expect, test } from '../support/fixtures';
import { resetStack, sqlRows } from '../support/real';

test.beforeAll(() => resetStack('aster-demo'));

const READS = [
  '/me/overview',
  '/me/cases',
  '/me/cases/ME-104',
  '/me/cases/ME-104/thesis',
  '/me/cases/ME-104/sizing',
  '/me/cases/ME-104/economics',
  '/me/cases/ME-104/assumptions',
  '/me/cases/ME-104/experiments',
  '/me/cases/ME-104/feasibility',
  '/me/gate-requests/a57e0015-0000-4000-8000-000000000003/package',
  '/me/cases/ME-104/pilot-plan',
  '/me/cases/ME-104/history',
  '/evidence/sources',
  '/evidence/sources/SRC-014',
  '/reviews',
  '/my-work',
  '/search?q=adoption',
  '/people',
];

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]!;

test('p95 ≤ 2 s on every seeded read', async ({ page, loginAs }) => {
  test.setTimeout(240_000);
  await loginAs('maya');
  const [md] = await sqlRows<{ id: string }>(`SELECT id FROM me.mandate WHERE display_key = 'MD-21'`);
  READS.push(`/me/opportunities?mandateId=${md!.id}`, '/me/mandates');
  const report: Record<string, number> = {};
  for (const path of READS) {
    const warm = await page.request.get(`/api/v1${path}`);
    expect(warm.status(), path).toBe(200);
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const r = await page.request.get(`/api/v1${path}`);
      times.push(performance.now() - t0);
      expect(r.status(), path).toBe(200);
    }
    report[path] = Math.round(p95(times));
  }
  test.info().annotations.push({ type: 'p95 ms', description: JSON.stringify(report) });
  console.warn(`p95 ms per read: ${JSON.stringify(report)}`);
  for (const [path, ms] of Object.entries(report)) expect(ms, `${path} p95`).toBeLessThanOrEqual(2000);
});
