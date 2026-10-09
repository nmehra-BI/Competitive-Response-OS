/**
 * FROZEN route table (FRONTEND.md §3). App-specific objects live under /me/; shared Growth OS
 * objects (evidence, reviews, my work, admin) keep root URLs so other apps reuse them (research §8.3).
 * Deep-link query params are part of the contract: screens must read and write them.
 */
export interface RouteDef {
  id: string;
  path: string;
  screen: string; // prototype artboard
  /** Query params the screen reads (deep links). */
  query: readonly string[];
  /** Workstream that owns the screen (BUILD_PLAN.md). */
  owner: 'WS7' | 'WS8a' | 'WS8b' | 'WS8c' | 'WS8d';
}

export const ROUTES = [
  { id: 'login', path: '/login', screen: 'Dev persona picker', query: ['next'], owner: 'WS7' },
  { id: 'landing', path: '/', screen: 'Role-based redirect', query: [], owner: 'WS7' },
  { id: 'overview', path: '/me/overview', screen: 'S01 Main', query: ['view', 'bu'], owner: 'WS8a' },
  { id: 'mandates', path: '/me/mandates', screen: 'S02 Mandate list', query: [], owner: 'WS8a' },
  { id: 'mandateNew', path: '/me/mandates/new', screen: 'S02 Mandate', query: [], owner: 'WS8a' },
  {
    id: 'mandate',
    path: '/me/mandates/:mandateKey',
    screen: 'S02 Mandate',
    query: ['version'],
    owner: 'WS8a',
  },
  {
    id: 'opportunities',
    path: '/me/opportunities',
    screen: 'S03 Opportunities',
    query: ['mandate', 'status', 'selected', 'product', 'geo', 'segment'],
    owner: 'WS8a',
  },
  {
    id: 'compare',
    path: '/me/opportunities/compare',
    screen: 'S04 Compare',
    query: ['ids', 'comparison', 'weights'],
    owner: 'WS8a',
  },
  { id: 'cases', path: '/me/cases', screen: 'Case list', query: ['stage', 'owner', 'bu'], owner: 'WS8a' },
  {
    id: 'caseThesis',
    path: '/me/cases/:caseKey/thesis',
    screen: 'S05 Thesis',
    query: ['claim', 'run'],
    owner: 'WS8b',
  },
  {
    id: 'caseSizing',
    path: '/me/cases/:caseKey/sizing',
    screen: 'S06 Sizing',
    query: ['input', 'view', 'version', 'compare', 'scenario'],
    owner: 'WS8b',
  },
  {
    id: 'caseFeasibility',
    path: '/me/cases/:caseKey/feasibility',
    screen: 'S07 Feasibility',
    query: ['dimension'],
    owner: 'WS8b',
  },
  {
    id: 'caseEconomics',
    path: '/me/cases/:caseKey/economics',
    screen: 'S08 Economics',
    query: ['input', 'view', 'version', 'scenario'],
    owner: 'WS8b',
  },
  {
    id: 'caseValidation',
    path: '/me/cases/:caseKey/validation',
    screen: 'S09 Validation',
    query: ['assumption', 'experiment', 'amendment', 'view'],
    owner: 'WS8c',
  },
  {
    id: 'caseDecisions',
    path: '/me/cases/:caseKey/decisions',
    screen: 'S10 Decisions',
    query: ['gate', 'version', 'compare'],
    owner: 'WS8c',
  },
  {
    id: 'caseBrief',
    path: '/me/cases/:caseKey/brief',
    screen: 'Decision brief (read-only)',
    query: ['gate', 'version'],
    owner: 'WS8c',
  },
  {
    id: 'casePilot',
    path: '/me/cases/:caseKey/pilot',
    screen: 'S11 Pilot',
    query: ['task', 'view'],
    owner: 'WS8d',
  },
  {
    id: 'caseOutcomes',
    path: '/me/cases/:caseKey/outcomes',
    screen: 'S12 Outcomes',
    query: ['metric'],
    owner: 'WS8d',
  },
  {
    id: 'caseHistory',
    path: '/me/cases/:caseKey/history',
    screen: 'History (audit)',
    query: ['object', 'id'],
    owner: 'WS8d',
  },
  { id: 'myWork', path: '/my-work', screen: 'My Work', query: ['tab', 'item'], owner: 'WS8a' },
  { id: 'reviews', path: '/reviews', screen: 'Reviews inbox', query: ['tab', 'request'], owner: 'WS8a' },
  { id: 'evidence', path: '/evidence', screen: 'S13 Evidence list', query: ['case'], owner: 'WS8d' },
  {
    id: 'evidenceSource',
    path: '/evidence/:sourceKey',
    screen: 'S13 Evidence',
    query: ['claim', 'passage'],
    owner: 'WS8d',
  },
  { id: 'admin', path: '/admin/:section', screen: 'S14 Admin', query: ['run'], owner: 'WS8d' },
  { id: 'designSystem', path: '/design-system', screen: 'DesignSystem', query: [], owner: 'WS7' },
] as const satisfies readonly RouteDef[];

export type RouteId = (typeof ROUTES)[number]['id'];

export const CASE_TABS = [
  { tab: 'thesis', label: 'Thesis', route: 'caseThesis' },
  { tab: 'sizing', label: 'Sizing', route: 'caseSizing' },
  { tab: 'feasibility', label: 'Feasibility', route: 'caseFeasibility' },
  { tab: 'economics', label: 'Economics', route: 'caseEconomics' },
  { tab: 'validation', label: 'Validation', route: 'caseValidation' },
  { tab: 'decisions', label: 'Decisions', route: 'caseDecisions' },
  { tab: 'pilot', label: 'Pilot', route: 'casePilot' },
  { tab: 'outcomes', label: 'Outcomes', route: 'caseOutcomes' },
  { tab: 'history', label: 'History', route: 'caseHistory' },
] as const;

/** Global navigation (PRD §7, research §8.1: "Cases" in nav, "Expansion case" in titles). */
export const GLOBAL_NAV = [
  { label: 'Overview', to: '/me/overview', icon: 'layout-dashboard' },
  { label: 'Opportunities', to: '/me/opportunities', icon: 'compass' },
  { label: 'Cases', to: '/me/cases', icon: 'briefcase' },
  { label: 'My Work', to: '/my-work', icon: 'square-check' },
  { label: 'Evidence', to: '/evidence', icon: 'file-text' },
  { label: 'Reviews', to: '/reviews', icon: 'scale' },
  { label: 'Administration', to: '/admin/health', icon: 'settings', adminOnly: true },
] as const;

/** Build a path from a route id and params. */
export function pathFor(
  id: RouteId,
  params: Record<string, string> = {},
  query: Record<string, string> = {},
): string {
  const def = ROUTES.find((r) => r.id === id);
  if (!def) throw new Error(`unknown route ${id}`);
  const path = def.path.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(params[k] ?? `:${k}`));
  const qs = new URLSearchParams(query).toString();
  return qs ? `${path}?${qs}` : path;
}
