import { describe, expect, it } from 'vitest';
import {
  approvalEffectiveness,
  defaultBackoffMs,
  ERROR_CODE_BY_KIND,
  mayStillSend,
  type GateFacts,
} from './policy';

const now = new Date('2026-12-01T10:00:00Z');
const gate = (over: Partial<GateFacts> = {}): GateFacts => ({
  status: 'approved_with_conditions',
  expiresAt: '2026-12-11T10:00:00Z',
  hasEffectiveApproval: true,
  hasExpiredInvalidation: false,
  hasInvalidation: false,
  executed: false,
  ...over,
});

describe('approvalEffectiveness (send-time re-check)', () => {
  it('effective while approved, unexpired and not invalidated', () => {
    expect(approvalEffectiveness(gate(), now)).toBe('effective');
    expect(approvalEffectiveness(gate({ status: 'approved', expiresAt: null }), now)).toBe('effective');
  });

  it('invalidated and expired gates stop sends', () => {
    expect(approvalEffectiveness(gate({ status: 'invalidated' }), now)).toBe('invalidated');
    expect(approvalEffectiveness(gate({ status: 'expired' }), now)).toBe('expired');
    expect(
      approvalEffectiveness(
        gate({ hasEffectiveApproval: false, hasInvalidation: true, hasExpiredInvalidation: true }),
        now,
      ),
    ).toBe('expired');
    expect(approvalEffectiveness(gate({ hasEffectiveApproval: false, hasInvalidation: true }), now)).toBe(
      'invalidated',
    );
  });

  it('past expiry and unused is expired even before the timer ran; once used it never expires', () => {
    const past = { expiresAt: '2026-11-30T10:00:00Z' };
    expect(approvalEffectiveness(gate(past), now)).toBe('expired');
    expect(approvalEffectiveness(gate({ ...past, executed: true }), now)).toBe('effective');
  });

  it('missing approval fails closed', () => {
    expect(approvalEffectiveness(null, now)).toBe('missing');
    expect(
      approvalEffectiveness(gate({ status: 'awaiting_decision', hasEffectiveApproval: false }), now),
    ).toBe('missing');
  });
});

describe('mayStillSend', () => {
  const scope = { businessUnitId: 'bu-1', caseId: 'case-1' };
  it('needs an unrevoked role with task_sync.send in scope', () => {
    expect(
      mayStillSend([{ role: 'pilot_owner', businessUnitId: 'bu-1', caseId: null, revokedAt: null }], scope),
    ).toBe(true);
    expect(
      mayStillSend([{ role: 'pilot_owner', businessUnitId: 'bu-2', caseId: null, revokedAt: null }], scope),
    ).toBe(false);
    expect(
      mayStillSend(
        [{ role: 'pilot_owner', businessUnitId: 'bu-1', caseId: null, revokedAt: '2026-11-30T00:00:00Z' }],
        scope,
      ),
    ).toBe(false);
    expect(
      mayStillSend([{ role: 'case_owner', businessUnitId: 'bu-1', caseId: null, revokedAt: null }], scope),
    ).toBe(false);
  });
});

describe('backoff and error codes', () => {
  it('doubles from 30 s, caps at 15 min and honours Retry-After', () => {
    expect([1, 2, 3, 4].map((n) => defaultBackoffMs(n))).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(defaultBackoffMs(20)).toBe(15 * 60_000);
    expect(defaultBackoffMs(1, 90_000)).toBe(90_000);
  });

  it('stores the contract error codes', () => {
    expect(ERROR_CODE_BY_KIND.timeout_ambiguous).toBe('timeout');
    expect(ERROR_CODE_BY_KIND.transient).toBe('http_5xx');
    expect(ERROR_CODE_BY_KIND.permission_denied).toBe('permission_denied');
    expect(ERROR_CODE_BY_KIND.token_expired).toBe('token_expired');
  });
});
