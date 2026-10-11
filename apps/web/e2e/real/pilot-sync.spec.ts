/**
 * Alternate paths on the S11 pilot, real stack (`aster-demo`, G2 approved and the pilot activated):
 *   · partial task sync → retry only the failed task, repeated retries never duplicate
 *   · approval invalidated after activation (spend ceiling change) → unsent paused, sent kept
 *   · expired connector → CSV export works and internal tasks continue
 * Each test resets the workspace.
 */
import { expect, test } from '../support/fixtures';
import { activateDemoPilot } from '../support/journey';
import {
  analytics,
  apiCall,
  resetStack,
  setConnectorFaults,
  simulatedIssues,
  sqlRows,
} from '../support/real';

const PILOT = '/me/cases/ME-104/pilot';
const OPS = 'operations.lead@aster.example';

test.beforeEach(() => resetStack('aster-demo'));

test('partial sync: 5 of 6 confirmed, retry only the failed task, zero duplicates under repeated retries', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await activateDemoPilot(page, (who) => loginAs(who));
  await setConnectorFaults(page, [
    { mode: 'permission_denied', match: { assignee: OPS }, times: 1 },
    { mode: 'http_5xx', match: { titleContains: 'Customer check-ins' }, times: 1 },
  ]);
  await page.goto(PILOT);
  await page.getByRole('button', { name: 'Preview tasks' }).click();
  await page.getByRole('button', { name: 'Create 6 tasks in Jira' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '5 of 6 tasks confirmed in Jira · 1 failed (permission)' }),
  ).toBeVisible({ timeout: 90_000 });
  await expectAccessible();

  // The permission is fixed (fault spent); two quick retries and a replay of the same request.
  const [set] = await sqlRows<{ id: string }>(
    `SELECT id FROM platform.task_set WHERE owner_type = 'pilot_plan_version'`,
  );
  const key = crypto.randomUUID();
  const first = await apiCall(page, 'POST', `/me/task-sets/${set!.id}/retry`, {}, { 'Idempotency-Key': key });
  const replay = await apiCall(
    page,
    'POST',
    `/me/task-sets/${set!.id}/retry`,
    {},
    { 'Idempotency-Key': key },
  );
  expect(first.status).toBe(202);
  expect(replay.status).toBe(202);
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: '6 of 6 tasks confirmed in Jira' })).toBeVisible({
    timeout: 90_000,
  });
  const again = await apiCall(page, 'POST', `/me/task-sets/${set!.id}/retry`, {});
  expect(again.status).toBe(409); // nothing left to retry
  const issues = await simulatedIssues(page, 'PIL-');
  expect(issues).toHaveLength(6);
  expect(new Set(issues.map((i) => i.idempotencyKey)).size).toBe(6);
  const pilotConfirmed = (await analytics('external_task_confirmed')).filter(
    (e) => (e.envelope as { objectType?: string }).objectType === 'external_task_link',
  );
  expect(pilotConfirmed.length).toBeGreaterThanOrEqual(6);
  expect(await analytics('external_task_failed')).toHaveLength(1);
});

test('approval invalidated after activation: unsent tasks pause, sent tasks stay confirmed', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await activateDemoPilot(page, (who) => loginAs(who));
  // Two tasks cannot be sent yet (rate limited far into the future); the other four go through.
  await setConnectorFaults(page, [
    { mode: 'rate_limited', match: { assignee: OPS }, times: 50 },
    { mode: 'rate_limited', match: { titleContains: 'Adapt dashboards' }, times: 50 },
  ]);
  await page.goto(PILOT);
  await page.getByRole('button', { name: 'Preview tasks' }).click();
  await page.getByRole('button', { name: 'Create 6 tasks in Jira' }).click();
  await expect.poll(async () => (await simulatedIssues(page, 'PIL-')).length, { timeout: 90_000 }).toBe(4);

  // The spend ceiling changes: a material change, so the G2 approval stops applying.
  await page.reload();
  await page.getByRole('button', { name: 'Request scope change' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel(/What should change and why/).fill('Raise the ceiling: a fifth site joined.');
  await d.getByLabel(/New budget ceiling/).fill('150000');
  await d.getByRole('button', { name: 'Request scope change' }).click();
  await expect(page.getByText('Approval changed · sending paused')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Paused — approval changed', { exact: true })).toHaveCount(2);
  for (const i of await simulatedIssues(page, 'PIL-'))
    await expect(page.getByText(i.key, { exact: true })).toHaveCount(1);
  expect((await analytics('approval_invalidated')).length).toBeGreaterThanOrEqual(1);
  const links = await sqlRows<{ sync_status: string; n: number }>(
    `SELECT sync_status, count(*)::int AS n FROM platform.external_task_link GROUP BY sync_status ORDER BY 1`,
  );
  expect(links).toContainEqual({ sync_status: 'paused_approval_changed', n: 2 });
  expect(links.find((l) => l.sync_status === 'confirmed')?.n).toBeGreaterThanOrEqual(4);
  // The worker sends nothing more under the invalidated approval.
  await page.waitForTimeout(3_000);
  expect(await simulatedIssues(page, 'PIL-')).toHaveLength(4);
  await expectAccessible();
});

test('expired connector: sends pause, CSV export works, internal tasks continue', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await activateDemoPilot(page, (who) => loginAs(who));
  await setConnectorFaults(page, [{ mode: 'token_expired', match: {}, times: 1 }]);
  await page.goto(PILOT);
  await page.getByRole('button', { name: 'Preview tasks' }).click();
  // The dry run finds the expired token: nothing can be created, the connection is marked expired.
  await expect(
    page.getByText('The task tool connection expired. Reconnect it or export CSV instead.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create 6 tasks in Jira' })).toBeDisabled();
  await page.reload();
  await expect(page.getByText(/connection expired/i).first()).toBeVisible();
  expect(await simulatedIssues(page, 'PIL-')).toHaveLength(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV instead' }).first().click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('ME-104-pilot-tasks.csv');
  // Internal task tracking continues: Jonas marks his first task in progress.
  const [task] = await sqlRows<{ id: string; row_version: number }>(
    `SELECT t.id, t.row_version FROM platform.task t JOIN platform.task_set s ON s.id = t.task_set_id
      WHERE s.owner_type = 'pilot_plan_version' AND t.ordinal = 1`,
  );
  const upd = await apiCall(
    page,
    'PATCH',
    `/me/tasks/${task!.id}`,
    { status: 'in_progress' },
    {
      'If-Match': `"${task!.row_version}"`,
    },
  );
  expect(upd.status).toBe(200);
  await page.reload();
  await expect(
    page.getByRole('table', { name: 'Pilot tasks' }).getByText('In progress').first(),
  ).toBeVisible();
  await expectAccessible();
});
