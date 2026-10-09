/**
 * S11 mocks honour the contract and the execution rules (acceptance steps 21–24): activation
 * blocked by a missing owner then by C1; partial sync with one permission failure; retry resends
 * only the failed task; a timeout reconciles to Confirmed without a resend; variants.
 */
import { API } from '@growth-os/contracts';
import { fid, people, pilotTasks } from '@growth-os/fixtures-aster';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, ApiProblem } from '../../lib/api-client';
import { mockServer, resetMockState, resetReplay, session } from '../../mocks/node';
import { seedWs8d, ws8d } from '../history/journey';
import { RECONCILE_MS, TASK_SET_ID } from './mocks';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  resetMockState();
  resetReplay();
});
afterAll(() => mockServer.close());

let k = 0;
const key = () => `00000000-0000-4000-8000-${String(++k).padStart(12, '0')}`;
const caseRef = 'ME-104';

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiProblem) return e.code;
    throw e;
  }
  return 'ok';
}

async function activateJourney() {
  session.signIn(people.jonas.id);
  const v = await api(API.pilot.get, { params: { caseRef } });
  const body = {
    tasks: v.taskSet!.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      milestoneId: t.milestoneId,
      function: t.function,
      ownerId: t.owner?.id ?? people.opsLead.id,
      dependsOnTaskIds: t.dependsOnTaskIds,
      dueOn: t.dueOn,
      dueRule: t.dueRule,
      deliverable: t.deliverable,
      conditionKey: t.conditionKey,
    })),
  };
  await api(API.pilot.saveDraft, { params: { caseRef }, body, ifMatch: v.draft!.rowVersion });
  await api(API.gates.markConditionMet, {
    params: { id: fid('condition', 1) },
    body: { evidence: 'Signed site list: 4 sites' },
    idempotencyKey: key(),
  });
  return api(API.pilot.activate, { params: { caseRef }, idempotencyKey: key() });
}

