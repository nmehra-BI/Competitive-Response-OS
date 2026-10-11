/**
 * S01 "New case" (D-149, closes the PQ-17 gap E1 found): start a case directly with an inline draft
 * mandate through `cases.createDirect`, so an operator can begin without an opportunity or the API. The
 * case starts at "Draft mandate"; the mandate is completed on S02 and approved at G0 as usual. Scope
 * pickers come from `catalogue.scopeOptions` (D-079); the owner defaults to the viewer and the sponsor to
 * the business unit's sponsor (server rule). Nothing is approved or decided here.
 */
import { API, type CurrencyCode } from '@growth-os/contracts';
import { Button, Icon } from '@growth-os/ui';
import { useId, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

function Field({ label, htmlFor, children }: { label: ReactNode; htmlFor: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <label htmlFor={htmlFor} className="dx-label">
        {label}
      </label>
      {children}
    </div>
  );
}

export function NewCaseForm({ onCancel }: { onCancel: () => void }) {
  const id = useId();
  const navigate = useNavigate();
  const [businessUnitId, setBusinessUnitId] = useState('');
  // Units the viewer can see; then the catalogue of the chosen unit.
  const all = useApiQuery(API.directory.scopeOptions, { query: {} }, { staleTime: 10 * 60_000 });
  const units = all.data?.businessUnits ?? [];
  const bu = businessUnitId || units[0]?.id || '';
  const scope = useApiQuery(
    API.directory.scopeOptions,
    { query: { businessUnitId: bu } },
    { staleTime: 10 * 60_000, enabled: Boolean(bu) },
  );
  const [title, setTitle] = useState('');
  const [productId, setProductId] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [country, setCountry] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [horizon, setHorizon] = useState('3');
  const [tried, setTried] = useState(false);
  const create = useCommand(API.cases.createDirect);

  const countries = [...(scope.data?.countries ?? [])].sort((a, b) =>
    (regionNames.of(a) ?? a).localeCompare(regionNames.of(b) ?? b),
  );
  const horizonYears = Number(horizon);
  const missing = [
    !title.trim() && 'a title',
    !bu && 'a business unit',
    !/^[A-Z]{3}$/.test(currency) && 'a three-letter currency',
    !(Number.isInteger(horizonYears) && horizonYears >= 1 && horizonYears <= 10) && 'a horizon of 1–10 years',
  ].filter(Boolean) as string[];

  const submit = async () => {
    setTried(true);
    if (missing.length) return;
    try {
      const c = await create.mutateAsync({
        body: {
          businessUnitId: bu,
          title: title.trim(),
          mandate: {
            currency: currency as CurrencyCode,
            horizonYears,
            ...(productId ? { productId } : {}),
            ...(segmentId ? { segmentIds: [segmentId] } : {}),
            ...(country ? { geographyCodes: [country] } : {}),
          },
        },
      });
      navigate(`/me/cases/${c.key}/thesis`);
    } catch {
      /* shown below */
    }
  };

  return (
    <form
      className="dx-stat"
      aria-labelledby={`${id}-t`}
      style={{ gap: 14 }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <h2 id={`${id}-t`} style={{ margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600 }}>
          New expansion case
        </h2>
        <p className="dx-help" style={{ margin: '4px 0 0' }}>
          Starts at Draft mandate with you as the owner. Complete the mandate and request G0 before the
          assessment. Market sizes are entered later, per case; nothing here is totalled.
        </p>
      </div>
      <div className="dx-grid">
        <Field label="Case title (required)" htmlFor={`${id}-title`}>
          <input
            id={`${id}-title`}
            className="gos-input"
            value={title}
            aria-invalid={tried && !title.trim() ? true : undefined}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Business unit" htmlFor={`${id}-bu`}>
          <select
            id={`${id}-bu`}
            className="gos-select"
            value={bu}
            onChange={(e) => {
              setBusinessUnitId(e.target.value);
              setProductId('');
              setSegmentId('');
            }}
          >
            {units.length === 0 ? <option value="">Loading business units…</option> : null}
            {units.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Product" htmlFor={`${id}-product`}>
          <select
            id={`${id}-product`}
            className="gos-select"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">Not set</option>
            {(scope.data?.products ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Segment" htmlFor={`${id}-segment`}>
          <select
            id={`${id}-segment`}
            className="gos-select"
            value={segmentId}
            onChange={(e) => setSegmentId(e.target.value)}
          >
            <option value="">Not set</option>
            {(scope.data?.segments ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Geography" htmlFor={`${id}-country`}>
          <select
            id={`${id}-country`}
            className="gos-select"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            <option value="">Not set</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {regionNames.of(c) ?? c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Currency" htmlFor={`${id}-currency`}>
          <input
            id={`${id}-currency`}
            className="gos-input"
            value={currency}
            maxLength={3}
            aria-invalid={tried && !/^[A-Z]{3}$/.test(currency) ? true : undefined}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Horizon (years)" htmlFor={`${id}-horizon`}>
          <input
            id={`${id}-horizon`}
            className="gos-input"
            inputMode="numeric"
            value={horizon}
            onChange={(e) => setHorizon(e.target.value)}
          />
        </Field>
      </div>
      {tried && missing.length ? (
        <div className="dx-fielderr" role="alert">
          <Icon name="alert" size={14} />
          <span>Add {missing.join(', ')}.</span>
        </div>
      ) : null}
      {create.error ? <ProblemBanner error={create.error} /> : null}
      <div className="dx-actions">
        <Button variant="primary" type="submit" icon="plus" disabled={create.isPending}>
          Create case
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
