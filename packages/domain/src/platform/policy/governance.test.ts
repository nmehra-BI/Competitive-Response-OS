/**
 * Governance rules (D-109, D-110, D-122): default matrix, routing, the committee quorum on one snapshot
 * with the finance seat required, the X cumulative rule and the extension limits.
 */
import { describe, expect, it } from 'vitest';
import { GatePolicyBody } from '@growth-os/contracts';
import { expectedCommittee, expectedExtension, gatePolicies, gates } from '@growth-os/fixtures-aster';
import {
  DEFAULT_AUTHORITY,
  DEFAULT_EXTENSION_RULE,
  effectiveGatePolicy,
  evaluateCommittee,
  extensionLimits,
  formatMoneyShort,
  routeRequest,
  type CommitteeDecisionFact,
  type CommitteeInput,
} from './governance';

const policyOf = (code: string) => GatePolicyBody.parse(gatePolicies.find((p) => p.gateCode === code));

describe('effective gate policy (defaults when a field is absent)', () => {
  it('Aster G3: 2 of 3 with the finance seat; never expires', () => {
    const p = effectiveGatePolicy(policyOf('G3'));
    expect(p.committee).toEqual({
      seats: ['chair', 'finance', 'operations'],
      requiredSeats: [...expectedCommittee.requiredSeats],
      quorum: expectedCommittee.quorum,
    });
    expect(p.approvalExpires).toBe(false);
    expect(p.authority.sponsorCeiling).toBeNull();
  });

  it('G2 above the sponsor uses the same committee quorum; expiry 30 days', () => {
    const p = effectiveGatePolicy(policyOf('G2'));
    expect(p.committee.quorum).toBe(2);
    expect(p.committee.requiredSeats).toEqual(['finance']);
    expect(p.approvalExpires).toBe(true);
    expect(p.approvalExpiryDays).toBe(30);
  });

  it('a policy written before D-122 gets the D-109/D-110 defaults', () => {
    const old = GatePolicyBody.parse({ gateCode: 'X', preconditionKeys: [] });
    const p = effectiveGatePolicy(old);
    expect(p.authority).toEqual(DEFAULT_AUTHORITY.X);
    expect(p.extension).toEqual(DEFAULT_EXTENSION_RULE);
    expect(
      effectiveGatePolicy(GatePolicyBody.parse({ gateCode: 'G0', preconditionKeys: [] })).approvalExpires,
    ).toBe(false);
  });
});

describe('routing by the delegated-authority matrix', () => {
  const g2 = DEFAULT_AUTHORITY.G2;
  it('€120k with Elena’s €150k grant → sponsor; €200k → committee; €1.2m → authority gap', () => {
    const r = (amount: string) =>
      routeRequest({
        gateCode: 'G2',
        amount,
        currency: 'EUR',
        authority: g2,
        sponsorGrantCeiling: '150000.00',
      }).route;
    expect(r('120000.00')).toBe('sponsor');
    expect(r('150000.00')).toBe('sponsor');
    expect(r('200000.00')).toBe('committee');
    expect(r('1200000.00')).toBe('authority_gap');
  });

  it('the sponsor route needs the sponsor’s own grant; G3 never routes to the sponsor; G0 always does', () => {
    expect(routeRequest({ gateCode: 'G2', amount: '120000.00', currency: 'EUR', authority: g2 }).route).toBe(
      'committee',
    );
    expect(
      routeRequest({
        gateCode: 'G3',
        amount: '400000.00',
        currency: 'EUR',
        authority: DEFAULT_AUTHORITY.G3,
        sponsorGrantCeiling: '9000000.00',
      }).route,
    ).toBe('committee');
    expect(
      routeRequest({ gateCode: 'G0', amount: null, currency: null, authority: DEFAULT_AUTHORITY.G0 }).route,
    ).toBe('sponsor');
  });

  it('X cumulative: €120k + €30k = €150k stays with Elena; one euro more goes to the committee', () => {
    const x = (amount: string) =>
      routeRequest({
        gateCode: 'X',
        amount,
        currency: 'EUR',
        authority: DEFAULT_AUTHORITY.X,
        sponsorGrantCeiling: '50000.00',
        cumulative: { priorAmount: '120000.00', sponsorParentCeiling: '150000.00', within: true },
      }).route;
    expect(x('30000.00')).toBe('sponsor');
    expect(x('30000.01')).toBe('committee');
    expect(x('300000.00')).toBe('authority_gap');
  });
});

