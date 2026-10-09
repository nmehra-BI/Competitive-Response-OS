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
  world,
  type World,
} from '../cases/test-support';

let w: World;
let caseKey: string;
let asm: Record<string, string>;
beforeAll(async () => {
  w = await world({ a: 'aster-start', demo: 'aster-demo', b: 'aster-start' });
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
