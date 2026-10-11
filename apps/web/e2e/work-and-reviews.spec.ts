/**
 * My Work and the Reviews inbox: role landings, keyboard tabs, the task brief, the approvals
 * notice ("owning tasks does not include approval rights") and a review response with a reason.
 */
import { expect, test } from './support/fixtures';

test('Jonas lands on My Work: tasks, the brief for this task, no approvals', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('jonas');
  await expect(page).toHaveURL(/\/my-work$/);
  await expect(page.getByRole('heading', { level: 1, name: 'My Work' })).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'My Work' });
  await expect(tabs.getByRole('tab', { name: /Tasks/ })).toHaveAttribute('aria-selected', 'true');
  const brief = page.getByRole('complementary', { name: 'Confirm 4 pilot sites and contacts' });
  await expect(brief).toContainText('Brief for this task');
  await expect(brief).toContainText('Confirmed · PIL-11');
  await expect(brief).toContainText('Outbound messages stay drafts — not authorized to send');
  await expect(brief.getByRole('button', { name: 'Mark done' })).toBeVisible();
  await expectAccessible();

  await page.getByRole('button', { name: /Weekly deployment-effort log \(C2\)/ }).click();
  await expect(page).toHaveURL(/item=/);
  await expect(page.getByRole('complementary', { name: 'Weekly deployment-effort log (C2)' })).toContainText(
    'Condition C2 asks for a weekly log per site.',
  );

  // Keyboard: arrow keys move between tabs.
  await tabs.getByRole('tab', { name: /Tasks/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: /Reviews/ })).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByRole('complementary', { name: 'Confirm channel reach for Austrian breweries' }),
  ).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: /Approvals/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/tab=approvals/);
  await expect(page.getByText('No approvals for you')).toBeVisible();
  await expect(page.getByText(/Owning tasks does not include approval rights\./)).toBeVisible();
  await expectAccessible();
});

test('Elena lands on Reviews › Awaiting your decision with the scoped G2 ask', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('elena');
  await expect(page).toHaveURL(/\/reviews\?tab=awaiting$/);
  const list = page.getByRole('list', { name: 'Gate decisions awaiting you' });
  await expect(list.getByRole('link', { name: /Approve pilot €120k · 90 days/ })).toContainText('ME-104');
  await expect(list).toContainText('Due today, 27 Nov');
  await expectAccessible();
  await list.getByRole('link', { name: /Approve pilot €120k · 90 days/ }).click();
  await expect(page).toHaveURL(/\/me\/cases\/ME-104\/decisions\?gate=G2&version=3$/);
});

test('Daniel answers an economics review with a reason; it moves to Done', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('daniel');
  await expect(page).toHaveURL(/\/reviews\?tab=economics$/);
  const panel = page.getByRole('region', { name: 'Economics review · margin definition and opex scope' });
  await expect(panel).toContainText('Opex scope: €600k/year incremental sales and admin');
  await expectAccessible();
  await panel.getByRole('button', { name: 'Confirm' }).click();
  await expect(panel.getByRole('button', { name: 'Record: Confirm' })).toBeDisabled();
  await panel.getByLabel('Reason (required)').fill('Margin and opex scope match the finance model.');
  await panel.getByRole('button', { name: 'Record: Confirm' }).click();
  await expect(panel.getByRole('status')).toContainText(
    'You responded: Confirm — Margin and opex scope match the finance model.',
  );
  await page.getByRole('tab', { name: /Done/ }).click();
  await expect(page.getByRole('list', { name: 'Done' })).toContainText('Responded');
  await expectAccessible();
});
