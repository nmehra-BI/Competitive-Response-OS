import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '@growth-os/domain';
import { assertAuditEntrySafe, AuditGuardError, AUDIT_SUMMARY_MAX } from './audit';

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  actorUserId: null,
  actorKind: 'system',
  actorRole: null,
  action: 'source.challenged',
  objectType: 'source',
  objectId: '00000000-0000-4000-8000-000000000001',
  objectVersion: null,
  caseId: null,
  beforeHash: null,
  afterHash: null,
  summary: 'Challenged SRC-021',
  details: { sourceKey: 'SRC-021', count: 2, restricted: false },
  authz: { decision: 'allow', rule: 'test', authorityGrantId: null },
  ...over,
});

describe('audit restricted-text guard', () => {
  it('accepts ids, codes, counts and flags', () => {
    expect(() => assertAuditEntrySafe(entry())).not.toThrow();
  });

  it.each(['excerpt', 'passage', 'body', 'statement', 'Text', 'content'])(
    'refuses the content-like key %s',
    (key) => {
      expect(() => assertAuditEntrySafe(entry({ details: { [key]: 'licensed words' } }))).toThrow(
        AuditGuardError,
      );
    },
  );

  it('refuses long strings and non-primitive values', () => {
    expect(() => assertAuditEntrySafe(entry({ details: { note: 'x'.repeat(161) } }))).toThrow(
      AuditGuardError,
    );
    expect(() => assertAuditEntrySafe(entry({ details: { nested: { a: 1 } as unknown as string } }))).toThrow(
      AuditGuardError,
    );
  });

  it('bounds the summary and checks hash format', () => {
    expect(() => assertAuditEntrySafe(entry({ summary: '' }))).toThrow(AuditGuardError);
    expect(() => assertAuditEntrySafe(entry({ summary: 'x'.repeat(AUDIT_SUMMARY_MAX + 1) }))).toThrow(
      AuditGuardError,
    );
    expect(() => assertAuditEntrySafe(entry({ afterHash: 'not-a-hash' }))).toThrow(AuditGuardError);
    expect(() => assertAuditEntrySafe(entry({ afterHash: 'a'.repeat(64) }))).not.toThrow();
  });
});
