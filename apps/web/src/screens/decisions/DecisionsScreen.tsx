/**
 * S10 Decisions (Decisions.dc.html): the read-only, versioned decision package and the approval
 * panel. States: awaiting → approved with conditions; variants stale snapshot (approval disabled,
 * "Refresh snapshot (creates v4)"), author / unauthorized viewer, G1 history, superseded,
 * invalidated, expired; plus preparing and submitting a request.
 *
 * Deep links: ?gate=G1|G2 (default: the case's next decision), ?version=3, ?compare=2.
 */
import {
  API,
  GATE_STATUS_LABELS,
  GateCode,
  type DecisionPackageView,
  type PersonRef,
} from '@growth-os/contracts';
import { AuthBoxes, Banner, Button, EmptyState, GateDiamond, Mono, Skeleton } from '@growth-os/ui';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';
import { useViewer } from '../../lib/session';
import { fullDate, fullDateTime } from './dates';
import { DecisionPanel } from './DecisionPanel';
import { PackageArticle } from './PackageArticle';
import { DraftRequest, PrepareG2Form } from './PrepareRequest';
import { defaultGate } from './gate';
import './ws8c.css';

function useParamSetter() {
  const [, setSp] = useSearchParams();
  return (k: string, v: string | null) =>
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      if (v) n.set(k, v);
      else n.delete(k);
      return n;
    });
}

const positiveInt = (v: string | null) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

export default function DecisionsScreen() {
  const { caseKey = '' } = useParams();
  const [sp] = useSearchParams();
  const viewer = useViewer().data?.person ?? null;
  const header = useApiQuery(API.cases.header, { params: { caseRef: caseKey } });
  if (header.isPending) {
    return (
      <div className="app-page" aria-busy="true">
        <Skeleton height={480} />
      </div>
    );
  }
  if (header.error || !header.data) {
    return (
      <div className="app-page">
        <ProblemBanner error={header.error} />
      </div>
    );
  }
  const h = header.data;
  const parsed = GateCode.safeParse(sp.get('gate'));
  const gate = parsed.success ? parsed.data : defaultGate(h);
  const node = h.rail.find((n) => n.gateCode === gate);
  const isOwner = !!viewer && viewer.id === h.case.owner.id;
  return (
    <div className="app-page ws8c-page">
      {node?.gateRequestId ? (
        <RequestView
          key={`${gate}-${node.gateRequestId}`}
          caseKey={h.case.key}
          caseTitle={h.case.title}
          gateRequestId={node.gateRequestId}
          isOwner={isOwner}
          viewer={viewer}
          version={positiveInt(sp.get('version'))}
          compare={positiveInt(sp.get('compare'))}
          showHistory={gate === 'G0' || gate === 'G1'}
        />
      ) : gate === 'G2' && isOwner ? (
        <PrepareG2 caseKey={h.case.key} />
      ) : (
        <EmptyState title={`No ${gate} request yet`}>
          {gate === 'G2'
            ? `${h.case.owner.displayName} prepares the pilot request once validation results are recorded.`
            : 'Nothing has been requested for this gate.'}
        </EmptyState>
      )}
    </div>
  );
}

function PrepareG2({ caseKey }: { caseKey: string }) {
  const asm = useApiQuery(API.assumptions.list, { params: { caseRef: caseKey } });
  if (asm.isPending) return <Skeleton height={360} />;
  const people: PersonRef[] = [
    ...new Map((asm.data?.items ?? []).map((a) => [a.owner.id, a.owner])).values(),
  ];
  return <PrepareG2Form caseKey={caseKey} people={people} />;
}

function RequestView(props: {
  caseKey: string;
  caseTitle: string;
  gateRequestId: string;
  isOwner: boolean;
  viewer: PersonRef | null;
  version?: number;
  compare?: number;
  showHistory: boolean;
}) {
  const setParam = useParamSetter();
  const req = useApiQuery(API.gates.get, { params: { id: props.gateRequestId } });
  if (req.isPending) return <Skeleton height={480} />;
  if (req.error || !req.data) return <ProblemBanner error={req.error} />;
  if (req.data.status === 'draft') {
    return (
      <DraftRequest
        caseKey={props.caseKey}
        request={req.data}
        canSubmit={props.isOwner}
        onSubmitted={(v) => setParam('version', String(v))}
      />
    );
  }
  return <PackageView {...props} />;
}

