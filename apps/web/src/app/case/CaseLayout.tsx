/**
 * CaseLayout (common.py case_header() + rail() + next_block()): persistent case header with the
 * gate rail and the nine linked tabs. Screens render below in <Outlet/>; the header owns the page
 * <h1>, so case screens start at <h2>. Tabs are links (deep-linkable), not ARIA tabs.
 */
import { API, type CaseHeader as CaseHeaderVM } from '@growth-os/contracts';
import {
  Avatar,
  Button,
  GateRail,
  Icon,
  Skeleton,
  StagePill,
  type CaseHeaderProps,
  type CaseTab,
} from '@growth-os/ui';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { useApiQuery, useCommand } from '../../lib/query';
import { useViewer } from '../../lib/session';
import { CASE_TABS } from '../routes';
import { ProblemBanner } from '../shell/ProblemBanner';

export function tabFromPath(pathname: string): CaseTab {
  const seg = pathname.split('/')[4] ?? 'thesis';
  return (CASE_TABS.find((t) => t.tab === seg)?.tab ?? 'thesis') as CaseTab;
}

export function NextDecisionBlock({ next }: { next: CaseHeaderVM['nextDecision'] }) {
  return (
    <div className="case-next">
      <h2 style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 500 }}>
        Next decision
      </h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {next.decider ? <Avatar initials={next.decider.initials} /> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{next.title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{next.subtitle}</div>
        </div>
      </div>
      {next.blocked && next.why.length ? (
        <details style={{ marginTop: 8, fontSize: 12.5 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--warning-fg)', fontWeight: 500 }}>Why?</summary>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--text-primary)' }}>
            {next.why.map((b) => (
              <li key={b.key}>{b.href ? <Link to={b.href}>{b.message}</Link> : b.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {next.primaryAction ? (
        <Link
          to={next.primaryAction.href}
          className="gos-link"
          style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginTop: 8, fontSize: 12.5 }}
        >
          {next.primaryAction.label}
          <Icon name="chevr" size={13} />
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Discovery → Assessment (cases.transition `start_assessment`, acceptance step 6). Only the case owner
 * may start it, and the server refuses until the market boundary is defined; its reason is shown.
 */
function StartAssessment({ caseRef, ownerId }: { caseRef: string; ownerId: string }) {
  const viewer = useViewer();
  const start = useCommand(API.cases.transition);
  if (viewer.data?.user.id !== ownerId) return null;
  return (
    <div>
      <Button
        variant="primary"
        icon="arrowr"
        disabled={start.isPending}
        disabledReason={start.isPending ? 'Starting…' : undefined}
        onClick={() =>
          start.mutate({
            params: { caseRef },
            body: { command: 'start_assessment', rationale: 'Market boundary defined; assessment starts.' },
          })
        }
      >
        Start assessment
      </Button>
      {start.error ? <ProblemBanner error={start.error} /> : null}
    </div>
  );
}

/** Persistent case header. Implements the frozen CaseHeaderProps (caseRef + active tab). */
export function CaseHeader({ caseRef, activeTab }: CaseHeaderProps) {
  const { data: h, error, isPending } = useApiQuery(API.cases.header, { params: { caseRef } });
  if (isPending) {
    return (
      <section
        aria-label="Case header"
        aria-busy="true"
        className="case-header"
        style={{ paddingBottom: 16 }}
      >
        <Skeleton height={14} width={160} />
        <div style={{ height: 10 }} />
        <Skeleton height={30} width="60%" />
        <div style={{ height: 12 }} />
        <Skeleton height={64} />
      </section>
    );
  }
  if (error || !h) {
    return (
      <section aria-label="Case header" className="case-header" style={{ paddingBottom: 16 }}>
        <ProblemBanner
          error={error}
          actions={
            <Button variant="secondary" href="/me/cases">
              Back to cases
            </Button>
          }
        />
      </section>
    );
  }
  const c = h.case;
  return (
    <section aria-label="Case header" className="case-header">
      <nav aria-label="Breadcrumb" className="case-crumbs">
        <Link to="/me/cases">Expansion cases</Link>
        <Icon name="chevr" size={12} />
        <span className="gos-mono" style={{ fontSize: 12 }} aria-current="page">
          {c.key}
        </span>
      </nav>
      <div className="case-top">
        <div className="case-top__main">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
            <span className="case-key">{c.key}</span>
            <h1 className="case-title">{c.title}</h1>
          </div>
          <div className="case-row">
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12.5,
                color: 'var(--text-tertiary)',
              }}
            >
              Stage <StagePill stage={c.stage} />
            </span>
            <span className="case-chip">
              <Icon name="flag" size={13} />
              {h.mandateLabel}
            </span>
          </div>
          <div className="case-meta">
            <span>
              <Icon name="user" size={14} />
              Owner {c.owner.displayName}
            </span>
            <span>
              <Icon name="users" size={14} />
              Sponsor {c.sponsor.displayName}
            </span>
            <span>
              <Icon name="mappin" size={14} />
              {h.marketLabel}
            </span>
            <span className="gos-mono" style={{ fontSize: 12.5 }}>
              {h.currencyLabel}
            </span>
            <span>
              <Icon name="clock" size={14} />
              {h.freshness.label}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <NextDecisionBlock next={h.nextDecision} />
          {c.stage === 'discovery' ? <StartAssessment caseRef={c.key} ownerId={c.owner.id} /> : null}
        </div>
      </div>
      <div className="case-rail">
        <GateRail
          currentSegment={h.currentSegment}
          nodes={h.rail.map((n) => ({ gateCode: n.gateCode, status: n.status, caption: n.caption }))}
          flag={c.stage === 'on_hold' || c.stage === 'stopped' ? c.stage : undefined}
        />
      </div>
      <nav aria-label="Case sections" className="case-tabs">
        {CASE_TABS.map((t) => {
          const count = h.tabCounts[t.label];
          return (
            <Link
              key={t.tab}
              to={`/me/cases/${encodeURIComponent(c.key)}/${t.tab}`}
              className="case-tab"
              aria-current={t.tab === activeTab ? 'page' : undefined}
            >
              {t.label}
              {count ? (
                <span className="case-tab__count">
                  <span className="gos-sr-only">, </span>
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </section>
  );
}

/** Route element for /me/cases/:caseKey/*. */
export function CaseLayout() {
  const { caseKey } = useParams();
  const { pathname } = useLocation();
  if (!caseKey) return <Navigate to="/me/cases" replace />;
  return (
    <>
      <CaseHeader caseRef={caseKey} activeTab={tabFromPath(pathname)} />
      <Outlet />
    </>
  );
}
