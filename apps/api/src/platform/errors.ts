/**
 * Problem-details errors (contracts/errors.ts, API.md §4). Handlers throw ApiError; `toApiError`
 * maps everything else (Zod, Fastify, Postgres guard triggers) to the frozen error codes. Messages
 * from the database are never echoed: they can contain values.
 */
import { ZodError } from 'zod';
import {
  ERROR_HTTP_STATUS,
  type Blocker,
  type ErrorCode,
  type FieldError,
  type ProblemDetails,
} from '@growth-os/contracts';
import { guardErrorCode } from '@growth-os/db';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: {
      errors?: FieldError[];
      blockers?: Blocker[];
      checks?: ProblemDetails['checks'];
      detail?: string;
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }

  toProblem(correlationId: string, instance?: string): ProblemDetails {
    return {
      type: `https://growth-os.example/problems/${this.code.toLowerCase()}`,
      title: this.message,
      status: this.status,
      code: this.code,
      correlationId,
      instance,
      ...this.extra,
    };
  }
}

export const notImplemented = (operationId: string): ApiError =>
  new ApiError('INTERNAL', `Not implemented yet: ${operationId}`);

/** 404 for anything missing or not visible to the caller (never 403: no existence leak). */
export const notFound = (): ApiError => new ApiError('NOT_FOUND', 'Not found');

export const forbidden = (message = 'You do not have permission to do this.'): ApiError =>
  new ApiError('FORBIDDEN', message);

export function zodFieldErrors(err: ZodError, prefix = ''): FieldError[] {
  return err.issues.map((i) => ({
    path: [prefix, ...i.path.map(String)].filter(Boolean).join('.'),
    code: i.code,
    message: i.message,
  }));
}

const GUARD_TITLES: Record<string, string> = {
  SNAPSHOT_STALE: 'This snapshot is out of date. Refresh it before deciding.',
  INVALID_TRANSITION: 'This action is not possible in the current state.',
  AGENT_IDENTITY_FORBIDDEN: 'This action needs a person signed in interactively.',
  SELF_APPROVAL_PROHIBITED: 'You authored this package and cannot approve it.',
  AUTHORITY_INSUFFICIENT: 'You do not hold delegated authority for this decision.',
};

interface PgLikeError {
  code?: string;
  message?: string;
}

/** Map any thrown value to an ApiError. Unknown errors become INTERNAL without details. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof ZodError) {
    return new ApiError('VALIDATION_FAILED', 'Request validation failed', { errors: zodFieldErrors(err) });
  }
  const e = err as PgLikeError & { statusCode?: number; validation?: unknown };
  if (e && typeof e === 'object') {
    if (e.validation) return new ApiError('VALIDATION_FAILED', 'Request validation failed');
    if (typeof e.code === 'string' && e.code.startsWith('FST_')) {
      if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.statusCode === 413)
        return new ApiError('VALIDATION_FAILED', 'The file is too large');
      if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500)
        return new ApiError('VALIDATION_FAILED', 'The request could not be read');
    }
    const guard = guardErrorCode(err);
    if (guard) return new ApiError(guard as ErrorCode, GUARD_TITLES[guard] ?? 'Request refused');
    // insufficient_privilege: append-only and committed-version triggers, revoked UPDATE/DELETE.
    if (e.code === '42501')
      return new ApiError('INVALID_TRANSITION', 'This record is immutable. Create a new version instead.');
    if (e.code === '23505')
      return new ApiError('INVALID_TRANSITION', 'This conflicts with an existing record.');
  }
  return new ApiError('INTERNAL', 'Unexpected error');
}
