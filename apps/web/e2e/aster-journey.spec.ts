/**
 * The Aster journey — BUILD_PLAN §8, all 30 acceptance steps — against the REAL stack (D-092): API +
 * worker + Postgres seeded fresh with `aster-start`, the fixture analysis provider and the simulated
 * Jira connector, MSW off. Each step asserts the UI copy and the API state, plus the audit and analytics
 * events where the script names them; every screen is checked with axe (WCAG 2.2 AA).
 *
 * The steps run in order in one serial describe: each test continues the database state of the one
 * before. The dev clock (D-091) walks the journey moments (G2 in late November, the pilot window end).
 */
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { enterAssessmentInputs, enterPilotTasks } from './support/journey';
import {
  advanceClock,
  analytics,
  apiCall,
  auditActions,
  resetStack,
  setConnectorFaults,
  simulatedIssues,
  sqlRows,
} from './support/real';

test.describe.configure({ mode: 'serial' });

const CASE = '/me/cases/ME-104';

test.beforeAll(() => resetStack('aster-start'));

async function settled(page: Page) {
  await page.getByRole('main').waitFor();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

async function caseRow() {
  const rows = await sqlRows<{ id: string; stage: string }>(
    `SELECT id, stage FROM platform.workflow_case WHERE display_key = 'ME-104'`,
  );
  return rows[0];
}

test('steps 1–5: Maya triages MD-21 candidates, compares and converts OPP-07 to ME-104', async ({
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
  await settled(page);
  await expectAccessible();

  // 2 · Opportunities for MD-21: partial discovery, AI proposals, likely duplicate.
  await page.getByRole('link', { name: 'Opportunities', exact: true }).first().click();
  await expect(page).toHaveURL(/\/me\/opportunities/);
  await expect(
    page.getByRole('status').filter({ hasText: 'Discovery partial — 1 source unavailable' }),
  ).toContainText('Trade registry');
  const table = page.getByRole('table', { name: 'Opportunity candidates' });
  await expect(table.getByRole('row').filter({ hasText: 'OPP-07' })).toContainText('Proposed · AI');
  await table.getByRole('button', { name: /German dairy plants/ }).click();
  const detail = page.getByRole('complementary', { name: 'German dairy plants' });
  await expect(detail.getByRole('status')).toContainText('Likely duplicate of OPP-07');
  await expectAccessible();

  // 3 · Merge OPP-12 into OPP-07 (kept, linked); shortlist OPP-07 with `s`.
  await detail.getByRole('button', { name: /Merge into OPP-07/ }).click();
  await expect(detail.getByText('Merged into OPP-07. Both records are kept and linked.')).toBeVisible();
  await table.getByRole('button', { name: /German food-processing plants/ }).click();
  const d07 = page.getByRole('complementary', { name: 'German food-processing plants' });
  await expect(d07.getByRole('button', { name: /Shortlist/ })).toBeVisible();
  await page.keyboard.press('s');
  await expect(d07.getByText('Shortlisted', { exact: true })).toBeVisible();
  const opp = await sqlRows<{ display_key: string; status: string; duplicate_of: string | null }>(
    `SELECT o.display_key, o.status, d.display_key AS duplicate_of FROM me.opportunity o
       LEFT JOIN me.opportunity d ON d.id = o.duplicate_of_id WHERE o.display_key IN ('OPP-07','OPP-12')
      ORDER BY o.display_key`,
  );
  expect(opp).toEqual([
    { display_key: 'OPP-07', status: 'shortlisted', duplicate_of: null },
    { display_key: 'OPP-12', status: 'duplicate', duplicate_of: 'OPP-07' },
  ]);
  expect(await analytics('opportunity_shortlisted')).toHaveLength(1);

  // 4 · Compare OPP-07, OPP-14, OPP-09, OPP-16: OPP-09 blocks ranking until excluded; Unknown never 0.
  for (const k of ['OPP-07', 'OPP-14', 'OPP-09', 'OPP-16'])
    await table.getByRole('checkbox', { name: new RegExp(`^Compare ${k}`) }).check();
  await page.getByRole('link', { name: 'Compare selected (4)' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Compare 4 candidates' })).toBeVisible();
  const grid = page.getByRole('table', { name: 'Candidate comparison' });
  const rankRow = grid.getByRole('row').filter({ hasText: 'Weighted ranking' });
  await expect(page.getByText('Aggregate ranking blocked — incomparable market boundary')).toBeVisible();
  await expect(page.getByText(/Uses company counts and 2024 prices/).first()).toBeVisible();
  await expect(rankRow.getByText('Not ranked — boundary conflict in set')).toHaveCount(4);
  await expect(grid.getByText('Unknown', { exact: true }).first()).toBeVisible();
  await expect(grid.getByRole('cell', { name: /^0$/ })).toHaveCount(0);
  await expectAccessible();
  await page.getByRole('button', { name: 'Exclude until normalized' }).click();
  await expect(page.getByText('Austrian breweries excluded from ranking until normalized')).toBeVisible();
  const cells = rankRow.getByRole('cell');
  await expect(cells.nth(0)).toContainText('Rank 1 of 2');
  await expect(cells.nth(1)).toContainText('Not ranked — 1 input missing (channel access)');
  await expect(cells.nth(2)).toContainText('Excluded until normalized');
  await expect(cells.nth(3)).toContainText('Rank 2 of 2');
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
  await d07.getByRole('link', { name: 'Open case' }).click();
  await expect(page).toHaveURL(/\/me\/cases\/ME-104\/thesis$/);
  const rail = page.getByRole('list', { name: 'Stage and gate rail' });
  await expect(rail).toContainText('Approved');
  await expect(rail).toContainText('Mandate · 5 Oct');
  expect((await caseRow())?.stage).toBe('discovery');
  expect(await auditActions('ME-104')).toContain('case.created');
  await settled(page);
  await expectAccessible();
});

test('steps 6–8: Maya starts the assessment; ladder, SAM > TAM block and undo, commit v2 and lineage', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya', `${CASE}/thesis`);
  // The first assumption register, sizing model (v1) and economics model (v1): no screen exists for
  // this data entry yet (PQ-17), so the real endpoints are called as Maya (D-095).
  await enterAssessmentInputs(page, 'ME-104');

  // 6 · Start assessment; open Sizing.
  await page.reload();
  await page.getByRole('button', { name: 'Start assessment' }).click();
  await expect(page.getByRole('button', { name: 'Start assessment' })).toHaveCount(0);
  expect((await caseRow())?.stage).toBe('assessment');
  await page.getByRole('navigation', { name: 'Case sections' }).getByRole('link', { name: 'Sizing' }).click();
  const rung = (name: string) => page.getByRole('group', { name, exact: true });
  await expect(rung('TAM')).toContainText('5,000 unique sites');
  await expect(rung('TAM')).toContainText('€100m/year');
  await expect(rung('SAM')).toContainText('2,000 unique sites');
  await expect(rung('SAM')).toContainText('€40m/year');
  await expect(rung('Reachable pool')).toContainText('500 unique sites');
  await expect(rung('Reachable pool')).toContainText('—');
  await expect(rung('SOM · Base · Year 3')).toContainText('100 customers');
  await expect(rung('SOM · Base · Year 3')).toContainText('€2.0m annual revenue');
  await expect(page.getByRole('group', { name: 'Formula for SAM' })).toContainText(
    '(1,400 + 1,100 − 500) × €20,000',
  );
  await expect(page.locator('[data-measure]')).toHaveCount(4);
  await expect(page.getByRole('group', { name: /total/i })).toHaveCount(0);
  await settled(page);
  await expectAccessible();

  // 7 · Variant: TAM edited to 500 → "Blocking: SAM is larger than TAM"; commit disabled; undo restores.
  await page.getByRole('button', { name: 'Edit draft input' }).click();
  const form = page.getByRole('form', { name: 'Edit a draft input' });
  await form.getByLabel(/New value/).fill('500');
  await form.getByRole('button', { name: 'Save to draft' }).click();
  await expect(page.getByText('Blocking: SAM is larger than TAM')).toBeVisible();
  await expect(page.locator('[data-measure]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create snapshot v2' })).toBeDisabled();
  await expectAccessible();
  await page.getByRole('button', { name: 'Undo edit' }).click();
  await expect(page.getByText('Blocking: SAM is larger than TAM')).toHaveCount(0);
  await expect(rung('SAM')).toContainText('€40m/year');

  // 8 · Commit sizing v2; lineage on SAM: exact €40,000,000, inputs one level, used by SOM and economics.
  await page.getByRole('button', { name: 'Create snapshot v2' }).click();
  await expect(page.getByText(/Snapshot v2 · committed/)).toBeVisible();
  const versions = await sqlRows<{ version: number; state: string }>(
    `SELECT s.version, s.state FROM me.sizing_version s JOIN platform.workflow_case c ON c.id = s.case_id
      WHERE c.display_key = 'ME-104' ORDER BY s.version`,
  );
  expect(versions).toEqual([
    { version: 1, state: 'committed' },
    { version: 2, state: 'committed' },
  ]);
  expect(await analytics('sizing_snapshot_created')).toHaveLength(2);
  await page.getByRole('button', { name: 'Lineage for SAM' }).click();
  const drawer = page.getByRole('dialog', { name: 'SAM' });
  await expect(drawer).toContainText('€40,000,000');
  await expect(drawer).toContainText('Inputs · one level');
  // "Used by SOM, economics" in the script: the engine computes SOM from the reachable pool (an
  // operational subset of SAM, entered), so no figure is calculated from SAM. The drawer says so
  // honestly (PQ-18); the reachable pool lists SOM and economics.
  await expect(drawer).toContainText('No other calculated figure uses this value.');
  await expect(drawer).toContainText(/v2 · €40,000,000\/year/);
  await expectAccessible();
  await page.keyboard.press('Escape');
});

test('step 9: Daniel disputes 20% adoption with a 10% proposal; scenario table and money cards', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('daniel', `${CASE}/economics`);
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
  await expect(page.getByText('€400k one-time')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Cash flow' })).toContainText('Not available');
  await expect(page.getByRole('group', { name: 'Payback' })).toContainText('Not available');
  await settled(page);
  await expectAccessible();

  const before = (await analytics('assumption_changed')).length;
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
  expect((await analytics('assumption_changed')).length).toBe(before + 1);
  await expectAccessible();
  // Daniel signs his words as dissent so every later package carries them (step 17).
  await page.goto(`${CASE}/validation`);
  await settled(page);
  const panel = page.getByRole('region', { name: /Dispute · Adoption 20% by year 3/ });
  await panel.getByRole('button', { name: 'Sign as dissent' }).click();
  await expect(panel.getByRole('status')).toContainText('Signed as dissent');
  expect(await auditActions('ME-104')).toContain('dissent.recorded');
});

test('steps 10–12: EXP-03 and G1; Elena approves validation €15k; VAL tasks drafted, previewed and confirmed', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  // 10 · Maya creates EXP-03 with pre-registered thresholds and submits G1.
  await loginAs('maya', `${CASE}/validation`);
  await settled(page);
  await page.getByRole('button', { name: 'Create experiment' }).click();
  const form = page.getByRole('form', { name: 'New validation experiment' });
  await form.getByLabel('Title').fill('Validation outreach · 20 sites');
  await form
    .getByLabel('Hypothesis')
    .fill('At least 4 of 20 selected sites sign a paid pilot commitment; at least 8 complete an interview.');
  await form.getByLabel('Method').fill('Partner-led outreach and discovery interviews');
  await form.getByLabel('Sample', { exact: false }).first().fill('20 sites from the 500-site reachable pool');
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
  await form.getByRole('option', { name: /Jonas Klein/ }).click();
  await expectAccessible();
  await form.getByRole('button', { name: 'Create experiment' }).click();
  const card = page.locator('[data-experiment="EXP-03"]');
  await expect(card).toContainText('Draft · locks when G1 approves');
  const g1 = page.getByRole('region', { name: /G1 · Approve validation €15k/ });
  await expect(g1).toContainText('Comparable sizing committed');
  await g1.getByRole('button', { name: 'Submit G1 · Approve validation €15k' }).click();
  await expect(g1).toContainText('Snapshot v1');
  const [snap] = await sqlRows<{ hash: string; version: number }>(
    `SELECT s.content_hash AS hash, s.version FROM platform.decision_snapshot s
       JOIN platform.gate_request g ON g.id = s.gate_request_id WHERE g.gate_code = 'G1'`,
  );
  expect(snap?.version).toBe(1);
  // The fingerprint on screen is the first 8 hex characters of the stored SHA-256.
  const fp = `${snap!.hash.slice(0, 4)}·${snap!.hash.slice(4, 8)}`.toUpperCase();
  await expect(g1).toContainText(fp);
  expect(await analytics('gate_submitted')).toHaveLength(1);
  await expectAccessible();

  // 11 · Elena: Reviews › Awaiting → "Approve validation €15k" with rationale → stage Validation; plan locked.
  await loginAs('elena');
  await expect(page).toHaveURL(/\/reviews\?tab=awaiting/);
  await page
    .getByRole('link', { name: /Approve validation €15k/ })
    .first()
    .click();
  await settled(page);
  const panel = page.getByRole('complementary', { name: 'Approval panel' });
  await expect(panel).toContainText('What this authorizes');
  await expect(panel).toContainText('What this does not authorize');
  await expectAccessible();
  await panel.getByRole('button', { name: 'Approve validation €15k' }).click();
  await panel
    .getByLabel(/Rationale/)
    .fill('Bounded spend, clear thresholds, outcome changes the G2 decision.');
  await panel.getByRole('button', { name: 'Approve validation €15k' }).click();
  await expect(panel.locator('[data-status="approved"]')).toBeVisible();
  expect((await caseRow())?.stage).toBe('validation');
  expect(await analytics('validation_authorized')).toHaveLength(1);
  expect((await analytics('gate_approved')).map((e) => e.props)).toContainEqual(
    expect.objectContaining({ gate: 'G1' }),
  );
  const [exp] = await sqlRows<{ lifecycle: string }>(
    `SELECT lifecycle FROM me.experiment WHERE display_key = 'EXP-03'`,
  );
  expect(exp?.lifecycle).toBe('locked');

  // 12 · Maya previews the five drafted validation tasks and creates them in Jira (ME-VAL).
  await loginAs('maya', `${CASE}/validation?experiment=EXP-03`);
  await settled(page);
  await expect(page.locator('[data-experiment="EXP-03"]')).toContainText('Plan locked at G1');
  const tasks = page.getByRole('list', { name: 'Validation tasks' });
  await expect(tasks.getByText('Not sent')).toHaveCount(5);
  await page.getByRole('button', { name: 'Preview tasks' }).click();
  await expect(page.getByText('Preview · nothing sent yet')).toBeVisible();
  await expect(page.getByText(/project ME-VAL/).first()).toBeVisible();
  await expectAccessible();
  await page.getByRole('button', { name: 'Create 5 tasks in Jira' }).click();
  await expect(page.getByText('5 of 5 tasks confirmed in Jira')).toBeVisible({ timeout: 30_000 });
  for (let n = 1; n <= 5; n++) await expect(tasks.getByText(`VAL-${n}`, { exact: true })).toHaveCount(1);
  expect(await simulatedIssues(page, 'VAL-')).toHaveLength(5);
  expect(await analytics('external_task_confirmed')).toHaveLength(5);
  await expectAccessible();
  // Fieldwork starts under the G1 approval (the locked plan cannot change; amendments stay possible).
  await page.locator('[data-experiment="EXP-03"]').getByRole('button', { name: 'Start fieldwork' }).click();
  await expect(
    page.locator('[data-experiment="EXP-03"]').getByRole('button', { name: 'Record results' }),
  ).toBeVisible();
  const [running] = await sqlRows<{ lifecycle: string }>(
    `SELECT lifecycle FROM me.experiment WHERE display_key = 'EXP-03'`,
  );
  expect(running?.lifecycle).toBe('running');
});

test('steps 13–16: amend the window, record results, specialist and finance sign-offs', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  // 13 · Amend EXP-03's window to 20 Nov with a reason; the original stays visible.
  await loginAs('maya', `${CASE}/validation?experiment=EXP-03`);
  await settled(page);
  const card = page.locator('[data-experiment="EXP-03"]');
  await card.getByRole('button', { name: 'Amend plan' }).click();
  await card.getByLabel('New window end').fill('2026-11-20');
  await card
    .getByLabel(/Reason/)
    .fill('Window extended by 7 days: two sites rescheduled. Thresholds unchanged.');
  await card.getByRole('button', { name: 'Save amendment' }).click();
  await expect(card.locator('del')).toHaveText('19 Oct – 13 Nov');
  await expect(card).toContainText('Original (pre-registered)');
  await expect(card).toContainText('19 Oct – 20 Nov');
  await expect(card).toContainText('Amendment 1');
  await expectAccessible();

  // 14 · Record results at the end of the amended window (dev clock: 20 Nov 2026).
  await advanceClock(page, '2026-11-20T17:00:00+01:00');
  await page.reload();
  await settled(page);
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
  await expect(card).toContainText('20 selected sites are not a random sample');
  expect(await analytics('experiment_completed')).toHaveLength(1);
  await expectAccessible();

  // 15 · Lena signs the specialist review for the pilot scope only.
  await loginAs('lena', `${CASE}/feasibility`);
  await settled(page);
  const table = page.getByRole('table', { name: 'Readiness checklist' });
  const spec = table
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: /^Specialist review/ }) });
  await spec.getByRole('button', { name: 'Record review' }).click();
  const sign = page.getByRole('form', { name: /Record your review · Specialist review/ });
  await sign.getByLabel('Position').selectOption('supports_with_conditions');
  await sign.getByLabel('Covers gate').selectOption('G2');
  await sign.getByLabel(/Up to sites/).fill('4');
  await sign.getByLabel(/Up to days/).fill('90');
  await sign.getByLabel(/Scope of sign-off/).fill('pilot only: up to 4 sites, 90 days');
  await sign.getByRole('button', { name: 'Record review' }).click();
  await expect(spec).toContainText('Signed');
  await expect(spec).toContainText('pilot only: up to 4 sites, 90 days');
  expect((await analytics('feasibility_review_recorded')).map((e) => e.props)).toContainEqual({
    area: 'specialist',
    scoped: true,
  });
  await expectAccessible();

  // 16 · Maya asks Daniel for the finance review; Daniel signs with checked / not-checked lists.
  await loginAs('maya', `${CASE}/economics`);
  await settled(page);
  await page.getByRole('button', { name: 'Request finance review' }).click();
  const req = page.getByRole('form', { name: 'Request finance review' });
  await req.getByLabel('Finance reviewer').selectOption({ label: 'Daniel Weber' });
  await req.getByRole('button', { name: /Request review of snapshot v1/ }).click();
  await expect(page.getByRole('complementary', { name: 'Finance review' })).toContainText(
    'Finance review · Daniel Weber',
  );
  await loginAs('daniel', `${CASE}/economics`);
  await settled(page);
  const fin = page.getByRole('form', { name: 'Sign finance review' });
  await fin.getByLabel('Your position').selectOption('supports_with_conditions');
  await fin.getByLabel(/^Checked/).fill('Margin definition\nOpex scope\nCurrency EUR 2026');
  await fin.getByLabel(/^Not checked/).fill('Ramp, retention, cash timing (not in model)');
  await fin.getByLabel(/Statement/).fill('Supports with conditions: the Downside case must stay visible.');
  await fin.getByRole('button', { name: 'Sign finance review' }).click();
  const aside = page.getByRole('complementary', { name: 'Finance review' });
  await expect(aside).toContainText('Supports with conditions');
  await expect(aside).toContainText('Margin definition · Opex scope · Currency EUR 2026');
  await expect(aside).toContainText('Ramp, retention, cash timing (not in model)');
  expect((await analytics('feasibility_review_recorded')).map((e) => e.props)).toContainEqual({
    area: 'finance',
    scoped: true,
  });
  await expectAccessible();
});

