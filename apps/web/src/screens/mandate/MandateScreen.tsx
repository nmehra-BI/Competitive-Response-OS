/**
 * S02 Mandate (prototype: Mandate.dc.html). Two columns: the form on the left, the live scope
 * preview and the G0 checklist on the right. The draft autosaves (If-Match); the server owns the
 * scope sentence and the validation errors. Submit commits the version and opens G0. The sponsor
 * decides G0 in the connected approval panel, bound to the snapshot on screen.
 *
 * States: draft · missing owner / currency · incompatible horizon · returned with comment ·
 * awaiting (sponsor decides; others see why they cannot) · approved · sponsor without authority.
 */
import {
  API,
  type DecisionPackageView,
  type Mandate,
  type MandateDraftFields,
  type MandateFields,
} from '@growth-os/contracts';
import {
  Avatar,
  Banner,
  Button,
  Eyebrow,
  GateDiamond,
  Icon,
  Mono,
  OwnerPicker,
  SegmentedControl,
} from '@growth-os/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ApprovalPanel } from '../../app/connected/ApprovalPanel';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { api, queryKey } from '../../lib/api-client';
import { usePublishAutosave, useDraft } from '../../lib/drafts';
import { useApiQuery, useCommand } from '../../lib/query';
import { useViewer } from '../../lib/session';
import {
  Breadcrumb,
  ErrorPage,
  fmtDateTime,
  fmtDateYear,
  LoadingPage,
  PageHeader,
  usePeople,
  useDocumentTitle,
} from '../overview/shared';
import { MandateStatusChip } from './status';

type Fields = MandateDraftFields;
type SourceKind = MandateFields['evidenceSourceKinds'][number];

const HORIZONS = [
  { value: '1', label: '12 months' },
  { value: '2', label: '2 years' },
  { value: '3', label: '3 years' },
  { value: '5', label: '5 years' },
];
const CURRENCIES = ['EUR', 'CHF', 'USD'] as const;
const SOURCES: { value: SourceKind; label: string }[] = [
  { value: 'licensed_market_data', label: 'Licensed market data' },
  { value: 'authorized_uploads', label: 'Authorized uploads' },
  { value: 'crm_accounts', label: 'CRM accounts' },
];
/** Field → form control id, so the error summary can move focus to the field. */
const FIELD_ID: Record<string, string> = {
  objective: 'm-obj',
  scope: 'm-scope',
  ownerId: 'm-owner',
  currency: 'm-cur',
  horizonYears: 'm-hz',
  successDefinition: 'm-succ',
};
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

function parseAmount(text: string): string | null | undefined {
  const t = text.replace(/[\s,]/g, '');
  if (!t) return null;
  return /^\d{1,15}(\.\d{1,2})?$/.test(t) ? Number(t).toFixed(2) : undefined;
}
const amountText = (v: string | null | undefined) =>
  v ? Number(v).toLocaleString('en-GB', { maximumFractionDigits: 2 }) : '';

/**
 * Scope pickers (D-094): geography, product and segments from `catalogue.scopeOptions` for the
 * mandate's business unit. Countries offered are those the tenant works in plus any already chosen.
 */