describe('committee quorum on one snapshot hash (D-109 §3)', () => {
  const holders = [
    { seat: 'chair' as const, userId: 'elena' },
    { seat: 'finance' as const, userId: 'katrin' },
    { seat: 'operations' as const, userId: 'thomas' },
  ];
  const base: CommitteeInput = {
    quorum: 2,
    seats: ['chair', 'finance', 'operations'],
    requiredSeats: ['finance'],
    holders,
    excludedUserIds: [],
    currentSnapshotId: 's2',
    decisions: [],
    viewerId: null,
  };
  const d = (
    userId: string,
    seat: CommitteeDecisionFact['seat'],
    disposition: CommitteeDecisionFact['disposition'],
    snapshotId = 's2',
  ): CommitteeDecisionFact => ({ userId, seat, disposition, snapshotId, effective: true });

  it('one approval (chair) → "Waiting on second approver · finance seat"', () => {
    const e = evaluateCommittee({ ...base, decisions: [d('elena', 'chair', 'approve')] });
    expect(e.outcome).toBe('pending');
    expect(e.statusText).toBe(expectedCommittee.waitingText);
  });

  it('chair + operations (no finance) is not approved yet; finance + one is approved', () => {
    const noFinance = evaluateCommittee({
      ...base,
      decisions: [d('elena', 'chair', 'approve'), d('thomas', 'operations', 'approve')],
    });
    expect(noFinance.outcome).toBe('pending');
    expect(noFinance.statusText).toBe('Waiting on the finance seat');
    const ok = evaluateCommittee({
      ...base,
      decisions: [d('katrin', 'finance', 'approve'), d('thomas', 'operations', 'approve_with_conditions')],
    });
    expect(ok.outcome).toBe('approved');
    expect(ok.statusText).toBe('Quorum reached · 2 of 3 with the finance seat');
  });

  it('approvals on an earlier snapshot lapse; the refreshed snapshot needs fresh approvals', () => {
    const e = evaluateCommittee({
      ...base,
      currentSnapshotId: 's3',
      decisions: [d('katrin', 'finance', 'approve', 's2'), d('elena', 'chair', 'approve', 's2')],
    });
    expect(e.outcome).toBe('pending');
    expect(e.approvals).toBe(0);
    expect(e.seats.filter((s) => s.state === 'lapsed').map((s) => s.seat)).toEqual(['chair', 'finance']);
  });

  it('finance Not approved (or abstain) ends the request; two Not approved end it too', () => {
    expect(evaluateCommittee({ ...base, decisions: [d('katrin', 'finance', 'not_approved')] }).outcome).toBe(
      'not_approved',
    );
    expect(evaluateCommittee({ ...base, decisions: [d('katrin', 'finance', 'abstain')] }).outcome).toBe(
      'not_approved',
    );
    expect(
      evaluateCommittee({
        ...base,
        decisions: [d('elena', 'chair', 'not_approved'), d('thomas', 'operations', 'not_approved')],
      }).outcome,
    ).toBe('not_approved');
    // Abstain never counts toward quorum.
    const abstain = evaluateCommittee({
      ...base,
      decisions: [d('elena', 'chair', 'abstain'), d('katrin', 'finance', 'approve')],
    });
    expect(abstain.outcome).toBe('pending');
    expect(abstain.approvals).toBe(1);
  });

  it('an excluded or vacant finance seat can never reach quorum', () => {
    const excluded = evaluateCommittee({ ...base, excludedUserIds: ['katrin'] });
    expect(excluded.seats.find((s) => s.seat === 'finance')?.state).toBe('excluded');
    expect(excluded.outcome).toBe('not_approved');
    const vacant = evaluateCommittee({ ...base, holders: holders.filter((h) => h.seat !== 'finance') });
    expect(vacant.seats.find((s) => s.seat === 'finance')?.state).toBe('vacant');
  });

  it('an invalidated approval does not count', () => {
    const e = evaluateCommittee({
      ...base,
      decisions: [d('elena', 'chair', 'approve'), { ...d('katrin', 'finance', 'approve'), effective: false }],
    });
    expect(e.outcome).toBe('pending');
  });
});

describe('extension limits (D-110 §1, §2)', () => {
  it('X1 on the €120k · 90-day pilot: up to €30k (25%) · up to 45 days', () => {
    const l = extensionLimits(
      DEFAULT_EXTENSION_RULE,
      { amount: gates.g2.amount, currency: 'EUR', durationDays: 90, maxSites: 4 },
      0,
      expectedExtension.cumulativeCeiling,
    )!;
    expect(l.maxAmount).toBe(expectedExtension.maxAmount);
    expect(l.maxDurationDays).toBe(expectedExtension.maxDurationDays);
    expect(l.extensionsAllowed).toBe(expectedExtension.extensionsAllowed);
    expect(l.text).toBe(expectedExtension.limitsText);
  });

  it('a short pilot still allows the 14-day minimum; no amount → no limits', () => {
    const l = extensionLimits(
      DEFAULT_EXTENSION_RULE,
      { amount: '1000.00', currency: 'EUR', durationDays: 20, maxSites: 1 },
      0,
      null,
    )!;
    expect(l.maxDurationDays).toBe(14);
    expect(l.maxAmount).toBe('250.00');
    expect(
      extensionLimits(
        DEFAULT_EXTENSION_RULE,
        { amount: null, currency: null, durationDays: 90, maxSites: null },
        0,
        null,
      ),
    ).toBeNull();
  });

  it('formats one-time money labels', () => {
    expect(formatMoneyShort('400000.00', 'EUR')).toBe('€400k');
    expect(formatMoneyShort('1250.50', 'EUR')).toBe('€1,250.50');
  });
});
