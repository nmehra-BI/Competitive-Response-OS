/**
 * Aster journey, acceptance steps 1–5 (BUILD_PLAN §8) for S01, S03 and S04, with an axe check on
 * every screen. Runs against the MSW fixture mocks by default (aster-start for discovery) and
 * against the real API with E2E_BASE_URL and a fresh `aster-start` seed.
 */
import { expect, test } from './support/fixtures';

test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

test('steps 1–5: Maya logs in, triages candidates, compares and converts OPP-07 to ME-104', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  // 1 · Persona picker → Overview (operator) behind the illustrative-data ribbon.
  await loginAs('maya');
  await expect(page).toHaveURL(/\/me\/overview\?view=operator$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Operator overview' })).toBeVisible();
  await expect(page.getByRole('note', { name: 'Illustrative data notice' })).toContainText(
    'Illustrative data — synthetic',
  );
  await expect(
    page.getByText('Showing BU Water · cases you can access · hidden cases are not counted'),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Market sizes are not totalled across cases. Each case has its own market boundary, unit and year.',
    ),
  ).toBeVisible();
  await expectAccessible();

  // 2 · Opportunities for MD-21: partial discovery, AI proposals, likely duplicate.
  await page.getByRole('link', { name: 'Opportunities', exact: true }).first().click();
  await expect(page).toHaveURL(/\/me\/opportunities/);
  await expect(
    page.getByRole('status').filter({ hasText: 'Discovery partial — 1 source unavailable' }),
  ).toContainText('Trade registry');
  const table = page.getByRole('table', { name: 'Opportunity candidates' });
  const opp07 = table.getByRole('row').filter({ hasText: 'OPP-07' });
  await expect(opp07).toContainText('Proposed · AI');
  await expect(page.getByText(/not an exhaustive search/)).toBeVisible();
  await table.getByRole('button', { name: /German dairy plants/ }).click();
  await expect(page).toHaveURL(/selected=OPP-12/);
  const detail = page.getByRole('complementary', { name: 'German dairy plants' });
  await expect(detail.getByRole('status')).toContainText('Likely duplicate of OPP-07');
  await expectAccessible();

  // 3 · Merge OPP-12 into OPP-07 (kept, linked); shortlist OPP-07 with the `s` key.
  await detail.getByRole('button', { name: /Merge into OPP-07/ }).click();
  await expect(detail.getByText('Merged into OPP-07. Both records are kept and linked.')).toBeVisible();
  await expect(detail.getByText('Duplicate', { exact: true }).first()).toBeVisible();
  await table.getByRole('button', { name: /German food-processing plants/ }).click();
  const d07 = page.getByRole('complementary', { name: 'German food-processing plants' });
  await expect(d07.getByRole('button', { name: /Shortlist/ })).toBeVisible();
  await page.keyboard.press('s');
  await expect(d07.getByText('Shortlisted', { exact: true })).toBeVisible();
  await expect(d07.getByRole('button', { name: 'Convert to case' })).toBeVisible();
  // The merged candidate stays visible under the Dismissed · Duplicate filter.
  await page.getByRole('button', { name: 'Dismissed · Duplicate' }).click();
  await expect(table.getByRole('row').filter({ hasText: 'OPP-12' })).toContainText('Duplicate');
  await page.getByRole('button', { name: 'Active', exact: true }).click();

  // 4 · Compare OPP-07, OPP-14, OPP-09, OPP-16.
  for (const k of ['OPP-07', 'OPP-14', 'OPP-09', 'OPP-16']) {
    await table.getByRole('checkbox', { name: new RegExp(`^Compare ${k}`) }).check();
  }
  await page.getByRole('link', { name: 'Compare selected (4)' }).click();
  await expect(page).toHaveURL(/\/me\/opportunities\/compare\?ids=OPP-07,OPP-14,OPP-09,OPP-16&comparison=/);
  await expect(page.getByRole('heading', { level: 1, name: 'Compare 4 candidates' })).toBeVisible();
  const grid = page.getByRole('table', { name: 'Candidate comparison' });
  const rankRow = grid.getByRole('row').filter({ hasText: 'Weighted ranking' });
  await expect(page.getByText('Aggregate ranking blocked — incomparable market boundary')).toBeVisible();
  await expect(rankRow.getByText('Not ranked — boundary conflict in set')).toHaveCount(4);
  // Unknown is a tag, never 0.
  await expect(grid.getByText('Unknown', { exact: true }).first()).toBeVisible();
  await expect(grid.getByRole('cell', { name: /^0$/ })).toHaveCount(0);
  await expect(
    page.getByText(/Score = Product fit × w₁ \+ Channel access × w₂ \+ Evidence coverage × w₃/),
  ).toBeVisible();
  await expectAccessible();

  await page.getByRole('button', { name: 'Exclude until normalized' }).click();
  await expect(page.getByText('Austrian breweries excluded from ranking until normalized')).toBeVisible();
  const cells = rankRow.getByRole('cell');
  await expect(cells.nth(0)).toContainText('Rank 1 of 2');
  await expect(cells.nth(0)).toContainText('Score 2.70 of 3');
  await expect(cells.nth(1)).toContainText('Not ranked — 1 input missing (channel access)');
  await expect(cells.nth(2)).toContainText('Excluded until normalized');
  await expect(cells.nth(3)).toContainText('Rank 2 of 2');
  await expect(cells.nth(3)).toContainText('Score 1.70 of 3');

  // Preview weights before applying; an invalid total ranks nothing.
  await page.getByRole('button', { name: 'Increase Product fit weight' }).click();
  await expect(page.getByText('Total 110% — must be 100%')).toBeVisible();
  await expect(cells.nth(0)).toContainText('Weights must total 100%');
  await page.getByRole('button', { name: 'Decrease Channel access weight' }).click();
  await expect(
    page.getByText('Previewing unapplied weights in the ranking row.', { exact: false }),
  ).toBeVisible();
  await expect(cells.nth(0)).toContainText('Score 2.70 of 3');
  await page.getByRole('button', { name: 'Apply weights' }).click();
  await expect(page).toHaveURL(/weights=v2/);
  await expect(page.getByText('Applied: weights v2 · Fit 50% · Access 20% · Evidence 30%')).toBeVisible();
  await expectAccessible();

  // 5 · Convert OPP-07 (owner Maya) → ME-104 in Discovery; rail shows G0 Approved (5 Oct).
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Opportunities' })
    .click();
  await table.getByRole('button', { name: /German food-processing plants/ }).click();
  await d07.getByRole('button', { name: 'Convert to case' }).click();
  await expect(d07.getByRole('option', { name: /Maya Rao/ })).toHaveAttribute('aria-selected', 'true');
  await d07.getByRole('button', { name: 'Convert to case' }).click();
  await expect(d07.getByText('Converted to case ME-104')).toBeVisible();
  await expect(d07.getByText('Owner Maya Rao · stage Discovery.', { exact: false })).toBeVisible();
  await expectAccessible();
  await d07.getByRole('link', { name: 'Open case' }).click();
  await expect(page).toHaveURL(/\/me\/cases\/ME-104\/thesis$/);
  const rail = page.getByRole('list', { name: 'Stage and gate rail' });
  await expect(rail).toContainText('Approved');
  await expect(rail).toContainText('Mandate · 5 Oct');
  await expect(page.getByText('Discovery', { exact: true }).first()).toBeVisible();
});
