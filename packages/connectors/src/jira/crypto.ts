/**
 * Token encryption at rest (D-135): AES-256-GCM with the key from CONNECTOR_TOKEN_KEY. The stored
 * value is `version(1) | iv(12) | tag(16) | ciphertext`, bound to its row by additional data
 * (tenant, connection, field) so a ciphertext copied to another row does not decrypt. `key_id` names
 * the key (a fingerprint, never the key) so a rotation can keep decrypting with the previous key.
 *
 * Fails closed: a wrong key, a changed row binding or a tampered value throws `TokenDecryptError`.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface TokenKey {
  id: string; // "k1-<12 hex of sha256(key)>"
  bytes: Buffer;
}

export class TokenDecryptError extends Error {
  constructor(message = 'The stored token could not be decrypted with the configured key.') {
    super(message);
    this.name = 'TokenDecryptError';
  }
}

/** Parse a base64 (or base64url) 32-byte key. Throws without echoing the value. */
export function parseTokenKey(encoded: string): TokenKey {
  // Node's base64 decoder accepts the standard and the URL-safe alphabet.
  const bytes = Buffer.from(encoded.trim(), 'base64');
  if (bytes.length !== 32) throw new Error('token key must be 32 bytes');
  return { id: `k1-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`, bytes };
}

/** A new random key, base64 — for `CONNECTOR_TOKEN_KEY` (docs) and tests. */
export function generateTokenKey(): string {
  return randomBytes(32).toString('base64');
}

export interface TokenBinding {
  tenantId: string;
  connectionId: string;
  field: 'access' | 'refresh';
}

const aad = (b: TokenBinding) => Buffer.from(`growth-os|${b.tenantId}|${b.connectionId}|${b.field}`);

export function encryptToken(key: TokenKey, plaintext: string, binding: TokenBinding): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key.bytes, iv);
  cipher.setAAD(aad(binding));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

export function decryptToken(
  keys: readonly TokenKey[],
  keyId: string,
  blob: Uint8Array,
  binding: TokenBinding,
): string {
  const key = keys.find((k) => k.id === keyId);
  if (!key) throw new TokenDecryptError('The stored token was encrypted with a key that is not configured.');
  const buf = Buffer.from(blob);
  if (buf.length < 1 + IV_BYTES + TAG_BYTES || buf[0] !== VERSION) throw new TokenDecryptError();
  try {
    const decipher = createDecipheriv('aes-256-gcm', key.bytes, buf.subarray(1, 1 + IV_BYTES));
    decipher.setAAD(aad(binding));
    decipher.setAuthTag(buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(buf.subarray(1 + IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new TokenDecryptError();
  }
}

/** sha256 hex — the OAuth state is stored only as this hash. */
export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
