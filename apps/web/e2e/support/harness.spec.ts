/**
 * Self-test of the WS7 shell and harness: persona login, landing redirect, ribbon, ⌘K search,
 * case header + tabs + deep links, approval panel, and an axe crawl of every route.
 */
import { expect, test } from './fixtures';
import { ROUTE_SAMPLES } from './routes';

test('persona picker lists the Aster personas behind the illustrative-data ribbon', async ({
  page,
  expectAccessible,
}) => {
  await page.goto('/login');
  await expect(page.getByRole('note', { name: 'Illustrative data notice' })).toContainText(
    'Illustrative data — synthetic',
  );
  for (const n of [
    'Elena Fischer',
    'Maya Rao',
    'Daniel Weber',
    'Jonas Klein',
    'Priya Shah',
    'Lena Hoffmann',
  ]) {
    await expect(page.getByRole('button', { name: new RegExp(`^${n}`) })).toBeVisible();
  }
  await expectAccessible();
});

test('login lands on the role landing page and keeps deep links', async ({ page, loginAs }) => {
  await loginAs('elena');
  await expect(page).toHaveURL(/\/reviews\?tab=awaiting$/);
  await expect(page.getByRole('link', { name: /Reviews/ })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: /Elena Fischer/ }).click();
  await page.getByRole('button', { name: 'Switch persona' }).click();
  await loginAs('maya', '/me/cases/ME-104/sizing?input=adoption-rate&view=lineage');
  await expect(page).toHaveURL(/\/me\/cases\/ME-104\/sizing\?input=adoption-rate&view=lineage$/);
});

test('case header shows the rail, next decision and nine linked tabs', async ({ page, loginAs }) => {
  await loginAs('maya', '/me/cases/ME-104');
  await expect(page).toHaveURL(/\/me\/cases\/ME-104\/thesis$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'German food-processing plants — monitoring',
  );
  const rail = page.getByRole('list', { name: 'Stage and gate rail' });
  await expect(rail).toContainText('Awaiting decision');
  const tabs = page.getByRole('navigation', { name: 'Case sections' }).getByRole('link');
  await expect(tabs).toHaveCount(9);
  await tabs.filter({ hasText: 'Decisions' }).click();
  await expect(page).toHaveURL(/\/me\/cases\/ME-104\/decisions$/);
  await expect(tabs.filter({ hasText: 'Decisions' })).toHaveAttribute('aria-current', 'page');
});

test('⌘K search finds a case and never offers Approve', async ({ page, loginAs }) => {
  await loginAs('maya');
  await expect(page.getByRole('button', { name: /^Search cases/ })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByRole('combobox').fill('ME-104');
  await expect(dialog.getByRole('option').first()).toContainText('German food-processing plants');
  await expect(dialog.getByText(/approve/i)).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/me\/cases\/ME-104\/thesis$/);
});

test('every route passes axe (WCAG 2.2 AA) for the operator persona', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  // One full page load per route; built screens (WS8) make the crawl longer than the default 30 s.
  test.setTimeout(120_000);
  await loginAs('maya');
  for (const [id, url] of Object.entries(ROUTE_SAMPLES)) {
    if (id === 'login') continue;
    await page.goto(url);
    await page.getByRole('main').waitFor();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await test.step(id, () => expectAccessible());
  }
});
