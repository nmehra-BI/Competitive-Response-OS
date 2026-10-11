/** Test helpers for the WS8b screens: render a route of the real app against the MSW mocks. */
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppProviders } from '../../app/providers';
import { buildRoutes } from '../../app/router';
import { createQueryClient } from '../../lib/query';
import { mockServer, resetMockState, resetReplay } from '../../mocks/node';
import { resetAssessmentMocks } from './mock-state';

export function renderAt(url: string) {
  const router = createMemoryRouter(buildRoutes(), { initialEntries: [url] });
  const utils = render(
    <AppProviders client={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { router, ...utils };
}

export function resetAll() {
  resetMockState();
  resetReplay();
  resetAssessmentMocks();
}

export { mockServer };
