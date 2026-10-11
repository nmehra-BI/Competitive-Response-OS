/**
 * D-180: the links the API returns land on a real screen. The case header "Open decision package",
 * S01 "Awaiting decision" and "Overdue validation", the Reviews inbox and "Review preconditions" on a
 * new case used to point at `/decision`, `/gates` and `/assumptions`, which the web router answers with
 * "This page could not be found." Hidden and cross-tenant resources still return 404, and the decision
 * the link leads to still refuses the case owner (403).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, CaseHeader, PortfolioOverview, WorkflowCase } from '@growth-os/contracts';
import { businessUnits } from '@growth-os/fixtures-aster';
import { api, convertOpp07, world, type World } from './test-support';

let w: World;
beforeAll(async () => {
  w = await world({ demo: 'aster-demo', start: 'aster-start' });
});
afterAll(() => w.close());

const header = async (tenant: string, who: 'elena' | 'maya' | 'admin', caseRef: string) =>
  api(w, API.cases.header, await w.cookie(tenant, who), { params: { caseRef } });

describe('case links (D-180)', () => {
  it('case header: "Open decision package" opens S10 for the awaiting gate', async () => {
    for (const who of ['elena', 'maya'] as const) {
      const res = await header('demo', who, 'ME-104');
      expect(res.statusCode).toBe(200);
      expect(CaseHeader.parse(res.json()).nextDecision.primaryAction).toEqual({
        label: 'Open decision package',
        href: '/me/cases/ME-104/decisions?gate=G2',
      });
    }
  });

  it('a new case: "Review preconditions" opens the screen that prepares G1 (Validation)', async () => {
    const key = await convertOpp07(w, 'start');
    const h = CaseHeader.parse((await header('start', 'maya', key)).json());
    expect(h.nextDecision.gateCode).toBe('G1');
    expect(h.nextDecision.primaryAction).toEqual({
      label: 'Review preconditions',
      href: `/me/cases/${key}/validation`,
    });
    // No outcome review exists yet: the endpoint keeps its frozen 404 and the screen shows
    // "No outcome review yet" because the header (same visibility rule) loaded.
    const o = await api(w, API.outcomes.get, await w.cookie('start', 'maya'), { params: { caseRef: key } });
    expect(o.statusCode).toBe(404);
    expect(o.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a direct case starts at G0: "Review preconditions" opens its mandate (S02)', async () => {
    const res = await api(w, API.cases.createDirect, await w.cookie('start', 'maya'), {
      body: {
        businessUnitId: w.tenants.start!.id(businessUnits[0].id),
        title: 'Danish dairies — monitoring',
        mandate: { geographyCodes: ['DK'] },
      },
    });
    expect(res.statusCode).toBe(201);
    const c = WorkflowCase.parse(res.json());
    const h = CaseHeader.parse((await header('start', 'maya', c.key)).json());
    expect(h.nextDecision.gateCode).toBe('G0');
    const md = API.mandates.get.response.parse(
      (
        await api(w, API.mandates.get, await w.cookie('start', 'maya'), { params: { ref: c.mandateId } })
      ).json(),
    );
    expect(h.nextDecision.primaryAction).toEqual({
      label: 'Review preconditions',
      href: `/me/mandates/${md.key}`,
    });
  });

  it('S01 and the Reviews inbox link to /decisions?gate= and the S09 register', async () => {
    const o = PortfolioOverview.parse(
      (await api(w, API.overview.portfolio, await w.cookie('demo', 'elena'), {})).json(),
    );
    expect(o.decisionsAwaitingViewer.map((d) => d.href)).toEqual(['/me/cases/ME-104/decisions?gate=G2']);
    for (const d of o.overdueValidation)
      expect(d.href).toMatch(/^\/me\/cases\/ME-\d+\/validation\?assumption=ASM-\d+$/);
    for (const p of o.pilotsNeedingReview) expect(p.href).toMatch(/^\/me\/cases\/ME-\d+\/outcomes$/);
    const inbox = API.work.reviewsInbox.response.parse(
      (await api(w, API.work.reviewsInbox, await w.cookie('demo', 'elena'), {})).json(),
    );
    expect(inbox.gateDecisions.map((g) => g.href)).toEqual(['/me/cases/ME-104/decisions?gate=G2']);
  });

  it('hidden and cross-tenant cases still 404; the owner still cannot decide her own gate (403)', async () => {
    // An administrator without a case role and another tenant's sponsor see no ME-104.
    expect((await header('demo', 'admin', 'ME-104')).statusCode).toBe(404);
    const demoCaseId = CaseHeader.parse((await header('demo', 'elena', 'ME-104')).json()).case.id;
    expect((await header('start', 'elena', demoCaseId)).statusCode).toBe(404);
    for (const [tenant, who] of [
      ['demo', 'admin'],
      ['start', 'elena'],
    ] as const) {
      const r = await api(w, API.outcomes.get, await w.cookie(tenant, who), {
        params: { caseRef: tenant === 'demo' ? 'ME-104' : demoCaseId },
      });
      expect(r.statusCode).toBe(404);
    }
    // The decision the link opens: the case owner is refused (no self-approval).
    const h = CaseHeader.parse((await header('demo', 'elena', 'ME-104')).json());
    const g2 = h.rail.find((n) => n.gateCode === 'G2')!.gateRequestId!;
    const pkg = API.gates.package.response.parse(
      (await api(w, API.gates.package, await w.cookie('demo', 'elena'), { params: { id: g2 } })).json(),
    );
    const res = await api(w, API.gates.decide, await w.cookie('demo', 'maya'), {
      params: { id: g2 },
      body: {
        snapshotId: pkg.snapshot.id,
        snapshotHash: pkg.snapshot.contentHash,
        disposition: 'approve',
        rationale: 'Self-approval attempt.',
        note: null,
        conditions: [],
        delegateToUserId: null,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'SELF_APPROVAL_PROHIBITED' });
  });
});
