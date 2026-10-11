/**
 * D-180: every link into Decisions, the brief and Outcomes resolves to a route of the frozen table
 * (never the `*` "This page could not be found." route) and carries only the query params that route
 * declares. The API-built hrefs (case header "Next decision", S01, Reviews inbox, My Work) are listed
 * with the exact shapes apps/api/src/modules/me/cases/links.ts produces.
 */
import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import { buildRoutes } from './router';
import { CASE_TABS, ROUTES, pathFor } from './routes';

const routes = buildRoutes();

/** The route id an href lands on, or null for the not-found route. */
function routeOf(href: string): { id: string | null; query: string[] } {
  const u = new URL(href, 'http://app');
  const m = matchRoutes(routes, u.pathname) ?? [];
  const leaf = m.at(-1)?.route;
  if (!leaf || leaf.path === '*') return { id: null, query: [...u.searchParams.keys()] };
  const full = m
    .map((x) => x.route.path ?? '')
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/');
  const def = ROUTES.find((r) => r.path === full);
  return { id: def?.id ?? null, query: [...u.searchParams.keys()] };
}

function expectRoute(href: string, id: string) {
  const r = routeOf(href);
  expect(r.id, href).toBe(id);
  const def = ROUTES.find((d) => d.id === id)!;
  for (const k of r.query) expect(def.query as readonly string[], `${href}: ?${k}`).toContain(k);
}

describe('entry points to Decisions, the brief and Outcomes (D-180)', () => {
  it('API-built links: case header, S01 Overview, Reviews inbox, My Work', () => {
    // case header "Open decision package" / S01 "Awaiting decision" / Reviews inbox / My Work
    for (const g of ['G0', 'G1', 'G2', 'G3', 'X'])
      expectRoute(`/me/cases/ME-104/decisions?gate=${g}`, 'caseDecisions');
    // case header "Review preconditions" (G1 → Validation, G2 → Decisions, G3 → Outcomes)
    expectRoute('/me/cases/ME-110/validation', 'caseValidation');
    expectRoute('/me/cases/ME-110/outcomes', 'caseOutcomes');
    // "Review preconditions" on a direct case at G0 → its mandate (S02)
    expectRoute('/me/mandates/MD-22', 'mandate');
    // S01 "Overdue validation" and "Pilots needing review"
    expectRoute('/me/cases/ME-104/validation?assumption=ASM-03', 'caseValidation');
    expectRoute('/me/cases/ME-104/outcomes', 'caseOutcomes');
    // My Work
    expectRoute('/me/cases/ME-104/pilot?task=1', 'casePilot');
    expectRoute('/reviews?request=1', 'reviews');
  });

  it('in-app links: S09 G1/G2, S05, S10 → brief, brief → S10, S12 "Request extension", tabs', () => {
    expectRoute('/me/cases/ME-104/decisions?gate=G1', 'caseDecisions');
    expectRoute('/me/cases/ME-104/decisions?gate=G2', 'caseDecisions');
    expectRoute('/me/cases/ME-104/decisions?gate=X', 'caseDecisions');
    expectRoute('/me/cases/ME-104/brief?gate=G2&version=3', 'caseBrief');
    expectRoute('/me/cases/ME-104/decisions?gate=G2&version=3', 'caseDecisions');
    for (const t of CASE_TABS) expectRoute(`/me/cases/ME-104/${t.tab}`, t.route);
    expectRoute(pathFor('caseOutcomes', { caseKey: 'ME-104' }), 'caseOutcomes');
    expectRoute(pathFor('caseDecisions', { caseKey: 'ME-104' }, { gate: 'G2' }), 'caseDecisions');
  });

  it('the shapes the API used to send are not routes (the reported "could not be found")', () => {
    expect(routeOf('/me/cases/ME-104/decision').id).toBeNull();
    expect(routeOf('/me/cases/ME-104/gates').id).toBeNull();
    expect(routeOf('/me/cases/ME-104/assumptions').id).toBeNull();
  });
});
