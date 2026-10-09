/**
 * Audit and analytics writers (PRD ME-17, §17). Implements the frozen AuditWriter contract
 * (packages/domain/src/platform/audit) on a Kysely transaction: whatever the business change
 * commits, its audit event and analytics event commit with it, or nothing does.
 *
 * Restricted-text guards (never-rule 8):
 *  - Analytics properties are validated with the strict per-event whitelist (AnalyticsProps); any
 *    extra key is refused. The envelope carries ids, enums and timestamps only.
 *  - Audit `details` accept primitives only, refuse content-like keys (excerpt, passage, body …)
 *    and long strings; the summary is length-bounded. Callers write business summaries such as
 *    "Challenged SRC-021", never source text.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Tx } from './index';
import {
  AnalyticsEnvelope,
  AnalyticsProps,
  DomainEvent,
  type AnalyticsEventName,
} from '@growth-os/contracts';
import type { AuditEntry, AuditWriter } from '@growth-os/domain';

export const AUDIT_SUMMARY_MAX = 280;
export const AUDIT_DETAIL_STRING_MAX = 160;
/** Keys that would carry document content rather than ids, codes or counts. */
export const RESTRICTED_DETAIL_KEYS = [
  'excerpt',
  'passage',
  'passages',
  'quote',
  'snippet',
  'paraphrase',
  'content',
  'body',
  'text',
  'statement',
  'fulltext',
  'summarytext',
] as const;

export class AuditGuardError extends Error {
  constructor(message: string) {
    super(`audit guard: ${message}`);
    this.name = 'AuditGuardError';
  }
}

const HEX64 = /^[0-9a-f]{64}$/;

export function assertAuditEntrySafe(entry: AuditEntry): void {
  if (!entry.summary || entry.summary.length > AUDIT_SUMMARY_MAX)
    throw new AuditGuardError(`summary must be 1–${AUDIT_SUMMARY_MAX} characters`);
  for (const [k, v] of Object.entries(entry.details)) {
    if ((RESTRICTED_DETAIL_KEYS as readonly string[]).includes(k.toLowerCase()))
      throw new AuditGuardError(`details key "${k}" may carry content; store ids, codes or counts`);
    if (v !== null && !['string', 'number', 'boolean'].includes(typeof v))
      throw new AuditGuardError(`details.${k} must be a primitive`);
    if (typeof v === 'string' && v.length > AUDIT_DETAIL_STRING_MAX)
      throw new AuditGuardError(`details.${k} is longer than ${AUDIT_DETAIL_STRING_MAX} characters`);
  }
  for (const h of [entry.beforeHash, entry.afterHash])
    if (h !== null && !HEX64.test(h)) throw new AuditGuardError('hashes must be sha256 hex');
}

/** Audit entry plus write-time options the frozen interface leaves out (seed history, request id). */
export type AuditRecord = AuditEntry & { occurredAt?: Date };

export interface PlatformAuditWriter extends AuditWriter<Tx> {
  record(tx: Tx, entry: AuditRecord): Promise<void>;
  /** Domain events validated by `emit` in this transaction, in order. */
  emitted(tx: Tx): readonly DomainEvent[];
}

export function createAuditWriter(): PlatformAuditWriter {
  const events = new WeakMap<Tx, DomainEvent[]>();
  return {
    async record(tx, entry) {
      assertAuditEntrySafe(entry);
      await tx
        .insertInto('platform.audit_event')
        .values({
          tenant_id: sql<string>`platform.current_tenant_id()`,
          occurred_at: entry.occurredAt ?? sql<Date>`now()`,
          actor_user_id: entry.actorUserId,
          actor_kind: entry.actorKind,
          actor_role: entry.actorRole,
          action: entry.action,
          object_type: entry.objectType,
          object_id: entry.objectId,
          object_version: entry.objectVersion,
          case_id: entry.caseId,
          before_hash: entry.beforeHash,
          after_hash: entry.afterHash,
          summary: entry.summary,
          details: JSON.stringify(entry.details),
          authz_context: JSON.stringify({
            decision: entry.authz.decision,
            rule: entry.authz.rule,
            authorityGrantId: entry.authz.authorityGrantId,
          }),
          correlation_id: sql<string>`coalesce(platform.current_correlation_id(), 'none')`,
          request_id: sql<string>`platform.current_correlation_id()`,
        })
        .execute();
    },

    async emit(tx, event) {
      const parsed = DomainEvent.parse(event);
      const list = events.get(tx) ?? [];
      list.push(parsed);
      events.set(tx, list);
    },

    emitted(tx) {
      return events.get(tx) ?? [];
    },

    async analytics<N extends AnalyticsEventName>(
      tx: Tx,
      name: N,
      envelope: Omit<AnalyticsEnvelope, 'name' | 'eventId'>,
      props: Record<string, unknown>,
    ) {
      const p = AnalyticsProps[name].safeParse(props);
      if (!p.success)
        throw new AuditGuardError(
          `analytics ${name} props outside the PRD §17 whitelist: ${p.error.issues.map((i) => i.path.join('.') || i.message).join(', ')}`,
        );
      const e = AnalyticsEnvelope.strict().safeParse({ ...envelope, name, eventId: randomUUID() });
      if (!e.success) throw new AuditGuardError(`analytics ${name} envelope invalid`);
      const safeProps = p.data;
      const env = e.data;
      await tx
        .insertInto('platform.analytics_event')
        .values({
          id: env.eventId,
          tenant_id: env.tenantId,
          name,
          envelope: JSON.stringify(env),
          props: JSON.stringify(safeProps),
          occurred_at: env.occurredAt,
        })
        .execute();
    },
  };
}

export const auditWriter = createAuditWriter();
