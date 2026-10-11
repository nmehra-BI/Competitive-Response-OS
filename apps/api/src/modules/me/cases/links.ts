/**
 * Links the API hands to the web app (case header, overview, inbox). Every href must match the
 * frozen route table in apps/web/src/app/routes.ts: `/me/cases/:caseKey/<tab>` with a display key and
 * only the query params that route declares. A link to a path the router does not know renders
 * "This page could not be found." (D-180). Pure; unit-tested in links.test.ts.
 */
import type { GateCode } from '@growth-os/contracts';

/** The case tab segments of the frozen route table (CASE_TABS in apps/web/src/app/routes.ts). */
export const CASE_TAB_SEGMENTS = [
  'thesis',
  'sizing',
  'feasibility',
  'economics',
  'validation',
  'decisions',
  'pilot',
  'outcomes',
  'history',
] as const;
export type CaseTabSegment = (typeof CASE_TAB_SEGMENTS)[number];

/** `/me/cases/ME-104` or `/me/cases/ME-104/<tab>` (display key, never the UUID). */
export const caseHref = (key: string, tab: CaseTabSegment | '' = '') =>
  `/me/cases/${encodeURIComponent(key)}${tab ? `/${tab}` : ''}`;

/** S10 for one gate: `/me/cases/ME-104/decisions?gate=G2`. The screen opens the current snapshot. */
export const decisionHref = (key: string, gate: GateCode) => `${caseHref(key, 'decisions')}?gate=${gate}`;

/** S09 register with one assumption selected (`?assumption=ASM-03`, the display key). */
export const assumptionHref = (key: string, assumptionKey: string) =>
  `${caseHref(key, 'validation')}?assumption=${encodeURIComponent(assumptionKey)}`;

/** S02 mandate by display key (`/me/mandates/MD-21`). */
export const mandateHref = (mandateKey: string) => `/me/mandates/${encodeURIComponent(mandateKey)}`;

/**
 * Where a gate that is not yet awaiting a decision is prepared and its preconditions are shown:
 * G0 on the mandate (S02), G1 from Validation (S09), G2 on Decisions (S10), G3 (scale) from Outcomes
 * (S12); X (and G0 without a mandate) open their request on Decisions.
 */
export function gatePreparationHref(key: string, gate: GateCode, mandateKey: string | null = null): string {
  if (gate === 'G0' && mandateKey) return mandateHref(mandateKey);
  if (gate === 'G1') return caseHref(key, 'validation');
  if (gate === 'G3') return caseHref(key, 'outcomes');
  return decisionHref(key, gate);
}
