/**
 * Exhaustive role × action policy matrix (ARCHITECTURE.md §7.3, D-016) plus the invariants no
 * configuration can change. The expected matrix below is written out by hand from the spec, NOT
 * derived from ROLE_ACTIONS, so a change to the table shows up here.
 */
import { describe, expect, it } from 'vitest';
import type { AuthorityGrant, RoleAssignment, RoleCode } from '@growth-os/contracts';
import { RoleCode as RoleCodeEnum } from '@growth-os/contracts';
import {
  ACTIONS,
  createPolicyEngine,
  type Action,
  type PolicySubject,
  type ResourceRef,
} from './policy-engine';
import type { Actor } from '../workflow/state-machine';

const BU_WATER = 'bu-water';
const BU_AIR = 'bu-air';
const CASE = 'case-104';
const CEILING = '250000.00'; // fixture PLACEHOLDER_CEILING

const ROLES = RoleCodeEnum.options;
const ALL_BUT_ADMIN = ROLES.filter((r) => r !== 'tenant_admin');

/** Spec: which roles may perform each action within scope (self / licence / grant satisfied). */
const SPEC: Record<Action, readonly RoleCode[]> = {
  'case.read': ALL_BUT_ADMIN,
  'case.read_brief': ALL_BUT_ADMIN,
  'source.read_metadata': ALL_BUT_ADMIN,
  'source.read_excerpt': ALL_BUT_ADMIN,
  'site_list.read': ALL_BUT_ADMIN,
  'audit.read': ['tenant_admin'],
  'diagnostics.read': ['tenant_admin'],
  'mandate.edit': ['case_owner'],
  'mandate.submit': ['case_owner'],
  'opportunity.triage': ['case_owner'],
  'opportunity.convert': ['case_owner'],
  'case.edit': ['case_owner'],
  'case.hold_resume': ['sponsor', 'case_owner'],
  'case.stop': ['sponsor'],
  'model.edit_draft': ['case_owner', 'finance_reviewer'],
  'model.commit': ['case_owner'],
  'assumption.edit': ['case_owner'],
  'assumption.dispute': [
    'sponsor',
    'case_owner',
    'commercial_reviewer',
    'product_reviewer',
    'finance_reviewer',
  ],
  'challenge.resolve': ['sponsor', 'finance_reviewer'],
  'claim.accept_ai': ['case_owner'],
  'review.request': ['sponsor', 'case_owner'],
  'review.sign': [
    'pilot_owner',
    'commercial_reviewer',
    'product_reviewer',
    'finance_reviewer',
    'specialist_reviewer',
  ],
  'experiment.edit': ['case_owner'],
  'experiment.record_result': ['case_owner'],
  'gate.submit': ['case_owner'],
  'gate.withdraw': ['case_owner'],
  'gate.decide': ['sponsor', 'investment_committee'],
  'gate.record_position': [
    'sponsor',
    'pilot_owner',
    'commercial_reviewer',
    'product_reviewer',
    'finance_reviewer',
    'specialist_reviewer',
    'investment_committee',
  ],
  'materiality.resolve': ['sponsor', 'investment_committee'],
  'pilot.edit_plan': ['case_owner', 'pilot_owner'],
  'pilot.activate': ['pilot_owner'],
  'task.update': ['case_owner', 'pilot_owner', 'commercial_reviewer', 'product_reviewer'],
  'task_sync.preview': ['pilot_owner'],
  'task_sync.send': ['pilot_owner'],
  'budget.record': ['case_owner', 'pilot_owner'],
  'outcome.record': ['case_owner', 'pilot_owner'],
  'outcome.decide': ['sponsor', 'investment_committee'],
  'analysis.start': ['case_owner'],
  'proposal.decide': ['case_owner'],
  'admin.configure': ['tenant_admin'],
};

const AGENT_SPEC: readonly Action[] = ['case.read', 'source.read_metadata', 'source.read_excerpt'];

function role(userId: string, r: RoleCode, bu: string | null = BU_WATER, caseId: string | null = null) {
  return {
    id: `role-${userId}-${r}`,
    userId,
    role: r,
    businessUnitId: bu,
    caseId,
    grantedBy: 'admin',
    grantedAt: '2026-01-01T00:00:00Z',
    revokedAt: null,
  } satisfies RoleAssignment;
}

