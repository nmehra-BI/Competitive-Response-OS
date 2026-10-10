/**
 * Tenancy (WS4a): every WS4a endpoint called with another tenant's references answers 404 (never 403,
 * never data), and every one refuses a request without a session (401). Lists only return the caller's
 * own tenant. The table below must cover every WS4a endpoint (asserted).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, type EndpointDef } from '@growth-os/contracts';
import { businessUnits, mandate } from '@growth-os/fixtures-aster';
import { api, inTenant, oppId, world, type World } from '../../../src/modules/me/cases/test-support';
import { call } from '../../../src/platform/testing';

let w: World;
let ids: Record<string, string>;
beforeAll(async () => {
  w = await world({ a: 'aster-demo', b: 'aster-demo' });
  const a = w.tenants.a!;
  const maya = await w.cookie('a', 'maya');
  const claim = await api(w, API.thesis.addClaim, maya, {
    params: { caseRef: 'ME-104' },
    body: { statement: 'Plants budget annually', kind: 'unknown', sourceIds: [], assumptionId: null },
  });
  if (claim.statusCode !== 201) throw new Error(claim.body);
  ids = await inTenant(w, a, async (tx) => {
    const one = async (table: string, where: [string, string] | null = null) => {
      let q = tx.selectFrom(table as 'platform.challenge').select('id' as never);
      if (where) q = q.where(where[0] as never, '=', where[1] as never);
      return ((await q.executeTakeFirstOrThrow()) as { id: string }).id;
    };
    return {
      case: await one('platform.workflow_case', ['display_key', 'ME-104']),
      comparison: await one('me.comparison'),
      challenge: await one('platform.challenge'),
      modelReview: await one('me.model_review'),
      blocker: await one('me.blocker'),
      cohort: await one('me.cohort'),
      assumption: await one('platform.assumption', ['display_key', 'ASM-01']),
      claim: (claim.json() as { id: string }).id,
    };
  });
});
afterAll(() => w.close());

type Case = {
  def: EndpointDef;
  params?: Record<string, unknown>;
  query?: Record<string, string | number>;
  body?: unknown;
};

function table(): Case[] {
  const a = w.tenants.a!;
  const c = { caseRef: ids.case };
  const opp = oppId(a, 'OPP-14');
  return [
    { def: API.cases.header, params: c },
    { def: API.cases.transition, params: c, body: { command: 'hold', rationale: 'x' } },
    { def: API.cases.members, params: c },
    { def: API.cases.activity, params: c },
    { def: API.cases.history, params: c },
    {
      def: API.cases.requestReview,
      params: c,
      body: {
        area: 'finance',
        reviewerId: a.user('daniel'),
        targetType: 'case',
        targetId: null,
        question: 'q',
        whatToCheck: [],
        dueOn: null,
      },
    },
    {
      def: API.cases.createDirect,
      body: { businessUnitId: a.id(businessUnits[0].id), title: 'x', mandate: {} },
    },
    { def: API.mandates.get, params: { ref: a.id(mandate.id) } },
    { def: API.mandates.create, body: { businessUnitId: a.id(businessUnits[0].id), title: 'x', fields: {} } },
    { def: API.mandates.saveDraft, params: { ref: a.id(mandate.id) }, body: { fields: {} } },
    { def: API.mandates.submit, params: { ref: a.id(mandate.id) } },
    { def: API.opportunities.list, query: { mandateId: a.id(mandate.id) } },
    { def: API.opportunities.get, params: { ref: opp } },
    {
      def: API.opportunities.createManual,
      body: { mandateId: a.id(mandate.id), name: 'x', trigger: '', fitRationale: '' },
    },
    { def: API.opportunities.shortlist, params: { ref: opp } },
    { def: API.opportunities.dismiss, params: { ref: opp }, body: { reason: 'x' } },
    { def: API.opportunities.merge, params: { ref: opp }, body: { targetOpportunityId: oppId(a, 'OPP-16') } },
    { def: API.opportunities.restore, params: { ref: opp }, body: { reason: 'x' } },
    { def: API.opportunities.convert, params: { ref: opp }, body: { ownerId: a.user('maya') } },
    {
      def: API.comparisons.create,
      body: { mandateId: a.id(mandate.id), opportunityRefs: [opp, oppId(a, 'OPP-16')] },
    },
    { def: API.comparisons.get, params: { id: ids.comparison } },
    {
      def: API.comparisons.previewRanking,
      params: { id: ids.comparison },
      body: { productFit: 40, channelAccess: 30, evidenceCoverage: 30 },
    },
    {
      def: API.comparisons.applyWeights,
      params: { id: ids.comparison },
      body: { productFit: 40, channelAccess: 30, evidenceCoverage: 30 },
    },
    {
      def: API.comparisons.setExclusion,
      params: { id: ids.comparison, opportunityId: opp },
      body: { excluded: false, reason: null },
    },
    { def: API.comparisons.select, params: { id: ids.comparison }, body: { opportunityId: opp } },
    { def: API.thesis.get, params: c },
    { def: API.thesis.saveDraft, params: c, body: { fields: {} } },
    { def: API.thesis.commit, params: c },
    {
      def: API.thesis.addClaim,
      params: c,
      body: { statement: 'x', kind: 'unknown', sourceIds: [], assumptionId: null },
    },
    {
      def: API.thesis.acceptClaim,
      params: { id: ids.claim },
      body: { as: 'inference', editedStatement: null },
    },
    { def: API.thesis.discardClaim, params: { id: ids.claim } },
    { def: API.thesis.challengeClaim, params: { id: ids.claim }, body: { statement: 'x' } },
    { def: API.sizing.get, params: c },
    { def: API.sizing.saveDraft, params: c, body: {} },
    { def: API.sizing.calculateDraft, params: c },
    {
      def: API.sizing.resolveDuplicateCohort,
      params: c,
      body: { keepCohortId: ids.cohort, excludeCohortId: ids.cohort },
    },
    { def: API.sizing.commit, params: c },
    { def: API.sizing.getVersion, params: { ...c, version: 2 } },
    { def: API.sizing.compareVersions, params: c, query: { from: 2, to: 2 } },
    { def: API.sizing.population, params: { ...c, cohortId: ids.cohort } },
    { def: API.lineage.get, params: c, query: { node: 'sizing.sam.value', model: 'sizing' } },
    { def: API.feasibility.get, params: c },
    {
      def: API.feasibility.sign,
      params: { ...c, dimension: 'specialist_review' },
      body: {
        position: 'supports',
        scopeText: 'x',
        coversGate: 'G2',
        maxSites: 4,
        maxDays: 90,
        statement: null,
        evidenceSourceIds: [],
      },
    },
    {
      def: API.feasibility.recordDisagreement,
      params: { ...c, dimension: 'operations' },
      body: { statement: 'x' },
    },
    {
      def: API.feasibility.resolveBlocker,
      params: { id: ids.blocker },
      body: { kind: 'resolved', resolution: 'x', scopeRestrictionGateRequestId: null },
    },
    { def: API.economics.get, params: c },
    { def: API.economics.saveDraft, params: c, body: { drivers: [] } },
    { def: API.economics.calculateDraft, params: c },
    { def: API.economics.whatMustBeTrue, params: c },
    { def: API.economics.commit, params: c },
    {
      def: API.economics.requestFinanceReview,
      params: c,
      body: { economicsVersion: 2, reviewerId: a.user('daniel'), dueOn: null },
    },
    {
      def: API.economics.signFinanceReview,
      params: { id: ids.modelReview },
      body: { position: 'supports', checkedItems: [], notCheckedItems: [], statement: null },
    },
    { def: API.economics.export, params: c, query: { format: 'csv' } },
    { def: API.assumptions.list, params: c },
    {
      def: API.assumptions.create,
      params: c,
      body: {
        inputKey: 'x',
        name: 'x',
        ownerId: a.user('maya'),
        value: '1',
        valueText: null,
        unit: 'sites',
        basis: 'x',
        sensitivity: 'low',
        decisionCritical: false,
        consequenceIfFalse: 'x',
        validationMethod: 'x',
        dueOn: null,
      },
    },
    {
      def: API.assumptions.update,
      params: { id: ids.assumption },
      body: { value: '0.3', changeReason: 'x' },
    },
    { def: API.assumptions.versions, params: { id: ids.assumption } },
    { def: API.assumptions.retire, params: { id: ids.assumption }, body: { rationale: 'x' } },
    {
      def: API.assumptions.dispute,
      params: { id: ids.assumption },
      body: { statement: 'x', proposedValueText: null },
    },
    { def: API.assumptions.replyToChallenge, params: { id: ids.challenge }, body: { body: 'x' } },
    { def: API.assumptions.resolveChallenge, params: { id: ids.challenge }, body: { resolution: 'x' } },
  ];
}

const LISTS = [API.overview.portfolio, API.overview.listCases, API.mandates.list];
const WS4A_GROUPS = [
  'overview',
  'cases',
  'mandates',
  'opportunities',
  'comparisons',
  'thesis',
  'sizing',
  'lineage',
  'feasibility',
  'economics',
  'assumptions',
] as const;

describe('tenancy for every WS4a endpoint', () => {
  it('covers all 64 WS4a endpoints', () => {
    // Wave 4 additions (D-132) answer "Not implemented" until their stream lands them; that stream adds
    // its endpoint to the table above and removes it from this list (WAVE4.md, E2).
    const WAVE4_PENDING = new Set(['feasibility.addDimension']);
    const all = WS4A_GROUPS.flatMap((g) => Object.values(API[g]) as EndpointDef[]).filter(
      (d) => d.id !== 'opportunities.requestDiscovery' && !WAVE4_PENDING.has(d.id),
    );
    const covered = new Set([...table().map((c) => c.def.id), ...LISTS.map((d) => d.id)]);
    expect(all).toHaveLength(64);
    expect(all.map((d) => d.id).filter((id) => !covered.has(id))).toEqual([]);
  });

  it("another tenant's references → 404 on every endpoint", async () => {
    const other = await w.cookie('b', 'maya');
    const failures: string[] = [];
    for (const c of table()) {
      const res = await api(w, c.def, other, {
        params: c.params as never,
        query: c.query,
        body: c.body,
        ...(c.def.ifMatch ? { ifMatch: 0 } : {}),
      });
      if (res.statusCode !== 404 || res.json().code !== 'NOT_FOUND')
        failures.push(`${c.def.id}: ${res.statusCode} ${res.body.slice(0, 120)}`);
    }
    expect(failures).toEqual([]);
  });

  it('lists only show the caller tenant', async () => {
    const other = await w.cookie('b', 'maya');
    for (const def of LISTS) {
      const res = await api(w, def, other, {});
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(ids.case);
      expect(res.body).not.toContain(w.tenants.a!.id(mandate.id));
    }
  });

  it('no session → 401 on every endpoint', async () => {
    for (const c of [...table(), ...LISTS.map((def) => ({ def }) as Case)]) {
      const res = await call(w.t.app, c.def, {
        params: c.params as never,
        query: c.query,
        body: c.body,
        ...(c.def.idempotent ? { idempotencyKey: true as const } : {}),
        ...(c.def.ifMatch ? { ifMatch: 0 } : {}),
      });
      expect([c.def.id, res.statusCode]).toEqual([c.def.id, 401]);
    }
  });
});
