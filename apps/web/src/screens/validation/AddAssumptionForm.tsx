/**
 * S09 "Add assumption" (D-112 §1): statement; value and unit; owner; confidence basis (Evidence linked to
 * sources, or "Assumption — no evidence"); decision sensitivity High · Medium · Low; decision-critical;
 * validation method; due date. A blank value is never 0: the form asks for a value or a description in
 * words. Rates are typed as percentages and sent as fractions; money carries its currency and price year.
 */
import { API, SENSITIVITY_LABELS, Sensitivity, type PersonRef, type ValueUnit } from '@growth-os/contracts';
import { Button, OwnerPicker, TextAreaField } from '@growth-os/ui';
import { useId, useState } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { usePeople } from '../../lib/people';
import { useApiQuery, useCommand } from '../../lib/query';
import { Field } from './Field';
import { decimalValue, percentToFraction } from './register';

/** Model inputs the engines read (`inputKey`), with the unit each one needs. */
const MODEL_INPUTS: { key: string; label: string; unit: ValueUnit }[] = [
  { key: 'adoption_rate.base', label: 'Adoption · Base scenario', unit: 'rate' },
  { key: 'adoption_rate.downside', label: 'Adoption · Downside scenario', unit: 'rate' },
  { key: 'adoption_rate.upside', label: 'Adoption · Upside scenario', unit: 'rate' },
  { key: 'annual_spend_per_site', label: 'Annual spend per site', unit: 'currency_per_year_per_site' },
  { key: 'reachable_pool', label: 'Reachable pool (sites)', unit: 'sites' },
  // Capacity is counted in customers, the unit the sizing and economics engines read (ASM-08).
  { key: 'capacity', label: 'Delivery capacity (customers)', unit: 'customers' },
  { key: 'gross_margin', label: 'Gross margin', unit: 'rate' },
  { key: 'annual_incremental_opex', label: 'Annual incremental opex', unit: 'currency_per_year' },
  { key: 'one_time_investment', label: 'One-time investment', unit: 'currency_one_time' },
  { key: 'hours_per_site', label: 'Deployment effort per site', unit: 'hours_per_site' },
];
const OTHER = 'other';

const UNIT_TEXT: Record<ValueUnit, string> = {
  sites: 'sites',
  companies: 'companies',
  customers: 'customers',
  rate: '%',
  currency_per_year_per_site: 'per site per year',
  currency_per_year: 'per year',
  currency_one_time: 'one-time',
  interviews: 'interviews',
  commitments: 'commitments',
  hours_per_site: 'hours per site',
  text: 'described in words',
};
const MONEY = new Set<ValueUnit>(['currency_per_year_per_site', 'currency_per_year', 'currency_one_time']);
const OTHER_UNITS: ValueUnit[] = [
  'sites',
  'companies',
  'customers',
  'rate',
  'interviews',
  'commitments',
  'text',
];

/** Stacked radio and checkbox rows keep 24px targets apart (WCAG 2.2 target size). */
const CHECK_ROW = { padding: '6px 0', alignItems: 'center' } as const;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || 'assumption';

