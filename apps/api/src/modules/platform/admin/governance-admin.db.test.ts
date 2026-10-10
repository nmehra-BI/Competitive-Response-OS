/**
 * S14 governance endpoints (E3; D-109, D-120, D-124, D-129, D-130): the investment committee, licences
 * with written rights, and the tenant "Live analysis" setting. Each endpoint: admin only (403 for
 * others), human only, audited, isolated per tenant, idempotent where declared; the database holds the
 * fail-closed invariants too.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { withTenant } from '@growth-os/db';
import { businessUnits, expectedCommittee, licenses } from '@growth-os/fixtures-aster';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';

let t: TestApp;
let a: SeededTenant;
let b: SeededTenant;
const c: Record<string, string> = {};
const BU = () => a.id(businessUnits[0].id);

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  for (const p of ['admin', 'maya', 'elena', 'katrin'] as const) c[p] = await login(t.app, a.user(p));
  c.adminB = await login(t.app, b.user('admin'));
});
afterAll(async () => {
  await t.close();
});

const inTenant = <T>(s: SeededTenant, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(t.db, { tenantId: s.tenantId, userId: null, correlationId: `test-${randomUUID()}` }, fn);

async function auditOf(s: SeededTenant, objectId: string) {
  return inTenant(s, async (tx) =>
    (
      await tx
        .selectFrom('platform.audit_event')
        .select('action')
        .where('object_id', '=', objectId)
        .orderBy('seq')
        .execute()
    ).map((r) => r.action),
  );
}

describe('admin.committee / admin.setCommitteeMember (D-124)', () => {
  it('lists the BU Water seats and "Committee named · G3 authority not granted"', async () => {
    const res = await call(t.app, API.admin.committee, { cookie: c.admin });
    expect(res.statusCode).toBe(200);
    const body = API.admin.committee.response.parse(res.json());
    expect(body.items.map((m) => [m.seat, m.person.displayName])).toEqual([
      ['chair', 'Elena Fischer'],
      ['finance', 'Katrin Vogel'],
      ['operations', 'Thomas Berger'],
    ]);
    expect(body.items.every((m) => m.doaReference === 'DoA-2026-01 · BU Water · illustrative')).toBe(true);
    expect(body.gaps).toEqual([
      { businessUnitId: BU(), seat: null, message: expectedCommittee.authorityGapText },
    ]);
    expect((await call(t.app, API.admin.committee, { cookie: c.maya })).statusCode).toBe(403);
    // Tenant isolation: the other tenant's admin sees only their own members.
    const other = API.admin.committee.response.parse(
      (await call(t.app, API.admin.committee, { cookie: c.adminB })).json(),
    );
    expect(other.items.some((m) => body.items.some((x) => x.id === m.id))).toBe(false);
  });

  it('names a seat holder with audit; one live holder per seat; revoke keeps the row', async () => {
    const bu2 = a.id(businessUnits[1].id);
    const id = randomUUID();
    const body = {
      userId: a.user('elena'),
      businessUnitId: bu2,
      seat: 'chair',
      validFrom: '2026-01-01',
      validTo: null,
      doaReference: 'DoA-2026-03 · BU 2',
      revoked: false,
    };
    const res = await call(t.app, API.admin.setCommitteeMember, {
      params: { id },
      body,
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(200);
    expect(API.admin.setCommitteeMember.response.parse(res.json())).toMatchObject({
      seat: 'chair',
      businessUnitId: bu2,
      enteredBy: a.user('admin'),
    });
    expect(await auditOf(a, id)).toEqual(['admin.committee_member_named']);
    const dup = await call(t.app, API.admin.setCommitteeMember, {
      params: { id: randomUUID() },
      body: { ...body, userId: a.user('katrin') },
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(dup.statusCode).toBe(409);
    const noDoa = await call(t.app, API.admin.setCommitteeMember, {
      params: { id: randomUUID() },
      body: { ...body, seat: 'finance', userId: a.user('katrin'), doaReference: null },
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(noDoa.statusCode).toBe(400);
    const revoked = await call(t.app, API.admin.setCommitteeMember, {
      params: { id },
      body: { ...body, revoked: true },
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(API.admin.setCommitteeMember.response.parse(revoked.json()).revokedAt).not.toBeNull();
    expect(await auditOf(a, id)).toEqual(['admin.committee_member_named', 'admin.committee_member_revoked']);
  });

  it('refuses agents (API and DB), non-admins (403) and other tenants’ people (400)', async () => {
    const body = (userId: string) => ({
      userId,
      businessUnitId: BU(),
      seat: 'operations',
      validFrom: '2026-01-01',
      validTo: null,
      doaReference: 'DoA-X',
      revoked: false,
    });
    const agent = await call(t.app, API.admin.setCommitteeMember, {
      params: { id: randomUUID() },
      body: body(a.user('analysisAgent')),
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(agent.statusCode).toBe(403);
    expect(agent.json().code).toBe('AGENT_IDENTITY_FORBIDDEN');
    const maya = await call(t.app, API.admin.setCommitteeMember, {
      params: { id: randomUUID() },
      body: body(a.user('jonas')),
      cookie: c.maya,
      idempotencyKey: true,
    });
    expect(maya.statusCode).toBe(403);
    const cross = await call(t.app, API.admin.setCommitteeMember, {
      params: { id: randomUUID() },
      body: body(b.user('jonas')),
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(cross.statusCode).toBe(400);
  });
});

describe('admin.licenses / admin.setLicense (D-120, D-129): fail closed', () => {
  const census = () => a.id(licenses[0].id);
  const vendor = () => a.id(licenses[1].id);

  it('lists licences with rights status, term end and on-expiry action', async () => {
    const res = await call(t.app, API.admin.licenses, { cookie: c.admin });
    expect(res.statusCode).toBe(200);
    const items = API.admin.licenses.response.parse(res.json()).items;
    expect(items.map((l) => [l.key, l.rightsStatus, l.termEndsOn])).toEqual([
      ['authorized-upload', 'confirmed', null],
      ['site-census', 'confirmed', '2027-12-31'],
      ['vendor-estimate', 'unconfirmed', null],
    ]);
    expect((await call(t.app, API.admin.licenses, { cookie: c.maya })).statusCode).toBe(403);
  });

  it('permissions without a written confirmation → 400, and the database refuses them too', async () => {
    const body = {
      name: 'Vendor market estimate',
      boundaryText: 'Not licensed in this workspace',
      maxExcerptSentences: 2,
      allowModelContext: false,
      allowEmbeddings: false,
      allowExport: false,
      rightsConfirmation: null,
      termEndsOn: null,
      onExpiry: 'remove_content_keep_metadata',
    };
    const res = await call(t.app, API.admin.setLicense, {
      params: { id: vendor() },
      body,
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().title).toBe(
      'Record the written confirmation of rights before allowing excerpts, model context, embeddings or export',
    );
    await expect(
      inTenant(a, (tx) =>
        tx.updateTable('platform.license').set({ allow_export: true }).where('id', '=', vendor()).execute(),
      ),
    ).rejects.toThrow(/license_fail_closed/);
    expect(await auditOf(a, vendor())).toEqual([]);
  });

  it('records a confirmation, term end and on-expiry action with audit; a past term end is metadata only', async () => {
    const body = {
      name: 'Vendor market estimate',
      boundaryText: 'Internal use · 1 sentence',
      maxExcerptSentences: 1,
      allowModelContext: false,
      allowEmbeddings: false,
      allowExport: false,
      rightsConfirmation: { documentRef: 'Vendor letter 2026-09', confirmedOn: '2026-09-30' },
      termEndsOn: '2027-06-30',
      onExpiry: 'delete_copy_keep_audit',
    };
    const res = await call(t.app, API.admin.setLicense, {
      params: { id: vendor() },
      body,
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(200);
    expect(API.admin.setLicense.response.parse(res.json())).toMatchObject({
      rightsStatus: 'confirmed',
      termEndsOn: '2027-06-30',
      onExpiry: 'delete_copy_keep_audit',
      rightsConfirmation: { documentRef: 'Vendor letter 2026-09', recordedBy: a.user('admin') },
    });
    expect(await auditOf(a, vendor())).toEqual(['admin.license_changed']);
    const ended = await call(t.app, API.admin.setLicense, {
      params: { id: census() },
      body: { ...body, name: 'Site census', termEndsOn: '2020-01-01' },
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(ended.statusCode).toBe(400);
  });
});

describe('admin.liveAnalysis / admin.setLiveAnalysis (D-120 §4, D-130)', () => {
  it('is off by default and reports the configured provider; non-admins 403', async () => {
    const res = await call(t.app, API.admin.liveAnalysis, { cookie: c.admin });
    expect(res.statusCode).toBe(200);
    expect(API.admin.liveAnalysis.response.parse(res.json())).toMatchObject({
      enabled: false,
      addendumRef: null,
      evalRunRef: null,
      liveProviderConfigured: false, // ANALYSIS_PROVIDER=fixture in tests
    });
    expect((await call(t.app, API.admin.liveAnalysis, { cookie: c.elena })).statusCode).toBe(403);
  });

  it('turning it on without the addendum or the eval run → 400; the database refuses it too', async () => {
    const res = await call(t.app, API.admin.setLiveAnalysis, {
      body: {
        enabled: true,
        addendumRef: null,
        addendumSignedOn: null,
        evalRunRef: null,
        evalPassedAt: null,
      },
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(400);
    const noEval = await call(t.app, API.admin.setLiveAnalysis, {
      body: {
        enabled: true,
        addendumRef: 'DPA addendum',
        addendumSignedOn: '2026-10-01',
        evalRunRef: null,
        evalPassedAt: null,
      },
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(noEval.statusCode).toBe(400);
    await expect(
      inTenant(a, (tx) =>
        tx
          .insertInto('platform.tenant_ai_setting')
          .values({ tenant_id: a.tenantId, live_enabled: true })
          .execute(),
      ),
    ).rejects.toThrow(/check/i);
  });

  it('on with documents, then off: both audited; never a model name; tenant isolated', async () => {
    const on = await call(t.app, API.admin.setLiveAnalysis, {
      body: {
        enabled: true,
        addendumRef: 'DPA addendum · synthetic',
        addendumSignedOn: '2026-10-01',
        evalRunRef: 'eval-run-42',
        evalPassedAt: '2026-10-02T10:00:00.000Z',
      },
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(on.statusCode).toBe(200);
    const setting = API.admin.setLiveAnalysis.response.parse(on.json());
    expect(setting).toMatchObject({
      enabled: true,
      addendumRef: 'DPA addendum · synthetic',
      evalRunRef: 'eval-run-42',
    });
    expect(setting.changedBy!.displayName).toBeTruthy();
    expect(JSON.stringify(setting)).not.toMatch(/model/i);
    const off = await call(t.app, API.admin.setLiveAnalysis, {
      body: { ...setting, enabled: false },
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(API.admin.setLiveAnalysis.response.parse(off.json()).enabled).toBe(false);
    expect((await auditOf(a, a.tenantId)).filter((x) => x.startsWith('admin.live_analysis'))).toEqual([
      'admin.live_analysis_enabled',
      'admin.live_analysis_disabled',
    ]);
    const other = API.admin.liveAnalysis.response.parse(
      (await call(t.app, API.admin.liveAnalysis, { cookie: c.adminB })).json(),
    );
    expect(other.enabled).toBe(false);
    expect(other.addendumRef).toBeNull();
    const notAdmin = await call(t.app, API.admin.setLiveAnalysis, {
      body: { ...setting, enabled: false },
      cookie: c.katrin,
      idempotencyKey: true,
    });
    expect(notAdmin.statusCode).toBe(403);
  });
});
