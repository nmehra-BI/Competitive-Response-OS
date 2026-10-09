/** FROZEN endpoints: auth, viewer, overview, case list, My Work, Reviews inbox, search. */
import { z } from 'zod';
import { CaseStage } from '../enums';
import { AccessScope, DataSourceHealth, Page, PageQuery } from '../http';
import { CaseListRow } from '../entities/case';
import { Viewer } from '../entities/platform';
import { ReviewRequest } from '../entities/gate';
import { WorkItem } from '../entities/execution';
import { ActivityItem } from '../entities/audit';
import { DisplayKey, Id, IsoDateTime, Money, MoneyOrUnavailable, PersonRef } from '../primitives';
import { CaseParams, endpoint, IdParams, Rationale } from './endpoint';

// ----- Auth (pilot: dev persona picker; D-017) -----

export const DevPersona = z.object({
  userId: Id,
  person: PersonRef,
  roleSummary: z.string(), // "BU VP · Sponsor"
  landing: z.string(),
});
export type DevPersona = z.infer<typeof DevPersona>;

export const authEndpoints = {
  listDevPersonas: endpoint({
    id: 'auth.listDevPersonas',
    method: 'GET',
    path: '/auth/dev-personas',
    summary: 'List the Aster personas for the dev login picker. Only when AUTH_MODE=dev.',
    screens: ['LOGIN'],
    prd: ['ME-16'],
    auth: 'dev_only',
    response: z.object({ tenantName: z.string(), personas: z.array(DevPersona) }),
  }),
  devLogin: endpoint({
    id: 'auth.devLogin',
    method: 'POST',
    path: '/auth/dev-login',
    summary: 'Start an interactive human session as the chosen persona. Sets an httpOnly session cookie.',
    screens: ['LOGIN'],
    prd: ['ME-16'],
    auth: 'dev_only',
    body: z.object({ userId: Id }),
    response: Viewer,
    successStatus: 200,
  }),
  logout: endpoint({
    id: 'auth.logout',
    method: 'POST',
    path: '/auth/logout',
    summary: 'End the session.',
    screens: ['SHELL'],
    prd: ['ME-16'],
    response: z.object({}),
    successStatus: 204,
  }),
  me: endpoint({
    id: 'auth.me',
    method: 'GET',
    path: '/me',
    summary: 'Viewer identity, roles, delegated authority and role-based landing route.',
    screens: ['SHELL'],
    prd: ['ME-16'],
    response: Viewer,
  }),
};

// ----- Overview (S01) -----

export const PortfolioOverview = z.object({
  scope: AccessScope,
  businessUnits: z.array(z.object({ id: Id, name: z.string(), accessible: z.boolean() })),
  casesByStage: z.array(z.object({ stage: CaseStage, count: z.number().int() })), // accessible cases only
  decisionsAwaitingViewer: z.array(
    z.object({
      gateRequestId: Id,
      caseKey: DisplayKey,
      buttonLabel: z.string(),
      snapshotVersion: z.number().int(),
      dueText: z.string(),
      href: z.string(),
    }),
  ),
  spend: z.object({
    rows: z.array(
      z.object({
        caseKey: DisplayKey,
        gateLabel: z.string(), // "G2 · Pilot · 90 days"
        statusText: z.string(),
        amount: Money, // approved or requested budget; one-time budgets only
      }),
    ),
    spentToDate: MoneyOrUnavailable,
    note: z.string(),
  }),
  overdueValidation: z.array(
    z.object({ title: z.string(), caseKey: DisplayKey, dueText: z.string(), href: z.string() }),
  ),
  pilotsNeedingReview: z.array(z.object({ caseKey: DisplayKey, dueText: z.string(), href: z.string() })),
  pilotsNeedingReviewNote: z.string().nullable(),
  cases: z.array(CaseListRow),
  casesNote: z.literal(
    'Market sizes are not totalled across cases. Each case has its own market boundary, unit and year.',
  ),
  keyEvents: z.array(ActivityItem),
  dataSources: z.array(DataSourceHealth),
  refreshedAt: IsoDateTime,
});
export type PortfolioOverview = z.infer<typeof PortfolioOverview>;

