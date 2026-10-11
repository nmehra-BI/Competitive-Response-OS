import { describe, expect, it } from 'vitest';
import { canonicalize, hashCanonical } from './canonical';

describe('canonicalize (JCS subset)', () => {
  it('sorts keys and removes whitespace', () => {
    expect(canonicalize({ b: 1, a: [true, null, 'x'] })).toBe('{"a":[true,null,"x"],"b":1}');
  });

  it('is independent of key insertion order', () => {
    expect(canonicalize({ x: { d: 1, c: 2 }, y: '€' })).toBe(canonicalize({ y: '€', x: { c: 2, d: 1 } }));
  });

  it('rejects non-integer numbers: money must be decimal strings', () => {
    expect(() => canonicalize({ amount: 0.1 })).toThrow(/decimal string/);
  });

  it('drops undefined properties', () => {
    expect(canonicalize({ a: undefined, b: 2 })).toBe('{"b":2}');
  });

  it('hashes UTF-8 bytes with SHA-256', async () => {
    const { canonical, hash } = await hashCanonical({ a: 1 });
    expect(canonical).toBe('{"a":1}');
    // Same value Postgres computes: encode(sha256(convert_to('{"a":1}','UTF8')),'hex')
    expect(hash).toBe('015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
  });
});
