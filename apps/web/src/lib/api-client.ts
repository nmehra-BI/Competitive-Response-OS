/**
 * Typed API client generated from the frozen endpoint registry. Screens call
 * `api(API.gates.decide, { params, body, idempotencyKey })` and get the parsed response type.
 * Responses are validated with the endpoint's Zod schema in development (and therefore against
 * the MSW mocks too, so a mock that drifts from the contract fails loudly).
 */
import { API_PREFIX, HEADERS, ProblemDetails, type EndpointDef } from '@growth-os/contracts';
import type { z } from 'zod';

export class ApiProblem extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.title);
    this.name = 'ApiProblem';
  }
  get code() {
    return this.problem.code;
  }
  get status() {
    return this.problem.status;
  }
}

export interface CallOptions<P, Q, B> {
  params?: P;
  query?: Q;
  body?: B;
  /** Required for endpoints with `idempotent: true`. Generate once per user intent (not per retry). */
  idempotencyKey?: string;
  /** Required for endpoints with `ifMatch: true`: the row version from the last read. */
  ifMatch?: number;
  signal?: AbortSignal;
}

export type ApiParams<D extends EndpointDef> = z.input<D['params']>;
export type ApiQuery<D extends EndpointDef> = z.input<D['query']>;
export type ApiBody<D extends EndpointDef> = z.input<D['body']>;
export type ApiResponse<D extends EndpointDef> = z.output<D['response']>;

/** Build the request path for an endpoint: `/api/v1/me/cases/ME-104?x=1`. */
export function buildPath(def: EndpointDef, params?: unknown, query?: unknown): string {
  const path = def.path.replace(/:(\w+)/g, (_, k: string) =>
    encodeURIComponent(String((params as Record<string, unknown> | undefined)?.[k] ?? '')),
  );
  const entries = Object.entries((query as Record<string, unknown> | undefined) ?? {}).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  const qs = entries.length
    ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`
    : '';
  return `${API_PREFIX}${path}${qs}`;
}

function absolute(url: string): string {
  // Node (tests) cannot fetch relative URLs; browsers resolve against the page origin.
  const origin =
    typeof location !== 'undefined' && location.origin !== 'null' ? location.origin : 'http://localhost';
  return new URL(url, origin).toString();
}

function synthProblem(status: number, title: string): ApiProblem {
  return new ApiProblem({
    type: 'about:blank',
    title,
    status,
    code: status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL',
    correlationId: 'client',
  });
}

export async function api<D extends EndpointDef>(
  def: D,
  opts: CallOptions<ApiParams<D>, ApiQuery<D>, ApiBody<D>> = {},
): Promise<ApiResponse<D>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (def.idempotent) {
    if (!opts.idempotencyKey) throw new Error(`${def.id} requires an Idempotency-Key`);
    headers[HEADERS.idempotencyKey] = opts.idempotencyKey;
  }
  if (def.ifMatch) {
    if (opts.ifMatch === undefined) throw new Error(`${def.id} requires If-Match`);
    headers[HEADERS.ifMatch] = `"${opts.ifMatch}"`;
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(absolute(buildPath(def, opts.params, opts.query)), {
    method: def.method,
    headers,
    credentials: 'same-origin',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (res.status === 204) return undefined as ApiResponse<D>;
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  if (!isJson) {
    if (!res.ok) throw synthProblem(res.status, res.statusText || 'Request failed');
    return (await res.text()) as ApiResponse<D>;
  }
  const json: unknown = await res.json();
  if (!res.ok) {
    const parsed = ProblemDetails.safeParse(json);
    throw parsed.success ? new ApiProblem(parsed.data) : synthProblem(res.status, 'Request failed');
  }
  return import.meta.env.DEV ? def.response.parse(json) : (json as ApiResponse<D>);
}

/** Stable TanStack Query keys: [operationId, params, query]. */
export function queryKey(def: EndpointDef, params?: unknown, query?: unknown): readonly unknown[] {
  return [def.id, params ?? null, query ?? null];
}
