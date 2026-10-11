/**
 * Never-rule 10: re-check authorization at send time. After activation, an invalidated or expired
 * approval pauses every unsent write ("Paused — approval changed") and preserves the sent ones.
 *   - a material change through the real `applyMateriality` (G2 invalidated in the same transaction)
 *   - an invalidation or expiry the pause did not reach: the worker's send-time check catches it
 *   - a plan version replaced after approval, and a sender whose role was revoked
 * An ambiguous send paused while Checking is searched once, so an executed write is still shown.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, MaterialityPolicyBody, SYNC_STATUS_LABELS } from '@growth-os/contracts';
import { sql } from '@growth-os/db';
import { createMaterialityEvaluator, type MaterialityEvaluator } from '@growth-os/domain';
import { materialityRules, sources } from '@growth-os/fixtures-aster';
import { applyMateriality } from '../../src/platform/materiality';
import { systemTools } from '../../src/platform/pipeline';
import { call } from '../../src/platform/testing';
import {
  analyticsCount,
  drain,
  expectNoDuplicates,
  harness,
  inTenant,
  pass,
  pilotScenario,
  preview,
  send,
  setFaults,
  simIssues,
  sweep,
  taskSet,
  type Harness,
  type PilotScenario,
} from './support';

let h: Harness;

beforeAll(async () => {
  h = await harness();
});
afterAll(async () => {
  await h.close();
});

/** The real evaluator under a policy that classifies source changes as material. */
const materialSources: MaterialityEvaluator = (() => {
  const real = createMaterialityEvaluator();
  const policy = MaterialityPolicyBody.parse({
    rules: materialityRules.map((r) =>
      r.changeType === 'source_superseded_or_deleted' ? { ...r, classification: 'material' } : r,
    ),
    escalateTo: 'sponsor',
  });
  return { ...real, evaluate: (c, _p, pins) => real.evaluate(c, policy, pins) };
})();

async function materialChange(p: PilotScenario): Promise<void> {
  const now = new Date();
  await inTenant(h.t.db, p.s, (tx) =>
    applyMateriality(
      systemTools(tx, { tenantId: p.s.tenantId, correlationId: 'material-test', now, rule: 'test' }),
      {
        changeType: 'source_superseded_or_deleted',
        objectType: 'source',
        objectId: p.s.id(sources.find((x) => x.key === 'SRC-014')!.id),
        componentType: 'source',
        label: 'source SRC-014',
      },
      { now, actorUserId: null, evaluator: materialSources },
    ),
  );
}

async function invalidateWithoutPause(p: PilotScenario, kind: 'invalidated' | 'expired'): Promise<void> {
  await inTenant(h.t.db, p.s, async (tx) => {
    await tx
      .insertInto('platform.approval_invalidation')
      .values({ tenant_id: p.s.tenantId, approval_id: p.approvalId, kind, reason: `test ${kind}` })
      .execute();
    await tx.updateTable('platform.gate_request').set({ status: kind }).where('id', '=', p.g2Id).execute();
  });
}

