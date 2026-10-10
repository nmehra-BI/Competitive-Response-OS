/**
 * Wave 4 · E3 governance on the real stack from `aster-demo` (tickets 3, 4, 6, 12, 13; D-109, D-110,
 * D-120, D-124, D-129, D-130):
 *  - S14 shows the delegated-authority matrix with the DoA reference, the committee ("Committee named ·
 *    G3 authority not granted"), licences with their rights status, and live analysis Off;
 *  - S10 shows Elena "Your authority: up to €150k · BU Water" on G2 v3;
 *  - a G3 request routes to the investment committee: 2 of 3 approvals on the same snapshot with the
 *    finance seat required; chair + operations alone never approve; the administrator is refused.
 * Aster seeds no G3 grant, so the spec grants one to each seat holder first (test-only SQL).
 */
import { expect, test } from '../support/fixtures';
import { analytics, apiCall, resetStack, sqlExec, sqlRows } from '../support/real';

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => resetStack('aster-demo'));

const CASE = '/me/cases/ME-104';
const G2 = 'a57e0015-0000-4000-8000-000000000003';
const G3 = 'a57e0015-0000-4000-8000-0000000000e3';
const G3_SNAP = 'a57e0016-0000-4000-8000-0000000000e3';

test('S14: matrix with DoA, committee named without G3 authority, licences, live analysis Off', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('admin', '/admin/authority');
  await page.getByRole('main').waitFor();
  const authority = page.getByRole('table', { name: 'Delegated authority' });
  await expect(
    authority.getByRole('cell', { name: /DoA-2026-01 · BU Water · illustrative/ }).first(),
  ).toBeVisible();
  await expect(authority).toContainText('up to €150k · illustrative');
  await expect(
    authority.getByRole('cell', { name: /No G3 approver in BU Water · Authority gap/ }),
  ).toBeVisible();
  const committee = page.getByRole('table', { name: 'Investment committee' });
  await expect(committee).toContainText('Chair');
  await expect(committee).toContainText('Katrin Vogel');
  await expect(committee).toContainText('Finance seat');
  await expect(committee).toContainText('Thomas Berger');
  await expect(page.getByText('Committee named · G3 authority not granted').first()).toBeVisible();
  const licences = page.getByRole('table', { name: 'Licences' });
  await expect(licences).toContainText('Confirmed in writing');
  await expect(licences).toContainText('Not confirmed in writing · metadata only');
  await expect(licences).toContainText('Remove excerpts and embeddings · keep provenance metadata');
  await expect(page.getByText('Live analysis · Off')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn live analysis on' })).toBeDisabled();
  await expectAccessible();
});

test('S10: Elena’s authority reads "up to €150k · BU Water" on G2 v3', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('elena', `${CASE}/decisions?gate=G2`);
  const panel = page.getByRole('complementary', { name: 'Approval panel' });
  await expect(panel).toContainText('Your authority');
  await expect(panel).toContainText('Up to €150k · BU Water');
  await expect(page.getByRole('article', { name: 'Decision package' })).toContainText('G2 · Snapshot v3');
  await expectAccessible();
});

