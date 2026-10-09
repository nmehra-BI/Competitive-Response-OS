/**
 * Acceptance step 26 (WS5): the outcome-review recommendation is stored as a proposal marked "not a
 * decision"; accepting it never records a decision, never moves the case and never writes an outcome.
 * Plus the proposal lifecycle: reject with reason, superseded proposals cannot be decided, role checks.
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
import { createWorkerHarness, type WorkerHarness } from './testing';

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
