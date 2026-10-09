/**
 * Typed API client generated from the frozen endpoint registry. Screens call
 * `api(API.gates.decide, { params, body, idempotencyKey })` and get the parsed response type.
 * Responses are validated with the endpoint's Zod schema in development.
 */
import { API_PREFIX, HEADERS, ProblemDetails, type EndpointDef } from '@growth-os/contracts';
import type { z } from 'zod';

export class ApiProblem extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.title);
    this.name = 'ApiProblem';
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

export async function api<D extends EndpointDef>(
  def: D,
  opts: CallOptions<z.input<D['params']>, z.input<D['query']>, z.input<D['body']>> = {},
): Promise<z.output<D['response']>> {
  const path = def.path.replace(/:(\w+)/g, (_, k: string) =>
    encodeURIComponent(String((opts.params as Record<string, unknown>)?.[k] ?? '')),
  );
  const qs = opts.query ? `?${new URLSearchParams(opts.query as Record<string, string>).toString()}` : '';
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

  const res = await fetch(`${API_PREFIX}${path}${qs}`, {
    method: def.method,
    headers,
    credentials: 'same-origin',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (res.status === 204) return undefined as z.output<D['response']>;
  const json: unknown = await res.json();
  if (!res.ok) throw new ApiProblem(ProblemDetails.parse(json));
  return import.meta.env.DEV ? def.response.parse(json) : (json as z.output<D['response']>);
}

/** Stable TanStack Query keys: [operationId, params, query]. Mutations invalidate by case key. */
export function queryKey(def: EndpointDef, params?: unknown, query?: unknown): readonly unknown[] {
  return [def.id, params ?? null, query ?? null];
}
