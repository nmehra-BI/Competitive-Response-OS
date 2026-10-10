/**
 * Wave 4 · E1 (ticket 1, D-112 §2–§3) on the real stack from `aster-start`: an operator starts a case
 * alone. Maya creates a direct case, enters the S06 sizing model in the editor to the PRD §6 numbers
 * and commits sizing v1 (SAM €40m/year, 500 unique sites), then starts the S08 economics model,
 * notes the opex scope and commits economics v1 with the four scenario rows and the €400k one-time
 * investment apart. G1's "Comparable sizing committed" precondition is then met. Both editors are
 * axe-clean.
 *
 * The assumption register is entered through the API until E2's S09 "Add assumption" form lands
 * (WAVE4 §3 E1); the case is created through `cases.createDirect`, which has no S01 form yet.
 */
import { assumptions, businessUnits, products, segments } from '@growth-os/fixtures-aster';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { analytics, apiCall, auditActions, resetStack } from '../support/real';

test.beforeAll(() => resetStack('aster-start'));

const sourceId = async (page: Page, key: string) => {
  const r = await apiCall<{ source: { id: string } }>(page, 'GET', `/evidence/sources/${key}`);
  expect(r.status).toBe(200);
  return r.json.source.id;
};

async function registerAssumptions(page: Page, caseKey: string): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const a of assumptions) {
    const v = a as unknown as { value: string | null; valueText?: string; ownerId: string };
    const r = await apiCall<{ id: string }>(page, 'POST', `/me/cases/${caseKey}/assumptions`, {
      inputKey: a.inputKey,
      name: a.name,
      ownerId: v.ownerId,
      value: v.value,
      valueText: v.value === null ? (v.valueText ?? null) : null,
      unit: a.unit,
      basis: a.basis,
      sensitivity: a.sensitivity,
      decisionCritical: a.decisionCritical,
      consequenceIfFalse: a.consequenceIfFalse,
      validationMethod: a.validationMethod,
      dueOn: a.dueOn,
    });
    expect(r.status, `assumption ${a.key}`).toBe(201);
    ids[a.inputKey] = r.json.id;
  }
  return ids;
}

/** Wait until the editor's autosave has nothing pending. */
async function saved(editor: Locator) {
  await expect(editor.locator('[data-autosave]').first()).toHaveAttribute('data-autosave', 'saved', {
    timeout: 15_000,
  });
}