function grant(userId: string, over: Partial<AuthorityGrant> = {}): AuthorityGrant {
  return {
    id: `grant-${userId}-${over.gateCode ?? 'G2'}`,
    userId,
    gateCode: 'G2',
    businessUnitId: BU_WATER,
    ceilingAmount: CEILING,
    currency: 'EUR',
    validFrom: '2026-01-01',
    validTo: null,
    grantedBy: 'admin',
    revokedAt: null,
    ...over,
  };
}

const human = (userId: string): Actor => ({ kind: 'human', userId, interactive: true });

function subject(userId: string, roles: RoleAssignment[], authority: AuthorityGrant[] = []): PolicySubject {
  return { actor: human(userId), roles, authority, participantOfCaseIds: [], asOf: '2026-11-27' };
}

function resource(userId: string, over: Partial<ResourceRef['facts']> = {}): ResourceRef {
  return {
    type: 'case',
    id: CASE,
    businessUnitId: BU_WATER,
    caseId: CASE,
    facts: {
      caseOwnerId: 'someone-else',
      sponsorId: 'sponsor-x',
      packageAuthorId: 'author-x',
      namedReviewerId: userId,
      gateCode: 'G2',
      requestedAmount: '120000.00',
      currency: 'EUR',
      licenseAccess: 'excerpt',
      ...over,
    },
  };
}

const engine = createPolicyEngine();

describe('policy matrix: role × action (every cell)', () => {
  for (const r of ROLES) {
    for (const action of ACTIONS) {
      const expected = SPEC[action].includes(r);
      it(`${r} ${expected ? 'may' : 'may not'} ${action}`, () => {
        const uid = `u-${r}`;
        const d = engine.check(subject(uid, [role(uid, r)], [grant(uid)]), action, resource(uid));
        expect(d.allow, JSON.stringify(d)).toBe(expected);
        if (!d.allow) expect(d.code).toBe('FORBIDDEN');
      });
    }
  }

  it('allowedActions matches the spec for every role', () => {
    for (const r of ROLES) {
      const uid = `u-${r}`;
      const allowed = engine.allowedActions(subject(uid, [role(uid, r)], [grant(uid)]), resource(uid));
      const expected = ACTIONS.filter((a) => SPEC[a].includes(r));
      expect(allowed.sort(), r).toEqual([...expected].sort());
    }
  });
});

describe('policy matrix: agent and service principals', () => {
  for (const action of ACTIONS) {
    const allowed = AGENT_SPEC.includes(action);
    it(`agent ${allowed ? 'may' : 'may not'} ${action}`, () => {
      const s: PolicySubject = {
        actor: { kind: 'agent', userId: 'agent' },
        // even if someone configured roles and grants for the agent, it never decides
        roles: [role('agent', 'sponsor'), role('agent', 'case_owner')],
        authority: [grant('agent')],
        participantOfCaseIds: [CASE],
        asOf: '2026-11-27',
      };
      const d = engine.check(s, action, resource('agent'));
      expect(d.allow).toBe(allowed);
      if (!d.allow) expect(d.code).toBe('AGENT_IDENTITY_FORBIDDEN');
    });

    it(`service principal may not ${action}`, () => {
      const s: PolicySubject = {
        actor: { kind: 'service', userId: 'svc' },
        roles: [role('svc', 'sponsor')],
        authority: [grant('svc')],
        participantOfCaseIds: [CASE],
        asOf: '2026-11-27',
      };
      const d = engine.check(s, action, resource('svc'));
      expect(d).toMatchObject({ allow: false, code: 'AGENT_IDENTITY_FORBIDDEN' });
    });
  }

  it('agent excerpt access still follows the licence', () => {
    const s: PolicySubject = {
      actor: { kind: 'agent', userId: 'agent' },
      roles: [],
      authority: [],
      participantOfCaseIds: [CASE],
    };
    const d = engine.check(s, 'source.read_excerpt', resource('agent', { licenseAccess: 'none' }));
    expect(d).toMatchObject({ allow: false, code: 'RESTRICTED_SOURCE' });
  });
});

