/**
 * Alternate path · missing data on the real stack (`aster-demo`): the finance export connection is
 * expired, so spend to date is "Not available —" with the reason (never €0); comparison inputs nobody
 * rated stay Unknown (never 0); cash flow and payback stay "Not available".
 */
import { expect, test } from '../support/fixtures';
import { apiCall, resetStack } from '../support/real';

test.beforeAll(() => resetStack('aster-demo'));

test('missing finance data shows "Not available —" with the reason, never zero', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya');
  await expect(
    page.getByText(/Spent to date: Not available — finance export connection expired/i),
  ).toBeVisible();
  await expect(page.getByText(/Spent to date: €0/)).toHaveCount(0);
  const ov = await apiCall<{ spend: { spentToDate: { unavailable?: boolean; reason?: string } } }>(
    page,
    'GET',
    '/me/overview',
  );
  expect(ov.json.spend.spentToDate).toMatchObject({
    unavailable: true,
    reason: 'Finance export connection expired',
  });
  await expectAccessible();

  await page.goto('/me/cases/ME-104/economics');
  await expect(page.getByRole('group', { name: 'Cash flow' })).toContainText('Not available');
  await expect(page.getByRole('group', { name: 'Payback' })).toContainText('Not available');

  await page.goto('/me/opportunities/compare?ids=OPP-07,OPP-14');
  const grid = page.getByRole('table', { name: 'Candidate comparison' });
  await expect(grid.getByText('Unknown', { exact: true }).first()).toBeVisible();
  await expect(grid.getByRole('cell', { name: /^0$/ })).toHaveCount(0);
  await expectAccessible();
});
