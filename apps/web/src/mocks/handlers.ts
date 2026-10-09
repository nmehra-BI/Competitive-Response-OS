/**
 * MSW handlers built from fixtures/aster (FRONTEND §4 "Dev without the API"). The mock sits at
 * the aster-demo moment (26 Nov 2026: G2 v3 awaiting Elena Fischer's decision).
 *
 * Screen streams add their own handlers in `src/screens/<screen>/mocks.ts` (export `handlers`);
 * they are collected automatically by `allHandlers()` and take precedence over these.
 */
import { API } from '@growth-os/contracts';
import { people } from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import {
  activity,
  adminConnections,
  caseHeader,
  caseListRows,
  decisionPackage,
  devPersonas,
  findCase,
  G2_HASH,
  G2_SNAPSHOT_ID,
  gateDecisionsFor,
  gateRequestById,
  lineage,
  mandateView,
  opportunityList,
  opportunityView,
  overview,
  preconditions,
  reviewRequests,
  search,
  viewerFor,
  workItems,
} from './data';
import { mock, MockProblem, notMockedYet } from './define';
import { session, state } from './state';

const notFound = () => new MockProblem('NOT_FOUND', 'Not found.');
const HUMAN_IDS: Set<string> = new Set(
  Object.values(people)
    .filter((p) => p.kind === 'human')
    .map((p) => p.id),
);

export const handlers: HttpHandler[] = [
  // ----- Auth (dev persona picker) -----
  mock(API.auth.listDevPersonas, () => devPersonas()),
  mock(API.auth.devLogin, ({ body }) => {
    if (!HUMAN_IDS.has(body.userId))
      throw new MockProblem('AGENT_IDENTITY_FORBIDDEN', 'Only people can sign in.');
    session.signIn(body.userId);
    return viewerFor(body.userId);
  }),
  mock(API.auth.logout, () => {
    session.signOut();
    return undefined;
  }),
  mock(API.auth.me, ({ viewerId }) => viewerFor(viewerId!)),

  // ----- Shell: search, overview, case list, inboxes -----
  mock(API.search.search, ({ query }) => ({ hits: search(query.q, query.limit) })),
  mock(API.overview.portfolio, ({ viewerId }) => overview(viewerId)),
  mock(API.overview.listCases, ({ query }) => ({
    items: caseListRows().filter((r) => !query.stage || r.stage === query.stage),
    nextCursor: null,
    scope: { label: 'Showing BU Water · cases you can access · hidden cases are not counted', partial: true },
  })),
  mock(API.work.reviewsInbox, ({ viewerId }) => ({
    gateDecisions: gateDecisionsFor(viewerId),
    reviewRequests: reviewRequests(viewerId),
  })),
  mock(API.work.respondToReview, ({ params, body, viewerId }) => {
    const r = reviewRequests(viewerId).find((x) => x.id === params.id);
    if (!r) throw notFound();
    return {
      ...r,
      status: 'responded' as const,
      response: body.response,
      responseReason: body.reason,
      respondedAt: new Date().toISOString(),
    };
  }),
  mock(API.work.myWork, ({ viewerId }) => {
    const items = workItems(viewerId);
    return {
      tabs: [
        { key: 'tasks', label: 'Tasks', count: items.length },
        { key: 'reviews', label: 'Reviews', count: reviewRequests(viewerId).length },
        { key: 'done', label: 'Done', count: 0 },
      ],
      items,
      approvalsNotice:
        viewerId === people.elena.id
          ? null
          : 'You approve nothing in this workspace. Gate decisions sit with the sponsor.',
    };
  }),

  // ----- Case envelope -----
  mock(API.cases.header, ({ params }) => {
    const c = findCase(params.caseRef);
    if (!c) throw notFound();
    return caseHeader(c);
  }),
  mock(API.cases.activity, ({ params, query }) => {
    if (!findCase(params.caseRef)) throw notFound();
    const items = params.caseRef === 'ME-104' || findCase(params.caseRef)?.key === 'ME-104' ? activity() : [];
    return { items: query.keyOnly ? items.filter((i) => i.keyDecision) : items, nextCursor: null };
  }),

  // ----- Mandate and opportunities (M1) -----
  mock(API.mandates.list, () => ({ items: [mandateView()], nextCursor: null })),
  mock(API.mandates.get, ({ params }) => {
    if (params.ref !== 'MD-21' && params.ref !== mandateView().id) throw notFound();
    return mandateView();
  }),
  mock(API.opportunities.list, ({ query }) => opportunityList(query.status)),
  mock(
    API.opportunities.get,
    ({ params }) =>
      opportunityView(params.ref) ??
      (() => {
        throw notFound();
      })(),
  ),
  mock(API.opportunities.shortlist, ({ params }) => {
    if (!opportunityView(params.ref)) throw notFound();
    state.opportunityStatus[params.ref] = 'shortlisted';
    return opportunityView(params.ref)!;
  }),
  mock(API.opportunities.dismiss, ({ params }) => {
    if (!opportunityView(params.ref)) throw notFound();
    state.opportunityStatus[params.ref] = 'dismissed';
    return opportunityView(params.ref)!;
  }),

  // ----- Gates and decisions (S10) -----
  mock(API.gates.rail, ({ params }) => {
    if (!findCase(params.caseRef)) throw notFound();
    return preconditions(params.gateCode);
  }),
  mock(
    API.gates.get,
    ({ params }) =>
      gateRequestById(params.id) ??
      (() => {
        throw notFound();
      })(),
  ),
  mock(
    API.gates.package,
    ({ params, viewerId }) =>
      decisionPackage(params.id, viewerId) ??
      (() => {
        throw notFound();
      })(),
  ),
  mock(API.gates.decide, ({ params, body, viewerId }) => {
    const pkg = decisionPackage(params.id, viewerId);
    if (!pkg) throw notFound();
    if (viewerId === people.maya.id)
      throw new MockProblem('SELF_APPROVAL_PROHIBITED', 'You authored this package and cannot approve it.');
    if (viewerId === people.admin.id)
      throw new MockProblem('FORBIDDEN', 'Administrators configure policy and never approve gates.');
    if (viewerId !== people.elena.id)
      throw new MockProblem('AUTHORITY_INSUFFICIENT', 'You have no authority for this gate.');
    if (pkg.gateRequest.gateCode !== 'G2' || state.g2Decision) {
      throw new MockProblem('INVALID_TRANSITION', 'This gate has already been decided.');
    }
    if (state.scenario.g2Stale)
      throw new MockProblem('SNAPSHOT_STALE', 'Snapshot v3 is out of date. Refresh to create v4.');
    if (body.snapshotId !== G2_SNAPSHOT_ID || body.snapshotHash !== G2_HASH) {
      throw new MockProblem('SNAPSHOT_HASH_MISMATCH', 'The snapshot you read is not the current one.');
    }
    if (body.disposition === 'approve_with_conditions' && body.conditions.length === 0) {
      throw new MockProblem('VALIDATION_FAILED', 'Add at least one condition or approve without conditions.');
    }
    state.g2Decision = {
      disposition: body.disposition,
      rationale: body.rationale,
      note: body.note,
      by: viewerId,
      at: new Date().toISOString(),
      conditions: body.conditions,
    };
    return decisionPackage(params.id, viewerId)!;
  }),

  // ----- Lineage (S06/S08/S10) -----
  mock(API.lineage.get, ({ params, query }) => {
    const c = findCase(params.caseRef);
    if (!c) throw notFound();
    return (
      lineage(c.key, query.node) ??
      (() => {
        throw notFound();
      })()
    );
  }),

  // ----- Admin -----
  mock(API.admin.connections, () => adminConnections()),
];

