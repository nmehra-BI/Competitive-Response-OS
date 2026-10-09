/**
 * Case envelope (S01, S05, S12, S13): header and rail, list, direct creation, transitions through the
 * case machine (stop by sponsor and investment committee, never by the owner), members (D-037),
 * activity, history (step 30) and review requests.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, AuditEvent, CaseHeader, ReviewRequest, WorkflowCase } from '@growth-os/contracts';
import { businessUnits } from '@growth-os/fixtures-aster';
import { analyticsFor, api, auditFor, inTenant, world, type World } from './test-support';

let w: World;
beforeAll(async () => {
  w = await world({ demo: 'aster-demo', b: 'aster-start' });
  // An investment-committee member in BU Water (the fixture has none).
  const s = w.tenants.demo!;
  await inTenant(w, s, (tx) =>
    tx
      .insertInto('platform.role_assignment')
      .values({
        tenant_id: s.tenantId,
        user_id: s.user('priya'),
        role: 'investment_committee',
        business_unit_id: s.id(businessUnits[0].id),
        granted_by: s.user('admin'),
      })
      .execute(),
  );
});
afterAll(() => w.close());

const D = () => w.tenants.demo!;

describe('cases', () => {
  it('header: ME-104 at Pilot approval pending, rail G0/G1 approved, G2 awaiting Elena, tab counts', async () => {
    const res = await api(w, API.cases.header, await w.cookie('demo', 'elena'), {
      params: { caseRef: 'ME-104' },
    });
    expect(res.statusCode).toBe(200);
    const h = CaseHeader.parse(res.json());
    expect(h.case).toMatchObject({ key: 'ME-104', stage: 'pilot_approval_pending' });
    expect(h.rail.map((n) => [n.gateCode, n.status])).toEqual([
      ['G0', 'approved'],
      ['G1', 'approved'],
      ['G2', 'awaiting_decision'],
      ['G3', 'not_started'],
    ]);
    expect(h.rail.find((n) => n.gateCode === 'G2')!.caption).toBe('Pilot €120k · 90 days · 25 Nov');
    expect(h.nextDecision).toMatchObject({ title: 'G2 · Approve pilot €120k · 90 days', blocked: false });
    expect(h.nextDecision.decider!.displayName).toBe('Elena Fischer');
    expect(h.currencyLabel).toBe('EUR · 2026 prices');
    expect(h.tabCounts.Validation).toBe('1 disputed');
    expect(h.illustrative).toBe(true);
    expect(h.freshness.ageingCount).toBe(1);
  });

  it('list: accessible cases only, with an honest scope label; filters by stage', async () => {
    const res = await api(w, API.overview.listCases, await w.cookie('demo', 'maya'), {});
    const body = API.overview.listCases.response.parse(res.json());
    expect(body.items.map((c) => c.key)).toEqual(['ME-097', 'ME-102', 'ME-104', 'ME-105']);
    expect(body.scope.partial).toBe(true);
    expect(body.scope.label).toContain('hidden cases are not counted');
    expect(body.items.find((c) => c.key === 'ME-104')!.blockersLabel).toBe('1 dissent recorded');
    const st = API.overview.listCases.response.parse(
      (
        await api(w, API.overview.listCases, await w.cookie('demo', 'maya'), {
          query: { stage: 'discovery' },
        })
      ).json(),
    );
    expect(st.items.map((c) => c.key)).toEqual(['ME-105']);
    const admin = API.overview.listCases.response.parse(
      (await api(w, API.overview.listCases, await w.cookie('demo', 'admin'), {})).json(),
    );
    expect(admin.items).toEqual([]);
  });

  it('members: humans whose roles reach the case and participants; no agent, no admin-only', async () => {
    const res = await api(w, API.cases.members, await w.cookie('demo', 'jonas'), {
      params: { caseRef: 'ME-104' },
    });
    const items = API.cases.members.response.parse(res.json()).items;
    const names = items.map((m) => m.displayName);
    expect(names).toEqual(
      expect.arrayContaining([
        'Elena Fischer',
        'Maya Rao',
        'Daniel Weber',
        'Jonas Klein',
        'Priya Shah',
        'Lena Hoffmann',
        '[Operations lead]',
      ]),
    );
    expect(names).not.toContain('[Tenant administrator]');
    expect(names).not.toContain('Analysis assistant');
    expect(items.find((m) => m.displayName === 'Jonas Klein')!).toMatchObject({
      roles: expect.arrayContaining(['pilot_owner', 'commercial_reviewer']),
      participantRoles: ['pilot_owner'],
    });
    expect(
      (await api(w, API.cases.members, await w.cookie('demo', 'admin'), { params: { caseRef: 'ME-104' } }))
        .statusCode,
    ).toBe(404);
  });

  it('stop: the sponsor and the investment committee may stop a case; the case owner may not', async () => {
    const maya = await api(w, API.cases.transition, await w.cookie('demo', 'maya'), {
      params: { caseRef: 'ME-104' },
      body: { command: 'stop', rationale: 'Not worth it' },
    });
    expect(maya.statusCode).toBe(403);
    expect(maya.json().code).toBe('FORBIDDEN');
    const elena = await api(w, API.cases.transition, await w.cookie('demo', 'elena'), {
      params: { caseRef: 'ME-105' },
      body: { command: 'stop', rationale: 'Channel does not cover NL' },
    });
    expect(elena.statusCode).toBe(200);
    expect(CaseHeader.parse(elena.json()).case.stage).toBe('stopped');
    const ic = await api(w, API.cases.transition, await w.cookie('demo', 'priya'), {
      params: { caseRef: 'ME-102' },
      body: { command: 'stop', rationale: 'Committee stops the brewery case' },
    });
    expect(ic.statusCode).toBe(200);
    const events = await analyticsFor(w, D(), 'case_stopped');
    expect(events.map((e) => e.props)).toEqual([
      { fromStage: 'discovery', outcome: null },
      { fromStage: 'assessment', outcome: null },
    ]);
    const decisions = await inTenant(w, D(), (tx) =>
      tx.selectFrom('platform.decision_record').select(['outcome', 'label']).execute(),
    );
    expect(decisions).toEqual([
      { outcome: 'stop', label: 'Stopped' },
      { outcome: 'stop', label: 'Stopped' },
    ]);
    // Read-only reviewer: refused before the machine runs; another tenant: not found.
    expect(
      (
        await api(w, API.cases.transition, await w.cookie('demo', 'opsLead'), {
          params: { caseRef: 'ME-104' },
          body: { command: 'hold', rationale: 'x' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await api(w, API.cases.transition, await w.cookie('b', 'elena'), {
          params: { caseRef: D().id('a57e0010-0000-4000-8000-000000000104') },
          body: { command: 'hold', rationale: 'x' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('hold stores the stage to resume; resume returns there', async () => {
    const m = await w.cookie('demo', 'maya');
    const held = CaseHeader.parse(
      (
        await api(w, API.cases.transition, m, {
          params: { caseRef: 'ME-104' },
          body: { command: 'hold', rationale: 'Waiting for budget round' },
        })
      ).json(),
    );
    expect(held.case).toMatchObject({ stage: 'on_hold', heldFromStage: 'pilot_approval_pending' });
    expect(held.currentSegment).toBe('validation');
    const res = await api(w, API.cases.transition, m, {
      params: { caseRef: 'ME-104' },
      body: { command: 'resume', rationale: 'Budget confirmed' },
    });
    expect(CaseHeader.parse(res.json()).case).toMatchObject({
      stage: 'pilot_approval_pending',
      heldFromStage: null,
    });
    const empty = await api(w, API.cases.transition, m, {
      params: { caseRef: 'ME-104' },
      body: { command: 'hold', rationale: '' },
    });
    expect(empty.statusCode).toBe(400);
  });

  it('step 30: history lists seeded and new events once each, in audit order, with actor and version', async () => {
    const res = await api(w, API.cases.history, await w.cookie('demo', 'elena'), {
      params: { caseRef: 'ME-104' },
      query: { limit: 200 },
    });
    const page = API.cases.history.response.parse(res.json());
    const items = page.items.map((e) => AuditEvent.parse(e));
    expect(new Set(items.map((e) => e.id)).size).toBe(items.length);
    const seqs = items.map((e) => e.seq);
    expect([...seqs].sort((a, b) => b - a)).toEqual(seqs);
    const actions = items.map((e) => e.action);
    for (const a of [
      'seed.case_converted',
      'seed.sizing_committed',
      'seed.gate_decided',
      'seed.gate_submitted',
    ])
      expect(actions.filter((x) => x === a)).toHaveLength(1);
    const hold = items.find((e) => e.action === 'case.hold')!;
    expect(hold.actor!.displayName).toBe('Maya Rao');
    expect(hold.actorRole).toBe('case_owner');
    expect(hold.objectVersion).toBeGreaterThan(0);
    expect(items.find((e) => e.action === 'seed.case_converted')!.actorKind).toBe('system');
    // Paging walks the same order without repeats.
    const p1 = API.cases.history.response.parse(
      (
        await api(w, API.cases.history, await w.cookie('demo', 'elena'), {
          params: { caseRef: 'ME-104' },
          query: { limit: 3 },
        })
      ).json(),
    );
    const p2 = API.cases.history.response.parse(
      (
        await api(w, API.cases.history, await w.cookie('demo', 'elena'), {
          params: { caseRef: 'ME-104' },
          query: { limit: 3, cursor: p1.nextCursor! },
        })
      ).json(),
    );
    expect([...p1.items, ...p2.items].map((e) => e.id)).toEqual(items.slice(0, 6).map((e) => e.id));
    const act = API.cases.activity.response.parse(
      (
        await api(w, API.cases.activity, await w.cookie('demo', 'elena'), {
          params: { caseRef: 'ME-104' },
          query: { keyOnly: true },
        })
      ).json(),
    );
    expect(act.items.every((i) => i.keyDecision)).toBe(true);
    expect(
      (await api(w, API.cases.history, await w.cookie('demo', 'admin'), { params: { caseRef: 'ME-104' } }))
        .statusCode,
    ).toBe(404);
  });

  it('creates a case directly with a draft mandate (mandate_created)', async () => {
    const res = await api(w, API.cases.createDirect, await w.cookie('demo', 'maya'), {
      body: {
        businessUnitId: D().id(businessUnits[0].id),
        title: 'Danish dairies — monitoring',
        mandate: { geographyCodes: ['DK'] },
      },
    });
    expect(res.statusCode).toBe(201);
    const c = WorkflowCase.parse(res.json());
    expect(c).toMatchObject({ stage: 'draft_mandate', originType: 'direct' });
    expect(c.sponsor.displayName).toBe('Elena Fischer');
    const md = API.mandates.get.response.parse(
      (
        await api(w, API.mandates.get, await w.cookie('demo', 'maya'), { params: { ref: c.mandateId } })
      ).json(),
    );
    expect(md.status).toBe('draft');
    expect((await analyticsFor(w, D(), 'mandate_created')).map((e) => e.props)).toEqual([
      { hasSponsor: true },
    ]);
    expect((await auditFor(w, D(), c.id)).map((e) => e.action)).toEqual(['case.created']);
    expect(
      (
        await api(w, API.cases.createDirect, await w.cookie('demo', 'daniel'), {
          body: { businessUnitId: D().id(businessUnits[0].id), title: 'x', mandate: {} },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('requests a focused review; a reviewer without the role cannot', async () => {
    const res = await api(w, API.cases.requestReview, await w.cookie('demo', 'maya'), {
      params: { caseRef: 'ME-104' },
      body: {
        area: 'operations',
        reviewerId: D().user('opsLead'),
        targetType: 'feasibility.operations',
        targetId: null,
        question: 'Can we install and support 4 pilot sites?',
        whatToCheck: ['Installer availability', 'Support hours'],
        dueOn: '2026-11-30',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(ReviewRequest.parse(res.json())).toMatchObject({
      caseKey: 'ME-104',
      status: 'open',
      reviewer: { displayName: '[Operations lead]' },
    });
    const feas = API.feasibility.get.response.parse(
      (
        await api(w, API.feasibility.get, await w.cookie('demo', 'maya'), { params: { caseRef: 'ME-104' } })
      ).json(),
    );
    expect(feas.rows.find((r) => r.dimension === 'operations')!.question).toBe(
      'Can we install and support 4 pilot sites?',
    );
    const priya = await api(w, API.cases.requestReview, await w.cookie('demo', 'lena'), {
      params: { caseRef: 'ME-104' },
      body: {
        area: 'finance',
        reviewerId: D().user('daniel'),
        targetType: 'case',
        targetId: null,
        question: 'q',
        whatToCheck: [],
        dueOn: null,
      },
    });
    expect(priya.statusCode).toBe(403);
  });
});
