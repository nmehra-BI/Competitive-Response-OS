/**
 * Screen registry (shared, append-only †). Each WS8 stream adds ONE line per screen it lands,
 * keyed by the frozen route id in app/routes.ts. Routes without an entry show a placeholder.
 *
 *   caseThesis: lazy(() => import('./thesis/ThesisScreen')),
  caseSizing: lazy(() => import('./sizing/SizingScreen')),
  caseFeasibility: lazy(() => import('./feasibility/FeasibilityScreen')),
  caseEconomics: lazy(() => import('./economics/EconomicsScreen')),
 *
 * Screens default-export a component with no props; they read params with useParams() and deep
 * links with useSearchParams(). Case screens render inside CaseLayout and start at <h2>.
 * Screen-specific MSW handlers live in ./<screen>/mocks.ts (export `handlers`).
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { RouteId } from '../app/routes';

export type ScreenComponent = LazyExoticComponent<ComponentType>;

// Keep `lazy` imported for the one-line entries streams append below.
void lazy;

export const SCREENS: Partial<Record<RouteId, ScreenComponent>> = {
  // ↓ WS8 streams: append one line per screen below this comment.
  caseThesis: lazy(() => import('./thesis/ThesisScreen')),
  caseSizing: lazy(() => import('./sizing/SizingScreen')),
  caseFeasibility: lazy(() => import('./feasibility/FeasibilityScreen')),
  caseEconomics: lazy(() => import('./economics/EconomicsScreen')),
};
