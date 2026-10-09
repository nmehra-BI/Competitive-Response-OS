/**
 * Thesis and claims (S05): field provenance (AI → ai_edited, never forged as AI), commit requires the
 * "No entry" alternative, claims with kinds, AI drafts accepted/discarded only by a person, challenges,
 * and the WS5 writer `createClaimFromProposal` (proposed, never accepted).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, Claim, ThesisView } from '@growth-os/contracts';
import { loadIdentity } from '../../../platform/identity';
import { systemTools } from '../../../platform/pipeline';
import { api, auditFor, convertOpp07, inTenant, sourceId, world, type World } from '../cases/test-support';
import { createClaimFromProposal } from './writers';

let w: World;
let caseKey: string;
let caseId: string;
beforeAll(async () => {
  w = await world({ a: 'aster-start', b: 'aster-start' });
  caseKey = await convertOpp07(w, 'a');
  caseId = await inTenant(
    w,
    w.tenants.a!,
    async (tx) =>
      (
        await tx
          .selectFrom('platform.workflow_case')
          .select('id')
          .where('display_key', '=', caseKey)
          .executeTakeFirstOrThrow()
      ).id,
  );
});
afterAll(() => w.close());

const A = () => w.tenants.a!;
const text = (value: string, origin: 'human' | 'ai' = 'human') => ({
  value,
  origin,
  agentRunId: null,
  editedBy: null,
});

async function proposeAiClaim(statement: string): Promise<Claim> {
  return inTenant(w, A(), async (tx) => {
    const session = await tx
      .selectFrom('platform.session')
      .select('id')
      .where('user_id', '=', A().user('maya'))
      .executeTakeFirstOrThrow();
    const identity = (await loadIdentity(tx, {
      sessionId: session.id,
      tenantId: A().tenantId,
      userId: A().user('maya'),
    }))!;
    const t = systemTools(tx, {
      tenantId: A().tenantId,
      correlationId: 'test',
      now: new Date(),
      rule: 'test',
    });
    return createClaimFromProposal(
      t,
      { tenantId: A().tenantId, actorUserId: A().user('maya'), now: new Date(), identity },
      {
        caseId,
        statement,
        sourceIds: [sourceId(A(), 'SRC-021')],
        agentRunId: null as never,
        proposalId: crypto.randomUUID(),
      },
    );
  });
}

describe('thesis', () => {
  it('drafts with field provenance: editing AI text flips it to ai_edited; clients cannot forge AI origin', async () => {
    const m = await w.cookie('a', 'maya');
    const first = await api(w, API.thesis.saveDraft, m, {
      params: { caseRef: caseKey },
      ifMatch: 0,
      body: { fields: { proposition: text('Plants pay for monitoring', 'ai') } },
    });
    expect(first.statusCode).toBe(200);
    let v = ThesisView.parse(first.json());
    expect(v.draft!.fields.proposition.origin).toBe('human');
    // Simulate an AI-drafted field (WS5 writes drafts through proposals; here directly).
    await inTenant(w, A(), (tx) =>
      tx
        .updateTable('me.thesis_version')
        .set({
          fields: JSON.stringify({ ...v.draft!.fields, whyNow: text('Hygiene rules tighten in 2027', 'ai') }),
        })
        .where('id', '=', v.draft!.id)
        .execute(),
    );
    v = ThesisView.parse((await api(w, API.thesis.get, m, { params: { caseRef: caseKey } })).json());
    const edited = await api(w, API.thesis.saveDraft, m, {
      params: { caseRef: caseKey },
      ifMatch: v.draft!.rowVersion,
      body: { fields: { whyNow: text('Hygiene rules tighten in 2027 for dairies') } },
    });
    v = ThesisView.parse(edited.json());
    expect(v.draft!.fields.whyNow).toMatchObject({ origin: 'ai_edited', editedBy: A().user('maya') });
    expect(
      (
        await api(w, API.thesis.saveDraft, await w.cookie('a', 'priya'), {
          params: { caseRef: caseKey },
          ifMatch: 0,
          body: { fields: {} },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('commit needs the "No entry" alternative, then freezes the version', async () => {
    const m = await w.cookie('a', 'maya');
    const refused = await api(w, API.thesis.commit, m, { params: { caseRef: caseKey } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().blockers.map((b: { key: string }) => b.key)).toEqual(['no_entry']);
    const v = ThesisView.parse((await api(w, API.thesis.get, m, { params: { caseRef: caseKey } })).json());
    await api(w, API.thesis.saveDraft, m, {
      params: { caseRef: caseKey },
      ifMatch: v.draft!.rowVersion,
      body: {
        fields: {
          alternatives: [
            {
              id: crypto.randomUUID(),
              name: 'No entry.',
              meaning: 'Stay out',
              status: 'considered_fallback',
              statusText: 'Fallback',
              isNoEntry: true,
            },
          ],
        },
      },
    });
    const ok = await api(w, API.thesis.commit, m, { params: { caseRef: caseKey } });
    expect(ok.statusCode).toBe(201);
    const after = ThesisView.parse(ok.json());
    expect(after).toMatchObject({ draft: null, current: { version: 1, state: 'committed' } });
    expect((await auditFor(w, A(), after.current!.id)).map((e) => e.action)).toContain(
      'thesis.version_committed',
    );
  });

  it('claims have kinds; evidence needs a source; AI drafts are accepted or discarded by a person', async () => {
    const m = await w.cookie('a', 'maya');
    const noSource = await api(w, API.thesis.addClaim, m, {
      params: { caseRef: caseKey },
      body: { statement: 'x', kind: 'evidence', sourceIds: [], assumptionId: null },
    });
    expect(noSource.statusCode).toBe(400);
    const ev = await api(w, API.thesis.addClaim, m, {
      params: { caseRef: caseKey },
      body: {
        statement: 'About 5,000 sites run a water treatment step',
        kind: 'evidence',
        sourceIds: [sourceId(A(), 'SRC-014')],
        assumptionId: null,
      },
    });
    expect(Claim.parse(ev.json())).toMatchObject({
      kind: 'evidence',
      status: 'accepted',
      origin: 'human',
      sources: [{ key: 'SRC-014' }],
    });

    const ai = await proposeAiClaim('About 1,100 sites run the targeted process');
    expect(ai).toMatchObject({ origin: 'ai', status: 'proposed', kind: 'inference_ai', acceptedBy: null });
    expect((await auditFor(w, A(), ai.id)).map((e) => e.action)).toEqual(['claim.created_from_proposal']);
    expect(
      (
        await api(w, API.thesis.acceptClaim, await w.cookie('a', 'daniel'), {
          params: { id: ai.id },
          body: { as: 'inference', editedStatement: null },
        })
      ).statusCode,
    ).toBe(403);
    const acc = await api(w, API.thesis.acceptClaim, m, {
      params: { id: ai.id },
      body: { as: 'assumption', editedStatement: 'About 1,100 sites (trade survey)' },
    });
    expect(Claim.parse(acc.json())).toMatchObject({
      status: 'accepted',
      origin: 'ai_edited',
      kind: 'assumption',
      kindDetail: 'Maya Rao',
      acceptedBy: A().user('maya'),
    });
    expect(
      (
        await api(w, API.thesis.acceptClaim, m, {
          params: { id: ai.id },
          body: { as: 'inference', editedStatement: null },
        })
      ).statusCode,
    ).toBe(409);

    const other = await proposeAiClaim('Unverified');
    const disc = await api(w, API.thesis.discardClaim, m, { params: { id: other.id } });
    expect(Claim.parse(disc.json()).status).toBe('discarded');
    expect(
      (await api(w, API.thesis.discardClaim, await w.cookie('b', 'maya'), { params: { id: other.id } }))
        .statusCode,
    ).toBe(404);
  });

  it('challenges a claim (sent to the owner); the thesis view lists it as a disagreement', async () => {
    const view = ThesisView.parse(
      (await api(w, API.thesis.get, await w.cookie('a', 'daniel'), { params: { caseRef: caseKey } })).json(),
    );
    const claim = view.claims.find((c) => c.kind === 'evidence')!;
    expect(
      (
        await api(w, API.thesis.challengeClaim, await w.cookie('a', 'lena'), {
          params: { id: claim.id },
          body: { statement: 'x' },
        })
      ).statusCode,
    ).toBe(403);
    const res = await api(w, API.thesis.challengeClaim, await w.cookie('a', 'daniel'), {
      params: { id: claim.id },
      body: { statement: 'Census counts include closed sites' },
    });
    expect(res.statusCode).toBe(201);
    const after = ThesisView.parse(
      (await api(w, API.thesis.get, await w.cookie('a', 'maya'), { params: { caseRef: caseKey } })).json(),
    );
    expect(after.claims.find((c) => c.id === claim.id)).toMatchObject({
      status: 'challenged',
      disputed: true,
    });
    expect(after.disagreements.map((d) => d.statement)).toContain('Census counts include closed sites');
  });
});