describe('approval invalidated after activation', () => {
  it('material change: unsent tasks pause, confirmed tasks are preserved, nothing more is sent', async () => {
    const p = await pilotScenario(h);
    await send(h, p.jonas, p.taskSetId);
    const sent = await pass(h, p.s, undefined, 3);
    expect(sent.map((r) => r.status)).toEqual(['confirmed', 'confirmed', 'confirmed']);
    const before = await taskSet(h, p.jonas, p.taskSetId);
    const confirmedKeys = before.tasks
      .filter((t) => t.sync.status === 'confirmed')
      .map((t) => t.sync.externalKey);

    await materialChange(p);
    const gate = await inTenant(h.t.db, p.s, (tx) =>
      tx
        .selectFrom('platform.gate_request')
        .select('status')
        .where('id', '=', p.g2Id)
        .executeTakeFirstOrThrow(),
    );
    expect(gate.status).toBe('invalidated');

    await sweep(h, p.s);
    await drain(h, p.s);
    const view = await taskSet(h, p.jonas, p.taskSetId);
    expect(view.summaryText).toBe('3 of 6 tasks confirmed in Jira · 3 paused — approval changed');
    expect(view.tasks.filter((t) => t.sync.status === 'confirmed').map((t) => t.sync.externalKey)).toEqual(
      confirmedKeys,
    );
    const paused = view.tasks.filter((t) => t.sync.status === 'paused_approval_changed');
    expect(paused.map((t) => t.ordinal)).toEqual([4, 5, 6]);
    expect(SYNC_STATUS_LABELS[paused[0]!.sync.status]).toBe('Paused — approval changed');
    expect(await simIssues(h, p.connectionId)).toHaveLength(3);
    await expectNoDuplicates(h, p.connectionId);

    // No way around it: retry has nothing failed, and a new preview is refused.
    const retry = await call(h.t.app, API.taskSync.retry, {
      params: { id: p.taskSetId },
      body: {},
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(retry.statusCode).toBe(409);
    const pv = await call(h.t.app, API.taskSync.preview, {
      params: { id: p.taskSetId },
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(pv.statusCode).toBe(409);
    expect(pv.json()).toMatchObject({ code: 'APPROVAL_INVALIDATED' });
  });

  it('send-time re-check: an invalidation the pause did not reach still stops every unsent write', async () => {
    const p = await pilotScenario(h);
    await send(h, p.jonas, p.taskSetId);
    await pass(h, p.s, undefined, 2);
    await invalidateWithoutPause(p, 'invalidated');
    const results = await pass(h, p.s);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.status === 'paused_approval_changed')).toBe(true);
    expect(results[0]).toMatchObject({ errorCode: 'approval_invalidated' });
    const view = await taskSet(h, p.jonas, p.taskSetId);
    expect(view.summaryText).toBe('2 of 6 tasks confirmed in Jira · 4 paused — approval changed');
    expect(view.tasks.find((t) => t.ordinal === 3)!.sync.lastErrorCode).toBe('approval_invalidated');
    expect(await simIssues(h, p.connectionId)).toHaveLength(2);
  });

  it('send-time re-check: an expired approval pauses unsent writes with the expiry reason', async () => {
    const p = await pilotScenario(h);
    await send(h, p.jonas, p.taskSetId);
    await pass(h, p.s, undefined, 1);
    await invalidateWithoutPause(p, 'expired');
    const results = await pass(h, p.s);
    expect(results.every((r) => r.status === 'paused_approval_changed')).toBe(true);
    expect(results[0]).toMatchObject({ errorCode: 'approval_expired' });
    expect((await taskSet(h, p.jonas, p.taskSetId)).summaryText).toBe(
      '1 of 6 tasks confirmed in Jira · 5 paused — approval changed',
    );
    expect(await simIssues(h, p.connectionId)).toHaveLength(1);
  });

  it('an ambiguous send paused while Checking is searched once: the executed write shows as Confirmed', async () => {
    const p = await pilotScenario(h);
    await setFaults(h, p.jonas, p.connectionId, [
      { mode: 'timeout_after_success', match: { titleContains: 'Confirm 4 pilot sites' }, times: 1 },
    ]);
    await send(h, p.jonas, p.taskSetId);
    expect((await pass(h, p.s, undefined, 1))[0]!.status).toBe('checking');
    await materialChange(p); // pauses the Checking row too
    const s = await sweep(h, p.s);
    expect(s.processed.find((x) => x.result.status === 'confirmed')).toBeDefined();
    const view = await taskSet(h, p.jonas, p.taskSetId);
    expect(view.summaryText).toBe('1 of 6 tasks confirmed in Jira · 5 paused — approval changed');
    expect(await simIssues(h, p.connectionId)).toHaveLength(1);
    // Searched once only: a second sweep does not search again.
    const again = await sweep(h, p.s);
    expect(again.processed).toHaveLength(0);
  });

  it('plan version replaced after approval: unsent writes pause (plan changed)', async () => {
    const p = await pilotScenario(h);
    await send(h, p.jonas, p.taskSetId);
    await inTenant(h.t.db, p.s, async (tx) => {
      const plan = await tx
        .selectFrom('me.pilot_plan')
        .select(['id', 'current_version_id'])
        .where('case_id', '=', p.caseId)
        .executeTakeFirstOrThrow();
      const v1 = await tx
        .selectFrom('me.pilot_plan_version')
        .selectAll()
        .where('id', '=', plan.current_version_id!)
        .executeTakeFirstOrThrow();
      const v2 = randomUUID();
      await tx
        .insertInto('me.pilot_plan_version')
        .values({
          id: v2,
          tenant_id: p.s.tenantId,
          pilot_plan_id: plan.id,
          version: 2,
          state: 'committed',
          committed_at: new Date(),
          budget_ceiling: v1.budget_ceiling,
          currency: v1.currency,
          window_start: v1.window_start,
          window_end: v1.window_end,
          scope_text: v1.scope_text,
          created_by: p.s.user('jonas'),
        })
        .execute();
      await tx
        .updateTable('me.pilot_plan')
        .set({ current_version_id: v2 })
        .where('id', '=', plan.id)
        .execute();
    });
    const results = await pass(h, p.s);
    expect(results.every((r) => r.status === 'paused_approval_changed')).toBe(true);
    expect(results[0]).toMatchObject({ errorCode: 'plan_changed' });
    expect(await simIssues(h, p.connectionId)).toHaveLength(0);
  });

  it('sender no longer authorized: the task fails (retryable) without a write; an authorized retry sends it', async () => {
    const p = await pilotScenario(h);
    await send(h, p.jonas, p.taskSetId);
    const jonasId = p.s.user('jonas');
    await inTenant(h.t.db, p.s, (tx) =>
      sql`UPDATE platform.role_assignment SET revoked_at = now()
           WHERE user_id = ${jonasId} AND role = 'pilot_owner'`.execute(tx),
    );
    const results = await pass(h, p.s);
    expect(results.every((r) => r.status === 'failed')).toBe(true);
    expect(results[0]).toMatchObject({ errorCode: 'actor_not_authorized' });
    expect(await simIssues(h, p.connectionId)).toHaveLength(0);
    expect(await analyticsCount(h, p.s, 'external_task_failed')).toBe(6);
    // Without the role Jonas cannot retry either.
    const refused = await call(h.t.app, API.taskSync.retry, {
      params: { id: p.taskSetId },
      body: {},
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(refused.statusCode).toBe(403);
    // Role restored: the retry carries the retrying person as the execution identity.
    await inTenant(h.t.db, p.s, async (tx) => {
      const old = await tx
        .selectFrom('platform.role_assignment')
        .select('business_unit_id')
        .where('user_id', '=', jonasId)
        .where('role', '=', 'pilot_owner')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('platform.role_assignment')
        .values({
          tenant_id: p.s.tenantId,
          user_id: jonasId,
          role: 'pilot_owner',
          business_unit_id: old.business_unit_id,
          granted_by: p.s.user('admin'),
        })
        .execute();
    });
    const ok = await call(h.t.app, API.taskSync.retry, {
      params: { id: p.taskSetId },
      body: {},
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(ok.statusCode, ok.body).toBe(202);
    await drain(h, p.s);
    expect((await taskSet(h, p.jonas, p.taskSetId)).summaryText).toBe('6 of 6 tasks confirmed in Jira');
    expect(await simIssues(h, p.connectionId)).toHaveLength(6);
  });

  it('sending is refused up front when the preview is stale, the approval changed or C1 is open', async () => {
    const p = await pilotScenario(h);
    const pv = await preview(h, p.jonas, p.taskSetId);
    // Wrong hash → preview not current.
    const stale = await call(h.t.app, API.taskSync.send, {
      params: { id: p.taskSetId },
      body: { previewId: pv.id, previewHash: 'a'.repeat(64) },
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'PRECONDITIONS_UNMET' });
    expect(JSON.stringify(stale.json())).toContain('Preview again');
    // The plan changed after the preview (a due date moved) → the bound hash no longer matches.
    await inTenant(h.t.db, p.s, (tx) =>
      tx
        .updateTable('platform.task')
        .set({ due_on: '2026-12-05' })
        .where('task_set_id', '=', p.taskSetId)
        .where('ordinal', '=', 1)
        .execute(),
    );
    const moved = await call(h.t.app, API.taskSync.send, {
      params: { id: p.taskSetId },
      body: { previewId: pv.id, previewHash: pv.contentHash },
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(moved.statusCode).toBe(409);
    // C1 reopened → blocking condition.
    await inTenant(h.t.db, p.s, (tx) =>
      tx
        .updateTable('platform.condition')
        .set({ status: 'open' })
        .where('gate_request_id', '=', p.g2Id)
        .where('blocks_execution', '=', true)
        .execute(),
    );
    const pv2 = await preview(h, p.jonas, p.taskSetId);
    const blocked = await call(h.t.app, API.taskSync.send, {
      params: { id: p.taskSetId },
      body: { previewId: pv2.id, previewHash: pv2.contentHash },
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'PRECONDITIONS_UNMET' });
    expect(JSON.stringify(blocked.json())).toContain('blocking_conditions_met');
    // C1 met again, but the pilot plan is not (or no longer) the active version → refused.
    await inTenant(h.t.db, p.s, async (tx) => {
      await tx
        .updateTable('platform.condition')
        .set({ status: 'met' })
        .where('gate_request_id', '=', p.g2Id)
        .where('blocks_execution', '=', true)
        .execute();
      await tx
        .updateTable('me.pilot_plan')
        .set({ current_version_id: null })
        .where('case_id', '=', p.caseId)
        .execute();
    });
    const pv3 = await preview(h, p.jonas, p.taskSetId);
    const inactive = await call(h.t.app, API.taskSync.send, {
      params: { id: p.taskSetId },
      body: { previewId: pv3.id, previewHash: pv3.contentHash },
      cookie: p.jonas,
      idempotencyKey: true,
    });
    expect(inactive.statusCode).toBe(409);
    expect(inactive.json()).toMatchObject({
      code: 'PRECONDITIONS_UNMET',
      blockers: [{ key: 'plan_current' }],
    });
    expect(await simIssues(h, p.connectionId)).toHaveLength(0);
  });
});