function PackageView({
  caseKey,
  caseTitle,
  gateRequestId,
  viewer,
  version,
  compare,
  showHistory,
}: {
  caseKey: string;
  caseTitle: string;
  gateRequestId: string;
  viewer: PersonRef | null;
  version?: number;
  compare?: number;
  showHistory: boolean;
}) {
  const setParam = useParamSetter();
  const [showDiff, setShowDiff] = useState(false);
  const [refreshedFrom, setRefreshedFrom] = useState<number | null>(null);
  const pkg = useApiQuery(API.gates.package, {
    params: { id: gateRequestId },
    query: { version, compareTo: compare },
  });
  const refresh = useCommand(API.gates.refresh, {
    onSuccess: (r) => {
      setShowDiff(false);
      setParam('version', String(r.snapshot.version));
    },
  });
  const snapshotId = pkg.data?.snapshot.id ?? '';
  const diff = useApiQuery(
    API.gates.diff,
    { params: { id: snapshotId }, query: { against: 'current_inputs' } },
    { enabled: showDiff && !!snapshotId },
  );
  if (pkg.isPending) return <Skeleton height={640} />;
  if (pkg.error || !pkg.data) return <ProblemBanner error={pkg.error} />;
  const p = pkg.data;
  const s = p.snapshot;
  const versions = p.gateHistory.filter((g) => g.gateRequestId === gateRequestId && g.snapshotVersion);
  const currentVersion = versions.find((g) => g.status !== 'superseded')?.snapshotVersion ?? s.version;
  const approval = p.approvals.find((a) => a.invalidation);

  return (
    <div className="ws8c-decide">
      <div className="ws8c-decide__package">
        {showHistory ? <GateHistory pkg={p} caseKey={caseKey} /> : null}
        <div className="ws8c-banners">
          {p.staleBanner ? (
            <Banner
              tone="warn"
              title={p.staleBanner.title}
              body={
                <>
                  {p.staleBanner.body} You can never approve something different from what you read.
                  {showDiff ? (
                    diff.isPending ? (
                      <Skeleton height={40} />
                    ) : diff.data?.changes.length ? (
                      <ul className="ws8c-diff" aria-label="What changed">
                        {diff.data.changes.map((c) => (
                          <li key={c.path}>
                            {c.label}: {c.from ?? '—'} → {c.to ?? '—'}
                            {c.material ? ' · material' : ''}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ margin: '6px 0 0' }}>No differences reported.</p>
                    )
                  ) : null}
                </>
              }
              actions={
                <>
                  <Button variant="secondary" onClick={() => setShowDiff((v) => !v)}>
                    {showDiff ? 'Hide changes' : 'See what changed'}
                  </Button>
                  <Button
                    variant="secondary"
                    icon="refresh"
                    disabled={refresh.isPending}
                    disabledReason="Creating the new snapshot…"
                    onClick={() => {
                      setRefreshedFrom(s.version);
                      refresh.mutate({ params: { id: gateRequestId } });
                    }}
                  >
                    {`Refresh snapshot (creates v${s.version + 1})`}
                  </Button>
                </>
              }
            />
          ) : null}
          {refresh.error ? <ProblemBanner error={refresh.error} /> : null}
          {refreshedFrom && s.version === refreshedFrom + 1 ? (
            <Banner
              tone="info"
              title={`Snapshot v${s.version} created from the current committed inputs.`}
              body={`v${refreshedFrom} is superseded and stays read-only. Reviewers are asked to read v${s.version} before deciding.`}
            />
          ) : null}
          {s.status === 'superseded' ? (
            <Banner
              tone="neutral"
              title={`Snapshot v${s.version} is superseded${currentVersion !== s.version ? ` by v${currentVersion}` : ''}. It stays read-only and cannot be approved.`}
              actions={
                currentVersion !== s.version ? (
                  <Button variant="secondary" onClick={() => setParam('version', String(currentVersion))}>
                    {`Open v${currentVersion}`}
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {p.gateRequest.status === 'invalidated' && approval?.invalidation ? (
            <Banner
              tone="danger"
              title={`Approval for v${s.version} no longer applies: ${approval.invalidation.reason}.${p.gateRequest.gateCode === 'G2' ? ' Pilot tasks paused.' : ''}`}
              body="Unsent tasks are paused; executed external writes are kept. Prepare a new request with a refreshed snapshot to continue."
            />
          ) : null}
          {p.gateRequest.status === 'expired' ? (
            <Banner
              tone="warn"
              title={`The approval for v${s.version} expired unused${p.gateRequest.expiresAt ? ` on ${fullDate(p.gateRequest.expiresAt)}` : ''}.`}
              body="Nothing was executed under it. Prepare a new request to continue."
            />
          ) : null}
        </div>
        {versions.length > 1 ? (
          <nav aria-label="Snapshot versions" className="ws8c-row ws8c-small" style={{ marginBottom: 10 }}>
            <span className="ws8c-muted">Versions</span>
            {versions.map((g) => (
              <Link
                key={g.snapshotVersion}
                className="gos-link"
                aria-current={g.snapshotVersion === s.version ? 'page' : undefined}
                to={`?gate=${p.gateRequest.gateCode}&version=${g.snapshotVersion}`}
                style={g.snapshotVersion === s.version ? { fontWeight: 600 } : undefined}
              >
                v{g.snapshotVersion} · {GATE_STATUS_LABELS[g.status]}
              </Link>
            ))}
          </nav>
        ) : null}
        <PackageArticle pkg={p} caseKey={caseKey} caseTitle={caseTitle} compareTo={compare} />
      </div>
      <div className="ws8c-decide__panel">
        <DecisionPanel pkg={p} viewer={viewer} caseKey={caseKey} />
        <div style={{ marginTop: 10 }}>
          <Link
            className="gos-link"
            style={{ fontSize: 13 }}
            to={`/me/cases/${encodeURIComponent(caseKey)}/brief?gate=${p.gateRequest.gateCode}&version=${s.version}`}
          >
            Open printable decision brief
          </Link>
        </div>
      </div>
    </div>
  );
}

function GateHistory({ pkg, caseKey }: { pkg: DecisionPackageView; caseKey: string }) {
  const viewed = pkg.gateRequest.id;
  const approver = pkg.approvals.find((a) => a.disposition !== 'abstain')?.approver.displayName;
  return (
    <section aria-labelledby="ws8c-history" className="ws8c-history">
      <h2 id="ws8c-history">Gate history · {caseKey}</h2>
      <ol>
        {pkg.gateHistory.map((g) => {
          const isViewed = g.gateRequestId === viewed && g.status !== 'superseded';
          return (
            <li key={`${g.gateRequestId}-${g.snapshotVersion}`}>
              <span aria-hidden="true" style={{ display: 'inline-flex', marginTop: 1 }}>
                <GateDiamond status={g.status} size={16} />
              </span>
              <div
                style={{
                  minWidth: 0,
                  color: g.status === 'superseded' ? 'var(--text-secondary)' : undefined,
                }}
              >
                <b style={{ fontWeight: 600 }}>{g.label}</b> · {GATE_STATUS_LABELS[g.status]}
                {g.decidedAt ? ` ${fullDateTime(g.decidedAt)}` : ''}
                {isViewed && approver ? ` by ${approver}` : ''}
                {g.status === 'superseded' ? ' · never decided' : ''}
                {g.snapshotVersion || g.rationale ? (
                  <div className="ws8c-small ws8c-secondary">
                    {g.snapshotVersion ? `Snapshot v${g.snapshotVersion}` : ''}
                    {g.fingerprint ? (
                      <>
                        {' · '}
                        <Mono size={12}>{g.fingerprint}</Mono>
                      </>
                    ) : null}
                    {g.rationale ? ` · Rationale: “${g.rationale}”` : ''}
                  </div>
                ) : null}
                {isViewed ? (
                  <div style={{ marginTop: 8 }}>
                    <AuthBoxes
                      authorizes={pkg.gateRequest.scope.authorizes}
                      doesNotAuthorize={pkg.gateRequest.scope.doesNotAuthorize}
                    />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
