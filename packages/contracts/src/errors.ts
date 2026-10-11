/**
 * FROZEN error model: RFC 9457 problem details with a stable `code`.
 *
 * Rule: a resource the caller may not see returns 404 NOT_FOUND, not 403, so hidden cases,
 * sources and counts never leak (PRD S01 restricted state, ME-16).
 */
import { z } from 'zod';
import { GateCode } from './enums';

export const ErrorCode = z.enum([
  'VALIDATION_FAILED', // 400 request body or query failed schema validation
  'UNAUTHENTICATED', // 401 no or expired session
  'FORBIDDEN', // 403 authenticated, visible resource, action not allowed for this role
  'NOT_FOUND', // 404 missing or not visible to the caller
  'AGENT_IDENTITY_FORBIDDEN', // 403 service or agent principal tried a human-only action
  'AUTHORITY_INSUFFICIENT', // 403 no delegated authority for gate, business unit or amount
  'SELF_APPROVAL_PROHIBITED', // 403 package author or case owner tried to decide their own gate
  'CONFLICT_OF_INTEREST', // 403 policy marks the reviewer as conflicted
  'RESTRICTED_SOURCE', // 403 source exists in a visible case but the licence excludes the caller; no content
  'INVALID_TRANSITION', // 409 state machine rejects the command in the current state
  'PRECONDITIONS_UNMET', // 409 gate or activation preconditions are not met; `blockers` lists them
  'SNAPSHOT_STALE', // 409 snapshot inputs changed; approval disabled until refreshed
  'SNAPSHOT_HASH_MISMATCH', // 409 the decided hash differs from the current snapshot hash
  'APPROVAL_INVALIDATED', // 409 the approval no longer applies (material change)
  'APPROVAL_EXPIRED', // 409 the approval expired unused
  'VERSION_CONFLICT', // 412 If-Match did not match the current row version
  'PRECONDITION_REQUIRED', // 428 If-Match or Idempotency-Key header missing where required
  'CALCULATION_BLOCKED', // 422 deterministic engine blocking check failed; `checks` lists them
  'IDEMPOTENCY_KEY_REUSED', // 422 same key used with a different request body
  'IDEMPOTENCY_IN_PROGRESS', // 409 first request with this key is still running
  'BUDGET_EXHAUSTED', // 409 analysis run budget reached
  'CONNECTOR_UNAVAILABLE', // 503 task tool or source connection not usable
  'RATE_LIMITED', // 429
  'INTERNAL', // 500
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  AGENT_IDENTITY_FORBIDDEN: 403,
  AUTHORITY_INSUFFICIENT: 403,
  SELF_APPROVAL_PROHIBITED: 403,
  CONFLICT_OF_INTEREST: 403,
  RESTRICTED_SOURCE: 403,
  INVALID_TRANSITION: 409,
  PRECONDITIONS_UNMET: 409,
  SNAPSHOT_STALE: 409,
  SNAPSHOT_HASH_MISMATCH: 409,
  APPROVAL_INVALIDATED: 409,
  APPROVAL_EXPIRED: 409,
  VERSION_CONFLICT: 412,
  PRECONDITION_REQUIRED: 428,
  CALCULATION_BLOCKED: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  IDEMPOTENCY_IN_PROGRESS: 409,
  BUDGET_EXHAUSTED: 409,
  CONNECTOR_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  INTERNAL: 500,
});

export const FieldError = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});
export type FieldError = z.infer<typeof FieldError>;

/** A precondition or blocking item, rendered as the "Why?" list (gates, activation, scale). */
export const Blocker = z.object({
  key: z.string(),
  message: z.string(),
  gate: GateCode.optional(),
  ownerId: z.string().uuid().optional(),
  href: z.string().optional(),
});
export type Blocker = z.infer<typeof Blocker>;

export const ProblemDetails = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.number().int(),
  code: ErrorCode,
  detail: z.string().optional(),
  instance: z.string().optional(),
  correlationId: z.string(),
  errors: z.array(FieldError).optional(),
  blockers: z.array(Blocker).optional(),
  checks: z.array(z.object({ key: z.string(), message: z.string(), blocking: z.boolean() })).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;
