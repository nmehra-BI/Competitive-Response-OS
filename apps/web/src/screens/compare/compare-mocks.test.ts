/**
 * The S04 mock follows the WS2 ranking rules, and every response passes the contract (the api
 * client parses responses in tests): Unknown is never 0, an incomparable boundary blocks the
 * ranking until excluded, missing inputs are named, weights must total 100, scores have 2 decimals.
 */
import { API } from '@growth-os/contracts';
import { comparison as FX, people } from '@growth-os/fixtures-aster';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, ApiProblem } from '../../lib/api-client';
import { mockServer, session } from '../../mocks/node';
import { resetAllMocks } from '../overview/test-utils';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  resetAllMocks();
  session.signIn(people.maya.id);
});
afterEach(() => resetAllMocks());
afterAll(() => mockServer.close());

const key = () => crypto.randomUUID();
const REFS = ['OPP-07', 'OPP-14', 'OPP-09', 'OPP-16'];

async function create() {
  const mandate = await api(API.mandates.get, { params: { ref: 'MD-21' } });
  return api(API.comparisons.create, {
    body: { mandateId: mandate.id, opportunityRefs: REFS },
    idempotencyKey: key(),
  });
}
const idOf = async (ref: string) => (await api(API.opportunities.get, { params: { ref } })).id;

describe('comparison mocks (WS2 ranking semantics)', () => {
  it('keeps Unknown as null, never 0', async () => {
    const c = await create();
    expect(c.id).toBe(FX.id);
    const unknown = c.cells.filter((x) => x.unknown);
    expect(unknown.length).toBeGreaterThan(0);
    for (const cell of unknown) {
      expect(cell.rating).toBeNull();
      expect(cell.valueText ?? '').not.toMatch(/^0/);
    }
    const opp14 = await idOf('OPP-14');
    expect(c.cells.find((x) => x.opportunityId === opp14 && x.attribute === 'channel_access')).toMatchObject({
      rating: null,
      unknown: true,
    });
  });

  it('an incomparable boundary blocks the whole ranking until it is excluded', async () => {
    const c = await create();
    expect(c.incomparableWarnings).toHaveLength(1);
    expect(c.ranking.every((r) => !r.ranked && r.reason === 'Not ranked — boundary conflict in set')).toBe(
      true,
    );

    const opp09 = await idOf('OPP-09');
    const after = await api(API.comparisons.setExclusion, {
      params: { id: c.id, opportunityId: opp09 },
      body: { excluded: true, reason: 'Excluded until normalized' },
    });
    const [o07, o14, o16] = await Promise.all(['OPP-07', 'OPP-14', 'OPP-16'].map(idOf));
    // Rank order: ranked rows first by score; ties keep input order; unranked last.
    expect(after.ranking.map((r) => [r.opportunityId, r.ranked, r.score, r.reason])).toEqual([
      [o07, true, '2.70', null],
      [o16, true, '1.70', null],
      [o14, false, null, 'Not ranked — 1 input missing (channel access)'],
      [opp09, false, null, 'Excluded until normalized'],
    ]);
    expect(after.formulaText).toContain('any Unknown input → not ranked');
  });

  it('previews weights without applying them; an invalid total ranks nothing', async () => {
    const c = await create();
    await api(API.comparisons.setExclusion, {
      params: { id: c.id, opportunityId: await idOf('OPP-09') },
      body: { excluded: true, reason: 'Excluded until normalized' },
    });
    const bad = await api(API.comparisons.previewRanking, {
      params: { id: c.id },
      body: { productFit: 50, channelAccess: 30, evidenceCoverage: 30 },
    });
    expect(bad.valid).toBe(false);
    expect(bad.totalWeight).toBe(110);
    expect(bad.ranking.filter((r) => r.ranked)).toHaveLength(0);
    const ok = await api(API.comparisons.previewRanking, {
      params: { id: c.id },
      body: { productFit: 50, channelAccess: 20, evidenceCoverage: 30 },
    });
    expect(ok.ranking[0]?.score).toBe('2.70');
    // Preview wrote nothing.
    const still = await api(API.comparisons.get, { params: { id: c.id } });
    expect(still.weights.version).toBe(1);
    const applied = await api(API.comparisons.applyWeights, {
      params: { id: c.id },
      body: { productFit: 50, channelAccess: 20, evidenceCoverage: 30 },
      idempotencyKey: key(),
    });
    expect(applied.weights).toMatchObject({ version: 2, productFit: 50 });
    expect(applied.weightsHistory.map((w) => w.version)).toEqual([1, 2]);
  });

  it('cannot select an incomparable candidate; selecting shortlists the candidate', async () => {
    const c = await create();
    const p = api(API.comparisons.select, {
      params: { id: c.id },
      body: { opportunityId: await idOf('OPP-09') },
      idempotencyKey: key(),
    });
    await expect(p).rejects.toBeInstanceOf(ApiProblem);
    const sel = await api(API.comparisons.select, {
      params: { id: c.id },
      body: { opportunityId: await idOf('OPP-16') },
      idempotencyKey: key(),
    });
    expect(sel.selectedOpportunityId).toBe(await idOf('OPP-16'));
    expect((await api(API.opportunities.get, { params: { ref: 'OPP-16' } })).status).toBe('shortlisted');
  });
});
