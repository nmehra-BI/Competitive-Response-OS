/**
 * Cursor pagination (API.md §5): `?limit=&cursor=` → `{ items, nextCursor }`. Cursors are opaque,
 * bound to the tenant and the operation, and expire after 24 h. No totals are ever returned.
 */
import { createHmac } from 'node:crypto';
import { ApiError } from './errors';

const CURSOR_TTL_MS = 24 * 60 * 60 * 1000;
const SECRET = process.env.SESSION_SECRET ?? 'growth-os-dev-cursor';

interface CursorBody {
  t: string; // tenant
  o: string; // operation id
  k: string | number; // sort key of the last item
  i: string; // id of the last item
  at: number; // issued at (ms)
}

const sign = (payload: string) =>
  createHmac('sha256', SECRET).update(payload).digest('base64url').slice(0, 22);

export function encodeCursor(
  tenantId: string,
  op: string,
  key: string | number,
  id: string,
  now: Date,
): string {
  const payload = Buffer.from(
    JSON.stringify({ t: tenantId, o: op, k: key, i: id, at: now.getTime() }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function decodeCursor(
  cursor: string | undefined,
  tenantId: string,
  op: string,
  now: Date,
): { key: string | number; id: string } | null {
  if (!cursor) return null;
  const bad = () => new ApiError('VALIDATION_FAILED', 'The cursor is invalid or expired. Reload the list.');
  const [payload, sig] = cursor.split('.');
  if (!payload || !sig || sign(payload) !== sig) throw bad();
  let body: CursorBody;
  try {
    body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CursorBody;
  } catch {
    throw bad();
  }
  if (body.t !== tenantId || body.o !== op || now.getTime() - body.at > CURSOR_TTL_MS) throw bad();
  return { key: body.k, id: body.i };
}

/** Page an already sorted, access-filtered array (pilot-scale lists). */
export function pageOf<T>(
  rows: readonly T[],
  opts: {
    limit: number;
    cursor: string | undefined;
    tenantId: string;
    op: string;
    now: Date;
    keyOf: (row: T) => { key: string | number; id: string };
  },
): { items: T[]; nextCursor: string | null } {
  const after = decodeCursor(opts.cursor, opts.tenantId, opts.op, opts.now);
  let start = 0;
  if (after) {
    const idx = rows.findIndex((r) => opts.keyOf(r).id === after.id);
    start = idx >= 0 ? idx + 1 : rows.length;
  }
  const items = rows.slice(start, start + opts.limit);
  const last = items[items.length - 1];
  const hasMore = start + opts.limit < rows.length;
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor(opts.tenantId, opts.op, opts.keyOf(last).key, opts.keyOf(last).id, opts.now)
        : null,
  };
}