test('G3: the committee decides 2 of 3 on one snapshot, the finance seat required', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  // Test-only: G3 grants for the three seat holders, and a G3 request awaiting a decision (the API
  // refuses to create one while G3's preconditions are unmet, D-039).
  await sqlExec(
    `INSERT INTO platform.authority_grant (tenant_id, user_id, gate_code, business_unit_id, ceiling_amount,
       currency, valid_from, granted_by, doa_reference)
     SELECT g.tenant_id, u.id, 'G3', g.business_unit_id, 2000000, 'EUR', '2026-01-01',
       (SELECT id FROM platform.app_user WHERE email LIKE 'admin@%' LIMIT 1), 'DoA-E2E · G3 test grant'
       FROM platform.gate_request g, platform.app_user u
      WHERE g.id = $1 AND u.email IN ('elena.fischer@aster.example', 'katrin.vogel@aster.example',
        'thomas.berger@aster.example')`,
    [G2],
  );
  await sqlExec(
    `INSERT INTO platform.gate_request (id, tenant_id, display_key, case_id, subject_type, subject_id,
       business_unit_id, gate_code, status, scope, requested_amount, currency, submitted_by, submitted_at, created_by)
     SELECT $1, tenant_id, 'ME-104-G3', case_id, 'case', subject_id, business_unit_id, 'G3', 'awaiting_decision',
       scope || '{"amount":"400000.00","durationDays":null}'::jsonb, 400000, 'EUR', created_by, now(), created_by
       FROM platform.gate_request WHERE id = $2`,
    [G3, G2],
  );
  await sqlExec(
    `INSERT INTO platform.decision_snapshot (id, tenant_id, gate_request_id, case_id, version, subject_id,
       content_canonical, content_hash, created_by)
     SELECT $1, s.tenant_id, $2, s.case_id,
       (SELECT max(version) + 1 FROM platform.decision_snapshot x WHERE x.subject_id = s.subject_id),
       s.subject_id, c.t, encode(sha256(convert_to(c.t, 'UTF8')), 'hex'), s.created_by
       FROM platform.decision_snapshot s,
       LATERAL (SELECT ((s.content - 'stopRules') || jsonb_build_object(
         'gateCode', 'G3',
         'ask', 'Authorize scale entry in BU Water up to €400k one-time.',
         'conditionsProposed', '[]'::jsonb,
         'scope', (s.content->'scope') || '{"amount":"400000.00","durationDays":null}'::jsonb))::text AS t) c
      WHERE s.id = (SELECT current_snapshot_id FROM platform.gate_request WHERE id = $3)`,
    [G3_SNAP, G3, G2],
  );
  await sqlExec(`UPDATE platform.gate_request SET current_snapshot_id = $1 WHERE id = $2`, [G3_SNAP, G3]);
  await sqlExec(
    `UPDATE platform.workflow_case SET stage = 'scale_approval_pending' WHERE display_key = 'ME-104'`,
  );

  const panel = page.getByRole('complementary', { name: 'Approval panel' });
  const committee = panel.getByRole('region', { name: 'Investment committee' });
  const approve = async (who: 'elena' | 'thomas' | 'katrin', expected: string) => {
    await loginAs(who, `${CASE}/decisions?gate=G3`);
    await expect(committee).toBeVisible();
    await panel.getByRole('button', { name: 'Authorize scale' }).click();
    await panel.getByLabel(/Rationale/).fill(`Scale entry is bounded and owned (${who}).`);
    await panel.getByRole('button', { name: 'Authorize scale' }).click();
    await expect(panel).toContainText(expected);
  };

  // The administrator cannot approve (never-rule 6).
  await loginAs('admin', '/admin/health');
  const [snap] = await sqlRows<{ hash: string }>(
    `SELECT content_hash AS hash FROM platform.decision_snapshot WHERE id = $1`,
    [G3_SNAP],
  );
  const forced = await apiCall<{ code: string }>(page, 'POST', `/me/gate-requests/${G3}/decisions`, {
    snapshotId: G3_SNAP,
    snapshotHash: snap!.hash,
    disposition: 'approve',
    rationale: 'Admin tries',
    note: null,
    conditions: [],
    delegateToUserId: null,
  });
  expect(forced.status).toBe(403);
  expect(forced.json.code).toBe('FORBIDDEN');

  await loginAs('katrin', `${CASE}/decisions?gate=G3`);
  await expect(committee).toContainText('Waiting on 2 of 3 approvers · finance seat required');
  await expect(panel).toContainText('Up to €2m · BU Water');
  await expectAccessible();

  await approve('elena', 'Waiting on second approver · finance seat');
  await approve('thomas', 'Waiting on the finance seat');
  const status = async () =>
    (await sqlRows<{ status: string }>(`SELECT status FROM platform.gate_request WHERE id = $1`, [G3]))[0]!
      .status;
  expect(await status()).toBe('awaiting_decision'); // chair + operations never approve without finance
  await approve('katrin', 'Quorum reached · 3 of 3 with the finance seat');
  expect(await status()).toBe('approved');
  const seats = await sqlRows<{ seat: string; hash: string }>(
    `SELECT committee_seat AS seat, snapshot_hash AS hash FROM platform.approval WHERE gate_request_id = $1
      ORDER BY decided_at`,
    [G3],
  );
  expect(seats.map((s) => s.seat)).toEqual(['chair', 'operations', 'finance']);
  expect(new Set(seats.map((s) => s.hash))).toEqual(new Set([snap!.hash])); // one snapshot hash
  const [g3] = await sqlRows<{ expires_at: string | null }>(
    `SELECT expires_at FROM platform.gate_request WHERE id = $1`,
    [G3],
  );
  expect(g3!.expires_at).toBeNull(); // G3 never expires in the MVP (D-109 §4)
  expect((await analytics('gate_approved')).filter((e) => e.props.gate === 'G3')).toHaveLength(1);
  await expectAccessible();
});