describe('S11 pilot mocks', () => {
  it('blocks activation by a missing owner, then by open C1 (step 21)', async () => {
    session.signIn(people.jonas.id);
    const v = await api(API.pilot.get, { params: { caseRef } });
    expect(v.status).toBe('ready');
    expect(v.activationBlockers.map((b) => b.key)).toEqual(['task_owner_missing', 'condition_open']);
    expect(v.taskSet!.tasks[1]!.owner).toBeNull();
    expect(v.messageDrafts[0]!.notice).toBe('Draft — not authorized to send');
    expect(await codeOf(api(API.pilot.activate, { params: { caseRef }, idempotencyKey: key() }))).toBe(
      'PRECONDITIONS_UNMET',
    );
  });

  it('refuses activation for other people and the administrator', async () => {
    session.signIn(people.maya.id);
    expect(await codeOf(api(API.pilot.activate, { params: { caseRef }, idempotencyKey: key() }))).toBe(
      'FORBIDDEN',
    );
    session.signIn(people.admin.id);
    expect(await codeOf(api(API.pilot.activate, { params: { caseRef }, idempotencyKey: key() }))).toBe(
      'FORBIDDEN',
    );
  });

  it('hides other cases (404)', async () => {
    session.signIn(people.jonas.id);
    expect(await codeOf(api(API.pilot.get, { params: { caseRef: 'ME-999' } }))).toBe('NOT_FOUND');
  });

  it('creates 6 tasks: 5 confirmed, 1 failed (permission); retry resends only the failed task (22–23)', async () => {
    const active = await activateJourney();
    expect(active.status).toBe('active');
    const pv = await api(API.taskSync.preview, { params: { id: TASK_SET_ID }, idempotencyKey: key() });
    expect(pv.destination.project).toBe('PIL');
    expect(pv.willCreate).toBe(6);
    const sent = await api(API.taskSync.send, {
      params: { id: TASK_SET_ID },
      body: { previewId: pv.id, previewHash: pv.contentHash },
      idempotencyKey: key(),
    });
    expect(sent.summaryText).toBe('5 of 6 tasks confirmed in Jira · 1 failed (permission)');
    expect(sent.summaryText).not.toMatch(/synced/i);
    const failed = sent.tasks.filter((t) => t.sync.status === 'failed');
    expect(failed.map((t) => t.id)).toEqual([pilotTasks[1].id]);
    const firstKeys = sent.tasks.map((t) => t.sync.externalKey);

    const retried = await api(API.taskSync.retry, {
      params: { id: TASK_SET_ID },
      body: { taskIds: failed.map((t) => t.id) },
      idempotencyKey: key(),
    });
    expect(retried.summaryText).toBe('6 of 6 tasks confirmed in Jira');
    // Confirmed tasks were never re-sent (same keys, one attempt each).
    retried.tasks.forEach((t, i) => {
      if (i !== 1) {
        expect(t.sync.externalKey).toBe(firstKeys[i]);
        expect(t.sync.attempts).toBe(1);
      }
    });
    expect(retried.tasks[1]!.sync.attempts).toBe(2);
    const confirmations = ws8d().audit.filter((e) => e.action === 'external_task.confirmed');
    expect(new Set(confirmations.map((e) => e.objectId)).size).toBe(6);
    expect(confirmations).toHaveLength(6);
  });

  it('rejects a stale preview', async () => {
    await activateJourney();
    const pv = await api(API.taskSync.preview, { params: { id: TASK_SET_ID }, idempotencyKey: key() });
    expect(
      await codeOf(
        api(API.taskSync.send, {
          params: { id: TASK_SET_ID },
          body: { previewId: pv.id, previewHash: '0'.repeat(64) },
          idempotencyKey: key(),
        }),
      ),
    ).toBe('PRECONDITIONS_UNMET');
  });

  it('timeout after success shows Checking, then Confirmed after reconcile (24)', async () => {
    seedWs8d({ pilotVariant: 'timeout' });
    session.signIn(people.jonas.id);
    const pv = await api(API.taskSync.preview, { params: { id: TASK_SET_ID }, idempotencyKey: key() });
    const sent = await api(API.taskSync.send, {
      params: { id: TASK_SET_ID },
      body: { previewId: pv.id, previewHash: pv.contentHash },
      idempotencyKey: key(),
    });
    expect(sent.tasks[3]!.sync.status).toBe('checking');
    expect(sent.summaryText).toBe('5 of 6 tasks confirmed in Jira · 1 checking');
    // Reads straight after the send (the screen's refetch) never reconcile: Checking stays visible.
    await api(API.pilot.get, { params: { caseRef } });
    const early = await api(API.pilot.get, { params: { caseRef } });
    expect(early.taskSet!.tasks[3]!.sync.status).toBe('checking');
    // The next poll after the reconcile delay finds the issue by its key.
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + RECONCILE_MS);
    const after = await api(API.pilot.get, { params: { caseRef } });
    clock.mockRestore();
    expect(after.taskSet!.tasks[3]!.sync).toMatchObject({
      status: 'confirmed',
      externalKey: 'PIL-14',
      attempts: 1,
    });
    expect(after.taskSet!.summaryText).toBe('6 of 6 tasks confirmed in Jira');
  });

  it('expired connector: nothing is sent, CSV export works, internal tasks continue', async () => {
    seedWs8d({ pilotVariant: 'expired' });
    session.signIn(people.jonas.id);
    const v = await api(API.pilot.get, { params: { caseRef } });
    expect(v.status).toBe('active');
    expect(v.connectorBanner?.status).toBe('expired');
    expect(
      await codeOf(api(API.taskSync.preview, { params: { id: TASK_SET_ID }, idempotencyKey: key() })),
    ).toBe('CONNECTOR_UNAVAILABLE');
    const csv = await api(API.taskSync.exportCsv, { params: { id: TASK_SET_ID } });
    expect(String(csv)).toContain('Install monitoring at 4 sites');
  });

  it('approval invalidated: unsent tasks paused, sent tasks kept', async () => {
    seedWs8d({ pilotVariant: 'invalidated' });
    session.signIn(people.jonas.id);
    const v = await api(API.pilot.get, { params: { caseRef } });
    expect(v.status).toBe('paused');
    expect(v.taskSet!.tasks.map((t) => t.sync.status)).toEqual([
      'confirmed',
      'paused_approval_changed',
      'confirmed',
      'paused_approval_changed',
      'paused_approval_changed',
      'paused_approval_changed',
    ]);
    expect(v.taskSet!.summaryText).toBe('2 of 6 tasks confirmed in Jira · 4 paused — approval changed');
  });
});
