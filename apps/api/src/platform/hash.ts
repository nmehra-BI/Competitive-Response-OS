/** Stable JSON and SHA-256 helpers for request hashes, state hashes and tokens. */
import { createHash } from 'node:crypto';

/**
 * Deterministic JSON: object keys sorted, undefined dropped. Unlike the snapshot canonicalizer it
 * accepts any finite number, because request bodies are hashed only to compare two requests.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    if (typeof value === 'bigint') return JSON.stringify(value.toString());
    return JSON.stringify(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Hash of an object's state, for audit before/after hashes. */
export function stateHash(value: unknown): string {
  return sha256Hex(stableStringify(value));
}
