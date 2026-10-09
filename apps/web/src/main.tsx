import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import '@growth-os/ui/tokens.css';
import { ROUTES } from './app/routes';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
});

/** Placeholder element per route until the owning workstream lands its screen. */
function Placeholder({ screen, owner }: { screen: string; owner: string }) {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20 }}>{screen}</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Not built yet · owner {owner}</p>
    </main>
  );
}

const router = createBrowserRouter(
  ROUTES.map((r) => ({ path: r.path, element: <Placeholder screen={r.screen} owner={r.owner} /> })),
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
