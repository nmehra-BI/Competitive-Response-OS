/**
 * Alternate path · stale approval (BUILD_PLAN §8, step 19) on the real stack from `aster-demo`: G2 v3
 * awaits Elena; Maya changes Base adoption (a new assumption version), v3 turns stale and cannot be
 * approved (UI disabled, API SNAPSHOT_STALE), Maya refreshes to v4 (v3 superseded), Elena approves v4.
 */
import { expect, test } from '../support/fixtures';
import { analytics, apiCall, resetStack, sqlRows } from '../support/real';

test.beforeAll(() => resetStack('aster-demo'));

const CASE = '/me/cases/ME-104';
const G2 = 'a57e0015-0000-4000-8000-000000000003';
const LABEL = 'Approve pilot €120k · 90 days';

const snaps = () =>
  sqlRows<{ id: string; version: number; status: string; hash: string }>(
    `SELECT id, version, status, content_hash AS hash FROM platform.decision_snapshot
      WHERE gate_request_id = $1 ORDER BY version`,
    [G2],
  );

test('a decision-critical change makes v3 stale; refresh creates v4; only v4 can be approved', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya', `${CASE}/validation`);
  await page.getByRole('button', { name: 'Change value · Adoption 20% by year 3' }).click();
  const form = page.getByRole('form', { name: 'Change value · Adoption 20% by year 3' });
  await form.getByLabel(/New value/).fill('18');
  await form.getByLabel(/Reason/).fill('Base adoption revised after the review');
  await form.getByRole('button', { name: 'Save new version' }).click();
  await expect(form).toHaveCount(0);
  await expect.poll(async () => (await snaps()).find((s) => s.version === 3)?.status).toBe('stale');

  await loginAs('elena', `${CASE}/decisions?gate=G2`);
  await expect(page.getByText(/This snapshot is out of date: adoption assumption changed/)).toBeVisible();
  const panel = page.getByRole('complementary', { name: 'Approval panel' });
  await expect(panel.getByRole('button', { name: LABEL })).toBeDisabled();
  await expect(panel).toContainText('Approval disabled: snapshot v3 is out of date. Refresh to create v4.');
  await expectAccessible();
  const v3 = (await snaps()).find((s) => s.version === 3)!;
  const forced = await apiCall<{ code: string }>(page, 'POST', `/me/gate-requests/${G2}/decisions`, {
    snapshotId: v3.id,
    snapshotHash: v3.hash,
    disposition: 'approve',
    rationale: 'Approving the stale version',
    note: null,
    conditions: [],
    delegateToUserId: null,
  });
  expect(forced.status).toBe(409);
  expect(forced.json.code).toBe('SNAPSHOT_STALE');

  await loginAs('maya', `${CASE}/decisions?gate=G2`);
  await page.getByRole('button', { name: 'Refresh snapshot (creates v4)' }).click();
  await expect(page.getByText('Snapshot v4 created from the current committed inputs.')).toBeVisible();
  expect((await snaps()).map((s) => [s.version, s.status])).toEqual([
    [2, 'superseded'],
    [3, 'superseded'],
    [4, 'current'],
  ]);

  await loginAs('elena', `${CASE}/decisions?gate=G2`);
  await expect(page.getByRole('article', { name: 'Decision package' })).toContainText('Snapshot v4');
  await panel.getByRole('button', { name: LABEL }).click();
  await panel.getByLabel(/Rationale/).fill('Thresholds met; the refreshed package shows the lower adoption.');
  await panel.getByRole('button', { name: new RegExp(`^${LABEL}`) }).click();
  await expect(panel).toContainText('Pilot approved for v4 only');
  expect((await analytics('gate_approved')).map((e) => e.props)).toContainEqual(
    expect.objectContaining({ gate: 'G2' }),
  );
  await page.goto(`${CASE}/decisions?gate=G2&version=3`);
  await expect(page.getByText(/Snapshot v3 is superseded by v4/)).toBeVisible();
  await expectAccessible();
});
