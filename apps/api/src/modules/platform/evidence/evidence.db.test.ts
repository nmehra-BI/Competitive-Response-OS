/**
 * Evidence (S13, WF-10) — security/entitlements suite. Restricted content never appears for viewers
 * without excerpt entitlement; hidden cases are not leaked; cross-tenant and unauthorized attempts
 * are refused; corrections are audited with the evidence_reviewed analytics event.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, SourceDetail } from '@growth-os/contracts';
import { sql, withTenant } from '@growth-os/db';
import { businessUnits, licenses, sources } from '@growth-os/fixtures-aster';
import {
  call,
  createTestApp,
  login,
  pathOf,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';

let t: TestApp;
let demo: SeededTenant;
let start: SeededTenant;
const cookies: Record<string, string> = {};

const src = (s: SeededTenant, key: string) => s.id(sources.find((x) => x.key === key)!.id);
const excerptOf = (key: string) => sources.find((x) => x.key === key)!.passages[0]!.excerpt;
const inTenant = <T>(s: SeededTenant, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(t.db, { tenantId: s.tenantId, userId: null, correlationId: 'test' }, fn);

beforeAll(async () => {
  t = await createTestApp();
  demo = await seedTenant(t.db, 'aster-demo');
  start = await seedTenant(t.db, 'aster-start');
  for (const who of ['maya', 'daniel', 'jonas', 'priya', 'admin', 'opsLead'] as const)
    cookies[who] = await login(t.app, demo.user(who));
  cookies.mayaStart = await login(t.app, start.user('maya'));
  cookies.priyaStart = await login(t.app, start.user('priya'));
});
afterAll(async () => {
  await t.close();
});

const get = (cookie: string, ref: string) => call(t.app, API.evidence.get, { params: { ref }, cookie });

describe('entitlements on source detail', () => {
  it('shows permitted passages and impact to a viewer with excerpt entitlement (Maya, SRC-014)', async () => {
    const res = await get(cookies.maya!, 'SRC-014');
    expect(res.statusCode).toBe(200);
    const d = SourceDetail.parse(res.json());
    expect(d.viewerAccess).toBe('excerpt');
    expect(d.passages.map((p) => p.excerpt)).toEqual([excerptOf('SRC-014')]);
    expect(d.quotedFact).toBe(excerptOf('SRC-014'));
    expect(d.license?.boundaryText).toContain('excerpts up to 2 sentences');
    expect(d.impact.map((i) => i.caseKey)).toEqual(['ME-104']);
    expect(d.linkedUses.some((u) => u.where.startsWith('ME-104 · Sizing v2'))).toBe(true);
  });

  it('shows aggregates only to the pilot owner (Jonas): no passages, no derived text', async () => {
    const res = await get(cookies.jonas!, 'SRC-014');
    const d = SourceDetail.parse(res.json());
    expect(d.viewerAccess).toBe('aggregate_only');
    expect(d.passages).toEqual([]);
    expect(d.quotedFact).toBeNull();
    expect(d.inferredClaim).toBeNull();
    expect(res.body).not.toContain(excerptOf('SRC-014'));
  });

  it('shows nothing of the content to a viewer without entitlement (Priya)', async () => {
    const res = await get(cookies.priya!, 'SRC-014');
    const d = SourceDetail.parse(res.json());
    expect(d.viewerAccess).toBe('none');
    expect(d.passages).toEqual([]);
    expect(d.challenges).toEqual([]);
    expect(res.body).not.toContain(excerptOf('SRC-014'));
  });

  it('never shows the restricted vendor estimate (SRC-030), even to the case owner', async () => {
    const d = SourceDetail.parse((await get(cookies.maya!, 'SRC-030')).json());
    expect(d.viewerAccess).toBe('none');
    expect(d.passages).toEqual([]);
    expect(d.quotedFact).toBeNull();
  });

  it('keeps provenance of a deleted source without any content', async () => {
    const d = SourceDetail.parse((await get(cookies.maya!, 'SRC-011')).json());
    expect(d.source.availability).toBe('deleted_by_provider');
    expect(d.source.deletedAt).not.toBeNull();
    expect(d.viewerAccess).toBe('none');
  });

  it('refuses administrators (no case role) and unknown sources', async () => {
    // Admins configure licences but read no evidence: detail is hidden (404), the list is refused.
    expect((await get(cookies.admin!, 'SRC-014')).statusCode).toBe(404);
    expect((await call(t.app, API.evidence.list, { cookie: cookies.admin })).statusCode).toBe(403);
    expect((await get(cookies.maya!, 'SRC-999')).statusCode).toBe(404);
  });
});

describe('visibility, hidden cases and tenancy', () => {
  let hiddenSource: string;
  beforeAll(async () => {
    // A source used only by a BU Air case: no Aster persona can read that case.
    await inTenant(demo, async (tx) => {
      const caseId = randomUUID();
      await tx
        .insertInto('platform.workflow_case')
        .values({
          id: caseId,
          tenant_id: demo.tenantId,
          app_type: 'market_expansion',
          display_key: 'ME-900',
          title: 'Hidden air case',
          business_unit_id: demo.id(businessUnits[1].id),
          owner_user_id: demo.user('admin'),
          sponsor_user_id: demo.user('admin'),
          stage: 'discovery',
          origin_type: 'direct',
          created_by: demo.user('admin'),
        })
        .execute();
      const s = await tx
        .insertInto('platform.source')
        .values({
          tenant_id: demo.tenantId,
          display_key: 'SRC-900',
          title: 'Air confidential survey',
          origin_kind: 'authorized_upload',
          origin_text: 'Authorized upload',
          license_id: demo.id(licenses[2].id),
          ingestion_status: 'ingested',
          created_by: demo.user('admin'),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      hiddenSource = s.id;
      const claim = await tx
        .insertInto('platform.claim')
        .values({
          tenant_id: demo.tenantId,
          case_id: caseId,
          statement: 'Air claim',
          kind: 'evidence',
          origin: 'human',
          created_by: demo.user('admin'),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('platform.claim_evidence_link')
        .values({
          tenant_id: demo.tenantId,
          claim_id: claim.id,
          source_id: s.id,
          relation: 'supports',
          created_by: demo.user('admin'),
        })
        .execute();
    });
  });

  it('hides a source used only by cases the viewer cannot read (404, not listed, not counted)', async () => {
    expect((await get(cookies.maya!, 'SRC-900')).statusCode).toBe(404);
    expect((await get(cookies.maya!, hiddenSource)).statusCode).toBe(404);
    const list = await call(t.app, API.evidence.list, { cookie: cookies.maya, query: { limit: 200 } });
    const keys = (list.json().items as { key: string }[]).map((s) => s.key);
    expect(keys).toContain('SRC-014');
    expect(keys).not.toContain('SRC-900');
    expect(list.body).not.toContain('Air confidential');
  });

  it('cross-tenant: a source id from another tenant is not found', async () => {
    const res = await get(cookies.mayaStart!, src(demo, 'SRC-014'));
    expect(res.statusCode).toBe(404);
    const own = SourceDetail.parse((await get(cookies.mayaStart!, 'SRC-014')).json());
    expect(own.source.id).toBe(src(start, 'SRC-014'));
  });

  it('lists sources for one case and refuses a case the viewer cannot read', async () => {
    const res = await call(t.app, API.evidence.list, {
      cookie: cookies.maya,
      query: { caseRef: 'ME-104', limit: 50 },
    });
    expect((res.json().items as { key: string }[]).map((s) => s.key).sort()).toEqual([
      'SRC-014',
      'SRC-021',
      'SRC-040',
    ]);
    expect(
      (await call(t.app, API.evidence.list, { cookie: cookies.maya, query: { caseRef: 'ME-900' } }))
        .statusCode,
    ).toBe(404);
  });

  it('paginates with an opaque, tenant-bound cursor and no totals', async () => {
    const p1 = await call(t.app, API.evidence.list, { cookie: cookies.maya, query: { limit: 2 } });
    const body = p1.json() as { items: unknown[]; nextCursor: string };
    expect(body.items).toHaveLength(2);
    expect(Object.keys(body).sort()).toEqual(['items', 'nextCursor']);
    const p2 = await call(t.app, API.evidence.list, {
      cookie: cookies.maya,
      query: { limit: 2, cursor: body.nextCursor },
    });
    expect(p2.statusCode).toBe(200);
    const foreign = await call(t.app, API.evidence.list, {
      cookie: cookies.mayaStart,
      query: { limit: 2, cursor: body.nextCursor },
    });
    expect(foreign.statusCode).toBe(400);
  });
});

function multipart(metadata: unknown, file?: { name: string; type: string; content: string }) {
  const boundary = `----gos${randomUUID()}`;
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n`,
  ];
  if (file)
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n${file.content}\r\n`,
    );
  parts.push(`--${boundary}--\r\n`);
  return { payload: parts.join(''), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function upload(cookie: string, content: string, key = randomUUID(), caseRef: string | null = null) {
  const m = multipart(
    {
      title: 'Customer interview notes',
      publisher: null,
      publishedOn: '2026-11-01',
      licenseId: start.id(licenses[2].id),
      caseRef,
      fileName: 'notes.html',
    },
    { name: 'notes.html', type: 'text/html', content },
  );
  return t.app.inject({
    method: 'POST',
    url: pathOf(API.evidence.upload),
    headers: { cookie, 'content-type': m.contentType, 'idempotency-key': key },
    payload: m.payload,
  });
}

describe('upload', () => {
  it('registers an authorized upload (202, pending) and queues ingestion in the same transaction', async () => {
    const res = await upload(cookies.mayaStart!, `<p>Plant A runs two lines. ${randomUUID()}</p>`);
    expect(res.statusCode).toBe(202);
    const s = res.json() as {
      id: string;
      key: string;
      ingestionStatus: string;
      originKind: string;
      contentSha256: string;
    };
    expect(s).toMatchObject({ ingestionStatus: 'pending', originKind: 'authorized_upload', key: 'SRC-041' });
    const jobs = await sql<{ n: string }>`SELECT count(*)::text AS n FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks k ON k.id = j.task_id
      WHERE k.identifier = 'evidence.ingest' AND j.payload->>'sourceId' = ${s.id}`.execute(t.db);
    expect(jobs.rows[0]!.n).toBe('1');
    expect(await t.objects.get(`sha256/${s.contentSha256.slice(0, 2)}/${s.contentSha256}`)).not.toBeNull();
  });

  it('links a re-upload of the same bytes to the existing source', async () => {
    const content = `<p>Same bytes ${randomUUID()}</p>`;
    const a = (await upload(cookies.mayaStart!, content)).json() as { id: string };
    const b = (await upload(cookies.mayaStart!, content)).json() as { id: string };
    expect(b.id).toBe(a.id);
  });

  it('requires a file, an Idempotency-Key and an editing role', async () => {
    const m = multipart({
      title: 'x',
      publisher: null,
      publishedOn: null,
      licenseId: start.id(licenses[2].id),
      caseRef: null,
      fileName: 'x.txt',
    });
    const noFile = await t.app.inject({
      method: 'POST',
      url: pathOf(API.evidence.upload),
      headers: { cookie: cookies.mayaStart!, 'content-type': m.contentType, 'idempotency-key': randomUUID() },
      payload: m.payload,
    });
    expect(noFile.statusCode).toBe(400);
    const noKey = await t.app.inject({
      method: 'POST',
      url: pathOf(API.evidence.upload),
      headers: { cookie: cookies.mayaStart!, 'content-type': m.contentType },
      payload: m.payload,
    });
    expect(noKey.statusCode).toBe(428);
    const priya = await upload(cookies.priyaStart!, '<p>x</p>');
    expect(priya.statusCode).toBe(403);
  });

  it('refuses a licence of another tenant', async () => {
    const m = multipart(
      {
        title: 'x',
        publisher: null,
        publishedOn: null,
        licenseId: demo.id(licenses[2].id),
        caseRef: null,
        fileName: 'x.txt',
      },
      { name: 'x.txt', type: 'text/plain', content: 'x' },
    );
    const res = await t.app.inject({
      method: 'POST',
      url: pathOf(API.evidence.upload),
      headers: { cookie: cookies.mayaStart!, 'content-type': m.contentType, 'idempotency-key': randomUUID() },
      payload: m.payload,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('challenge, mark stale, replace, request access', () => {
  it('records a challenge with audit and evidence_reviewed analytics, without the statement in either', async () => {
    const statement = `Survey sample is too small ${randomUUID()}`;
    const res = await call(t.app, API.evidence.challenge, {
      params: { ref: 'SRC-021' },
      body: { statement },
      cookie: cookies.mayaStart,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ kind: 'challenge', targetType: 'source', statement, status: 'open' });
    await inTenant(start, async (tx) => {
      const audit = await tx
        .selectFrom('platform.audit_event')
        .selectAll()
        .where('action', '=', 'source.challenged')
        .execute();
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit[0])).not.toContain(statement);
      const ev = await tx
        .selectFrom('platform.analytics_event')
        .selectAll()
        .where('name', '=', 'evidence_reviewed')
        .execute();
      expect(ev.map((e) => e.props)).toContainEqual({ action: 'challenge' });
      expect(JSON.stringify(ev)).not.toContain(statement);
    });
  });

  it('refuses challenges across tenants and from administrators', async () => {
    const cross = await call(t.app, API.evidence.challenge, {
      params: { ref: src(demo, 'SRC-021') },
      body: { statement: 'x' },
      cookie: cookies.mayaStart,
      idempotencyKey: true,
    });
    expect(cross.statusCode).toBe(404);
    const admin = await call(t.app, API.evidence.challenge, {
      params: { ref: 'SRC-021' },
      body: { statement: 'x' },
      cookie: cookies.admin,
      idempotencyKey: true,
    });
    expect([403, 404]).toContain(admin.statusCode);
  });

  it('marks an unpinned source stale (case owner only) and audits it', async () => {
    const denied = await call(t.app, API.evidence.markStale, {
      params: { ref: 'SRC-021' },
      body: { reason: 'x' },
      cookie: cookies.priyaStart,
      idempotencyKey: true,
    });
    expect(denied.statusCode).toBe(403);
    const res = await call(t.app, API.evidence.markStale, {
      params: { ref: 'SRC-021' },
      body: { reason: 'Superseded survey wave expected' },
      cookie: cookies.mayaStart,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(200);
    const d = SourceDetail.parse(res.json());
    expect(d.source.freshness).toBe('stale');
    expect(d.source.staleReason).toBe('Superseded survey wave expected');
  });

  it('replaces a source: old one superseded, self-replacement refused', async () => {
    const self = await call(t.app, API.evidence.replace, {
      params: { ref: 'SRC-040' },
      body: { replacementSourceId: src(start, 'SRC-040') },
      cookie: cookies.mayaStart,
      idempotencyKey: true,
    });
    expect(self.statusCode).toBe(400);
    const res = await call(t.app, API.evidence.replace, {
      params: { ref: 'SRC-040' },
      body: { replacementSourceId: src(start, 'SRC-014') },
      cookie: cookies.mayaStart,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(200);
    const d = SourceDetail.parse(res.json());
    expect(d.source.freshness).toBe('superseded');
    expect(d.source.supersededBySourceId).toBe(src(start, 'SRC-014'));
    const again = await call(t.app, API.evidence.markStale, {
      params: { ref: 'SRC-040' },
      body: { reason: 'x' },
      cookie: cookies.mayaStart,
      idempotencyKey: true,
    });
    expect(again.statusCode).toBe(409);
  });

  it('records an access request and reveals nothing', async () => {
    const res = await call(t.app, API.evidence.requestAccess, {
      params: { ref: 'SRC-030' },
      body: { reason: 'Need the vendor estimate for the cross-check' },
      cookie: cookies.jonas,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ requested: true });
  });
});
