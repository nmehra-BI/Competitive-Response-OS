/**
 * S08 Economics MSW handlers, plus the assumption-register endpoints the assessment screens use
 * (assumptions.list, assumptions.dispute, challenges.reply/resolve). Results come from the
 * economics engine; `mock()` validates every response against the contract.
 */
import { API, type Challenge } from '@growth-os/contracts';
import { adoptionDispute, people } from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import { findCase, personRef } from '../../mocks/data';
import { mock, MockProblem } from '../../mocks/define';
import {
  assessment,
  assumptionDisputes,
  CASE_ID,
  CASE_KEY,
  economicsResult,
  nowIso,
  wsId,
} from '../sizing/mock-state';
import { scoped } from '../mandate/mock-kit';
import { assumptionList } from '../validation/mock-data';
import { economicsEngine } from './engine/adapter';
import { committedVersion, economicsCurrent, economicsView, financeReview, setDriver } from './mock-builders';

const notFound = () => new MockProblem('NOT_FOUND', 'Not found.');
/** The fixture adoption dispute's thread is WS8c journey state (../validation); these claim the rest. */
const ownsChallenge = (p: Record<string, string>) => p.id !== adoptionDispute.id;

function requireMe104(caseRef: string) {
  const c = findCase(caseRef);
  if (!c || c.key !== CASE_KEY) throw notFound();
  return c;
}

function findChallenge(id: string): Challenge | null {
  return (
    assumptionDisputes().find((c) => c.id === id) ??
    Object.values(assessment.thesis.challenges).find((c) => c.id === id) ??
    null
  );
}

export const handlers: HttpHandler[] = [
  mock(API.economics.get, async ({ params }) => {
    requireMe104(params.caseRef);
    return economicsView();
  }),

  mock(API.economics.saveDraft, async ({ params, body, ifMatch }) => {
    requireMe104(params.caseRef);
    const d = assessment.economics.draft;
    if (ifMatch !== d.rowVersion)
      throw new MockProblem('VERSION_CONFLICT', 'The economics draft changed elsewhere.');
    const next = structuredClone(d.input);
    for (const x of body.drivers) {
      if (x.inputKey === 'reachable_pool') {
        throw new MockProblem('VALIDATION_FAILED', 'The reachable pool is edited in Sizing.');
      }
      if (!setDriver(next, x.inputKey, x.value)) {
        throw new MockProblem('VALIDATION_FAILED', `Driver ${x.inputKey} cannot be edited.`);
      }
    }
    d.input = next;
    d.rowVersion += 1;
    return economicsView();
  }),

  mock(API.economics.calculateDraft, async ({ params }) => {
    requireMe104(params.caseRef);
    return economicsResult(assessment.economics.draft.input);
  }),

  mock(API.economics.whatMustBeTrue, ({ params, query }) => {
    requireMe104(params.caseRef);
    const input =
      query.version === 'draft' || query.version === undefined
        ? assessment.economics.draft.input
        : economicsCurrent(query.version)?.input;
    if (!input) throw notFound();
    return economicsEngine.breakEven(input, query.targetContributionAfterOpex);
  }),

  mock(API.economics.commit, async ({ params, viewerId }) => {
    requireMe104(params.caseRef);
    const d = assessment.economics.draft;
    const result = await economicsResult(d.input);
    if (result.blocked) {
      throw new MockProblem('CALCULATION_BLOCKED', 'Snapshot blocked by calculation checks.', {
        checks: result.checks.map((c) => ({ key: c.key, message: c.message, blocking: c.blocking })),
      });
    }
    const committed = {
      id: d.id,
      version: d.version,
      input: structuredClone(d.input),
      committedAt: nowIso(),
      committedBy: viewerId!,
    };
    assessment.economics.committed.push(committed);
    assessment.economics.draft = {
      id: wsId(13, d.version + 1),
      version: d.version + 1,
      rowVersion: 1,
      createdAt: committed.committedAt,
      input: structuredClone(d.input),
    };
    return committedVersion(committed);
  }),

  mock(API.economics.requestFinanceReview, ({ params, body }) => {
    requireMe104(params.caseRef);
    const v = assessment.economics.committed.find((c) => c.version === body.economicsVersion);
    if (!v) throw notFound();
    return {
      ...financeReview(),
      id: wsId(23, 100 + body.economicsVersion),
      modelVersionId: v.id,
      reviewer: personRef(body.reviewerId),
      requestedAt: nowIso(),
      dueOn: body.dueOn,
      checkedItems: [],
      notCheckedItems: [],
      statement: null,
    };
  }),

  // ----- Assumption register slice -----
  // assumptions.list is served by the shared register in ../validation (one register for S08–S10).
  mock(API.assumptions.dispute, ({ params, body, viewerId }) => {
    const a = assumptionList().find((x) => x.id === params.id);
    if (!a) throw notFound();
    if (a.owner.id === viewerId) {
      throw new MockProblem('FORBIDDEN', 'You own this assumption. Change its value with a reason instead.');
    }
    if (a.openDispute?.status === 'open') {
      throw new MockProblem('INVALID_TRANSITION', 'This assumption already has an open dispute.');
    }
    const c: Challenge = {
      id: wsId(24, assessment.createdDisputes.length + 1),
      kind: 'dispute',
      targetType: 'assumption',
      targetId: a.id,
      caseId: CASE_ID,
      raisedBy: personRef(viewerId!),
      statement: body.statement,
      proposedValue: body.proposedValueText,
      status: 'open',
      resolution: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: nowIso(),
      replies: [],
    };
    assessment.createdDisputes.push(c);
    return c;
  }),

  scoped(
    API.assumptions.replyToChallenge,
    ownsChallenge,
    mock(API.assumptions.replyToChallenge, ({ params, body, viewerId }) => {
      const c = findChallenge(params.id);
      if (!c) throw notFound();
      const reply = {
        id: wsId(26, Date.now() % 1_000_000),
        author: personRef(viewerId!),
        body: body.body,
        createdAt: nowIso(),
      };
      if (assessment.thesis.challenges[c.targetId]?.id === c.id) {
        const t = assessment.thesis.challenges[c.targetId]!;
        t.replies = [...t.replies, reply];
        return t;
      }
      assessment.disputeReplies[c.id] = [...(assessment.disputeReplies[c.id] ?? []), reply];
      return findChallenge(c.id)!;
    }),
  ),

  scoped(
    API.assumptions.resolveChallenge,
    ownsChallenge,
    mock(API.assumptions.resolveChallenge, ({ params, body, viewerId }) => {
      const c = findChallenge(params.id);
      if (!c) throw notFound();
      if (c.status !== 'open')
        throw new MockProblem('INVALID_TRANSITION', 'This thread is already resolved.');
      if (c.kind === 'dispute' && viewerId !== c.raisedBy.id && viewerId !== people.elena.id) {
        throw new MockProblem(
          'FORBIDDEN',
          'Only the disputing reviewer or the sponsor can resolve a dispute.',
        );
      }
      if (assessment.thesis.challenges[c.targetId]?.id === c.id) {
        const t = assessment.thesis.challenges[c.targetId]!;
        Object.assign(t, {
          status: 'resolved',
          resolution: body.resolution,
          resolvedBy: personRef(viewerId!),
          resolvedAt: nowIso(),
        });
        return t;
      }
      assessment.disputeResolved[c.id] = { resolution: body.resolution, byId: viewerId!, at: nowIso() };
      return findChallenge(c.id)!;
    }),
  ),
];
