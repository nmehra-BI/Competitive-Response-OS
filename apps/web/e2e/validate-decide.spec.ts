/**
 * WS8c · S09 Validation, S10 Decisions and the decision brief against the MSW mocks.
 * Acceptance script (BUILD_PLAN §8) steps 10–11, 13–14 and 17–20, the S10 variants
 * (FRONTEND §7) and axe (WCAG 2.2 AA) on every state.
 *
 * Journey state lives in the page's mock worker and is kept in sessionStorage, so a persona switch
 * (full page load) continues the same journey. `startAt(preset)` picks the moment.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';

const CASE = '/me/cases/ME-104';
const G2_ID = 'a57e0015-0000-4000-8000-000000000003';
const G2_V3_SNAPSHOT = 'a57e0016-0000-4000-8000-000000000003';
const ASM_01 = 'a57e000b-0000-4000-8000-000000000001';

type Preset =
  'start' | 'g1_approved' | 'g2_prep' | 'demo' | 'stale' | 'v4' | 'approved' | 'invalidated' | 'expired';

async function startAt(page: Page, preset: Preset) {
  await page.goto('/login');
  await page.evaluate((p) => {
    sessionStorage.removeItem('growth-os:ws8c-mock');
    sessionStorage.setItem('growth-os:ws8c-preset', p);
  }, preset);
}

async function settled(page: Page) {
  await page.getByRole('main').waitFor();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

/** A same-origin call through the mock worker, like a forced request from the browser. */
async function call(
  page: Page,
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return page.evaluate(
    async ({ method, path, body, headers }) => {
      const r = await fetch(`/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...headers },
        body: JSON.stringify(body),
      });
      return { status: r.status, json: (await r.json().catch(() => null)) as { code?: string } | null };
    },
    { method, path, body, headers },
  );
}

test.describe('S09 Validation', () => {
  test('steps 10–11: create EXP-03, submit G1; Elena approves "Approve validation €15k"', async ({
    page,
    loginAs,
    expectAccessible,
  }) => {
    await startAt(page, 'start');
    await loginAs('maya', `${CASE}/validation`);
    await settled(page);
    await expect(page.getByText('No validation experiment yet')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Illustrative example experiment' })).toContainText(
      'Illustrative example',
    );
    await expectAccessible();

    await page.getByRole('button', { name: 'Create experiment' }).click();
    const form = page.getByRole('form', { name: 'New validation experiment' });
    await form.getByLabel('Title').fill('Validation outreach · 20 sites');
    await form
      .getByLabel('Hypothesis')
      .fill(
        'At least 4 of 20 selected sites sign a paid pilot commitment; at least 8 complete an interview.',
      );
    await form.getByLabel('Method').fill('Partner-led outreach and discovery interviews');
    await form
      .getByLabel('Sample', { exact: false })
      .first()
      .fill('20 sites from the 500-site reachable pool');
    await form.getByLabel('Sample size (sites)').fill('20');
    await form.getByLabel('Window start').fill('2026-10-19');
    await form.getByLabel('Window end').fill('2026-11-13');
    await form.getByLabel('Budget (EUR)').fill('15000');
    await form.getByLabel('Metric 1', { exact: true }).fill('Completed discovery interviews');
    await form.getByLabel('Metric 1 threshold (≥)').fill('8');
    await form.getByLabel('Metric 1 unit').fill('interviews');
    await form.getByLabel('Metric 2', { exact: true }).fill('Paid pilot commitments');
    await form.getByLabel('Metric 2 threshold (≥)').fill('4');
    await form.getByLabel('Metric 2 unit').fill('commitments');
    await form.getByLabel('Decision rule').fill('≥ 4 commitments → prepare G2 pilot request');
    await form.getByRole('checkbox', { name: /Adoption 20% by year 3/ }).check();
    await expectAccessible();
    await form.getByRole('button', { name: 'Create experiment' }).click();

    const card = page.locator('[data-experiment="EXP-03"]');
    await expect(card).toContainText('Draft · locks when G1 approves');
    await expect(card).toContainText('≥ 8');
    const g1 = page.getByRole('region', { name: /G1 · Approve validation €15k/ });
    await expect(g1).toContainText('Comparable sizing committed');
    await g1.getByRole('button', { name: 'Submit G1 · Approve validation €15k' }).click();
    await expect(g1).toContainText('Snapshot v1');
    await expect(g1).toContainText('2B71·0E4D');
    await expectAccessible();

    // Step 11: the sponsor decides on S10.
    await loginAs('elena', `${CASE}/decisions?gate=G1`);
    await settled(page);
    const panel = page.getByRole('complementary', { name: 'Approval panel' });
    await expect(panel).toContainText('What this authorizes');
    await expect(panel).toContainText('What this does not authorize');
    await expect(panel).toContainText('Not a pilot');
    await expectAccessible();
    await panel.getByRole('button', { name: 'Approve validation €15k' }).click();
    await panel
      .getByLabel(/Rationale/)
      .fill('Bounded spend, clear thresholds, outcome changes the G2 decision.');
    await panel.getByRole('button', { name: 'Approve validation €15k' }).click();
    await expect(panel.locator('[data-status="approved"]')).toBeVisible();
    await expect(panel).toContainText('Validation approved for v1 only');
    await expect(page.locator('.case-row').first()).toContainText('Validation');

    await page.goto(`${CASE}/validation`);
    await settled(page);
    await expect(page.locator('[data-experiment="EXP-03"]')).toContainText('Plan locked at G1');
  });

  test('tasks, steps 13–14: preview and create VAL tasks, amend the window, record results', async ({
    page,
    loginAs,
    expectAccessible,
  }) => {
    await startAt(page, 'g1_approved');
    await loginAs('maya', `${CASE}/validation?experiment=EXP-03`);
    await settled(page);
    const tasks = page.getByRole('list', { name: 'Validation tasks' });
    await expect(tasks.getByText('Not sent')).toHaveCount(5);
    await page.getByRole('button', { name: 'Preview tasks' }).click();
    await expect(page.getByText('Preview · nothing sent yet')).toBeVisible();
    await expect(page.getByText(/project ME-VAL/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Create 5 tasks in Jira' }).click();
    await expect(tasks.getByText('VAL-5')).toBeVisible();
    await expect(page.getByText('5 of 5 tasks confirmed in Jira')).toBeVisible();

    // Step 13: amend the window with a reason; the original stays visible.
    const card = page.locator('[data-experiment="EXP-03"]');
    await card.getByRole('button', { name: 'Amend plan' }).click();
    await card.getByLabel('New window end').fill('2026-11-20');
    await card.getByLabel(/Reason/).fill('Window extended by 7 days: two sites rescheduled.');
    await card.getByRole('button', { name: 'Save amendment' }).click();
    await expect(card.locator('del')).toHaveText('19 Oct – 13 Nov');
    await expect(card).toContainText('Original (pre-registered)');
    await expect(card).toContainText('19 Oct – 20 Nov');
    await expect(card).toContainText('Amendment 1');
    await expectAccessible();

    // Step 14: record results with period and source.
    await card.getByRole('button', { name: 'Record results' }).click();
    await card.getByLabel(/Completed discovery interviews · observed/).fill('9');
    await card.getByLabel(/Paid pilot commitments · observed/).fill('4');
    await card.getByLabel(/^Source/).fill('partner log and signed commitments');
    await card.getByLabel(/Interpretation/).fill('Thresholds met. Supports a bounded pilot request.');
    await card
      .getByLabel(/Limitations/)
      .fill(
        'Interviews do not validate conversion or full-market demand. 20 selected sites are not a random sample.',
      );
    await card.getByRole('button', { name: 'Record results' }).click();
    await expect(card.locator('[data-status="Met"]').first()).toContainText('Met · 9 of 8');
    await expect(card.locator('[data-status="Met"]').nth(1)).toContainText('Met · 4 of 4');
    await expect(card).toContainText('19 Oct–20 Nov · partner log and signed commitments');
    await expect(card).toContainText('20 selected sites are not a random sample');
    await expect(page.getByRole('heading', { name: 'Next: G2 pilot request' })).toBeVisible();
    await expectAccessible();
  });

  test('disputed 20% adoption shows Daniel’s words; 2×2 view; register order', async ({
    page,
    loginAs,
    expectAccessible,
  }) => {
    await startAt(page, 'demo');
    await loginAs('maya', `${CASE}/validation`);
    await settled(page);
    const dispute = page.getByRole('region', { name: /Dispute · Adoption 20% by year 3/ });
    await expect(dispute).toContainText('I do not see comparable evidence for 20% adoption');
    await expect(dispute).toContainText('Only Daniel Weber or the sponsor can resolve this dispute.');
    const rows = page
      .getByRole('table', { name: 'Assumption register' })
      .locator('tbody tr[data-assumption]');
    await expect(rows.first()).toHaveAttribute('data-assumption', 'ASM-06');
    await expect(page.getByRole('table', { name: 'Assumption register' })).toContainText('Test first');
    await expectAccessible();
    await dispute.getByRole('button', { name: 'Close dispute' }).click();
    await expect(dispute).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Disputed by Daniel Weber: open the dispute on Adoption 20% by year 3' })
      .click();
    await expect(page.getByRole('heading', { name: /Dispute · Adoption 20%/ })).toBeFocused();
    await page.getByRole('button', { name: '2×2' }).click();
    await expect(page).toHaveURL(/view=2x2/);
    await expect(page.getByRole('group', { name: 'Assumption register · 2×2' })).toContainText(
      'Test first · high, weak evidence',
    );
    await expectAccessible();
  });
});

test.describe('S10 Decisions', () => {
  test('steps 17–18: Maya prepares and submits G2; v3 with dissent; she cannot approve', async ({
    page,
    loginAs,
    expectAccessible,
  }) => {
    await startAt(page, 'g2_prep');
    await loginAs('maya', `${CASE}/decisions?gate=G2`);
    await settled(page);
    const form = page.getByRole('form', { name: 'Prepare G2 · pilot request' });
    await form.getByLabel('Budget ceiling (EUR)').fill('120000');
    await form.getByLabel('Duration (days)').fill('90');
    await form.getByLabel('Up to sites').fill('4');
    await form.getByLabel('Window start').fill('2026-12-01');
    await form.getByLabel('Window end').fill('2027-02-28');
    await form.getByLabel(/Countries/).fill('DE');
    await form.getByLabel('Segment').fill('Food processing');
    await form
      .getByRole('listbox', { name: 'People' })
      .getByRole('option', { name: /Jonas Klein/ })
      .click();
    await form
      .getByLabel('What this authorizes')
      .fill(
        'Pilot at up to 4 German food-processing sites\nUp to €120k · 90 days\nCreating the approved pilot tasks',
      );
    await form
      .getByLabel('What this does not authorize')
      .fill('Not market entry\nNot scale\nNot prospect outreach\nNot spend above €120k');
    await form
      .getByLabel('Condition', { exact: true })
      .fill('Pilot limited to 4 sites as signed by the specialist');
    await form.getByLabel('Condition owner').selectOption({ label: 'Jonas Klein' });
    await form.getByRole('button', { name: 'Add condition' }).click();
    await expect(form).toContainText('C1');
    await expectAccessible();
    await form.getByRole('button', { name: 'Save draft request' }).click();

    const draft = page.getByRole('region', { name: /G2 · Approve pilot €120k · 90 days/ });
    await expect(draft).toContainText('Validation results recorded');
    await draft.getByRole('button', { name: 'Submit for decision' }).click();

    const pkg = page.getByRole('article', { name: 'Decision package' });
    await expect(pkg).toContainText('Snapshot v3');
    await expect(pkg).toContainText('7F3A·19C2');
    await expect(pkg.getByRole('region', { name: '10 · Dissent' })).toContainText(
      'I do not see comparable evidence for 20% adoption in this segment.',
    );
    await expect(page.getByRole('region', { name: 'Case header' })).toContainText('Pilot approval pending');

    // Step 18: the author is never offered approval; a forced request is refused.
    const panel = page.getByRole('complementary', { name: 'Approval panel' });
    await expect(panel).toContainText('You authored this package and cannot approve it.');
    await expect(panel.getByRole('button', { name: /Approve pilot/ })).toHaveCount(0);
    const forced = await call(page, 'POST', `/me/gate-requests/${G2_ID}/decisions`, {
      snapshotId: G2_V3_SNAPSHOT,
      snapshotHash: `7f3a19c2${'0'.repeat(56)}`,
      disposition: 'approve',
      rationale: 'Forced',
      note: null,
      conditions: [],
      delegateToUserId: null,
    });
    expect(forced.status).toBe(403);
    expect(forced.json?.code).toBe('SELF_APPROVAL_PROHIBITED');
    await expectAccessible();
  });

  test('steps 19–20: adoption change makes v3 stale; refresh creates v4; Elena approves with C1 and C2', async ({
    page,
    loginAs,
    expectAccessible,
  }) => {
    await startAt(page, 'demo');
    await loginAs('maya', `${CASE}/decisions?gate=G2`);
    await settled(page);
    const changed = await call(
      page,
      'PATCH',
      `/me/assumptions/${ASM_01}`,
      { value: '0.18', changeReason: 'Base adoption revised after the review' },
      { 'If-Match': '"1"' },
    );
    expect(changed.status).toBe(200);

    await loginAs('elena', `${CASE}/decisions?gate=G2`);
    await settled(page);
    await expect(
      page.getByText(
        'This snapshot is out of date: adoption assumption changed on 26 Nov. Approval is disabled.',
      ),
    ).toBeVisible();
    const panel = page.getByRole('complementary', { name: 'Approval panel' });
    await expect(panel.getByRole('button', { name: 'Approve pilot €120k · 90 days' })).toBeDisabled();
    await expect(panel).toContainText('Approval disabled: snapshot v3 is out of date. Refresh to create v4.');
    await page.getByRole('button', { name: 'See what changed' }).click();
    await expect(page.getByRole('list', { name: 'What changed' })).toContainText('Adoption assumption');
    await expectAccessible();

    await loginAs('maya', `${CASE}/decisions?gate=G2`);
    await settled(page);
    await page.getByRole('button', { name: 'Refresh snapshot (creates v4)' }).click();
    await expect(page.getByText('Snapshot v4 created from the current committed inputs.')).toBeVisible();
    await expect(page).toHaveURL(/version=4/);

    await loginAs('elena', `${CASE}/decisions?gate=G2`);
    await settled(page);
    await expect(page.getByRole('article', { name: 'Decision package' })).toContainText('Snapshot v4');
    await panel.getByRole('button', { name: 'Approve pilot €120k · 90 days' }).click();
    await panel
      .getByLabel(/Rationale/)
      .fill('Thresholds met; bounded pilot tests the disputed adoption assumption.');
    await expectAccessible();
    await panel.getByRole('button', { name: 'Approve pilot €120k · 90 days' }).click();
    await expect(panel).toContainText(/Approved with conditions · 2 conditions/);
    await expect(panel).toContainText('If unused by 27 Dec 2026');
    await expect(panel).toContainText('Pilot approved for v4 only');
    await expect(page.getByRole('region', { name: 'Case header' })).toContainText('Pilot approved');
    const conditions = page.getByRole('region', { name: /Conditions/ });
    await expect(conditions).toContainText('Blocks execution until met');
    await expect(conditions).toContainText('Monitor only');
    await expectAccessible();

    // v3 stays readable, superseded, never approvable.
    await page.goto(`${CASE}/decisions?gate=G2&version=3`);
    await settled(page);
    await expect(page.getByText(/Snapshot v3 is superseded by v4/)).toBeVisible();
  });

  test('variants: unauthorized reviewer, G1 history, invalidated, expired, superseded', async ({
    page,
    loginAs,
    expectAccessible,
  }) => {
    await startAt(page, 'demo');
    await loginAs('daniel', `${CASE}/decisions?gate=G2`);
    await settled(page);
    const panel = page.getByRole('complementary', { name: 'Approval panel' });
    await expect(panel).toContainText('Your role does not decide gates.');
    await expect(panel.getByRole('button', { name: /Approve pilot/ })).toHaveCount(0);

    await page.goto(`${CASE}/decisions?gate=G1`);
    await settled(page);
    const history = page.getByRole('region', { name: 'Gate history · ME-104' });
    await expect(history).toContainText('G1 · Approve validation €15k');
    await expect(history).toContainText('Superseded');
    await expectAccessible();

    await startAt(page, 'invalidated');
    await loginAs('elena', `${CASE}/decisions?gate=G2`);
    await settled(page);
    await expect(
      page.getByText('Approval for v4 no longer applies: adoption assumption changed. Pilot tasks paused.'),
    ).toBeVisible();
    await expect(panel.locator('[data-status="invalidated"]')).toBeVisible();
    await expectAccessible();

    await startAt(page, 'expired');
    await loginAs('elena', `${CASE}/decisions?gate=G2`);
    await settled(page);
    await expect(page.getByText('The approval for v4 expired unused on 27 Dec 2026.')).toBeVisible();
    await expect(panel.locator('[data-status="expired"]')).toBeVisible();

    await startAt(page, 'v4');
    await loginAs('elena', `${CASE}/decisions?gate=G2&version=3`);
    await settled(page);
    await expect(page.getByText(/Snapshot v3 is superseded by v4/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Approve pilot €120k · 90 days' })).toBeDisabled();
    await expectAccessible();
  });
});

test('decision brief is printable and read-only', async ({ page, loginAs, expectAccessible }) => {
  await startAt(page, 'approved');
  await loginAs('elena', `${CASE}/brief?gate=G2&version=4`);
  await settled(page);
  await expect(page.getByRole('article', { name: 'Decision package' })).toContainText('Snapshot v4');
  await expect(page.getByRole('region', { name: 'Decision record' })).toContainText(
    'Approve with conditions',
  );
  await expect(page.getByRole('button', { name: /Approve pilot/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Print decision brief' })).toBeVisible();
  await expectAccessible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
  await expect(page.getByRole('note', { name: 'Illustrative data notice' })).toBeVisible();
});
