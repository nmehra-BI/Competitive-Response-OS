/**
 * WS8c mocks stay on contract at every journey moment (each response is validated by `mock()`,
 * a drift answers 500) and enforce the decision rules: no self-approval, admin never approves,
 * snapshot binding, stale and superseded snapshots refused.
 */
import { API } from '@growth-os/contracts';
import { assumptions, gates, people } from '@growth-os/fixtures-aster';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { api, ApiProblem } from '../../lib/api-client';
import { mockServer, resetMockState, resetReplay, session, setScenario } from '../../mocks/node';
import { WS8C_PRESETS, type Ws8cPreset } from './mock-state';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  resetMockState();
  resetReplay();
});
afterAll(() => mockServer.close());

const preset = (p: Ws8cPreset) => setScenario({ ws8cPreset: p } as never);

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ApiProblem ? e.code : String(e);
  }
}

describe('WS8c mocks', () => {
  it.each(WS8C_PRESETS)('serve contract-valid S09/S10 views at %s for every persona', async (p) => {
    preset(p);
    for (const who of ['elena', 'maya', 'daniel', 'jonas', 'admin'] as const) {
      session.signIn(people[who].id);
      const h = await api(API.cases.header, { params: { caseRef: 'ME-104' } });
      await api(API.assumptions.list, { params: { caseRef: 'ME-104' } });
      const exps = await api(API.experiments.list, { params: { caseRef: 'ME-104' } });
      for (const g of ['G1', 'G2'] as const) {
        await api(API.gates.rail, { params: { caseRef: 'ME-104', gateCode: g } });
        const id = h.rail.find((n) => n.gateCode === g)?.gateRequestId;
        if (!id) continue;
        const req = await api(API.gates.get, { params: { id } });
        if (req.status === 'draft') continue;
        const pkg = await api(API.gates.package, { params: { id }, query: {} });
        expect(pkg.panel.canDecide && who !== 'elena').toBe(false);
      }
      const set = exps.items[0]?.taskSetId;
      if (set) await api(API.taskSync.get, { params: { id: set } });
    }
  });

  it('admin and non-deciders are refused; a superseded snapshot cannot be decided', async () => {
    preset('v4');
    const body = (snapshotId: string, snapshotHash: string) => ({
      snapshotId,
      snapshotHash,
      disposition: 'approve' as const,
      rationale: 'x',
      note: null,
      conditions: [],
      delegateToUserId: null,
    });
    session.signIn(people.elena.id);
    const v3 = await api(API.gates.package, { params: { id: gates.g2.id }, query: { version: 3 } });
    const v4 = await api(API.gates.package, { params: { id: gates.g2.id }, query: {} });
    expect(v3.snapshot.status).toBe('superseded');
    expect(v4.snapshot.version).toBe(4);
    const decide = (key: string, b: ReturnType<typeof body>) =>
      api(API.gates.decide, { params: { id: gates.g2.id }, idempotencyKey: key, body: b });
    expect(await codeOf(decide('a', body(v3.snapshot.id, v3.snapshot.contentHash)))).toBe('SNAPSHOT_STALE');
    expect(await codeOf(decide('b', body(v4.snapshot.id, '0'.repeat(64))))).toBe('SNAPSHOT_HASH_MISMATCH');
    session.signIn(people.admin.id);
    expect(await codeOf(decide('c', body(v4.snapshot.id, v4.snapshot.contentHash)))).toBe('FORBIDDEN');
    session.signIn(people.daniel.id);
    expect(await codeOf(decide('d', body(v4.snapshot.id, v4.snapshot.contentHash)))).toBe('FORBIDDEN');
    session.signIn(people.elena.id);
    const ok = await decide('e', body(v4.snapshot.id, v4.snapshot.contentHash));
    expect(ok.gateRequest.displayStatus).toBe('approved');
    expect(ok.approvals[0]!.snapshotHash).toBe(v4.snapshot.contentHash);
  });

  it('a change to the adoption assumption after approval invalidates it', async () => {
    preset('approved');
    session.signIn(people.maya.id);
    const res = await api(API.assumptions.update, {
      params: { id: assumptions[0].id },
      ifMatch: 2,
      body: { value: '0.18', changeReason: 'Revised' },
    });
    expect(res.invalidatedApprovalIds).toEqual([gates.g2.id]);
    const pkg = await api(API.gates.package, { params: { id: gates.g2.id }, query: {} });
    expect(pkg.gateRequest.status).toBe('invalidated');
    expect(pkg.approvals[0]!.effective).toBe(false);
  });
});
