/**
 * Wave 4 · E1 on the MSW mocks (ticket 1, D-112 §2–§3): the S06 sizing draft editor and the S08
 * economics driver editor render the approved design language, keep a blank input Unknown (never 0),
 * keep the one-time investment apart from the /year table and are axe-clean. The real-stack journey
 * of a new case is `real/w4-e1-editors.spec.ts`.
 */
import { expect, test } from './support/fixtures';

// Two axe scans and autosaves per test: allow for a loaded CI machine.
test.describe.configure({ timeout: 90_000 });

test('S06 editor: boundary, Evidence or Assumption per input, a blank stays Unknown', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya', '/me/cases/ME-104/sizing');
  await page.goto('/me/cases/ME-104/sizing');
  await page.getByRole('button', { name: 'Edit sizing model' }).click();
  const editor = page.getByRole('region', { name: 'Sizing draft editor' });
  await expect(editor.getByLabel('Market unit')).toHaveValue('annual spend on water monitoring');
  await expect(editor.getByLabel(/^Reference year/)).toHaveValue('2026');
  await expect(editor.getByRole('checkbox', { name: 'Services' })).toBeChecked();
  await expect(editor.getByRole('textbox', { name: 'TAM site count' })).toHaveValue('5000');
  await expectAccessible();

  const cap = editor.getByLabel('Installation and support capacity · basis');
  await cap.selectOption('');
  await cap.blur();
  await expect(editor.getByText(/Not available — add Installation and support capacity/)).toBeVisible();
  const ledger = page.getByRole('table', { name: 'Input ledger' });
  await expect(ledger.getByRole('row', { name: /Installation and support capacity/ })).toContainText(
    'Unknown',
  );
  await expect(ledger).not.toContainText('0 customers');
  await expect(editor.getByText('Blocked: add Installation and support capacity.')).toBeVisible();
  await expectAccessible();
});

test('S08 editor: header once, links, the one-time investment in its own block', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya', '/me/cases/ME-104/economics');
  await page.goto('/me/cases/ME-104/economics');
  const header = page.getByRole('group', { name: 'Model header' });
  await expect(header.getByRole('textbox', { name: 'Currency' })).toHaveValue('EUR');
  await expect(header.getByRole('textbox', { name: 'Base year' })).toHaveValue('2026');
  await expect(page.getByRole('table', { name: 'Economics drivers' })).not.toContainText('investment');
  const once = page.getByRole('group', { name: 'One-time scale-entry investment' });
  await expect(once.getByRole('textbox', { name: 'One-time scale-entry investment' })).toHaveValue('400');
  await expect(page.getByRole('group', { name: 'Cash flow' })).toContainText('Not available');
  await expectAccessible();

  await once.getByRole('textbox', { name: 'One-time scale-entry investment' }).fill('');
  await once.getByRole('textbox', { name: 'One-time scale-entry investment' }).blur();
  await expect(page.getByRole('group', { name: 'One-time money' })).toContainText(
    'Not available — one-time investment not entered.',
  );
  await expect(page.getByRole('group', { name: 'One-time money' })).not.toContainText('€0');
});
