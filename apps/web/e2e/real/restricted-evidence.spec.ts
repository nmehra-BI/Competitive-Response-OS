/**
 * Alternate path · restricted evidence on the real stack (`aster-demo`): SRC-030 shows no excerpt
 * anywhere (viewer, lists, search, API, package, exports), and Jonas — aggregate-only on the
 * restricted site list — sees aggregates without the site list on S06.
 */
import { expect, test } from '../support/fixtures';
import { apiCall, resetStack, sqlExec } from '../support/real';

const CANARY = 'CANARY-RESTRICTED-vendor-estimate-4417';

test.beforeAll(async () => {
  resetStack('aster-demo');
  // A passage only a licence holder may read, carrying a canary string that must never surface.
  await sqlExec(
    `INSERT INTO platform.evidence_passage (tenant_id, source_id, locator, excerpt, excerpt_sha256)
     SELECT tenant_id, id, 'p. 4', $1, encode(digest($1, 'sha256'), 'hex') FROM platform.source
      WHERE display_key = 'SRC-030'`,
    [`European water-monitoring spend grows 9% a year. ${CANARY}`],
  );
});

test('SRC-030: no excerpt, summary, passage or count anywhere; aggregates only for Jonas', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya', '/evidence/SRC-030?case=ME-104');
  await expect(page.getByText('Restricted source · no excerpt shown')).toBeVisible();
  await expect(page.locator('blockquote')).toHaveCount(0);
  await expectAccessible();

  // API: no passages, no quoted fact, no claim text derived from it.
  const detail = await apiCall<{ passages: unknown[]; quotedFact: unknown; viewerAccess: string }>(
    page,
    'GET',
    '/evidence/sources/SRC-030',
  );
  expect(detail.status).toBe(200);
  expect(detail.json).toMatchObject({ passages: [], quotedFact: null, viewerAccess: 'none' });
  expect(JSON.stringify(detail.json)).not.toContain(CANARY);
  await expect(page.getByText(CANARY)).toHaveCount(0);

  // Search never returns restricted content or a count of hidden items.
  const search = await apiCall<{ groups?: unknown; items?: { title?: string; snippet?: string }[] }>(
    page,
    'GET',
    `/search?q=${encodeURIComponent(CANARY)}`,
  );
  expect(search.status).toBe(200);
  expect(JSON.stringify(search.json)).not.toContain(CANARY);
  expect(JSON.stringify(search.json)).not.toMatch(/hidden|restricted items/i);

  // The decision package and the economics export carry no SRC-030 content.
  const pkg = await apiCall(page, 'GET', '/me/gate-requests/a57e0015-0000-4000-8000-000000000003/package');
  expect(JSON.stringify(pkg.json)).not.toContain(CANARY);
  const list = await apiCall(page, 'GET', '/evidence/sources');
  expect(JSON.stringify(list.json)).not.toContain(CANARY);
  const csv = await page.request.get('/api/v1/me/cases/ME-104/economics/export?format=csv&version=2');
  expect(csv.status()).toBe(200);
  expect(await csv.text()).not.toContain(CANARY);

  // Jonas: aggregates only — the site list is restricted under his access.
  await loginAs('jonas', '/me/cases/ME-104/sizing');
  await expect(page.getByText('Site list restricted under your access')).toBeVisible();
  await expect(page.getByRole('group', { name: 'SAM', exact: true })).toContainText('€40m/year');
  await expectAccessible();
});
