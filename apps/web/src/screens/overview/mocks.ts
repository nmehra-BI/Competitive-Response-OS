/**
 * S01 overview and case-list mocks: the WS7 base view (aster-demo moment) plus what the discovery
 * screens changed in this tab — G0 decisions awaiting the sponsor and cases converted from
 * opportunities (stage Discovery). Hidden cases are never counted; market sizes are never totalled.
 */
import { API, type CaseListRow, type CaseStage } from '@growth-os/contracts';
import type { HttpHandler } from 'msw';
import { people } from '@growth-os/fixtures-aster';
import { caseListRows, overview, personRef } from '../../mocks/data';
import { mock } from '../../mocks/define';
import { g0DecisionsFor } from '../mandate/mocks';
import { mergeCaseRows } from '../opportunities/mocks';

const SCOPE = {
  label: 'Showing BU Water · cases you can access · hidden cases are not counted',
  partial: true,
};

function byStage(rows: CaseListRow[]): { stage: CaseStage; count: number }[] {
  const m = new Map<CaseStage, number>();
  rows.forEach((r) => m.set(r.stage, (m.get(r.stage) ?? 0) + 1));
  return [...m.entries()].map(([stage, count]) => ({ stage, count }));
}

let directCases = 0;

export const handlers: HttpHandler[] = [
  // S01 "New case" (D-149): a direct case at Draft mandate; the owner is the viewer, the sponsor Elena.
  mock(API.cases.createDirect, ({ body, viewerId }) => {
    const now = new Date().toISOString();
    directCases += 1;
    return {
      id: `00000000-0000-4000-8000-0000000c${String(directCases).padStart(4, '0')}`,
      key: `ME-${130 + directCases}`,
      appType: 'market_expansion' as const,
      title: body.title,
      businessUnitId: body.businessUnitId,
      mandateId: '00000000-0000-4000-8000-0000000d0001',
      owner: personRef(body.mandate.ownerId ?? viewerId!),
      sponsor: personRef(body.mandate.sponsorId ?? people.elena.id),
      stage: 'draft_mandate' as const,
      heldFromStage: null,
      originType: 'direct' as const,
      originId: null,
      rowVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
  }),
  mock(API.overview.portfolio, ({ viewerId }) => {
    const base = overview(viewerId);
    const cases = mergeCaseRows(base.cases);
    return {
      ...base,
      cases,
      casesByStage: byStage(cases),
      decisionsAwaitingViewer: [...base.decisionsAwaitingViewer, ...g0DecisionsFor(viewerId)],
    };
  }),
  mock(API.overview.listCases, ({ query }) => ({
    items: mergeCaseRows(caseListRows())
      .filter((r) => !query.stage || r.stage === query.stage)
      .filter((r) => !query.ownerId || r.owner.id === query.ownerId),
    nextCursor: null,
    scope: SCOPE,
  })),
];
