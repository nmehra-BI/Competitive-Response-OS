/**
 * Wave 4 · E2 on the real stack from `aster-demo` (G2 approved via `support/journey.ts`, D-095):
 *   · S11 plan editor: Jonas sets a milestone date with the evidence expected and a task budget line,
 *     marks C1 met and activates (D-112 §5)
 *   · S11 Record spend: €8k spent with a PO number, reversed with a reason (meter back to €0k), €130k
 *     refused with "Request scope change" (D-114 §2, D-133)
 *   · S11 stop rules: Jonas reports SR2 → Elena's Reviews inbox shows the item; the case is still Pilot
 *     running and nothing else moved (D-112, D-127, never-rule 7)
 *   · S09 add assumption and S07 add dimension by Maya on ME-102 (D-112 §1, §4)
 * axe-clean on every editor.
 */
import { expect, test } from '../support/fixtures';
import { approveDemoG2 } from '../support/journey';
import { auditActions, resetStack, sqlRows } from '../support/real';

test.beforeAll(() => resetStack('aster-demo'));

const PILOT = '/me/cases/ME-104/pilot';
const stage = async (key: string) =>
  (
    await sqlRows<{ stage: string }>(`SELECT stage FROM platform.workflow_case WHERE display_key = $1`, [key])
  )[0]!.stage;

test.describe.configure({ mode: 'serial' });

test('S11: Jonas edits the plan, activates, records and reverses spend, and is refused above the approval', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await approveDemoG2(page, (who) => loginAs(who));
  await loginAs('jonas', PILOT);

  // Plan editor (D-112 §5).
  await page.getByRole('button', { name: 'Edit plan' }).click();
  const editor = page.getByRole('form', { name: /Edit plan draft v1/ });
  await editor.getByLabel('Milestone 2 date').fill('2027-01-15');
  await editor.getByLabel('Milestone 2 evidence expected').fill('Paid-use log for the 4 sites');
  await editor.getByLabel(/^Task 2 budget line/).fill('8000');
  await editor.getByLabel('Task 2 budget note').fill('Sensor kits');
  await expectAccessible();
  await editor.getByRole('button', { name: 'Save plan draft' }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Milestones' })).toContainText(
    '15 Jan 2027 · Evidence expected: Paid-use log for the 4 sites',
  );
  await expect(page.getByRole('table', { name: 'Pilot tasks' })).toContainText('€8k one-time');
  const [line] = await sqlRows<{ budget_amount: string; budget_note: string }>(
    `SELECT budget_amount, budget_note FROM platform.task WHERE budget_amount IS NOT NULL`,
  );
  expect(line).toEqual({ budget_amount: '8000.00', budget_note: 'Sensor kits' });

  // C1 met, then activation through the screen.
  await page.getByRole('button', { name: 'Mark C1 met' }).click();
  const c1 = page.getByRole('dialog', { name: 'Mark C1 met' });
  await c1.getByRole('textbox').fill('Signed site list (4 sites)');
  await c1.getByRole('button', { name: 'Mark C1 met' }).click();
  await page.getByRole('button', { name: 'Activate approved plan' }).click();
  await page
    .getByRole('dialog', { name: 'Activate approved plan?' })
    .getByRole('button', { name: 'Activate approved plan' })
    .click();
  await expect(page.getByRole('button', { name: 'Preview tasks' })).toBeVisible();
  expect(await stage('ME-104')).toBe('pilot_running');

  // Record spend €8k with a PO number.
  await page.getByRole('button', { name: 'Record spend' }).click();
  let form = page.getByRole('form', { name: 'Record spend' });
  await form.getByLabel(/^Amount/).fill('8000');
  await form.getByLabel(/^Reference/).fill('PO-4471');
  await form.getByLabel('Task').selectOption({ label: 'Task 2 · Install monitoring at 4 sites' });
  await form.getByLabel(/^Description/).fill('Sensor kits for 4 sites');
  await expectAccessible();
  await form.getByRole('button', { name: 'Record spent' }).click();
  await expect(page.getByRole('img', { name: /spent €8k, remaining €112k/ })).toBeVisible();
  const entries = page.getByRole('table', { name: 'Spend entries' });
  await expect(entries).toContainText('PO-4471');

  // Reverse it with a reason: the meter subtracts the reversal; both rows stay.
  await entries.getByRole('button', { name: /^Reverse spent €8,000/ }).click();
  const reverse = page.getByRole('dialog', { name: /^Reverse spent €8,000/ });
  await reverse.getByRole('textbox').fill('Invoice booked twice');
  await expectAccessible();
  await reverse.getByRole('button', { name: 'Reverse entry' }).click();
  await expect(page.getByRole('img', { name: /spent €0k, remaining €120k/ })).toBeVisible();
  await expect(entries).toContainText('Invoice booked twice');
  const rows = await sqlRows<{ amount: string; reversal_reason: string | null }>(
    `SELECT amount, reversal_reason FROM me.budget_entry ORDER BY recorded_at`,
  );
  expect(rows).toEqual([
    { amount: '8000.00', reversal_reason: null },
    { amount: '8000.00', reversal_reason: 'Invoice booked twice' },
  ]);

  // €130k is above the remaining approved amount: refused with "Request scope change".
  await page.getByRole('button', { name: 'Record spend' }).click();
  form = page.getByRole('form', { name: 'Record spend' });
  await form.getByLabel(/^Amount/).fill('130000');
  await form.getByLabel(/^Description/).fill('Two more sites');
  await form.getByRole('button', { name: 'Record spent' }).click();
  await expect(form.getByText('This would exceed the approved €120k. Request a scope change.')).toBeVisible();
  await expect(form.getByText('Spend above the remaining €120k needs a scope-change request')).toBeVisible();
  await form.getByRole('button', { name: 'Request scope change' }).click();
  await expect(page.getByRole('dialog', { name: 'Request scope change' })).toBeVisible();
  expect((await sqlRows(`SELECT id FROM me.budget_entry`)).length).toBe(2);
  const audit = await auditActions('ME-104');
  expect(audit).toEqual(expect.arrayContaining(['budget.entry_recorded', 'budget.entry_reversed']));
});

