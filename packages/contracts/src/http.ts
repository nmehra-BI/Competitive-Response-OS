/**
 * FROZEN HTTP conventions: headers, pagination, list envelopes.
 */
import { z } from 'zod';

export const HEADERS = {
  /** Required on every command that creates, decides or sends. UUID chosen by the client. */
  idempotencyKey: 'Idempotency-Key',
  /** Required on draft writes. Value is the quoted row version from the last ETag. */
  ifMatch: 'If-Match',
  etag: 'ETag',
  /** Optional on requests; always on responses. Propagated to jobs, connector and provider calls. */
  correlationId: 'X-Correlation-Id',
} as const;

export const API_PREFIX = '/api/v1';

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;

/** Cursor pagination envelope. `nextCursor` is opaque. Totals are never returned for filtered sets. */
export function Page<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

/** Scope label for any list or aggregate filtered by access (research §8, PRD S01). */
export const AccessScope = z.object({
  label: z.string(), // e.g. "Showing BU Water · cases you can access · hidden cases are not counted"
  partial: z.boolean(),
});
export type AccessScope = z.infer<typeof AccessScope>;

/** Data-source health for a screen (S01 error state). */
export const DataSourceHealth = z.object({
  key: z.string(),
  name: z.string(),
  available: z.boolean(),
  lastRefreshedAt: z.string().datetime({ offset: true }).nullable(),
  message: z.string().nullable(),
});
export type DataSourceHealth = z.infer<typeof DataSourceHealth>;

export const EmptyResponse = z.object({}).strict();
