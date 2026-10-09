/**
 * Request context and the command pipeline every write handler follows (ARCHITECTURE.md §6).
 *
 *   1. authenticate (session cookie → user, tenant, interactive flag)
 *   2. validate params/query/body with the endpoint's Zod schemas (400 VALIDATION_FAILED)
 *   3. idempotency: Idempotency-Key required where the endpoint says so (428); replay stored response
 *   4. If-Match on draft writes (412 VERSION_CONFLICT)
 *   5. withTenant(tx): load resource facts → PolicyEngine.check → domain decision (state machine /
 *      engine) → write state + audit + analytics + outbox rows → commit
 *   6. respond with the endpoint's response schema (validated in dev/test)
 */
import type { Actor, PolicySubject } from '@growth-os/domain';

export interface RequestContext {
  tenantId: string;
  userId: string;
  sessionId: string;
  actor: Actor;
  subject: PolicySubject;
  correlationId: string;
  idempotencyKey: string | null;
  ifMatch: number | null;
}

export interface SessionResolver {
  /** Returns null when the cookie is missing, unknown, expired or revoked. */
  resolve(
    cookieToken: string | undefined,
  ): Promise<Omit<RequestContext, 'correlationId' | 'idempotencyKey' | 'ifMatch'> | null>;
}

export interface IdempotencyStore {
  /** Start or replay. Same key + different request hash → IDEMPOTENCY_KEY_REUSED. */
  begin(ctx: {
    tenantId: string;
    userId: string;
    key: string;
    method: string;
    route: string;
    requestHash: string;
  }): Promise<{ kind: 'new' } | { kind: 'replay'; status: number; body: unknown } | { kind: 'in_progress' }>;
  complete(ctx: {
    tenantId: string;
    userId: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void>;
}