test('S11: Jonas reports SR2 tripped; Elena is asked to review; nothing else moves', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('jonas', PILOT);
  const before = await sqlRows(
    `SELECT (SELECT status FROM me.pilot_plan) AS plan,
            (SELECT string_agg(status, ',' ORDER BY ordinal) FROM platform.task) AS tasks,
            (SELECT status FROM platform.gate_request WHERE gate_code = 'G2') AS g2`,
  );
  const rules = page.getByRole('region', { name: 'Stop rules · pre-registered' });
  await expect(rules.getByText('Not tripped')).toHaveCount(3);
  await rules.getByRole('button', { name: 'Report trip · SR2' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report trip · SR2' });
  await dialog.getByRole('textbox').fill('Hygiene condition breached at site 3 (specialist report)');
  await expectAccessible();
  await dialog.getByRole('button', { name: 'Report trip and request sponsor review' }).click();
  await expect(rules.getByText('Tripped · sponsor review requested')).toBeVisible();
  await expectAccessible();

  expect(await stage('ME-104')).toBe('pilot_running');
  expect(
    await sqlRows(
      `SELECT (SELECT status FROM me.pilot_plan) AS plan,
              (SELECT string_agg(status, ',' ORDER BY ordinal) FROM platform.task) AS tasks,
              (SELECT status FROM platform.gate_request WHERE gate_code = 'G2') AS g2`,
    ),
  ).toEqual(before);
  expect(await auditActions('ME-104')).toContain('stop_rule.tripped');

  await loginAs('elena', '/reviews?tab=assigned');
  await expect(
    page
      .getByText(
        'SR2 tripped: A specialist condition is breached. Review the pilot and decide what happens next.',
      )
      .first(),
  ).toBeVisible();
  await expectAccessible();
  await page.goto('/me/cases/ME-104');
  await expect(page.getByText('Pilot running').first()).toBeVisible();
});

test('S09 and S07: Maya adds an assumption with a linked source and a feasibility dimension on ME-102', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya', '/me/cases/ME-102/validation');
  await page.getByRole('button', { name: 'Add assumption' }).click();
  const form = page.getByRole('form', { name: 'Add assumption' });
  await form.getByLabel(/^Statement/).fill('Channel reaches 300 Austrian breweries');
  await form.getByLabel('Model input').selectOption('reachable_pool');
  await form.getByLabel(/^Value/).fill('300');
  await form.getByLabel('Evidence · link sources').check();
  await form.getByRole('checkbox', { name: /^SRC-014/ }).check();
  await form.getByLabel('High').check();
  await form.getByLabel(/^Validation method/).fill('Partner list verification');
  await expectAccessible();
  await form.getByRole('button', { name: 'Add assumption' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'added to the register.' })).toBeVisible();
  const register = page.getByRole('table', { name: 'Assumption register' });
  await expect(register).toContainText('Channel reaches 300 Austrian breweries');
  await expect(register.getByRole('link', { name: /SRC-014/ })).toBeVisible();
  const [asm] = await sqlRows<{ evidence_quality: string; value: string }>(
    `SELECT v.evidence_quality, v.value::text AS value FROM platform.assumption a
       JOIN platform.assumption_version v ON v.id = a.current_version_id
       JOIN platform.workflow_case c ON c.id = a.case_id
      WHERE c.display_key = 'ME-102' AND a.input_key = 'reachable_pool'`,
  );
  expect(asm).toEqual({ evidence_quality: 'strong', value: '300.00000000' });
  await expectAccessible();

  await page.goto('/me/cases/ME-102/feasibility');
  await page.getByRole('button', { name: 'Add dimension' }).click();
  const dim = page.getByRole('form', { name: 'Add dimension · request review' });
  await dim.getByLabel('Dimension').selectOption({ label: 'Operations' });
  await dim.getByRole('option', { name: /Jonas Klein/ }).click();
  await dim.getByLabel(/^Question \(required\)/).fill('Can installers cover Austrian breweries?');
  await dim.getByLabel(/^Scope of review/).fill('Two reference breweries; installation only');
  await dim.getByLabel(/^Due date/).fill('2026-11-30');
  await expectAccessible();
  await dim.getByRole('button', { name: 'Request review' }).click();
  const table = page.getByRole('table', { name: 'Readiness checklist' });
  await expect(table).toContainText('Two reference breweries; installation only');
  await expect(table).toContainText('Jonas Klein');
  await expectAccessible();
  const [rr] = await sqlRows<{ area: string; question: string }>(
    `SELECT r.area, r.question FROM platform.review_request r
       JOIN platform.workflow_case c ON c.id = r.case_id
      WHERE c.display_key = 'ME-102' AND r.target_type = 'feasibility.operations'`,
  );
  expect(rr).toEqual({ area: 'operations', question: 'Can installers cover Austrian breweries?' });
  expect(await auditActions('ME-102')).toEqual(
    expect.arrayContaining(['assumption.created', 'feasibility.dimension_added']),
  );
});