const G2_LABEL = 'Approve pilot €120k · 90 days';

/** PRD §6 pilot criteria (fixtures/aster outcomeTargets), entered on S10 as written. */
const PILOT_THRESHOLDS = [
  {
    name: 'Paid use and continuation',
    text: '4 of 4 pilot customers',
    operator: 'gte',
    value: '4',
    unit: 'customers',
    window: '1 Dec 2026 – 28 Feb 2027',
  },
  {
    // D-110 §4: Aster assumes 16 installation and support hours per site.
    name: 'Deployment effort per site',
    text: 'Within 16 hours per site',
    operator: 'lte',
    value: '16',
    unit: 'hours_per_site',
    window: 'weekly log',
  },
  {
    name: 'Buyer fit',
    text: 'Qualitative · interview notes',
    operator: 'qualitative',
    value: '',
    unit: 'text',
    window: 'Feb interviews',
  },
] as const;

async function g2Ids() {
  const [g] = await sqlRows<{ id: string; status: string }>(
    `SELECT id, status FROM platform.gate_request WHERE gate_code = 'G2'`,
  );
  const snaps = await sqlRows<{ id: string; version: number; hash: string; status: string }>(
    `SELECT id, version, content_hash AS hash, status FROM platform.decision_snapshot
      WHERE gate_request_id = $1 ORDER BY version`,
    [g!.id],
  );
  return { gate: g!, snaps };
}

