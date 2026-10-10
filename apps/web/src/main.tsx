import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import '@growth-os/ui/tokens.css';
import '@growth-os/ui/components.css';
import './app/app.css';
import { AppProviders } from './app/providers';
import { createAppRouter } from './app/router';
import { createQueryClient } from './lib/query';
import { applyTheme, readTheme } from './lib/theme';

async function start() {
  applyTheme(readTheme());
  // Dev without the API: MSW serves fixtures/aster (FRONTEND §4). Never bundled into a real run
  // unless VITE_MSW=on is set at build time (the e2e harness does this for mock-backed runs).
  if (import.meta.env.VITE_MSW === 'on') {
    const { startMockWorker } = await import('./mocks/browser');
    await startMockWorker();
  }
  const queryClient = createQueryClient();
  const router = createAppRouter();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProviders client={queryClient}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  );
}

void start();
