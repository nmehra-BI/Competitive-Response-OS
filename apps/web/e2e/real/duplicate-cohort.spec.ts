/**
 * Alternate path · duplicate cohort on the real stack (`aster-demo`): an imported copy of the
 * "Process-qualified" cohort (same rule and source) pauses the calculation; Maya keeps v1 and the
 * imported cohort is excluded, not deleted. Adding a cohort has no screen yet (PQ-17), so the import is
 * entered through `sizing.saveDraft`; everything after is the S06 UI.
 */
import { expect, test } from '../support/fixtures';
import { apiCall, resetStack, sqlRows } from '../support/real';

test.beforeAll(() => resetStack('aster-demo'));

interface Version {
  rowVersion: number;
  cohorts: {
    id: string;
    name: string;
    rule: string;
    siteCount: number;
    source: { sourceId: string } | null;
  }[];
}
interface SizingView {
  current: Version | null;
  draft: Version | null;
}

test('an imported duplicate pauses the calculation until one cohort is kept', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya', '/me/cases/ME-104/sizing');
  const v = await apiCall<SizingView>(page, 'GET', '/me/cases/ME-104/sizing');
  // Open a draft from the committed v2 (no change yet), then add the imported copy to it.
  const opened = await apiCall<SizingView>(
    page,
    'PATCH',
    '/me/cases/ME-104/sizing/draft',
    { horizonYears: 3 },
    {
      'If-Match': `"${v.json.current!.rowVersion}"`,
    },
  );
  expect(opened.status).toBe(200);
  const draft = opened.json.draft!;
  const proc = draft.cohorts.find((c) => c.name === 'Process-qualified')!;
  const toInput = (c: Version['cohorts'][number]) => ({
    id: c.id,
    name: c.name,
    rule: c.rule,
    siteCount: c.siteCount,
    sourceId: c.source?.sourceId ?? null,
  });
  const saved = await apiCall(
    page,
    'PATCH',
    '/me/cases/ME-104/sizing/draft',
    {
      cohorts: [
        ...draft.cohorts.map(toInput),
        { ...toInput(proc), id: null, name: 'Process-qualified (imported)' },
      ],
    },
    { 'If-Match': `"${draft.rowVersion}"` },
  );
  expect(saved.status, JSON.stringify(saved.json)).toBe(200);

  await page.reload();
  await expect(page.getByText('Duplicate cohort — calculation paused')).toBeVisible();
  await expect(page.locator('[data-measure]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create snapshot v3' })).toBeDisabled();
  await expectAccessible();
  await page.getByRole('button', { name: 'Keep v1' }).click();
  await expect(page.getByText('Duplicate cohort — calculation paused')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'SAM', exact: true })).toContainText('€40m/year');
  const rows = await sqlRows<{ name: string; status: string }>(
    `SELECT k.name, k.status FROM me.cohort k JOIN me.sizing_version s ON s.id = k.sizing_version_id
      WHERE s.state = 'draft' ORDER BY k.name`,
  );
  expect(rows).toContainEqual({ name: 'Process-qualified (imported)', status: 'excluded' });
});
