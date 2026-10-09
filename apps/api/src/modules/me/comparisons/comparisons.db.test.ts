/**
 * Comparison (S04, step 4). Unknown cells are null (never 0); an incomparable boundary blocks the whole
 * ranking until excluded; OPP-14 is "Not ranked — 1 input missing"; the ranking array is the rank order;
 * the same candidate set reopens the existing comparison.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, Comparison } from '@growth-os/contracts';
import { mandate } from '@growth-os/fixtures-aster';
import { analyticsFor, api, auditFor, oppId, world, type World } from '../cases/test-support';

let w: World;
let cmp: Comparison;
beforeAll(async () => {
  w = await world({ demo: 'aster-demo', a: 'aster-start' });
  const ids = ['OPP-07', 'OPP-14', 'OPP-09', 'OPP-16'];
  // Same candidate set (in another order) as the seeded comparison: the existing one is returned.
  const res = await api(w, API.comparisons.create, await w.cookie('demo', 'maya'), {
    body: { mandateId: w.tenants.demo!.id(mandate.id), opportunityRefs: [...ids].reverse() },
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  cmp = Comparison.parse(res.json());
});
afterAll(() => w.close());

const D = () => w.tenants.demo!;
const key = (id: string) => ['OPP-07', 'OPP-14', 'OPP-09', 'OPP-16'].find((k) => oppId(D(), k) === id);

describe('comparisons', () => {
  it('reopens the existing comparison for the same candidate set (no second comparison)', async () => {
    expect(cmp.weights).toMatchObject({
      version: 1,
      productFit: 40,
      channelAccess: 30,
      evidenceCoverage: 30,
    });
    expect(cmp.selectedOpportunityId).toBe(oppId(D(), 'OPP-07'));
    const again = await api(w, API.comparisons.create, await w.cookie('demo', 'maya'), {
      body: { mandateId: D().id(mandate.id), opportunityRefs: ['OPP-16', 'OPP-09', 'OPP-07', 'OPP-14'] },
    });
    expect(Comparison.parse(again.json()).id).toBe(cmp.id);
    expect((await auditFor(w, D(), cmp.id)).map((e) => e.action)).toEqual([
      'comparison.reopened',
      'comparison.reopened',
    ]);
  });

  it('step 4: Unknown is null; OPP-14 not ranked (1 input missing); OPP-09 excluded; rows in rank order', async () => {
    const c = Comparison.parse(
      (await api(w, API.comparisons.get, await w.cookie('demo', 'priya'), { params: { id: cmp.id } })).json(),
    );
    const channel14 = c.cells.find(
      (x) => x.opportunityId === oppId(D(), 'OPP-14') && x.attribute === 'channel_access',
    )!;
    expect(channel14).toMatchObject({ rating: null, unknown: true, ratingLabel: null });
    expect(c.ranking.map((r) => key(r.opportunityId))).toEqual(['OPP-07', 'OPP-16', 'OPP-14', 'OPP-09']);
    expect(c.ranking[0]).toMatchObject({ ranked: true, score: '2.70' });
    expect(c.ranking[2]!.reason).toMatch(/^Not ranked — 1 input missing/);
    expect(c.ranking[3]!.reason).toBe('Excluded until normalized');
    expect(c.incomparableWarnings.map((x) => key(x.opportunityId))).toEqual(['OPP-09']);
  });

  it('step 4: Austrian breweries (OPP-09) blocks the ranking until excluded again', async () => {
    const m = await w.cookie('demo', 'maya');
    const inc = await api(w, API.comparisons.setExclusion, m, {
      params: { id: cmp.id, opportunityId: oppId(D(), 'OPP-09') },
      body: { excluded: false, reason: null },
    });
    const blocked = Comparison.parse(inc.json());
    expect(
      blocked.ranking.every((r) => !r.ranked && r.reason === 'Not ranked — boundary conflict in set'),
    ).toBe(true);
    const noReason = await api(w, API.comparisons.setExclusion, m, {
      params: { id: cmp.id, opportunityId: oppId(D(), 'OPP-09') },
      body: { excluded: true, reason: null },
    });
    expect(noReason.statusCode).toBe(400);
    const exc = await api(w, API.comparisons.setExclusion, m, {
      params: { id: cmp.id, opportunityId: oppId(D(), 'OPP-09') },
      body: { excluded: true, reason: 'Company counts and 2024 prices' },
    });
    expect(Comparison.parse(exc.json()).ranking.map((r) => key(r.opportunityId))).toEqual([
      'OPP-07',
      'OPP-16',
      'OPP-14',
      'OPP-09',
    ]);
  });

  it('previews and applies weights as a new version; invalid totals are refused; reviewers cannot apply', async () => {
    const m = await w.cookie('demo', 'maya');
    const prev = await api(w, API.comparisons.previewRanking, m, {
      params: { id: cmp.id },
      body: { productFit: 20, channelAccess: 20, evidenceCoverage: 20 },
    });
    expect(API.comparisons.previewRanking.response.parse(prev.json())).toMatchObject({
      totalWeight: 60,
      valid: false,
    });
    const bad = await api(w, API.comparisons.applyWeights, m, {
      params: { id: cmp.id },
      body: { productFit: 20, channelAccess: 20, evidenceCoverage: 20 },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await api(w, API.comparisons.applyWeights, m, {
      params: { id: cmp.id },
      body: { productFit: 20, channelAccess: 30, evidenceCoverage: 50 },
    });
    const c = Comparison.parse(ok.json());
    expect(c.weights.version).toBe(2);
    expect(c.weightsHistory.map((h) => h.version)).toEqual([1, 2]);
    // OPP-07: 3×20% + 3×30% + 2×50% = 2.50; OPP-16: 2×20% + 2×30% + 1×50% = 1.50.
    expect(c.ranking.slice(0, 2).map((r) => r.score)).toEqual(['2.50', '1.50']);
    expect(
      (
        await api(w, API.comparisons.applyWeights, await w.cookie('demo', 'lena'), {
          params: { id: cmp.id },
          body: { productFit: 40, channelAccess: 30, evidenceCoverage: 30 },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await api(w, API.comparisons.get, await w.cookie('a', 'maya'), { params: { id: cmp.id } })).statusCode,
    ).toBe(404);
  });

  it('selecting a detected candidate shortlists it (opportunity_shortlisted); no spend is approved', async () => {
    const res = await api(w, API.comparisons.select, await w.cookie('demo', 'maya'), {
      params: { id: cmp.id },
      body: { opportunityId: oppId(D(), 'OPP-16') },
    });
    expect(Comparison.parse(res.json()).selectedOpportunityId).toBe(oppId(D(), 'OPP-16'));
    expect((await analyticsFor(w, D(), 'opportunity_shortlisted')).map((e) => e.props)).toEqual([
      { origin: 'ai' },
    ]);
  });

  it('a new comparison on aster-start has Unknown cells and ranks nothing', async () => {
    const res = await api(w, API.comparisons.create, await w.cookie('a', 'maya'), {
      body: { mandateId: w.tenants.a!.id(mandate.id), opportunityRefs: ['OPP-07', 'OPP-14'] },
    });
    const c = Comparison.parse(res.json());
    expect(c.cells.every((x) => x.rating === null && x.unknown)).toBe(true);
    expect(c.ranking.every((r) => !r.ranked && r.reason!.startsWith('Not ranked — 3 inputs missing'))).toBe(
      true,
    );
  });
});
