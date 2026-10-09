/**
 * Preparing a G2 request (acceptance step 17): the case owner states the scope (budget, duration,
 * sites, owner), what it authorizes and does not, and proposes conditions; then submits. Submit
 * checks the deterministic preconditions and freezes a hashed snapshot. The package itself is
 * assembled from committed versions by the server, never typed here.
 */
import {
  API,
  GATE_STATUS_LABELS,
  type ConditionInput,
  type GateRequest,
  type PersonRef,
} from '@growth-os/contracts';
import {
  AuthBoxes,
  Button,
  ConditionFlagTag,
  ConditionItem,
  formatBudget,
  GateChip,
  Icon,
  OwnerPicker,
  Skeleton,
  TextAreaField,
} from '@growth-os/ui';
import { useId, useState } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';
import { Field } from '../validation/Field';
import { dayMonth, fullDate } from './dates';

const lines = (t: string) =>
  t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

export function PrepareG2Form({ caseKey, people }: { caseKey: string; people: PersonRef[] }) {
  const ids = useId();
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [sites, setSites] = useState('');
  const [countries, setCountries] = useState('');
  const [segment, setSegment] = useState('');
  const [owner, setOwner] = useState<string | null>(null);
  const [authorizes, setAuthorizes] = useState('');
  const [notAuthorizes, setNotAuthorizes] = useState('');
  const [conditions, setConditions] = useState<ConditionInput[]>([]);
  const create = useCommand(API.gates.createRequest);
  const missing = [
    !amount && 'budget',
    !days && 'duration',
    !owner && 'pilot owner',
    !lines(authorizes).length && 'what this authorizes',
    !lines(notAuthorizes).length && 'what this does not authorize',
  ].filter(Boolean) as string[];
  return (
    <form
      className="ws8c-card"
      aria-labelledby={`${ids}-t`}
      onSubmit={(e) => {
        e.preventDefault();
        if (missing.length) return;
        create.mutate({
          params: { caseRef: caseKey },
          body: {
            gateCode: 'G2',
            parentGateRequestId: null,
            proposedConditions: conditions,
            scope: {
              amount: Number(amount).toFixed(2),
              currency: 'EUR',
              durationDays: Number(days),
              windowStart: start || null,
              windowEnd: end || null,
              countryCodes: countries
                .split(/[,\s]+/)
                .map((c) => c.trim().toUpperCase())
                .filter((c) => /^[A-Z]{2}$/.test(c)),
              segmentLabel: segment.trim() || null,
              maxSites: sites ? Number(sites) : null,
              milestones: [],
              ownerId: owner,
              authorizes: lines(authorizes),
              doesNotAuthorize: lines(notAuthorizes),
            },
          },
        });
      }}
    >
      <div className="ws8c-card__head">
        <h2 id={`${ids}-t`}>Prepare G2 · pilot request</h2>
        <span className="ws8c-card__head-right">Draft · nothing is frozen until you submit</span>
      </div>
      <div className="ws8c-card__body">
        <div className="ws8c-form__grid">
          <Field label="Budget ceiling (EUR)" type="number" required value={amount} onChange={setAmount} />
          <Field label="Duration (days)" type="number" required value={days} onChange={setDays} />
          <Field label="Up to sites" type="number" value={sites} onChange={setSites} />
        </div>
        <div className="ws8c-form__grid">
          <Field label="Window start" type="date" value={start} onChange={setStart} />
          <Field label="Window end" type="date" value={end} onChange={setEnd} />
        </div>
        <div className="ws8c-form__grid">
          <Field label="Countries" hint="ISO codes, e.g. DE" value={countries} onChange={setCountries} />
          <Field label="Segment" value={segment} onChange={setSegment} />
        </div>
        <OwnerPicker label="Pilot owner" required value={owner} onChange={setOwner} options={people} />
        <TextAreaField
          label="What this authorizes"
          hint="one per line"
          value={authorizes}
          onChange={setAuthorizes}
          rows={3}
        />
        <TextAreaField
          label="What this does not authorize"
          hint="one per line"
          value={notAuthorizes}
          onChange={setNotAuthorizes}
          rows={3}
        />
        <ConditionList people={people} value={conditions} onChange={setConditions} />
        {create.error ? <ProblemBanner error={create.error} /> : null}
        <div className="ws8c-row">
          <Button
            variant="primary"
            type="submit"
            disabled={missing.length > 0 || create.isPending}
            disabledReason={create.isPending ? 'Saving…' : `Still needed: ${missing.join(', ')}.`}
          >
            Save draft request
          </Button>
        </div>
      </div>
    </form>
  );
}