export function AddAssumptionForm({
  caseKey,
  viewer,
  canAdd,
  usedKeys,
}: {
  caseKey: string;
  viewer: PersonRef | null;
  canAdd: boolean;
  /** Input keys already in the register (one assumption per input). */
  usedKeys: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!canAdd) return null;
  return (
    <div className="ws8c-stack" style={{ gap: 8 }}>
      {!open ? (
        <div className="ws8c-row">
          <Button variant="secondary" icon="plus" onClick={() => setOpen(true)}>
            Add assumption
          </Button>
          <span role="status" className="ws8c-muted ws8c-small">
            {note ?? ''}
          </span>
        </div>
      ) : (
        <AssumptionForm
          caseKey={caseKey}
          viewer={viewer}
          usedKeys={usedKeys}
          onCancel={() => setOpen(false)}
          onDone={(key) => {
            setNote(`${key} added to the register.`);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function AssumptionForm({
  caseKey,
  viewer,
  usedKeys,
  onCancel,
  onDone,
}: {
  caseKey: string;
  viewer: PersonRef | null;
  usedKeys: readonly string[];
  onCancel: () => void;
  onDone: (key: string) => void;
}) {
  const ids = useId();
  const directory = usePeople();
  const sources = useApiQuery(API.evidence.list, { query: { limit: 200 } });
  const [statement, setStatement] = useState('');
  const [input, setInput] = useState(OTHER);
  const [otherUnit, setOtherUnit] = useState<ValueUnit>('sites');
  const [valueText, setValueText] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(viewer?.id ?? null);
  const [basis, setBasis] = useState<'evidence' | 'none'>('none');
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [basisText, setBasisText] = useState('');
  const [sensitivity, setSensitivity] = useState<Sensitivity>('medium');
  const [critical, setCritical] = useState(false);
  const [method, setMethod] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [consequence, setConsequence] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [priceYear, setPriceYear] = useState(String(new Date().getFullYear()));
  const create = useCommand(API.assumptions.create);

  const model = MODEL_INPUTS.find((m) => m.key === input);
  const unit: ValueUnit = model?.unit ?? otherUnit;
  const value =
    unit === 'text' ? null : unit === 'rate' ? percentToFraction(valueText) : decimalValue(valueText);
  const valueError =
    unit !== 'text' && valueText.trim() && value === null
      ? unit === 'rate'
        ? 'Enter a percentage between 0 and 100, such as 20.'
        : 'Enter a number, such as 500.'
      : undefined;
  const people =
    viewer && !directory.people.some((p) => p.id === viewer.id)
      ? [viewer, ...directory.people]
      : directory.people;
  const linkable = (sources.data?.items ?? []).filter((s) => s.availability === 'available' && !s.deletedAt);
  const missing = [
    !statement.trim() && 'statement',
    (unit === 'text' ? !valueText.trim() : value === null) && 'value',
    !ownerId && 'owner',
    basis === 'evidence' && sourceIds.length === 0 && 'at least one source',
    !method.trim() && 'validation method',
    MONEY.has(unit) && !/^\d{4}$/.test(priceYear) && 'price year',
  ].filter(Boolean) as string[];

  const submit = async () => {
    if (missing.length) return;
    const keys = sources.data?.items.filter((s) => sourceIds.includes(s.id)).map((s) => s.key) ?? [];
    try {
      const a = await create.mutateAsync({
        params: { caseRef: caseKey },
        body: {
          inputKey: model ? model.key : `note.${slug(statement)}`,
          name: statement.trim(),
          ownerId: ownerId!,
          value: unit === 'text' ? null : value,
          valueText: unit === 'text' ? valueText.trim() : null,
          unit,
          basis:
            basisText.trim() ||
            (basis === 'evidence' ? `Evidence: ${keys.join(', ')}` : 'Assumption — no evidence'),
          sensitivity,
          decisionCritical: critical,
          consequenceIfFalse: consequence.trim(),
          validationMethod: method.trim(),
          dueOn: dueOn || null,
          sourceIds: basis === 'evidence' ? sourceIds : [],
          currency: MONEY.has(unit) ? currency : null,
          priceYear: MONEY.has(unit) ? Number(priceYear) : null,
        },
      });
      onDone(a.key);
    } catch {
      /* shown below */
    }
  };

  return (
    <form
      className="ws8c-card"
      aria-labelledby={`${ids}-t`}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="ws8c-card__head">
        <h2 id={`${ids}-t`}>Add assumption</h2>
        <span className="ws8c-card__head-right">A new register row · version 1</span>
      </div>
      <div className="ws8c-card__body">
        <TextAreaField label="Statement" required value={statement} onChange={setStatement} rows={2} />
        <div className="ws8c-form__grid">
          <label className="gos-field" htmlFor={`${ids}-input`}>
            <span>Model input</span>
            <select
              id={`${ids}-input`}
              className="gos-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            >
              <option value={OTHER}>Not a model input</option>
              {MODEL_INPUTS.map((m) => (
                <option key={m.key} value={m.key} disabled={usedKeys.includes(m.key)}>
                  {usedKeys.includes(m.key) ? `${m.label} · already in the register` : m.label}
                </option>
              ))}
            </select>
          </label>
          {!model ? (
            <label className="gos-field" htmlFor={`${ids}-unit`}>
              <span>Unit</span>
              <select
                id={`${ids}-unit`}
                className="gos-input"
                value={otherUnit}
                onChange={(e) => setOtherUnit(e.target.value as ValueUnit)}
              >
                {OTHER_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_TEXT[u]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="gos-field" htmlFor={`${ids}-value`}>
            <span>
              {unit === 'text'
                ? 'Value in words'
                : `Value (${MONEY.has(unit) ? `${currency} ` : ''}${UNIT_TEXT[unit]})`}{' '}
              <span className="gos-field__hint">(required)</span>
            </span>
            <input
              id={`${ids}-value`}
              className="gos-input"
              inputMode={unit === 'text' ? undefined : 'decimal'}
              value={valueText}
              aria-invalid={valueError ? true : undefined}
              aria-describedby={valueError ? `${ids}-value-err` : undefined}
              onChange={(e) => setValueText(e.target.value)}
            />
            {valueError ? (
              <span id={`${ids}-value-err`} className="gos-field__error">
                {valueError}
              </span>
            ) : null}
          </label>
          {MONEY.has(unit) ? (
            <>
              <Field
                label="Currency"
                value={currency}
                onChange={(x) => setCurrency(x.toUpperCase().slice(0, 3))}
              />
              <Field label="Price year" value={priceYear} onChange={setPriceYear} hint="e.g. 2026" />
            </>
          ) : null}
        </div>
        <OwnerPicker label="Owner" required value={ownerId} onChange={setOwnerId} options={people} />
        <fieldset className="gos-field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 6 }}>Confidence basis</legend>
          <label className="ws8c-check" style={CHECK_ROW}>
            <input
              type="radio"
              name={`${ids}-basis`}
              checked={basis === 'none'}
              onChange={() => setBasis('none')}
            />
            <span>Assumption — no evidence</span>
          </label>
          <label className="ws8c-check" style={CHECK_ROW}>
            <input
              type="radio"
              name={`${ids}-basis`}
              checked={basis === 'evidence'}
              onChange={() => setBasis('evidence')}
            />
            <span>Evidence · link sources</span>
          </label>
          {basis === 'evidence' ? (
            <div role="group" aria-label="Sources" style={{ paddingLeft: 24 }}>
              {sources.isPending ? <span className="ws8c-muted ws8c-small">Loading sources…</span> : null}
              {linkable.map((s) => (
                <label key={s.id} className="ws8c-check" style={CHECK_ROW}>
                  <input
                    type="checkbox"
                    checked={sourceIds.includes(s.id)}
                    onChange={(e) =>
                      setSourceIds((l) => (e.target.checked ? [...l, s.id] : l.filter((x) => x !== s.id)))
                    }
                  />
                  <span>
                    {s.key} · {s.title}
                  </span>
                </label>
              ))}
              {!sources.isPending && linkable.length === 0 ? (
                <span className="ws8c-muted ws8c-small">No sources you can open yet.</span>
              ) : null}
            </div>
          ) : null}
        </fieldset>
        <Field label="Basis" value={basisText} onChange={setBasisText} hint="optional · why we believe it" />
        <fieldset className="gos-field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 6 }}>Decision sensitivity</legend>
          <div className="ws8c-row">
            {Sensitivity.options.map((s) => (
              <label key={s} className="ws8c-check" style={CHECK_ROW}>
                <input
                  type="radio"
                  name={`${ids}-sens`}
                  checked={sensitivity === s}
                  onChange={() => setSensitivity(s)}
                />
                <span>{SENSITIVITY_LABELS[s]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="ws8c-check" style={CHECK_ROW}>
          <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} />
          <span>Decision-critical (a change makes approvals that read it out of date)</span>
        </label>
        <div className="ws8c-form__grid">
          <Field label="Validation method" required value={method} onChange={setMethod} />
          <Field label="Due date" type="date" value={dueOn} onChange={setDueOn} />
        </div>
        <Field
          label="If false"
          value={consequence}
          onChange={setConsequence}
          hint="optional · what changes"
        />
        {create.error ? <ProblemBanner error={create.error} /> : null}
        <div className="ws8c-row">
          <Button
            variant="primary"
            type="submit"
            disabled={missing.length > 0 || create.isPending}
            disabledReason={create.isPending ? 'Saving…' : `Still needed: ${missing.join(', ')}.`}
          >
            Add assumption
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}
