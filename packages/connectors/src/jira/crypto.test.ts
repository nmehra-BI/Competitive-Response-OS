/** Token encryption at rest: round trip, fail closed on a wrong key, a moved row or tampering. */
import { describe, expect, it } from 'vitest';
import {
  decryptToken,
  encryptToken,
  generateTokenKey,
  parseTokenKey,
  sha256Hex,
  TokenDecryptError,
} from './crypto';

const bind = { tenantId: 't-1', connectionId: 'c-1', field: 'access' as const };

describe('token crypto (AES-256-GCM)', () => {
  it('round-trips and never stores the plaintext', () => {
    const key = parseTokenKey(generateTokenKey());
    const blob = encryptToken(key, 'at-secret-token', bind);
    expect(blob.includes(Buffer.from('at-secret-token'))).toBe(false);
    expect(decryptToken([key], key.id, blob, bind)).toBe('at-secret-token');
    // A fresh IV per encryption: the same token never gives the same ciphertext.
    expect(encryptToken(key, 'at-secret-token', bind).equals(blob)).toBe(false);
  });

  it('a wrong key fails closed', () => {
    const key = parseTokenKey(generateTokenKey());
    const other = parseTokenKey(generateTokenKey());
    const blob = encryptToken(key, 'at-secret-token', bind);
    expect(() => decryptToken([other], key.id, blob, bind)).toThrow(TokenDecryptError);
    // Same key id claimed by a different key (misconfiguration) still fails on the auth tag.
    expect(() => decryptToken([{ ...other, id: key.id }], key.id, blob, bind)).toThrow(TokenDecryptError);
  });

  it('a ciphertext moved to another row, field or tenant does not decrypt', () => {
    const key = parseTokenKey(generateTokenKey());
    const blob = encryptToken(key, 'at-secret-token', bind);
    expect(() => decryptToken([key], key.id, blob, { ...bind, connectionId: 'c-2' })).toThrow(
      TokenDecryptError,
    );
    expect(() => decryptToken([key], key.id, blob, { ...bind, tenantId: 't-2' })).toThrow(TokenDecryptError);
    expect(() => decryptToken([key], key.id, blob, { ...bind, field: 'refresh' })).toThrow(TokenDecryptError);
  });

  it('tampering and truncation fail closed', () => {
    const key = parseTokenKey(generateTokenKey());
    const blob = encryptToken(key, 'at-secret-token', bind);
    const flipped = Buffer.from(blob);
    flipped[flipped.length - 1]! ^= 0x01;
    expect(() => decryptToken([key], key.id, flipped, bind)).toThrow(TokenDecryptError);
    expect(() => decryptToken([key], key.id, blob.subarray(0, 10), bind)).toThrow(TokenDecryptError);
    expect(() => decryptToken([key], key.id, Buffer.alloc(0), bind)).toThrow(TokenDecryptError);
  });

  it('rotation: the previous key still decrypts by key id', () => {
    const previous = parseTokenKey(generateTokenKey());
    const current = parseTokenKey(generateTokenKey());
    const blob = encryptToken(previous, 'rt-old', { ...bind, field: 'refresh' });
    expect(decryptToken([current, previous], previous.id, blob, { ...bind, field: 'refresh' })).toBe(
      'rt-old',
    );
    expect(() => decryptToken([current], previous.id, blob, { ...bind, field: 'refresh' })).toThrow(
      'not configured',
    );
  });

  it('keys must be 32 bytes; the key id is a fingerprint, not the key', () => {
    expect(() => parseTokenKey(Buffer.alloc(16).toString('base64'))).toThrow('32 bytes');
    const raw = generateTokenKey();
    const key = parseTokenKey(raw);
    expect(key.id).toMatch(/^k1-[0-9a-f]{12}$/);
    expect(key.id).not.toContain(raw.slice(0, 8));
    expect(sha256Hex('state')).toMatch(/^[0-9a-f]{64}$/);
  });
});
