/**
 * Mandates (S02, WF-01): drafts with If-Match, submission lists every missing required field together,
 * and a valid submission commits the version and opens G0 with a mandate-subject snapshot (D-036).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, Mandate, SnapshotContent } from '@growth-os/contracts';
import { businessUnits, mandate, products, segments } from '@growth-os/fixtures-aster';
import { analyticsFor, api, auditFor, inTenant, world, type World } from '../cases/test-support';

let w: World;
beforeAll(async () => {
  w = await world({ a: 'aster-start', b: 'aster-start' });
});
afterAll(() => w.close());

const A = () => w.tenants.a!;

describe('mandates', () => {
  let draft: Mandate;

  it('lists and reads the approved MD-21 with its committed v2 and G0', async () => {
    const list = API.mandates.list.response.parse(
      (await api(w, API.mandates.list, await w.cookie('a', 'elena'), {})).json(),
    );
    expect(list.items.map((m) => m.key)).toEqual(['MD-21']);
    const md = Mandate.parse(
      (await api(w, API.mandates.get, await w.cookie('a', 'priya'), { params: { ref: 'MD-21' } })).json(),
    );
    expect(md).toMatchObject({
      status: 'approved',
      currentVersion: { version: 2, state: 'committed' },
      draftVersion: null,
      validationErrors: [],
    });
    expect(md.scopePreview).toContain('Water-monitoring system for food processing in DE');
    expect(
      (await api(w, API.mandates.get, await w.cookie('b', 'maya'), { params: { ref: A().id(mandate.id) } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await api(w, API.mandates.get, await w.cookie('a', 'admin'), { params: { ref: 'MD-21' } })).statusCode,
    ).toBe(404);
  });

  it('creates a draft (mandate_created) and autosaves with If-Match', async () => {
    const m = await w.cookie('a', 'maya');
    const res = await api(w, API.mandates.create, m, {
      body: {
        businessUnitId: A().id(businessUnits[0].id),
        title: 'Mandate · Beverages',
        fields: { objective: 'Assess beverage plants' },
      },
    });
    expect(res.statusCode).toBe(201);
    draft = Mandate.parse(res.json());
    expect(draft).toMatchObject({
      key: 'MD-22',
      status: 'draft',
      draftVersion: { version: 1, state: 'draft' },
    });
    expect(draft.validationErrors.map((e) => e.field)).toEqual(
      expect.arrayContaining([
        'productId',
        'segmentIds',
        'geographyCodes',
        'currency',
        'ownerId',
        'sponsorId',
      ]),
    );
    expect((await analyticsFor(w, A(), 'mandate_created')).map((e) => e.props)).toEqual([
      { hasSponsor: false },
    ]);
    const stale = await api(w, API.mandates.saveDraft, m, {
      params: { ref: draft.id },
      ifMatch: 7,
      body: { fields: {} },
    });
    expect(stale.statusCode).toBe(412);
    expect(
      (await api(w, API.mandates.saveDraft, m, { params: { ref: draft.id }, body: { fields: {} } }))
        .statusCode,
    ).toBe(428);
    const saved = await api(w, API.mandates.saveDraft, m, {
      params: { ref: draft.id },
      ifMatch: draft.draftVersion!.rowVersion,
      body: {
        fields: {
          productId: A().id(products[0].id),
          segmentIds: [A().id(segments[1].id)],
          geographyCodes: ['DE'],
          horizonYears: 3,
          sponsorId: A().user('elena'),
          exclusions: ['No prospect outreach before G1'],
          successDefinition: 'A recorded decision',
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers.etag).toBe(`"${draft.draftVersion!.rowVersion + 1}"`);
    draft = Mandate.parse(saved.json());
    expect(
      (
        await api(w, API.mandates.create, await w.cookie('a', 'lena'), {
          body: { businessUnitId: A().id(businessUnits[0].id), title: 'x', fields: {} },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('submitting without owner and currency lists both reasons together', async () => {
    const res = await api(w, API.mandates.submit, await w.cookie('a', 'maya'), { params: { ref: draft.id } });
    expect(res.statusCode).toBe(409);
    const p = res.json();
    expect(p.code).toBe('PRECONDITIONS_UNMET');
    expect(p.blockers.map((b: { key: string }) => b.key)).toEqual(['owner_set', 'currency_set']);
  });

  it('submits a complete draft: version committed, G0 awaiting decision on a mandate-subject snapshot', async () => {
    const m = await w.cookie('a', 'maya');
    const saved = Mandate.parse(
      (
        await api(w, API.mandates.saveDraft, m, {
          params: { ref: draft.id },
          ifMatch: draft.draftVersion!.rowVersion,
          body: { fields: { ownerId: A().user('maya'), currency: 'EUR' } },
        })
      ).json(),
    );
    expect(saved.validationErrors).toEqual([]);
    expect(
      (await api(w, API.mandates.submit, await w.cookie('a', 'priya'), { params: { ref: draft.id } }))
        .statusCode,
    ).toBe(403);
    const res = await api(w, API.mandates.submit, m, { params: { ref: draft.id } });
    expect(res.statusCode).toBe(201);
    const out = API.mandates.submit.response.parse(res.json());
    expect(out.mandate).toMatchObject({
      status: 'awaiting_decision',
      currentVersion: { version: 1, state: 'committed' },
      draftVersion: null,
    });
    expect(out.gateRequest).toMatchObject({
      key: 'MD-22-G0',
      gateCode: 'G0',
      status: 'awaiting_decision',
      buttonLabel: 'Approve mandate (G0)',
      caseId: null,
    });
    const snap = await inTenant(w, A(), (tx) =>
      tx
        .selectFrom('platform.decision_snapshot')
        .selectAll()
        .where('id', '=', out.gateRequest.currentSnapshotId!)
        .executeTakeFirstOrThrow(),
    );
    const content = SnapshotContent.parse(snap.content);
    expect(content.subject).toEqual({ type: 'mandate', id: draft.id, key: 'MD-22' });
    expect(content.components).toEqual([
      { type: 'mandate_version', id: out.mandate.currentVersion!.id, version: 1 },
    ]);
    expect(snap.version).toBe(1);
    expect((await analyticsFor(w, A(), 'gate_submitted')).map((e) => e.props)).toEqual([
      { gate: 'G0', snapshotVersion: 1 },
    ]);
    expect((await auditFor(w, A(), out.gateRequest.id)).map((e) => e.action)).toEqual([
      'gate_request.submit',
    ]);
    // Submitted: no further edits or submissions.
    expect((await api(w, API.mandates.submit, m, { params: { ref: draft.id } })).statusCode).toBe(409);
    expect(
      (
        await api(w, API.mandates.saveDraft, m, {
          params: { ref: draft.id },
          ifMatch: 0,
          body: { fields: {} },
        })
      ).statusCode,
    ).toBe(409);
  });
});
