/**
 * Create a draft validation experiment with pre-registered thresholds (acceptance step 10).
 * The plan stays editable as a draft until G1 approves it; then it locks and any change is an
 * amendment with a reason.
 */
import {
  API,
  type Assumption,
  type DecisionRule,
  type ExperimentMetric,
  type PersonRef,
} from '@growth-os/contracts';
import { Button, OwnerPicker, TextAreaField } from '@growth-os/ui';
import { useId, useState } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useCommand } from '../../lib/query';
import { Field } from './Field';

interface MetricDraft {
  name: string;
  threshold: string;
  unit: string;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'metric';

/** "≥ 4 commitments → prepare G2 pilot request", one rule per line. */
export function parseRules(text: string): DecisionRule[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [condition, ...rest] = l.split(/\s*(?:→|->)\s*/);
      return { condition: (condition ?? l).trim(), action: rest.join(' → ').trim() || '—' };
    });
}

export function NewExperimentForm({
  caseKey,
  assumptions,
  owner,
  onCancel,
}: {
  caseKey: string;
  assumptions: Assumption[];
  owner: PersonRef;
  onCancel: () => void;
}) {
  const ids = useId();
  const [title, setTitle] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [method, setMethod] = useState('');
  const [sampleText, setSampleText] = useState('');
  const [sampleSize, setSampleSize] = useState('');
  const [nonresponse, setNonresponse] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [budget, setBudget] = useState('');
  const [metrics, setMetrics] = useState<MetricDraft[]>([
    { name: '', threshold: '', unit: '' },
    { name: '', threshold: '', unit: '' },
  ]);
  const [rules, setRules] = useState('');
  const [linked, setLinked] = useState<string[]>([]);
  const [fieldwork, setFieldwork] = useState<string | null>(null);
  const create = useCommand(API.experiments.create);

  const people = [...new Map(assumptions.map((a) => [a.owner.id, a.owner])).values()];
  const filledMetrics = metrics.filter((m) => m.name.trim() && m.threshold.trim());
  const missing = [
    !title.trim() && 'title',
    !hypothesis.trim() && 'hypothesis',
    !method.trim() && 'method',
    !sampleText.trim() && 'sample',
    !windowStart && 'window start',
    !windowEnd && 'window end',
    !budget.trim() && 'budget',
    filledMetrics.length === 0 && 'at least one threshold',
    linked.length === 0 && 'a linked assumption',
  ].filter(Boolean) as string[];

  const submit = () => {
    if (missing.length) return;
    const ms: ExperimentMetric[] = filledMetrics.map((m) => ({
      metricKey: slug(m.name),
      name: m.name.trim(),
      operator: 'gte',
      thresholdValue: String(Number(m.threshold)),
      thresholdText: `≥ ${Number(m.threshold)}`,
      unit: m.unit.trim() || 'count',
    }));
    create.mutate({
      params: { caseRef: caseKey },
      body: {
        title: title.trim(),
        assumptionIds: linked,
        ownerId: owner.id,
        fieldworkOwnerId: fieldwork,
        plan: {
          hypothesis: hypothesis.trim(),
          method: method.trim(),
          sampleText: sampleText.trim(),
          sampleSize: sampleSize ? Number(sampleSize) : null,
          selectionText: sampleText.trim(),
          nonresponseNote: nonresponse.trim() || 'Declines are recorded. Results describe responders only.',
          windowStart,
          windowEnd,
          budgetAmount: Number(budget).toFixed(2),
          currency: 'EUR',
          budgetNote: null,
          metrics: ms,
          decisionRules: parseRules(rules),
        },
      },
    });
  };

  return (
    <form
      className="ws8c-card"
      aria-labelledby={`${ids}-t`}
      onSubmit={(ev) => {
        ev.preventDefault();
        submit();
      }}
    >
      <div className="ws8c-card__head">
        <h2 id={`${ids}-t`}>New validation experiment</h2>
        <span className="ws8c-card__head-right">Draft · thresholds lock when G1 approves</span>
      </div>
      <div className="ws8c-card__body">
        <Field label="Title" required value={title} onChange={setTitle} />
        <TextAreaField label="Hypothesis" required value={hypothesis} onChange={setHypothesis} rows={2} />
        <Field label="Method" required value={method} onChange={setMethod} />
        <div className="ws8c-form__grid">
          <Field label="Sample" required value={sampleText} onChange={setSampleText} />
          <Field label="Sample size (sites)" type="number" value={sampleSize} onChange={setSampleSize} />
        </div>
        <Field label="Nonresponse" value={nonresponse} onChange={setNonresponse} />
        <div className="ws8c-form__grid">
          <Field label="Window start" type="date" required value={windowStart} onChange={setWindowStart} />
          <Field label="Window end" type="date" required value={windowEnd} onChange={setWindowEnd} />
          <Field label="Budget (EUR)" type="number" required value={budget} onChange={setBudget} />
        </div>
        <fieldset className="gos-field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 6 }}>Thresholds (pre-registered, at least)</legend>
          {metrics.map((m, i) => (
            <div key={i} className="ws8c-form__grid">
              <Field
                label={`Metric ${i + 1}`}
                value={m.name}
                onChange={(v) => setMetrics((ms) => ms.map((x, j) => (j === i ? { ...x, name: v } : x)))}
              />
              <Field
                label={`Metric ${i + 1} threshold (≥)`}
                type="number"
                value={m.threshold}
                onChange={(v) => setMetrics((ms) => ms.map((x, j) => (j === i ? { ...x, threshold: v } : x)))}
              />
              <Field
                label={`Metric ${i + 1} unit`}
                value={m.unit}
                onChange={(v) => setMetrics((ms) => ms.map((x, j) => (j === i ? { ...x, unit: v } : x)))}
              />
            </div>
          ))}
        </fieldset>
        <TextAreaField
          label="Decision rule"
          hint="one per line: condition → action"
          value={rules}
          onChange={setRules}
          rows={3}
        />
        <fieldset className="gos-field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 6 }}>Linked assumptions</legend>
          {assumptions
            .filter((a) => a.registerGroup === 'test_first' || a.registerGroup === 'test_next')
            .map((a) => (
              <label key={a.id} className="ws8c-check">
                <input
                  type="checkbox"
                  checked={linked.includes(a.id)}
                  onChange={(ev) =>
                    setLinked((l) => (ev.target.checked ? [...l, a.id] : l.filter((x) => x !== a.id)))
                  }
                />
                <span>
                  {a.name} <span className="ws8c-muted">· {a.owner.displayName}</span>
                </span>
              </label>
            ))}
        </fieldset>
        <OwnerPicker
          label="Fieldwork owner"
          value={fieldwork}
          onChange={setFieldwork}
          options={people}
          hint="Optional"
        />
        {create.error ? <ProblemBanner error={create.error} /> : null}
        <div className="ws8c-row">
          <Button
            variant="primary"
            type="submit"
            disabled={missing.length > 0 || create.isPending}
            disabledReason={create.isPending ? 'Saving…' : `Still needed: ${missing.join(', ')}.`}
          >
            Create experiment
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}
