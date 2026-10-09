/**
 * S02 Mandate and the G0 loop (BUILD_PLAN M1 demo): Maya drafts a mandate, submission is blocked
 * until owner, currency and horizon are right, she submits; Elena returns it with a comment; Maya
 * sees the comment, resubmits; Elena approves "Approve mandate (G0)". The owner can never approve.
 * Each persona switch is a full page load; the mocks keep the journey per browser tab.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';

test.setTimeout(120_000);

async function waitSaved(page: Page) {
  await expect(page.locator('[data-autosave="saved"]')).toBeVisible({ timeout: 10_000 });
}

test('draft → validation → submit → return with comment → resubmit → approve (G0)', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya');
  await page.getByRole('link', { name: 'Create mandate' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New mandate' })).toBeVisible();
  await page.getByLabel('Title (required)').fill('Mandate · Swiss food-processing plants');
  await page
    .getByLabel('Start from the scope of')
    .selectOption({ label: 'MD-21 · Mandate · German food-processing plants' });
  await expectAccessible();
  await page.getByRole('button', { name: 'Create draft mandate' }).click();

  // Draft: required items block submission (summary + inline), the preview names what is missing.
  await expect(page).toHaveURL(/\/me\/mandates\/MD-22$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Mandate · Swiss food-processing plants' }),
  ).toBeVisible();
  await expect(page.getByText('Draft mandate')).toBeVisible();
  await expect(page.getByText(/issues block submission to G0/)).toBeVisible();
  await expect(page.getByText('Missing owner.')).toBeVisible();
  await expect(page.getByText('Currency not specified.')).toBeVisible();
  await expect(page.getByText('[owner missing]', { exact: false })).toBeVisible();
  const submit = page.getByRole('button', { name: 'Submit for G0' });
  await expect(submit).toBeDisabled();
  await expectAccessible();

  // Incompatible horizon: success is stated for year 3, horizon 12 months.
  await page
    .getByLabel('Objective')
    .fill('Evaluate Swiss food-processing plants for the water-monitoring system.');
  await page
    .getByLabel('Success definition')
    .fill('A recorded scale, extend or stop decision with the SOM scenario stated for end of year 3.');
  await page
    .getByRole('group', { name: 'Mandate horizon' })
    .getByRole('button', { name: '12 months' })
    .click();
  await waitSaved(page);
  await expect(
    page.getByText(/Success is stated for end of year 3, but the mandate horizon is 12 months/).first(),
  ).toBeVisible();
  await page.getByRole('group', { name: 'Mandate horizon' }).getByRole('button', { name: '3 years' }).click();
  await page.getByRole('group', { name: 'Currency (required)' }).getByRole('button', { name: 'EUR' }).click();
  await page.getByLabel('Investment constraint · pilot spend ceiling').fill('120,000');
  await page.getByRole('option', { name: /Maya Rao/ }).click();
  await waitSaved(page);
  await expect(page.getByText(/block submission to G0/)).toHaveCount(0);
  await expect(page.getByLabel('Scope preview').getByText(/owned by Maya Rao/)).toBeVisible();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText('G0 · Awaiting decision').first()).toBeVisible();
  await expect(page.getByText('You own this mandate and cannot approve its G0.')).toBeVisible();
  await expect(page.getByText('Submitted versions are read-only. Changes create v2.')).toBeVisible();

  // Elena: the decision is in her inbox; she returns it with a comment (comment required).
  await loginAs('elena');
  const awaiting = page.getByRole('list', { name: 'Gate decisions awaiting you' });
  await expect(awaiting.getByRole('link', { name: /Approve mandate \(G0\)/ })).toContainText('MD-22');
  await awaiting.getByRole('link', { name: /Approve mandate \(G0\)/ }).click();
  await expect(page).toHaveURL(/\/me\/mandates\/MD-22$/);
  const panel = page.getByRole('complementary', { name: 'Approval panel' });
  await expect(panel.getByText('What this authorizes')).toBeVisible();
  await expectAccessible();
  await panel.getByRole('button', { name: 'Return for revision' }).click();
  await expect(panel.getByRole('button', { name: 'Return for revision' })).toBeDisabled();
  await panel
    .getByLabel('Rationale (required)')
    .fill('State the pilot window and add a no-outreach exclusion.');
  await panel.getByRole('button', { name: 'Return for revision' }).click();
  await expect(page.getByText('G0 · Returned for revision').first()).toBeVisible();

  // Maya: the comment is on the page; she fixes and resubmits v2.
  await loginAs('maya', '/me/mandates/MD-22');
  await expect(page.getByText(/Returned for revision by Elena Fischer/)).toBeVisible();
  await expect(page.getByText(/State the pilot window and add a no-outreach exclusion/)).toBeVisible();
  await expect(page.getByText('Version 2')).toBeVisible();
  await page.getByLabel('Exclusions').fill('No prospect outreach before G1');
  await page.getByLabel('Pilot duration (days)').fill('90');
  await waitSaved(page);
  await page.getByRole('button', { name: 'Submit for G0' }).click();
  await expect(page.getByText('G0 · Awaiting decision').first()).toBeVisible();

  // Elena approves v2 with a rationale; the mandate is approved and discovery can start.
  await loginAs('elena', '/me/mandates/MD-22');
  const panel2 = page.getByRole('complementary', { name: 'Approval panel' });
  await expect(panel2.getByText('Snapshot v2')).toBeVisible();
  await panel2.getByRole('button', { name: 'Approve mandate (G0)' }).click();
  await panel2.getByLabel('Rationale (required)').fill('Scope v2 is bounded and owned.');
  await panel2.getByRole('button', { name: 'Approve mandate (G0)' }).click();
  await expect(page.getByText(/Mandate approved \(G0\)/)).toBeVisible();
  await expect(
    page.getByText('Elena Fischer approved scope v2. Discovery can start. No spend is authorized by G0.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to opportunities' })).toBeVisible();
  await expectAccessible();
});

test('an approved mandate is read-only and shows its G0 stamp', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya', '/me/mandates/MD-21?version=2');
  await expect(page.getByText('G0 · Approved').first()).toBeVisible();
  await expect(page.getByText(/Mandate approved \(G0\) · 5 Oct 2026/)).toBeVisible();
  await expect(page.getByLabel('Objective')).toBeDisabled();
  await expect(page.getByText('Submitted versions are read-only. Changes create v3.')).toBeVisible();
  await page.getByRole('link', { name: 'Mandates' }).first().click();
  await expect(page.getByRole('table', { name: 'Mandates' })).toContainText('MD-21');
  await expectAccessible();
});