describe('scope', () => {
  it('a case in another business unit is hidden (404), not forbidden', () => {
    const s = subject('elena', [role('elena', 'sponsor')]);
    const r = { ...resource('elena'), businessUnitId: BU_AIR };
    expect(engine.check(s, 'case.read', r)).toMatchObject({ allow: false, code: 'NOT_FOUND' });
    expect(engine.check(s, 'gate.decide', r)).toMatchObject({ allow: false, code: 'NOT_FOUND' });
  });

  it('a case-scoped role applies to its case only', () => {
    const s = subject('x', [role('x', 'finance_reviewer', BU_WATER, 'case-other')]);
    expect(engine.check(s, 'case.read', resource('x'))).toMatchObject({ allow: false, code: 'NOT_FOUND' });
    const s2 = subject('x', [role('x', 'finance_reviewer', BU_WATER, CASE)]);
    expect(engine.check(s2, 'case.read', resource('x')).allow).toBe(true);
  });

  it('a revoked role grants nothing', () => {
    const r = { ...role('x', 'case_owner'), revokedAt: '2026-06-01T00:00:00Z' };
    expect(engine.check(subject('x', [r]), 'case.edit', resource('x'))).toMatchObject({
      allow: false,
      code: 'NOT_FOUND',
    });
  });

  it('case participants without a role may read the case but not change it', () => {
    const s: PolicySubject = { ...subject('p', []), participantOfCaseIds: [CASE] };
    expect(engine.check(s, 'case.read', resource('p')).allow).toBe(true);
    expect(engine.check(s, 'case.edit', resource('p'))).toMatchObject({ allow: false, code: 'FORBIDDEN' });
  });

  it('writes need an interactive session', () => {
    const s: PolicySubject = {
      ...subject('maya', [role('maya', 'case_owner')]),
      actor: { kind: 'human', userId: 'maya', interactive: false },
    };
    expect(engine.check(s, 'case.edit', resource('maya'))).toMatchObject({
      allow: false,
      code: 'AGENT_IDENTITY_FORBIDDEN',
    });
    expect(engine.check(s, 'case.read', resource('maya')).allow).toBe(true);
  });
});

describe('invariants', () => {
  const elena = subject('elena', [role('elena', 'sponsor')], [grant('elena')]);

  it('the package author cannot approve their own gate', () => {
    const d = engine.check(elena, 'gate.decide', resource('elena', { packageAuthorId: 'elena' }));
    expect(d).toMatchObject({ allow: false, code: 'SELF_APPROVAL_PROHIBITED' });
    if (!d.allow) expect(d.reason).toBe('You authored this package and cannot approve it.');
  });

  it('the case owner cannot approve their own gate, even with a sponsor role and a grant', () => {
    const d = engine.check(elena, 'gate.decide', resource('elena', { caseOwnerId: 'elena' }));
    expect(d).toMatchObject({ allow: false, code: 'SELF_APPROVAL_PROHIBITED' });
  });

  it('Maya (case owner and author) forcing a decision gets SELF_APPROVAL_PROHIBITED', () => {
    const maya = subject('maya', [role('maya', 'case_owner')]);
    const d = engine.check(
      maya,
      'gate.decide',
      resource('maya', { caseOwnerId: 'maya', packageAuthorId: 'maya' }),
    );
    expect(d).toMatchObject({ allow: false, code: 'SELF_APPROVAL_PROHIBITED' });
  });

  it('an administrator never approves, even holding a sponsor role and a grant', () => {
    const s = subject(
      'adm',
      [role('adm', 'tenant_admin', null), role('adm', 'sponsor')],
      [grant('adm'), grant('adm', { gateCode: 'G3' })],
    );
    const d = engine.check(s, 'gate.decide', resource('adm'));
    expect(d).toMatchObject({ allow: false, code: 'FORBIDDEN' });
    if (!d.allow) expect(d.reason).toMatch(/Administrators/);
    for (const g of ['G0', 'G1', 'G2', 'G3', 'X'] as const) {
      expect(engine.check(s, 'gate.decide', resource('adm', { gateCode: g })).allow).toBe(false);
    }
  });

  it('an administrator cannot configure authority for themselves', () => {
    const s = subject('adm', [role('adm', 'tenant_admin', null)]);
    const tenantRes: ResourceRef = {
      type: 'tenant',
      id: 't',
      businessUnitId: null,
      caseId: null,
      facts: { grantTargetUserId: 'adm' },
    };
    expect(engine.check(s, 'admin.configure', tenantRes)).toMatchObject({ allow: false, code: 'FORBIDDEN' });
    expect(
      engine.check(s, 'admin.configure', { ...tenantRes, facts: { grantTargetUserId: 'elena' } }).allow,
    ).toBe(true);
  });

  it('a conflicted reviewer cannot decide, sign or record a position', () => {
    const conflicted = resource('elena', { conflictedUserIds: ['elena'] });
    expect(engine.check(elena, 'gate.decide', conflicted)).toMatchObject({
      allow: false,
      code: 'CONFLICT_OF_INTEREST',
    });
    const lena = subject('lena', [role('lena', 'specialist_reviewer')]);
    const c2 = resource('lena', { conflictedUserIds: ['lena'] });
    expect(engine.check(lena, 'review.sign', c2)).toMatchObject({ code: 'CONFLICT_OF_INTEREST' });
    expect(engine.check(lena, 'gate.record_position', c2)).toMatchObject({ code: 'CONFLICT_OF_INTEREST' });
  });

  it('task ownership never grants approval (pilot owner with tasks cannot decide)', () => {
    const jonas = subject('jonas', [role('jonas', 'pilot_owner'), role('jonas', 'commercial_reviewer')]);
    expect(engine.check(jonas, 'gate.decide', resource('jonas'))).toMatchObject({
      allow: false,
      code: 'FORBIDDEN',
    });
  });

  it('only the named reviewer signs a review', () => {
    const lena = subject('lena', [role('lena', 'specialist_reviewer')]);
    expect(engine.check(lena, 'review.sign', resource('lena', { namedReviewerId: 'priya' }))).toMatchObject({
      allow: false,
      code: 'FORBIDDEN',
    });
  });

  it('a finance reviewer resolves only their own challenge; the sponsor resolves any', () => {
    const daniel = subject('daniel', [role('daniel', 'finance_reviewer')]);
    expect(
      engine.check(daniel, 'challenge.resolve', resource('daniel', { namedReviewerId: 'x' })).allow,
    ).toBe(false);
    expect(engine.check(elena, 'challenge.resolve', resource('elena', { namedReviewerId: 'x' })).allow).toBe(
      true,
    );
  });
});

