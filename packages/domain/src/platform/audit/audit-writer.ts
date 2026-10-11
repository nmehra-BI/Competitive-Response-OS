/**
 * Audit and analytics writing contract (PRD ME-17, §17).
 *
 * Implemented in apps/api (and apps/worker) on top of a transaction: the same `Tx` that changes
 * state writes the audit event, the analytics event (validated against AnalyticsProps) and any
 * outbox rows. If the transaction rolls back, nothing is recorded; if it commits, all are.
 */
import type {
  AnalyticsEnvelope,
  AnalyticsEventName,
  DomainEvent,
  PrincipalKind,
  RoleCode,
} from '@growth-os/contracts';

export interface AuditEntry {
  actorUserId: string | null;
  actorKind: PrincipalKind | 'system';
  actorRole: RoleCode | null;
  action: string; // domain event type, e.g. "gate.decided"
  objectType: string;
  objectId: string;
  objectVersion: number | null;
  caseId: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  /** Human-readable. Never restricted source text, account details or confidential inputs. */
  summary: string;
  details: Record<string, string | number | boolean | null>;
  authz: { decision: 'allow' | 'deny'; rule: string; authorityGrantId: string | null };
}

export interface AuditWriter<Tx> {
  /** Append one audit event. Must be called inside the state-changing transaction. */
  record(tx: Tx, entry: AuditEntry): Promise<void>;
  /** Append a domain event (feeds projections and workers). */
  emit(tx: Tx, event: DomainEvent): Promise<void>;
  /** Validate props against AnalyticsProps[name] (strict) and append to the analytics outbox. */
  analytics<N extends AnalyticsEventName>(
    tx: Tx,
    name: N,
    envelope: Omit<AnalyticsEnvelope, 'name' | 'eventId'>,
    props: Record<string, unknown>,
  ): Promise<void>;
}
