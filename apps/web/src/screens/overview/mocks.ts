/**
 * S01 overview and case-list mocks: the WS7 base view (aster-demo moment) plus what the discovery
 * screens changed in this tab — G0 decisions awaiting the sponsor and cases converted from
 * opportunities (stage Discovery). Hidden cases are never counted; market sizes are never totalled.
 */
import { API, type CaseListRow, type CaseStage } from '@growth-os/contracts';
import type { HttpHandler } from 'msw';
import { caseListRows, overview } from '../../mocks/data';
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

export const handlers: HttpHandler[] = [
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