describe('licences', () => {
  const maya = subject('maya', [role('maya', 'case_owner')]);
  it('aggregate-only or no licence returns RESTRICTED_SOURCE for excerpts and site lists', () => {
    for (const access of ['aggregate_only', 'none'] as const) {
      expect(
        engine.check(maya, 'source.read_excerpt', resource('maya', { licenseAccess: access })),
      ).toMatchObject({ allow: false, code: 'RESTRICTED_SOURCE' });
      expect(engine.check(maya, 'site_list.read', resource('maya', { licenseAccess: access }))).toMatchObject(
        { allow: false, code: 'RESTRICTED_SOURCE' },
      );
    }
  });
  it('a missing licence fact fails closed', () => {
    expect(
      engine.check(maya, 'source.read_excerpt', resource('maya', { licenseAccess: undefined })),
    ).toMatchObject({
      allow: false,
      code: 'RESTRICTED_SOURCE',
    });
  });
});

describe('delegated authority ceilings (fixture placeholders)', () => {
  const s = (grants: AuthorityGrant[], asOf = '2026-11-27') => ({
    ...subject('elena', [role('elena', 'sponsor')], grants),
    asOf,
  });

  it('approves within the ceiling and reports the grant', () => {
    const d = engine.check(s([grant('elena')]), 'gate.decide', resource('elena'));
    expect(d).toMatchObject({ allow: true, authorityGrantId: 'grant-elena-G2' });
  });

  it('refuses an amount above the ceiling', () => {
    const d = engine.check(
      s([grant('elena')]),
      'gate.decide',
      resource('elena', { requestedAmount: '250000.01' }),
    );
    expect(d).toMatchObject({ allow: false, code: 'AUTHORITY_INSUFFICIENT' });
    if (!d.allow) expect(d.reason).toContain('€[limit]');
  });

  it('accepts an amount equal to the ceiling', () => {
    expect(
      engine.check(s([grant('elena')]), 'gate.decide', resource('elena', { requestedAmount: CEILING })).allow,
    ).toBe(true);
  });

  it('refuses a different currency, another BU, an expired, future or revoked grant', () => {
    const cases: AuthorityGrant[] = [
      grant('elena', { currency: 'USD' }),
      grant('elena', { businessUnitId: BU_AIR }),
      grant('elena', { validTo: '2026-11-26' }),
      grant('elena', { validFrom: '2026-11-28' }),
      grant('elena', { revokedAt: '2026-11-01T00:00:00Z' }),
      grant('elena', { gateCode: 'G1' }),
    ];
    for (const g of cases) {
      expect(engine.check(s([g]), 'gate.decide', resource('elena')), JSON.stringify(g)).toMatchObject({
        allow: false,
        code: 'AUTHORITY_INSUFFICIENT',
      });
    }
  });

  it('G3 with no grant is an authority gap', () => {
    const d = engine.check(s([grant('elena')]), 'gate.decide', resource('elena', { gateCode: 'G3' }));
    expect(d).toMatchObject({ allow: false, code: 'AUTHORITY_INSUFFICIENT' });
    if (!d.allow) expect(d.reason).toMatch(/Authority gap/);
  });

  it('a spend gate with no stated amount (€[cap] placeholder) cannot be approved', () => {
    const d = engine.check(
      s([grant('elena', { gateCode: 'X' })]),
      'gate.decide',
      resource('elena', { gateCode: 'X', requestedAmount: null, currency: null }),
    );
    expect(d).toMatchObject({ allow: false, code: 'AUTHORITY_INSUFFICIENT' });
  });

  it('G0 carries no spend: a null-ceiling grant covers it', () => {
    const g0 = grant('elena', { gateCode: 'G0', ceilingAmount: null, currency: null });
    expect(
      engine.check(
        s([g0]),
        'gate.decide',
        resource('elena', { gateCode: 'G0', requestedAmount: null, currency: null }),
      ).allow,
    ).toBe(true);
  });

  it('a null-ceiling grant does not cover a spend', () => {
    const g = grant('elena', { ceilingAmount: null, currency: null });
    expect(engine.check(s([g]), 'gate.decide', resource('elena')).allow).toBe(false);
  });

  it('fails closed without a decision date', () => {
    const subj = { ...s([grant('elena')]), asOf: undefined };
    expect(engine.check(subj, 'gate.decide', resource('elena'))).toMatchObject({
      allow: false,
      code: 'AUTHORITY_INSUFFICIENT',
    });
  });
});

