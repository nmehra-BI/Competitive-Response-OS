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
  /**
   * The file part for a multipart endpoint (`evidence.upload`, D-051). The body travels as the
   * JSON `metadata` part, the file as the `file` part; the server hashes both for idempotency.
   */
  file?: Blob;
}

/**
 * Endpoints the API reads as `multipart/form-data` (D-051): a `metadata` JSON part plus one file.
 * The frozen registry has no multipart flag, so the client lists them (CR-WS1-1, no contract change).
 */
export const MULTIPART_ENDPOINT_IDS: ReadonlySet<string> = new Set(['evidence.upload']);

function fileNameOf(file: Blob, body: unknown): string {
  if (typeof File !== 'undefined' && file instanceof File && file.name) return file.name;
  const named = (body as { fileName?: unknown } | undefined)?.fileName;
  return typeof named === 'string' && named ? named : 'upload';
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
  let body: BodyInit | undefined;
  if (MULTIPART_ENDPOINT_IDS.has(def.id)) {
    if (!opts.file) throw new Error(`${def.id} requires a file (multipart/form-data)`);
    const form = new FormData();
    form.append('metadata', JSON.stringify(opts.body ?? {}));
    form.append('file', opts.file, fileNameOf(opts.file, opts.body));
    body = form; // the browser sets the multipart boundary in Content-Type
  } else if (opts.file) {
    throw new Error(`${def.id} does not accept a file`);
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(absolute(buildPath(def, opts.params, opts.query)), {
    method: def.method,
    headers,
    credentials: 'same-origin',
    body,
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