function ScopeFields({
  fields: f,
  businessUnitId,
  error,
  onChange,
}: {
  fields: Fields;
  businessUnitId: string;
  error: string | null;
  onChange: (patch: Partial<Fields>) => void;
}) {
  const q = useApiQuery(
    API.directory.scopeOptions,
    { query: { businessUnitId } },
    { staleTime: 10 * 60_000 },
  );
  const opts = q.data;
  const countries = [...new Set([...(opts?.countries ?? []), ...(f.geographyCodes ?? [])])].sort((a, b) =>
    (regionNames.of(a) ?? a).localeCompare(regionNames.of(b) ?? b),
  );
  const segments = opts?.segments ?? [];
  const toggle = (list: readonly string[] | undefined, v: string, on: boolean) =>
    on ? [...(list ?? []).filter((x) => x !== v), v] : (list ?? []).filter((x) => x !== v);
  return (
    <>
      <fieldset className="dx-fieldset" style={{ border: 0, padding: 0 }} id="m-scope" tabIndex={-1}>
        <legend className="dx-label" style={{ padding: 0 }}>
          Geography
        </legend>
        <div className="dx-row" style={{ gap: '8px 18px' }}>
          {countries.length === 0 ? <span className="dx-help">Loading countries…</span> : null}
          {countries.map((c) => (
            <label key={c} className="dx-check">
              <input
                type="checkbox"
                checked={(f.geographyCodes ?? []).includes(c)}
                onChange={(e) => onChange({ geographyCodes: toggle(f.geographyCodes, c, e.target.checked) })}
              />
              {regionNames.of(c) ?? c}
            </label>
          ))}
        </div>
        {error ? <div className="dx-fielderr">{error}</div> : null}
      </fieldset>
      <div className="dx-grid">
        <Field label="Product" htmlFor="m-scope-ps">
          <select
            id="m-scope-ps"
            className="gos-select"
            value={f.productId ?? ''}
            onChange={(e) => onChange({ productId: e.target.value || undefined })}
          >
            <option value="">Not set</option>
            {(opts?.products ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="dx-fieldset" style={{ border: 0, padding: 0 }}>
          <legend className="dx-label" style={{ padding: 0 }}>
            Segments
          </legend>
          <div className="dx-row" style={{ gap: '8px 18px' }}>
            {segments.map((sg) => (
              <label key={sg.id} className="dx-check">
                <input
                  type="checkbox"
                  checked={(f.segmentIds ?? []).includes(sg.id)}
                  onChange={(e) => onChange({ segmentIds: toggle(f.segmentIds, sg.id, e.target.checked) })}
                />
                {sg.name}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </>
  );
}

function Field({
  label,
  htmlFor,
  labelId,
  help,
  error,
  errorId,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  labelId?: string;
  help?: ReactNode;
  error?: string | null;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="dx-label">
          {label}
        </label>
      ) : (
        <span id={labelId} className="dx-label">
          {label}
        </span>
      )}
      {children}
      {help ? <div className="dx-help">{help}</div> : null}
      {error ? (
        <div className="dx-fielderr" id={errorId}>
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Latest decision of a disposition in the G0 package (returned comment, approval stamp). */
function lastDecision(pkg: DecisionPackageView | undefined, d: 'approve' | 'return_for_revision') {
  return pkg ? [...pkg.approvals].reverse().find((a) => a.disposition === d) : undefined;
}

export default function MandateScreen() {
  const { mandateKey = '' } = useParams();
  const q = useApiQuery(API.mandates.get, { params: { ref: mandateKey } });
  useDocumentTitle(q.data?.title ?? 'Mandate');
  if (q.isPending) return <LoadingPage label="Mandate" />;
  if (q.error) return <ErrorPage title="Mandate" error={q.error} />;
  // Re-mount the form for each draft version so local edits never leak across versions.
  return <MandateView key={`${q.data.id}:${q.data.draftVersion?.version ?? 'locked'}`} m={q.data} />;
}

function MandateView({ m }: { m: Mandate }) {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const viewer = useViewer();
  const { people, byId } = usePeople();
  const ref = m.key;
  const draftV = m.draftVersion;
  const shownV = draftV ?? m.currentVersion;
  const locked = !draftV;
  const pkgQ = useApiQuery(
    API.gates.package,
    { params: { id: m.g0GateRequestId ?? '' }, query: {} },
    { enabled: !!m.g0GateRequestId },
  );
  const pkg = pkgQ.data;

  const draft = useDraft<Fields>({
    storageKey: draftV && viewer.data ? `${viewer.data.tenant.id}:mandate:${m.id}:v${draftV.version}` : null,
    server: draftV ? { value: draftV.fields, rowVersion: draftV.rowVersion } : undefined,
    save: async (value, rowVersion) => {
      const res = await api(API.mandates.saveDraft, {
        params: { ref },
        body: { fields: value },
        ifMatch: rowVersion,
      });
      qc.setQueryData(queryKey(API.mandates.get, { ref }), res);
      return { value: res.draftVersion!.fields, rowVersion: res.draftVersion!.rowVersion };
    },
    reload: async () => {
      const res = await api(API.mandates.get, { params: { ref } });
      qc.setQueryData(queryKey(API.mandates.get, { ref }), res);
      return res.draftVersion
        ? { value: res.draftVersion.fields, rowVersion: res.draftVersion.rowVersion }
        : undefined;
    },
  });
  usePublishAutosave(draftV ? draft.status : null);
  const submit = useCommand(API.mandates.submit, {
    onSuccess: (res) => qc.setQueryData(queryKey(API.mandates.get, { ref }), res.mandate),
  });

  const f: Fields = (locked ? shownV?.fields : draft.value) ?? draftV?.fields ?? {};
  const [amt, setAmt] = useState(() => amountText(f.investmentCeiling));
  const [amtError, setAmtError] = useState<string | null>(null);
  const errs = locked ? [] : m.validationErrors;
  const errFor = (field: string) => errs.find((e) => e.field === field)?.message ?? null;
  const ids = { hz: useId(), cur: useId(), hzErr: useId(), curErr: useId() };
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => draft.setField(k, v);

  const returned = lastDecision(pkg, 'return_for_revision');
  const approved = lastDecision(pkg, 'approve');
  const sponsor = byId(f.sponsorId);
  const owner = byId(f.ownerId);
  const version = shownV?.version ?? 1;
  const versionParam = Number(params.get('version'));

  const checks: [string, boolean][] = [
    ['Sponsor named', !!f.sponsorId],
    ['Objective and scope', !errFor('objective') && !errFor('scope')],
    ['Accountable owner', !errFor('ownerId')],
    ['Currency stated', !errFor('currency')],
    ['Horizon consistent', !errFor('horizonYears')],
  ];
  const blockedBy = errs.length;
  const submitReason = locked
    ? undefined
    : blockedBy
      ? `Fix the ${blockedBy} highlighted ${blockedBy === 1 ? 'item' : 'items'} to submit.`
      : submit.isPending
        ? 'Submitting…'
        : undefined;

  const onSubmit = async () => {
    await draft.flush();
    submit.mutate({ params: { ref } });
  };

  return (
    <div className="app-page dx-page" style={{ maxWidth: 1240 }}>
      <PageHeader
        titleId="mf"
        breadcrumb={
          <Breadcrumb
            items={[{ label: 'Mandates', href: '/me/mandates' }, { label: <Mono size={12}>{m.key}</Mono> }]}
          />
        }
        title={m.title}
        badges={
          <>
            <MandateStatusChip status={m.status} />
            <span className="dx-muted" style={{ fontSize: 12.5 }}>
              Version {version}
            </span>
          </>
        }
      />

      {versionParam && versionParam !== version ? (
        <Banner
          tone="neutral"
          title={`Showing version ${version}`}
          body={`Version ${versionParam} is kept in the mandate history; committed versions never change.`}
        />
      ) : null}

      {m.status === 'returned' && returned ? (
        <Banner
          tone="warn"
          title={`Returned for revision by ${returned.approver.displayName} · ${fmtDateTime(returned.decidedAt)}`}
          body={`“${returned.rationale}” Fix the items and resubmit; the comment stays in history.`}
        />
      ) : null}

      {m.status === 'awaiting_decision' && pkg ? (
        <section className="dx-box dx-stack" style={{ maxWidth: 760, padding: 16 }} aria-labelledby="g0-head">
          <div className="dx-row" style={{ gap: 10 }}>
            <GateDiamond status="awaiting_decision" size={16} />
            <div>
              <h2 id="g0-head" style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                G0 · Awaiting decision · Mandate v{pkg.snapshot.version}
              </h2>
              <div className="dx-small dx-muted">
                Submitted by {pkg.gateRequest.submittedBy?.displayName ?? 'the owner'} ·{' '}
                {fmtDateTime(pkg.gateRequest.submittedAt)}
                {viewer.data ? ` · viewing as ${viewer.data.person.displayName}` : ''}
              </div>
            </div>
          </div>
          <ApprovalPanel
            gateRequestId={pkg.gateRequest.id}
            snapshotId={pkg.snapshot.id}
            snapshotHash={pkg.snapshot.contentHash}
          />
        </section>
      ) : null}

      {m.status === 'approved' && approved ? (
        <div style={{ maxWidth: 760 }}>
          <Banner
            tone="ok"
            title={`Mandate approved (G0) · ${fmtDateYear(approved.decidedAt)}`}
            body={`${approved.approver.displayName} approved scope v${version}. Discovery can start. No spend is authorized by G0.`}
            actions={
              <Button variant="secondary" icon="arrowr" href={`/me/opportunities?mandate=${m.key}`}>
                Go to opportunities
              </Button>
            }
          />
        </div>
      ) : null}

      {draft.conflict ? (
        <Banner
          tone="warn"
          title="Changed elsewhere"
          body="Someone saved a newer version of this draft. Keep your changes or take theirs; nothing is overwritten silently."
          actions={
            <>
              <Button variant="secondary" onClick={() => void draft.resolveConflict('mine')}>
                Keep mine
              </Button>
              <Button variant="ghost" onClick={() => void draft.resolveConflict('theirs')}>
                Take theirs
              </Button>
            </>
          }
        />
      ) : null}

      <div className="dx-split" style={{ gap: 24 }}>
        <div className="dx-split__main" style={{ flexBasis: 520 }}>
          <form
            aria-labelledby="mf"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!blockedBy && !locked) void onSubmit();
            }}
            onBlur={() => void draft.flush()}
          >
            <fieldset className="dx-form" disabled={locked}>
              <legend className="gos-sr-only">Mandate fields</legend>
              {errs.length ? (
                <div className="dx-errors" role="status">
                  <div className="dx-errors__title">
                    <Icon name="alert" size={16} />
                    {errs.length} {errs.length === 1 ? 'issue blocks' : 'issues block'} submission to G0
                  </div>
                  <ul>
                    {errs.map((e) => (
                      <li key={`${e.field}-${e.message}`}>
                        <a
                          href={`#${FIELD_ID[e.field] ?? 'm-obj'}`}
                          onClick={(ev) => {
                            ev.preventDefault();
                            document.getElementById(FIELD_ID[e.field] ?? 'm-obj')?.focus();
                          }}
                        >
                          {e.message}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <Field label="Objective" htmlFor="m-obj" error={errFor('objective')}>
                <textarea
                  id="m-obj"
                  className="gos-textarea"
                  rows={2}
                  value={f.objective ?? ''}
                  aria-invalid={errFor('objective') ? true : undefined}
                  onChange={(e) => set('objective', e.target.value)}
                />
              </Field>

              <ScopeFields
                fields={f}
                businessUnitId={m.businessUnitId}
                error={errFor('scope')}
                onChange={(patch) => {
                  for (const [k, v] of Object.entries(patch)) set(k as keyof Fields, v as never);
                }}
              />

              <Field
                label="Exclusions"
                htmlFor="m-exc"
                help="What this mandate may not look for or do. One per line."
              >
                <textarea
                  id="m-exc"
                  className="gos-textarea"
                  rows={2}
                  value={(f.exclusions ?? []).join('\n')}
                  onChange={(e) => set('exclusions', e.target.value.split('\n'))}
                  onBlur={(e) =>
                    set(
                      'exclusions',
                      e.target.value
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </Field>

              <div className="dx-grid">
                <Field
                  label="Mandate horizon"
                  labelId={ids.hz}
                  help="The scenario horizon for SOM and economics."
                  error={errFor('horizonYears')}
                  errorId={ids.hzErr}
                >
                  <div id="m-hz" tabIndex={-1}>
                    <SegmentedControl
                      ariaLabel="Mandate horizon"
                      value={f.horizonYears ? String(f.horizonYears) : ''}
                      options={HORIZONS}
                      onChange={(v) => set('horizonYears', Number(v))}
                    />
                  </div>
                </Field>
                <Field label="Pilot duration (days)" htmlFor="m-days" help="Upper bound for any pilot.">
                  <input
                    id="m-days"
                    className="gos-input"
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={f.pilotDurationDays ?? ''}
                    onChange={(e) =>
                      set('pilotDurationDays', e.target.value ? Math.max(1, Number(e.target.value)) : null)
                    }
                  />
                </Field>
              </div>

              <div className="dx-grid">
                <Field
                  label="Investment constraint · pilot spend ceiling"
                  htmlFor="m-amt"
                  help="Up to this amount for a bounded pilot. Scale is a separate later decision."
                  error={amtError}
                >
                  <input
                    id="m-amt"
                    className="gos-input"
                    type="text"
                    inputMode="decimal"
                    style={{ fontFamily: 'var(--font-mono)' }}
                    value={amt}
                    aria-invalid={amtError ? true : undefined}
                    onChange={(e) => {
                      setAmt(e.target.value);
                      const v = parseAmount(e.target.value);
                      if (v === undefined) setAmtError('Enter an amount such as 120,000.');
                      else {
                        setAmtError(null);
                        set('investmentCeiling', v);
                      }
                    }}
                  />
                </Field>
                <Field
                  label="Currency (required)"
                  labelId={ids.cur}
                  help="Currency is never typed as free text."
                  error={errFor('currency') ? 'Currency not specified.' : null}
                  errorId={ids.curErr}
                >
                  <div id="m-cur" tabIndex={-1}>
                    <SegmentedControl
                      ariaLabel="Currency (required)"
                      value={f.currency ?? ''}
                      options={CURRENCIES.map((c) => ({ value: c, label: c }))}
                      onChange={(v) => set('currency', v)}
                    />
                  </div>
                </Field>
              </div>

              <fieldset className="dx-fieldset" style={{ border: 0, padding: 0 }}>
                <legend className="dx-label" style={{ padding: 0 }}>
                  Evidence sources
                </legend>
                <div className="dx-row" style={{ gap: '8px 18px' }}>
                  {SOURCES.map((s) => (
                    <label key={s.value} className="dx-check">
                      <input
                        type="checkbox"
                        checked={(f.evidenceSourceKinds ?? []).includes(s.value)}
                        onChange={(e) => {
                          const cur = f.evidenceSourceKinds ?? [];
                          set(
                            'evidenceSourceKinds',
                            e.target.checked ? [...cur, s.value] : cur.filter((x) => x !== s.value),
                          );
                        }}
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="dx-grid">
                {locked ? (
                  <Field label="Accountable owner" htmlFor="m-owner">
                    <output id="m-owner" className="dx-readonly">
                      {owner ? (
                        <>
                          <Avatar initials={owner.initials} size={20} />
                          {owner.displayName}
                        </>
                      ) : (
                        'Missing owner'
                      )}
                    </output>
                  </Field>
                ) : (
                  <div id="m-owner" tabIndex={-1} style={{ minWidth: 0 }}>
                    <OwnerPicker
                      label="Accountable owner"
                      required
                      value={f.ownerId ?? null}
                      options={people.filter((p) => p.id !== f.sponsorId)}
                      onChange={(id) => set('ownerId', id)}
                      hint="One named person. The owner cannot approve their own gates."
                    />
                    {errFor('ownerId') ? (
                      <div className="dx-fielderr">
                        <Icon name="alert" size={14} />
                        <span>Missing owner.</span>
                      </div>
                    ) : null}
                  </div>
                )}
                <Field label="Sponsor · approves G0" htmlFor="m-sponsor">
                  <output id="m-sponsor" className="dx-readonly">
                    {sponsor ? (
                      <>
                        <Avatar initials={sponsor.initials} size={20} />
                        {sponsor.displayName}
                        {sponsor.title ? ` · ${sponsor.title.split(' · ')[0]}` : ''}
                      </>
                    ) : (
                      'Not set'
                    )}
                  </output>
                </Field>
              </div>

              <Field label="Success definition" htmlFor="m-succ" error={errFor('successDefinition')}>
                <textarea
                  id="m-succ"
                  className="gos-textarea"
                  rows={2}
                  value={f.successDefinition ?? ''}
                  aria-invalid={errFor('successDefinition') ? true : undefined}
                  onChange={(e) => set('successDefinition', e.target.value)}
                />
              </Field>
            </fieldset>

            <div className="dx-footer">
              {locked ? (
                <span className="dx-muted" style={{ fontSize: 12.5 }}>
                  Submitted versions are read-only. Changes create v{version + 1}.
                </span>
              ) : (
                <>
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={!!submitReason}
                    disabledReason={submitReason}
                  >
                    Submit for G0
                  </Button>
                  <Button variant="secondary" onClick={() => void draft.flush()}>
                    Save draft
                  </Button>
                  {!submitReason ? (
                    <span className="dx-muted" style={{ fontSize: 12.5 }}>
                      Routes to {sponsor?.displayName ?? 'the sponsor'} for G0.
                    </span>
                  ) : null}
                </>
              )}
            </div>
            {submit.error ? (
              <div style={{ marginTop: 12 }}>
                <ProblemBanner error={submit.error} />
              </div>
            ) : null}
          </form>
        </div>

        <aside className="dx-split__side dx-stack" aria-label="Scope preview" style={{ flexBasis: 360 }}>
          <div className="dx-box dx-box--canvas">
            <Eyebrow>Scope preview · updates as you type</Eyebrow>
            <p className="dx-reading" aria-live="polite">
              {m.scopePreview}
            </p>
          </div>
          <div className="dx-box">
            <Eyebrow>Gate G0 · Scope approved</Eyebrow>
            <ul className="dx-checks" aria-label="G0 preconditions">
              {checks.map(([label, ok]) => (
                <li key={label}>
                  <span className={ok ? 'dx-glyph-ok' : 'dx-glyph-open'}>
                    <Icon name={ok ? 'check' : 'circle'} size={14} strokeWidth={2.2} />
                  </span>
                  <span>
                    {label} · {ok ? 'met' : 'open'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