test('steps 17–18: Maya prepares and submits G2; the package carries dissent; she cannot approve it', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  // The journey moment of the G2 request (dev clock, D-091).
  await loginAs('maya');
  await advanceClock(page, '2026-11-26T09:00:00+01:00');

  // 17 · Prepare the G2 package: €120k, 90 days, Jonas owns the pilot, C1 proposed; submit.
  await page.goto(`${CASE}/decisions?gate=G2`);
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
  // Pre-registered pilot thresholds (D-102): frozen with the first G2 snapshot.
  for (const t of PILOT_THRESHOLDS) {
    await form.getByLabel('Measure', { exact: true }).fill(t.name);
    await form.getByLabel(/^Threshold \(as written/).fill(t.text);
    await form.getByLabel('Rule').selectOption(t.operator);
    await form.getByLabel(/^Threshold value/).fill(t.value);
    await form.getByLabel(/^Unit/).fill(t.unit);
    await form.getByLabel(/^Measured over/).fill(t.window);
    await form.getByRole('button', { name: 'Add threshold' }).click();
  }
  await expect(form.getByRole('list', { name: 'Pilot thresholds' }).getByRole('listitem')).toHaveCount(3);
  await form
    .getByLabel('Condition', { exact: true })
    .fill('Pilot limited to 4 sites as signed by the specialist');
  await form.getByLabel('Condition owner').selectOption({ label: 'Jonas Klein' });
  await form.getByRole('button', { name: 'Add condition' }).click();
  await expect(form).toContainText('C1');
  await expectAccessible();
  await form.getByRole('button', { name: 'Save draft request' }).click();
  const draft = page.getByRole('region', { name: new RegExp(`G2 · ${G2_LABEL}`) });
  await expect(draft).toContainText('Validation results recorded');
  await draft.getByRole('button', { name: 'Submit for decision' }).click();

  const pkg = page.getByRole('article', { name: 'Decision package' });
  // Snapshot versions are numbered per case: G1 took v1, so the first G2 snapshot is v2 (the fixture
  // narrative's v3 follows one more G2 round that only aster-demo carries; the demo-based
  // stale-approval spec walks v3 → v4).
  await expect(pkg).toContainText('Snapshot v2');
  await expect(pkg).toContainText('Jonas Klein');
  const { gate, snaps } = await g2Ids();
  const fp = `${snaps[0]!.hash.slice(0, 4)}·${snaps[0]!.hash.slice(4, 8)}`.toUpperCase();
  await expect(pkg).toContainText(fp);
  await expect(pkg.getByRole('region', { name: /Dissent/ })).toContainText(
    'I do not see comparable evidence for 20% adoption in this segment.',
  );
  await expect(page.getByRole('region', { name: 'Case header' })).toContainText('Pilot approval pending');
  expect((await caseRow())?.stage).toBe('pilot_approval_pending');
  const targets = await sqlRows<{ name: string; threshold_text: string }>(
    `SELECT name, threshold_text FROM platform.outcome_target WHERE snapshot_id = $1 ORDER BY metric_key`,
    [snaps[0]!.id],
  );
  expect(targets.map((t) => t.name)).toEqual([
    'Buyer fit',
    'Deployment effort per site',
    'Paid use and continuation',
  ]);
  expect((await analytics('gate_submitted')).map((e) => e.props)).toContainEqual(
    expect.objectContaining({ gate: 'G2' }),
  );
  await expectAccessible();

  // 18 · The author is never offered approval; a forced request is refused.
  const panel = page.getByRole('complementary', { name: 'Approval panel' });
  await expect(panel).toContainText('You authored this package and cannot approve it.');
  await expect(panel.getByRole('button', { name: /Approve pilot/ })).toHaveCount(0);
  const forced = await apiCall<{ code: string }>(page, 'POST', `/me/gate-requests/${gate.id}/decisions`, {
    snapshotId: snaps[0]!.id,
    snapshotHash: snaps[0]!.hash,
    disposition: 'approve',
    rationale: 'Forced',
    note: null,
    conditions: [],
    delegateToUserId: null,
  });
  expect(forced.status).toBe(403);
  expect(forced.json.code).toBe('SELF_APPROVAL_PROHIBITED');
});

