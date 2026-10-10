/**
 * Experiment card (ExperimentCardProps, Validation.dc.html EXP-03): pre-registered plan locked at
 * G1, decision rule, results (append-only versions), amendments with the original struck through
 * and labelled "Original (pre-registered)". Thresholds never move silently (never-rule 12).
 */
import {
  API,
  type Assumption,
  type Experiment,
  type ExperimentMetric,
  type ExperimentPlan,
  type ExperimentResultVersion,
  type PersonRef,
} from '@growth-os/contracts';
import {
  Button,
  DataTable,
  Eyebrow,
  formatBudget,
  formatOf,
  Icon,
  KindTag,
  Mono,
  ResultGlyph,
  TextAreaField,
} from '@growth-os/ui';
import { useId, useState, type ReactNode } from 'react';
import { Field } from './Field';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useCommand } from '../../lib/query';
import { dateRange, dayMonth, period } from '../decisions/dates';

export interface ExperimentCardViewProps {
  experiment: Experiment;
  assumptions: Assumption[];
  viewer: PersonRef | null;
}

function windowText(plan: ExperimentPlan): string {
  return dateRange(plan.windowStart, plan.windowEnd);
}

function budgetText(plan: ExperimentPlan): string {
  if (plan.budgetNote) return plan.budgetNote;
  return plan.budgetAmount && plan.currency ? formatBudget(plan.budgetAmount, plan.currency) : 'Not set';
}

/** "Amendment n" that last changed a plan field (for the label beside the current value). */
function amendmentFor(e: Experiment, field: keyof ExperimentPlan): number | null {
  const a = [...e.amendments].reverse().find((x) => x.changedFields.includes(field));
  return a ? a.number : null;
}

function Amended({
  original,
  current,
  amendment,
}: {
  original: ReactNode;
  current: ReactNode;
  amendment: number | null;
}) {
  if (amendment === null) return <>{current}</>;
  return (
    <>
      <del>{original}</del> <span className="ws8c-orig">Original (pre-registered)</span> → {current}{' '}
      <span className="ws8c-amend">Amendment {amendment}</span>
    </>
  );
}

function resultCell(m: ExperimentMetric, latest: ExperimentResultVersion | undefined, e: Experiment) {
  const o = latest?.observations.find((x) => x.metricKey === m.metricKey);
  if (!o || o.result === null) {
    return <ResultGlyph result={e.lifecycle === 'draft' ? 'planned' : 'running'} />;
  }
  const extra =
    o.observed !== null && m.thresholdValue !== null
      ? formatOf(Number(o.observed), Number(m.thresholdValue))
      : o.observedText;
  return <ResultGlyph result={o.result} extra={extra} />;
}

