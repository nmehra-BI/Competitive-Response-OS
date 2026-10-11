/**
 * Portfolio overview (S01): accessible cases only, decisions the viewer can actually take, budgets per
 * gate (never summed with annual figures), spent-to-date honest, no market totals.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, PortfolioOverview } from '@growth-os/contracts';
import { businessUnits } from '@growth-os/fixtures-aster';
import { api, world, type World } from '../cases/test-support';

let w: World;
beforeAll(async () => {
  w = await world({ demo: 'aster-demo', b: 'aster-start' });
});
afterAll(() => w.close());

const get = async (who: 'elena' | 'maya' | 'admin', query: Record<string, string> = {}, tenant = 'demo') =>
  PortfolioOverview.parse(
    (await api(w, API.overview.portfolio, await w.cookie(tenant, who), { query })).json(),
  );

describe('overview', () => {
  it('shows Elena the G2 decision she can take, with the scoped label and snapshot version', async () => {
    const o = await get('elena');
    expect(o.decisionsAwaitingViewer).toEqual([
      expect.objectContaining({
        caseKey: 'ME-104',
        buttonLabel: 'Approve pilot €120k · 90 days',
        snapshotVersion: 3,
      }),
    ]);
    expect(o.casesByStage).toEqual(expect.arrayContaining([{ stage: 'pilot_approval_pending', count: 1 }]));
    expect(o.cases.map((c) => c.key)).toEqual(['ME-097', 'ME-102', 'ME-104', 'ME-105']);
  });

  it('never offers the owner a decision on her own case; budgets stay per gate; nothing is totalled', async () => {
    const o = await get('maya');
    expect(o.decisionsAwaitingViewer).toEqual([]);
    expect(
      o.spend.rows.map((r) => [r.gateLabel, r.amount.amount, r.amount.measure, r.amount.timeBasis]),
    ).toEqual([
      ['G1 · Validation', '15000.00', 'approved_budget', 'budget'],
      ['G2 · Pilot · 90 days', '120000.00', 'requested_budget', 'budget'],
    ]);
    expect(o.spend.spentToDate).toMatchObject({ unavailable: true });
    expect(o.casesNote).toContain('not totalled');
    expect(JSON.stringify(o)).not.toMatch(/total opportunity|totalTam|"tam"/i);
    expect(o.dataSources.find((d) => d.name === 'Trade registry')!.available).toBe(false);
    expect(o.scope.partial).toBe(true);
    expect(o.businessUnits.find((b) => b.name === 'BU Air')!.accessible).toBe(false);
  });

  it('counts no hidden cases: an admin without a case role and another tenant see nothing of ME-104', async () => {
    const admin = await get('admin');
    expect(admin.cases).toEqual([]);
    expect(admin.casesByStage).toEqual([]);
    expect(admin.decisionsAwaitingViewer).toEqual([]);
    const air = await get('elena', { businessUnitId: w.tenants.demo!.id(businessUnits[1].id) });
    expect(air.cases).toEqual([]);
    const other = await get('maya', {}, 'b');
    expect(other.cases.map((c) => c.key)).not.toContain('ME-104');
  });
});
