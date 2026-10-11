/**
 * D-180: links the API hands to the web app must hit a route of the frozen route table. Before the
 * fix the case header and S01 linked to `/me/cases/ME-104/decision`, `/gates` and `/assumptions`,
 * which the router answers with "This page could not be found."
 */
import { describe, expect, it } from 'vitest';
import { GateCode } from '@growth-os/contracts';
import { CASE_TAB_SEGMENTS, assumptionHref, caseHref, decisionHref, gatePreparationHref } from './links';

/** Path patterns and declared query params of the case routes (apps/web/src/app/routes.ts). */
const CASE_ROUTE_QUERY: Record<string, readonly string[]> = {
  thesis: ['claim', 'run'],
  sizing: ['input', 'view', 'version', 'compare', 'scenario'],
  feasibility: ['dimension'],
  economics: ['input', 'view', 'version', 'scenario'],
  validation: ['assumption', 'experiment', 'amendment', 'view'],
  decisions: ['gate', 'version', 'compare'],
  pilot: ['task', 'view'],
  outcomes: ['metric'],
  history: ['object', 'id'],
};

function expectRoutable(href: string) {
  const u = new URL(href, 'http://x');
  const m = /^\/me\/cases\/([A-Z]+-\d+)\/([a-z]+)$/.exec(u.pathname);
  expect(m, `${href} is not a case tab route`).not.toBeNull();
  const tab = m![2]!;
  expect(CASE_TAB_SEGMENTS as readonly string[]).toContain(tab);
  for (const k of u.searchParams.keys()) expect(CASE_ROUTE_QUERY[tab]).toContain(k);
}

describe('case links (D-180)', () => {
  it('keeps the tab segments in step with the route table', () => {
    expect([...CASE_TAB_SEGMENTS]).toEqual(Object.keys(CASE_ROUTE_QUERY));
  });

  it('opens the decision package on S10 by display key and gate code', () => {
    expect(decisionHref('ME-104', 'G1')).toBe('/me/cases/ME-104/decisions?gate=G1');
    expect(decisionHref('ME-104', 'G2')).toBe('/me/cases/ME-104/decisions?gate=G2');
    expect(decisionHref('ME-104', 'X')).toBe('/me/cases/ME-104/decisions?gate=X');
    for (const g of GateCode.options) expectRoutable(decisionHref('ME-104', g));
  });

  it('sends "Review preconditions" to the screen that prepares each gate', () => {
    expect(gatePreparationHref('ME-110', 'G1')).toBe('/me/cases/ME-110/validation');
    expect(gatePreparationHref('ME-110', 'G2')).toBe('/me/cases/ME-110/decisions?gate=G2');
    expect(gatePreparationHref('ME-110', 'G3')).toBe('/me/cases/ME-110/outcomes');
    // A direct case starts at G0: its mandate (S02) is where G0 is prepared.
    expect(gatePreparationHref('ME-110', 'G0', 'MD-22')).toBe('/me/mandates/MD-22');
    expect(gatePreparationHref('ME-110', 'G0')).toBe('/me/cases/ME-110/decisions?gate=G0');
    for (const g of GateCode.options) expectRoutable(gatePreparationHref('ME-110', g));
  });

  it('links an overdue assumption to the S09 register with it selected', () => {
    expect(assumptionHref('ME-104', 'ASM-03')).toBe('/me/cases/ME-104/validation?assumption=ASM-03');
    expectRoutable(assumptionHref('ME-104', 'ASM-03'));
  });

  it('builds outcomes and other tab links with the display key, never a UUID', () => {
    expect(caseHref('ME-104', 'outcomes')).toBe('/me/cases/ME-104/outcomes');
    expect(caseHref('ME-104')).toBe('/me/cases/ME-104');
    for (const t of CASE_TAB_SEGMENTS) expectRoutable(caseHref('ME-104', t));
  });
});
