import { describe, expect, it } from 'vitest';
import { displayDate, localDate, planApprovalExpiry, planPilotWindow, type ExpiryCandidate } from './plan';

const TZ = 'Europe/Berlin';
// Aster fixture values (fixtures/aster: gates.g2, journeyMoments); the worker does not depend on the fixture.
const gates = {
  g2: {
    id: 'a57e0015-0000-4000-8000-000000000003',
    expiresAt: '2026-12-11T23:59:00+01:00',
    windowEnd: '2027-02-28',
  },
};
const journeyMoments = { specialistSigned: '2026-11-23T11:05:00+01:00' };
const g2: ExpiryCandidate = {
  gateRequestId: gates.g2.id,
  caseId: 'case-104',
  gateCode: 'G2',
  status: 'approved_with_conditions',
  expiresAt: gates.g2.expiresAt, // 11 Dec 2026 23:59 CET
  executed: false,
  effectiveApprovalIds: ['appr-1'],
};

describe('planApprovalExpiry', () => {
  it('expires an unused approval after expires_at', () => {
    const p = planApprovalExpiry([g2], '2026-12-12T00:00:00+01:00', TZ);
    expect(p.skipped).toEqual([]);
    expect(p.expire).toEqual([
      {
        gateRequestId: gates.g2.id,
        caseId: 'case-104',
        gateCode: 'G2',
        from: 'approved_with_conditions',
        to: 'expired',
        approvalIds: ['appr-1'],
        auditAction: 'gate.approval_expired',
        reason: 'Approval expired unused (expiry 11 Dec 2026)',
      },
    ]);
  });

  it('returns a pilot-approved case to Pilot approval pending when G2 expires (D-035)', () => {
    const p = planApprovalExpiry([{ ...g2, caseStage: 'pilot_approved' }], '2026-12-12T00:00:00+01:00', TZ);
    expect(p.expire[0]?.caseMove).toEqual({
      from: 'pilot_approved',
      to: 'pilot_approval_pending',
      auditAction: 'case.stage_changed',
    });
    // Any other stage: the gate expires, the case machine refuses the move, nothing else changes.
    const q = planApprovalExpiry([{ ...g2, caseStage: 'validation' }], '2026-12-12T00:00:00+01:00', TZ);
    expect(q.expire[0]?.to).toBe('expired');
    expect(q.expire[0]?.caseMove).toBeUndefined();
  });

  it('does not expire before expires_at', () => {
    const p = planApprovalExpiry([g2], '2026-12-11T23:58:59+01:00', TZ);
    expect(p.expire).toEqual([]);
    expect(p.skipped[0]?.reasons).toEqual(['The approval has not reached its expiry time.']);
  });

  it('never expires an approval that was already used (Jonas activated the pilot on 1 Dec)', () => {
    const p = planApprovalExpiry([{ ...g2, executed: true }], '2026-12-20T00:00:00+01:00', TZ);
    expect(p.expire).toEqual([]);
  });

  it('ignores gates that are not approved (awaiting, invalidated, already expired)', () => {
    const now = '2026-12-20T00:00:00+01:00';
    for (const status of ['awaiting_decision', 'invalidated', 'expired', 'stale'] as const) {
      expect(planApprovalExpiry([{ ...g2, status }], now, TZ).expire).toEqual([]);
    }
  });

  it('fails closed on a missing expiry', () => {
    expect(planApprovalExpiry([{ ...g2, expiresAt: null }], '2027-01-01T00:00:00Z', TZ).expire).toEqual([]);
  });
});

describe('planPilotWindow', () => {
  const pilot = { caseId: 'case-104', stage: 'pilot_running' as const, windowEnd: gates.g2.windowEnd };

  it('keeps the pilot running through the last day of the window (28 Feb 2027, Berlin)', () => {
    expect(planPilotWindow([pilot], [], '2027-02-28T22:59:00Z', TZ).advance).toEqual([]);
  });

  it('moves pilot_running → review_due after the window ends (Berlin midnight)', () => {
    const p = planPilotWindow([pilot], [], '2027-02-28T23:00:00Z', TZ); // 00:00 on 1 Mar in Berlin
    expect(p.advance).toEqual([
      {
        caseId: 'case-104',
        from: 'pilot_running',
        to: 'review_due',
        windowEnd: '2027-02-28',
        auditAction: 'case.stage_changed',
      },
    ]);
  });

  it('only running pilots move (on hold, review due or pending cases are left alone)', () => {
    const now = '2027-03-02T09:00:00+01:00';
    for (const stage of ['on_hold', 'review_due', 'pilot_approved', 'pilot_approval_pending'] as const) {
      expect(planPilotWindow([{ ...pilot, stage }], [], now, TZ).advance).toEqual([]);
    }
  });

  it('flags running experiments past their window; never changes them', () => {
    const p = planPilotWindow(
      [],
      [
        { experimentId: 'exp-03', caseId: 'c', lifecycle: 'running', windowEnd: '2026-11-20' },
        { experimentId: 'exp-04', caseId: 'c', lifecycle: 'result_recorded', windowEnd: '2026-11-20' },
        { experimentId: 'exp-05', caseId: 'c', lifecycle: 'running', windowEnd: '2026-11-30' },
      ],
      journeyMoments.specialistSigned, // 23 Nov 2026
      TZ,
    );
    expect(p.overdueExperiments).toEqual([{ experimentId: 'exp-03', caseId: 'c', windowEnd: '2026-11-20' }]);
  });
});

describe('dates', () => {
  it('computes tenant-local dates', () => {
    expect(localDate('2026-12-11T23:30:00Z', TZ)).toBe('2026-12-12');
    expect(displayDate('2026-12-11T23:59:00+01:00', TZ)).toBe('11 Dec 2026');
  });
});
