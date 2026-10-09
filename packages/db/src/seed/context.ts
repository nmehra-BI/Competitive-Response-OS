/** Shared seed plumbing: the tenant transaction, id remap and system audit events. */
import { createHash } from 'node:crypto';
import type { Tx } from '../index';
import { auditWriter } from '../audit';
import type { Remap } from './remap';

export interface SeedCtx {
  tx: Tx;
  tenantId: string;
  R: Remap;
  /** Number of audit events written (reported by the CLI). */
  audits: number;
}

export const at = (iso: string): Date => new Date(iso);

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * Seeded history is recorded as system audit events (actor_kind 'system'), dated at the fixture's
 * journey moment, so the History tab shows where the illustrative data came from.
 */
export async function seedAudit(
  s: SeedCtx,
  e: {
    action: string;
    objectType: string;
    objectId: string;
    objectVersion?: number | null;
    caseId?: string | null;
    summary: string;
    occurredAt: string;
    details?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await auditWriter.record(s.tx, {
    actorUserId: null,
    actorKind: 'system',
    actorRole: null,
    action: e.action,
    objectType: e.objectType,
    objectId: e.objectId,
    objectVersion: e.objectVersion ?? null,
    caseId: e.caseId ?? null,
    beforeHash: null,
    afterHash: null,
    summary: e.summary,
    details: { illustrative: true, ...e.details },
    authz: { decision: 'allow', rule: 'seed', authorityGrantId: null },
    occurredAt: at(e.occurredAt),
  });
  s.audits++;
}
