/**
 * D-117 golden (PQ-18): the reachable pool stays an entered count and is checked against SAM sites as
 * an upper bound. Lineage records the check as a "checked against" edge, so SAM's drawer reads
 * "Used by: Reachable pool (upper-bound check: 500 ≤ 2,000 sites)"; a pool above SAM blocks the
 * calculation like SAM > TAM. Numbers come from fixtures/aster and are compared exactly.
 */
import { describe, expect, it } from 'vitest';
import {
  economicsV2Input,
  expectedBlocking,
  expectedLineage,
  sizingV2Input,
} from '@growth-os/fixtures-aster';
import { LINEAGE_RELATION_LABELS, type SizingInput } from '@growth-os/contracts';
import { createEconomicsEngine } from '../economics/engine';
import { createSizingEngine, lineageView, mergeLineage, usedByTransitive } from './engine';

const sizing = createSizingEngine();
const economics = createEconomicsEngine();

async function graph() {
  const s = await sizing.calculate(sizingV2Input);
  const e = await economics.calculate(economicsV2Input);
  return mergeLineage(s.lineage, e.lineage);
}

describe('reachable pool upper-bound check (D-117)', () => {
  it('SAM is used by the reachable pool as an upper-bound check, exactly the golden edge', async () => {
    const view = lineageView(await graph(), 'sizing.sam.value')!;
    expect(
      view.usedByEdges.map((e) => ({ label: e.node.label, relation: e.relation, detail: e.detail })),
    ).toEqual(expectedLineage.samUsedBy);
    expect(LINEAGE_RELATION_LABELS[expectedLineage.samUsedBy[0].relation]).toBe('Upper-bound check');
  });

  it('the reachable pool is entered, not calculated from SAM: its only input is the entered count', async () => {
    const view = lineageView(await graph(), 'sizing.reachable_pool')!;
    expect(view.inputs.map((n) => n.nodeKey)).toEqual(['input.reachable_pool']);
    expect(view.node.checks).toEqual([
      {
        nodeKey: 'sizing.sam.value',
        relation: 'checked_against',
        text: 'upper-bound check: 500 ≤ 2,000 sites',
      },
      {
        nodeKey: 'sizing.sam.population',
        relation: 'checked_against',
        text: 'upper-bound check: 500 ≤ 2,000 sites',
      },
    ]);
    expect(view.node.formulaWithValues).toBe('500 sites ≤ 2,000 sites');
    // The pool still feeds SOM and economics as a calculation input.
    expect(view.usedByEdges.every((e) => e.relation === 'input_to')).toBe(true);
    expect(view.usedBy.map((n) => n.nodeKey)).toContain('sizing.som.base.customers');
  });

  it('the honest chain: SAM bounds the pool, which feeds SOM; SAM is never an input to SOM', async () => {
    const g = await graph();
    const chain = usedByTransitive(g, 'sizing.sam.value').map((n) => n.nodeKey);
    expect(chain).toContain('sizing.reachable_pool');
    expect(chain).toContain('sizing.som.base.annual_revenue');
    const som = g.find((n) => n.nodeKey === 'sizing.som.base.customers')!;
    expect(som.inputs).not.toContain('sizing.sam.value');
    expect(som.inputs).not.toContain('sizing.sam.population');
  });

  it('a pool of 2,500 sites above SAM 2,000 blocks like SAM > TAM, with no ladder figures', async () => {
    const input = structuredClone(sizingV2Input) as SizingInput;
    input.reachablePool.value = '2500';
    const out = await sizing.calculate(input);
    expect(out.blocked).toBe(true);
    const check = out.checks.find((c) => c.key === expectedBlocking.reachableExceedsSam)!;
    expect(check).toMatchObject({ blocking: true, inputKeys: ['reachable_pool'] });
    expect(check.message).toBe('The reachable pool (2,500 sites) is larger than SAM (2,000 sites).');
    const samOverTam = structuredClone(sizingV2Input) as SizingInput;
    samOverTam.tamPopulation.value = '500';
    const blocked = await sizing.calculate(samOverTam);
    expect(blocked.blocked).toBe(out.blocked);
    expect(out.ladder.som).toEqual(blocked.ladder.som);
  });

  it('a pool equal to SAM passes the check', async () => {
    const input = structuredClone(sizingV2Input) as SizingInput;
    input.reachablePool.value = '2000';
    const out = await sizing.calculate(input);
    expect(out.checks.map((c) => c.key)).not.toContain(expectedBlocking.reachableExceedsSam);
    const pool = out.lineage.find((n) => n.nodeKey === 'sizing.reachable_pool')!;
    expect(pool.checks?.[0]?.text).toBe('upper-bound check: 2,000 ≤ 2,000 sites');
  });
});