test('an operator builds sizing v1 and economics v1 for a new case in the editors alone', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya');
  const created = await apiCall<{ key: string }>(page, 'POST', '/me/cases', {
    businessUnitId: businessUnits[0].id,
    title: 'German food plants — water monitoring (editor)',
    mandate: {
      geographyCodes: ['DE'],
      segmentIds: [segments[0].id],
      productId: products[0].id,
      currency: 'EUR',
      horizonYears: 3,
    },
  });
  expect(created.status).toBe(201);
  const caseKey = created.json.key;
  const asm = await registerAssumptions(page, caseKey);
  const src14 = await sourceId(page, 'SRC-014');
  const src21 = await sourceId(page, 'SRC-021');

  // ---- S06 sizing editor ---------------------------------------------------------------------
  await page.goto(`/me/cases/${caseKey}/sizing`);
  await expect(page.getByText('No sizing yet')).toBeVisible();
  await page.getByRole('button', { name: 'Start the sizing model' }).click();
  const editor = page.getByRole('region', { name: 'Sizing draft editor' });
  await expect(editor).toBeVisible();

  // The boundary first: the first save needs it.
  await editor.getByLabel('Market unit').fill('annual spend on water monitoring');
  await editor.getByLabel('Currency').fill('EUR');
  await editor.getByLabel(/^Reference year/).fill('2026');
  await editor.getByLabel(/^Horizon/).fill('3');
  await editor
    .getByLabel(/^Product boundary/)
    .fill('Existing water-monitoring system, run as a monitored service');
  await editor.getByRole('checkbox', { name: 'Software' }).check();
  await editor.getByRole('checkbox', { name: 'Services' }).check();
  await editor.getByLabel(/^Product boundary/).blur();
  await saved(editor);

  // TAM from the site census (Evidence); spend per site from the register (Assumption).
  const tam = editor.getByRole('group', { name: 'TAM site count' });
  await tam.getByLabel('TAM site count · basis').selectOption(`src:${src14}`);
  await tam.getByLabel('TAM site count', { exact: true }).fill('5000');
  await tam.getByLabel('TAM site count', { exact: true }).blur();
  await editor
    .getByLabel('Annual spend per site · basis')
    .selectOption(`asm:${asm['annual_spend_per_site']}`);

  // Two unique-site cohorts and the overlap between them.
  for (const c of [
    { name: 'Size-qualified', sites: '1400', rule: '≥ size threshold (employees or volume)', src: src14 },
    { name: 'Process-qualified', sites: '1100', rule: 'Uses the target water process', src: src21 },
  ]) {
    await editor.getByRole('button', { name: 'Add cohort' }).click();
    const n = await editor.getByRole('group', { name: /^Cohort \d+$/ }).count();
    const row = editor.getByRole('group', { name: `Cohort ${n}` });
    await row.getByLabel(`Cohort ${n} · name`).fill(c.name);
    await row.getByLabel(`Cohort ${n} · site count`).fill(c.sites);
    await row.getByLabel(`Cohort ${n} · rule`).fill(c.rule);
    await row.getByLabel(`Cohort ${n} · source`).selectOption(c.src);
  }
  await editor.getByLabel('Overlap removed (sites in both)').fill('500');
  await editor.getByLabel('How the overlap was found').fill('Dedup run v2');
  await editor.getByLabel('How the overlap was found').blur();
  await saved(editor);

  // The reachable pool with its channel definition; adoption and capacity from the register.
  await editor.getByLabel('Reachable pool · basis').selectOption(`asm:${asm['reachable_pool']}`);
  await editor
    .getByLabel(/^Channel definition/)
    .fill('Partner coverage list: distributors serving German food plants');
  for (const k of ['adoption_rate.downside', 'adoption_rate.base', 'adoption_rate.upside', 'capacity']) {
    const label = {
      'adoption_rate.downside': 'Adoption by year 3 · Downside',
      'adoption_rate.base': 'Adoption by year 3 · Base',
      'adoption_rate.upside': 'Adoption by year 3 · Upside',
      capacity: 'Installation and support capacity',
    }[k]!;
    await editor.getByLabel(`${label} · basis`).selectOption(`asm:${asm[k]}`);
  }
  await editor.getByLabel(/^Channel definition/).blur();
  await saved(editor);

  // The draft calculates: SAM €40m/year, 500 unique sites reachable. No total row.
  await expect(page.locator('[data-measure="SAM"]')).toContainText('€40m/year');
  await expect(page.locator('[data-measure="SAM"]')).toContainText('2,000 unique sites');
  await expect(page.locator('[data-measure="Reachable pool"]')).toContainText('500 unique sites');
  await expect(page.getByRole('group', { name: /total/i })).toHaveCount(0);
  const ledger = page.getByRole('table', { name: 'Input ledger' });
  await expect(ledger).toContainText('Partner coverage list: distributors serving German food plants');
  await expect(ledger).not.toContainText('Unknown');
  await expectAccessible();

  // A blank input is Unknown, never 0, and blocks the snapshot; linking it again unblocks.
  await editor.getByLabel('Installation and support capacity · basis').selectOption('');
  await editor.getByLabel('Installation and support capacity · basis').blur();
  await expect(editor.getByText(/Not available — add Installation and support capacity/)).toBeVisible();
  await expect(ledger.getByRole('row', { name: /Installation and support capacity/ })).toContainText(
    'Unknown',
  );
  await expect(editor.getByText('Blocked: add Installation and support capacity.')).toBeVisible();
  await editor.getByLabel('Installation and support capacity · basis').selectOption(`asm:${asm['capacity']}`);
  await editor.getByLabel('Installation and support capacity · basis').blur();
  await saved(editor);
  await expect(page.locator('[data-measure="SAM"]')).toContainText('€40m/year');

  await editor.getByRole('button', { name: 'Create snapshot v1' }).click();
  await expect(page.getByText(/Snapshot v1 · committed/)).toBeVisible();
  const sizing = await apiCall<{
    current: {
      version: number;
      dedupRuleText: string;
      boundary: { productBoundary: string; includes: Record<string, boolean> };
      overlaps: { method: string }[];
      result: { ladder: { sam: { value: { amount: string } }; reachablePool: { population: number } } };
    };
  }>(page, 'GET', `/me/cases/${caseKey}/sizing`);
  expect(sizing.json.current.version).toBe(1);
  expect(sizing.json.current.result.ladder.sam.value.amount).toBe('40000000.00');
  expect(sizing.json.current.result.ladder.reachablePool.population).toBe(500);
  expect(sizing.json.current.boundary.productBoundary).toBe(
    'Existing water-monitoring system, run as a monitored service',
  );
  expect(sizing.json.current.boundary.includes).toMatchObject({
    software: true,
    services: true,
    hardware: false,
  });
  expect(sizing.json.current.overlaps[0]!.method).toBe('Dedup run v2');
  expect((await analytics('sizing_snapshot_created')).length).toBeGreaterThanOrEqual(1);

  // ---- S08 economics editor ------------------------------------------------------------------
  await page.goto(`/me/cases/${caseKey}/economics`);
  await page.getByRole('button', { name: 'Start the economics model' }).click();
  const header = page.getByRole('group', { name: 'Model header' });
  await expect(header.getByRole('textbox', { name: 'Currency' })).toHaveValue('EUR');
  await expect(header.getByRole('textbox', { name: 'Base year' })).toHaveValue('2026');
  await expect(header.getByRole('textbox', { name: 'Horizon (years)' })).toHaveValue('3');
  // Drivers follow the register; Downside is linked here by hand.
  await page
    .getByRole('combobox', { name: 'Adoption by year 3 · Downside · assumption' })
    .selectOption(asm['adoption_rate.downside']!);
  await page.getByRole('textbox', { name: /^Opex scope note/ }).fill('Sales and admin only; excludes COGS');
  await page.getByRole('textbox', { name: /^Opex scope note/ }).blur();
  await expect(page.getByText('Scope: Sales and admin only; excludes COGS')).toBeVisible({ timeout: 15_000 });

  const table = page.getByRole('table', { name: 'Scenario table' });
  const cells = async (header: string) =>
    table
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${header}`) }) })
      .getByRole('cell')
      .allTextContents();
  await expect.poll(() => cells('Annual revenue')).toEqual(['€1.0m', '€2.0m', '€2.4m']);
  expect(await cells('Contribution after incremental opex')).toEqual(['€0k (break-even)', '€600k', '€840k']);
  expect(await cells('Customers')).toEqual(['50', '100', '120 · capped at 120']);
  // The one-time investment sits in its own block, never in the /year table.
  const once = page.getByRole('group', { name: 'One-time scale-entry investment' });
  await expect(once.getByRole('textbox', { name: 'One-time scale-entry investment' })).toHaveValue('400');
  await expect(page.getByRole('table', { name: 'Economics drivers' })).not.toContainText('investment');
  await expect(page.getByRole('group', { name: 'One-time money' })).toContainText('€400k one-time');
  await expect(page.getByRole('group', { name: 'Cash flow' })).toContainText('Not available');
  await expect(page.getByRole('group', { name: 'Payback' })).toContainText('Not available');
  await expectAccessible();

  await page.getByRole('button', { name: 'Create snapshot v1' }).click();
  await expect(page.getByText('Snapshot v1 created')).toBeVisible();
  const econ = await apiCall<{
    current: {
      version: number;
      result: {
        scenarios: { annualRevenue: { amount: string } }[];
        oneTimeInvestment: { amount: string; timeBasis: string };
      };
    };
  }>(page, 'GET', `/me/cases/${caseKey}/economics`);
  expect(econ.json.current.version).toBe(1);
  expect(econ.json.current.result.scenarios.map((s) => s.annualRevenue.amount)).toEqual([
    '1000000.00',
    '2000000.00',
    '2400000.00',
  ]);
  expect(econ.json.current.result.oneTimeInvestment).toMatchObject({
    amount: '400000.00',
    timeBasis: 'one_time',
  });
  expect(JSON.stringify(econ.json.current.result.scenarios)).not.toContain('"400000.00"');

  // The case can reach G1: comparable sizing is committed (the other G1 inputs are not editors).
  const g1 = await apiCall<{ preconditions: { key: string; met: boolean }[] }>(
    page,
    'GET',
    `/me/cases/${caseKey}/gates/G1/preconditions`,
  );
  expect(g1.status).toBe(200);
  expect(g1.json.preconditions.find((p) => p.key === 'comparable_sizing')).toMatchObject({ met: true });
  const actions = await auditActions(caseKey);
  expect(actions).toEqual(
    expect.arrayContaining([
      'sizing.draft_saved',
      'sizing.version_committed',
      'economics.draft_saved',
      'economics.version_committed',
    ]),
  );
});