describe('gateDecisionChecks and approvalPanel', () => {
  it('reports each check separately for the gate machine guards', () => {
    const elena = subject('elena', [role('elena', 'sponsor')], [grant('elena')]);
    const c = engine.gateDecisionChecks(elena, resource('elena'));
    expect(c).toMatchObject({
      designatedApprover: { ok: true },
      authority: { ok: true },
      notSelf: { ok: true },
      notConflicted: { ok: true },
      authorityGrantId: 'grant-elena-G2',
    });
  });

  it('approval panel for the author explains why decide is unavailable', () => {
    const maya = subject('maya', [role('maya', 'case_owner')]);
    const p = engine.approvalPanel(maya, resource('maya', { packageAuthorId: 'maya', caseOwnerId: 'maya' }));
    expect(p).toMatchObject({
      canDecide: false,
      allowedDispositions: [],
      cannotDecideReason: 'You authored this package and cannot approve it.',
    });
  });

  it('approval panel for an authorized approver offers every disposition', () => {
    const elena = subject('elena', [role('elena', 'sponsor')], [grant('elena')]);
    const p = engine.approvalPanel(elena, resource('elena'));
    expect(p.canDecide).toBe(true);
    expect(p.allowedDispositions).toEqual([
      'approve',
      'approve_with_conditions',
      'return_for_revision',
      'not_approved',
      'abstain',
      'delegate',
    ]);
  });

  it('a designated approver above their ceiling may still return or decline, never approve', () => {
    const elena = subject('elena', [role('elena', 'sponsor')], [grant('elena')]);
    const p = engine.approvalPanel(elena, resource('elena', { requestedAmount: '900000.00' }));
    expect(p.canDecide).toBe(true);
    expect(p.allowedDispositions).not.toContain('approve');
    expect(p.allowedDispositions).not.toContain('approve_with_conditions');
    expect(p.allowedDispositions).toContain('return_for_revision');
  });
});