test('steps 19–20: a Base adoption change makes v2 stale; refresh creates v3; Elena approves with C1 and C2', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  // 19 · Maya changes Base adoption (a new assumption version with a reason).
  await loginAs('maya', `${CASE}/validation`);
  await settled(page);
  await page.getByRole('button', { name: 'Change value · Adoption 20% by year 3' }).click();
  const change = page.getByRole('form', { name: 'Change value · Adoption 20% by year 3' });
  await change.getByLabel(/New value/).fill('18');
  await change.getByLabel(/Reason/).fill('Base adoption revised after the review');
  await change.getByRole('button', { name: 'Save new version' }).click();
  await expect(change).toHaveCount(0);
  const before = await g2Ids();
  expect(before.snaps.map((s) => s.status)).toEqual(['stale']);

  await loginAs('elena', `${CASE}/decisions?gate=G2`);
  await settled(page);
  await expect(
    page.getByText(/This snapshot is out of date: adoption assumption changed on 26 Nov/),
  ).toBeVisible();
  const panel = page.getByRole('complementary', { name: 'Approval panel' });
  await expect(panel.getByRole('button', { name: G2_LABEL })).toBeDisabled();
  await expect(panel).toContainText('Approval disabled: snapshot v2 is out of date. Refresh to create v3.');
  await page.getByRole('button', { name: 'See what changed' }).click();
  const changed = page.getByRole('list', { name: 'What changed' });
  await expect(changed).toContainText('Adoption 20% by year 3: 20% → 18%');
  await expect(changed).not.toContainText('assumption version');
  await expectAccessible();

  await loginAs('maya', `${CASE}/decisions?gate=G2`);
  await settled(page);
  await page.getByRole('button', { name: 'Refresh snapshot (creates v3)' }).click();
  await expect(page.getByText('Snapshot v3 created from the current committed inputs.')).toBeVisible();
  const after = await g2Ids();
  expect(after.snaps.map((s) => [s.version, s.status])).toEqual([
    [2, 'superseded'],
    [3, 'current'],
  ]);

  // 20 · Elena approves "Approve pilot €120k · 90 days" on v3 with C1 (blocks) and C2 (monitor).
  await loginAs('elena', `${CASE}/decisions?gate=G2`);
  await settled(page);
  await expect(page.getByRole('article', { name: 'Decision package' })).toContainText('Snapshot v3');
  await panel.getByRole('button', { name: G2_LABEL }).click();
  await panel
    .getByLabel(/Rationale/)
    .fill('Thresholds met; bounded pilot tests the disputed adoption assumption.');
  await panel.getByLabel('Condition', { exact: true }).fill('Log deployment effort per site every week');
  await panel.getByLabel('Condition owner').selectOption({ label: 'Jonas Klein' });
  await panel.getByRole('radiogroup', { name: 'Effect of the condition' }).getByRole('radio').nth(1).check();
  await panel.getByRole('button', { name: 'Add condition' }).click();
  await expectAccessible();
  await panel.getByRole('button', { name: G2_LABEL }).click();
  await expect(panel).toContainText(/Approved with conditions · 2 conditions/);
  await expect(panel).toContainText('Pilot approved for v3 only');
  await expect(panel).toContainText(/If unused by \d{1,2} Dec 2026/);
  await expect(page.getByRole('region', { name: 'Case header' })).toContainText('Pilot approved');
  const conditions = page.getByRole('region', { name: /Conditions/ });
  await expect(conditions).toContainText('Blocks execution until met');
  await expect(conditions).toContainText('Monitor only');
  expect((await caseRow())?.stage).toBe('pilot_approved');
  expect((await analytics('gate_approved')).map((e) => e.props)).toContainEqual(
    expect.objectContaining({ gate: 'G2' }),
  );
  await expectAccessible();
});

