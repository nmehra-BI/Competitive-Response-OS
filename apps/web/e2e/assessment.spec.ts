/**
 * WS8b · Assessment screens (S05–S08): Aster acceptance steps 6–9, the S06 blocking variants and
 * an axe check of every screen state. Runs on the MSW fixture mocks (E2E_MOCKS default on).
 */
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';

/** Variants live in the page's mock state, so switch them, then navigate without a reload. */
async function setAssessmentScenario(page: Page, scenario: Record<string, unknown>) {
  await page.evaluate((s) => {
    const m = (window as unknown as { __growthOsMocks?: { setScenario: (x: unknown) => void } })
      .__growthOsMocks;
    if (!m) throw new Error('needs the app running on MSW mocks');
    m.setScenario(s);
  }, scenario);
}

async function goClient(page: Page, url: string) {
  await page.evaluate((u) => {
    window.history.pushState({}, '', u);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);
  await expect(page).toHaveURL(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

const ladderRow = (page: Page, name: string) => page.getByRole('group', { name, exact: true });

test.describe('S06 Sizing', () => {
  test('step 6: the ladder, signed overlap and no total row', async ({ page, loginAs, expectAccessible }) => {
    await loginAs('maya', '/me/cases/ME-104/sizing');
    await expect(page.getByRole('heading', { name: 'Measure ladder' })).toBeVisible();
    await expect(ladderRow(page, 'TAM')).toContainText('5,000 unique sites');
    await expect(ladderRow(page, 'TAM')).toContainText('€100m/year');
    await expect(ladderRow(page, 'SAM')).toContainText('2,000 unique sites');
    await expect(ladderRow(page, 'SAM')).toContainText('€40m/year');
    await expect(ladderRow(page, 'Reachable pool')).toContainText('500 unique sites');
    await expect(ladderRow(page, 'Reachable pool')).toContainText('—');
    await expect(ladderRow(page, 'SOM · Base · Year 3')).toContainText('100 customers');
    await expect(ladderRow(page, 'SOM · Base · Year 3')).toContainText('€2.0m annual revenue');
    await expect(page.getByRole('group', { name: 'Formula for SAM' })).toContainText(
      '(1,400 + 1,100 − 500) × €20,000',
    );
    await expect(page.locator('[data-measure]')).toHaveCount(4);
    await expect(page.getByRole('group', { name: /total/i })).toHaveCount(0);
    await expectAccessible();
  });

  test('step 7: TAM edited to 500 blocks; ladder hidden; undo restores', async ({
    page,
    loginAs,
    expectAccessible,
  }) => {
    await loginAs('maya', '/me/cases/ME-104/sizing');
    await page.getByRole('button', { name: 'Edit draft input' }).click();
    const form = page.getByRole('form', { name: 'Edit a draft input' });
    await form.getByLabel(/New value/).fill('500');
    await form.getByRole('button', { name: 'Save to draft' }).click();
    await expect(page.getByText('Blocking: SAM is larger than TAM')).toBeVisible();
    await expect(page.getByText('Ladder values are hidden while a blocking check is open')).toBeVisible();
    await expect(page.locator('[data-measure]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create snapshot v2' })).toBeDisabled();
    await expect(page.getByText('Blocked: SAM above TAM.')).toBeVisible();
    await expectAccessible();
    await page.getByRole('button', { name: 'Undo edit' }).click();
    await expect(page.getByText('Blocking: SAM is larger than TAM')).toHaveCount(0);
    await expect(ladderRow(page, 'SAM')).toContainText('€40m/year');
  });

  test('step 8: commit v2; lineage on SAM shows exact value, inputs and used by', async ({
    page,
    loginAs,
    expectAccessible,
  }) => {
    await loginAs('maya', '/me/cases/ME-104/sizing');
    await page.getByRole('button', { name: 'Create snapshot v2' }).click();
    await expect(page.getByText(/Snapshot v2 · committed/)).toBeVisible();
    await page.getByRole('button', { name: 'Lineage for SAM' }).click();
    const drawer = page.getByRole('dialog', { name: 'SAM' });
    await expect(drawer).toContainText('€40,000,000');
    await expect(drawer).toContainText('Inputs · one level');
    await expect(drawer).toContainText('Size-qualified');
    await expect(drawer).toContainText('Overlap removed');
    await expect(drawer.getByRole('link', { name: 'SOM' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Economics' })).toBeVisible();
    await expect(page).toHaveURL(/input=sizing\.sam\.value&view=lineage/);
    await expectAccessible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });

  test('variant: duplicate cohort pauses the calculation until one is kept', async ({
    page,
    loginAs,
    expectAccessible,
  }) => {
    await loginAs('maya');
    await setAssessmentScenario(page, { sizingVariant: 'duplicate_cohort' });
    await goClient(page, '/me/cases/ME-104/sizing');
    await expect(page.getByText('Duplicate cohort — calculation paused')).toBeVisible();
    await expect(page.locator('[data-measure]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create snapshot v2' })).toBeDisabled();
    await expectAccessible();
    await page.getByRole('button', { name: 'Keep v1' }).click();
    await expect(page.getByText('Duplicate cohort — calculation paused')).toHaveCount(0);
    await expect(ladderRow(page, 'SAM')).toContainText('€40m/year');
  });

  test('variant: SAM > TAM preset shows no ladder values', async ({ page, loginAs }) => {
    await loginAs('maya');
    await setAssessmentScenario(page, { sizingVariant: 'sam_exceeds_tam' });
    await goClient(page, '/me/cases/ME-104/sizing');
    await expect(page.getByText('Blocking: SAM is larger than TAM')).toBeVisible();
    await expect(page.getByText('€40m/year')).toHaveCount(0);
    await expect(page.getByText('€100m/year')).toHaveCount(0);
  });

  test('variant: restricted site list for an aggregate-only viewer', async ({
    page,
    loginAs,
    expectAccessible,
  }) => {
    await loginAs('jonas', '/me/cases/ME-104/sizing');
    await expect(page.getByText('Site list restricted under your access')).toBeVisible();
    await expectAccessible();
  });

  test('top-down cross-check is a test, never averaged', async ({ page, loginAs }) => {
    await loginAs('maya', '/me/cases/ME-104/sizing');
    const xc = page.getByRole('region', { name: 'Top-down cross-check · SAM' });
    await expect(xc).toContainText('Never averaged with the model.');
    await xc.getByRole('button', { name: 'Table' }).click();
    await expect(xc.getByRole('table', { name: 'Cross-check table' })).toContainText('No average shown');
  });
});

test.describe('S08 Economics', () => {
  test('step 9: Daniel disputes 20% adoption; scenario table and money cards match the PRD', async ({
    page,
    loginAs,
    expectAccessible,
  }) => {
    await loginAs('daniel');
    await setAssessmentScenario(page, { adoptionDisputed: false });
    await goClient(page, '/me/cases/ME-104/economics');
    const table = page.getByRole('table', { name: 'Scenario table' });
    const row = (name: string) =>
      table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${name}`) }) });
    await expect(row('Annual revenue').getByRole('cell')).toHaveText(['€1.0m', '€2.0m', '€2.4m']);
    await expect(row('Gross contribution').getByRole('cell')).toHaveText(['€0.60m', '€1.20m', '€1.44m']);
    await expect(row('Annual incremental opex').getByRole('cell')).toHaveText(['€600k', '€600k', '€600k']);
    await expect(row('Contribution after incremental opex').getByRole('cell')).toHaveText([
      '€0k (break-even)',
      '€600k',
      '€840k',
    ]);
    await expect(table.getByRole('columnheader')).toHaveText(['Measure', '▼ Downside', '● Base', '▲ Upside']);
    await expect(page.getByRole('separator', { name: 'Different time bases. Do not add.' })).toBeVisible();
    await expect(page.getByText('€400k one-time')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Cash flow' })).toContainText('Not available');
    await expect(page.getByRole('group', { name: 'Payback' })).toContainText('Not available');
    await expectAccessible();

    await page.getByRole('button', { name: 'Dispute' }).click();
    const form = page.getByRole('form', { name: /^Dispute Adoption 20% by year 3/ });
    await form
      .getByLabel(/Why do you dispute this value/)
      .fill(
        'I do not see comparable evidence for 20% adoption in this segment. Plan on 10% until the pilot shows paid use.',
      );
    await form.getByLabel(/Proposed value/).fill('Downside adoption 10%');
    await form.getByRole('button', { name: 'Record dispute' }).click();
    const thread = page.getByRole('region', { name: /^Dispute · Adoption 20% by year 3/ });
    await expect(thread).toContainText('Disputed by Daniel Weber');
    await expect(thread).toContainText('Downside adoption 10%');
    await expect(row('What changes vs Base')).toContainText('Adoption 10% (50 of 500 sites)');
    await expectAccessible();
  });

  test('live recompute in the draft; snapshot v2 never changes', async ({ page, loginAs }) => {
    await loginAs('maya', '/me/cases/ME-104/economics');
    const table = page.getByRole('table', { name: 'Scenario table' });
    const revenue = table
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: /^Annual revenue/ }) });
    await page.getByLabel('Adoption by year 3 · Base').fill('22');
    await expect(revenue.getByRole('cell').nth(1)).toContainText('€2.2m');
    await expect(revenue.getByRole('cell').nth(1)).toContainText('Recalculated');
    await page.getByRole('button', { name: 'Snapshot v2' }).click();
    await expect(revenue.getByRole('cell')).toHaveText(['€1.0m', '€2.0m', '€2.4m']);
  });
});

test.describe('S05 Thesis and S07 Feasibility', () => {
  test('thesis: run status in business copy, claims with kinds, alternatives with No entry', async ({
    page,
    loginAs,
    expectAccessible,
  }) => {
    await loginAs('maya', '/me/cases/ME-104/thesis');
    await expect(page.getByRole('region', { name: 'Analysis status' })).toContainText(
      'Working: checking sources…',
    );
    await expect(page.getByRole('region', { name: 'Analysis status' })).not.toContainText('%');
    await expect(page.getByRole('table', { name: 'Alternatives' })).toContainText('No entry');
    await expect(page.getByText('Disputed by Daniel Weber').first()).toBeVisible();
    await expectAccessible();
  });

  test('feasibility: specialist stays pending — human review required; disagreement recorded', async ({
    page,
    loginAs,
    expectAccessible,
  }) => {
    await loginAs('maya', '/me/cases/ME-104/feasibility');
    const table = page.getByRole('table', { name: 'Readiness checklist' });
    const spec = table
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: /^Specialist review/ }) });
    await expect(spec).toContainText('Pending — human review required');
    await expect(spec).toContainText('AI cannot provide this review');
    await expect(
      page.getByText('No readiness score: each dimension stands on its own sign-off.'),
    ).toBeVisible();
    await expectAccessible();
    await page.getByRole('button', { name: 'Record disagreement · Operations' }).click();
    const form = page.getByRole('form', { name: 'Record disagreement · Operations' });
    await form
      .getByLabel(/Your position, in your own words/)
      .fill('Capacity model ignores winter installation limits.');
    await form.getByRole('button', { name: 'Record disagreement' }).click();
    await expect(table).toContainText('Capacity model ignores winter installation limits.');
  });
});
