/**
 * Snapshot hashing (D-012). FROZEN algorithm: canonical JSON per RFC 8785 (JCS) for the value
 * subset we allow, then SHA-256 over the UTF-8 bytes, lowercase hex. The database re-checks the
 * hash on insert (platform.decision_snapshot CHECK), so the API and DB must agree byte for byte.
 *
 * Allowed values: null, boolean, string, safe integers, plain objects, arrays. Money, rates and
 * any non-integer number MUST be decimal strings (D-010); a non-integer number throws here, which
 * removes the only part of JCS that is hard to get right (number serialization).
 */

export type CanonicalValue =
  null | boolean | string | number | CanonicalValue[] | { [k: string]: CanonicalValue };

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new Error(`canonicalize: non-integer number ${value}; use a decimal string`);
      }
      return Object.is(value, -0) ? '0' : String(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v)).join(',')}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new Error('canonicalize: only plain objects are allowed');
      }
      const obj = value as Record<string, unknown>;
      // JCS sorts by UTF-16 code units, which is JavaScript's default string ordering.
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
    }
    default:
      throw new Error(`canonicalize: unsupported type ${typeof value}`);
  }
}

/** SHA-256 hex of a string's UTF-8 bytes, using Web Crypto (Node 22 and browsers). */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Canonical text and its hash, ready for platform.decision_snapshot (content_canonical, content_hash). */
export async function hashCanonical(value: unknown): Promise<{ canonical: string; hash: string }> {
  const canonical = canonicalize(value);
  return { canonical, hash: await sha256Hex(canonical) };
}
