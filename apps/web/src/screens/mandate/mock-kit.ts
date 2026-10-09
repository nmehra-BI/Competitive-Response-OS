/**
 * Mock helpers shared by the WS8a screen mocks (mandate, opportunities, compare, overview,
 * my-work, reviews). Never imported by screen code, so none of this reaches the production bundle.
 *
 * - `persisted()` keeps a screen's mock state in sessionStorage so a journey survives the full
 *   page load that a persona switch causes (Maya submits, Elena decides, Maya sees the result).
 * - `scoped()` claims an endpoint only for the ids a screen owns and passes every other request
 *   to the next handler. Use it for shared endpoints (gates.*, cases.header) so screen mocks from
 *   different streams never shadow each other.
 */
import type { EndpointDef } from '@growth-os/contracts';
import { http, type HttpHandler } from 'msw';
import { mswPath } from '../../mocks/define';

export interface Persisted<T> {
  get(): T;
  /** Mutate and persist. */
  update(fn: (s: T) => void): void;
  reset(): void;
}

export function persisted<T>(key: string, init: () => T): Persisted<T> {
  const storageKey = `growth-os:mock:${key}`;
  let value: T | null = null;
  const load = (): T | null => {
    try {
      const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(storageKey) : null;
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  };
  const save = () => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* node: in-memory only */
    }
  };
  return {
    get() {
      if (value === null) value = load() ?? init();
      return value;
    },
    update(fn) {
      fn(this.get());
      save();
    },
    reset() {
      value = init();
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* node */
      }
    },
  };
}

/**
 * Claim `def` only when `claims(params)` is true; otherwise fall through to the next handler
 * (another screen's mock or the WS7 base handler). `inner` is a `mock(def, …)` handler.
 */
export function scoped(
  def: EndpointDef,
  claims: (params: Record<string, string>) => boolean,
  inner: HttpHandler,
): HttpHandler {
  const method = def.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  return http[method](mswPath(def), async ({ request, params, requestId }) => {
    const named = Object.fromEntries(
      Object.entries(params).filter(([k, v]) => !/^\d+$/.test(k) && typeof v === 'string'),
    ) as Record<string, string>;
    if (!claims(named)) return undefined;
    const res = await inner.run({ request, requestId });
    return res?.response;
  });
}

/** Deterministic UUIDs for rows the mocks create (manual candidates, new mandates, comparisons). */
export function mockUuid(space: number, n: number): string {
  return `a57eff${String(space).padStart(2, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** A content hash whose fingerprint reads like the prototype's ("7F3A·19C2"). */
export function mockHash(seed: string): string {
  let h = 2166136261;
  const out: string[] = [];
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
    h = Math.imul(h ^ round, 16777619) >>> 0;
    out.push(h.toString(16).padStart(8, '0'));
  }
  return out.join('').slice(0, 64);
}