type ScreenMockModule = { handlers?: HttpHandler[] };

/** Handlers contributed by screen streams in `src/screens/<screen>/mocks.ts`. */
export function screenHandlers(): HttpHandler[] {
  const mods = import.meta.glob<ScreenMockModule>('../screens/*/mocks.ts', { eager: true });
  return Object.values(mods).flatMap((m) => m.handlers ?? []);
}

/** Screen handlers first (they may override), then these, then the "not mocked yet" fallback. */
export function allHandlers(): HttpHandler[] {
  return [...screenHandlers(), ...handlers, notMockedYet];
}

/** Endpoint ids served by the WS7 base handlers (documented in the WS7 notes). */
export const MOCKED_ENDPOINT_IDS = [
  API.auth.listDevPersonas.id,
  API.auth.devLogin.id,
  API.auth.logout.id,
  API.auth.me.id,
  API.search.search.id,
  API.overview.portfolio.id,
  API.overview.listCases.id,
  API.work.reviewsInbox.id,
  API.work.respondToReview.id,
  API.work.myWork.id,
  API.cases.header.id,
  API.cases.activity.id,
  API.mandates.list.id,
  API.mandates.get.id,
  API.opportunities.list.id,
  API.opportunities.get.id,
  API.opportunities.shortlist.id,
  API.opportunities.dismiss.id,
  API.gates.rail.id,
  API.gates.get.id,
  API.gates.package.id,
  API.gates.decide.id,
  API.lineage.get.id,
  API.admin.connections.id,
] as const;