export const overviewEndpoints = {
  portfolio: endpoint({
    id: 'overview.portfolio',
    method: 'GET',
    path: '/me/overview',
    summary:
      'Executive / operator overview. Only accessible cases; hidden cases are never counted. Never totals TAM.',
    screens: ['S01'],
    prd: ['S01', 'ME-16', 'ME-19'],
    query: z.object({ businessUnitId: Id.optional(), view: z.enum(['portfolio', 'operator']).optional() }),
    response: PortfolioOverview,
  }),
  listCases: endpoint({
    id: 'cases.list',
    method: 'GET',
    path: '/me/cases',
    summary: 'Expansion cases the viewer can access.',
    screens: ['S01'],
    prd: ['ME-16'],
    query: PageQuery.extend({
      stage: CaseStage.optional(),
      businessUnitId: Id.optional(),
      ownerId: Id.optional(),
    }),
    response: Page(CaseListRow).extend({ scope: AccessScope }),
  }),
};

// ----- My Work and Reviews -----

export const workEndpoints = {
  myWork: endpoint({
    id: 'work.mine',
    method: 'GET',
    path: '/my-work',
    summary: 'Tasks, experiments, conditions and review requests owned by the viewer, with the task brief.',
    screens: ['MYWORK'],
    prd: ['ME-12', 'S11'],
    query: z.object({ tab: z.enum(['tasks', 'reviews', 'done']).optional() }),
    response: z.object({
      tabs: z.array(z.object({ key: z.string(), label: z.string(), count: z.number().int() })),
      items: z.array(WorkItem),
      approvalsNotice: z.string().nullable(), // "You approve nothing in this workspace…"
    }),
  }),
  reviewsInbox: endpoint({
    id: 'reviews.inbox',
    method: 'GET',
    path: '/reviews',
    summary: 'Review requests and gate decisions for the viewer ("Awaiting your decision").',
    screens: ['REVIEWS'],
    prd: ['ME-06', 'ME-11'],
    query: z.object({ tab: z.enum(['awaiting', 'assigned', 'economics', 'done']).optional() }),
    response: z.object({
      gateDecisions: z.array(
        z.object({
          gateRequestId: Id,
          caseKey: DisplayKey,
          buttonLabel: z.string(),
          dueText: z.string(),
          href: z.string(),
        }),
      ),
      reviewRequests: z.array(ReviewRequest),
    }),
  }),
  respondToReview: endpoint({
    id: 'reviews.respond',
    method: 'POST',
    path: '/review-requests/:id/response',
    summary: 'Confirm / Dispute / Abstain with a reason. A dispute on an assumption opens a dispute thread.',
    screens: ['REVIEWS', 'S07', 'S08'],
    prd: ['ME-06', 'ME-15'],
    auth: 'human',
    idempotent: true,
    params: IdParams,
    body: z.object({ response: z.enum(['confirm', 'dispute', 'abstain']), reason: z.string().min(1) }),
    response: ReviewRequest,
    successStatus: 200,
  }),
};

// ----- Search (⌘K). Never offers Approve. -----

export const SearchHit = z.object({
  type: z.enum(['case', 'opportunity', 'assumption', 'experiment', 'source', 'mandate']),
  id: Id,
  key: DisplayKey.nullable(),
  title: z.string(),
  subtitle: z.string(),
  href: z.string(),
});
export type SearchHit = z.infer<typeof SearchHit>;

export const searchEndpoints = {
  search: endpoint({
    id: 'search.query',
    method: 'GET',
    path: '/search',
    summary:
      'Find cases, opportunities, assumptions, experiments and sources the viewer can access. Restricted source text is never searched.',
    screens: ['SEARCH'],
    prd: ['ME-16'],
    query: z.object({
      q: z.string().min(1).max(200),
      limit: z.coerce.number().int().min(1).max(25).default(10),
    }),
    response: z.object({ hits: z.array(SearchHit) }),
  }),
};

// ----- Comments (shared component) -----

export const commentEndpoints = {
  addComment: endpoint({
    id: 'comments.add',
    method: 'POST',
    path: '/me/cases/:caseRef/comments',
    summary: 'Comment on any case object. Comments are never material changes.',
    screens: ['S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12'],
    prd: ['ME-17'],
    params: CaseParams,
    body: z.object({ targetType: z.string(), targetId: Id, body: z.string().min(1) }),
    response: z.object({ id: Id }),
  }),
};

export { Rationale };
