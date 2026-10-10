/**
 * S07 Feasibility and ability to win (prototype Feasibility.dc.html). A readiness checklist with a
 * named human reviewer per dimension, scoped sign-offs, blockers and signed disagreements. No
 * readiness score. A missing review is pending — never a green check; the specialist review says
 * "Pending — human review required" and AI cannot provide it.
 *
 * Deep link: dimension (highlights the row).
 */
import {
  API,
  FEASIBILITY_DIMENSION_LABELS,
  REVIEWER_POSITION_LABELS,
  type GateCode,
  type ReviewerPosition,
  type FeasibilityAssessment,
  type FeasibilityDimension,
  type ReviewArea,
} from '@growth-os/contracts';
import {
  Banner,
  Button,
  Card,
  DataTable,
  Icon,
  KindTag,
  Person,
  ReviewStatusTag,
  SectionHeader,
  Skeleton,
  SourceChip,
  TextAreaField,
} from '@growth-os/ui';
import { useId, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';
import { useViewer } from '../../lib/session';
import '../sizing/assessment.css';

const AREA: Record<FeasibilityDimension, ReviewArea> = {
  product_fit: 'product',
  differentiation: 'product',
  commercial_access: 'commercial',
  operations: 'operations',
  specialist_review: 'specialist',
  channel: 'commercial',
  competition: 'commercial',
};

function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Berlin',
  }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
}

function statusOf(r: FeasibilityAssessment) {
  if (
    r.status === 'signed' &&
    r.currentReview &&
    (r.currentReview.scope.maxSites !== null || r.currentReview.scope.maxDays !== null)
  ) {
    return 'signed_scoped' as const;
  }
  return r.status;
}

function DisagreementForm({
  row,
  viewerName,
  viewerInitials,
  caseKey,
  onClose,
}: {
  row: FeasibilityAssessment;
  viewerName: string;
  viewerInitials: string;
  caseKey: string;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const cmd = useCommand(API.feasibility.recordDisagreement, { onSuccess: onClose });
  const titleId = useId();
  const label = FEASIBILITY_DIMENSION_LABELS[row.dimension];
  return (
    <form
      className="as-inline-form"
      aria-labelledby={titleId}
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim())
          cmd.mutate({
            params: { caseRef: caseKey, dimension: row.dimension },
            body: { statement: text.trim() },
          });
      }}
    >
      <div id={titleId} style={{ fontSize: 14, fontWeight: 600 }}>
        Record disagreement · {label}
      </div>
      <div className="as-row" style={{ fontSize: 13 }}>
        <span className="as-muted">Recorded by</span>
        <Person name={viewerName} initials={viewerInitials} />
        <span className="as-muted">· visible in the G1 and G2 packages as a signed position</span>
      </div>
      <TextAreaField
        label="Your position, in your own words"
        required
        value={text}
        onChange={setText}
        rows={2}
      />
      <div className="as-row">
        <Button
          variant="primary"
          tone="dark"
          type="submit"
          disabled={!text.trim() || cmd.isPending}
          disabledReason={!text.trim() ? 'A statement is required' : 'Recording…'}
        >
          Record disagreement
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {cmd.error ? <ProblemBanner error={cmd.error} /> : null}
    </form>
  );
}