const PILOT = `${CASE}/pilot`;
const OUTCOMES = `${CASE}/outcomes`;

test('steps 21–24: activation blockers, permission fault on task 2, retry only it, timeout reconciled', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('jonas');
  // The six PRD pilot tasks of the drafted plan, task 2 without an owner (no task editor yet, PQ-17).
  await enterPilotTasks(page, 'ME-104');

  // 21 · Activation is blocked by the missing owner and the open C1, both listed by the server.
  await page.goto(PILOT);
  await settled(page);
  await expect(page.getByRole('heading', { name: 'Approved baseline · pinned' })).toBeVisible();
  await expect(page.getByText('Missing owner blocks activation')).toBeVisible();
  await expect(page.getByText('Task 2 · Install monitoring at 4 sites has no owner').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate approved plan' })).toBeDisabled();
  const forced = await apiCall<{ code: string; blockers: { key: string }[] }>(
    page,
    'POST',
    '/me/cases/ME-104/pilot-plan/activate',
  );
  expect(forced.status).toBe(409);
  expect(forced.json.code).toBe('PRECONDITIONS_UNMET');
  expect(forced.json.blockers).toHaveLength(2);
  await expectAccessible();
  await page.getByRole('button', { name: 'Assign owner to Install monitoring at 4 sites' }).click();
  const owner = page.getByRole('dialog');
  await owner.getByRole('option', { name: /Operations lead/ }).click();
  await owner.getByRole('button', { name: 'Save owner' }).click();
  await expect(page.getByText('Open condition C1 blocks activation')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate approved plan' })).toBeDisabled();
  await page.getByRole('button', { name: 'Mark C1 met' }).click();
  const c1 = page.getByRole('dialog');
  await c1.getByRole('textbox').fill('Signed site list limited to 4 sites');
  await c1.getByRole('button', { name: 'Mark C1 met' }).click();
  await page.getByRole('button', { name: 'Activate approved plan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Activate approved plan' }).click();
  await expect(page.getByRole('button', { name: 'Preview tasks' })).toBeVisible();
  expect((await caseRow())?.stage).toBe('pilot_running');
  expect((await analytics('pilot_activated')).map((e) => e.props)).toEqual([{ tasks: 6 }]);

  // 22 + 24 · A permission fault on task 2's assignee, and a timeout after success on task 3.
  await setConnectorFaults(page, [
    { mode: 'permission_denied', match: { assignee: 'operations.lead@aster.example' }, times: 10 },
    { mode: 'timeout_after_success', match: { titleContains: 'Adapt dashboards' }, times: 1 },
  ]);
  await page.getByRole('button', { name: 'Preview tasks' }).click();
  await expect(page.getByRole('heading', { name: 'Preview · nothing has been sent' })).toBeVisible();
  await expect(page.getByText('Create and assign issues · as Jonas Klein')).toBeVisible();
  await expectAccessible();
  await page.getByRole('button', { name: 'Create 6 tasks in Jira' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '5 of 6 tasks confirmed in Jira · 1 failed (permission)' }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/synced/i)).toHaveCount(0);
  expect(await analytics('external_task_failed')).toHaveLength(1);
  // 24 · The ambiguous send went to Checking, was reconciled by key, and was confirmed once.
  const audit = await auditActions('ME-104');
  expect(audit).toContain('task_sync.checking');
  expect((await simulatedIssues(page, 'PIL-')).length).toBe(5);
  await expectAccessible();

  // 23 · Fix the mapping (admin; no mapping editor on S14 yet, PQ-11), then retry only the failed task.
  await loginAs('admin', '/admin/health');
  const conns = await apiCall<{
    mappings: { id: string; purpose: string; connectionId: string; assigneeMap: Record<string, string> }[];
  }>(page, 'GET', '/admin/connections');
  const pil = conns.json.mappings.find((m) => m.purpose === 'pilot_tasks')!;
  const fixed = await apiCall(page, 'PUT', `/admin/connector-mappings/${pil.id}`, {
    connectionId: pil.connectionId,
    purpose: 'pilot_tasks',
    destinationProject: 'PIL',
    issueType: 'Task',
    assigneeMap: { ...pil.assigneeMap, 'a57e0003-0000-4000-8000-000000000008': 'ops.pilot@aster.example' },
  });
  expect(fixed.status).toBe(200);
  await loginAs('jonas', PILOT);
  await settled(page);
  await page.getByRole('button', { name: 'Retry 1 failed task' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: '6 of 6 tasks confirmed in Jira' })).toBeVisible({
    timeout: 60_000,
  });
  // PIL-n keys (PQ-15): exactly six issues, one per idempotency key, each shown once.
  const issues = await simulatedIssues(page, 'PIL-');
  expect(issues).toHaveLength(6);
  expect(new Set(issues.map((i) => i.idempotencyKey)).size).toBe(6);
  for (const i of issues) await expect(page.getByText(i.key, { exact: true })).toHaveCount(1);
  expect(await analytics('external_task_confirmed')).toHaveLength(5 + 6);
  await expectAccessible();
});

