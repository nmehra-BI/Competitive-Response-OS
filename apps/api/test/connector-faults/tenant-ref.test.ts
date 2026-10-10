/**
 * CR-E5-4 (decisions.md D-144): every worker call site that builds a task connector passes the
 * message's tenant on the connection ref, so the Jira Cloud adapter reads its credential in that tenant
 * (RLS) without probing `platform.list_tenant_ids()`. Covers the dispatcher (send and reconcile mode)
 * and `reconcilePausedWrite` (the sweep's search before resuming a paused write).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { createConnectorFactory, type ConnectionRef } from '@growth-os/connectors';
import { sql } from '@growth-os/db';
import { call } from '../../src/platform/testing';
import { reconcilePausedWrite } from '../../../worker/src/jobs/outbox';
import { harness, inTenant, outboxDeps, pass, pilotScenario, send, setFaults, type Harness } from './support';

let h: Harness;

beforeAll(async () => {
  h = await harness();
});
afterAll(async () => {
  await h.close();
});

function recordingDeps(refs: ConnectionRef[]) {
  const real = createConnectorFactory({ sim: h.worker });
  return outboxDeps(h, {
    connectors: (ref) => {
      refs.push(ref);
      return real(ref);
    },
  });
}

describe('worker connector refs carry the tenant', () => {
  it('send and reconcile-before-retry pass the message tenant', async () => {
    const p = await pilotScenario(h);
    await setFaults(h, p.jonas, p.connectionId, [
      { mode: 'timeout_after_success', match: { titleContains: 'Install monitoring' }, times: 1 },
    ]);
    await send(h, p.jonas, p.taskSetId);
    const refs: ConnectionRef[] = [];
    const deps = recordingDeps(refs);
    expect((await pass(h, p.s, deps)).map((r) => r.status)).toContain('checking');
    expect((await pass(h, p.s, deps)).map((r) => r.status)).toEqual(['confirmed']); // reconcile mode
    expect(refs.length).toBeGreaterThanOrEqual(7);
    expect(refs.every((r) => r.tenantId === p.s.tenantId && r.id === p.connectionId)).toBe(true);
  });

  it('reconcilePausedWrite passes the tenant it was called for', async () => {
    const p = await pilotScenario(h);
    await send(h, p.jonas, p.taskSetId);
    await setFaults(h, p.jonas, p.connectionId, [{ mode: 'token_expired', match: {}, times: 1 }]);
    const paused = await pass(h, p.s, undefined, 1);
    expect(paused[0]).toMatchObject({ status: 'paused_connector' });
    const reconnect = await call(h.t.app, API.admin.reconnect, {
      params: { id: p.connectionId },
      cookie: p.admin,
      idempotencyKey: true,
    });
    expect(reconnect.statusCode, reconnect.body).toBe(200);
    const id = await inTenant(h.worker, p.s, async (tx) => {
      const r = await sql<{ id: string }>`
        SELECT id FROM platform.outbox_message WHERE status = 'paused' AND attempts > 0 LIMIT 1`.execute(tx);
      return r.rows[0]!.id;
    });
    const refs: ConnectionRef[] = [];
    await reconcilePausedWrite(recordingDeps(refs), p.s.tenantId, id);
    expect(refs).toEqual([{ id: p.connectionId, provider: expect.any(String), tenantId: p.s.tenantId }]);
  });
});
