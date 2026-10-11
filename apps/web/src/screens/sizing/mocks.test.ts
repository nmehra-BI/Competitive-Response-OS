/**
 * WS8b MSW mocks: every response parses with its frozen contract schema, values are exactly what
 * the engines produce for the Aster fixture, and the API edges behave (404, 403, 412, 422).
 */
import { API, EconomicsView, FeasibilityView, SizingView, ThesisView } from '@growth-os/contracts';
import { economicsV2Input, expectedSizing, people, sizingV2Input } from '@growth-os/fixtures-aster';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { api, ApiProblem } from '../../lib/api-client';
import { mockServer, resetMockState, resetReplay, session } from '../../mocks/node';
import { economicsEngine, economicsInputFromDrivers } from '../economics/engine/adapter';
import { sizingEngine } from './engine/adapter';
import { resetAssessmentMocks, setAssessmentScenario } from './mock-state';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  resetMockState();
  resetReplay();
  resetAssessmentMocks();
});
afterAll(() => mockServer.close());

const caseRef = 'ME-104';
let n = 0;
const key = () => `ws8b-test-${++n}`;

async function problemOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'no error';
  } catch (e) {
    return e instanceof ApiProblem ? e.code : String(e);
  }
}

describe('WS8b mocks', () => {
  it('serve contract-valid views for every persona', async () => {
    for (const p of Object.values(people).filter((x) => x.kind === 'human')) {
      session.signIn(p.id);
      SizingView.parse(await api(API.sizing.get, { params: { caseRef } }));
      EconomicsView.parse(await api(API.economics.get, { params: { caseRef } }));
      FeasibilityView.parse(await api(API.feasibility.get, { params: { caseRef } }));
      ThesisView.parse(await api(API.thesis.get, { params: { caseRef } }));
      await api(API.assumptions.list, { params: { caseRef } });
      await api(API.analysis.latestForCase, { params: { caseRef }, query: {} });
      await api(API.lineage.get, {
        params: { caseRef },
        query: { node: 'sizing.sam.value', model: 'sizing' },
      });
      await api(API.lineage.get, {
        params: { caseRef },
        query: { node: 'economics.base.contribution_after_opex', model: 'economics' },
      });
    }
  });

  it('return exactly the engine output for the fixture', async () => {
    session.signIn(people.maya.id);
    const v = await api(API.sizing.get, { params: { caseRef } });
    expect(v.draft!.result).toEqual(await sizingEngine.calculate(sizingV2Input));
    expect(v.draft!.result!.ladder.sam.value.amount).toBe(expectedSizing.sam.value);
    const e = await api(API.economics.get, { params: { caseRef } });
    expect(e.current!.result).toEqual(await economicsEngine.calculate(economicsV2Input));
    // The client adapter rebuilds the same engine input from the drivers.
    const local = await economicsEngine.calculate(economicsInputFromDrivers(e.current!));
    expect(local.inputHash).toBe(e.current!.result!.inputHash);
  });

  it('unknown cases are 404, never 403', async () => {
    session.signIn(people.maya.id);
    expect(await problemOf(api(API.sizing.get, { params: { caseRef: 'ME-999' } }))).toBe('NOT_FOUND');
    expect(await problemOf(api(API.economics.get, { params: { caseRef: 'ME-999' } }))).toBe('NOT_FOUND');
  });

  it('sizing: SAM > TAM blocks commit with CALCULATION_BLOCKED; undo then commit creates v2', async () => {
    session.signIn(people.maya.id);
    let v = await api(API.sizing.get, { params: { caseRef } });
    v = await api(API.sizing.saveDraft, {
      params: { caseRef },
      ifMatch: v.draft!.rowVersion,
      body: {
        inputs: [
          { inputKey: 'tam_site_count', value: '500', unit: 'sites', sourceId: null, assumptionId: null },
        ],
      },
    });
    expect(v.draft!.result!.blocked).toBe(true);
    expect(v.draft!.result!.checks.map((c) => c.key)).toContain('SAM_EXCEEDS_TAM');
    expect(await problemOf(api(API.sizing.commit, { params: { caseRef }, idempotencyKey: key() }))).toBe(
      'CALCULATION_BLOCKED',
    );
    // Stale If-Match is a conflict, never a silent overwrite.
    expect(
      await problemOf(
        api(API.sizing.saveDraft, {
          params: { caseRef },
          ifMatch: 1,
          body: {
            inputs: [
              {
                inputKey: 'tam_site_count',
                value: '5000',
                unit: 'sites',
                sourceId: null,
                assumptionId: null,
              },
            ],
          },
        }),
      ),
    ).toBe('VERSION_CONFLICT');
    v = await api(API.sizing.saveDraft, {
      params: { caseRef },
      ifMatch: v.draft!.rowVersion,
      body: {
        inputs: [
          { inputKey: 'tam_site_count', value: '5000', unit: 'sites', sourceId: null, assumptionId: null },
        ],
      },
    });
    expect(v.draft!.result!.blocked).toBe(false);
    expect(v.draft!.ledger.find((r) => r.inputKey === 'tam_site_count')!.changedInDraft).toBe(false);
    const committed = await api(API.sizing.commit, { params: { caseRef }, idempotencyKey: key() });
    expect(committed.version).toBe(2);
    expect(committed.state).toBe('committed');
    const frozen = await api(API.sizing.getVersion, { params: { caseRef, version: 2 } });
    expect(frozen.result!.ladder.sam.value.amount).toBe('40000000.00');
  });

  it('lineage on SAM: exact value, one-level inputs, used by SOM and economics', async () => {
    session.signIn(people.maya.id);
    const l = await api(API.lineage.get, {
      params: { caseRef },
      query: { node: 'sizing.sam.value', model: 'sizing' },
    });
    expect(l.exactValue).toBe('€40,000,000/year');
    expect(l.node.formulaWithValues).toBe('(1,400 + 1,100 − 500) × €20,000 = €40,000,000/year');
    expect(l.inputs.map((i) => i.label)).toEqual([
      'Size-qualified',
      'Process-qualified',
      'Overlap removed',
      'Annual spend per site',
    ]);
    expect(l.usedBy.map((u) => u.label)).toEqual(['Reachable pool', 'SOM', 'Economics']);
  });

  it('a blocked draft never exposes calculated lineage values', async () => {
    session.signIn(people.maya.id);
    setAssessmentScenario({ sizingVariant: 'sam_exceeds_tam' });
    const l = await api(API.lineage.get, {
      params: { caseRef },
      query: { node: 'sizing.sam.value', model: 'sizing', version: 'draft' },
    });
    expect(l.node.value).toBeNull();
    expect(l.exactValue).toBe('Not available — resolve the blocking checks first');
  });

  it('duplicate cohort: keep v1 excludes the import (kept, not deleted) and unblocks', async () => {
    session.signIn(people.maya.id);
    setAssessmentScenario({ sizingVariant: 'duplicate_cohort' });
    const v = await api(API.sizing.get, { params: { caseRef } });
    expect(v.duplicateCohorts).toHaveLength(1);
    expect(v.draft!.result!.checks.map((c) => c.key)).toContain('DUPLICATE_COHORT');
    const d = v.duplicateCohorts[0]!;
    const after = await api(API.sizing.resolveDuplicateCohort, {
      params: { caseRef },
      ifMatch: v.draft!.rowVersion,
      body: { keepCohortId: d.cohortAId, excludeCohortId: d.cohortBId },
    });
    expect(after.duplicateCohorts).toEqual([]);
    expect(after.draft!.cohorts.find((c) => c.id === d.cohortBId)!.status).toBe('excluded');
    expect(after.draft!.result!.blocked).toBe(false);
  });

  it('economics: the draft recalculates, the committed snapshot never changes', async () => {
    session.signIn(people.maya.id);
    const before = await api(API.economics.get, { params: { caseRef } });
    const after = await api(API.economics.saveDraft, {
      params: { caseRef },
      ifMatch: before.draft!.rowVersion,
      body: { drivers: [{ inputKey: 'adoption_rate.base', value: '0.22' }] },
    });
    expect(after.current).toEqual(before.current);
    const base = after.draft!.result!.scenarios.find((s) => s.scenario === 'base')!;
    expect(base.customers).toBe(110);
    expect(after.draft!.drivers.find((d) => d.inputKey === 'adoption_rate.base')!.changedInDraft).toBe(true);
    const local = await economicsEngine.calculate(
      economicsInputFromDrivers(before.draft!, { 'adoption_rate.base': '0.22' }),
    );
    expect(local).toEqual(after.draft!.result);
    expect(
      await problemOf(
        api(API.economics.saveDraft, {
          params: { caseRef },
          ifMatch: before.draft!.rowVersion,
          body: { drivers: [{ inputKey: 'gross_margin', value: '0.50' }] },
        }),
      ),
    ).toBe('VERSION_CONFLICT');
  });

  it('disputes: owner cannot dispute, Daniel can, and a second open dispute is refused', async () => {
    setAssessmentScenario({ adoptionDisputed: false });
    session.signIn(people.maya.id);
    const { items } = await api(API.assumptions.list, { params: { caseRef } });
    const asm = items.find((a) => a.inputKey === 'adoption_rate.base')!;
    expect(asm.openDispute).toBeNull();
    const body = {
      statement: 'Plan on 10% until the pilot shows paid use.',
      proposedValueText: 'Downside adoption 10%',
    };
    expect(
      await problemOf(api(API.assumptions.dispute, { params: { id: asm.id }, body, idempotencyKey: key() })),
    ).toBe('FORBIDDEN');
    session.signIn(people.daniel.id);
    const c = await api(API.assumptions.dispute, { params: { id: asm.id }, body, idempotencyKey: key() });
    expect(c.raisedBy.displayName).toBe('Daniel Weber');
    expect(c.status).toBe('open');
    expect(
      await problemOf(api(API.assumptions.dispute, { params: { id: asm.id }, body, idempotencyKey: key() })),
    ).toBe('INVALID_TRANSITION');
    const t = await api(API.thesis.get, { params: { caseRef } });
    expect(t.disagreements.map((d) => d.raisedBy.displayName)).toEqual(['Daniel Weber']);
  });

  it('feasibility: only the named reviewer signs; the agent never appears as signer', async () => {
    session.signIn(people.maya.id);
    const body = {
      position: 'supports' as const,
      scopeText: 'Signed for pilot only: up to 4 sites, 90 days',
      coversGate: 'G2' as const,
      maxSites: 4,
      maxDays: 90,
      statement: null,
      evidenceSourceIds: [],
    };
    expect(
      await problemOf(
        api(API.feasibility.sign, {
          params: { caseRef, dimension: 'specialist_review' },
          body,
          idempotencyKey: key(),
        }),
      ),
    ).toBe('FORBIDDEN');
    const v = await api(API.feasibility.get, { params: { caseRef } });
    const spec = v.rows.find((r) => r.dimension === 'specialist_review')!;
    expect(spec.status).toBe('pending');
    expect(spec.scopeText).toBe('Pending — human review required');
    expect(spec.humanOnly).toBe(true);
    session.signIn(people.lena.id);
    const signed = await api(API.feasibility.sign, {
      params: { caseRef, dimension: 'specialist_review' },
      body,
      idempotencyKey: key(),
    });
    const row = signed.rows.find((r) => r.dimension === 'specialist_review')!;
    expect(row.currentReview!.signedBy.displayName).toBe('Lena Hoffmann');
    expect(row.blockers[0]!.status).toBe('resolved');
    expect(signed.counts.blockers).toBe(0);
  });

  it('thesis: the running analysis reports business copy, never a percentage', async () => {
    session.signIn(people.maya.id);
    const runs = await api(API.analysis.latestForCase, { params: { caseRef }, query: {} });
    expect(runs.items[0]!.statusLabel).toBe('Working: checking sources…');
    const t = await api(API.thesis.get, { params: { caseRef } });
    expect(t.current!.fields.alternatives.some((a) => a.isNoEntry && a.name === 'No entry')).toBe(true);
    expect(t.claims.every((c) => !!c.kind)).toBe(true);
  });
});
