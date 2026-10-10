/**
 * Wave 4 · E4 workflow UX on the real stack (aster-demo): thesis blockers name their gate (D-119),
 * a cited AI claim is accepted as fact in one step (D-116), SAM's lineage shows the reachable-pool
 * upper-bound check (D-117), Maya edits, adds and removes validation draft tasks before sending and only
 * the remaining tasks are confirmed (D-113), and the administrator edits the pilot task mapping in S14
 * with "Check with Jira" and the material-change dialog (D-114 §1). Each step checks UI, database and axe.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { activateDemoPilot } from '../support/journey';
import { apiCall, auditActions, resetStack, simulatedIssues, sqlExec, sqlRows } from '../support/real';

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => resetStack('aster-demo'));

const CASE = '/me/cases/ME-104';

/** aster-demo seeds no thesis for ME-104: Maya starts a draft so S05 renders (API; S05 edits are WS4a). */
async function ensureThesis(page: Page) {
  const r = await apiCall(
    page,
    'PATCH',
    '/me/cases/ME-104/thesis/draft',
    {
      fields: {
        proposition: {
          value: 'Offer our existing water-monitoring system to German food-processing sites.',
          origin: 'human',
        },
      },
    },
    { 'If-Match': '"0"' },
  );
  expect([200, 412]).toContain(r.status);
}

async function settled(page: Page) {
  await page.getByRole('main').waitFor();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

test('thesis blockers name their gate: "Pending · G2" and "Blocker · G3" with the hint', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await sqlExec(
    `INSERT INTO me.blocker (tenant_id, case_id, text, owner_user_id, blocks_gate)
     SELECT c.tenant_id, c.id, b.text, c.owner_user_id, b.gate FROM platform.workflow_case c,
       (VALUES ('Pilot site list not signed', 'G2'), ('Scale budget not approved', 'G3')) AS b(text, gate)
      WHERE c.display_key = 'ME-104'`,
  );
  await loginAs('maya', `${CASE}/thesis`);
  await ensureThesis(page);
  await page.reload();
  await settled(page);
  const blockers = page.getByRole('heading', { name: 'Blockers' }).locator('xpath=ancestor::section[1]');
  await expect(blockers.getByText('Pending · G2')).toBeVisible();
  await expect(blockers.getByText('Blocker · G3')).toBeVisible();
  await expect(blockers.getByTitle('Needed for the next gate and in progress.')).toBeVisible();
  await expectAccessible();
});

test('Maya accepts a cited AI claim as fact in one step; the uncited one is offered as a draft only', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya', `${CASE}/thesis`);
  const run = await apiCall<{ id: string }>(page, 'POST', '/me/cases/ME-104/analysis-runs', {
    skill: 'bottom-up-sizing',
    goal: 'Bottom-up sizing claims for the thesis',
  });
  expect(run.status).toBe(202);
  await expect
    .poll(
      async () =>
        (
          await sqlRows(`SELECT 1 FROM platform.proposal WHERE run_id = $1 AND status = 'proposed'`, [
            run.json.id,
          ])
        ).length,
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  await page.reload();
  await settled(page);
  const proposals = page.getByRole('list', { name: 'AI claim proposals' });
  const cited = proposals.locator('li[data-proposal]', { hasText: 'About 5,000 food-processing sites' });
  const uncited = proposals.locator('li[data-proposal]', { hasText: 'The reachable pool is 500 sites' });
  await expect(uncited.getByRole('button', { name: 'Accept as fact' })).toHaveCount(0);
  await expect(uncited.getByText('No citation: add it as a draft, then decide.')).toBeVisible();
  await cited.getByRole('button', { name: 'Accept as fact' }).click();
  const dialog = page.getByRole('dialog', { name: 'Accept as fact' });
  await expect(dialog).toContainText('About 5,000 food-processing sites');
  await expect(dialog.locator('[data-kind="evidence"]')).toBeVisible();
  await expect(dialog.getByRole('list', { name: 'Citations' })).toBeVisible();
  await expectAccessible();
  await dialog.getByRole('button', { name: 'Accept as fact' }).click();
  await expect(dialog).toHaveCount(0);
  const [claim] = await sqlRows<{ status: string; origin: string; accepted_by: string | null }>(
    `SELECT c.status, c.origin, c.accepted_by FROM platform.claim c
       JOIN platform.proposal p ON p.target_id = c.id
      WHERE p.run_id = $1 AND p.status = 'accepted'`,
    [run.json.id],
  );
  expect(claim).toMatchObject({ status: 'accepted', origin: 'ai' });
  expect(claim!.accepted_by).not.toBeNull();
  const audit = await auditActions('ME-104');
  expect(audit.slice(-3)).toEqual(['claim.created_from_proposal', 'claim.accepted', 'proposal.accepted']);
  const claims = page.getByRole('heading', { name: 'Claims' }).locator('xpath=ancestor::section[1]');
  await expect(claims).toContainText('About 5,000 food-processing sites in Germany');
});

test('SAM lineage: "Used by: Reachable pool (upper-bound check: 500 ≤ 2,000 sites)", formula once', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya', `${CASE}/sizing`);
  await settled(page);
  await page.getByRole('button', { name: 'Lineage for SAM' }).click();
  const drawer = page.getByRole('dialog', { name: 'SAM' });
  await expect(drawer).toContainText('€40,000,000');
  await expect(
    drawer.getByRole('link', { name: 'Reachable pool (upper-bound check: 500 ≤ 2,000 sites)' }),
  ).toBeVisible();
  const formula = drawer.getByRole('group', { name: 'Formula for SAM' });
  await expect(formula).toContainText('SAM = (');
  await expect(formula).not.toContainText('SAM = SAM');
  await expectAccessible();
  await page.keyboard.press('Escape');
});

