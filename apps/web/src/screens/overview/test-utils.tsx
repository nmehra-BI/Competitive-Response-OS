/**
 * Test helpers for the WS8a screen tests: render the real router at a URL against the MSW mocks
 * and reset every mock store (WS7 base state and the screen stores) between tests.
 */
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppProviders } from '../../app/providers';
import { buildRoutes } from '../../app/router';
import { createQueryClient } from '../../lib/query';
import { resetMockState, resetReplay } from '../../mocks/node';
import { comparisonStore } from '../compare/mocks';
import { mandateStore } from '../mandate/mocks';
import { opportunityStore } from '../opportunities/mocks';
import { reviewStore } from '../reviews/mocks';

export function renderAt(url: string) {
  const router = createMemoryRouter(buildRoutes(), { initialEntries: [url] });
  const utils = render(
    <AppProviders client={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { router, ...utils };
}

export function resetAllMocks() {
  resetMockState();
  resetReplay();
  mandateStore.reset();
  opportunityStore.reset();
  comparisonStore.reset();
  reviewStore.reset();
  try {
    sessionStorage.clear();
  } catch {
    /* node */
  }
}