export function ExperimentCard({ experiment: e, assumptions, viewer }: ExperimentCardViewProps) {
  const titleId = useId();
  const [mode, setMode] = useState<'amend' | 'result' | 'decision' | null>(null);
  const original = e.original?.plan ?? e.current.plan;
  const plan = e.current.plan;
  const latest = e.results[e.results.length - 1];
  const earlier = e.results.slice(0, -1);
  const canEdit =
    !!viewer && (viewer.id === e.owner.id || (!!e.fieldworkOwner && viewer.id === e.fieldworkOwner.id));
  const locked = e.lifecycle !== 'draft' && e.lifecycle !== 'cancelled';
  const linked = assumptions.filter((a) => e.linkedAssumptionIds.includes(a.id)).map((a) => a.name);
  const windowAmend = amendmentFor(e, 'windowEnd') ?? amendmentFor(e, 'windowStart');

  return (
    <section aria-labelledby={titleId} className="ws8c-card" data-experiment={e.key}>
      <div className="ws8c-card__head">
        <Mono size={12.5} strong>
          {e.key}
        </Mono>
        <h2 id={titleId}>{e.title}</h2>
        <span className="ws8c-card__head-right">
          {e.lockedAt ? (
            <>
              <Icon name="lock" size={13} />
              Plan locked at G1 · {dayMonth(e.lockedAt)}
            </>
          ) : (
            <>
              <Icon name="pencil" size={13} />
              Draft · locks when G1 approves
            </>
          )}
        </span>
      </div>
      <div className="ws8c-card__body">
        <div>
          <Eyebrow>Plan</Eyebrow>
          <p className="ws8c-serif">{plan.hypothesis}</p>
        </div>
        <dl className="ws8c-dl">
          <dt>Linked assumptions</dt>
          <dd>{linked.length ? linked.join(' · ') : '—'}</dd>
          <dt>Method</dt>
          <dd>{plan.method}</dd>
          <dt>Sample</dt>
          <dd>
            <Amended
              original={original.sampleText}
              current={plan.sampleText}
              amendment={amendmentFor(e, 'sampleText')}
            />
          </dd>
          <dt>Nonresponse</dt>
          <dd>{plan.nonresponseNote}</dd>
          <dt>Window</dt>
          <dd>
            <Amended original={windowText(original)} current={windowText(plan)} amendment={windowAmend} />
          </dd>
          <dt>Budget</dt>
          <dd>{budgetText(plan)}</dd>
          <dt>Owner · due</dt>
          <dd>
            {e.owner.displayName}
            {e.fieldworkOwner ? ` · fieldwork ${e.fieldworkOwner.displayName}` : ''}
            {e.dueOn ? ` · due ${dayMonth(e.dueOn)}` : ''}
          </dd>
        </dl>
        {plan.decisionRules.length ? (
          <div>
            <Eyebrow>Decision rule (pre-registered)</Eyebrow>
            <ul className="ws8c-list">
              {plan.decisionRules.map((r) => (
                <li key={r.condition}>
                  {r.condition} → {r.action}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <Eyebrow>Result</Eyebrow>
          <DataTable
            ariaLabel={`${e.key} thresholds and results`}
            minWidth={460}
            rows={plan.metrics}
            rowKey={(m) => m.metricKey}
            columns={[
              { key: 'metric', header: 'Metric', cell: (m) => m.name },
              {
                key: 'threshold',
                header: 'Threshold (pre-registered)',
                numeric: true,
                cell: (m) => {
                  const o = original.metrics.find((x) => x.metricKey === m.metricKey);
                  return (
                    <Amended
                      original={o?.thresholdText ?? '—'}
                      current={m.thresholdText}
                      amendment={o && o.thresholdText !== m.thresholdText ? amendmentFor(e, 'metrics') : null}
                    />
                  );
                },
              },
              {
                key: 'observed',
                header: 'Observed',
                numeric: true,
                cell: (m) =>
                  latest?.observations.find((x) => x.metricKey === m.metricKey)?.observedText ?? '—',
              },
              { key: 'result', header: 'Result', cell: (m) => resultCell(m, latest, e) },
            ]}
          />
          {latest ? (
            <div className="ws8c-stack" style={{ marginTop: 10, fontSize: 13, gap: 6 }}>
              <div>
                <span className="ws8c-muted">Measured</span>{' '}
                <KindTag
                  kind="actual"
                  small
                  detail={`${period(latest.periodStart, latest.periodEnd)} · ${latest.sourceText}`}
                />
              </div>
              <div>
                <span className="ws8c-muted">Interpretation</span> {latest.interpretation}
              </div>
              <div>
                <span className="ws8c-muted">Limitations</span> {latest.limitations}
              </div>
              {e.decisionTaken ? (
                <div>
                  <span className="ws8c-muted">Decision taken</span> {e.decisionTaken.text} ·{' '}
                  {e.decisionTaken.by.displayName} · {dayMonth(e.decisionTaken.at)}
                </div>
              ) : null}
              {e.results.length > 1 ? (
                <div className="ws8c-small ws8c-muted">
                  Result v{latest.version} · earlier versions stay visible below.
                </div>
              ) : null}
            </div>
          ) : locked ? (
            <div style={{ marginTop: 8 }}>
              <ResultGlyph result="too_early_to_read" extra={`window closes ${dayMonth(plan.windowEnd)}`} />
            </div>
          ) : null}
          {earlier.length ? (
            <details style={{ marginTop: 8, fontSize: 13 }}>
              <summary style={{ cursor: 'pointer' }}>Earlier result versions ({earlier.length})</summary>
              <ul className="ws8c-list">
                {earlier.map((r) => (
                  <li key={r.id}>
                    Result v{r.version} · recorded {dayMonth(r.recordedAt)} by {r.recordedBy.displayName} ·{' '}
                    {r.observations.map((o) => `${o.observedText} (${o.result ?? 'not read'})`).join(' · ')}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
        {e.amendments.length ? (
          <div>
            <Eyebrow>Amendments</Eyebrow>
            <ol className="ws8c-list">
              {e.amendments.map((a) => (
                <li key={a.id}>
                  <b style={{ fontWeight: 600 }}>Amendment {a.number}</b> · {dayMonth(a.createdAt)} ·{' '}
                  {a.author.displayName} · {a.reason}
                  {a.afterResultsSeen ? ' · made after results were seen' : ''}
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {canEdit && locked ? <ExperimentActions experiment={e} mode={mode} setMode={setMode} /> : null}
      </div>
    </section>
  );
}

function ExperimentActions({
  experiment: e,
  mode,
  setMode,
}: {
  experiment: Experiment;
  mode: 'amend' | 'result' | 'decision' | null;
  setMode: (m: 'amend' | 'result' | 'decision' | null) => void;
}) {
  const hasResult = e.results.length > 0;
  // Locked by G1 → the owner starts fieldwork (experiments.start re-checks the G1 approval, D-099);
  // results can be recorded once it runs.
  const start = useCommand(API.experiments.start);
  if (mode === 'amend') return <AmendForm experiment={e} onDone={() => setMode(null)} />;
  if (mode === 'result') return <ResultForm experiment={e} onDone={() => setMode(null)} />;
  if (mode === 'decision') return <DecisionForm experiment={e} onDone={() => setMode(null)} />;
  return (
    <div className="ws8c-row">
      {!hasResult ? (
        <>
          <Button variant="secondary" icon="pencil" onClick={() => setMode('amend')}>
            Amend plan
          </Button>
          {e.lifecycle === 'locked' ? (
            <Button
              variant="primary"
              icon="flag"
              disabled={start.isPending}
              disabledReason={start.isPending ? 'Starting…' : undefined}
              onClick={() => start.mutate({ params: { id: e.id } })}
            >
              Start fieldwork
            </Button>
          ) : (
            <Button variant="primary" icon="flag" onClick={() => setMode('result')}>
              Record results
            </Button>
          )}
          {start.error ? <ProblemBanner error={start.error} /> : null}
        </>
      ) : (
        <>
          <Button variant="secondary" icon="flag" onClick={() => setMode('result')}>
            Record a new result version
          </Button>
          {!e.decisionTaken ? (
            <Button variant="primary" onClick={() => setMode('decision')}>
              Record decision taken
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

function AmendForm({ experiment: e, onDone }: { experiment: Experiment; onDone: () => void }) {
  const [windowEnd, setWindowEnd] = useState(e.current.plan.windowEnd);
  const [reason, setReason] = useState('');
  const amend = useCommand(API.experiments.amend, { onSuccess: onDone });
  const changed = windowEnd !== e.current.plan.windowEnd;
  return (
    <form
      className="ws8c-form"
      aria-label={`Amend ${e.key}`}
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!changed || !reason.trim()) return;
        amend.mutate({ params: { id: e.id }, body: { reason: reason.trim(), plan: { windowEnd } } });
      }}
    >
      <h3>Amendment {e.amendments.length + 1}</h3>
      <p className="ws8c-small ws8c-secondary" style={{ margin: 0 }}>
        The pre-registered plan stays visible, struck through. Thresholds stay as locked at G1.
      </p>
      <Field label="New window end" type="date" value={windowEnd} onChange={setWindowEnd} required />
      <TextAreaField label="Reason" required value={reason} onChange={setReason} rows={2} />
      {amend.error ? <ProblemBanner error={amend.error} /> : null}
      <div className="ws8c-row">
        <Button
          variant="primary"
          type="submit"
          disabled={!changed || !reason.trim() || amend.isPending}
          disabledReason={!changed ? 'Change the window first.' : 'Give the reason for the amendment.'}
        >
          Save amendment
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ResultForm({ experiment: e, onDone }: { experiment: Experiment; onDone: () => void }) {
  const plan = e.current.plan;
  const [observed, setObserved] = useState<Record<string, string>>({});
  const [start, setStart] = useState(plan.windowStart);
  const [end, setEnd] = useState(plan.windowEnd);
  const [source, setSource] = useState('');
  const [interpretation, setInterpretation] = useState('');
  const [limitations, setLimitations] = useState('');
  const record = useCommand(API.experiments.recordResult, { onSuccess: onDone });
  const complete =
    plan.metrics.every((m) => (observed[m.metricKey] ?? '').trim() !== '') &&
    !!start &&
    !!end &&
    !!source.trim() &&
    !!interpretation.trim() &&
    !!limitations.trim();
  return (
    <form
      className="ws8c-form"
      aria-label={`Record results for ${e.key}`}
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!complete) return;
        record.mutate({
          params: { id: e.id },
          body: {
            observations: plan.metrics.map((m) => ({
              metricKey: m.metricKey,
              observed: observed[m.metricKey]!.trim(),
              observedText: observed[m.metricKey]!.trim(),
            })),
            periodStart: start,
            periodEnd: end,
            sourceText: source.trim(),
            interpretation: interpretation.trim(),
            limitations: limitations.trim(),
          },
        });
      }}
    >
      <h3>Record results{e.results.length ? ` · version ${e.results.length + 1}` : ''}</h3>
      <p className="ws8c-small ws8c-secondary" style={{ margin: 0 }}>
        Results are compared with the pre-registered thresholds. Earlier versions are kept.
      </p>
      <div className="ws8c-form__grid">
        {plan.metrics.map((m) => (
          <Field
            key={m.metricKey}
            label={`${m.name} · observed`}
            hint={`threshold ${m.thresholdText}`}
            type="number"
            required
            value={observed[m.metricKey] ?? ''}
            onChange={(v) => setObserved((o) => ({ ...o, [m.metricKey]: v }))}
          />
        ))}
      </div>
      <div className="ws8c-form__grid">
        <Field label="Period start" type="date" required value={start} onChange={setStart} />
        <Field label="Period end" type="date" required value={end} onChange={setEnd} />
      </div>
      <Field label="Source" required value={source} onChange={setSource} />
      <TextAreaField
        label="Interpretation"
        required
        value={interpretation}
        onChange={setInterpretation}
        rows={2}
      />
      <TextAreaField label="Limitations" required value={limitations} onChange={setLimitations} rows={2} />
      {record.error ? <ProblemBanner error={record.error} /> : null}
      <div className="ws8c-row">
        <Button
          variant="primary"
          type="submit"
          disabled={!complete || record.isPending}
          disabledReason="Every observation, the period, source, interpretation and limitations are required."
        >
          Record results
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DecisionForm({ experiment: e, onDone }: { experiment: Experiment; onDone: () => void }) {
  const [text, setText] = useState('');
  const record = useCommand(API.experiments.recordDecision, { onSuccess: onDone });
  return (
    <form
      className="ws8c-form"
      aria-label={`Record the decision taken on ${e.key}`}
      onSubmit={(ev) => {
        ev.preventDefault();
        if (text.trim()) record.mutate({ params: { id: e.id }, body: { decisionText: text.trim() } });
      }}
    >
      <h3>Decision taken</h3>
      <p className="ws8c-small ws8c-secondary" style={{ margin: 0 }}>
        Apply the pre-registered rule:{' '}
        {e.current.plan.decisionRules.map((r) => `${r.condition} → ${r.action}`).join('; ')}.
      </p>
      <Field label="Decision" required value={text} onChange={setText} />
      {record.error ? <ProblemBanner error={record.error} /> : null}
      <div className="ws8c-row">
        <Button
          variant="primary"
          type="submit"
          disabled={!text.trim() || record.isPending}
          disabledReason="Write the decision taken."
        >
          Record decision
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