test('Maya edits, adds and removes draft validation tasks; only the remaining task is created', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya', `${CASE}/validation?experiment=EXP-03`);
  await settled(page);
  const tasks = page.getByRole('list', { name: 'Validation tasks' });
  await expect(tasks.getByText('VAL-5', { exact: true })).toBeVisible();
  // Sent tasks are read-only.
  await expect(tasks.getByRole('button', { name: /^Edit task:/ })).toHaveCount(0);

  const addTask = async (title: string, deliverable: string) => {
    await page.getByRole('button', { name: 'Add task' }).click();
    const form = page.getByRole('form', { name: 'Add a validation task' });
    await form.getByLabel(/^Task title/).fill(title);
    await form.getByRole('option', { name: /Jonas Klein/ }).click();
    await form.getByLabel(/^Due date/).fill('2026-11-06');
    await form.getByLabel(/^Deliverable/).fill(deliverable);
    await form.getByRole('button', { name: 'Add task' }).click();
    await expect(tasks.getByText(title, { exact: true })).toBeVisible();
  };
  await addTask('Call non-responding sites', 'Call notes');
  await addTask('Spare outreach task', 'Nothing');
  await expect(page.getByRole('heading', { name: 'Validation tasks · Draft' })).toBeVisible();
  await expectAccessible();

  await tasks.getByRole('button', { name: 'Edit task: Call non-responding sites' }).click();
  const edit = page.getByRole('form', { name: 'Edit task · Call non-responding sites' });
  await edit.getByLabel(/^Task title/).fill('Call the 12 non-responding sites');
  await edit.getByRole('button', { name: 'Save task' }).click();
  await expect(tasks.getByText('Call the 12 non-responding sites', { exact: true })).toBeVisible();

  await tasks.getByRole('button', { name: 'Remove task: Spare outreach task' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove task' });
  await expectAccessible();
  await dialog.getByRole('button', { name: 'Remove task' }).click();
  await expect(tasks.getByText('Spare outreach task')).toHaveCount(0);

  await page.getByRole('button', { name: 'Preview tasks' }).click();
  await page.getByRole('button', { name: 'Create 1 task in Jira' }).click();
  await expect(page.getByText('6 of 6 tasks confirmed in Jira')).toBeVisible({ timeout: 30_000 });
  await expect(tasks.getByText('VAL-6', { exact: true })).toBeVisible();
  const issues = await simulatedIssues(page, 'VAL-');
  expect(issues).toHaveLength(6);
  const [removed] = await sqlRows<{ removed_at: string | null; links: number }>(
    `SELECT t.removed_at, (SELECT count(*)::int FROM platform.external_task_link l WHERE l.task_id = t.id) AS links
       FROM platform.task t WHERE t.title = 'Spare outreach task'`,
  );
  expect(removed!.removed_at).not.toBeNull();
  expect(removed!.links).toBe(0);
  const audit = await auditActions('ME-104');
  for (const a of ['task.created', 'task.updated', 'task.removed']) expect(audit).toContain(a);
  await expectAccessible();
});

test('admin edits the pilot task mapping in S14: Check with Jira, then the material-change dialog', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  // G2 approved with C1 met and the pilot activated: six approved, unsent pilot tasks.
  await activateDemoPilot(page, (who) => loginAs(who));
  await loginAs('admin', '/admin/connections');
  const section = page.locator('#admin-task-mapping');
  await section.getByRole('button', { name: /^Task mapping · Jira/ }).click();
  await section.getByRole('tab', { name: 'Pilot tasks' }).click();
  const assignees = section.getByRole('table', { name: 'Assignees · Pilot tasks' });
  await expect(assignees.getByText('Mapped').first()).toBeVisible();
  await section.getByRole('button', { name: 'Check with Jira' }).click();
  await expect(section.getByText('Checked just now · nothing was written in the task tool.')).toBeVisible();
  await expectAccessible();

  await section.getByLabel('Destination project').fill('PIL2');
  await section.getByRole('button', { name: 'Save mapping' }).click();
  const dialog = page.getByRole('dialog', { name: 'Material change' });
  const impact = dialog.getByRole('list', { name: 'Impact' });
  await expect(impact).toContainText('Approval G2 · Snapshot v3 needs re-approval');
  await expect(impact).toContainText('6 unsent tasks pause');
  await expectAccessible();
  await dialog.getByRole('button', { name: 'Save and pause unsent tasks' }).click();
  await expect(section.getByText('Saved: PIL2 · Task.')).toBeVisible();

  const [change] = await sqlRows<{ classification: string }>(
    `SELECT classification FROM platform.material_change WHERE change_type = 'plan_destination_changed'`,
  );
  expect(change?.classification).toBe('material');
  const [g2] = await sqlRows<{ status: string }>(
    `SELECT status FROM platform.gate_request WHERE gate_code = 'G2'`,
  );
  expect(g2?.status).toBe('invalidated');
  const [mapping] = await sqlRows<{ destination_project: string }>(
    `SELECT destination_project FROM platform.connector_mapping WHERE purpose = 'pilot_tasks'`,
  );
  expect(mapping?.destination_project).toBe('PIL2');
  // Nothing was written in the task tool for the pilot.
  expect(await simulatedIssues(page, 'PIL')).toHaveLength(0);
});
