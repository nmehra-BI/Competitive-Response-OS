/**
 * The MSW mocks honour the frozen contracts (every response is parsed by the api client in DEV),
 * enforce the API's edges (session, Idempotency-Key, If-Match) and the decision rules the
 * screens rely on (no self-approval, snapshot hash binding, stale snapshot).
 */
import { API, ENDPOINTS } from '@growth-os/contracts';
import { gates, people } from '@growth-os/fixtures-aster';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { api, ApiProblem } from '../lib/api-client';
import { INVALIDATES } from '../lib/query';
import { G2_HASH, G2_SNAPSHOT_ID } from './data';
import { MOCKED_ENDPOINT_IDS } from './handlers';
import { mockServer, resetMockState, resetReplay, session, setScenario } from './node';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  resetMockState();
  resetReplay();
});
afterAll(() => mockServer.close());

async function problemOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiProblem) return e.code;
    throw e;
  }
  return 'no error';
}

const decideBody = (over: Partial<{ snapshotHash: string; disposition: 'approve' }> = {}) => ({
  snapshotId: G2_SNAPSHOT_ID,
  snapshotHash: G2_HASH,
  disposition: 'approve' as const,
  rationale: 'Thresholds met; bounded pilot.',
  note: null,
  conditions: [],
  delegateToUserId: null,
  ...over,
});

describe('MSW mocks', () => {
  it('every mocked id is a real endpoint', () => {
    const ids = new Set(ENDPOINTS.map((e) => e.id));
    for (const id of MOCKED_ENDPOINT_IDS) expect(ids.has(id)).toBe(true);
  });

  it('requires a session like the real API', async () => {
    expect(await problemOf(api(API.auth.me))).toBe('UNAUTHENTICATED');
  });

  it('serves contract-valid views for every persona', async () => {
    const { personas } = await api(API.auth.listDevPersonas);
    expect(personas.map((p) => p.person.displayName)).toContain('Elena Fischer');
    for (const p of personas) {
      session.signIn(p.userId);
      const me = await api(API.auth.me);
      expect(me.tenant.illustrative).toBe(true);
      await api(API.overview.portfolio, { query: {} });
      await api(API.overview.listCases, { query: {} });
      await api(API.work.reviewsInbox, { query: {} });
      await api(API.work.myWork, { query: {} });
      await api(API.cases.header, { params: { caseRef: 'ME-104' } });
      await api(API.cases.activity, { params: { caseRef: 'ME-104' }, query: {} });
      await api(API.gates.package, { params: { id: gates.g2.id }, query: {} });
      await api(API.gates.package, { params: { id: gates.g1.id }, query: {} });
      await api(API.gates.get, { params: { id: gates.g0.id } });
      await api(API.gates.rail, { params: { caseRef: 'ME-104', gateCode: 'G3' } });
      await api(API.lineage.get, {
        params: { caseRef: 'ME-104' },
        query: { node: 'sizing.sam.value', model: 'sizing' },
      });
      await api(API.mandates.get, { params: { ref: 'MD-21' } });
      await api(API.opportunities.list, { query: { mandateId: '00000000-0000-4000-8000-000000000000' } });
      await api(API.search.search, { query: { q: 'ME' } });
      await api(API.admin.connections);
    }
  });

  it('header for ME-104 shows G2 awaiting decision at the aster-demo moment', async () => {
    session.signIn(people.maya.id);
    const h = await api(API.cases.header, { params: { caseRef: 'ME-104' } });
    expect(h.case.stage).toBe('pilot_approval_pending');
    expect(h.rail.find((n) => n.gateCode === 'G2')?.status).toBe('awaiting_decision');
    expect(h.nextDecision.title).toBe('G2 · Approve pilot €120k · 90 days');
  });

  it('hidden or unknown cases are 404, never 403', async () => {
    session.signIn(people.maya.id);
    expect(await problemOf(api(API.cases.header, { params: { caseRef: 'ME-999' } }))).toBe('NOT_FOUND');
  });

  it('search never returns restricted sources', async () => {
    session.signIn(people.maya.id);
    const { hits } = await api(API.search.search, { query: { q: 'vendor' } });
    expect(hits).toEqual([]);
  });

  it('commands require an Idempotency-Key', async () => {
    session.signIn(people.elena.id);
    const res = await fetch('http://localhost/api/v1/me/gate-requests/' + gates.g2.id + '/decisions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(decideBody()),
    });
    expect(res.status).toBe(428);
  });

  it('the author cannot approve; the sponsor can, bound to the snapshot hash', async () => {
    session.signIn(people.maya.id);
    const maya = api(API.gates.decide, {
      params: { id: gates.g2.id },
      body: decideBody(),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(await problemOf(maya)).toBe('SELF_APPROVAL_PROHIBITED');

    session.signIn(people.elena.id);
    const wrongHash = api(API.gates.decide, {
      params: { id: gates.g2.id },
      body: decideBody({ snapshotHash: 'f'.repeat(64) }),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(await problemOf(wrongHash)).toBe('SNAPSHOT_HASH_MISMATCH');

    const key = crypto.randomUUID();
    const pkg = await api(API.gates.decide, {
      params: { id: gates.g2.id },
      body: decideBody(),
      idempotencyKey: key,
    });
    expect(pkg.gateRequest.displayStatus).toBe('approved');
    expect(pkg.approvals[0]?.snapshotHash).toBe(G2_HASH);
    // Same key, same body: replayed, not decided twice.
    const again = await api(API.gates.decide, {
      params: { id: gates.g2.id },
      body: decideBody(),
      idempotencyKey: key,
    });
    expect(again.approvals.length).toBe(1);
    const header = await api(API.cases.header, { params: { caseRef: 'ME-104' } });
    expect(header.case.stage).toBe('pilot_approved');
  });

  it('a stale snapshot cannot be approved', async () => {
    setScenario({ g2Stale: true });
    session.signIn(people.elena.id);
    const pkg = await api(API.gates.package, { params: { id: gates.g2.id }, query: {} });
    expect(pkg.staleBanner?.title).toMatch(/out of date/);
    expect(pkg.panel.canDecide).toBe(false);
    const p = api(API.gates.decide, {
      params: { id: gates.g2.id },
      body: decideBody(),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(await problemOf(p)).toBe('SNAPSHOT_STALE');
  });

  it('unmocked endpoints answer like the skeleton API', async () => {
    session.signIn(people.maya.id);
    const p = api(API.sizing.get, { params: { caseRef: 'ME-104' }, query: {} });
    expect(await problemOf(p)).toBe('INTERNAL');
  });
});

describe('invalidation map', () => {
  it('covers every command and only targets GET endpoints', () => {
    const gets = new Set(ENDPOINTS.filter((e) => e.method === 'GET').map((e) => e.id));
    for (const e of ENDPOINTS.filter((x) => x.method !== 'GET')) {
      const targets = INVALIDATES[e.id];
      expect(targets, e.id).toBeDefined();
      for (const t of targets!) if (t !== '*') expect(gets.has(t), `${e.id} → ${t}`).toBe(true);
    }
  });

  it('gate decisions refresh the header, the portfolio and the inbox', () => {
    expect(INVALIDATES['gates.decide']).toEqual(
      expect.arrayContaining(['cases.header', 'overview.portfolio', 'reviews.inbox', 'gates.package']),
    );
  });

  it('every case-scoped command refreshes the case header', () => {
    for (const id of [
      'assumptions.update',
      'sizing.commit',
      'pilot.activate',
      'taskSync.retry',
      'outcomes.decide',
    ]) {
      expect(INVALIDATES[id]).toContain('cases.header');
    }
  });
});