test('steps 25–28: actuals, recommendation, decision and extension; scale stays blocked', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  // The pilot window ends (dev clock past 28 Feb 2027); the timer moves the case to Review due.
  await loginAs('jonas');
  await advanceClock(page, '2027-03-01T09:00:00+01:00');
  await expect.poll(async () => (await caseRow())?.stage, { timeout: 30_000 }).toBe('review_due');

  // 25 · Jonas records actuals with periods and sources.
  await page.goto(OUTCOMES);
  await settled(page);
  const rec = async (label: string, actual: string, source: string, value?: string) => {
    await page.getByRole('button', { name: `Record actual for ${label}` }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Actual (required)').fill(actual);
    if (value) await d.getByLabel(/^Value in/).fill(value);
    await d.getByLabel('Period start (required)').fill('2026-12-01');
    await d.getByLabel('Period end (required)').fill('2027-02-28');
    await d.getByLabel('Source (required)').fill(source);
    await d.getByRole('button', { name: 'Record actual' }).click();
    await expect(d).toHaveCount(0);
  };
  await rec('Paid use and continuation', '3 of 4', 'billing records', '3');
  // D-110 §4: 22 hours per site actual against 16 assumed → Not met.
  await rec('Deployment effort per site', '22 hours per site', 'effort log (C2)', '22');
  await rec('Buyer fit', 'Mixed', 'interview notes');
  const table = page.getByRole('table', { name: 'Baseline versus actuals' });
  await expect(table.getByText('Not met')).toHaveCount(2);
  await expect(table.getByText('Inconclusive')).toHaveCount(1);
  await expect(table.getByText('Source: billing records')).toBeVisible();
  expect(await analytics('outcome_recorded')).toHaveLength(3);
  await expectAccessible();

  // 26 · Maya recommends "Revise and extend validation" with causal limitations (not a decision).
  await loginAs('maya', OUTCOMES);
  await settled(page);
  await page
    .getByLabel('Why (required)')
    .fill('Not scale. Test deployment effort and the fourth site first.');
  await page
    .getByRole('textbox', { name: /^Causal limitations/ })
    .fill(
      '4 self-selected sites, no control group\nWinter install season inflates effort\nOne season of use only',
    );
  await page.getByRole('button', { name: 'Save recommendation' }).click();
  await expect(page.getByText(/RECOMMENDATION · NOT A DECISION/)).toBeVisible();
  await expect(page.getByText('4 self-selected sites, no control group')).toBeVisible();
  await expectAccessible();

  // 27 · Elena records the decision; Maya requests X1 at the decided €30k · 45 days (D-110 §2; it was the
  // €[cap] placeholder before). X1 stays "Awaiting decision" in the journey and is now approvable.
  await loginAs('elena', OUTCOMES);
  await settled(page);
  await page.getByRole('button', { name: 'Record decision: Revise and extend validation' }).click();
  const d = page.getByRole('dialog');
  await d
    .getByRole('textbox')
    .fill('On Maya Rao’s recommendation: test effort and the fourth site before any scale decision.');
  await d.getByRole('button', { name: 'Record decision: Revise and extend validation' }).click();
  await expect(
    page.getByRole('heading', { name: 'Decision recorded: Revise and extend validation' }),
  ).toBeVisible();
  expect((await caseRow())?.stage).toBe('validation');

  await loginAs('maya', OUTCOMES);
  await settled(page);
  await page.getByRole('button', { name: 'Request extension €[cap]' }).click();
  await page.getByPlaceholder('€[cap]').fill('30000');
  await page.getByPlaceholder('[duration] days').fill('45');
  await page.getByRole('button', { name: 'Submit extension request €30k' }).click();
  await expect(page.getByText(/Awaiting decision · Elena Fischer/)).toBeVisible();
  expect(await analytics('extension_requested')).toHaveLength(1);
  const [x1] = await sqlRows<{ status: string; requested_amount: string | null; duration_days: number }>(
    `SELECT status, requested_amount, duration_days FROM platform.gate_request WHERE gate_code = 'X'`,
  );
  expect(x1).toEqual({ status: 'awaiting_decision', requested_amount: '30000.00', duration_days: 45 });

  // 28 · "Request scale approval" is disabled with all four unmet G3 preconditions (D-039, PQ-1).
  await expect(page.getByRole('button', { name: 'Request scale approval' })).toBeDisabled();
  await expect(
    page.getByText(
      'G3 preconditions unmet: demand threshold 3 of 4 (4 of 4 required); specialist scale-readiness review incomplete; economics and capacity not updated after the pilot; no scale budget stated',
    ),
  ).toBeVisible();
  const g3 = await apiCall<{ code: string; blockers: { key: string }[] }>(
    page,
    'POST',
    '/me/cases/ME-104/gate-requests',
    {
      gateCode: 'G3',
      scope: {
        amount: null,
        currency: null,
        durationDays: null,
        windowStart: null,
        windowEnd: null,
        countryCodes: ['DE'],
        segmentLabel: null,
        maxSites: null,
        milestones: [],
        ownerId: null,
        authorizes: ['Scale'],
        doesNotAuthorize: ['Anything else'],
      },
      parentGateRequestId: null,
      proposedConditions: [],
    },
  );
  expect(g3.status).toBe(409);
  expect(g3.json.code).toBe('PRECONDITIONS_UNMET');
  expect(g3.json.blockers).toHaveLength(4);
  await expectAccessible();
});

