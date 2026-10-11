/**
 * Acceptance step 26 (WS5): the outcome-review recommendation is stored as a proposal marked "not a
 * decision"; accepting it never records a decision, never moves the case and never writes an outcome.
 * Plus the proposal lifecycle: reject with reason, superseded proposals cannot be decided, role checks,
 * and the one-step "Accept as fact" for an unedited, cited claim (D-116, D-131).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, AnalysisRun, Proposal } from '@growth-os/contracts';
import { withTenant } from '@growth-os/db';
import { NOT_A_DECISION } from '@growth-os/ai';
import { z } from 'zod';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../platform/testing';
import { agentCookie, createWorkerHarness, type WorkerHarness } from './testing';

let t: TestApp;
let w: WorkerHarness;
let a: SeededTenant;
let b: SeededTenant;
const cookie: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestApp();
  w = createWorkerHarness();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  for (const who of ['maya', 'elena', 'daniel'] as const) cookie[who] = await login(t.app, a.user(who));
  cookie.mayaB = await login(t.app, b.user('maya'));
});
afterAll(async () => {
  await w.close();
  await t.close();
});

const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, fn);

async function runOutcomeReview(): Promise<Proposal[]> {
  const res = await call(t.app, API.analysis.start, {
    params: { caseRef: 'ME-104' },
    cookie: cookie.maya,
    idempotencyKey: true,
    body: { skill: 'outcome-review', goal: 'Draft the pilot review' },
  });
  const run = AnalysisRun.parse(res.json());
  expect(await w.run(a.tenantId, run.id)).toBe('completed');
  const list = await call(t.app, API.analysis.proposals, {
    params: { caseRef: 'ME-104' },
    cookie: cookie.maya,
  });
  return z
    .object({ items: z.array(Proposal) })
    .parse(list.json())
    .items.filter((p) => p.runId === run.id);
}

const decide = (id: string, c: string, body: Record<string, unknown>) =>
  call(t.app, API.analysis.decideProposal, {
    params: { id },
    cookie: c,
    idempotencyKey: true,
    body: { reason: null, ...body },
  });

const facts = () =>
  inA(async (tx) => ({
    decisions: (await tx.selectFrom('platform.decision_record').select('id').execute()).length,
    reviews: (await tx.selectFrom('me.outcome_review').select('id').execute()).length,
    observations: (await tx.selectFrom('platform.outcome_observation').select('id').execute()).length,
    approvals: (await tx.selectFrom('platform.approval').select('id').execute()).length,
    stage: (
      await tx
        .selectFrom('platform.workflow_case')
        .select('stage')
        .where('display_key', '=', 'ME-104')
        .executeTakeFirstOrThrow()
    ).stage,
  }));

describe('outcome review recommendation (step 26)', () => {
  it('is stored as a proposal marked "Recommendation · not a decision"', async () => {
    const props = await runOutcomeReview();
    const rec = props.find((p) => p.payload.type === 'outcome_review_draft')!;
    expect(rec.status).toBe('proposed');
    expect(rec.payload).toMatchObject({ recommendedOutcome: 'extend' });
    expect(
      rec.payload.type === 'outcome_review_draft' && rec.payload.rationale.startsWith(NOT_A_DECISION),
    ).toBe(true);
  });

  it('accepting it never records a decision, an outcome or an approval, and never moves the case', async () => {
    const before = await facts();
    const props = await runOutcomeReview();
    const rec = props.find((p) => p.payload.type === 'outcome_review_draft')!;
    const res = await decide(rec.id, cookie.maya!, { decision: 'accept' });
    expect(res.statusCode).toBe(200);
    expect(Proposal.parse(res.json())).toMatchObject({
      status: 'accepted',
      targetType: null,
      targetId: null,
    });
    expect(await facts()).toEqual(before);
    const audit = await inA((tx) =>
      tx
        .selectFrom('platform.audit_event')
        .select(['action', 'summary'])
        .where('object_id', '=', rec.id)
        .executeTakeFirstOrThrow(),
    );
    expect(audit.action).toBe('proposal.accepted');
    expect(audit.summary).toContain('recommendation only, not a decision');
  });

  it('reject keeps the reason; a regenerated run supersedes pending proposals, which cannot then be decided', async () => {
    const first = await runOutcomeReview();
    const claim = first.find((p) => p.payload.type === 'claim')!;
    const rej = await decide(claim.id, cookie.maya!, { decision: 'reject', reason: 'Too early to say' });
    expect(Proposal.parse(rej.json())).toMatchObject({
      status: 'rejected',
      decidedBy: { id: a.user('maya') },
    });
    const rec = first.find((p) => p.payload.type === 'outcome_review_draft')!;
    await runOutcomeReview();
    const stale = await decide(rec.id, cookie.maya!, { decision: 'accept' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().title).toBe('A newer analysis replaced this proposal.');
    const rejected = await call(t.app, API.analysis.proposals, {
      params: { caseRef: 'ME-104' },
      cookie: cookie.maya,
      query: { status: 'rejected' },
    });
    expect(
      z
        .object({ items: z.array(Proposal) })
        .parse(rejected.json())
        .items.map((p) => p.id),
    ).toContain(claim.id);
  });

  it('only a person with proposal rights decides: sponsor 403, other tenant 404, wrong type edit 400', async () => {
    const props = await runOutcomeReview();
    const rec = props.find((p) => p.payload.type === 'outcome_review_draft')!;
    expect((await decide(rec.id, cookie.elena!, { decision: 'accept' })).statusCode).toBe(403);
    expect((await decide(rec.id, cookie.daniel!, { decision: 'accept' })).statusCode).toBe(403);
    expect((await decide(rec.id, cookie.mayaB!, { decision: 'accept' })).statusCode).toBe(404);
    const wrong = await decide(rec.id, cookie.maya!, {
      decision: 'accept',
      editedPayload: { type: 'message_draft', title: 'x', body: 'y' },
    });
    expect(wrong.statusCode).toBe(400);
    const edited = await decide(rec.id, cookie.maya!, {
      decision: 'accept',
      editedPayload: { ...rec.payload, recommendedOutcome: 'revise' },
    });
    expect(Proposal.parse(edited.json())).toMatchObject({
      status: 'edited_and_accepted',
      payload: { recommendedOutcome: 'revise' },
    });
  });
});

// ---------------------------------------------------------------------------
// One-step "Accept as fact" (D-116, D-131)
// ---------------------------------------------------------------------------

async function runSizing(): Promise<Proposal[]> {
  const res = await call(t.app, API.analysis.start, {
    params: { caseRef: 'ME-104' },
    cookie: cookie.maya,
    idempotencyKey: true,
    body: { skill: 'bottom-up-sizing', goal: 'Bottom-up sizing claims' },
  });
  const run = AnalysisRun.parse(res.json());
  expect(await w.run(a.tenantId, run.id)).toBe('completed');
  const list = await call(t.app, API.analysis.proposals, {
    params: { caseRef: 'ME-104' },
    cookie: cookie.maya,
  });
  return z
    .object({ items: z.array(Proposal) })
    .parse(list.json())
    .items.filter((p) => p.runId === run.id);
}

const cited = (ps: Proposal[]) =>
  ps.find((p) => p.payload.type === 'claim' && p.payload.claim.evidenceIds.length > 0)!;
const uncited = (ps: Proposal[]) =>
  ps.find((p) => p.payload.type === 'claim' && p.payload.claim.evidenceIds.length === 0)!;

const claimFacts = () =>
  inA(async (tx) => ({
    claims: (await tx.selectFrom('platform.claim').select('id').execute()).length,
    accepted: (await tx.selectFrom('platform.claim').select('id').where('status', '=', 'accepted').execute())
      .length,
  }));

describe('one-step "Accept as fact" (D-116, D-131)', () => {
  it('offers it on an unedited claim whose every citation opens; uncited claims and other types do not', async () => {
    const props = await runSizing();
    expect(cited(props).oneStepAccept).toEqual({ available: true, reason: null });
    expect(uncited(props).oneStepAccept).toEqual({
      available: false,
      reason: 'No citation: add it as a draft, then decide.',
    });
    expect(props.find((p) => p.payload.type === 'assumption_value')!.oneStepAccept).toBeUndefined();
    // The sponsor may read proposals but not accept AI claims: never offered.
    const asElena = await call(t.app, API.analysis.proposals, {
      params: { caseRef: 'ME-104' },
      cookie: cookie.elena,
    });
    const forElena = z.object({ items: z.array(Proposal) }).parse(asElena.json()).items;
    expect(forElena.find((p) => p.id === cited(props).id)!.oneStepAccept).toEqual({
      available: false,
      reason: 'Your role does not accept AI claims.',
    });
  });

  it('one human act accepts the proposal and the claim as fact, with both audit events in one transaction', async () => {
    const p = cited(await runSizing());
    const before = await claimFacts();
    const key = crypto.randomUUID();
    const res = await call(t.app, API.analysis.decideProposal, {
      params: { id: p.id },
      cookie: cookie.maya,
      idempotencyKey: key,
      body: { decision: 'accept', reason: null, acceptAsFact: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    const out = Proposal.parse(res.json());
    expect(out).toMatchObject({ status: 'accepted', targetType: 'claim', decidedBy: { id: a.user('maya') } });
    expect(out.oneStepAccept).toEqual({
      available: false,
      reason: 'This proposal has already been decided.',
    });
    const claim = await inA((tx) =>
      tx
        .selectFrom('platform.claim')
        .select(['status', 'origin', 'kind', 'accepted_by', 'agent_run_id'])
        .where('id', '=', out.targetId!)
        .executeTakeFirstOrThrow(),
    );
    expect(claim).toMatchObject({
      status: 'accepted',
      origin: 'ai',
      kind: 'evidence',
      accepted_by: a.user('maya'),
      agent_run_id: p.runId,
    });
    const audit = await inA((tx) =>
      tx
        .selectFrom('platform.audit_event')
        .select(['action', 'object_id', 'correlation_id', 'actor_kind'])
        .where('object_id', 'in', [p.id, out.targetId!])
        .orderBy('seq')
        .execute(),
    );
    expect(audit.map((x) => x.action)).toEqual([
      'claim.created_from_proposal',
      'claim.accepted',
      'proposal.accepted',
    ]);
    expect(new Set(audit.map((x) => x.correlation_id)).size).toBe(1);
    expect(audit.every((x) => x.actor_kind === 'human')).toBe(true);
    expect(await claimFacts()).toEqual({ claims: before.claims + 1, accepted: before.accepted + 1 });
    // Replay with the same key: the same answer, nothing written twice.
    const replay = await call(t.app, API.analysis.decideProposal, {
      params: { id: p.id },
      cookie: cookie.maya,
      idempotencyKey: key,
      body: { decision: 'accept', reason: null, acceptAsFact: true },
    });
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual(res.json());
    expect(await claimFacts()).toEqual({ claims: before.claims + 1, accepted: before.accepted + 1 });
    // The thesis shows it as an accepted claim (no longer an AI draft).
    const thesis = await call(t.app, API.thesis.get, { params: { caseRef: 'ME-104' }, cookie: cookie.maya });
    expect(
      (thesis.json() as { claims: { id: string; status: string }[] }).claims.find(
        (x) => x.id === out.targetId,
      ),
    ).toMatchObject({ status: 'accepted' });
  });

  it('an edited payload, an uncited claim or a non-claim with acceptAsFact → 400 and nothing is written', async () => {
    const props = await runSizing();
    const p = cited(props);
    const before = await claimFacts();
    const edited = await decide(p.id, cookie.maya!, {
      decision: 'accept',
      acceptAsFact: true,
      editedPayload: {
        ...p.payload,
        claim: { ...(p.payload as { claim: object }).claim, statement: 'About 5,200 sites' },
      },
    });
    expect(edited.statusCode).toBe(400);
    expect(edited.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      title: 'An edited claim is added as a draft first; accept it as fact in a second step.',
    });
    const none = await decide(uncited(props).id, cookie.maya!, { decision: 'accept', acceptAsFact: true });
    expect(none.statusCode).toBe(400);
    expect(none.json().title).toBe('No citation: add it as a draft, then decide.');
    const other = props.find((x) => x.payload.type === 'assumption_value')!;
    expect(
      (await decide(other.id, cookie.maya!, { decision: 'accept', acceptAsFact: true })).statusCode,
    ).toBe(400);
    const reject = await decide(p.id, cookie.maya!, { decision: 'reject', acceptAsFact: true });
    expect(reject.statusCode).toBe(400);
    expect(await claimFacts()).toEqual(before);
    const still = await inA((tx) =>
      tx
        .selectFrom('platform.proposal')
        .select('status')
        .where('id', 'in', [p.id, uncited(props).id, other.id])
        .execute(),
    );
    expect(still.every((x) => x.status === 'proposed')).toBe(true);
    // "Add as draft" stays available: accepting without acceptAsFact writes an AI draft claim.
    const draft = await decide(p.id, cookie.maya!, { decision: 'accept' });
    expect(draft.statusCode).toBe(200);
    const claim = await inA((tx) =>
      tx
        .selectFrom('platform.claim')
        .select('status')
        .where('id', '=', Proposal.parse(draft.json()).targetId!)
        .executeTakeFirstOrThrow(),
    );
    expect(claim.status).toBe('proposed');
  });

  it('a citation that does not open for the viewer (restricted source) → not offered, 400, nothing written', async () => {
    const p = cited(await runSizing());
    const sourceId = await inA(
      async (tx) =>
        (
          await tx
            .selectFrom('platform.source')
            .select('id')
            .where('display_key', '=', 'SRC-014')
            .executeTakeFirstOrThrow()
        ).id,
    );
    await withTenant(w.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, (tx) =>
      tx
        .updateTable('platform.source')
        .set({ availability: 'restricted' })
        .where('id', '=', sourceId)
        .execute(),
    );
    try {
      const list = await call(t.app, API.analysis.proposals, {
        params: { caseRef: 'ME-104' },
        cookie: cookie.maya,
      });
      const listed = z
        .object({ items: z.array(Proposal) })
        .parse(list.json())
        .items.find((x) => x.id === p.id)!;
      expect(listed.oneStepAccept).toEqual({
        available: false,
        reason: 'A citation does not open for you: add it as a draft, then decide.',
      });
      const before = await claimFacts();
      const res = await decide(p.id, cookie.maya!, { decision: 'accept', acceptAsFact: true });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(JSON.stringify(res.json())).not.toContain('SRC-014');
      expect(await claimFacts()).toEqual(before);
    } finally {
      await withTenant(w.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, (tx) =>
        tx
          .updateTable('platform.source')
          .set({ availability: 'available' })
          .where('id', '=', sourceId)
          .execute(),
      );
    }
  });

  it('agents are refused; the sponsor 403; another tenant 404', async () => {
    const p = cited(await runSizing());
    const agent = await agentCookie(t.db, a.tenantId, a.user('analysisAgent'));
    const asAgent = await decide(p.id, agent, { decision: 'accept', acceptAsFact: true });
    expect(asAgent.statusCode).toBe(403);
    expect(asAgent.json()).toMatchObject({ code: 'AGENT_IDENTITY_FORBIDDEN' });
    expect((await decide(p.id, cookie.elena!, { decision: 'accept', acceptAsFact: true })).statusCode).toBe(
      403,
    );
    expect((await decide(p.id, cookie.mayaB!, { decision: 'accept', acceptAsFact: true })).statusCode).toBe(
      404,
    );
    const still = await inA((tx) =>
      tx.selectFrom('platform.proposal').select('status').where('id', '=', p.id).executeTakeFirstOrThrow(),
    );
    expect(still.status).toBe('proposed');
  });
});
