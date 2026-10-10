/**
 * Every screen is axe-clean on the real stack (`aster-demo`, WCAG 2.2 AA): each frozen route
 * (support/routes.ts) as the persona who works there, plus the admin sections and a decided package.
 * Each route also has no horizontal page scroll at 1440 px.
 */
import { expect, test } from '../support/fixtures';
import { ROUTE_SAMPLES } from '../support/routes';
import { resetStack } from '../support/real';
import type { PersonaKey } from '../support/personas';

test.beforeAll(() => resetStack('aster-demo'));

const AS: Partial<Record<string, PersonaKey>> = {
  reviews: 'elena',
  admin: 'admin',
  myWork: 'jonas',
  casePilot: 'jonas',
};

for (const [id, url] of Object.entries(ROUTE_SAMPLES)) {
  if (id === 'login') continue;
  test(`axe · ${id} · ${url}`, async ({ page, loginAs, expectAccessible }) => {
    await loginAs(AS[id] ?? 'maya', url);
    await page.getByRole('main').waitFor();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/Something went wrong|Unexpected error/)).toHaveCount(0);
    await expectAccessible();
    // No horizontal page scroll on a 1440 px desktop (S03's source chips overflowed by 4 px, D-153).
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      )
      .toBeLessThanOrEqual(0);
  });
}

test('axe · login and the admin sections', async ({ page, loginAs, expectAccessible }) => {
  // The page names its icon and the icon is served (no 404 on every page load, D-153).
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 404 && /favicon/.test(r.url())) failed.push(r.url());
  });
  await page.goto('/login');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
  expect((await page.request.get('/favicon.svg')).status()).toBe(200);
  await expectAccessible();
  expect(failed).toEqual([]);
  await loginAs('admin');
  for (const section of [
    'health',
    'roles',
    'authority',
    'policies',
    'entitlements',
    'connections',
    'diagnostics',
    'audit',
  ]) {
    await page.goto(`/admin/${section}`);
    await page.getByRole('main').waitFor();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
    await expectAccessible();
  }
});
