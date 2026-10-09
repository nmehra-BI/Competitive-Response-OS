/**
 * Economics (S08, ME-07): acceptance steps 9 and 16. Per-year scenarios and the one-time investment are
 * never summed; cash flow and payback stay Unavailable; Daniel's finance review lists checked and not
 * checked items.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, EconomicsVersion, EconomicsView, ModelReview } from '@growth-os/contracts';
import {
  analyticsFor,
  api,
  auditFor,
  convertOpp07,
  enterSizing,
  registerAssumptions,
  world,
  type World,
} from '../cases/test-support';

let w: World;
let caseKey: string;
beforeAll(async () => {
  w = await world({ a: 'aster-start', demo: 'aster-demo', b: 'aster-start' });
  caseKey = await convertOpp07(w, 'a');
  const asm = await registerAssumptions(w, 'a', caseKey);
  await enterSizing(w, 'a', caseKey, asm);
  const c = await api(w, API.sizing.commit, await w.cookie('a', 'maya'), { params: { caseRef: caseKey } });
  if (c.statusCode !== 201) throw new Error(c.body);
});
afterAll(() => w.close());

describe('economics', () => {
  let committed: EconomicsVersion;

  it('step 9: scenario table €1.0m / €2.0m / €2.4m, €0k break-even downside, €400k one-time apart, cash flow and payback Unavailable', async () => {
    const m = await w.cookie('a', 'maya');
    const draft = await api(w, API.economics.saveDraft, m, { params: { caseRef: caseKey }, ifMatch: 0, body: { drivers: [] } });
    expect(draft.statusCode).toBe(200);
    const view = EconomicsView.parse(draft.json());
    const r = view.draft!.result!;
    const by = (s: string) => r.scenarios.find((x) => x.scenario === s)!;
    expect(r.scenarios.map((s) => s.scenario)).toEqual(['downside', 'base', 'upside']);
    expect(by('downside')).toMatchObject({ customers: 50, annualRevenue: { amount: '1000000.00' }, contributionAfterOpex: { amount: '0.00' } });
    expect(by('base')).toMatchObject({ customers: 100, annualRevenue: { amount: '2000000.00' }, contributionAfterOpex: { amount: '600000.00' } });
    expect(by('upside')).toMatchObject({ customers: 120, capped: true, annualRevenue: { amount: '2400000.00' } });
    for (const s of r.scenarios) expect(s.annualRevenue.timeBasis).toBe('per_year');
    expect(r.oneTimeInvestment).toMatchObject({ amount: '400000.00', timeBasis: 'one_time', measure: 'one_time_investment' });
    expect('unavailable' in r.cashFlow && r.cashFlow.unavailable).toBe(true);
    expect('unavailable' in r.payback && r.payback.unavailable).toBe(true);
    // No per-year figure carries the one-time amount (never summed).
    expect(JSON.stringify(r.scenarios)).not.toContain('"400000.00"');
    expect(r.breakEven.customers).toBe(50);

    const wmbt = await api(w, API.economics.whatMustBeTrue, m, {
      params: { caseRef: caseKey },
      query: { targetContributionAfterOpex: '600000', version: 'draft' },
    });
    expect(API.economics.whatMustBeTrue.response.parse(wmbt.json()).customers).toBe(100);

    const c = await api(w, API.economics.commit, m, { params: { caseRef: caseKey } });
    expect(c.statusCode).toBe(201);
    committed = EconomicsVersion.parse(c.json());
    expect(committed).toMatchObject({ state: 'committed', version: 1 });
    expect(committed.drivers.find((d) => d.inputKey === 'one_time_investment')!.unit).toBe('currency_one_time');
    expect((await auditFor(w, w.tenants.a!, committed.id)).map((e) => e.action)).toContain('economics.version_committed');
  });

  it('a draft override unlinks the driver from the register; the committed version never recalculates', async () => {
    const m = await w.cookie('a', 'maya');
    const res = await api(w, API.economics.saveDraft, m, {
      params: { caseRef: caseKey },
      ifMatch: committed.rowVersion,
      body: { drivers: [{ inputKey: 'gross_margin', value: '0.50' }] },
    });
    const view = EconomicsView.parse(res.json());
    const gm = view.draft!.drivers.find((d) => d.inputKey === 'gross_margin')!;
    expect(gm).toMatchObject({ value: '0.5', assumptionId: null, changedInDraft: true });
    expect(view.current!.result!.inputHash).toBe(committed.result!.inputHash);
    const bad = await api(w, API.economics.saveDraft, m, {
      params: { caseRef: caseKey },
      ifMatch: view.draft!.rowVersion,
      body: { drivers: [{ inputKey: 'mystery', value: '1' }] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('step 16: Daniel signs the finance review with checked and not-checked lists; others cannot', async () => {
    const m = await w.cookie('a', 'maya');
    const req = await api(w, API.economics.requestFinanceReview, m, {
      params: { caseRef: caseKey },
      body: { economicsVersion: 1, reviewerId: w.tenants.a!.user('daniel'), dueOn: '2026-10-22' },
    });
    expect(req.statusCode).toBe(201);
    const review = ModelReview.parse(req.json());
    expect(review.position).toBe('not_yet_reviewed');
    const body = {
      position: 'supports_with_conditions' as const,
      checkedItems: ['Margin definition', 'Opex scope', 'Currency EUR 2026'],
      notCheckedItems: ['Ramp, retention, cash timing (not in model)'],
      statement: 'Supports with conditions.',
    };
    const priya = await api(w, API.economics.signFinanceReview, await w.cookie('a', 'priya'), { params: { id: review.id }, body });
    expect(priya.statusCode).toBe(403);
    const maya = await api(w, API.economics.signFinanceReview, m, { params: { id: review.id }, body });
    expect(maya.statusCode).toBe(403);
    const other = await api(w, API.economics.signFinanceReview, await w.cookie('b', 'daniel'), { params: { id: review.id }, body });
    expect(other.statusCode).toBe(404);
    const signed = await api(w, API.economics.signFinanceReview, await w.cookie('a', 'daniel'), { params: { id: review.id }, body });
    expect(signed.statusCode).toBe(200);
    expect(ModelReview.parse(signed.json())).toMatchObject({
      position: 'supports_with_conditions',
      checkedItems: body.checkedItems,
      notCheckedItems: body.notCheckedItems,
    });
    const view = EconomicsView.parse((await api(w, API.economics.get, m, { params: { caseRef: caseKey } })).json());
    expect(view.financeReview!.signedAt).not.toBeNull();
    const events = await analyticsFor(w, w.tenants.a!, 'feasibility_review_recorded');
    expect(events.map((e) => e.props)).toContainEqual({ area: 'finance', scoped: true });
    const audit = await auditFor(w, w.tenants.a!, review.id);
    expect(audit.map((e) => e.action)).toEqual(['model_review.requested', 'model_review.signed']);
    expect(JSON.stringify(audit)).not.toContain('Supports with conditions.');
  });

  it('exports CSV with per-year and one-time money in separate sections; reads are tenant-scoped', async () => {
    const res = await api(w, API.economics.export, await w.cookie('demo', 'daniel'), { params: { caseRef: 'ME-104' }, query: { format: 'csv' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('One-time money (never added to per-year figures)');
    expect(res.body).toContain('Cash flow,Not available');
    expect((await api(w, API.economics.export, await w.cookie('demo', 'daniel'), { params: { caseRef: 'ME-104' }, query: { format: 'xlsx' } })).statusCode).toBe(400);
    expect((await api(w, API.economics.get, await w.cookie('b', 'maya'), { params: { caseRef: caseKey } })).statusCode).toBe(404);
    expect((await api(w, API.economics.commit, await w.cookie('a', 'lena'), { params: { caseRef: caseKey } })).statusCode).toBe(403);
  });

  it('reads demo economics v2 with the signed finance review and no incomplete recommendation', async () => {
    const v = EconomicsView.parse((await api(w, API.economics.get, await w.cookie('demo', 'elena'), { params: { caseRef: 'ME-104' } })).json());
    expect(v.current!.version).toBe(2);
    expect(v.financeReview!.notCheckedItems).toEqual(['Ramp, retention, cash timing (not in model)']);
    expect(v.recommendationIncomplete).toBe(false);
  });
});
