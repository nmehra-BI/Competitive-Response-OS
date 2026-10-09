/**
 * Small building blocks shared by the WS8a screens (overview, mandate, opportunities, compare,
 * my-work, reviews): page header, loading and error states, dates, the case table and the
 * people list. Everything renders with packages/ui components and tokens only.
 */
import type { CaseListRow } from '@growth-os/contracts';
import {
  DataTable,
  Freshness,
  GateChip,
  Icon,
  Mono,
  Person,
  Skeleton,
  StagePill,
  UiLink,
} from '@growth-os/ui';
import { useEffect, type ReactNode } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import './screens.css';

// ---------------------------------------------------------------------------
// Dates (viewer's locale time; journey copy is British English)
// ---------------------------------------------------------------------------

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${fmtDate(iso)}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
export function fmtDateYear(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

// ---------------------------------------------------------------------------
// Page frame
// ---------------------------------------------------------------------------

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Market Expansion`;
  }, [title]);
}

export function Breadcrumb({ items }: { items: { label: ReactNode; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="dx-crumbs">
      <ol>
        {items.map((it, i) => (
          <li key={i}>
            {i > 0 ? <Icon name="chevr" size={12} /> : null}
            {it.href ? (
              <UiLink href={it.href} className="dx-crumbs__link">
                {it.label}
              </UiLink>
            ) : (
              <span aria-current="page">{it.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
  badges,
  titleId,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  badges?: ReactNode;
  titleId?: string;
}) {
  return (
    <header className="dx-head">
      <div className="dx-head__text">
        {breadcrumb}
        <div className="dx-head__titlerow">
          <h1 id={titleId}>{title}</h1>
          {badges}
        </div>
        {subtitle ? <p className="dx-head__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="dx-head__actions">{actions}</div> : null}
    </header>
  );
}

export function LoadingPage({ label }: { label: string }) {
  return (
    <div className="app-page dx-page" aria-busy="true" aria-label={label}>
      <Skeleton height={30} width={320} />
      <Skeleton height={16} width={480} />
      <Skeleton height={220} />
    </div>
  );
}

export function ErrorPage({ title, error }: { title: string; error: unknown }) {
  return (
    <div className="app-page dx-page">
      <PageHeader title={title} />
      <ProblemBanner error={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// People: the tenant directory (`people.list`, D-079), shared with the app shell in lib/people.
// ---------------------------------------------------------------------------

export { usePeople } from '../../lib/people';

// ---------------------------------------------------------------------------
// Case table (S01 and the case list)
// ---------------------------------------------------------------------------

export function CaseTable({
  rows,
  ariaLabel = 'Expansion cases',
}: {
  rows: CaseListRow[];
  ariaLabel?: string;
}) {
  return (
    <DataTable
      ariaLabel={ariaLabel}
      minWidth={1060}
      rowKey={(r) => r.id}
      rowHeader="case"
      rows={rows}
      columns={[
        {
          key: 'case',
          header: 'Case',
          cell: (r) => (
            <UiLink href={`/me/cases/${r.key}`} className="dx-caselink">
              <span className="dx-caselink__title">{r.title}</span>
              <Mono size={12}>{r.key}</Mono>
            </UiLink>
          ),
        },
        {
          key: 'market',
          header: 'Market',
          cell: (r) => <span style={{ display: 'block', minWidth: 140 }}>{r.marketLabel}</span>,
        },
        {
          key: 'owner',
          header: 'Owner',
          cell: (r) => <Person name={r.owner.displayName} initials={r.owner.initials} />,
        },
        { key: 'stage', header: 'Stage', cell: (r) => <StagePill stage={r.stage} /> },
        {
          key: 'gate',
          header: 'Next gate',
          cell: (r) =>
            r.nextGate ? (
              <GateChip status={r.nextGate.status} text={`${r.nextGate.gateCode} · ${r.nextGate.caption}`} />
            ) : (
              <span className="dx-muted">—</span>
            ),
        },
        {
          key: 'blockers',
          header: 'Blockers',
          cell: (r) =>
            r.blockersLabel === 'None' || r.blockersLabel === '—' ? (
              <span className="dx-muted">{r.blockersLabel}</span>
            ) : (
              <span className="dx-inline" style={{ whiteSpace: 'nowrap' }}>
                <Icon name="message" size={13} />
                {r.blockersLabel}
              </span>
            ),
        },
        {
          key: 'evidence',
          header: 'Evidence',
          cell: (r) => <Freshness freshness={r.freshness} detail={r.freshnessDetail} />,
        },
        {
          key: 'latest',
          header: 'Latest update',
          cell: (r) => (
            <span className="dx-muted" style={{ display: 'block', minWidth: 180 }}>
              {r.latestUpdate} · {fmtDate(r.latestUpdateAt)}
            </span>
          ),
        },
      ]}
    />
  );
}
