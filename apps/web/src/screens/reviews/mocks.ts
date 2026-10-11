/**
 * Reviews inbox mocks: gate decisions awaiting the viewer (G2 from the WS7 base, plus G0 for
 * mandates submitted in this tab) and review requests with Confirm / Dispute / Abstain responses
 * that persist per tab. The `tab` query is honoured like the API: awaiting → gate decisions,
 * assigned → open non-finance requests, economics → open finance requests, done → responded.
 */
import { API, type ReviewRequest } from '@growth-os/contracts';
import { cases, fid } from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import { gateDecisionsFor, P, reviewRequests as baseRequests } from '../../mocks/data';
import { mock, MockProblem } from '../../mocks/define';
import { g0DecisionsFor } from '../mandate/mocks';
import { persisted } from '../mandate/mock-kit';

interface Store {
  responses: Record<string, { response: 'confirm' | 'dispute' | 'abstain'; reason: string; at: string }>;
}
export const reviewStore = persisted<Store>('reviews', () => ({ responses: {} }));

const ME102 = cases[1];

/** Every review request in the workspace; the viewer sees only their own. */
function allRequests(): ReviewRequest[] {
  const viewers = [P('daniel').id, P('priya').id];
  const base = viewers.flatMap((v) => baseRequests(v));
  const jonas: ReviewRequest = {
    id: fid('reviewRequest', 3),
    caseId: ME102.id,
    caseKey: ME102.key,
    area: 'commercial',
    targetType: 'assumption',
    targetId: null,
    question: 'Confirm channel reach for Austrian breweries',
    whatToCheck: [
      'Does the partner reach Austrian breweries today?',
      'Feeds the reachable-pool assumption for ME-102',
    ],
    requestedBy: P('maya'),
    reviewer: P('jonas'),
    dueOn: '2026-12-09',
    status: 'open',
    response: null,
    responseReason: null,
    respondedAt: null,
  };
  const responses = reviewStore.get().responses;
  return [...base, jonas].map((r) => {
    const x = responses[r.id];
    return x
      ? { ...r, status: 'responded', response: x.response, responseReason: x.reason, respondedAt: x.at }
      : r;
  });
}

export function reviewRequestsFor(viewerId: string | null): ReviewRequest[] {
  return allRequests().filter((r) => r.reviewer.id === viewerId);
}

export function gateDecisionsAwaiting(viewerId: string | null) {
  return [
    ...gateDecisionsFor(viewerId).map(({ snapshotVersion: _v, ...rest }) => rest),
    ...g0DecisionsFor(viewerId).map(({ snapshotVersion: _v, ...rest }) => rest),
  ];
}

export const handlers: HttpHandler[] = [
  mock(API.work.reviewsInbox, ({ viewerId, query }) => {
    const requests = reviewRequestsFor(viewerId);
    const open = requests.filter((r) => r.status === 'open');
    const decisions = gateDecisionsAwaiting(viewerId);
    switch (query.tab) {
      case 'awaiting':
        return { gateDecisions: decisions, reviewRequests: [] };
      case 'assigned':
        return { gateDecisions: [], reviewRequests: open.filter((r) => r.area !== 'finance') };
      case 'economics':
        return { gateDecisions: [], reviewRequests: open.filter((r) => r.area === 'finance') };
      case 'done':
        return { gateDecisions: [], reviewRequests: requests.filter((r) => r.status !== 'open') };
      default:
        return { gateDecisions: decisions, reviewRequests: requests };
    }
  }),
  mock(API.work.respondToReview, ({ params, body, viewerId }) => {
    const r = reviewRequestsFor(viewerId).find((x) => x.id === params.id);
    if (!r) throw new MockProblem('NOT_FOUND', 'Not found.');
    if (r.status !== 'open') throw new MockProblem('INVALID_TRANSITION', 'You already responded.');
    reviewStore.update((s) => {
      s.responses[r.id] = { response: body.response, reason: body.reason, at: new Date().toISOString() };
    });
    return reviewRequestsFor(viewerId).find((x) => x.id === params.id)!;
  }),
];
