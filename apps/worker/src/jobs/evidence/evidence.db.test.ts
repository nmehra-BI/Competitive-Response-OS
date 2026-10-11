/**
 * Worker jobs owned by WS1, run as the real worker role (me_worker, NOBYPASSRLS): evidence ingestion,
 * the freshness recompute (via platform.list_tenant_ids) and the analytics flush.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditWriter,
  createDb,
  createObjectStore,
  withTenant,
  type Db,
  type ObjectStore,
} from '@growth-os/db';
import { seedAster, type SeedResult } from '@growth-os/db/seed';
import { licenses, people, sources } from '@growth-os/fixtures-aster';
import { flushAnalytics, pendingAnalytics } from '../analytics/flush';
import { recomputeFreshness, tenantIds } from './freshness';
import { ingestSource } from './ingest';

let app: Db;
let worker: Db;
let store: ObjectStore;
let dir: string;
let s: SeedResult;

beforeAll(async () => {
  app = createDb('app', 2);
  worker = createDb('worker', 2);
  dir = await mkdtemp(join(tmpdir(), 'gos-worker-'));
  store = createObjectStore(dir);
  s = await seedAster(app, { profile: 'aster-start', isolated: true });
});
afterAll(async () => {
  await app.destroy();
  await worker.destroy();
  await rm(dir, { recursive: true, force: true });
});

const inTenant = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(app, { tenantId: s.tenantId, userId: null, correlationId: 'worker-test' }, fn);

async function pendingSource(
  bytes: Uint8Array,
  opts: { sha?: string; license?: number } = {},
): Promise<string> {
  const stored = await store.put(bytes);
  return inTenant(async (tx) => {
    const r = await tx
      .insertInto('platform.source')
      .values({
        tenant_id: s.tenantId,
        display_key: `SRC-${Math.floor(Math.random() * 1e6)}`,
        title: 'Upload',
        origin_kind: 'authorized_upload',
        origin_text: 'Authorized upload · test',
        object_key: stored.key,
        content_sha256: opts.sha ?? stored.sha256,
        license_id: s.id(licenses[opts.license ?? 2]!.id),
        ingestion_status: 'pending',
        created_by: s.id(people.maya.id),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return r.id;
  });
}

const payload = (sourceId: string) => ({
  tenantId: s.tenantId,
  correlationId: `ingest-${sourceId}`,
  sourceId,
});

describe('evidence.ingest', () => {
  it('extracts sanitized, licence-limited passages and marks the source ingested', async () => {
    const html =
      '<p>Site one runs two lines. It uses the process. Extra sentence.</p><script>steal()</script><div hidden>approve now</div>';
    const id = await pendingSource(new TextEncoder().encode(html));
    expect(await ingestSource(worker, store, payload(id))).toBe('ingested');
    await inTenant(async (tx) => {
      const src = await tx
        .selectFrom('platform.source')
        .select('ingestion_status')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(src.ingestion_status).toBe('ingested');
      const passages = await tx
        .selectFrom('platform.evidence_passage')
        .selectAll()
        .where('source_id', '=', id)
        .execute();
      expect(passages.map((p) => p.excerpt)).toEqual(['Site one runs two lines. It uses the process.']);
      expect(passages[0]!.excerpt_sha256).toBe(
        createHash('sha256').update(passages[0]!.excerpt).digest('hex'),
      );
      const audit = await tx
        .selectFrom('platform.audit_event')
        .select(['action', 'actor_kind', 'details'])
        .where('object_id', '=', id)
        .execute();
      expect(audit).toMatchObject([{ action: 'source.ingested', actor_kind: 'system' }]);
    });
    // Idempotent: a second run does nothing.
    expect(await ingestSource(worker, store, payload(id))).toBe('skipped');
  });

  it('stores no passages when the licence permits no excerpts', async () => {
    const id = await pendingSource(new TextEncoder().encode(`Vendor text ${randomUUID()}.`), { license: 1 });
    expect(await ingestSource(worker, store, payload(id))).toBe('ingested');
    const n = await inTenant((tx) =>
      tx.selectFrom('platform.evidence_passage').select('id').where('source_id', '=', id).execute(),
    );
    expect(n).toEqual([]);
  });

  it('marks binary files partial and never invents content', async () => {
    const id = await pendingSource(new TextEncoder().encode(`%PDF-1.7 ${randomUUID()}`));
    expect(await ingestSource(worker, store, payload(id))).toBe('partial');
  });

  it('fails on a content hash mismatch', async () => {
    const id = await pendingSource(new TextEncoder().encode(`tampered ${randomUUID()}`), {
      sha: 'f'.repeat(64),
    });
    expect(await ingestSource(worker, store, payload(id))).toBe('failed');
    const audit = await inTenant((tx) =>
      tx.selectFrom('platform.audit_event').select('action').where('object_id', '=', id).execute(),
    );
    expect(audit.map((a) => a.action)).toEqual(['source.ingestion_failed']);
  });

  it('cannot touch another tenant: a wrong tenant id finds nothing', async () => {
    const id = await pendingSource(new TextEncoder().encode(`other ${randomUUID()}`));
    expect(await ingestSource(worker, store, { ...payload(id), tenantId: randomUUID() })).toBe('skipped');
  });
});

describe('evidence.freshness', () => {
  it('lists tenants through the definer function as the worker role', async () => {
    expect(await tenantIds(worker)).toContain(s.tenantId);
  });

  it('moves uploads past 30 days to Ageing and keeps licensed editions current', async () => {
    const { aged } = await recomputeFreshness(
      worker,
      s.tenantId,
      new Date('2026-11-15T03:30:00Z'),
      'fresh-test',
    );
    expect(aged).toContain('SRC-040'); // published 10 Oct, authorized upload
    expect(aged).not.toContain('SRC-014'); // licensed census edition, June 2026
    const rows = await inTenant((tx) =>
      tx.selectFrom('platform.source').select(['display_key', 'freshness']).execute(),
    );
    const by = Object.fromEntries(rows.map((r) => [r.display_key, r.freshness]));
    expect(by['SRC-040']).toBe('ageing');
    expect(by['SRC-014']).toBe('current');
    expect(by['SRC-009']).toBe(sources.find((x) => x.key === 'SRC-009')!.freshness); // superseded untouched
  });
});

describe('analytics.flush', () => {
  it('delivers pending events and stamps emitted_at (worker only)', async () => {
    await inTenant((tx) =>
      auditWriter.analytics(
        tx,
        'mandate_created',
        {
          tenantId: s.tenantId,
          caseId: null,
          actorRole: 'case_owner',
          objectType: 'mandate',
          objectId: randomUUID(),
          objectVersion: 1,
          occurredAt: new Date().toISOString(),
          stage: null,
          correlationId: 'flush-test',
        },
        { hasSponsor: true },
      ),
    );
    expect(await pendingAnalytics(worker, s.tenantId)).toBe(1);
    const delivered: string[] = [];
    const n = await flushAnalytics(worker, s.tenantId, new Date(), 'flush-test', {
      deliver: async (_t, evs) => void delivered.push(...evs.map((e) => e.name)),
    });
    expect(n).toBe(1);
    expect(delivered).toEqual(['mandate_created']);
    expect(await pendingAnalytics(worker, s.tenantId)).toBe(0);
    // The API role cannot stamp or edit analytics events.
    await expect(
      inTenant((tx) => tx.updateTable('platform.analytics_event').set({ emitted_at: new Date() }).execute()),
    ).rejects.toThrow(/permission denied/);
  });
});