function SignForm({
  row,
  caseKey,
  onClose,
}: {
  row: FeasibilityAssessment;
  caseKey: string;
  onClose: () => void;
}) {
  const [position, setPosition] = useState<ReviewerPosition>('supports');
  const [scope, setScope] = useState('');
  const [gate, setGate] = useState<GateCode | ''>('G2');
  const [sites, setSites] = useState('');
  const [days, setDays] = useState('');
  const [statement, setStatement] = useState('');
  const ids = { pos: useId(), gate: useId(), sites: useId(), days: useId(), title: useId() };
  const cmd = useCommand(API.feasibility.sign, { onSuccess: onClose });
  const int = (s: string) => (/^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null);
  return (
    <form
      className="as-inline-form"
      aria-labelledby={ids.title}
      onSubmit={(e) => {
        e.preventDefault();
        if (!scope.trim()) return;
        cmd.mutate({
          params: { caseRef: caseKey, dimension: row.dimension },
          body: {
            position,
            scopeText: scope.trim(),
            coversGate: gate === '' ? null : (gate as 'G1' | 'G2' | 'G3' | 'X'),
            maxSites: int(sites),
            maxDays: int(days),
            statement: statement.trim() || null,
            evidenceSourceIds: [],
          },
        });
      }}
    >
      <div id={ids.title} style={{ fontSize: 14, fontWeight: 600 }}>
        Record your review · {FEASIBILITY_DIMENSION_LABELS[row.dimension]}
      </div>
      <p className="as-note" style={{ marginTop: 0 }}>
        State the scope your answer covers. A pilot sign-off does not cover scale.
      </p>
      <div className="as-form-grid">
        <label className="gos-field" htmlFor={ids.pos}>
          <span>Position</span>
          <select
            id={ids.pos}
            className="gos-select"
            value={position}
            onChange={(e) => setPosition(e.target.value as ReviewerPosition)}
          >
            {(['supports', 'supports_with_conditions', 'dissents', 'abstains'] as const).map((p) => (
              <option key={p} value={p}>
                {REVIEWER_POSITION_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="gos-field" htmlFor={ids.gate}>
          <span>Covers gate</span>
          <select
            id={ids.gate}
            className="gos-select"
            value={gate}
            onChange={(e) => setGate(e.target.value as GateCode | '')}
          >
            {(['G1', 'G2', 'G3', 'X'] as const).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label className="gos-field" htmlFor={ids.sites}>
          <span>
            Up to sites <span className="gos-field__hint">(optional)</span>
          </span>
          <input
            id={ids.sites}
            className="gos-input"
            inputMode="numeric"
            value={sites}
            onChange={(e) => setSites(e.target.value)}
          />
        </label>
        <label className="gos-field" htmlFor={ids.days}>
          <span>
            Up to days <span className="gos-field__hint">(optional)</span>
          </span>
          <input
            id={ids.days}
            className="gos-input"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </label>
      </div>
      <TextAreaField label="Scope of sign-off" required value={scope} onChange={setScope} rows={2} />
      <TextAreaField label="Statement" hint="optional" value={statement} onChange={setStatement} rows={2} />
      <div className="as-row">
        <Button
          variant="primary"
          type="submit"
          disabled={!scope.trim() || cmd.isPending}
          disabledReason={!scope.trim() ? 'State the scope of your sign-off' : 'Recording…'}
        >
          Record review
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {cmd.error ? <ProblemBanner error={cmd.error} /> : null}
    </form>
  );
}

export default function FeasibilityScreen() {
  const { caseKey = '' } = useParams();
  const [sp] = useSearchParams();
  const viewer = useViewer();
  const viewerId = viewer.data?.person.id ?? null;
  const q = useApiQuery(API.feasibility.get, { params: { caseRef: caseKey } });
  const [disagreeOn, setDisagreeOn] = useState<FeasibilityDimension | null>(null);
  const [signOn, setSignOn] = useState<FeasibilityDimension | null>(null);
  const [requested, setRequested] = useState<Record<string, string>>({});
  const request = useCommand(API.cases.requestReview, {
    onSuccess: (r) => {
      if (r.targetId) setRequested((m) => ({ ...m, [r.targetId!]: new Date().toISOString() }));
    },
  });
  const resolve = useCommand(API.feasibility.resolveBlocker);
  const highlighted = sp.get('dimension');

  if (q.isPending) {
    return (
      <div className="as-page" aria-busy="true">
        <Skeleton height={40} />
        <Skeleton height={360} />
      </div>
    );
  }
  if (q.error || !q.data) {
    return (
      <div className="as-page">
        <ProblemBanner error={q.error} />
      </div>
    );
  }
  const data = q.data;
  const disRow = data.rows.find((r) => r.dimension === disagreeOn);
  const signRow = data.rows.find((r) => r.dimension === signOn);
  const specialist = data.rows.find((r) => r.humanOnly);
  const specBlocker = specialist?.blockers.find((b) => b.status === 'open');

  return (
    <div className="as-page">
      <SectionHeader
        title="Feasibility and ability to win"
        subtitle="Each dimension has a named human reviewer. A missing review shows as pending — never as a green check."
      />
      <div
        className="as-row"
        style={{ gap: '8px 18px', fontSize: 13 }}
        role="group"
        aria-label="Review summary"
      >
        <span className="as-row" style={{ gap: 6 }}>
          <ReviewStatusTag status="signed" />
          <span className="as-muted">{data.counts.signed}</span>
        </span>
        <span className="as-row" style={{ gap: 6 }}>
          <ReviewStatusTag status="in_review" />
          <span className="as-muted">{data.counts.inReview}</span>
        </span>
        <span className="as-row" style={{ gap: 6 }}>
          <ReviewStatusTag status="pending" />
          <span className="as-muted">{data.counts.pending}</span>
        </span>
        <span className="as-row" style={{ gap: 6 }}>
          <ReviewStatusTag status="declined" />
          <span className="as-muted">{data.counts.blockers}</span>
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12.5 }} className="as-faint">
          No readiness score: each dimension stands on its own sign-off.
        </span>
      </div>
      {disRow && viewer.data ? (
        <DisagreementForm
          row={disRow}
          caseKey={caseKey}
          viewerName={viewer.data.person.displayName}
          viewerInitials={viewer.data.person.initials}
          onClose={() => setDisagreeOn(null)}
        />
      ) : null}
      {signRow ? <SignForm row={signRow} caseKey={caseKey} onClose={() => setSignOn(null)} /> : null}
      {request.error ? <ProblemBanner error={request.error} /> : null}
      <Card>
        <DataTable<FeasibilityAssessment>
          ariaLabel="Readiness checklist"
          minWidth={1000}
          rows={data.rows}
          rowKey={(r) => r.id}
          rowHeader="dimension"
          columns={[
            {
              key: 'dimension',
              header: 'Dimension',
              cell: (r) => (
                <div className={highlighted === r.dimension ? 'as-row-selected' : undefined}>
                  <div style={{ fontWeight: 600 }}>{FEASIBILITY_DIMENSION_LABELS[r.dimension]}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2, fontWeight: 400 }}>
                    {r.question}
                  </div>
                </div>
              ),
            },
            {
              key: 'evidence',
              header: 'Evidence',
              cell: (r) => (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--kind-evidence-fg)', display: 'inline-flex' }}>
                    <Icon name="filetext" size={13} />
                  </span>
                  <span>{r.evidenceText}</span>
                </span>
              ),
            },
            {
              key: 'reviewer',
              header: 'Reviewer',
              cell: (r) => <Person name={r.reviewer.displayName} initials={r.reviewer.initials} />,
            },
            {
              key: 'status',
              header: 'Status · scope of sign-off',
              cell: (r) => {
                const req = requested[r.id];
                return (
                  <div>
                    {req && r.status === 'pending' ? (
                      <span className="gos-status" style={{ color: 'var(--info-fg)' }}>
                        <Icon name="send" size={15} />
                        <span className="gos-status__label">Review requested · {fmtDay(req)}</span>
                      </span>
                    ) : (
                      <ReviewStatusTag status={statusOf(r)} />
                    )}
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                      {r.scopeText}
                    </div>
                    {r.humanOnly ? (
                      <div style={{ marginTop: 5 }}>
                        <span className="gos-ai">
                          <Icon name="sparkle" size={12} />
                          AI cannot provide this review
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              },
            },
            { key: 'due', header: 'Due', cell: (r) => <span className="as-muted">{fmtDay(r.dueOn)}</span> },
            {
              key: 'blocker',
              header: 'Blocker',
              cell: (r) => {
                const open = r.blockers.filter((b) => b.status === 'open');
                const isReviewer = viewerId === r.reviewer.id && r.status !== 'signed';
                return (
                  <div>
                    {open.length ? (
                      open.map((b) => (
                        <span key={b.id} className="as-flag" style={{ fontSize: 13 }}>
                          <Icon name="alert" size={14} />
                          <span className="as-flag__text">{b.text}</span>
                        </span>
                      ))
                    ) : r.blockers.length ? (
                      <span className="as-muted">Resolved · {r.blockers[0]!.resolution}</span>
                    ) : (
                      <span className="as-faint">None</span>
                    )}
                    {r.disagreements.map((d) => (
                      <div
                        key={d.id}
                        className="as-flag"
                        style={{ marginTop: 6, fontSize: 12.5, fontWeight: 400, alignItems: 'flex-start' }}
                      >
                        <Icon name="message" size={13} />
                        <span className="as-flag__text">
                          Disagreement · {d.author.displayName} · {fmtDay(d.createdAt)}: “{d.statement}”
                        </span>
                      </div>
                    ))}
                    <div className="as-row" style={{ gap: 4, marginTop: 6 }}>
                      {r.status === 'pending' && !r.humanOnly && !requested[r.id] ? (
                        <Button
                          variant="secondary"
                          ariaLabel={`Request review · ${FEASIBILITY_DIMENSION_LABELS[r.dimension]}`}
                          onClick={() =>
                            request.mutate({
                              params: { caseRef: caseKey },
                              body: {
                                area: AREA[r.dimension],
                                reviewerId: r.reviewer.id,
                                targetType: 'feasibility',
                                targetId: r.id,
                                question: r.question,
                                whatToCheck: [r.evidenceText],
                                dueOn: r.dueOn,
                              },
                            })
                          }
                        >
                          Request review
                        </Button>
                      ) : null}
                      {isReviewer ? (
                        <Button variant="secondary" onClick={() => setSignOn(r.dimension)}>
                          Record review
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        ariaLabel={`Record disagreement · ${FEASIBILITY_DIMENSION_LABELS[r.dimension]}`}
                        onClick={() => setDisagreeOn(r.dimension)}
                      >
                        Record disagreement
                      </Button>
                    </div>
                  </div>
                );
              },
            },
          ]}
        />
      </Card>
      <div
        className="as-grid-cards"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}
      >
        {specialist ? (
          <section aria-labelledby="sp" className="as-box" style={{ padding: '14px 16px' }}>
            <SectionHeader
              id="sp"
              title={`Specialist question · ${specialist.reviewer.displayName}`}
              subtitle="Drafted with AI assistance, edited by Maya Rao. The answer is human-owned."
            />
            <p className="as-serif">
              {/* The full question (D-068); an API without it gives the short label and evidence. */}
              {specialist.questionDetail
                ? `“${specialist.questionDetail}”`
                : `“${specialist.question}” · ${specialist.evidenceText}`}
            </p>
            <div className="as-row" style={{ marginTop: 12, gap: 8 }}>
              <ReviewStatusTag
                status={statusOf(specialist)}
                extra={
                  specialist.status === 'signed'
                    ? specialist.scopeText
                    : `human review required · due ${fmtDay(specialist.dueOn)}`
                }
              />
              <Button
                variant="secondary"
                disabled={!specBlocker || !specialist.currentReview || resolve.isPending}
                disabledReason={
                  !specBlocker
                    ? 'No open blocker'
                    : !specialist.currentReview
                      ? `Available once ${specialist.reviewer.displayName} records a position.`
                      : 'Saving…'
                }
                onClick={() =>
                  specBlocker &&
                  resolve.mutate({
                    params: { id: specBlocker.id },
                    body: {
                      kind: 'resolved',
                      resolution: specialist.scopeText,
                      scopeRestrictionGateRequestId: null,
                    },
                  })
                }
              >
                Resolve blocker
              </Button>
              <Button variant="secondary" disabled disabledReason="Needs an approved gate scope restriction.">
                Restrict scope
              </Button>
            </div>
            <p className="as-note">A pilot sign-off will not cover scale.</p>
            {resolve.error ? <ProblemBanner error={resolve.error} /> : null}
          </section>
        ) : null}
        <section aria-labelledby="cp" className="as-box" style={{ padding: '14px 16px' }}>
          <SectionHeader id="cp" title="Competition" subtitle="Listed with sources; no proprietary scores" />
          <ul className="as-list" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            {data.competitors.map((c) => (
              <li key={c.id} className="as-row" style={{ justifyContent: 'space-between' }}>
                <span>{c.text}</span>
                {c.source ? (
                  <SourceChip
                    label={c.source.label}
                    quality={c.source.quality}
                    href={`/evidence/${c.source.key}`}
                    restricted={c.source.restricted}
                  />
                ) : c.unknown ? (
                  <KindTag kind="unknown" detail="section incomplete" small />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
      {data.rows.some((r) => r.status === 'declined') ? (
        <Banner
          tone="warn"
          title="A reviewer recorded a blocker"
          body="Blocked dimensions stop the gates they name until resolved."
        />
      ) : null}
    </div>
  );
}
