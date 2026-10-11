/**
 * D-180 · every entry point to the decision package (G1, G2, X), the decision brief and Outcomes on
 * the REAL stack lands on its screen, never on "This page could not be found.". Before the fix the case
 * header "Open decision package" and S01 "Decisions awaiting you" linked to `/me/cases/ME-104/decision`
 * (no such route), "Review preconditions" to `/gates` or `/assumptions`, and Outcomes showed the
 * not-found banner whenever no outcome review existed yet (the API's 404 for "no review").
 *
 * aster-demo (ME-104, G2 v3 awaiting Elena), then the pilot activated and the window over (dev clock),
 * then a case created through S01 "New case" on aster-start.
 */
import type { Page } from '@playwright/test';
import { businessUnits, products, segments } from '@growth-os/fixtures-aster';
import { expect, test } from '../support/fixtures';
import { activateDemoPilot } from '../support/journey';
import { advanceClock, resetStack, sqlRows } from '../support/real';

test.describe.configure({ mode: 'serial' });

const CASE = '/me/cases/ME-104';
const NOT_FOUND = 'This page could not be found.';

/** Track API 404s so a failure names the call that caused it. */
function track404(page: Page): string[] {
  const seen: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/') && r.status() === 404) seen.push(`${r.request().method()} ${r.url()}`);
  });
  return seen;
}

async function settled(page: Page) {
  await page.getByRole('main').waitFor();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
}

