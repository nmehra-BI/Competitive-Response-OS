/**
 * Object storage for source originals (ARCHITECTURE.md §3, §11). Content-addressed by SHA-256, so
 * re-uploading the same bytes stores nothing new. Originals are never served raw to a browser or a
 * model: only permitted excerpts leave the system. Dev uses a local directory (OBJECT_STORE_DIR);
 * production swaps this for a bucket behind the same interface.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export interface StoredObject {
  /** Storage key, e.g. "sha256/ab/ab12…". Stored in platform.source.object_key. */
  key: string;
  sha256: string;
  size: number;
}

export interface ObjectStore {
  put(bytes: Uint8Array): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
}

const KEY_RE = /^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/;

export function createObjectStore(dir = process.env.OBJECT_STORE_DIR ?? '.data/objects'): ObjectStore {
  const root = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  const pathOf = (key: string): string => {
    // Keys are generated here; refuse anything else so a stored key can never escape the root.
    if (!KEY_RE.test(key)) throw new Error('object-store: invalid key');
    return join(root, key);
  };
  return {
    async put(bytes) {
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const key = `sha256/${sha256.slice(0, 2)}/${sha256}`;
      const path = pathOf(key);
      const exists = await stat(path).then(
        () => true,
        () => false,
      );
      if (!exists) {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
      }
      return { key, sha256, size: bytes.byteLength };
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathOf(key)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async remove(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}
