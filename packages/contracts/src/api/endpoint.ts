/**
 * Endpoint definition helper. Every route the API serves is declared once in this package with
 * its schemas, the screen(s) that call it and the PRD requirement(s) it serves. The API registers
 * routes from these definitions; the web client is generated from them; tests assert coverage.
 */
import { z } from 'zod';
import { DisplayKey, Id } from '../primitives';

export const ScreenId = z.enum([
  'LOGIN',
  'SHELL',
  'S01',
  'S02',
  'S03',
  'S04',
  'S05',
  'S06',
  'S07',
  'S08',
  'S09',
  'S10',
  'BRIEF',
  'S11',
  'S12',
  'S13',
  'S14',
  'MYWORK',
  'REVIEWS',
  'SEARCH',
  'WORKER',
]);
export type ScreenId = z.infer<typeof ScreenId>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface EndpointDef<
  P extends z.ZodTypeAny = z.ZodTypeAny,
  Q extends z.ZodTypeAny = z.ZodTypeAny,
  B extends z.ZodTypeAny = z.ZodTypeAny,
  R extends z.ZodTypeAny = z.ZodTypeAny,
> {
  /** Stable operation id, e.g. "gates.decide". Never renamed after freeze. */
  id: string;
  method: HttpMethod;
  /** Path under /api/v1 with :params. */
  path: string;
  summary: string;
  screens: ScreenId[];
  prd: string[];
  /** `session` = any signed-in human or service; `human` = interactive human session only. */
  auth: 'none' | 'session' | 'human' | 'dev_only';
  /** Idempotency-Key header required. */
  idempotent: boolean;
  /** If-Match header required (optimistic concurrency on drafts). */
  ifMatch: boolean;
  params: P;
  query: Q;
  body: B;
  response: R;
  successStatus: 200 | 201 | 202 | 204;
}

const none = z.object({}).strict();

export function endpoint<
  P extends z.ZodTypeAny = typeof none,
  Q extends z.ZodTypeAny = typeof none,
  B extends z.ZodTypeAny = typeof none,
  R extends z.ZodTypeAny = z.ZodTypeAny,
>(def: {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  screens: ScreenId[];
  prd: string[];
  auth?: EndpointDef['auth'];
  idempotent?: boolean;
  ifMatch?: boolean;
  params?: P;
  query?: Q;
  body?: B;
  response: R;
  successStatus?: EndpointDef['successStatus'];
}): EndpointDef<P, Q, B, R> {
  return {
    auth: 'session',
    idempotent: false,
    ifMatch: false,
    successStatus: def.method === 'POST' ? 201 : 200,
    params: none as unknown as P,
    query: none as unknown as Q,
    body: none as unknown as B,
    ...def,
  } as EndpointDef<P, Q, B, R>;
}

/** Path reference: a UUID or a per-tenant display key (deep links use keys such as ME-104). */
export const Ref = z.union([Id, DisplayKey]);
export type Ref = z.infer<typeof Ref>;

export const CaseParams = z.object({ caseRef: Ref });
export const IdParams = z.object({ id: Id });
export const RefParams = z.object({ ref: Ref });

/** Common body for commands that need a human reason. */
export const Rationale = z.object({ rationale: z.string().min(1) });

/** Accepted command response for async work. */
export const Accepted = z.object({ accepted: z.literal(true), jobId: z.string().nullable() });
