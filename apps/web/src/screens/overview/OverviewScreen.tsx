/**
 * S01 Portfolio / operator overview (prototype: Main.dc.html). Attention cards first, then the
 * case table and key events. Only accessible cases are counted; market sizes are never totalled;
 * one-time gate budgets are shown as approved vs requested, never added to market measures.
 */
import { API, CASE_STAGE_LABELS, type PortfolioOverview } from '@growth-os/contracts';
import {
  ActivityTimelineView,
  Banner,
  Button,
  ChartTable,
  GateDiamond,
  Icon,
  Mono,
  SectionHeader,
  SegmentedControl,
  UiLink,
  formatBudget,
  formatNotAvailable,
} from '@growth-os/ui';
import { useId, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApiQuery } from '../../lib/query';
import {
  CaseTable,
  ErrorPage,
  fmtDate,
  fmtDateTime,
  LoadingPage,
  PageHeader,
  useDocumentTitle,
} from './shared';

const UUID = /^[0-9a-f-]{36}$/i;
type View = 'portfolio' | 'operator';

function StatCard({
  title,
  children,
  more,
}: {
  title: string;
  children: ReactNode;
  more?: { href: string; label: string } | null;
}) {
  const id = useId();
  return (
    <section className="dx-stat" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
      {more ? (
        <UiLink href={more.href} className="dx-stat__more">
          {more.label}
          <Icon name="chevr" size={13} />
        </UiLink>
      ) : null}
    </section>
  );
}

function Big({ n, sub }: { n: number; sub: string }) {
  return (
    <div className="dx-big">
      <span className="dx-big__n">{n}</span>
      <span className="dx-big__sub">{sub}</span>
    </div>
  );
}