async function expectFound(page: Page) {
  await settled(page);
  await expect(page.getByText(NOT_FOUND)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
}

/** The S10 package of `gate` is on screen. */
async function expectPackage(page: Page, gate: 'G1' | 'G2' | 'X', opts: { bare?: boolean } = {}) {
  await expect(page).toHaveURL(
    opts.bare
      ? /\/me\/cases\/ME-104\/decisions$/
      : new RegExp(`/me/cases/ME-104/decisions\\?gate=${gate}(&|$)`),
  );
  await expectFound(page);
  await expect(page.getByRole('article', { name: 'Decision package' })).toContainText(`${gate} · Snapshot v`);
}

async function expectOutcomes(page: Page) {
  await expect(page).toHaveURL(/\/me\/cases\/ME-104\/outcomes(\?|$)/);
  await expectFound(page);
  await expect(page.getByText('Baseline versus actuals').first()).toBeVisible();
}

const caseHeader = (page: Page) => page.getByRole('region', { name: 'Case header' });

test.describe('aster-demo', () => {
  test.beforeAll(() => resetStack('aster-demo'));

  test('the G2 package opens from the Reviews inbox, My Work, S01, the case header and the tabs', async ({
    page,
    loginAs,
  }) => {
    const api404 = track404(page);
    // Elena (sponsor) · Reviews inbox "Awaiting your decision".
    await loginAs('elena', '/reviews?tab=awaiting');
    await settled(page);
    await page.getByRole('list', { name: 'Gate decisions awaiting you' }).getByRole('link').first().click();
    await expectPackage(page, 'G2');

    // My Work › Approvals.
    await page.goto('/my-work?tab=approvals');
    await settled(page);
    await page.getByRole('list', { name: 'Gate decisions awaiting you' }).getByRole('link').first().click();
    await expectPackage(page, 'G2');

    // S01 "Decisions awaiting you": the card and "Open decision brief".
    for (const name of [/Approve pilot €120k · 90 days/, 'Open decision brief']) {
      await page.goto('/me/overview');
      await settled(page);
      await page
        .getByRole('region', { name: 'Decisions awaiting you' })
        .getByRole('link', { name })
        .first()
        .click();
      await expectPackage(page, 'G2');
    }

    // Case header "Next decision" → "Open decision package", as the sponsor and as the owner.
    for (const who of ['elena', 'maya'] as const) {
      await loginAs(who, `${CASE}/thesis`);
      await settled(page);
      await caseHeader(page).getByRole('link', { name: 'Open decision package' }).click();
      await expectPackage(page, 'G2');
    }

    // Maya (owner) · the Decisions tab, then S09 "Open pilot package".
    await page.goto(`${CASE}/thesis`);
    await settled(page);
    await page
      .getByRole('navigation', { name: 'Case sections' })
      .getByRole('link', { name: 'Decisions' })
      .click();
    await expectPackage(page, 'G2', { bare: true }); // the bare tab opens the next decision
    await page.goto(`${CASE}/validation`);
    await settled(page);
    await page.getByRole('link', { name: 'Open pilot package' }).click();
    await expectPackage(page, 'G2');

    // The printable brief and back to the package.
    await page.getByRole('link', { name: 'Open printable decision brief' }).click();
    await expect(page).toHaveURL(/\/me\/cases\/ME-104\/brief\?gate=G2&version=3$/);
    await expectFound(page);
    await page.getByRole('link', { name: 'Open in Decisions' }).click();
    await expectPackage(page, 'G2');

    // The gate rail is not a link (no stale or UUID hrefs to follow).
    await expect(caseHeader(page).locator('.case-rail a')).toHaveCount(0);
    expect(api404).toEqual([]);
  });

  test('the G1 package opens from the G1 history on Decisions', async ({ page, loginAs }) => {
    const api404 = track404(page);
    await loginAs('maya', `${CASE}/decisions?gate=G1`);
    await expectPackage(page, 'G1');
    await loginAs('elena', `${CASE}/decisions?gate=G1&version=1`);
    await expectPackage(page, 'G1');
    // The S09 G1 card's "Open decision package" and the header link while G1 awaits a decision are
    // clicked in aster-journey.spec.ts step 10 (G1 is pending only there).
    expect(api404).toEqual([]);
  });

  test('before the pilot: Outcomes shows "No outcome review yet" with the next action', async ({
    page,
    loginAs,
  }) => {
    for (const who of ['maya', 'elena', 'jonas'] as const) {
      await loginAs(who, `${CASE}/thesis`);
      await settled(page);
      await page
        .getByRole('navigation', { name: 'Case sections' })
        .getByRole('link', { name: 'Outcomes' })
        .click();
      await expect(page).toHaveURL(/\/me\/cases\/ME-104\/outcomes$/);
      await expectFound(page);
      await expect(page.getByRole('heading', { name: 'No outcome review yet' })).toBeVisible();
    }
    await page.getByRole('link', { name: 'Open G2 request' }).click();
    await expectPackage(page, 'G2');
    // ?gate=X before any extension: an empty state that points to Outcomes, not "not found".
    await page.goto(`${CASE}/decisions?gate=X`);
    await expectFound(page);
    await expect(page.getByRole('heading', { name: 'No X request yet' })).toBeVisible();
    await page.getByRole('link', { name: 'Open Outcomes' }).click();
    await expect(page.getByRole('heading', { name: 'No outcome review yet' })).toBeVisible();
  });

  test('a hidden case still reads "This page could not be found." (never-rule 8)', async ({
    page,
    loginAs,
  }) => {
    await loginAs('admin', `${CASE}/outcomes`);
    await expect(page.getByText(NOT_FOUND).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No outcome review yet' })).toHaveCount(0);
    await page.goto(`${CASE}/decisions?gate=G2`);
    await expect(page.getByText(NOT_FOUND).first()).toBeVisible();
    await expect(page.getByRole('article', { name: 'Decision package' })).toHaveCount(0);
  });

  test('after the pilot window: Outcomes from S01 and the tab; the X package from S12, the inbox and S01', async ({
    page,
    loginAs,
  }) => {
    test.setTimeout(180_000);
    const api404 = track404(page);
    await activateDemoPilot(page, (who) => loginAs(who));
    await advanceClock(page, '2027-03-01T09:00:00+01:00');
    await expect
      .poll(
        async () =>
          (
            await sqlRows<{ stage: string }>(
              `SELECT stage FROM platform.workflow_case WHERE display_key = 'ME-104'`,
            )
          )[0]?.stage,
        { timeout: 30_000 },
      )
      .toBe('review_due');
    api404.length = 0;

    // S01 "Pilots needing review" and the Outcomes tab, as the pilot owner, the case owner and the sponsor.
    for (const who of ['jonas', 'maya', 'elena'] as const) {
      await loginAs(who, '/me/overview');
      await settled(page);
      await page
        .getByRole('region', { name: 'Pilots needing review' })
        .getByRole('link', { name: /ME-104/ })
        .click();
      await expectOutcomes(page);
      await page.goto(`${CASE}/pilot`);
      await settled(page);
      await page
        .getByRole('navigation', { name: 'Case sections' })
        .getByRole('link', { name: 'Outcomes' })
        .click();
      await expectOutcomes(page);
    }

    // The review to the extension (S12): actuals, recommendation, decision, "Request extension".
    await loginAs('jonas', `${CASE}/outcomes`);
    await settled(page);
    for (const [label, actual, source, value] of [
      ['Paid use and continuation', '3 of 4', 'billing records', '3'],
      ['Deployment effort per site', '22 hours per site', 'effort log (C2)', '22'],
      ['Buyer fit', 'Mixed', 'interview notes', undefined],
    ] as const) {
      await page.getByRole('button', { name: `Record actual for ${label}` }).click();
      const d = page.getByRole('dialog');
      await d.getByLabel('Actual (required)').fill(actual);
      if (value) await d.getByLabel(/^Value in/).fill(value);
      await d.getByLabel('Period start (required)').fill('2026-12-01');
      await d.getByLabel('Period end (required)').fill('2027-02-28');
      await d.getByLabel('Source (required)').fill(source);
      await d.getByRole('button', { name: 'Record actual' }).click();
      await expect(d).toHaveCount(0);
    }
    await loginAs('maya', `${CASE}/outcomes`);
    await settled(page);
    await page
      .getByLabel('Why (required)')
      .fill('Not scale. Test deployment effort and the fourth site first.');
    await page
      .getByRole('textbox', { name: /^Causal limitations/ })
      .fill('4 self-selected sites, no control group');
    await page.getByRole('button', { name: 'Save recommendation' }).click();
    await expect(page.getByText(/RECOMMENDATION · NOT A DECISION/)).toBeVisible();
    await loginAs('elena', `${CASE}/outcomes`);
    await settled(page);
    await page.getByRole('button', { name: 'Record decision: Revise and extend validation' }).click();
    const d = page.getByRole('dialog');
    await d.getByRole('textbox').fill('On Maya Rao’s recommendation: test effort and the fourth site first.');
    await d.getByRole('button', { name: 'Record decision: Revise and extend validation' }).click();
    await expect(
      page.getByRole('heading', { name: 'Decision recorded: Revise and extend validation' }),
    ).toBeVisible();
    await loginAs('maya', `${CASE}/outcomes`);
    await settled(page);
    await page.getByRole('button', { name: 'Request extension €[cap]' }).click();
    await page.getByPlaceholder('€[cap]').fill('30000');
    await page.getByPlaceholder('[duration] days').fill('45');
    await page.getByRole('button', { name: 'Submit extension request €30k' }).click();
    await expect(page.getByText(/Awaiting decision · Elena Fischer/)).toBeVisible();

    // S12 "Open ME-104-X1 in Decisions" (after a reload the review carries the X request).
    await page.reload();
    await settled(page);
    await page.getByRole('link', { name: /^Open ME-104-X\d+ in Decisions$/ }).click();
    await expectPackage(page, 'X');
    // The X brief (X is not on the rail; the brief finds it through the outcome review).
    await page.getByRole('link', { name: 'Open printable decision brief' }).click();
    await expect(page).toHaveURL(/\/me\/cases\/ME-104\/brief\?gate=X&version=\d+$/);
    await expectFound(page);
    await expect(page.getByRole('article', { name: 'Decision package' })).toContainText('X · Snapshot v');
    await page.getByRole('link', { name: 'Open in Decisions' }).click();
    await expectPackage(page, 'X');

    // Elena: Reviews inbox, My Work and S01 open the X package.
    await loginAs('elena', '/reviews?tab=awaiting');
    await settled(page);
    await page
      .getByRole('list', { name: 'Gate decisions awaiting you' })
      .getByRole('link', { name: /Approve extension/ })
      .click();
    await expectPackage(page, 'X');
    await page.goto('/my-work?tab=approvals');
    await settled(page);
    await page
      .getByRole('list', { name: 'Gate decisions awaiting you' })
      .getByRole('link', { name: /Approve extension/ })
      .click();
    await expectPackage(page, 'X');
    await page.goto('/me/overview');
    await settled(page);
    await page
      .getByRole('region', { name: 'Decisions awaiting you' })
      .getByRole('link', { name: /Approve extension/ })
      .click();
    await expectPackage(page, 'X');
    expect(api404).toEqual([]);
  });
});

test.describe('a case created through S01 "New case"', () => {
  test.beforeAll(() => resetStack('aster-start'));

  test('Decisions, the brief and Outcomes show empty states with the next action, never "not found"', async ({
    page,
    loginAs,
    expectAccessible,
  }) => {
    await loginAs('maya', '/me/overview');
    await settled(page);
    await page.getByRole('button', { name: 'New case' }).click();
    const nc = page.getByRole('form', { name: 'New expansion case' });
    await nc.getByLabel('Case title (required)').fill('Austrian breweries — water monitoring');
    await nc.getByLabel('Business unit').selectOption({ label: businessUnits[0].name });
    await nc.getByLabel('Product').selectOption({ label: products[0].name });
    await nc.getByLabel('Segment').selectOption({ label: segments[0].name });
    await nc.getByLabel('Geography').selectOption({ label: 'Germany' });
    await nc.getByRole('button', { name: 'Create case' }).click();
    await page.waitForURL(/\/me\/cases\/ME-\d+\/thesis$/);
    const key = /\/me\/cases\/(ME-\d+)\//.exec(page.url())![1]!;
    const base = `/me/cases/${key}`;
    await expectFound(page);

    // Case header "Review preconditions": the new case is at G0, prepared on its mandate.
    await caseHeader(page).getByRole('link', { name: 'Review preconditions' }).click();
    await expect(page).toHaveURL(/\/me\/mandates\/MD-\d+$/);
    await expectFound(page);

    // Decisions tab (bare) and each gate: an empty state, not "not found".
    await page.goto(`${base}/thesis`);
    await settled(page);
    await page
      .getByRole('navigation', { name: 'Case sections' })
      .getByRole('link', { name: 'Decisions' })
      .click();
    await expect(page).toHaveURL(new RegExp(`${base}/decisions$`));
    await expectFound(page);
    for (const gate of ['G0', 'G1', 'X'] as const) {
      await page.goto(`${base}/decisions?gate=${gate}`);
      await expectFound(page);
      await expect(page.getByRole('heading', { name: `No ${gate} request yet` })).toBeVisible();
    }
    await page.goto(`${base}/decisions?gate=G1`);
    await settled(page);
    await page.getByRole('link', { name: 'Open Validation' }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/validation$`));
    await expectFound(page);
    // G2 for the owner: the request is prepared here (no "not found").
    await page.goto(`${base}/decisions?gate=G2`);
    await expectFound(page);
    // The brief with no request: an empty state for a readable case.
    for (const gate of ['G1', 'X'] as const) {
      await page.goto(`${base}/brief?gate=${gate}`);
      await expectFound(page);
      await expect(page.getByRole('heading', { name: `No ${gate} decision package yet` })).toBeVisible();
    }

    // Outcomes tab: "No outcome review yet" with the next action.
    await page.goto(`${base}/thesis`);
    await settled(page);
    await page
      .getByRole('navigation', { name: 'Case sections' })
      .getByRole('link', { name: 'Outcomes' })
      .click();
    await expect(page).toHaveURL(new RegExp(`${base}/outcomes$`));
    await expectFound(page);
    await expect(page.getByRole('heading', { name: 'No outcome review yet' })).toBeVisible();
    await expectAccessible();
    await page.getByRole('link', { name: 'Open G2 request' }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/decisions\\?gate=G2$`));
    await expectFound(page);

    // The sponsor sees the same empty states on the new case.
    await loginAs('elena', `${base}/outcomes`);
    await expectFound(page);
    await expect(page.getByRole('heading', { name: 'No outcome review yet' })).toBeVisible();
    await page.goto(`${base}/decisions`);
    await expectFound(page);
  });
});