test('steps 29–30: administration shows the authority gap and cannot approve; History in audit order', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  // 29 · Admin: "No G3 approver… Authority gap"; diagnostics show tool events only; FORBIDDEN on approve.
  await loginAs('admin', '/admin/health');
  await settled(page);
  await expect(page.getByText('Administrators cannot approve gates.')).toBeVisible();
  const authority = page.getByRole('table', { name: 'Delegated authority' });
  await expect(
    authority.getByRole('cell', { name: 'No G3 approver in BU Water · Authority gap' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Diagnostics' })).toContainText(
    'Traces show structured outputs and tool events, not hidden reasoning.',
  );
  await expectAccessible();
  const [x] = await sqlRows<{ id: string; snap: string; hash: string }>(
    `SELECT g.id, s.id AS snap, s.content_hash AS hash FROM platform.gate_request g
       JOIN platform.decision_snapshot s ON s.id = g.current_snapshot_id WHERE g.gate_code = 'X'`,
  );
  const forced = await apiCall<{ code: string }>(page, 'POST', `/me/gate-requests/${x!.id}/decisions`, {
    snapshotId: x!.snap,
    snapshotHash: x!.hash,
    disposition: 'approve',
    rationale: 'Admin tries to approve',
    note: null,
    conditions: [],
    delegateToUserId: null,
  });
  expect(forced.status).toBe(403);
  expect(forced.json.code).toBe('FORBIDDEN');

  // 30 · History lists the journey once, in audit order, with actor and version.
  await loginAs('maya', `${CASE}/history`);
  await settled(page);
  const history = page.getByRole('table', { name: 'Audit history' });
  await expect(history).toBeVisible();
  const seqs = (await history.locator('tbody tr td:first-child').allTextContents()).map(Number);
  expect(seqs.length).toBeGreaterThan(10);
  expect(new Set(seqs).size).toBe(seqs.length);
  const sorted = [...seqs].sort((a, b) => a - b);
  expect(seqs).toEqual(seqs[0]! < seqs[seqs.length - 1]! ? sorted : sorted.reverse());
  const actions = await auditActions('ME-104');
  for (const a of ['case.created', 'gate_request.submit', 'pilot.activated', 'outcome.decided'])
    expect(actions).toContain(a);
  expect(actions.filter((a) => a === 'pilot.activated')).toHaveLength(1);
  expect(actions.filter((a) => a === 'outcome.decided')).toHaveLength(1);
  await expectAccessible();
});
