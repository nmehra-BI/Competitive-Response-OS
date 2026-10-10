/**
 * S12 Outcomes (prototype Outcomes.dc.html). Baseline versus actuals against the pre-registered
 * thresholds (period and source on every actual), limitations, readiness, the recommendation card
 * (a recommendation, not a decision), the recorded decision and what we learned, an extension
 * request with its own cap (€[cap] placeholder), and scale approval disabled with the unmet G3
 * preconditions. Negative results use the neutral result glyph, never red. Charts have a table.
 *
 * Deep link: `metric` (metric key) highlights that row.
 */
import { API, DECISION_OUTCOME_LABELS, type OutcomeReviewView, type PersonRef } from '@growth-os/contracts';
import {
  AuthBoxes,
  Banner,
  Button,
  ChartTable,
  DataTable,
  Eyebrow,
  GateChip,
  GateDiamond,
  Icon,
  KindTag,
  Mono,
  OwnerPicker,
  Person,
  ResultGlyph,
  ReviewStatusTag,
  SectionHeader,
  Skeleton,
  ActivityTimelineView,
  TextAreaField,
  formatBudget,
  type DataTableColumn,
} from '@growth-os/ui';
import { useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Modal } from '../../app/shell/Modal';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';
import { useViewer } from '../../lib/session';
import { fmtDateTime, fmtPeriod } from '../history/dates';
import '../history/ws8d.css';

type View = OutcomeReviewView;
type Row = View['rows'][number];
type DecideOutcome = 'stop' | 'revise' | 'extend' | 'proceed';

const EXT_SCOPE = [
  'Deployment-effort study at the 4 pilot sites',
  'Specialist scale-readiness review',
  'Renewal-intent follow-up with the fourth site',
];
const DECIMAL = /^\d{1,18}(\.\d{1,2})?$/;
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export default function OutcomesScreen() {
  const { caseKey = '' } = useParams();
  const [search] = useSearchParams();
  const viewer = useViewer();
  const q = useApiQuery(API.outcomes.get, { params: { caseRef: caseKey } });
  const pilot = useApiQuery(API.pilot.get, { params: { caseRef: caseKey } });
  const x = useApiQuery(API.gates.rail, { params: { caseRef: caseKey, gateCode: 'X' } });
  if (q.isPending) {
    return (
      <div className="ws8d-page" aria-busy="true">
        <Skeleton height={120} />
        <Skeleton height={220} />
      </div>
    );
  }
  if (q.error || !q.data) {
    return (
      <div className="ws8d-page">
        <h2 className="gos-sr-only">Outcomes</h2>
        <ProblemBanner error={q.error} />
      </div>
    );
  }
  const roles = new Set(viewer.data?.roles.filter((r) => !r.revokedAt).map((r) => r.role) ?? []);
  return (
    <OutcomesView
      caseKey={caseKey}
      v={q.data}
      parentGateId={pilot.data?.baseline?.gateRequestId ?? null}
      baselineText={pilot.data?.baseline ?? null}
      xStatus={x.data?.status ?? null}
      metric={search.get('metric')}
      can={{
        record: roles.has('pilot_owner') || roles.has('case_owner'),
        recommend: roles.has('case_owner'),
        decide: roles.has('sponsor'),
        extend: roles.has('case_owner'),
      }}
    />
  );
}

interface Can {
  record: boolean;
  recommend: boolean;
  decide: boolean;
  extend: boolean;
}

