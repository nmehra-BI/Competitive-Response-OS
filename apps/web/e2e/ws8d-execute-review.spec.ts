/**
 * WS8d acceptance steps 21–30 (BUILD_PLAN §8) against the MSW mocks, with axe on every screen:
 * S11 Pilot (activation blockers, preview, partial sync, retry, timeout, expired connector,
 * approval invalidated), S12 Outcomes, S13 Evidence (restricted, deleted), S14 Admin, History.
 *
 * Mock state lives in the page; the WS8d journey is mirrored to sessionStorage, so `seed()` sets a
 * starting variant before a full navigation.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';

async function seed(page: Page, s: { pilotVariant?: string; outcomesMoment?: string }) {
  await page.evaluate((x) => sessionStorage.setItem('growth-os:ws8d-mocks', JSON.stringify({ seed: x })), s);
}

const PILOT = '/me/cases/ME-104/pilot';
const OUTCOMES = '/me/cases/ME-104/outcomes';

test('steps 21–23: activation blockers, preview, partial sync, retry only the failed task', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('jonas', PILOT);
  await expect(page.getByRole('heading', { name: 'Approved baseline · pinned' })).toBeVisible();
  await expect(page.getByText('Missing owner blocks activation')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate approved plan' })).toBeDisabled();
  await expect(page.getByText('Draft — not authorized to send')).toBeVisible();
  await expectAccessible();

  await page.getByRole('button', { name: 'Assign owner to Install monitoring at 4 sites' }).click();
  const owner = page.getByRole('dialog');
  await owner.getByRole('option', { name: /Jonas Klein/ }).click();
  await owner.getByRole('button', { name: 'Save owner' }).click();
  await expect(page.getByText('Open condition C1 blocks activation')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate approved plan' })).toBeDisabled();

  await page.getByRole('button', { name: 'Mark C1 met' }).click();
  const c1 = page.getByRole('dialog');
  await c1.getByRole('textbox').fill('Signed site list limited to 4 sites');
  await c1.getByRole('button', { name: 'Mark C1 met' }).click();
  await page.getByRole('button', { name: 'Activate approved plan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Activate approved plan' }).click();

  await page.getByRole('button', { name: 'Preview tasks' }).click();
  await expect(page.getByRole('heading', { name: 'Preview · nothing has been sent' })).toBeVisible();
  await expect(page).toHaveURL(/view=preview/);
  await expect(page.getByText('Create and assign issues · as Jonas Klein')).toBeVisible();
  await expectAccessible();
  await page.getByRole('button', { name: 'Create 6 tasks in Jira' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '5 of 6 tasks confirmed in Jira · 1 failed (permission)' }),
  ).toBeVisible();
  await expect(page.getByText(/synced/i)).toHaveCount(0);
  await expectAccessible();

  await page.getByRole('button', { name: 'Retry 1 failed task' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: '6 of 6 tasks confirmed in Jira' })).toBeVisible();
  for (let n = 11; n <= 16; n++) await expect(page.getByText(`PIL-${n}`, { exact: true })).toHaveCount(1);
});

test('step 24: a timeout shows Checking, then Confirmed after reconcile', async ({ page, loginAs }) => {
  await loginAs('jonas');
  await seed(page, { pilotVariant: 'timeout' });
  await page.goto(PILOT);
  await page.getByRole('button', { name: 'Preview tasks' }).click();
  await page.getByRole('button', { name: 'Create 6 tasks in Jira' }).click();
  await expect(page.getByText('Checking', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '6 of 6 tasks confirmed in Jira' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('PIL-14', { exact: true })).toBeVisible();
});

test('variants: expired connector (CSV) and approval invalidated (paused)', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('jonas');
  await seed(page, { pilotVariant: 'expired' });
  await page.goto(PILOT);
  await expect(page.getByText('Jira connection expired · 30 Nov')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV instead' }).first().click();
  expect((await download).suggestedFilename()).toBe('ME-104-pilot-tasks.csv');
  await expectAccessible();

  await seed(page, { pilotVariant: 'invalidated' });
  await page.goto(PILOT);
  await expect(page.getByText('Approval changed · sending paused')).toBeVisible();
  await expect(page.getByText('Paused — approval changed', { exact: true })).toHaveCount(4);
  await expect(page.getByText('PIL-11', { exact: true })).toBeVisible();
  await expectAccessible();
});

test('steps 25–28: actuals, recommendation, decision, extension, scale blocked', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('jonas', OUTCOMES);
  const rec = async (label: string, actual: string, source: string, value?: string, start?: string) => {
    await page.getByRole('button', { name: `Record actual for ${label}` }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Actual (required)').fill(actual);
    if (value) await d.getByLabel(/^Value in/).fill(value);
    if (start) await d.getByLabel('Period start (required)').fill(start);
    await d.getByLabel('Source (required)').fill(source);
    await d.getByRole('button', { name: 'Record actual' }).click();
    await expect(d).toHaveCount(0);
  };
  await rec('Paid use and continuation', '3 of 4', 'billing records', '3');
  await rec('Deployment effort per site', 'Above assumption · [actual hours per site]', 'effort log (C2)');
  await rec('Buyer fit', 'Mixed', 'interview notes', undefined, '2027-02-01');
  const table = page.getByRole('table', { name: 'Baseline versus actuals' });
  await expect(table.getByText('Not met')).toHaveCount(2);
  await expect(table.getByText('Inconclusive')).toHaveCount(1);
  await expect(table.getByText('Source: billing records')).toBeVisible();
  await expectAccessible();

  // Maya: recommendation (not a decision).
  await page.getByRole('button', { name: /Jonas Klein/ }).click();
  await page.getByRole('button', { name: 'Switch persona' }).click();
  await page.getByRole('button', { name: /^Maya Rao/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(OUTCOMES);
  await page
    .getByLabel('Why (required)')
    .fill('Not scale. Test deployment effort and the fourth site first.');
  await page.getByRole('button', { name: 'Save recommendation' }).click();
  await expect(page.getByText(/RECOMMENDATION · NOT A DECISION/)).toBeVisible();

  // Elena records the decision.
  await page.getByRole('button', { name: /Maya Rao/ }).click();
  await page.getByRole('button', { name: 'Switch persona' }).click();
  await page.getByRole('button', { name: /^Elena Fischer/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(OUTCOMES);
  await page.getByRole('button', { name: 'Record decision: Revise and extend validation' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox').fill('On Maya Rao’s recommendation.');
  await d.getByRole('button', { name: 'Record decision: Revise and extend validation' }).click();
  await expect(
    page.getByRole('heading', { name: 'Decision recorded: Revise and extend validation' }),
  ).toBeVisible();

  // Maya requests the extension; scale stays disabled.
  await page.getByRole('button', { name: /Elena Fischer/ }).click();
  await page.getByRole('button', { name: 'Switch persona' }).click();
  await page.getByRole('button', { name: /^Maya Rao/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(OUTCOMES);
  await expect(page.getByRole('button', { name: 'Request scale approval' })).toBeDisabled();
  await expect(
    page.getByText(
      'G3 preconditions unmet: demand threshold 3 of 4 (4 of 4 required); specialist scale-readiness review incomplete',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Request extension €[cap]' }).click();
  await expect(page.getByText('Placeholder · confirm with PM. The PRD sets no amount.')).toBeVisible();
  await page.getByPlaceholder('€[cap]').fill('25000');
  await page.getByPlaceholder('[duration] days').fill('60');
  await page.getByRole('button', { name: 'Submit extension request €25k' }).click();
  await expect(page.getByText(/Awaiting decision · Elena Fischer/)).toBeVisible();
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(
    page.getByRole('table', { name: 'Pilot customers meeting the paid-use threshold' }),
  ).toBeVisible();
  await expectAccessible();
});

test('S13 evidence: permitted excerpt, restricted with no excerpt, deleted with provenance', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya', '/evidence/SRC-014?case=ME-104');
  await expect(page.getByText(/Permitted excerpt · Table 2/)).toBeVisible();
  const font = await page.locator('blockquote').evaluate((e) => getComputedStyle(e).fontFamily);
  expect(font).toContain('Source Serif 4');
  await expectAccessible();
  await page.getByRole('link', { name: /SRC-030/ }).click();
  await expect(page.getByText('Restricted source · no excerpt shown')).toBeVisible();
  await expect(page.locator('blockquote')).toHaveCount(0);
  await expectAccessible();
  await page.getByRole('link', { name: /SRC-011/ }).click();
  await expect(page.getByText('Source deleted by provider · provenance kept')).toBeVisible();
  await expect(page.getByText(/fingerprint 91C0·4A7E kept/)).toBeVisible();
  await expectAccessible();
});

test('step 29: administration shows the authority gap; admins cannot approve', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('admin', '/admin/health');
  await expect(page.getByText('Administrators cannot approve gates.')).toBeVisible();
  await expect(page.getByText(/No G3 approver for BU Water above €\[limit\]/).first()).toBeVisible();
  for (const s of ['Connected', 'Expired', 'Missing permission', 'Unavailable'])
    await expect(page.getByRole('table', { name: 'Connections' }).getByText(s).first()).toBeVisible();
  await expectAccessible();
  const status = await page.evaluate(async () => {
    const r = await fetch('/api/v1/me/gate-requests/a57e0015-0000-4000-8000-000000000003/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        snapshotId: 'a57e0016-0000-4000-8000-000000000003',
        snapshotHash: '7f3a19c2' + '0'.repeat(56),
        disposition: 'approve',
        rationale: 'x',
        note: null,
        conditions: [],
        delegateToUserId: null,
      }),
    });
    return (await r.json()).code as string;
  });
  expect(status).toBe('FORBIDDEN');
});

test('step 30: History lists the journey in audit order with actor and version', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya');
  await seed(page, { pilotVariant: 'timeout', outcomesMoment: 'decided' });
  await page.goto('/me/cases/ME-104/history');
  const table = page.getByRole('table', { name: 'Audit history' });
  await expect(table.getByText('Activated the approved pilot plan v1 · stage Pilot running')).toBeVisible();
  await expect(table.getByText(/Decision recorded: Revise and extend validation/)).toHaveCount(1);
  const seqs = await table.locator('tbody tr td:first-child').allTextContents();
  const nums = seqs.map(Number);
  expect(nums).toEqual([...nums].sort((a, b) => a - b));
  await expectAccessible();
});
