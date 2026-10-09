/** Problem-details errors (contracts/errors.ts). Handlers throw ApiError; the server serializes it. */
import {
  ERROR_HTTP_STATUS,
  type Blocker,
  type ErrorCode,
  type FieldError,
  type ProblemDetails,
} from '@growth-os/contracts';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: { errors?: FieldError[]; blockers?: Blocker[]; checks?: ProblemDetails['checks'] } = {},
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
