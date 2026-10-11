/**
 * Lineage drawer (step 8): SAM exact €40,000,000, inputs one level, used by SOM and economics through
 * the reachable pool (D-056), history per committed version; tenant- and role-scoped. D-117: SAM is
 * used by the reachable pool as an upper-bound check ("checked against"), and a pool above SAM blocks.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, SizingView } from '@growth-os/contracts';
import { expectedBlocking, expectedLineage } from '@growth-os/fixtures-aster';
import { api, world, type World } from '../cases/test-support';

let w: World;
beforeAll(async () => {
  w = await world({ demo: 'aster-demo', b: 'aster-start' });
});
afterAll(() => w.close());

const Lineage = API.lineage.get.response;

describe('lineage', () => {
  it('step 8: SAM value is exact, with inputs one level and the path to SOM and economics', async () => {
    const m = await w.cookie('demo', 'maya');
    const res = await api(w, API.lineage.get, m, {
      params: { caseRef: 'ME-104' },
      query: { node: 'sizing.sam.value', model: 'sizing' },
    });
    expect(res.statusCode).toBe(200);
    const l = Lineage.parse(res.json());
    expect(l.exactValue).toBe('€40,000,000/year');
    expect(l.node.formulaWithValues).toContain('€40,000,000');
    expect(l.inputs.map((n) => n.nodeKey)).toEqual(
      expect.arrayContaining(['sizing.sam.overlap_removed', 'input.annual_spend_per_site']),
    );
    expect(l.inputs.filter((n) => n.nodeKey.startsWith('sizing.cohort.'))).toHaveLength(2);
    expect(l.engineLabel).toBe('Calculated by sizing engine v1.0.0 · reproducible');
    expect(l.history).toEqual([expect.objectContaining({ text: 'v2 · €40,000,000/year' })]);

    // SAM sites bound the reachable pool, which feeds SOM and economics.
    const sites = Lineage.parse(
      (
        await api(w, API.lineage.get, m, {
          params: { caseRef: 'ME-104' },
          query: { node: 'sizing.sam.population', model: 'sizing' },
        })
      ).json(),
    );
    expect(sites.usedBy.map((u) => u.href).join(' ')).toContain('sizing.reachable_pool');
    const pool = Lineage.parse(
      (
        await api(w, API.lineage.get, m, {
          params: { caseRef: 'ME-104' },
          query: { node: 'input.reachable_pool', model: 'sizing' },
        })
      ).json(),
    );
    const hrefs = pool.usedBy.map((u) => u.href).join(' ');
    expect(hrefs).toContain('node=sizing.reachable_pool');
    expect(hrefs).toContain('/economics?node=economics.base.customers');
    const reach = Lineage.parse(
      (
        await api(w, API.lineage.get, m, {
          params: { caseRef: 'ME-104' },
          query: { node: 'sizing.reachable_pool', model: 'sizing' },
        })
      ).json(),
    );
    expect(reach.usedBy.map((u) => u.href).join(' ')).toContain('sizing.som.base');
  });

  it('D-117: SAM is used by the reachable pool as an upper-bound check (golden expectedLineage.samUsedBy)', async () => {
    const m = await w.cookie('demo', 'maya');
    for (const node of ['sizing.sam.value', 'sizing.sam.population']) {
      const l = Lineage.parse(
        (
          await api(w, API.lineage.get, m, {
            params: { caseRef: 'ME-104' },
            query: { node, model: 'sizing' },
          })
        ).json(),
      );
      expect(l.usedBy.map(({ label, relation, detail }) => ({ label, relation, detail }))).toEqual(
        expectedLineage.samUsedBy,
      );
      expect(l.usedBy[0]!.href).toBe('/me/cases/ME-104/sizing?node=sizing.reachable_pool');
    }
    // The reachable pool is an entered count: its only input is the entered value, never SAM.
    const pool = Lineage.parse(
      (
        await api(w, API.lineage.get, m, {
          params: { caseRef: 'ME-104' },
          query: { node: 'sizing.reachable_pool', model: 'sizing' },
        })
      ).json(),
    );
    expect(pool.inputs.map((n) => n.nodeKey)).toEqual(['input.reachable_pool']);
    expect(pool.usedBy.every((u) => (u.relation ?? 'input_to') === 'input_to')).toBe(true);
  });

  it('D-117: a reachable pool of 2,500 sites above SAM 2,000 blocks the draft like SAM > TAM', async () => {
    const m = await w.cookie('demo', 'maya');
    const got = await api(w, API.sizing.get, m, { params: { caseRef: 'ME-104' } });
    const now = SizingView.parse(got.json());
    const ledger = (now.draft ?? now.current)!.ledger.find((l) => l.inputKey === 'reachable_pool')!;
    const res = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: 'ME-104' },
      ifMatch: Number(String(got.headers.etag).replaceAll('"', '')),
      body: {
        inputs: [
          {
            inputKey: 'reachable_pool',
            value: '2500',
            unit: 'sites',
            // An entered count with a source (not the register's assumption value), as an editor types it.
            sourceId: (now.draft ?? now.current)!.ledger.find((l) => l.inputKey === 'tam_site_count')!.basis
              .source!.sourceId,
            assumptionId: null,
            basisText: `Edited from ${ledger.value} for the upper-bound check`,
          },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const out = SizingView.parse(res.json()).draft!.result!;
    expect(out.blocked).toBe(true);
    expect(out.checks.find((c) => c.key === expectedBlocking.reachableExceedsSam)).toMatchObject({
      blocking: true,
      message: 'The reachable pool (2,500 sites) is larger than SAM (2,000 sites).',
    });
    // Blocked like SAM > TAM: no ladder figures, and the draft lineage drawer has nothing to show.
    expect(out.ladder.som).toEqual([]);
    const draft = await api(w, API.lineage.get, m, {
      params: { caseRef: 'ME-104' },
      query: { node: 'sizing.sam.value', model: 'sizing', version: 'draft' },
    });
    expect(draft.statusCode).toBe(422);
    expect(draft.json().checks.map((c: { key: string }) => c.key)).toContain('REACHABLE_EXCEEDS_SAM');
  });

  it('economics lineage and frozen versions read the same data; unknown nodes 404', async () => {
    const m = await w.cookie('demo', 'daniel');
    const res = await api(w, API.lineage.get, m, {
      params: { caseRef: 'ME-104' },
      query: { node: 'economics.base.annual_revenue', model: 'economics', version: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(Lineage.parse(res.json()).exactValue).toBe('€2,000,000/year');
    expect(
      (
        await api(w, API.lineage.get, m, {
          params: { caseRef: 'ME-104' },
          query: { node: 'nope', model: 'sizing' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('another tenant and an admin get 404', async () => {
    const q = {
      params: { caseRef: 'ME-104' },
      query: { node: 'sizing.sam.value', model: 'sizing' as const },
    };
    expect((await api(w, API.lineage.get, await w.cookie('b', 'maya'), q)).statusCode).toBe(404);
    expect((await api(w, API.lineage.get, await w.cookie('demo', 'admin'), q)).statusCode).toBe(404);
  });
});
