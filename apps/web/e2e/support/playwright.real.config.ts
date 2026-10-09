/**
 * Real-stack Playwright project (`real`, decisions.md D-092). Run: `pnpm test:e2e:real`.
 *
 * Starts the API, the worker and Vite (MSW off, `/api` proxied to the API) against a dedicated
 * database (default `growth_os_pe`), plus a second API + Vite pair with ANALYSIS_ENABLED=false for the
 * AI-down spec. Each spec file resets and seeds the database itself (`resetStack()` in ./real.ts), so
 * the specs run serially on one worker. Ports are unique (47xx/57xx) so other processes may keep the
 * defaults. Needs `pnpm db:up` and the database to exist (CI creates it; see .github/workflows/ci.yml).
 */
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { REAL } from './real-env';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');

const common = {
  ...REAL.dbEnv,
  AUTH_MODE: 'dev',
  ANALYSIS_PROVIDER: 'fixture',
  TASK_CONNECTOR: 'simulated',
  OBJECT_STORE_DIR: resolve(root, '.data/objects-e2e'),
  NODE_ENV: 'development',
  // The dev session cookie is Secure; browsers accept that on http://127.0.0.1 as a potentially
  // trustworthy origin, so keep the production default.
  COOKIE_SECURE: 'true',
};

function api(port: number, analysis: boolean) {
  return {
    name: `api:${port}`,
    command: `npx tsx src/main.ts`,
    cwd: resolve(root, 'apps/api'),
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore' as const,
    env: { ...common, API_PORT: String(port), ANALYSIS_ENABLED: analysis ? 'true' : 'false' },
  };
}

function web(port: number, apiPort: number) {
  return {
    name: `web:${port}`,
    command: `pnpm exec vite --port ${port} --strictPort --host 127.0.0.1`,
    cwd: resolve(root, 'apps/web'),
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_MSW: 'off', API_PORT: String(apiPort) },
  };
}

export default defineConfig({
  testDir: resolve(here, '..'),
  testMatch: ['aster-journey.spec.ts', 'real/**/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-real' }]]
    : 'list',
  outputDir: resolve(here, '../../test-results/real'),
  use: {
    baseURL: REAL.webUrl,
    trace: 'retain-on-failure',
    locale: 'en-GB',
    timezoneId: 'Europe/Berlin',
    launchOptions: process.env.E2E_CHROMIUM_PATH
      ? { executablePath: process.env.E2E_CHROMIUM_PATH }
      : undefined,
  },
  projects: [
    {
      name: 'real',
      testIgnore: ['**/real/ai-down.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // AI down (ANALYSIS_ENABLED=false): the whole journey again, completed by hand, plus the refusal.
      name: 'real-ai-down',
      testMatch: ['aster-journey.spec.ts', 'real/ai-down.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: REAL.aiDownWebUrl },
    },
  ],
  webServer: [
    api(REAL.apiPort, true),
    api(REAL.aiDownApiPort, false),
    {
      name: 'worker',
      command: `npx tsx src/main.ts`,
      cwd: resolve(root, 'apps/worker'),
      wait: { stderr: /worker running/ },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { ...common },
    },
    web(REAL.webPort, REAL.apiPort),
    web(REAL.aiDownWebPort, REAL.aiDownApiPort),
  ],
});
