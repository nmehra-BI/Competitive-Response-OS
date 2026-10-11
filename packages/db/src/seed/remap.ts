/**
 * Fixture id remapping. The canonical seed uses the fixture's deterministic ids unchanged. Tests
 * seed extra, isolated copies of Aster (e.g. a second tenant for cross-tenant attempts) by mapping
 * every fixture id to a fresh id with the same kind and number, so references stay consistent.
 */
import { randomBytes } from 'node:crypto';

const FIXTURE_ID = /a57e([0-9a-f]{4})-0000-4000-8000-(\d{12})/g;

export interface Remap {
  /** Suffix for globally unique values (tenant slug). Empty for the canonical seed. */
  tag: string;
  id(fixtureId: string): string;
  /** Deep-map every fixture id inside a JSON-compatible value. */
  json<T>(value: T): T;
}

export const identityRemap: Remap = { tag: '', id: (x) => x, json: (v) => v };

export function randomRemap(): Remap {
  const hex = randomBytes(5).toString('hex'); // 10 hex digits → 4 + 3 + 3
  const a = hex.slice(0, 4);
  const b = hex.slice(4, 7);
  const c = hex.slice(7, 10);
  const map = (s: string): string =>
    s.replace(FIXTURE_ID, (_m, kind: string, n: string) => `a57e${kind}-${a}-4${b}-8${c}-${n}`);
  return {
    tag: hex,
    id: map,
    json: <T>(v: T): T => JSON.parse(map(JSON.stringify(v))) as T,
  };
}
