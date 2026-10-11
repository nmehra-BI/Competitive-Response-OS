/**
 * Per-intent Idempotency-Key helper (FRONTEND §4). One key per user intent (a button press),
 * reused for automatic retries of that same request, so a double click or a network retry can
 * never double-submit. A changed request body is a new intent and gets a new key (re-using a key
 * with a different body is refused by the API with IDEMPOTENCY_KEY_REUSED).
 */
import { useCallback, useRef, useState } from 'react';
import { ApiProblem } from './api-client';

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // RFC 4122 v4 fallback for very old browsers.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Errors worth retrying automatically with the same key. Decisions and 4xx are never retried. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof ApiProblem) {
    return err.status >= 500 || err.code === 'IDEMPOTENCY_IN_PROGRESS' || err.code === 'RATE_LIMITED';
  }
  return err instanceof TypeError; // network failure: the request may or may not have arrived
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` with the same key, retrying transient failures with backoff. */
export async function withSameKey<T>(
  key: string,
  fn: (key: string) => Promise<T>,
  { retries = 2, baseDelayMs = 400 }: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(key);
    } catch (e) {
      if (attempt >= retries || !isRetryable(e)) throw e;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
}

/** Stable fingerprint of a request body (key order independent). */
export function bodyFingerprint(body: unknown): string {
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(norm(body ?? null));
}

export interface Intent {
  /** Run the command once for this intent. Concurrent calls while pending share one request. */
  run<T>(body: unknown, fn: (key: string) => Promise<T>): Promise<T>;
  pending: boolean;
  /** Forget the current key (e.g. the user started a new, different action). */
  reset(): void;
}

/**
 * `const intent = useIntent(); intent.run(body, (key) => api(def, { body, idempotencyKey: key }))`.
 * The key survives failures (so the user's "Try again" reuses it) and is dropped after success.
 */
export function useIntent(opts?: { retries?: number; baseDelayMs?: number }): Intent {
  const current = useRef<{ key: string; fp: string } | null>(null);
  const inflight = useRef<Promise<unknown> | null>(null);
  const [pending, setPending] = useState(false);
  const reset = useCallback(() => {
    current.current = null;
  }, []);
  const run = useCallback(
    async <T>(body: unknown, fn: (key: string) => Promise<T>): Promise<T> => {
      if (inflight.current) return inflight.current as Promise<T>;
      const fp = bodyFingerprint(body);
      if (!current.current || current.current.fp !== fp) current.current = { key: newIdempotencyKey(), fp };
      const key = current.current.key;
      setPending(true);
      const p = withSameKey(key, fn, opts);
      inflight.current = p;
      try {
        const out = await p;
        current.current = null;
        return out;
      } finally {
        inflight.current = null;
        setPending(false);
      }
    },
    [opts],
  );
  return { run, pending, reset };
}
