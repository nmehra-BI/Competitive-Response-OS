/**
 * FROZEN audit record (PRD ME-17). Append-only. Every state change, evidence correction,
 * approval and external write produces exactly one audit event in the same transaction.
 */
import { z } from 'zod';
import { PrincipalKind, RoleCode } from '../enums';
import { Id, IsoDateTime, PersonRef, Sha256Hex } from '../primitives';

export const AuditEvent = z.object({
  id: Id,
  seq: z.number().int().positive(), // global insertion order
  occurredAt: IsoDateTime,
  actor: PersonRef.nullable(), // null for system timers
  actorKind: PrincipalKind.or(z.literal('system')),
  actorRole: RoleCode.nullable(),
  action: z.string(), // "gate.decided", "assumption.version_created", "external_task.confirmed"
  objectType: z.string(),
  objectId: Id,
  objectVersion: z.number().int().nullable(),
  caseId: Id.nullable(),
  beforeHash: Sha256Hex.nullable(),
  afterHash: Sha256Hex.nullable(),
  summary: z.string(), // human-readable, no restricted text or confidential values
  authzContext: z.object({
    decision: z.enum(['allow', 'deny']),
    rule: z.string(),
    authorityGrantId: Id.nullable(),
  }),
  correlationId: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

/** Activity timeline item (shared component). Built from audit events plus comments. */
export const ActivityItem = z.object({
  id: Id,
  at: IsoDateTime,
  actor: PersonRef.nullable(),
  title: z.string(), // "Disputed 20% adoption"
  detail: z.string().nullable(), // "Economics v2"
  keyDecision: z.boolean(),
  href: z.string().nullable(),
});
export type ActivityItem = z.infer<typeof ActivityItem>;

export const Comment = z.object({
  id: Id,
  caseId: Id,
  targetType: z.string(),
  targetId: Id,
  author: PersonRef,
  body: z.string(),
  createdAt: IsoDateTime,
});
export type Comment = z.infer<typeof Comment>;
