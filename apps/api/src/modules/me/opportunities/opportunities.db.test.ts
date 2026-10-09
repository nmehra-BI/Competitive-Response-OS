/**
 * Opportunities (S03, WF-02) on aster-start: acceptance steps 2, 3 and 5, triage commands through the
 * opportunity machine, cross-tenant and unauthorized attempts, audit and analytics.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, CaseHeader, Opportunity, WorkflowCase } from '@growth-os/contracts';
import { businessUnits, mandate } from '@growth-os/fixtures-aster';
import { analyticsFor, api, auditFor, inTenant, oppId, world, type World } from '../cases/test-support';

let w: World;
beforeAll(async () => {
  w = await world({ a: 'aster-start', b: 'aster-start' });
});
afterAll(() => w.close());

const A = () => w.tenants.a!;
const mandateId = () => A().id(mandate.id);
const ListResponse = API.opportunities.list.response;

describe('opportunities', () => {
  it('step 2: lists MD-21 candidates with AI origin, the likely duplicate and partial discovery', async () => {
    const res = await api(w, API.opportunities.list, await w.cookie('a', 'maya'), {
      query: { mandateId: mandateId() },
    });
    expect(res.statusCode).toBe(200);
    const body = ListResponse.parse(res.json());
    const opp07 = body.items.find((o) => o.key === 'OPP-07')!;
    expect(opp07.origin).toBe('ai');
    expect(opp07.status).toBe('detected');
    expect(opp07.sources.map((s) => s.key)).toEqual(
      expect.arrayContaining(['SRC-014', 'SRC-021', 'SRC-040']),
    );
    const opp12 = body.items.find((o) => o.key === 'OPP-12')!;
    expect(opp12.likelyDuplicateOfId).toBe(opp07.id);
    expect(body.discoveryPartial).toBe(true);
    expect(body.unavailableSources.map((s) => s.name)).toContain('Trade registry');
    expect(body.items.find((o) => o.key === 'OPP-03')!.status).toBe('dismissed');
    // filters
    const dismissed = ListResponse.parse(
      (
        await api(w, API.opportunities.list, await w.cookie('a', 'maya'), {
          query: { mandateId: mandateId(), status: 'dismissed' },
        })
      ).json(),
    );
    expect(dismissed.items.map((o) => o.key)).toEqual(['OPP-03']);
  });

  it('get returns one candidate; another tenant gets 404; admin without a case role gets 404', async () => {
    const ok = await api(w, API.opportunities.get, await w.cookie('a', 'priya'), {
      params: { ref: 'OPP-07' },
    });
    expect(Opportunity.parse(ok.json()).unknowns).toContain('Adoption rate');
    const other = await api(w, API.opportunities.get, await w.cookie('b', 'maya'), {
      params: { ref: oppId(A(), 'OPP-07') },
    });
    expect(other.statusCode).toBe(404);
    const admin = await api(w, API.opportunities.get, await w.cookie('a', 'admin'), {
      params: { ref: 'OPP-07' },
    });
    expect(admin.statusCode).toBe(404);
  });

  it('step 3: merge OPP-12 into OPP-07 keeps both and links them; shortlist OPP-07 with analytics; replay', async () => {
    const maya = await w.cookie('a', 'maya');
    const merged = await api(w, API.opportunities.merge, maya, {
      params: { ref: 'OPP-12' },
      body: { targetOpportunityId: oppId(A(), 'OPP-07') },
    });
    expect(merged.statusCode).toBe(200);
    const m = API.opportunities.merge.response.parse(merged.json());
    expect(m.merged.status).toBe('duplicate');
    expect(m.merged.duplicateOfId).toBe(m.target.id);
    expect(m.target.status).toBe('detected');
    expect((await auditFor(w, A(), m.merged.id)).map((e) => e.action)).toContain('opportunity.merge');

    const key = 'shortlist-opp07';
    const first = await api(w, API.opportunities.shortlist, maya, {
      params: { ref: 'OPP-07' },
      idempotencyKey: key,
    });
    expect(first.statusCode).toBe(200);
    expect(Opportunity.parse(first.json()).status).toBe('shortlisted');
    const replay = await api(w, API.opportunities.shortlist, maya, {
      params: { ref: 'OPP-07' },
      idempotencyKey: key,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const events = await analyticsFor(w, A(), 'opportunity_shortlisted');
    expect(events).toHaveLength(1);
    expect(events[0]!.props).toEqual({ origin: 'ai' });
    const audit = await auditFor(w, A(), oppId(A(), 'OPP-07'));
    expect(audit.map((e) => e.action)).toContain('opportunity.shortlist');
    expect(audit.find((e) => e.action === 'opportunity.shortlist')!.actor_role).toBe('case_owner');
  });

  it('refuses triage by a reviewer without the role (403) and by another tenant (404)', async () => {
    const priya = await api(w, API.opportunities.dismiss, await w.cookie('a', 'priya'), {
      params: { ref: 'OPP-16' },
      body: { reason: 'x' },
    });
    expect(priya.statusCode).toBe(403);
    const other = await api(w, API.opportunities.dismiss, await w.cookie('b', 'maya'), {
      params: { ref: oppId(A(), 'OPP-16') },
      body: { reason: 'x' },
    });
    expect(other.statusCode).toBe(404);
  });

  it('dismiss needs a reason and stays visible; restore brings it back', async () => {
    const maya = await w.cookie('a', 'maya');
    const noReason = await api(w, API.opportunities.dismiss, maya, {
      params: { ref: 'OPP-16' },
      body: { reason: '' },
    });
    expect(noReason.statusCode).toBe(400);
    const d = await api(w, API.opportunities.dismiss, maya, {
      params: { ref: 'OPP-16' },
      body: { reason: 'Language variants' },
    });
    expect(Opportunity.parse(d.json())).toMatchObject({
      status: 'dismissed',
      dismissReason: 'Language variants',
    });
    const r = await api(w, API.opportunities.restore, maya, {
      params: { ref: 'OPP-16' },
      body: { reason: 'Reconsidered' },
    });
    expect(Opportunity.parse(r.json())).toMatchObject({ status: 'detected', dismissReason: null });
    expect(
      (
        await api(w, API.opportunities.restore, maya, {
          params: { ref: 'OPP-16' },
          body: { reason: 'again' },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('adds a manual candidate as Detected with no evidence', async () => {
    const res = await api(w, API.opportunities.createManual, await w.cookie('a', 'maya'), {
      body: { mandateId: mandateId(), name: 'Belgian food plants', trigger: 'GTM review', fitRationale: '' },
    });
    expect(res.statusCode).toBe(201);
    expect(Opportunity.parse(res.json())).toMatchObject({
      origin: 'manual',
      status: 'detected',
      sourceCount: 0,
    });
    const lena = await api(w, API.opportunities.createManual, await w.cookie('a', 'lena'), {
      body: { mandateId: mandateId(), name: 'x', trigger: '', fitRationale: '' },
    });
    expect(lena.statusCode).toBe(403);
  });

  it('step 5: converts OPP-07 (owner Maya) to ME-104 in Discovery with G0 approved on the rail', async () => {
    const maya = await w.cookie('a', 'maya');
    const res = await api(w, API.opportunities.convert, maya, {
      params: { ref: 'OPP-07' },
      body: { ownerId: A().user('maya') },
    });
    expect(res.statusCode).toBe(201);
    const body = API.opportunities.convert.response.parse(res.json());
    expect(body.opportunity.status).toBe('converted');
    const c = WorkflowCase.parse(body.case);
    expect(c.key).toBe('ME-104');
    expect(c.stage).toBe('discovery');
    expect(c.owner.displayName).toBe('Maya Rao');
    expect(c.sponsor.displayName).toBe('Elena Fischer');
    expect(c.originId).toBe(body.opportunity.id);

    const header = CaseHeader.parse(
      (await api(w, API.cases.header, maya, { params: { caseRef: 'ME-104' } })).json(),
    );
    expect(header.rail.find((n) => n.gateCode === 'G0')!.status).toBe('approved');
    expect(header.marketLabel).toContain('Germany');
    const audit = await auditFor(w, A(), c.id);
    expect(audit.map((e) => e.action)).toContain('case.created');
    expect(audit[0]!.summary).not.toContain('excerpt');

    // A different owner cannot convert twice; converted is terminal.
    expect(
      (
        await api(w, API.opportunities.convert, maya, {
          params: { ref: 'OPP-07' },
          body: { ownerId: A().user('maya') },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('step 5: converting before G0 is approved → PRECONDITIONS_UNMET', async () => {
    const maya = await w.cookie('a', 'maya');
    const created = await api(w, API.mandates.create, maya, {
      body: { businessUnitId: A().id(businessUnits[0].id), title: 'Draft scope', fields: {} },
    });
    expect(created.statusCode).toBe(201);
    const md = API.mandates.create.response.parse(created.json());
    const opp = await api(w, API.opportunities.createManual, maya, {
      body: { mandateId: md.id, name: 'Early candidate', trigger: '', fitRationale: '' },
    });
    const o = Opportunity.parse(opp.json());
    // Shortlisting also needs the G0-approved mandate.
    const sl = await api(w, API.opportunities.shortlist, maya, { params: { ref: o.key } });
    expect(sl.statusCode).toBe(409);
    expect(sl.json().code).toBe('PRECONDITIONS_UNMET');
    await inTenant(w, A(), (tx) =>
      tx.updateTable('me.opportunity').set({ status: 'shortlisted' }).where('id', '=', o.id).execute(),
    );
    const conv = await api(w, API.opportunities.convert, maya, {
      params: { ref: o.key },
      body: { ownerId: A().user('maya') },
    });
    expect(conv.statusCode).toBe(409);
    expect(conv.json()).toMatchObject({ code: 'PRECONDITIONS_UNMET' });
    expect(conv.json().blockers.map((b: { key: string }) => b.key)).toContain('mandate_approved');
  });
});
