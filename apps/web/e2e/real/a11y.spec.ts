/**
 * Every screen is axe-clean on the real stack (`aster-demo`, WCAG 2.2 AA): each frozen route
 * (support/routes.ts) as the persona who works there, plus the admin sections and a decided package.
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
  });
}

test('axe · login and the admin sections', async ({ page, loginAs, expectAccessible }) => {
  await page.goto('/login');
  await expectAccessible();
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
