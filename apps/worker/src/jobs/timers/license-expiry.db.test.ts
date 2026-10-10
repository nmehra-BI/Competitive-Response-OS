/**
 * `timers.license_expiry` against Postgres as the worker role (D-129): the on-expiry action and the
 * permission drop land in one write, provenance and passages stay, the audit event is recorded, a
 * second run is a no-op, and the fail-closed constraint refuses re-opening content on an expired licence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, sql, withTenant, type Db } from '@growth-os/db';
import { seedAster, type SeedResult } from '@growth-os/db/seed';
import { licenses } from '@growth-os/fixtures-aster';
import { expireLicensesInTenant } from './license-expiry';

let app: Db;
let worker: Db;
let s: SeedResult;

beforeAll(async () => {
  app = createDb('app', 2);
  worker = createDb('worker', 2);
  s = await seedAster(app, { profile: 'aster-demo', isolated: true });
});
afterAll(async () => {
  await app.destroy();
  await worker.destroy();
});

const ctx = (now: string) => ({ now, timeZone: 'Europe/Berlin', correlationId: 'test-license-expiry' });
const inTenant = <T>(db: Db, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(db, { tenantId: s.tenantId, userId: null, correlationId: 'test' }, fn);

describe('timers.license_expiry', () => {
  it('drops the site census to metadata only after 31 Dec 2027, keeps provenance, audits once', async () => {
    const census = s.id(licenses[0].id);
    const passagesBefore = await inTenant(
      app,
      async (tx) =>
        (
          await sql<{ n: string }>`SELECT count(*) AS n FROM platform.evidence_passage p
          JOIN platform.source x ON x.id = p.source_id WHERE x.license_id = ${census}`.execute(tx)
        ).rows[0]!.n,
    );
    expect(Number(passagesBefore)).toBeGreaterThan(0);

    // Before the term ends nothing happens.
    expect(await inTenant(worker, (tx) => expireLicensesInTenant(tx, ctx('2027-12-31T12:00:00Z')))).toEqual({
      expired: 0,
    });
    expect(await inTenant(worker, (tx) => expireLicensesInTenant(tx, ctx('2028-01-02T02:15:00Z')))).toEqual({
      expired: 1,
    });
    const row = await inTenant(app, (tx) =>
      tx.selectFrom('platform.license').selectAll().where('id', '=', census).executeTakeFirstOrThrow(),
    );
    expect(row).toMatchObject({
      max_excerpt_sentences: 0,
      allow_model_context: false,
      allow_embeddings: false,
      allow_export: false,
    });
    expect(row.expired_at).not.toBeNull();
    expect(row.rights_document_ref).not.toBeNull(); // the confirmation stays on record
    // Provenance stays: sources and passages are not deleted (the reads fail closed instead).
    const after = await inTenant(app, async (tx) => ({
      passages: (
        await sql<{ n: string }>`SELECT count(*) AS n FROM platform.evidence_passage p
          JOIN platform.source x ON x.id = p.source_id WHERE x.license_id = ${census}`.execute(tx)
      ).rows[0]!.n,
      deleted: (
        await sql<{ n: string }>`SELECT count(*) AS n FROM platform.source
          WHERE license_id = ${census} AND deleted_at IS NOT NULL`.execute(tx)
      ).rows[0]!.n,
      audit: await tx
        .selectFrom('platform.audit_event')
        .select(['action', 'actor_kind', 'summary'])
        .where('object_id', '=', census)
        .execute(),
    }));
    expect(after.passages).toBe(passagesBefore);
    expect(Number(after.deleted)).toBe(0);
    expect(after.audit).toEqual([
      {
        action: 'license.expired',
        actor_kind: 'system',
        summary: 'Licence term ended 31 Dec 2027: excerpts and embeddings removed, provenance kept',
      },
    ]);
    // A second run is a no-op.
    expect(await inTenant(worker, (tx) => expireLicensesInTenant(tx, ctx('2028-01-03T02:15:00Z')))).toEqual({
      expired: 0,
    });
  });

  it('the database refuses re-opening content on an expired licence (fail closed)', async () => {
    const census = s.id(licenses[0].id);
    await expect(
      inTenant(app, (tx) =>
        tx
          .updateTable('platform.license')
          .set({ max_excerpt_sentences: 2 })
          .where('id', '=', census)
          .execute(),
      ),
    ).rejects.toThrow(/license_fail_closed/);
  });

  it('delete_copy_keep_audit marks the stored copies deleted and keeps the audit record', async () => {
    const uploads = s.id(licenses[2].id);
    await inTenant(app, (tx) =>
      tx
        .updateTable('platform.license')
        .set({ term_ends_on: '2027-06-30', on_expiry_action: 'delete_copy_keep_audit' })
        .where('id', '=', uploads)
        .execute(),
    );
    const sources = await inTenant(app, (tx) =>
      tx.selectFrom('platform.source').select('id').where('license_id', '=', uploads).execute(),
    );
    expect(await inTenant(worker, (tx) => expireLicensesInTenant(tx, ctx('2027-07-01T09:00:00Z')))).toEqual({
      expired: 1,
    });
    const left = await inTenant(app, (tx) =>
      tx
        .selectFrom('platform.source')
        .select(['id', 'deleted_at'])
        .where('license_id', '=', uploads)
        .execute(),
    );
    expect(left).toHaveLength(sources.length); // rows kept (provenance), copies marked deleted
    expect(left.every((x) => x.deleted_at !== null)).toBe(true);
  });
});
