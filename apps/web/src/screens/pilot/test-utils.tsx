/** Render the app at a URL on the MSW mocks (shared by the WS8d screen tests). */
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppProviders } from '../../app/providers';
import { buildRoutes } from '../../app/router';
import { createQueryClient } from '../../lib/query';

export function renderAt(url: string) {
  const router = createMemoryRouter(buildRoutes(), { initialEntries: [url] });
  render(
    <AppProviders client={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}
