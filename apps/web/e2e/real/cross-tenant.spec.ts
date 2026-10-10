/**
 * Alternate path · cross-tenant attempts on the real stack: a second, isolated Aster copy is seeded
 * beside the canonical one. Signed in to Aster, every read or write of the other tenant's case, gate,
 * source, task set or comparison answers 404 (never 403, never data), in the API and in the UI.
 */
import { expect, test } from '../support/fixtures';
import { apiCall, otherTenantIds, resetStack, sqlRows } from '../support/real';

test.beforeAll(() => resetStack('aster-demo', { otherTenant: true }));

test('another tenant’s resources are 404 for every persona, read or write', async ({ page, loginAs }) => {
  const [other] = await otherTenantIds();
  expect(other).toBeTruthy();
  const [c] = await sqlRows<{ id: string }>(
    `SELECT id FROM platform.workflow_case WHERE display_key = 'ME-104'`,
    [],
    other,
  );
  const [g] = await sqlRows<{ id: string; snap: string; hash: string }>(
    `SELECT g.id, s.id AS snap, s.content_hash AS hash FROM platform.gate_request g
       JOIN platform.decision_snapshot s ON s.id = g.current_snapshot_id WHERE g.gate_code = 'G2'`,
    [],
    other,
  );
  const [src] = await sqlRows<{ id: string }>(
    `SELECT id FROM platform.source WHERE display_key = 'SRC-014'`,
    [],
    other,
  );
  const [ts] = await sqlRows<{ id: string }>(`SELECT id FROM platform.task_set LIMIT 1`, [], other);
  const [asm] = await sqlRows<{ id: string }>(`SELECT id FROM platform.assumption LIMIT 1`, [], other);
  const [cmp] = await sqlRows<{ id: string }>(`SELECT id FROM me.comparison LIMIT 1`, [], other);

  for (const who of ['maya', 'elena', 'admin'] as const) {
    await loginAs(who);
    const reads = [
      `/me/cases/${c!.id}`,
      `/me/cases/${c!.id}/sizing`,
      `/me/gate-requests/${g!.id}/package`,
      `/evidence/sources/${src!.id}`,
      `/me/task-sets/${ts!.id}`,
      `/me/comparisons/${cmp!.id}`,
      `/me/assumptions/${asm!.id}/versions`,
    ];
    for (const path of reads) {
      const r = await apiCall(page, 'GET', path);
      expect(r.status, `${who} GET ${path}`).toBe(404);
    }
    const decide = await apiCall<{ code: string }>(page, 'POST', `/me/gate-requests/${g!.id}/decisions`, {
      snapshotId: g!.snap,
      snapshotHash: g!.hash,
      disposition: 'approve',
      rationale: 'Cross-tenant attempt',
      note: null,
      conditions: [],
      delegateToUserId: null,
    });
    expect(decide.status, `${who} decide`).toBe(404);
    const dispute = await apiCall(page, 'POST', `/me/assumptions/${asm!.id}/disputes`, {
      statement: 'Cross-tenant',
      proposedValueText: null,
    });
    expect(dispute.status, `${who} dispute`).toBe(404);
    const send = await apiCall(page, 'POST', `/me/task-sets/${ts!.id}/previews`, {});
    expect(send.status, `${who} preview`).toBe(404);
  }
  // The UI shows "not found", never the other tenant's case.
  await loginAs('maya', `/me/cases/${c!.id}/thesis`);
  await expect(page.getByText('This page could not be found.', { exact: false }).first()).toBeVisible();
});
