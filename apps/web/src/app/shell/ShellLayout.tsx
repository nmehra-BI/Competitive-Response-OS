/** Route element that wires AppShell to the session, the reviews inbox count and the draft status. */
import { API } from '@growth-os/contracts';
import { Skeleton } from '@growth-os/ui';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAutosaveState } from '../../lib/drafts';
import { useApiQuery } from '../../lib/query';
import { isUnauthenticated, useLogout, useViewer } from '../../lib/session';
import { AppShell } from './AppShell';
import { ProblemBanner } from './ProblemBanner';

/** Which nav item is active for a path (global nav first, then the workspace group). */
export function activeNavFor(pathname: string): string {
  if (pathname.startsWith('/me/overview')) return 'Overview';
  if (pathname.startsWith('/me/opportunities/compare')) return 'Compare';
  if (pathname.startsWith('/me/opportunities')) return 'Opportunities';
  if (pathname.startsWith('/me/cases')) return 'Cases';
  if (pathname.startsWith('/me/mandates')) return 'Mandates';
  if (pathname.startsWith('/my-work')) return 'My Work';
  if (pathname.startsWith('/evidence')) return 'Evidence';
  if (pathname.startsWith('/reviews')) return 'Reviews';
  if (pathname.startsWith('/admin')) return 'Administration';
  if (pathname.startsWith('/design-system')) return 'Design foundations';
  return '';
}

export function ShellLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const viewer = useViewer();
  const logout = useLogout();
  const autosave = useAutosaveState();
  const inbox = useApiQuery(API.work.reviewsInbox, { query: {} }, { enabled: !!viewer.data });
  if (viewer.isPending) {
    return (
      <div style={{ padding: 24 }} aria-busy="true">
        <Skeleton height={28} width={320} />
      </div>
    );
  }
  if (viewer.error) {
    if (isUnauthenticated(viewer.error)) {
      const next = `${location.pathname}${location.search}`;
      return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
    }
    return (
      <div style={{ padding: 24 }}>
        <ProblemBanner error={viewer.error} />
      </div>
    );
  }
  const waiting =
    (inbox.data?.gateDecisions.length ?? 0) +
    (inbox.data?.reviewRequests.filter((r) => r.status === 'open').length ?? 0);
  return (
    <AppShell
      viewer={viewer.data}
      activeNav={activeNavFor(location.pathname)}
      counts={waiting ? { Reviews: waiting } : {}}
      illustrative={viewer.data.tenant.illustrative}
      autosave={autosave ?? undefined}
      onSignOut={async () => {
        await logout();
        navigate('/login');
      }}
    >
      <Outlet />
    </AppShell>
  );
}

/** "/" — role-based landing (research §8.2). */
export function Landing() {
  const viewer = useViewer();
  if (!viewer.data) return null;
  return <Navigate to={viewer.data.landing} replace />;
}
