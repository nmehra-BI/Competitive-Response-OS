/**
 * Lineage drawer (step 8): SAM exact €40,000,000, inputs one level, used by SOM and economics through
 * the reachable pool (D-056), history per committed version; tenant- and role-scoped.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
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
    const res = await api(w, API.lineage.get, m, { params: { caseRef: 'ME-104' }, query: { node: 'sizing.sam.value', model: 'sizing' } });
    expect(res.statusCode).toBe(200);
    const l = Lineage.parse(res.json());
    expect(l.exactValue).toBe('€40,000,000/year');
    expect(l.node.formulaWithValues).toContain('€40,000,000');
    expect(l.inputs.map((n) => n.nodeKey)).toEqual(expect.arrayContaining(['sizing.sam.overlap_removed', 'input.annual_spend_per_site']));
    expect(l.inputs.filter((n) => n.nodeKey.startsWith('sizing.cohort.'))).toHaveLength(2);
    expect(l.engineLabel).toBe('Calculated by sizing engine v1.0.0 · reproducible');
    expect(l.history).toEqual([expect.objectContaining({ text: 'v2 · €40,000,000/year' })]);

    // SAM sites bound the reachable pool, which feeds SOM and economics.
    const sites = Lineage.parse(
      (await api(w, API.lineage.get, m, { params: { caseRef: 'ME-104' }, query: { node: 'sizing.sam.population', model: 'sizing' } })).json(),
    );
    expect(sites.usedBy.map((u) => u.href).join(' ')).toContain('sizing.reachable_pool');
    const pool = Lineage.parse(
      (await api(w, API.lineage.get, m, { params: { caseRef: 'ME-104' }, query: { node: 'input.reachable_pool', model: 'sizing' } })).json(),
    );
    const hrefs = pool.usedBy.map((u) => u.href).join(' ');
    expect(hrefs).toContain('node=sizing.reachable_pool');
    expect(hrefs).toContain('/economics?node=economics.base.customers');
    const reach = Lineage.parse(
      (await api(w, API.lineage.get, m, { params: { caseRef: 'ME-104' }, query: { node: 'sizing.reachable_pool', model: 'sizing' } })).json(),
    );
    expect(reach.usedBy.map((u) => u.href).join(' ')).toContain('sizing.som.base');
  });

  it('economics lineage and frozen versions read the same data; unknown nodes 404', async () => {
    const m = await w.cookie('demo', 'daniel');
    const res = await api(w, API.lineage.get, m, {
      params: { caseRef: 'ME-104' },
      query: { node: 'economics.base.annual_revenue', model: 'economics', version: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(Lineage.parse(res.json()).exactValue).toBe('€2,000,000/year');
    expect((await api(w, API.lineage.get, m, { params: { caseRef: 'ME-104' }, query: { node: 'nope', model: 'sizing' } })).statusCode).toBe(404);
  });

  it('another tenant and an admin get 404', async () => {
    const q = { params: { caseRef: 'ME-104' }, query: { node: 'sizing.sam.value', model: 'sizing' as const } };
    expect((await api(w, API.lineage.get, await w.cookie('b', 'maya'), q)).statusCode).toBe(404);
    expect((await api(w, API.lineage.get, await w.cookie('demo', 'admin'), q)).statusCode).toBe(404);
  });
});
