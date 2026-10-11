/**
 * Sizing (S06, ME-05): acceptance steps 6–8 on aster-start (journey through the real endpoints) and
 * committed history on aster-demo (v2 read, v3 commit runs materiality on G2 v3).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, SizingOutput, SizingVersion, SizingView } from '@growth-os/contracts';
import {
  analyticsFor,
  api,
  auditFor,
  convertOpp07,
  enterSizing,
  inTenant,
  registerAssumptions,
  sourceId,
  world,
  type World,
} from '../cases/test-support';
import { agentCookie } from '../gates/testkit';

let w: World;
let caseKey: string;
let asm: Record<string, string>;
beforeAll(async () => {
  w = await world({ a: 'aster-start', demo: 'aster-demo', b: 'aster-start', e: 'aster-start' });
  caseKey = await convertOpp07(w, 'a');
  asm = await registerAssumptions(w, 'a', caseKey);
});
afterAll(() => w.close());

const maya = () => w.cookie('a', 'maya');

describe('sizing journey (aster-start)', () => {
  let view: SizingView;

  it('step 6: ladder TAM 5,000 · €100m/year, SAM 2,000 · €40m/year, reachable 500 (no money), SOM Base 100 · €2.0m; no total', async () => {
    view = await enterSizing(w, 'a', caseKey, asm);
    const r = view.draft!.result!;
    expect(r.blocked).toBe(false);
    expect(r.ladder.tam).toMatchObject({
      population: 5000,
      value: { amount: '100000000.00', timeBasis: 'per_year' },
    });
    expect(r.ladder.sam).toMatchObject({
      population: 2000,
      cohortSum: 2500,
      overlapRemoved: 500,
      value: { amount: '40000000.00' },
    });
    expect(r.ladder.reachablePool).toEqual({ population: 500 });
    const base = r.ladder.som.find((s) => s.scenario === 'base')!;
    expect(base).toMatchObject({ customers: 100, annualRevenue: { amount: '2000000.00' } });
    expect(JSON.stringify(view)).not.toMatch(/"total/i);
    // The ledger shows each input with its basis; assumption values come from the register.
    const adoption = view.draft!.ledger.find((l) => l.inputKey === 'adoption_rate.base')!;
    expect(adoption).toMatchObject({
      value: '0.2',
      kind: 'assumption',
      assumptionId: asm['adoption_rate.base'],
    });
    expect(view.draft!.ledger.find((l) => l.inputKey === 'tam_site_count')!.basis.source?.key).toBe(
      'SRC-014',
    );
  });

  it('step 7: draft TAM 500 → blocking "SAM is larger than TAM", no ladder values; commit refused; undo restores', async () => {
    const m = await maya();
    const sizingNow = SizingView.parse(
      (await api(w, API.sizing.get, m, { params: { caseRef: caseKey } })).json(),
    );
    const tamInput = (value: string) => ({
      inputs: [
        {
          inputKey: 'tam_site_count',
          value,
          unit: 'sites' as const,
          sourceId: sizingNow.draft!.ledger.find((l) => l.inputKey === 'tam_site_count')!.basis.source!
            .sourceId,
          assumptionId: null,
        },
      ],
    });
    const stale = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: caseKey },
      ifMatch: 0,
      body: tamInput('500'),
    });
    expect(stale.statusCode).toBe(412);
    const res = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: caseKey },
      ifMatch: sizingNow.draft!.rowVersion,
      body: tamInput('500'),
    });
    expect(res.statusCode).toBe(200);
    const v = SizingView.parse(res.json());
    const out = v.draft!.result!;
    expect(out.blocked).toBe(true);
    const check = out.checks.find((c) => c.key === 'SAM_EXCEEDS_TAM')!;
    expect(check.blocking).toBe(true);
    expect(check.message).toContain('is larger than TAM');
    // D-033: no ladder values while blocked.
    expect(out.ladder.som).toEqual([]);
    expect(out.ladder.sam.available).toBe(false);
    expect(out.ladder.tam.value.amount).toBe('0.00');
    // Every placeholder rung is flagged (D-081, CR-WS4a-1).
    expect(out.ladder.tam.available).toBe(false);
    expect(out.ladder.reachablePool.available).toBe(false);
    expect(out.lineage.filter((n) => n.kind === 'calculated').every((n) => n.value === null)).toBe(true);

    const calc = await api(w, API.sizing.calculateDraft, m, { params: { caseRef: caseKey } });
    expect(SizingOutput.parse(calc.json()).blocked).toBe(true);
    const commit = await api(w, API.sizing.commit, m, { params: { caseRef: caseKey } });
    expect(commit.statusCode).toBe(422);
    expect(commit.json()).toMatchObject({ code: 'CALCULATION_BLOCKED' });
    expect(commit.json().checks.map((c: { key: string }) => c.key)).toContain('SAM_EXCEEDS_TAM');

    const undo = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: caseKey },
      ifMatch: v.draft!.rowVersion,
      body: tamInput('5000'),
    });
    expect(SizingView.parse(undo.json()).draft!.result!.blocked).toBe(false);
  });

  it('step 8: commit creates an immutable version with sizing_snapshot_created; replay returns it once', async () => {
    const m = await maya();
    const key = 'commit-sizing-1';
    const res = await api(w, API.sizing.commit, m, { params: { caseRef: caseKey }, idempotencyKey: key });
    expect(res.statusCode).toBe(201);
    const v = SizingVersion.parse(res.json());
    expect(v).toMatchObject({ state: 'committed', version: 1 });
    expect(v.ledger.every((l) => l.kind !== 'assumption' || l.assumptionId)).toBe(true);
    const replay = await api(w, API.sizing.commit, m, { params: { caseRef: caseKey }, idempotencyKey: key });
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const events = await analyticsFor(w, w.tenants.a!, 'sizing_snapshot_created');
    expect(events).toHaveLength(1);
    expect(events[0]!.props).toEqual({ version: 1, blockedChecks: 0 });
    expect((await auditFor(w, w.tenants.a!, v.id)).map((e) => e.action)).toContain(
      'sizing.version_committed',
    );
    // The database refuses changes to a committed version.
    await expect(
      inTenant(w, w.tenants.a!, (tx) =>
        tx.updateTable('me.sizing_version').set({ horizon_years: 5 }).where('id', '=', v.id).execute(),
      ),
    ).rejects.toThrow();
    const got = await api(w, API.sizing.getVersion, m, { params: { caseRef: caseKey, version: 1 } });
    expect(SizingVersion.parse(got.json()).result!.inputHash).toBe(v.result!.inputHash);
    expect((await api(w, API.sizing.commit, m, { params: { caseRef: caseKey } })).statusCode).toBe(409);
  });

  it('compares versions and a new draft field by field', async () => {
    const m = await maya();
    const view = SizingView.parse((await api(w, API.sizing.get, m, { params: { caseRef: caseKey } })).json());
    const d = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: caseKey },
      ifMatch: view.current!.rowVersion,
      body: { horizonYears: 4 },
    });
    expect(d.statusCode).toBe(200);
    const cmp = await api(w, API.sizing.compareVersions, m, {
      params: { caseRef: caseKey },
      query: { from: 1, to: 'draft' },
    });
    expect(API.sizing.compareVersions.response.parse(cmp.json()).changes).toEqual([
      { inputKey: 'horizonYears', label: 'Horizon (years)', from: '3', to: '4' },
    ]);
  });

  it('refuses edits by a reviewer without model rights (403), other tenants (404) and admins (404 on read)', async () => {
    const lena = await api(w, API.sizing.commit, await w.cookie('a', 'lena'), {
      params: { caseRef: caseKey },
    });
    expect(lena.statusCode).toBe(403);
    const other = await api(w, API.sizing.get, await w.cookie('b', 'maya'), { params: { caseRef: caseKey } });
    expect(other.statusCode).toBe(404);
    const admin = await api(w, API.sizing.get, await w.cookie('a', 'admin'), {
      params: { caseRef: caseKey },
    });
    expect(admin.statusCode).toBe(404);
  });
});

describe('sizing history (aster-demo)', () => {
  it('reads committed v2 and keeps the site list aggregate-only for Jonas', async () => {
    const v = SizingView.parse(
      (
        await api(w, API.sizing.get, await w.cookie('demo', 'maya'), { params: { caseRef: 'ME-104' } })
      ).json(),
    );
    expect(v.current!.version).toBe(2);
    expect(v.current!.result!.ladder.sam.value.amount).toBe('40000000.00');
    expect(v.siteListRestricted).toBe(false);
    const j = SizingView.parse(
      (
        await api(w, API.sizing.get, await w.cookie('demo', 'jonas'), { params: { caseRef: 'ME-104' } })
      ).json(),
    );
    expect(j.siteListRestricted).toBe(true);
    const cohort = j.current!.cohorts[0]!;
    const pop = await api(w, API.sizing.population, await w.cookie('demo', 'jonas'), {
      params: { caseRef: 'ME-104', cohortId: cohort.id },
    });
    expect(API.sizing.population.response.parse(pop.json())).toMatchObject({
      restricted: true,
      aggregateOnly: true,
      rows: [],
    });
    const priya = await api(w, API.sizing.population, await w.cookie('demo', 'priya'), {
      params: { caseRef: 'ME-104', cohortId: cohort.id },
    });
    expect(priya.statusCode).toBe(403);
    expect(priya.json().code).toBe('RESTRICTED_SOURCE');
    expect(priya.body).not.toMatch(/1[,.]?[14]00/);
  });

  it('committing v3 runs materiality: G2 snapshot v3 goes stale (model version changed)', async () => {
    const m = await w.cookie('demo', 'maya');
    const v = SizingView.parse((await api(w, API.sizing.get, m, { params: { caseRef: 'ME-104' } })).json());
    const d = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: 'ME-104' },
      ifMatch: v.current!.rowVersion,
      body: { horizonYears: 3 },
    });
    expect(d.statusCode).toBe(200);
    const c = await api(w, API.sizing.commit, m, { params: { caseRef: 'ME-104' } });
    expect(c.statusCode).toBe(201);
    expect(SizingVersion.parse(c.json()).version).toBe(3);
    const snaps = await inTenant(w, w.tenants.demo!, (tx) =>
      tx
        .selectFrom('platform.decision_snapshot')
        .select(['version', 'status', 'stale_reason'])
        .where('status', '=', 'stale')
        .execute(),
    );
    expect(snaps.map((s) => s.version)).toContain(3);
    expect(snaps[0]!.stale_reason).toContain('sizing v2');
    const mc = await inTenant(w, w.tenants.demo!, (tx) =>
      tx.selectFrom('platform.material_change').select(['change_type', 'classification']).execute(),
    );
    expect(mc).toEqual([{ change_type: 'model_version_changed', classification: 'material' }]);
  });
});

describe('S06 sizing draft editor fields (D-112 §2, D-132)', () => {
  let key: string;
  let asmE: Record<string, string>;
  const mayaE = () => w.cookie('e', 'maya');
  const get = async () =>
    SizingView.parse((await api(w, API.sizing.get, await mayaE(), { params: { caseRef: key } })).json());
  const linked = (k: string, unit: 'sites' | 'rate' | 'customers' | 'currency_per_year_per_site') => ({
    inputKey: k,
    value: '0',
    unit,
    sourceId: null,
    assumptionId: asmE[k]!,
  });
  const CHANNEL = 'Partner channel: distributors covering German food plants';

  beforeAll(async () => {
    key = await convertOpp07(w, 'e');
    asmE = await registerAssumptions(w, 'e', key);
  });

  it('the first save needs the boundary; every new field round-trips', async () => {
    const m = await mayaE();
    const noBoundary = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: key },
      ifMatch: 0,
      body: { horizonYears: 3 },
    });
    expect(noBoundary.statusCode).toBe(400);
    expect(noBoundary.json().code).toBe('VALIDATION_FAILED');

    const s = w.tenants.e!;
    const res = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: key },
      ifMatch: 0,
      body: {
        method: 'aggregate_overlap',
        horizonYears: 3,
        boundary: {
          marketUnit: 'annual spend on water monitoring',
          populationUnit: 'site',
          currency: 'EUR',
          priceYear: 2026,
          annualizationMethod: null,
          productBoundary: 'Water-quality monitoring sensors and software',
          includes: { hardware: true, software: true, services: true, replacementCycles: false },
        },
        dedupRuleText: 'Dedup run v2: same site ID',
        inputs: [
          {
            inputKey: 'tam_site_count',
            value: '5000',
            unit: 'sites',
            sourceId: sourceId(s, 'SRC-014'),
            assumptionId: null,
          },
          linked('annual_spend_per_site', 'currency_per_year_per_site'),
          { ...linked('reachable_pool', 'sites'), basisText: CHANNEL },
          linked('adoption_rate.downside', 'rate'),
          linked('adoption_rate.base', 'rate'),
          linked('adoption_rate.upside', 'rate'),
          linked('capacity', 'customers'),
        ],
        cohorts: [
          {
            id: null,
            name: 'Size-qualified',
            rule: '≥ size threshold',
            siteCount: 1400,
            sourceId: sourceId(s, 'SRC-014'),
          },
          {
            id: null,
            name: 'Process-qualified',
            rule: 'Uses the target water process',
            siteCount: 1100,
            sourceId: sourceId(s, 'SRC-021'),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const v = SizingView.parse(res.json());
    const [a, b] = v.draft!.cohorts;
    const ov = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: key },
      ifMatch: v.draft!.rowVersion,
      body: {
        overlaps: [{ cohortAId: a!.id, cohortBId: b!.id, overlapCount: 500, method: 'Dedup run v2' }],
      },
    });
    expect(ov.statusCode).toBe(200);
    const d = SizingView.parse(ov.json()).draft!;
    expect(d.boundary).toMatchObject({
      productBoundary: 'Water-quality monitoring sensors and software',
      includes: { hardware: true, software: true, services: true, replacementCycles: false },
      currency: 'EUR',
      priceYear: 2026,
    });
    expect(d.dedupRuleText).toBe('Dedup run v2: same site ID');
    expect(d.overlaps).toMatchObject([{ overlapCount: 500, method: 'Dedup run v2' }]);
    expect(d.ledger.find((l) => l.inputKey === 'reachable_pool')!.basis.text).toBe(CHANNEL);
    expect(d.result!.ladder.sam.value.amount).toBe('40000000.00');
    expect(d.result!.ladder.reachablePool.population).toBe(500);

    // A later boundary edit makes a new boundary row (boundaries are immutable) and keeps the rest.
    const again = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: key },
      ifMatch: d.rowVersion,
      body: { boundary: { includes: { replacementCycles: true } } },
    });
    const d2 = SizingView.parse(again.json()).draft!;
    expect(d2.boundary.id).not.toBe(d.boundary.id);
    expect(d2.boundary.includes).toEqual({
      hardware: true,
      software: true,
      services: true,
      replacementCycles: true,
    });
    expect(d2.boundary.productBoundary).toBe('Water-quality monitoring sensors and software');
    const back = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: key },
      ifMatch: d2.rowVersion,
      body: { boundary: { includes: { replacementCycles: false } } },
    });
    expect(back.statusCode).toBe(200);
  });

  it('a blank input is cleared to Unknown: no ladder value (never 0), MISSING_INPUT blocks commit', async () => {
    const m = await mayaE();
    const before = await get();
    const stale = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: key },
      ifMatch: before.draft!.rowVersion - 1,
      body: { clearInputKeys: ['capacity'] },
    });
    expect(stale.statusCode).toBe(412);
    const both = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: key },
      ifMatch: before.draft!.rowVersion,
      body: { clearInputKeys: ['capacity'], inputs: [linked('capacity', 'customers')] },
    });
    expect(both.statusCode).toBe(400);
    const unknown = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: key },
      ifMatch: before.draft!.rowVersion,
      body: { clearInputKeys: ['mystery'] },
    });
    expect(unknown.statusCode).toBe(400);

    const res = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: key },
      ifMatch: before.draft!.rowVersion,
      body: { clearInputKeys: ['capacity'] },
    });
    expect(res.statusCode).toBe(200);
    const d = SizingView.parse(res.json()).draft!;
    expect(d.ledger.map((l) => l.inputKey)).not.toContain('capacity');
    expect(d.result).toBeNull(); // nothing to show, never a ladder of zeros
    expect(JSON.stringify(d)).not.toMatch(/"amount":"0(\.00)?"/);

    const calc = await api(w, API.sizing.calculateDraft, m, { params: { caseRef: key } });
    expect(calc.statusCode).toBe(422);
    expect(calc.json()).toMatchObject({ code: 'CALCULATION_BLOCKED' });
    expect(calc.json().checks.map((c: { key: string }) => c.key)).toEqual(['MISSING_INPUT']);
    const commit = await api(w, API.sizing.commit, m, { params: { caseRef: key } });
    expect(commit.statusCode).toBe(422);
    expect(commit.json().checks[0].key).toBe('MISSING_INPUT');
    expect(commit.json().title).toContain('Installation and support capacity');

    const audit = await auditFor(w, w.tenants.e!, d.id);
    expect(audit.map((x) => x.action)).toContain('sizing.draft_saved');

    const refill = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: key },
      ifMatch: d.rowVersion,
      body: { inputs: [linked('capacity', 'customers')] },
    });
    expect(SizingView.parse(refill.json()).draft!.result!.blocked).toBe(false);
  });

  it('commit keeps the basis text, product boundary and dedup rule in the immutable version', async () => {
    const m = await mayaE();
    const before = (await analyticsFor(w, w.tenants.e!, 'sizing_snapshot_created')).length;
    const res = await api(w, API.sizing.commit, m, {
      params: { caseRef: key },
      idempotencyKey: 'e1-commit',
    });
    expect(res.statusCode).toBe(201);
    const v = SizingVersion.parse(res.json());
    const replay = await api(w, API.sizing.commit, m, {
      params: { caseRef: key },
      idempotencyKey: 'e1-commit',
    });
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(v.result!.ladder.sam.value.amount).toBe('40000000.00');
    expect(v.result!.ladder.reachablePool.population).toBe(500);
    expect(v.ledger.find((l) => l.inputKey === 'reachable_pool')!.basis.text).toBe(CHANNEL);
    expect(v.boundary.productBoundary).toBe('Water-quality monitoring sensors and software');
    expect(v.dedupRuleText).toBe('Dedup run v2: same site ID');
    const events = await analyticsFor(w, w.tenants.e!, 'sizing_snapshot_created');
    expect(events).toHaveLength(before + 1);
    expect((await auditFor(w, w.tenants.e!, v.id)).map((x) => x.action)).toContain(
      'sizing.version_committed',
    );
    // A new draft copies the basis text forward; clearing it there leaves the committed version alone.
    const d = await api(w, API.sizing.saveDraft, m, {
      params: { caseRef: key },
      ifMatch: v.rowVersion,
      body: { inputs: [{ ...linked('reachable_pool', 'sites'), basisText: null }] },
    });
    const view = SizingView.parse(d.json());
    expect(view.draft!.ledger.find((l) => l.inputKey === 'reachable_pool')!.basis.text).toBe(
      'Partner coverage list',
    );
    expect(view.current!.ledger.find((l) => l.inputKey === 'reachable_pool')!.basis.text).toBe(CHANNEL);
  });

  it('refuses other tenants (404), a reviewer without model rights (403) and the agent', async () => {
    const body = { clearInputKeys: ['capacity'] };
    const other = await api(w, API.sizing.saveDraft, await w.cookie('b', 'maya'), {
      params: { caseRef: key },
      ifMatch: 0,
      body,
    });
    expect(other.statusCode).toBe(404);
    const cur = await get();
    const lena = await api(w, API.sizing.saveDraft, await w.cookie('e', 'lena'), {
      params: { caseRef: key },
      ifMatch: cur.draft!.rowVersion,
      body,
    });
    expect(lena.statusCode).toBe(403);
    const agent = await agentCookie(w.t, w.tenants.e!);
    const agentCommit = await api(w, API.sizing.commit, agent, { params: { caseRef: key } });
    expect(agentCommit.statusCode).toBe(403);
    expect(agentCommit.json()).toMatchObject({ code: 'AGENT_IDENTITY_FORBIDDEN' });
    const agentSave = await api(w, API.sizing.saveDraft, agent, {
      params: { caseRef: key },
      ifMatch: cur.draft!.rowVersion,
      body,
    });
    expect(agentSave.statusCode).toBe(404); // the agent never sees a case to edit
    expect(agentSave.json()).toMatchObject({ code: 'NOT_FOUND' });
    // Nothing changed.
    expect((await get()).draft!.ledger.map((l) => l.inputKey)).toContain('capacity');
  });
});
