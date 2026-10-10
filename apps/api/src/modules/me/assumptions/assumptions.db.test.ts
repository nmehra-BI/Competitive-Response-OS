/**
 * Assumption register and disputes (S09): acceptance step 9 (dispute + Downside, assumption_changed) on
 * aster-start and step 19 (a new Base adoption version makes G2 v3 stale) on aster-demo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, Assumption, Challenge } from '@growth-os/contracts';
import {
  analyticsFor,
  api,
  auditFor,
  convertOpp07,
  inTenant,
  sourceId,
  world,
  type World,
} from '../cases/test-support';

let w: World;
let caseKey: string;
beforeAll(async () => {
  w = await world({ a: 'aster-start', demo: 'aster-demo', b: 'aster-start' });
  caseKey = await convertOpp07(w, 'a');
});
afterAll(() => w.close());

const body = (over: Record<string, unknown>) => ({
  inputKey: 'adoption_rate.base',
  name: 'Adoption 20% by year 3',
  ownerId: w.tenants.a!.user('maya'),
  value: '0.20',
  valueText: null,
  unit: 'rate',
  basis: 'Paid commitments, then pilot',
  sensitivity: 'high',
  decisionCritical: true,
  consequenceIfFalse: 'SOM and economics fall to Downside or below',
  validationMethod: 'Paid commitments, then pilot',
  dueOn: '2026-11-20',
  ...over,
});

describe('assumptions (aster-start)', () => {
  let base: Assumption;
  let dispute: Challenge;

  it('creates a register row with version 1 and assumption_changed', async () => {
    const res = await api(w, API.assumptions.create, await w.cookie('a', 'maya'), {
      params: { caseRef: caseKey },
      body: body({}),
    });
    expect(res.statusCode).toBe(201);
    base = Assumption.parse(res.json());
    expect(base).toMatchObject({
      key: 'ASM-01',
      scenario: 'base',
      registerGroup: 'test_first',
      current: { version: 1, value: '0.2' },
    });
    expect((await analyticsFor(w, w.tenants.a!, 'assumption_changed')).map((e) => e.props)).toEqual([
      { decisionCritical: true, origin: 'human' },
    ]);
    const dup = await api(w, API.assumptions.create, await w.cookie('a', 'maya'), {
      params: { caseRef: caseKey },
      body: body({}),
    });
    expect(dup.statusCode).toBe(409);
    expect(
      (
        await api(w, API.assumptions.create, await w.cookie('a', 'lena'), {
          params: { caseRef: caseKey },
          body: body({ inputKey: 'x' }),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await api(w, API.assumptions.create, await w.cookie('b', 'maya'), {
          params: { caseRef: base.caseId },
          body: body({ inputKey: 'x' }),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await api(w, API.assumptions.create, await w.cookie('a', 'maya'), {
          params: { caseRef: caseKey },
          body: body({ inputKey: 'y', value: '1.5' }),
        })
      ).statusCode,
    ).toBe(400);
  });

  it('step 9: Daniel disputes 20% with 10%; Maya adds Downside 10% (assumption_changed); the dispute stays open', async () => {
    const d = await api(w, API.assumptions.dispute, await w.cookie('a', 'daniel'), {
      params: { id: base.id },
      body: {
        statement: 'I do not see comparable evidence for 20% adoption.',
        proposedValueText: 'Downside adoption 10%',
      },
    });
    expect(d.statusCode).toBe(201);
    dispute = Challenge.parse(d.json());
    expect(dispute).toMatchObject({
      kind: 'dispute',
      status: 'open',
      proposedValue: 'Downside adoption 10%',
    });
    const down = await api(w, API.assumptions.create, await w.cookie('a', 'maya'), {
      params: { caseRef: caseKey },
      body: body({
        inputKey: 'adoption_rate.downside',
        name: 'Adoption 10% by year 3 · Downside',
        value: '0.10',
        ownerId: w.tenants.a!.user('daniel'),
      }),
    });
    expect(Assumption.parse(down.json())).toMatchObject({ scenario: 'downside', current: { value: '0.1' } });
    // The base assumption, Daniel's dispute (D-096) and the Downside assumption each emit one.
    expect(await analyticsFor(w, w.tenants.a!, 'assumption_changed')).toHaveLength(3);
    const list = API.assumptions.list.response.parse(
      (
        await api(w, API.assumptions.list, await w.cookie('a', 'priya'), { params: { caseRef: caseKey } })
      ).json(),
    );
    expect(list.items.find((a) => a.key === 'ASM-01')!.openDispute!.id).toBe(dispute.id);
    const reply = await api(w, API.assumptions.replyToChallenge, await w.cookie('a', 'maya'), {
      params: { id: dispute.id },
      body: { body: 'Keeping 20% as Base and adding your 10% as Downside.' },
    });
    expect(Challenge.parse(reply.json()).replies).toHaveLength(1);
    expect((await auditFor(w, w.tenants.a!, base.id)).map((e) => e.action)).toContain('assumption.disputed');
    // Disputes resolve only by the disputing reviewer or the sponsor.
    expect(
      (
        await api(w, API.assumptions.resolveChallenge, await w.cookie('a', 'maya'), {
          params: { id: dispute.id },
          body: { resolution: 'x' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await api(w, API.assumptions.dispute, await w.cookie('a', 'lena'), {
          params: { id: base.id },
          body: { statement: 'x', proposedValueText: null },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('updates the value as a new version with If-Match; metadata alone keeps the version', async () => {
    const m = await w.cookie('a', 'maya');
    const stale = await api(w, API.assumptions.update, m, {
      params: { id: base.id },
      ifMatch: base.rowVersion + 5,
      body: { value: '0.25', changeReason: 'x' },
    });
    expect(stale.statusCode).toBe(412);
    const res = await api(w, API.assumptions.update, m, {
      params: { id: base.id },
      ifMatch: base.rowVersion,
      body: { value: '0.22', changeReason: 'Two more paid commitments' },
    });
    expect(res.statusCode).toBe(200);
    const out = API.assumptions.update.response.parse(res.json());
    expect(out.assumption.current).toMatchObject({
      version: 2,
      value: '0.22',
      changeReason: 'Two more paid commitments',
    });
    expect(out.staleSnapshotIds).toEqual([]); // nothing pins ME-104 on aster-start yet
    const meta = await api(w, API.assumptions.update, m, {
      params: { id: base.id },
      ifMatch: out.assumption.rowVersion,
      body: { sensitivity: 'medium', changeReason: 'Re-rated' },
    });
    expect(API.assumptions.update.response.parse(meta.json()).assumption).toMatchObject({
      sensitivity: 'medium',
      current: { version: 2 },
    });
    const versions = API.assumptions.versions.response.parse(
      (await api(w, API.assumptions.versions, m, { params: { id: base.id } })).json(),
    );
    expect(versions.items.map((v) => v.value)).toEqual(['0.2', '0.22']);
    expect(
      (
        await api(w, API.assumptions.update, await w.cookie('a', 'priya'), {
          params: { id: base.id },
          ifMatch: 0,
          body: { value: '0.3', changeReason: 'x' },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('the sponsor resolves the dispute; retired assumptions keep their reason', async () => {
    const r = await api(w, API.assumptions.resolveChallenge, await w.cookie('a', 'elena'), {
      params: { id: dispute.id },
      body: { resolution: 'Downside added' },
    });
    expect(Challenge.parse(r.json())).toMatchObject({ status: 'resolved', resolution: 'Downside added' });
    const list = API.assumptions.list.response.parse(
      (
        await api(w, API.assumptions.list, await w.cookie('a', 'maya'), { params: { caseRef: caseKey } })
      ).json(),
    );
    const down = list.items.find((a) => a.scenario === 'downside')!;
    const ret = await api(w, API.assumptions.retire, await w.cookie('a', 'maya'), {
      params: { id: down.id },
      body: { rationale: 'Merged into Base range' },
    });
    expect(Assumption.parse(ret.json())).toMatchObject({
      status: 'retired',
      retiredReason: 'Merged into Base range',
      registerGroup: 'monitor',
    });
  });
});

describe('step 19 (aster-demo)', () => {
  it('a new Base adoption version makes G2 v3 stale with "adoption assumption changed on …"', async () => {
    const m = await w.cookie('demo', 'maya');
    const list = API.assumptions.list.response.parse(
      (await api(w, API.assumptions.list, m, { params: { caseRef: 'ME-104' } })).json(),
    );
    const asm = list.items.find((a) => a.key === 'ASM-01')!;
    const res = await api(w, API.assumptions.update, m, {
      params: { id: asm.id },
      ifMatch: asm.rowVersion,
      body: { value: '0.18', changeReason: 'Pilot interviews suggest lower uptake' },
    });
    expect(res.statusCode).toBe(200);
    const out = API.assumptions.update.response.parse(res.json());
    expect(out.assumption.current.version).toBe(3);
    const s = w.tenants.demo!;
    const g2 = await inTenant(w, s, (tx) =>
      tx
        .selectFrom('platform.gate_request as g')
        .innerJoin('platform.decision_snapshot as d', 'd.id', 'g.current_snapshot_id')
        .select(['g.status', 'd.id', 'd.version', 'd.status as snapshot_status', 'd.stale_reason'])
        .where('g.display_key', '=', 'ME-104-G2')
        .executeTakeFirstOrThrow(),
    );
    expect(g2).toMatchObject({ status: 'stale', version: 3, snapshot_status: 'stale' });
    expect(g2.stale_reason).toMatch(/^adoption assumption changed on \d{1,2} [A-Z][a-z]{2}$/);
    expect(out.staleSnapshotIds).toContain(g2.id);
    const mc = await inTenant(w, s, (tx) => tx.selectFrom('platform.material_change').selectAll().execute());
    expect(mc).toHaveLength(1);
    expect(mc[0]).toMatchObject({
      change_type: 'decision_critical_assumption_changed',
      classification: 'material',
      from_version: 2,
      to_version: 3,
    });
    expect((await auditFor(w, s, mc[0]!.id)).map((e) => e.action)).toEqual(['material_change.detected']);
    // G1's effective approval also pinned the old version: it no longer applies (executed tasks kept).
    expect(out.invalidatedApprovalIds).toHaveLength(1);
    expect(await analyticsFor(w, s, 'approval_invalidated')).toHaveLength(1);
  });
});

// Wave 4 (D-112 §1, D-132): S09 "Add assumption" — confidence basis from linked sources.
describe('S09 add assumption: Evidence or "Assumption — no evidence"', () => {
  const s = () => w.tenants.a!;

  it('with a licensed source the version is Evidence (quality from the source) and lists the chip', async () => {
    const before = (await analyticsFor(w, s(), 'assumption_changed')).length;
    const res = await api(w, API.assumptions.create, await w.cookie('a', 'maya'), {
      params: { caseRef: caseKey },
      body: body({
        inputKey: 'reachable_pool',
        name: 'Reachable pool 500 sites',
        value: '500',
        unit: 'sites',
        sensitivity: 'medium',
        decisionCritical: false,
        sourceIds: [sourceId(s(), 'SRC-014'), sourceId(s(), 'SRC-021')],
      }),
    });
    expect(res.statusCode).toBe(201);
    const a = Assumption.parse(res.json());
    expect(a.current.evidenceQuality).toBe('strong'); // the strongest linked source (licensed)
    expect(a.current.sources.map((x) => [x.key, x.restricted])).toEqual([
      ['SRC-014', false],
      ['SRC-021', false],
    ]);
    expect((await auditFor(w, s(), a.id)).map((e) => e.action)).toEqual(['assumption.created']);
    expect(await analyticsFor(w, s(), 'assumption_changed')).toHaveLength(before + 1);
    // The register shows the same basis; the link is not a thesis claim of the case.
    const list = await api(w, API.assumptions.list, await w.cookie('a', 'daniel'), {
      params: { caseRef: caseKey },
    });
    const row = API.assumptions.list.response.parse(list.json()).items.find((x) => x.id === a.id)!;
    expect(row.current.sources.map((x) => x.key)).toEqual(['SRC-014', 'SRC-021']);
    const thesis = await api(w, API.thesis.get, await w.cookie('a', 'maya'), {
      params: { caseRef: caseKey },
    });
    expect(thesis.body).not.toContain('Reachable pool 500 sites');
  });

  it('without sources it is "Assumption — no evidence" (quality none); money units carry the editor currency and price year', async () => {
    const res = await api(w, API.assumptions.create, await w.cookie('a', 'maya'), {
      params: { caseRef: caseKey },
      body: body({
        inputKey: 'annual_spend_per_site',
        name: 'Annual spend per site €80k',
        value: '80000',
        unit: 'currency_per_year_per_site',
        sensitivity: 'high',
        sourceIds: [],
        currency: 'EUR',
        priceYear: 2026,
      }),
    });
    expect(res.statusCode).toBe(201);
    const a = Assumption.parse(res.json());
    expect(a.current).toMatchObject({
      evidenceQuality: 'none',
      sources: [],
      currency: 'EUR',
      priceYear: 2026,
      value: '80000.00',
    });
    expect(a.registerGroup).toBe('test_first');
  });

  it('refuses a restricted, unknown or foreign source (400, same message); read-only reviewer 403; cross-tenant 404', async () => {
    const refuse = async (sourceIds: string[]) => {
      const r = await api(w, API.assumptions.create, await w.cookie('a', 'maya'), {
        params: { caseRef: caseKey },
        body: body({ inputKey: `k-${sourceIds.join()}`, sourceIds }),
      });
      expect(r.statusCode).toBe(400);
      return (r.json() as { title: string }).title;
    };
    const titles = [
      await refuse([sourceId(s(), 'SRC-030')]), // restricted licence
      await refuse(['00000000-0000-4000-8000-000000000999']),
      await refuse([sourceId(w.tenants.b!, 'SRC-014')]), // another tenant's source (RLS)
    ];
    expect(new Set(titles)).toEqual(new Set(['Link a source you can open.']));
    const ro = await api(w, API.assumptions.create, await w.cookie('a', 'opsLead'), {
      params: { caseRef: caseKey },
      body: body({ inputKey: 'ro' }),
    });
    expect(ro.statusCode).toBe(403);
    const caseId = await inTenant(
      w,
      s(),
      async (tx) =>
        (
          await tx
            .selectFrom('platform.workflow_case')
            .select('id')
            .where('display_key', '=', caseKey)
            .executeTakeFirstOrThrow()
        ).id,
    );
    const cross = await api(w, API.assumptions.create, await w.cookie('b', 'maya'), {
      params: { caseRef: caseId },
      body: body({ inputKey: 'cross', sourceIds: [sourceId(s(), 'SRC-014')] }),
    });
    expect(cross.statusCode).toBe(404);
  });
});
