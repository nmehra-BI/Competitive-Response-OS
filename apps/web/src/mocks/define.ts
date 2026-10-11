/**
 * `mock(def, resolver)` turns a frozen endpoint definition into an MSW handler that behaves like
 * the real API's edges: session required, Idempotency-Key and If-Match enforced (428), body
 * validated with the contract (400), problem details on errors, and the response validated
 * against the contract schema so a mock can never drift from the API shape.
 */
import {
  API_PREFIX,
  ERROR_HTTP_STATUS,
  HEADERS,
  type EndpointDef,
  type ErrorCode,
  type ProblemDetails,
} from '@growth-os/contracts';
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { z } from 'zod';
import { session } from './state';

export class MockProblem extends Error {
  constructor(
    readonly code: ErrorCode,
    title: string,
    readonly extra: Partial<ProblemDetails> = {},
  ) {
    super(title);
  }
}

export function problem(code: ErrorCode, title: string, extra: Partial<ProblemDetails> = {}) {
  const body: ProblemDetails = {
    type: 'about:blank',
    title,
    status: ERROR_HTTP_STATUS[code],
    code,
    correlationId: `mock-${Math.random().toString(16).slice(2, 10)}`,
    ...extra,
  };
  return HttpResponse.json(body, {
    status: body.status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

export interface MockContext<D extends EndpointDef> {
  params: z.output<D['params']>;
  query: z.output<D['query']>;
  body: z.output<D['body']>;
  viewerId: string | null;
  idempotencyKey: string | null;
  ifMatch: number | null;
  request: Request;
}

type Resolver<D extends EndpointDef> = (
  ctx: MockContext<D>,
) => z.input<D['response']> | Promise<z.input<D['response']>> | undefined;

/** Path with :params for MSW (same syntax as the contracts). */
export function mswPath(def: EndpointDef): string {
  return `*${API_PREFIX}${def.path}`;
}

/** Idempotency replay store: same key + same body → same response, different body → 422. */
const replay = new Map<string, { body: string; status: number; json: unknown }>();
export function resetReplay() {
  replay.clear();
}

export function mock<D extends EndpointDef>(def: D, resolve: Resolver<D>): HttpHandler {
  const method = def.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  return http[method](mswPath(def), async ({ request, params }) => {
    const viewerId = session.viewerId;
    if (def.auth !== 'none' && def.auth !== 'dev_only' && !viewerId) {
      return problem('UNAUTHENTICATED', 'Sign in to continue.');
    }
    const key = request.headers.get(HEADERS.idempotencyKey);
    if (def.idempotent && !key)
      return problem('PRECONDITION_REQUIRED', 'Idempotency-Key header is required.');
    const ifm = request.headers.get(HEADERS.ifMatch);
    if (def.ifMatch && !ifm) return problem('PRECONDITION_REQUIRED', 'If-Match header is required.');

    const url = new URL(request.url);
    // Drop MSW's wildcard captures ("0") so strict contract params still validate.
    const named = Object.fromEntries(Object.entries(params).filter(([k]) => !/^\d+$/.test(k)));
    const p = def.params.safeParse(named);
    if (!p.success) return problem('NOT_FOUND', 'Not found.');
    const q = def.query.safeParse(Object.fromEntries(url.searchParams));
    if (!q.success) return problem('VALIDATION_FAILED', 'Query failed validation.');
    let rawBody: unknown = undefined;
    const text = def.method === 'GET' || def.method === 'DELETE' ? '' : await request.text();
    if (text) rawBody = JSON.parse(text);
    const b = def.body.safeParse(rawBody ?? {});
    if (!b.success) {
      return problem('VALIDATION_FAILED', 'Request body failed validation.', {
        errors: b.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
    }

    const replayKey = key ? `${viewerId}:${def.id}:${key}` : null;
    if (replayKey) {
      const prev = replay.get(replayKey);
      if (prev) {
        if (prev.body !== text)
          return problem('IDEMPOTENCY_KEY_REUSED', 'This key was used with a different request.');
        return HttpResponse.json(prev.json as never, { status: prev.status });
      }
    }

    try {
      const out = await resolve({
        params: p.data,
        query: q.data,
        body: b.data,
        viewerId,
        idempotencyKey: key,
        ifMatch: ifm ? Number(ifm.replace(/"/g, '')) : null,
        request,
      });
      if (def.successStatus === 204 || out === undefined) return new HttpResponse(null, { status: 204 });
      const parsed = def.response.safeParse(out);
      if (!parsed.success) {
        console.error(`[msw] ${def.id} mock does not match the contract`, parsed.error.issues);
        return problem('INTERNAL', `Mock for ${def.id} does not match the contract.`);
      }
      if (replayKey) replay.set(replayKey, { body: text, status: def.successStatus, json: out });
      return HttpResponse.json(out as never, { status: def.successStatus });
    } catch (e) {
      if (e instanceof MockProblem) return problem(e.code, e.message, e.extra);
      throw e;
    }
  });
}

/** Everything under /api/v1 that no handler claimed: same answer as the skeleton API. */
export const notMockedYet: HttpHandler = http.all(`*${API_PREFIX}/*`, ({ request }) =>
  problem('INTERNAL', `Not mocked yet: ${request.method} ${new URL(request.url).pathname}`),
);
