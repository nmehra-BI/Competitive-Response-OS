/**
 * Decision brief: a printable, read-only rendering of one snapshot version and its decision
 * record. No actions except Print and a link back to Decisions. Print hides the app chrome and
 * keeps the illustrative-data notice.
 *
 * Deep links: ?gate=G1|G2 (default: the case's next decision), ?version=3.
 */
import { API, GATE_DISPOSITION_LABELS, GateCode } from '@growth-os/contracts';
import { AuthBoxes, Banner, Button, EmptyState, Mono, Skeleton } from '@growth-os/ui';
import { useParams, useSearchParams } from 'react-router-dom';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery } from '../../lib/query';
import { fullDateTime } from '../decisions/dates';
import { defaultGate } from '../decisions/gate';
import { statusText } from '../decisions/DecisionPanel';
import { PackageArticle } from '../decisions/PackageArticle';
import '../decisions/ws8c.css';

export default function BriefScreen() {
  const { caseKey = '' } = useParams();
  const [sp] = useSearchParams();
  const header = useApiQuery(API.cases.header, { params: { caseRef: caseKey } });
  const h = header.data;
  const parsed = GateCode.safeParse(sp.get('gate'));
  const gate = parsed.success ? parsed.data : h ? defaultGate(h) : 'G2';
  const node = h?.rail.find((n) => n.gateCode === gate);
  const v = Number(sp.get('version'));
  const version = Number.isInteger(v) && v > 0 ? v : undefined;
  const pkg = useApiQuery(
    API.gates.package,
    { params: { id: node?.gateRequestId ?? '' }, query: { version } },
    { enabled: !!node?.gateRequestId },
  );

  if (header.isPending || (node?.gateRequestId && pkg.isPending)) {
    return (
      <div className="app-page" aria-busy="true">
        <Skeleton height={640} />
      </div>
    );
  }
  if (header.error || !h) {
    return (
      <div className="app-page">
        <ProblemBanner error={header.error} />
      </div>
    );
  }
  if (!node?.gateRequestId) {
    return (
      <div className="app-page">
        <EmptyState title={`No ${gate} decision package yet`}>
          Nothing has been submitted for this gate.
        </EmptyState>
      </div>
    );
  }
  if (pkg.error || !pkg.data) {
    return (
      <div className="app-page">
        <ProblemBanner error={pkg.error} />
      </div>
    );
  }
  const p = pkg.data;
  const s = p.snapshot;
  const decisionsHref = `/me/cases/${encodeURIComponent(h.case.key)}/decisions?gate=${gate}&version=${s.version}`;
  return (
    <div className="app-page ws8c-page">
      <div className="ws8c-brief__bar ws8c-noprint">
        <Button variant="secondary" icon="file" onClick={() => window.print()}>
          Print decision brief
        </Button>
        <Button variant="ghost" icon="arrowr" href={decisionsHref}>
          Open in Decisions
        </Button>
        <span className="ws8c-small ws8c-muted">Read-only · nothing can be decided from the brief.</span>
      </div>
      {s.status !== 'current' ? (
        <Banner
          tone={s.status === 'stale' ? 'warn' : 'neutral'}
          title={
            s.status === 'stale'
              ? (p.staleBanner?.title ?? `Snapshot v${s.version} is out of date.`)
              : `Snapshot v${s.version} is superseded. This brief is kept for the record.`
          }
          live={false}
        />
      ) : null}
      <PackageArticle pkg={p} caseKey={h.case.key} caseTitle={h.case.title} />
      <section aria-labelledby="ws8c-brief-record" className="ws8c-card ws8c-package">
        <div className="ws8c-card__head">
          <h2 id="ws8c-brief-record">Decision record</h2>
          <span className="ws8c-card__head-right">
            {p.gateRequest.gateCode} · {statusText(p)}
          </span>
        </div>
        <div className="ws8c-card__body">
          <AuthBoxes
            authorizes={p.gateRequest.scope.authorizes}
            doesNotAuthorize={p.gateRequest.scope.doesNotAuthorize}
          />
          {p.approvals.length ? (
            <ul className="gos-list-plain ws8c-stack">
              {p.approvals.map((a) => (
                <li key={a.id} style={{ fontSize: 13.5 }}>
                  <b style={{ fontWeight: 600 }}>{GATE_DISPOSITION_LABELS[a.disposition]}</b> ·{' '}
                  {a.approver.displayName} · {fullDateTime(a.decidedAt)} · on snapshot{' '}
                  <Mono size={12}>
                    {s.contentHash === a.snapshotHash ? s.fingerprint : a.snapshotHash.slice(0, 8)}
                  </Mono>
                  <div className="ws8c-secondary">Rationale: “{a.rationale}”</div>
                  {a.note ? <div className="ws8c-secondary">Note: {a.note}</div> : null}
                  {!a.effective ? (
                    <div style={{ color: 'var(--danger-fg)' }}>
                      No longer effective{a.invalidation ? `: ${a.invalidation.reason}` : ''}.
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, fontSize: 13.5 }}>
              No decision recorded yet. Approver:{' '}
              {p.panel.chain.map((c) => c.approver.displayName).join(', ') || '—'}.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
