/** Unit tests for the pure parts of the platform runtime (no database). */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { RoleAssignment, RoleCode } from '@growth-os/contracts';
import type { PolicySubject } from '@growth-os/domain';
import { canReadCase, roleAllows } from './authz';
import { ApiError, toApiError } from './errors';
import { sha256Hex, stableStringify } from './hash';
import { landingFor } from './identity';
import { parseIfMatch } from './pipeline';

const BU = '00000000-0000-4000-8000-0000000000b1';
const OTHER_BU = '00000000-0000-4000-8000-0000000000b2';
const role = (r: RoleCode, businessUnitId: string | null = BU): RoleAssignment => ({
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-0000000000a1',
  role: r,
  businessUnitId,
  caseId: null,
  grantedBy: '00000000-0000-4000-8000-0000000000a9',
  grantedAt: '2026-01-01T00:00:00.000Z',
  revokedAt: null,
});
const subject = (roles: RoleAssignment[], kind: 'human' | 'agent' = 'human'): PolicySubject => ({
  actor:
    kind === 'human'
      ? { kind, userId: '00000000-0000-4000-8000-0000000000a1', interactive: true }
      : { kind, userId: '00000000-0000-4000-8000-0000000000a1' },
  roles,
  authority: [],
  participantOfCaseIds: [],
});

describe('error model', () => {
  it('maps Zod errors to VALIDATION_FAILED with paths', () => {
    const r = z.object({ a: z.number() }).safeParse({ a: 'x' });
    const e = toApiError(r.success ? null : r.error);
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.extra.errors?.[0]?.path).toBe('a');
  });

  it('maps database guard messages to their codes without echoing the message', () => {
    const e = toApiError(new Error('SELF_APPROVAL_PROHIBITED: package author cannot approve'));
    expect(e.code).toBe('SELF_APPROVAL_PROHIBITED');
    expect(e.status).toBe(403);
    expect(e.message).toBe('You authored this package and cannot approve it.');
  });

  it('maps immutable-row and unique violations to 409 and hides unknown errors', () => {
    expect(toApiError(Object.assign(new Error('x'), { code: '42501' })).code).toBe('INVALID_TRANSITION');
    expect(toApiError(Object.assign(new Error('x'), { code: '23505' })).code).toBe('INVALID_TRANSITION');
    const internal = toApiError(new Error('password=hunter2'));
    expect(internal.code).toBe('INTERNAL');
    expect(internal.message).not.toContain('hunter2');
  });

  it('serializes problem details', () => {
    const p = new ApiError('NOT_FOUND', 'Not found').toProblem('corr', '/api/v1/x');
    expect(p).toMatchObject({ status: 404, code: 'NOT_FOUND', correlationId: 'corr', instance: '/api/v1/x' });
  });
});

describe('If-Match parsing', () => {
  it.each([
    ['"7"', 7],
    ['7', 7],
    ['W/"12"', 12],
  ])('%s → %d', (h, v) => expect(parseIfMatch(h)).toBe(v));
  it('rejects garbage and passes through absence', () => {
    expect(() => parseIfMatch('"abc"')).toThrow(ApiError);
    expect(parseIfMatch(undefined)).toBeNull();
  });
});

describe('stable request hashing', () => {
  it('ignores key order and undefined values', () => {
    expect(stableStringify({ b: 1, a: [1, { d: undefined, c: 2 }] })).toBe('{"a":[1,{"c":2}],"b":1}');
    expect(sha256Hex(stableStringify({ x: 1, y: 2 }))).toBe(sha256Hex(stableStringify({ y: 2, x: 1 })));
  });
});

describe('baseline authorization', () => {
  it('allows by role table within the business unit and records the role', () => {
    const d = roleAllows(subject([role('case_owner')]), 'mandate.edit', { businessUnitId: BU, caseId: null });
    expect(d).toMatchObject({ allow: true, role: 'case_owner' });
    const other = roleAllows(subject([role('case_owner')]), 'mandate.edit', {
      businessUnitId: OTHER_BU,
      caseId: null,
    });
    expect(other).toMatchObject({ allow: false, code: 'FORBIDDEN' });
  });

  it('never lets an admin decide gates or a sponsor configure the tenant', () => {
    expect(roleAllows(subject([role('tenant_admin', null)]), 'gate.decide').allow).toBe(false);
    expect(roleAllows(subject([role('sponsor')]), 'admin.configure').allow).toBe(false);
  });

  it('limits agents to their allowed read actions', () => {
    expect(roleAllows(subject([], 'agent'), 'source.read_excerpt').allow).toBe(true);
    expect(roleAllows(subject([], 'agent'), 'gate.decide')).toMatchObject({
      allow: false,
      code: 'AGENT_IDENTITY_FORBIDDEN',
    });
  });

  it('turns FORBIDDEN into NOT_FOUND for hidden resources', () => {
    expect(roleAllows(subject([]), 'case.read', undefined, { hidden: true })).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('case visibility follows business unit scope, ownership and participation', () => {
    const c = {
      id: '00000000-0000-4000-8000-0000000000c1',
      businessUnitId: OTHER_BU,
      ownerUserId: 'x',
      sponsorUserId: 'y',
    };
    expect(canReadCase(subject([role('sponsor')]), c)).toBe(false);
    expect(canReadCase(subject([role('sponsor', null)]), c)).toBe(true);
    expect(canReadCase({ ...subject([]), participantOfCaseIds: [c.id] }, c)).toBe(true);
    expect(canReadCase(subject([role('tenant_admin', null)]), c)).toBe(false);
  });
});

describe('landing routes', () => {
  it('follows the persona order of precedence', () => {
    expect(landingFor([role('pilot_owner'), role('commercial_reviewer')])).toBe('/my-work');
    expect(landingFor([role('tenant_admin', null)])).toBe('/admin/health');
    expect(landingFor([])).toBe('/me/overview');
  });
});