function ConditionList({
  people,
  value,
  onChange,
}: {
  people: PersonRef[];
  value: ConditionInput[];
  onChange: (v: ConditionInput[]) => void;
}) {
  const base = useId();
  const [text, setText] = useState('');
  const [ownerId, setOwnerId] = useState(people[0]?.id ?? '');
  const [due, setDue] = useState('');
  const [flag, setFlag] = useState<ConditionInput['flag']>('blocks_execution');
  return (
    <fieldset className="gos-field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ marginBottom: 6 }}>
        Proposed conditions <span className="gos-field__hint">(optional)</span>
      </legend>
      {value.length ? (
        <ul className="gos-list-plain ws8c-stack" style={{ marginBottom: 8 }}>
          {value.map((c, i) => (
            <li key={`${c.text}-${i}`} className="ws8c-row">
              <b style={{ fontWeight: 600 }}>C{i + 1}</b> {c.text} <ConditionFlagTag flag={c.flag} />
              <button
                type="button"
                className="gos-ibtn"
                aria-label={`Remove condition C${i + 1}: ${c.text}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Field label="Condition" value={text} onChange={setText} />
      <div className="ws8c-form__grid">
        <label className="gos-field" htmlFor={`${base}-o`}>
          Condition owner
          <select
            id={`${base}-o`}
            className="gos-select"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <Field label="Due" type="date" value={due} onChange={setDue} />
      </div>
      <div role="radiogroup" aria-label="Effect of the condition" className="ws8c-row">
        {(['blocks_execution', 'monitor_only'] as const).map((f) => (
          <label key={f} className="gos-radio">
            <input type="radio" name={`${base}-f`} checked={flag === f} onChange={() => setFlag(f)} />
            <ConditionFlagTag flag={f} />
          </label>
        ))}
      </div>
      <div>
        <Button
          variant="secondary"
          icon="plus"
          disabled={!text.trim() || !ownerId}
          disabledReason="Describe the condition first."
          onClick={() => {
            onChange([...value, { text: text.trim(), ownerId, dueOn: due || null, dueRule: null, flag }]);
            setText('');
            setDue('');
          }}
        >
          Add condition
        </Button>
      </div>
    </fieldset>
  );
}

/** A draft request: scope, proposed conditions, preconditions and the Submit action. */
export function DraftRequest({
  caseKey,
  request,
  canSubmit,
  onSubmitted,
}: {
  caseKey: string;
  request: GateRequest;
  canSubmit: boolean;
  onSubmitted: (version: number) => void;
}) {
  const pre = useApiQuery(API.gates.rail, { params: { caseRef: caseKey, gateCode: request.gateCode } });
  const submit = useCommand(API.gates.submit, { onSuccess: (r) => onSubmitted(r.snapshot.version) });
  const sc = request.scope;
  if (pre.isPending) return <Skeleton height={240} />;
  if (pre.error) return <ProblemBanner error={pre.error} />;
  const unmet = pre.data.preconditions.filter((p) => !p.met);
  return (
    <section className="ws8c-card" aria-labelledby="ws8c-draft-title">
      <div className="ws8c-card__head">
        <h2 id="ws8c-draft-title">
          {request.gateCode} · {request.buttonLabel}
        </h2>
        <span className="ws8c-card__head-right">
          <GateChip
            status={request.displayStatus}
            text={`Draft · ${GATE_STATUS_LABELS[request.displayStatus]}`}
          />
        </span>
      </div>
      <div className="ws8c-card__body">
        <dl className="ws8c-dl">
          <dt>Budget</dt>
          <dd>{sc.amount && sc.currency ? formatBudget(sc.amount, sc.currency) : '—'}</dd>
          <dt>Duration</dt>
          <dd>
            {sc.durationDays ? `${sc.durationDays} days` : '—'}
            {sc.windowStart && sc.windowEnd
              ? ` · ${fullDate(sc.windowStart)} – ${fullDate(sc.windowEnd)}`
              : ''}
          </dd>
          <dt>Sites</dt>
          <dd>{sc.maxSites ? `Up to ${sc.maxSites}` : '—'}</dd>
        </dl>
        <AuthBoxes authorizes={sc.authorizes} doesNotAuthorize={sc.doesNotAuthorize} />
        {request.conditions.length ? (
          <div className="ws8c-stack">
            {request.conditions.map((c) => (
              <ConditionItem
                key={c.key}
                conditionKey={c.key}
                text={c.text}
                owner={c.owner.displayName}
                due={c.dueOn ? dayMonth(c.dueOn) : (c.dueRule ?? '—')}
                flag={c.flag}
                status={c.status}
              />
            ))}
          </div>
        ) : null}
        <ul
          className="gos-list-plain ws8c-stack"
          aria-label={`${request.gateCode} preconditions`}
          style={{ gap: 4, fontSize: 13 }}
        >
          {pre.data.preconditions.map((p) => (
            <li key={p.key} className="ws8c-row" style={{ gap: 6 }}>
              <span
                style={{ color: p.met ? 'var(--success-fg)' : 'var(--warning-fg)', display: 'inline-flex' }}
              >
                <Icon name={p.met ? 'checkcircle' : 'alert'} size={14} label={p.met ? 'Met' : 'Not met'} />
              </span>
              {p.label}
            </li>
          ))}
        </ul>
        {submit.error ? <ProblemBanner error={submit.error} /> : null}
        {canSubmit ? (
          <div className="ws8c-row">
            <Button
              variant="primary"
              icon="send"
              disabled={!pre.data.canSubmit || submit.isPending}
              disabledReason={
                submit.isPending
                  ? 'Freezing the snapshot…'
                  : `${request.gateCode} preconditions unmet: ${unmet.map((p) => p.label.toLowerCase()).join('; ')}`
              }
              onClick={() => submit.mutate({ params: { id: request.id } })}
            >
              Submit for decision
            </Button>
            <span className="ws8c-small ws8c-secondary">
              Freezes a hashed snapshot of the committed sizing, economics, results, sign-offs and dissent.
            </span>
          </div>
        ) : (
          <p className="ws8c-secondary" style={{ margin: 0, fontSize: 13 }}>
            The case owner submits this request.
          </p>
        )}
      </div>
    </section>
  );
}
