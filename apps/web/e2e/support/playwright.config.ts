/**
 * Playwright config for apps/web (journey, variants, a11y). Run: `pnpm test:e2e`.
 *
 * - E2E_BASE_URL set → test that running app (CI: real API + seeded aster-start).
 * - otherwise → start Vite on 5174. With E2E_MOCKS=1 (default when no API is reachable) the app
 *   runs on the MSW fixture mocks so screens can be tested before their endpoints exist.
 */
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../..');
const external = process.env.E2E_BASE_URL;
const mocks = process.env.E2E_MOCKS !== '0';
const port = Number(process.env.E2E_PORT ?? 5174);

export default defineConfig({
  testDir: resolve(here, '..'),
  testMatch: '**/*.spec.ts',
  fullyParallel: !mocks, // mock state lives per browser page; parallel is fine, but keep runs deterministic
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: external ?? `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    locale: 'en-GB',
    timezoneId: 'Europe/Berlin',
    launchOptions: process.env.E2E_CHROMIUM_PATH
      ? { executablePath: process.env.E2E_CHROMIUM_PATH }
      : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: external
    ? undefined
    : {
        command: `pnpm exec vite --port ${port} --strictPort --host 127.0.0.1`,
        cwd: webRoot,
        url: `http://127.0.0.1:${port}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { VITE_MSW: mocks ? 'on' : 'off' },
      },
});
