/**
 * Router built from the frozen route table (routes.ts). Every route except /login renders inside
 * the AppShell; case routes render inside CaseLayout. Screens come from screens/registry.ts and
 * fall back to a placeholder until their stream lands them.
 */
import { EmptyState, Skeleton } from '@growth-os/ui';
import { lazy, Suspense, useEffect } from 'react';
import { createBrowserRouter, Navigate, useParams, type RouteObject } from 'react-router-dom';
import { SCREENS } from '../screens/registry';
import { LoginPage } from './auth/LoginPage';
import { CaseLayout } from './case/CaseLayout';
import { ROUTES, type RouteId } from './routes';
import { Landing, ShellLayout } from './shell/ShellLayout';

type Def = (typeof ROUTES)[number];

const DesignSystemPage = lazy(() =>
  import('./design-system/DesignSystemPage').then((m) => ({ default: m.DesignSystemPage })),
);

function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Market Expansion`;
  }, [title]);
}

function Placeholder({ def, inCase }: { def: Def; inCase: boolean }) {
  useTitle(def.screen);
  const H = inCase ? 'h2' : 'h1';
  return (
    <div className="app-page">
      <H style={{ margin: '0 0 12px', fontSize: inCase ? 16 : 24, fontWeight: 600 }}>{def.screen}</H>
      <EmptyState title="This screen is not built yet">
        Owner {def.owner}. Deep-link parameters: {def.query.length ? def.query.join(', ') : 'none'}.
      </EmptyState>
    </div>
  );
}

function Screen({ id, inCase = false }: { id: RouteId; inCase?: boolean }) {
  const def = ROUTES.find((r) => r.id === id)!;
  const Comp = SCREENS[id];
  useTitle(def.screen.replace(/^S\d+\s/, ''));
  if (!Comp) return <Placeholder def={def} inCase={inCase} />;
  return (
    <Suspense
      fallback={
        <div className="app-page" aria-busy="true">
          <Skeleton height={24} width={240} />
        </div>
      }
    >
      <Comp />
    </Suspense>
  );
}

function CaseIndex() {
  const { caseKey } = useParams();
  return <Navigate to={`/me/cases/${encodeURIComponent(caseKey ?? '')}/thesis`} replace />;
}

function NotFound() {
  useTitle('Not found');
  return (
    <div className="app-page">
      <h1 style={{ marginBottom: 12 }}>Page not found</h1>
      <EmptyState title="This page could not be found.">Check the link or go back to Overview.</EmptyState>
    </div>
  );
}

const CASE_PREFIX = '/me/cases/:caseKey/';

export function buildRoutes(): RouteObject[] {
  const caseRoutes = ROUTES.filter((r) => r.path.startsWith(CASE_PREFIX));
  const flat = ROUTES.filter(
    (r) => !r.path.startsWith(CASE_PREFIX) && !['login', 'landing', 'designSystem'].includes(r.id),
  );
  return [
    { path: '/login', element: <LoginPage /> },
    {
      element: <ShellLayout />,
      children: [
        { path: '/', element: <Landing /> },
        {
          path: '/design-system',
          element: (
            <Suspense fallback={<div className="app-page" aria-busy="true" />}>
              <DesignSystemPage />
            </Suspense>
          ),
        },
        ...flat.map((r) => ({ path: r.path, element: <Screen id={r.id} /> })),
        {
          path: '/me/cases/:caseKey',
          element: <CaseLayout />,
          children: [
            { index: true, element: <CaseIndex /> },
            ...caseRoutes.map((r) => ({
              path: r.path.slice(CASE_PREFIX.length),
              element: <Screen id={r.id} inCase />,
            })),
          ],
        },
        { path: '*', element: <NotFound /> },
      ],
    },
  ];
}

export function createAppRouter() {
  return createBrowserRouter(buildRoutes());
}