function OutcomesView({
  caseKey,
  v,
  parentGateId,
  baselineText,
  xStatus,
  metric,
  can,
}: {
  caseKey: string;
  v: View;
  parentGateId: string | null;
  baselineText: { snapshotVersion: number; fingerprint: string; approvedAt: string } | null;
  xStatus: string | null;
  metric: string | null;
  can: Can;
}) {
  const [recording, setRecording] = useState<Row | null>(null);
  const [decideAs, setDecideAs] = useState<DecideOutcome | null>(null);
  const [extOpen, setExtOpen] = useState(false);
  const [justSubmitted, setSubmittedExt] = useState<{
    key: string;
    amount: string | null;
    currency: string | null;
    submittedAt: string | null;
    scope: string;
  } | null>(null);
  const decision = v.decision;
  const rec = v.recommendation;
  const unmet = v.scaleGate.unmet;
  const scaleReason =
    v.scaleGate.summary ?? `G3 preconditions unmet: ${unmet.map((b) => b.message).join('; ')}`;
  // After a reload the review carries the X request (D-068); an older API leaves only the X status.
  const xr = v.extensionRequest ?? null;
  const submittedExt =
    justSubmitted ??
    (xr
      ? {
          key: xr.key,
          amount: xr.scope.amount,
          currency: xr.scope.currency,
          submittedAt: xr.submittedAt,
          scope: xr.scope.authorizes.join(' · '),
        }
      : null);
  const extensionPending =
    !!justSubmitted || xr?.status === 'awaiting_decision' || xStatus === 'awaiting_decision';
  const canRequestExt = can.extend && decision?.outcome === 'extend' && !extensionPending && !!parentGateId;
  const people = peopleIn(v);

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'metric',
      header: 'Metric',
      cell: (r) => (
        <span
          id={`metric-${r.target?.metricKey ?? r.label}`}
          aria-current={metric && r.target?.metricKey === metric ? 'true' : undefined}
        >
          {r.label}
        </span>
      ),
    },
    {
      key: 'threshold',
      header: `Threshold · pre-registered at G2 v${baselineText?.snapshotVersion ?? 3}`,
      cell: (r) => r.target?.thresholdText ?? '—',
    },
    {
      key: 'actual',
      header: 'Actual',
      cell: (r) => <ActualCell r={r} canRecord={can.record && !decision} onRecord={() => setRecording(r)} />,
    },
    {
      key: 'result',
      header: 'Result',
      cell: (r) =>
        r.notAThreshold ? (
          <span className="ws8d-note">Not a threshold</span>
        ) : r.latest?.result ? (
          <ResultGlyph result={r.latest.result} />
        ) : (
          <ResultGlyph result="too_early_to_read" extra="no actual yet" />
        ),
    },
  ];

  return (
    <div className="ws8d-page">
      <Lead v={v} />

      {v.incompleteReasons.length ? (
        <Banner
          tone="neutral"
          title="Review incomplete"
          body={
            <ul className="ws8d-list">
              {v.incompleteReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      <div className="ws8d-row">
        {decision?.outcome === 'extend' && can.extend ? (
          <Button
            variant="primary"
            icon="plus"
            disabled={!canRequestExt}
            disabledReason={
              extensionPending
                ? 'An extension request is awaiting decision.'
                : 'The parent gate is not available.'
            }
            onClick={() => setExtOpen(true)}
          >
            Request extension €[cap]
          </Button>
        ) : null}
        <Button variant="secondary" icon="pencil" href={`/me/cases/${encodeURIComponent(caseKey)}/thesis`}>
          Revise thesis
        </Button>
        {can.decide && !decision ? (
          <Button
            variant="secondary"
            icon="squarestop"
            disabled={v.status === 'incomplete'}
            disabledReason="Record every actual before the decision."
            onClick={() => setDecideAs('stop')}
          >
            Stop case (decision)
          </Button>
        ) : null}
        <Button variant="secondary" disabled disabledReason={scaleReason}>
          Request scale approval
        </Button>
      </div>

      {extOpen && parentGateId ? (
        <ExtensionForm
          caseKey={caseKey}
          parentGateId={parentGateId}
          people={people}
          defaultOwner={v.rows.find((r) => r.latest)?.latest?.recordedBy.id ?? null}
          onCancel={() => setExtOpen(false)}
          onDone={(g, scope) => {
            setExtOpen(false);
            setSubmittedExt({
              key: g.key,
              amount: g.scope.amount,
              currency: g.scope.currency,
              submittedAt: g.submittedAt,
              scope,
            });
          }}
        />
      ) : null}
      {extensionPending ? (
        <section aria-label="Extension request" className="ws8d-section">
          <div className="ws8d-row">
            <GateChip
              status="awaiting_decision"
              text={`Extension ${submittedExt?.amount && submittedExt.currency ? formatBudget(submittedExt.amount, submittedExt.currency) : '€[cap]'} · Awaiting decision · ${decision?.decidedBy.displayName ?? 'sponsor'}`}
            />
            {submittedExt ? (
              <span className="ws8d-note" style={{ fontSize: 12.5 }}>
                <Mono size={12}>{submittedExt.key}</Mono> · submitted {fmtDateTime(submittedExt.submittedAt)}{' '}
                · {submittedExt.scope}
              </span>
            ) : null}
          </div>
          <p className="ws8d-muted">
            A new authorization with its own cap. The original scale gate stays blocked.
          </p>
        </section>
      ) : null}

      {can.recommend && !rec && !decision ? <RecommendationForm caseKey={caseKey} v={v} /> : null}
      {can.decide && !decision && rec ? (
        <section className="ws8d-section ws8d-section--accent" aria-labelledby="decide-h">
          <h2 id="decide-h">Record the outcome decision</h2>
          <p className="ws8d-note" style={{ margin: 0 }}>
            {`${rec.by.displayName} recommends “${rec.label}”. The decision is yours; scale needs a separate G3 request.`}
          </p>
          <div className="ws8d-row">
            <Button
              variant="decision"
              disabled={v.status === 'incomplete'}
              disabledReason="Record every actual before the decision."
              onClick={() =>
                setDecideAs(rec.outcome === 'scale' ? 'proceed' : (rec.outcome as DecideOutcome))
              }
            >
              {`Record decision: ${rec.label}`}
            </Button>
            <Button variant="secondary" onClick={() => setDecideAs('revise')}>
              Record a different decision
            </Button>
          </div>
        </section>
      ) : null}

      <SectionHeader
        title="Baseline versus actuals"
        subtitle="Thresholds were agreed before activation and have not moved."
      />
      <div className="gos-card" style={{ overflow: 'hidden' }}>
        <DataTable
          columns={columns}
          rows={v.rows}
          rowKey={(r) => r.target?.id ?? r.label}
          ariaLabel="Baseline versus actuals"
          minWidth={760}
          rowHeader="metric"
        />
      </div>

      <div className="ws8d-grid">
        <PaidUseChart v={v} />
        <Readiness v={v} />
      </div>

      <div className="ws8d-grid">
        <RecommendationCard v={v} />
        <G3Card v={v} />
      </div>

      <KeyEvents v={v} baseline={baselineText} />

      {recording ? (
        <RecordActualDialog caseKey={caseKey} row={recording} onClose={() => setRecording(null)} />
      ) : null}
      {decideAs ? (
        <DecisionDialog caseKey={caseKey} v={v} initial={decideAs} onClose={() => setDecideAs(null)} />
      ) : null}
    </div>
  );
}

function peopleIn(v: View): PersonRef[] {
  const map = new Map<string, PersonRef>();
  for (const r of v.rows) for (const o of r.history) map.set(o.recordedBy.id, o.recordedBy);
  for (const r of v.readiness) map.set(r.owner.id, r.owner);
  if (v.recommendation) map.set(v.recommendation.by.id, v.recommendation.by);
  if (v.decision) map.set(v.decision.decidedBy.id, v.decision.decidedBy);
  return [...map.values()];
}

function Lead({ v }: { v: View }) {
  const d = v.decision;
  return (
    <section
      className="ws8d-section"
      aria-labelledby="outcome-lead"
      style={{ padding: '20px 22px', gap: 14 }}
    >
      <div className="ws8d-row">
        <Icon name="filetext" size={18} />
        <h2 id="outcome-lead" style={{ fontSize: 20, lineHeight: '28px' }}>
          {d
            ? `Decision recorded: ${d.label}`
            : `Pilot review v${v.version} · ${v.status === 'ready' ? 'ready for decision' : 'in progress'}`}
        </h2>
        {d ? <span className="ws8d-tag ws8d-tag--key">Key decision</span> : null}
      </div>
      {d ? (
        <div className="ws8d-note">
          {d.decidedBy.displayName} · {fmtDateTime(d.decidedAt)}
          {d.onRecommendationOf ? ` · on ${d.onRecommendationOf.displayName}’s recommendation` : ''} · pilot
          review v{v.version}
        </div>
      ) : (
        <div className="ws8d-note">
          Pilot window 1 Dec 2026 – 28 Feb 2027 · results are compared with the thresholds pre-registered at
          G2.
        </div>
      )}
      <div className="ws8d-grid" style={{ gap: '16px 28px' }}>
        <div>
          <Eyebrow>What we learned</Eyebrow>
          <ul className="ws8d-serif-list">
            {v.whatWeLearned.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div>
          <Eyebrow>What changes next</Eyebrow>
          <ul className="ws8d-serif-list">
            {v.whatChangesNext.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ActualCell({ r, canRecord, onRecord }: { r: Row; canRecord: boolean; onRecord: () => void }) {
  const o = r.latest;
  if (r.notAThreshold) {
    return (
      <span className="ws8d-row" style={{ gap: 6 }}>
        <span>
          €[spent] of {r.target?.thresholdValue ? formatBudget(r.target.thresholdValue, 'EUR') : '—'}
        </span>
        <KindTag kind="unknown" detail="placeholder" small />
      </span>
    );
  }
  if (!o) {
    return (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
        <KindTag kind="unknown" detail="no actual recorded" small />
        {canRecord ? (
          <Button variant="ghost" icon="plus" onClick={onRecord} ariaLabel={`Record actual for ${r.label}`}>
            Record actual
          </Button>
        ) : null}
      </span>
    );
  }
  return (
    <span>
      <b style={{ fontWeight: 700 }}>{o.valueText}</b>{' '}
      <KindTag kind="actual" detail={fmtPeriod(o.periodStart, o.periodEnd, true)} small />
      <div className="ws8d-sub" style={{ marginTop: 3, color: 'var(--text-secondary)' }}>
        {/^Source:/.test(o.sourceText) ? o.sourceText : `Source: ${o.sourceText}`}
      </div>
      {o.version > 1 ? (
        <div className="ws8d-sub">Version {o.version} · earlier values kept in history</div>
      ) : null}
    </span>
  );
}

function PaidUseChart({ v }: { v: View }) {
  const row = v.rows.find((r) => r.target?.operator === 'gte' && r.target.thresholdValue !== null);
  if (!row || !row.target) return null;
  const t = row.target;
  const threshold = Number(t.thresholdValue);
  const actual =
    row.latest?.value !== null && row.latest?.value !== undefined ? Number(row.latest.value) : null;
  const max = Math.max(threshold, actual ?? 0, 1);
  const h = (n: number) => (n / max) * 80;
  const period = row.latest ? fmtPeriod(row.latest.periodStart, row.latest.periodEnd) : t.windowText;
  const label =
    actual === null
      ? `No actual recorded yet; threshold is ${t.thresholdText}`
      : `Actual ${actual} of ${threshold} pilot customers met the threshold; threshold is ${t.thresholdText}`;
  return (
    <section className="ws8d-section" aria-labelledby="paid-use-h">
      <h2 id="paid-use-h">Pilot customers meeting the paid-use threshold</h2>
      <ChartTable
        caption={`Count of pilot customers · ${period} · threshold ${t.thresholdText.replace(/ pilot customers$/, '')} (pre-registered)`}
        chart={
          <svg role="img" aria-label={label} viewBox="0 0 360 120" className="ws8d-chart">
            <line x1="40" y1="100" x2="340" y2="100" className="ws8d-chart__axis" />
            {actual !== null ? (
              <>
                <rect
                  x="60"
                  y={100 - h(actual)}
                  width="80"
                  height={h(actual)}
                  className="ws8d-chart__actual"
                />
                <text x="100" y={94 - h(actual)} textAnchor="middle" className="ws8d-chart__strong">
                  ■ Actual {actual}
                </text>
              </>
            ) : (
              <text x="100" y="90" textAnchor="middle">
                No actual yet
              </text>
            )}
            <rect
              x="200"
              y={100 - h(threshold)}
              width="80"
              height={h(threshold)}
              className="ws8d-chart__threshold"
            />
            <text x="240" y={94 - h(threshold)} textAnchor="middle">
              Threshold {threshold} (pre-registered)
            </text>
            <text x="100" y="114" textAnchor="middle">
              Met threshold
            </text>
            <text x="240" y="114" textAnchor="middle">
              Required
            </text>
          </svg>
        }
        table={{
          ariaLabel: 'Pilot customers meeting the paid-use threshold',
          rowKey: (r: { s: string; n: string }) => r.s,
          rowHeader: 's',
          minWidth: 260,
          columns: [
            { key: 's', header: 'Series', cell: (r: { s: string; n: string }) => r.s },
            {
              key: 'n',
              header: 'Pilot customers',
              numeric: true,
              cell: (r: { s: string; n: string }) => r.n,
            },
          ],
          rows: [
            { s: 'Actual · met threshold', n: actual === null ? 'Not recorded' : String(actual) },
            { s: 'Threshold (pre-registered)', n: String(threshold) },
          ],
        }}
      />
    </section>
  );
}

function Readiness({ v }: { v: View }) {
  return (
    <section className="ws8d-section" aria-labelledby="readiness-h">
      <h2 id="readiness-h">Readiness and limitations</h2>
      {v.readiness.map((r) => (
        <div key={r.text} className="ws8d-row">
          <ReviewStatusTag
            status={/pending/i.test(r.status) ? 'pending' : /signed/i.test(r.status) ? 'signed' : 'in_review'}
            extra={r.text}
          />
          <Person name={r.owner.displayName} initials={r.owner.initials} />
        </div>
      ))}
      <p className="ws8d-note" style={{ margin: 0 }}>
        Pilot review does not cover scale. Signed scope: up to 4 sites, 90 days.
      </p>
      <div>
        <Eyebrow>Causal limitations (required)</Eyebrow>
        <ul className="ws8d-list">
          {v.causalLimitations.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function RecommendationCard({ v }: { v: View }) {
  const r = v.recommendation;
  return (
    <section className="ws8d-section ws8d-section--dashed" aria-labelledby="rec-h">
      <div className="ws8d-sub" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
        RECOMMENDATION · NOT A DECISION{r?.accepted ? ' · ACCEPTED' : ''}
      </div>
      {r ? (
        <>
          <h2 id="rec-h" style={{ fontSize: 16 }}>
            {r.label}
          </h2>
          <p className="ws8d-serif" style={{ margin: 0, fontSize: 15.5 }}>
            {r.text}
          </p>
          <p className="ws8d-muted">
            By {r.by.displayName}. A recommendation is not a decision; the sponsor records the decision.
          </p>
        </>
      ) : (
        <>
          <h2 id="rec-h" style={{ fontSize: 16 }}>
            No recommendation yet
          </h2>
          <p className="ws8d-muted">The case owner drafts a recommendation once the actuals are recorded.</p>
        </>
      )}
    </section>
  );
}

function G3Card({ v }: { v: View }) {
  const unmet = v.scaleGate.unmet;
  return (
    <section className="ws8d-section ws8d-section--warn" aria-labelledby="g3-h">
      <div className="ws8d-row">
        <GateDiamond status={v.scaleGate.blocked ? 'blocked' : 'ready_to_submit'} size={16} />
        <h2 id="g3-h">G3 · Scale / enter market — {v.scaleGate.blocked ? 'Blocked' : 'Ready to request'}</h2>
      </div>
      <p className="ws8d-note" style={{ margin: 0, color: 'var(--text-primary)' }}>
        {unmet.length} precondition{unmet.length === 1 ? '' : 's'} unmet:
      </p>
      <ul className="ws8d-plain" style={{ fontSize: 13 }}>
        {unmet.map((b) => (
          <li key={b.key} className="ws8d-row" style={{ alignItems: 'flex-start', gap: 8 }}>
            <span style={{ color: 'var(--neutral-fg)', display: 'inline-flex' }}>
              <Icon name={b.key === 'pilot_actuals_vs_thresholds' ? 'targetdash' : 'dashcircle'} size={15} />
            </span>
            <span>{cap(b.message)}</span>
          </li>
        ))}
      </ul>
      <Button
        variant="decision"
        disabled
        disabledReason="Requesting scale approval is disabled until every G3 precondition is met. No scale investment is requested."
      >
        Authorize scale
      </Button>
    </section>
  );
}

function KeyEvents({
  v,
  baseline,
}: {
  v: View;
  baseline: { snapshotVersion: number; fingerprint: string; approvedAt: string } | null;
}) {
  const items: {
    initials: string | null;
    title: string;
    detail: string;
    when: string;
    keyDecision: boolean;
    at: string;
  }[] = [];
  if (v.decision) {
    items.push({
      initials: v.decision.decidedBy.initials,
      title: `Decision recorded: ${v.decision.label}`,
      detail: `Pilot review v${v.version} · rationale attached`,
      when: fmtDateTime(v.decision.decidedAt),
      keyDecision: true,
      at: v.decision.decidedAt,
    });
  }
  const obs = v.rows.flatMap((r) => (r.latest ? [r.latest] : []));
  if (obs.length) {
    const last = obs.reduce((a, b) => (a.recordedAt > b.recordedAt ? a : b));
    items.push({
      initials: last.recordedBy.initials,
      title: `Actuals recorded for ${fmtPeriod(
        obs.reduce((a, o) => (o.periodStart < a ? o.periodStart : a), last.periodStart),
        obs.reduce((a, o) => (o.periodEnd > a ? o.periodEnd : a), last.periodEnd),
        true,
      )}`,
      detail: obs.map((o) => o.sourceText.replace(/^Source: /, '')).join(' · '),
      when: fmtDateTime(last.recordedAt),
      keyDecision: false,
      at: last.recordedAt,
    });
  }
  if (baseline) {
    items.push({
      initials: null,
      title: 'Pilot approved (G2) with conditions',
      detail: `Snapshot v${baseline.snapshotVersion} · ${baseline.fingerprint}`,
      when: fmtDateTime(baseline.approvedAt),
      keyDecision: true,
      at: baseline.approvedAt,
    });
  }
  if (!items.length) return null;
  return (
    <section aria-labelledby="key-events-h">
      <SectionHeader title="Key events" id="key-events-h" />
      <ActivityTimelineView items={items} ariaLabel="Key events" />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Forms and dialogs
// ---------------------------------------------------------------------------

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>
      {label}
      {children}
      {hint ? <span style={{ display: 'block', fontWeight: 400, marginTop: 4 }}>{hint}</span> : null}
    </label>
  );
}

function RecordActualDialog({ caseKey, row, onClose }: { caseKey: string; row: Row; onClose: () => void }) {
  const t = row.target!;
  const numeric = t.operator !== 'qualitative' && t.thresholdValue !== null;
  const [valueText, setValueText] = useState('');
  const [value, setValue] = useState('');
  const [start, setStart] = useState('2026-12-01');
  const [end, setEnd] = useState('2027-02-28');
  const [source, setSource] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const cmd = useCommand(API.outcomes.recordObservation);
  const valid =
    valueText.trim() &&
    source.trim() &&
    start &&
    end &&
    start <= end &&
    (!numeric || /^\d+(\.\d+)?$/.test(value));
  const submit = async () => {
    setErr(null);
    try {
      await cmd.mutateAsync({
        params: { caseRef: caseKey },
        body: {
          targetId: t.id,
          valueText: valueText.trim(),
          value: numeric ? value : null,
          unit: t.unit,
          periodStart: start,
          periodEnd: end,
          sourceText: source.trim(),
          sourceId: null,
          supersedesId: row.latest?.id ?? null,
        },
      });
      onClose();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <Modal label={`Record actual · ${t.name}`} onClose={onClose}>
      <div className="ws8d-dialog">
        <h2>{`Record actual · ${t.name}`}</h2>
        <p className="ws8d-note" style={{ margin: 0 }}>
          Threshold (pre-registered): {t.thresholdText}. The threshold cannot change here.
        </p>
        <div className="ws8d-form">
          <Field label="Actual (required)">
            <input
              className="ws8d-input"
              value={valueText}
              onChange={(e) => setValueText(e.target.value)}
              placeholder={numeric ? 'e.g. 3 of 4' : ''}
            />
          </Field>
          {numeric ? (
            <Field label={`Value in ${t.unit} (required)`}>
              <input
                className="ws8d-input"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
          ) : null}
          <div className="ws8d-grid" style={{ gap: 12 }}>
            <Field label="Period start (required)">
              <input
                className="ws8d-input"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="Period end (required)">
              <input
                className="ws8d-input"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Source (required)">
            <input
              className="ws8d-input"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. billing records"
            />
          </Field>
        </div>
        {err ? <ProblemBanner error={err} /> : null}
        <div className="ws8d-row">
          <Button
            variant="primary"
            disabled={!valid || cmd.isPending}
            disabledReason="Actual, period and source are required."
            onClick={submit}
          >
            Record actual
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const DECIDE_OPTIONS: { value: DecideOutcome; label: string }[] = [
  { value: 'extend', label: 'Revise and extend validation' },
  { value: 'revise', label: DECISION_OUTCOME_LABELS.revise },
  { value: 'proceed', label: DECISION_OUTCOME_LABELS.proceed },
  { value: 'stop', label: 'Stop case' },
];

function DecisionDialog({
  caseKey,
  v,
  initial,
  onClose,
}: {
  caseKey: string;
  v: View;
  initial: DecideOutcome;
  onClose: () => void;
}) {
  const [outcome, setOutcome] = useState<DecideOutcome>(initial);
  const recLabel = v.recommendation && v.recommendation.outcome === outcome ? v.recommendation.label : null;
  const label = recLabel ?? DECIDE_OPTIONS.find((o) => o.value === outcome)!.label;
  const [rationale, setRationale] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const cmd = useCommand(API.outcomes.decide);
  const submit = async () => {
    setErr(null);
    try {
      await cmd.mutateAsync({
        params: { caseRef: caseKey },
        body: { outcome, label, rationale: rationale.trim() },
      });
      onClose();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <Modal label="Record the outcome decision" onClose={onClose}>
      <div className="ws8d-dialog">
        <h2>Record the outcome decision</h2>
        <div className="ws8d-form">
          <Field label="Decision">
            <select
              className="ws8d-input"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as DecideOutcome)}
            >
              {DECIDE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <TextAreaField label="Rationale" required value={rationale} onChange={setRationale} />
        </div>
        <p className="ws8d-muted">
          Scale is not decided here: it needs a G3 request. An extension needs its own request with its own
          cap.
        </p>
        {err ? <ProblemBanner error={err} /> : null}
        <div className="ws8d-row">
          <Button
            variant="decision"
            disabled={!rationale.trim() || cmd.isPending}
            disabledReason="A rationale is required."
            onClick={submit}
          >
            {`Record decision: ${label}`}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RecommendationForm({ caseKey, v }: { caseKey: string; v: View }) {
  const [outcome, setOutcome] = useState<DecideOutcome>('extend');
  const [text, setText] = useState('');
  // Causal limitations are required before a decision (step 26): pre-filled from the package.
  const [limits, setLimits] = useState(v.causalLimitations.join('\n'));
  const [err, setErr] = useState<unknown>(null);
  const cmd = useCommand(API.outcomes.saveReviewDraft);
  const limitList = limits
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const submit = async () => {
    setErr(null);
    try {
      await cmd.mutateAsync({
        params: { caseRef: caseKey },
        ifMatch: v.rowVersion ?? v.version,
        body: { recommendation: { outcome, text: text.trim() }, causalLimitations: limitList },
      });
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <section className="ws8d-section ws8d-section--dashed" aria-labelledby="rec-form-h">
      <h2 id="rec-form-h">Draft the recommendation</h2>
      <p className="ws8d-muted">A recommendation is not a decision. The sponsor records the decision.</p>
      <div className="ws8d-form">
        <Field label="Recommendation">
          <select
            className="ws8d-input"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as DecideOutcome)}
          >
            {DECIDE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <TextAreaField label="Why" required value={text} onChange={setText} />
        <TextAreaField
          label="Causal limitations"
          hint="one per line; required before a decision"
          required
          value={limits}
          onChange={setLimits}
        />
      </div>
      {err ? <ProblemBanner error={err} /> : null}
      <div className="ws8d-row">
        <Button
          variant="primary"
          disabled={!text.trim() || !limitList.length || cmd.isPending || v.status === 'incomplete'}
          disabledReason={
            v.status === 'incomplete'
              ? 'Record every actual first.'
              : !limitList.length
                ? 'State at least one causal limitation.'
                : 'Explain the recommendation.'
          }
          onClick={submit}
        >
          Save recommendation
        </Button>
      </div>
    </section>
  );
}

function ExtensionForm({
  caseKey,
  parentGateId,
  people,
  defaultOwner,
  onCancel,
  onDone,
}: {
  caseKey: string;
  parentGateId: string;
  people: PersonRef[];
  defaultOwner: string | null;
  onCancel: () => void;
  onDone: (
    g: { key: string; scope: { amount: string | null; currency: string | null }; submittedAt: string | null },
    scope: string,
  ) => void;
}) {
  const [capText, setCapText] = useState('');
  const [days, setDays] = useState('');
  const [owner, setOwner] = useState<string | null>(defaultOwner);
  const [scope, setScope] = useState<boolean[]>([true, true, false]);
  const [err, setErr] = useState<unknown>(null);
  const cmd = useCommand(API.outcomes.requestExtension);
  const chosen = EXT_SCOPE.filter((_, i) => scope[i]);
  // Empty cap / duration = the PRD placeholders €[cap] and [duration] days (PQ-2, D-071): the request
  // can be submitted, never approved, until the PM states them. A stated cap must be positive.
  const capOk = capText.trim() === '' || (DECIMAL.test(capText.trim()) && Number(capText) > 0);
  const daysOk = days.trim() === '' || (/^\d+$/.test(days.trim()) && Number(days) > 0);
  const ready = capOk && daysOk && !!owner && chosen.length > 0;
  const reason = !capOk
    ? 'Enter a positive spend cap, or leave it empty for the €[cap] placeholder.'
    : !daysOk
      ? 'Enter the duration in whole days, or leave it empty for the placeholder.'
      : !owner
        ? 'Choose an accountable owner.'
        : 'Choose at least one scope item.';
  const submit = async () => {
    setErr(null);
    try {
      const g = await cmd.mutateAsync({
        params: { caseRef: caseKey },
        body: {
          parentGateRequestId: parentGateId,
          spendCap: capText.trim() === '' ? null : capText.trim(),
          currency: 'EUR',
          durationDays: days.trim() === '' ? null : Number(days),
          ownerId: owner!,
          scopeItems: chosen,
        },
      });
      onDone(g, chosen.join(' · '));
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <section className="ws8d-section ws8d-section--accent" aria-labelledby="ext-h">
      <h2 id="ext-h" style={{ fontSize: 15 }}>
        Request extension · new gate request
      </h2>
      <div className="ws8d-grid" style={{ gap: 12 }}>
        <Field
          label="Spend cap (EUR, required)"
          hint={
            <span style={{ color: 'var(--warning-fg)', fontSize: 12 }}>
              Placeholder · confirm with PM. The PRD sets no amount.
            </span>
          }
        >
          <input
            className="ws8d-input"
            inputMode="decimal"
            placeholder="€[cap]"
            value={capText}
            onChange={(e) => setCapText(e.target.value)}
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </Field>
        <Field label="Duration in days (required)">
          <input
            className="ws8d-input"
            inputMode="numeric"
            placeholder="[duration] days"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Field>
      </div>
      <OwnerPicker label="Owner" required value={owner} onChange={setOwner} options={people} />
      <fieldset className="ws8d-form" style={{ border: 0, margin: 0, padding: 0, gap: 0 }}>
        <legend style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
          Scope (choose at least one)
        </legend>
        {EXT_SCOPE.map((t, i) => (
          <label key={t} className="ws8d-check">
            <input
              type="checkbox"
              checked={scope[i]}
              onChange={() => setScope((s) => s.map((x, j) => (j === i ? !x : x)))}
            />
            {t}
          </label>
        ))}
      </fieldset>
      <AuthBoxes
        authorizes={['Extension work within €[cap] and the chosen scope', 'The existing 4 pilot sites']}
        doesNotAuthorize={['Not scale', 'No new sites without a new gate', 'Does not unblock G3']}
      />
      {err ? <ProblemBanner error={err} /> : null}
      <div className="ws8d-row">
        <Button variant="primary" disabled={!ready || cmd.isPending} disabledReason={reason} onClick={submit}>
          {`Submit extension request ${capOk && capText.trim() ? formatBudget(capText.trim(), 'EUR') : '€[cap]'}`}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
