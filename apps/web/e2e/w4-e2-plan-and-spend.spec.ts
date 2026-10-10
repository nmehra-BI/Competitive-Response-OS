/**
 * Wave 4 · E2 against the MSW mocks, axe on every editor: S11 plan editor, Record spend with a reversal
 * and the scope-change refusal, stop-rule trips (D-112 §5, D-114 §2, D-127); S09 add assumption and S07
 * add dimension on ME-102 (D-112 §1, §4). The real-stack twin is `real/w4-e2-plan-and-spend.spec.ts`.
 */
import { expect, test } from './support/fixtures';

const PILOT = '/me/cases/ME-104/pilot';

// Each journey runs axe several times; leave room on a loaded machine.
test.setTimeout(90_000);

test('S11: edit the plan draft, record and reverse spend, refuse spend above the approval', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('jonas', PILOT);
  await page.getByRole('button', { name: 'Edit plan' }).click();
  const editor = page.getByRole('form', { name: /Edit plan draft v1/ });
  await editor.getByLabel('Milestone 2 date').fill('2027-01-15');
  await editor.getByLabel('Milestone 2 evidence expected').fill('Paid-use log');
  await editor.getByLabel(/^Task 2 budget line/).fill('8000');
  await expectAccessible();
  await editor.getByRole('button', { name: 'Save plan draft' }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Milestones' })).toContainText(
    '15 Jan 2027 · Evidence expected: Paid-use log',
  );
  await expect(page.getByText('€8k one-time')).toBeVisible();

  await page.getByRole('button', { name: 'Record spend' }).click();
  let form = page.getByRole('form', { name: 'Record spend' });
  await form.getByLabel(/^Amount/).fill('8000');
  await form.getByLabel(/^Reference/).fill('PO-4471');
  await form.getByLabel(/^Description/).fill('Sensor kits for 4 sites');
  await expectAccessible();
  await form.getByRole('button', { name: 'Record spent' }).click();
  await expect(page.getByRole('img', { name: /spent €8k, remaining €112k/ })).toBeVisible();
  const entries = page.getByRole('table', { name: 'Spend entries' });
  await entries.getByRole('button', { name: /^Reverse spent €8,000/ }).click();
  const reverse = page.getByRole('dialog');
  await reverse.getByRole('textbox').fill('Invoice booked twice');
  await expectAccessible();
  await reverse.getByRole('button', { name: 'Reverse entry' }).click();
  await expect(page.getByRole('img', { name: /spent €0k, remaining €120k/ })).toBeVisible();
  await expect(entries).toContainText('Invoice booked twice');
  await expectAccessible();

  await page.getByRole('button', { name: 'Record spend' }).click();
  form = page.getByRole('form', { name: 'Record spend' });
  await form.getByLabel(/^Amount/).fill('130000');
  await form.getByLabel(/^Description/).fill('Two more sites');
  await form.getByRole('button', { name: 'Record spent' }).click();
  await expect(form.getByText('This would exceed the approved €120k. Request a scope change.')).toBeVisible();
  await form.getByRole('button', { name: 'Request scope change' }).click();
  await expect(page.getByRole('dialog', { name: 'Request scope change' })).toBeVisible();
});

test('S11: reporting SR2 asks the sponsor; other people cannot report', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('daniel', PILOT);
  const rules = page.getByRole('region', { name: 'Stop rules · pre-registered' });
  await expect(rules.getByRole('button', { name: 'Report trip · SR2' })).toBeDisabled();
  await expectAccessible();

  await loginAs('jonas', PILOT);
  await rules.getByRole('button', { name: 'Report trip · SR2' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report trip · SR2' });
  await dialog.getByRole('textbox').fill('Hygiene condition breached at site 3');
  await expectAccessible();
  await dialog.getByRole('button', { name: 'Report trip and request sponsor review' }).click();
  await expect(rules.getByText('Tripped · sponsor review requested')).toBeVisible();
  await expect(page.getByText('SR2 tripped · sponsor review requested. Nothing else changed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate approved plan' })).toBeDisabled();
  await expectAccessible();
});

test('S09 add assumption and S07 add dimension on ME-102', async ({ page, loginAs, expectAccessible }) => {
  await loginAs('maya', '/me/cases/ME-102/validation');
  await page.getByRole('button', { name: 'Add assumption' }).click();
  const form = page.getByRole('form', { name: 'Add assumption' });
  await form.getByLabel(/^Statement/).fill('Channel reaches 300 Austrian breweries');
  await form.getByLabel('Model input').selectOption('reachable_pool');
  await form.getByLabel(/^Value/).fill('300');
  await form.getByLabel('Evidence · link sources').check();
  await form.getByRole('checkbox', { name: /^SRC-014/ }).check();
  await form.getByLabel(/^Validation method/).fill('Partner list verification');
  await expectAccessible();
  await form.getByRole('button', { name: 'Add assumption' }).click();
  await expect(page.getByText('ASM-21 added to the register.')).toBeVisible();

  await page.goto('/me/cases/ME-102/feasibility');
  await page.getByRole('button', { name: 'Add dimension' }).click();
  const dim = page.getByRole('form', { name: 'Add dimension · request review' });
  await dim.getByLabel('Dimension').selectOption({ label: 'Operations' });
  await dim.getByRole('option', { name: /Jonas Klein/ }).click();
  await dim.getByLabel(/^Question \(required\)/).fill('Can installers cover Austrian breweries?');
  await dim.getByLabel(/^Scope of review/).fill('Two reference breweries');
  await expectAccessible();
  await dim.getByRole('button', { name: 'Request review' }).click();
  await expect(page.getByRole('table', { name: 'Readiness checklist' })).toContainText(
    'Two reference breweries',
  );
  await expectAccessible();
});
