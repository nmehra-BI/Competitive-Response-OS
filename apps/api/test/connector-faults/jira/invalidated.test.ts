/**
 * Jira Cloud · never-rule 10: authorization is re-checked at send time, not delegated to Jira
 * permissions (D-121 §3). An invalidated or expired approval pauses every unsent write ("Paused —
 * approval changed"); the issues already in Jira stay; nothing more reaches Jira. An ambiguous send
 * paused while Checking is searched once, so an executed write still shows as Confirmed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pass, send, sweep, taskSet, inTenant, type PilotScenario } from '../support';
import {
  createCalls,
  expectNoJiraDuplicates,
  jiraHarness,
  jiraPilotScenario,
  setJiraFaults,
  type JiraHarness,
} from './support';

let h: JiraHarness;

beforeAll(async () => {
  h = await jiraHarness();
});
afterAll(async () => {
  await h.close();
});

async function invalidate(p: PilotScenario, kind: 'invalidated' | 'expired'): Promise<void> {
  await inTenant(h.t.db, p.s, async (tx) => {
    await tx
      .insertInto('platform.approval_invalidation')
      .values({ tenant_id: p.s.tenantId, approval_id: p.approvalId, kind, reason: `test ${kind}` })
      .execute();
    await tx.updateTable('platform.gate_request').set({ status: kind }).where('id', '=', p.g2Id).execute();
  });
}

describe('Jira Cloud · approval changed after activation', () => {
  it('an invalidation the pause did not reach still stops every unsent Jira write', async () => {
    const p = await jiraPilotScenario(h);
    const before = createCalls(h);
    await send(h, p.jonas, p.taskSetId);
    await pass(h, p.s, undefined, 2);
    await invalidate(p, 'invalidated');
    const results = await pass(h, p.s);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.status === 'paused_approval_changed')).toBe(true);
    expect(results[0]).toMatchObject({ errorCode: 'approval_invalidated' });
    const view = await taskSet(h, p.jonas, p.taskSetId);
    expect(view.summaryText).toBe('2 of 6 tasks confirmed in Jira · 4 paused — approval changed');
    expect(createCalls(h) - before).toBe(2);
    expectNoJiraDuplicates(h);
  });

  it('an expired approval pauses unsent writes with the expiry reason', async () => {
    const p = await jiraPilotScenario(h);
    const before = createCalls(h);
    await send(h, p.jonas, p.taskSetId);
    await pass(h, p.s, undefined, 1);
    await invalidate(p, 'expired');
    const results = await pass(h, p.s);
    expect(results.every((r) => r.status === 'paused_approval_changed')).toBe(true);
    expect(results[0]).toMatchObject({ errorCode: 'approval_expired' });
    expect((await taskSet(h, p.jonas, p.taskSetId)).summaryText).toBe(
      '1 of 6 tasks confirmed in Jira · 5 paused — approval changed',
    );
    expect(createCalls(h) - before).toBe(1);
  });

  it('an ambiguous send paused while Checking is searched once: the executed write shows as Confirmed', async () => {
    const p = await jiraPilotScenario(h);
    const issuesBefore = h.mock.issues().length;
    setJiraFaults(h, [{ mode: 'timeout_after_success', match: { titleContains: 'Confirm 4 pilot sites' } }]);
    await send(h, p.jonas, p.taskSetId);
    expect((await pass(h, p.s, undefined, 1))[0]!.status).toBe('checking');
    await invalidate(p, 'invalidated');
    // Unsent rows pause at the send-time re-check; the Checking row is searched (no write) and the
    // issue Jira already holds is recorded as Confirmed.
    await pass(h, p.s);
    await sweep(h, p.s);
    expect((await taskSet(h, p.jonas, p.taskSetId)).summaryText).toBe(
      '1 of 6 tasks confirmed in Jira · 5 paused — approval changed',
    );
    expect(h.mock.issues().length - issuesBefore).toBe(1);
    const again = await sweep(h, p.s);
    expect(again.processed).toHaveLength(0);
    expectNoJiraDuplicates(h);
  });
});