function SpendCard({ spend }: { spend: PortfolioOverview['spend'] }) {
  const max = Math.max(1, ...spend.rows.map((r) => Number(r.amount.amount)));
  const currency = spend.rows[0]?.amount.currency ?? 'EUR';
  const keys = [...new Set(spend.rows.map((r) => r.caseKey))].join(', ');
  const spent =
    'unavailable' in spend.spentToDate
      ? formatNotAvailable(spend.spentToDate.reason)
      : formatBudget(spend.spentToDate.amount, spend.spentToDate.currency);
  return (
    <StatCard title="Approved vs requested spend">
      <ChartTable
        caption={`${keys || 'No case'} · one-time budgets · ${currency}`}
        chart={
          <div className="dx-spend" role="img" aria-label={`Approved versus requested budget, ${keys}`}>
            {spend.rows.map((r) => {
              const approved = r.amount.measure === 'approved_budget';
              return (
                <div key={`${r.caseKey}-${r.gateLabel}`}>
                  <div className="dx-spend__row">
                    <span className="dx-inline">
                      <GateDiamond status={approved ? 'approved' : 'awaiting_decision'} size={14} />
                      {approved ? 'Approved' : 'Requested'} · {r.gateLabel}
                    </span>
                    <b>{formatBudget(r.amount.amount, r.amount.currency)}</b>
                  </div>
                  <div className="dx-spend__track">
                    <div
                      className={`dx-spend__fill dx-spend__fill--${approved ? 'approved' : 'requested'}`}
                      style={{ width: `${(Number(r.amount.amount) / max) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        }
        table={{
          ariaLabel: 'Approved and requested budgets',
          minWidth: 260,
          rowKey: (r) => r.key,
          rows: [
            ...spend.rows.map((r) => ({
              key: `${r.caseKey}-${r.gateLabel}`,
              gate: `${r.caseKey} · ${r.gateLabel}`,
              status: r.statusText,
              amount: formatBudget(r.amount.amount, r.amount.currency),
            })),
            { key: 'spent', gate: 'Spent to date', status: spent, amount: '—' },
          ],
          columns: [
            { key: 'gate', header: 'Gate', cell: (r) => r.gate },
            { key: 'status', header: 'Status', cell: (r) => r.status },
            { key: 'amount', header: 'Amount', numeric: true, cell: (r) => r.amount },
          ],
        }}
      />
      <p className="dx-note" style={{ marginTop: 10 }}>
        {'unavailable' in spend.spentToDate ? (
          <span className="dx-note__icon">
            <Icon name="alert" size={13} />
          </span>
        ) : null}
        <span>
          Spent to date: {spent}. {spend.note}
        </span>
      </p>
    </StatCard>
  );
}

export default function OverviewScreen() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'operator' ? 'operator' : 'portfolio';
  const bu = params.get('bu');
  const title = view === 'operator' ? 'Operator overview' : 'Portfolio overview';
  useDocumentTitle(title);
  const q = useApiQuery(API.overview.portfolio, {
    query: { view, businessUnitId: bu && UUID.test(bu) ? bu : undefined },
  });
  if (q.isPending) return <LoadingPage label={title} />;
  if (q.error) return <ErrorPage title={title} error={q.error} />;
  const d = q.data;
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next, { replace: true });
  };
  const accessible = d.businessUnits.filter((b) => b.accessible);
  const unavailable = d.dataSources.filter((s) => !s.available);
  const finance = unavailable.find((s) => s.key === 'finance');
  const others = unavailable.filter((s) => s.key !== 'finance');
  const total = d.casesByStage.reduce((n, s) => n + s.count, 0);
  const maxStage = Math.max(1, ...d.casesByStage.map((s) => s.count));

  const header = (
    <PageHeader
      title={title}
      subtitle={d.scope.label}
      actions={
        <>
          <SegmentedControl<View>
            ariaLabel="Overview for"
            value={view}
            onChange={(v) => set('view', v)}
            options={[
              { value: 'portfolio', label: 'Portfolio' },
              { value: 'operator', label: 'Operator' },
            ]}
          />
          <label className="dx-inline dx-muted" style={{ fontSize: 13 }}>
            Business unit
            <select
              className="gos-select"
              style={{ width: 'auto', minHeight: 36 }}
              value={bu ?? accessible[0]?.id ?? ''}
              onChange={(e) => set('bu', e.target.value)}
            >
              {d.businessUnits.map((b) => (
                <option key={b.id} value={b.id} disabled={!b.accessible}>
                  {b.accessible ? b.name : `${b.name} · no access`}
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" icon="plus" href="/me/mandates/new">
            Create mandate
          </Button>
        </>
      }
    />
  );

  if (d.cases.length === 0) {
    return (
      <div className="app-page dx-page">
        {header}
        <div className="dx-empty-center" style={{ padding: '64px 24px' }}>
          <span className="dx-muted">
            <Icon name="compass" size={22} />
          </span>
          <h2 style={{ margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600 }}>
            No expansion cases yet
          </h2>
          <p>
            Start with a mandate: what you may look for, under which constraints, and who owns it. Your
            sponsor approves it at G0.
          </p>
          <Button variant="primary" icon="plus" href="/me/mandates/new">
            Create a mandate
          </Button>
        </div>
      </div>
    );
  }

  const decision = d.decisionsAwaitingViewer[0];
  return (
    <div className="app-page dx-page">
      {header}
      {finance ? (
        <Banner
          tone="warn"
          title={`Finance source unavailable · spend last refreshed ${fmtDateTime(finance.lastRefreshedAt)}`}
          body="Approved and requested budgets come from gate records and are current. Spent-to-date figures are hidden until finance data returns."
        />
      ) : null}
      {others.length ? (
        <p className="dx-note">
          <span className="dx-note__icon">
            <Icon name="alert" size={13} />
          </span>
          <span>
            Also unavailable:{' '}
            {others.map((s) => `${s.name}${s.message ? ` (${s.message})` : ''}`).join(' · ')}
          </span>
        </p>
      ) : null}

      <div className="dx-cards">
        <StatCard title="Cases by stage" more={{ href: '/me/cases', label: 'Open cases' }}>
          <Big n={total} sub="cases you can access" />
          <ul className="dx-stage-list">
            {d.casesByStage.map((s) => (
              <li key={s.stage}>
                <span className="dx-inline">
                  {s.stage === 'stopped' ? <Icon name="squarestop" size={12} /> : null}
                  {CASE_STAGE_LABELS[s.stage]}
                </span>
                <span
                  aria-hidden="true"
                  className={s.stage === 'stopped' ? 'dx-bar dx-bar--muted' : 'dx-bar'}
                  style={{ width: `${(s.count / maxStage) * 100}%` }}
                />
                <span style={{ textAlign: 'right', fontWeight: 600 }}>{s.count}</span>
              </li>
            ))}
          </ul>
        </StatCard>

        <StatCard
          title="Decisions awaiting you"
          more={decision ? { href: decision.href, label: 'Open decision brief' } : null}
        >
          <Big n={d.decisionsAwaitingViewer.length} sub="awaiting you" />
          {d.decisionsAwaitingViewer.map((x) => (
            <UiLink key={x.gateRequestId} href={x.href} className="dx-linkcard">
              <GateDiamond status="awaiting_decision" size={16} />
              <span className="dx-linkcard__text">
                <span className="dx-linkcard__title">{x.buttonLabel}</span>
                <span className="dx-small dx-muted">
                  <Mono size={12}>{x.caseKey}</Mono> · v{x.snapshotVersion} · {x.dueText}
                </span>
              </span>
            </UiLink>
          ))}
          {d.decisionsAwaitingViewer.length === 0 ? (
            <p className="dx-small dx-muted" style={{ margin: '8px 0 0' }}>
              No gate decision is waiting for you.
            </p>
          ) : null}
        </StatCard>

        <SpendCard spend={d.spend} />

        <StatCard
          title="Overdue validation"
          more={d.overdueValidation[0] ? { href: d.overdueValidation[0].href, label: 'Open register' } : null}
        >
          <Big
            n={d.overdueValidation.length}
            sub={d.overdueValidation.length === 1 ? 'test past due' : 'tests past due'}
          />
          {d.overdueValidation.map((o) => (
            <UiLink key={o.href} href={o.href} className="dx-linkcard">
              <span style={{ color: 'var(--kind-assumption-fg)', display: 'inline-flex' }}>
                <Icon name="pencilruler" size={15} />
              </span>
              <span className="dx-linkcard__text">
                <span className="dx-linkcard__title" style={{ fontWeight: 500 }}>
                  {o.title} · {o.caseKey}
                </span>
                <span className="dx-small dx-muted">{o.dueText}</span>
              </span>
            </UiLink>
          ))}
        </StatCard>

        <StatCard title="Pilots needing review">
          <Big n={d.pilotsNeedingReview.length} sub="pilots need review" />
          {d.pilotsNeedingReview.map((p) => (
            <UiLink key={p.href} href={p.href} className="dx-linkcard">
              <span className="dx-linkcard__text">
                <span className="dx-linkcard__title">{p.caseKey}</span>
                <span className="dx-small dx-muted">{p.dueText}</span>
              </span>
            </UiLink>
          ))}
          {d.pilotsNeedingReviewNote ? (
            <p className="dx-small dx-muted" style={{ margin: '8px 0 0', lineHeight: '18px' }}>
              {d.pilotsNeedingReviewNote}
            </p>
          ) : null}
        </StatCard>
      </div>

      <section aria-labelledby="ov-cases">
        <SectionHeader
          id="ov-cases"
          title="Expansion cases"
          subtitle={d.casesNote}
          right={
            <UiLink href="/me/opportunities" className="dx-stat__more" style={{ paddingTop: 0 }}>
              Opportunities
              <Icon name="chevr" size={13} />
            </UiLink>
          }
        />
        <div className="dx-list">
          <CaseTable rows={d.cases} />
        </div>
      </section>

      <section aria-labelledby="ov-events">
        <SectionHeader id="ov-events" title="Key events" subtitle="Decisions and sign-offs only" />
        {d.keyEvents.length ? (
          <ActivityTimelineView
            ariaLabel="Key events"
            items={d.keyEvents.map((e) => ({
              initials: e.actor?.initials ?? null,
              title: e.title,
              detail: [e.actor?.displayName, e.detail].filter(Boolean).join(' · '),
              when: fmtDate(e.at),
              keyDecision: e.keyDecision,
              href: e.href,
            }))}
          />
        ) : (
          <p className="dx-muted" style={{ fontSize: 13 }}>
            No decisions or sign-offs yet.
          </p>
        )}
      </section>
    </div>
  );
}
