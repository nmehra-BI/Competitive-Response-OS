/**
 * S06 "Sizing draft editor" (D-112 §2, ticket 1). An operator builds a new case's sizing model in the
 * UI: market boundary, what the spend includes, TAM sites and spend per site, unique-site cohorts
 * with the overlap and the dedup rule, the reachable pool with its channel definition, adoption and
 * capacity. Every input is Evidence (a source) or an Assumption (a register link); a blank input is
 * cleared and stays Unknown (never 0). Edits autosave with If-Match; "Create snapshot vN" commits.
 */
import { API, type Assumption, type SizingVersion, type SizingView, type Source } from '@growth-os/contracts';
import {
  AutosaveStatus,
  Banner,
  Button,
  Card,
  SectionHeader,
  TextAreaField,
  formatLineageValue,
} from '@growth-os/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { api, ApiProblem, queryKey } from '../../lib/api-client';
import { usePublishAutosave, useDraft, type Versioned } from '../../lib/drafts';
import { invalidateAfter, useApiQuery, useCommand } from '../../lib/query';
import { useViewer } from '../../lib/session';
import {
  boundaryErrors,
  formFromVersion,
  missingRequired,
  overlapPatch,
  planPatch,
  SIZING_EDITOR_INPUTS,
  type Basis,
  type CohortForm,
  type EditorInputSpec,
  type SizingForm,
} from './editor-model';

const POPULATION_OPTIONS = [
  { value: 'site', label: 'Sites' },
  { value: 'company', label: 'Companies' },
  { value: 'customer', label: 'Customers' },
] as const;

const INCLUDES: { key: keyof SizingForm['includes']; label: string }[] = [
  { key: 'hardware', label: 'Hardware' },
  { key: 'software', label: 'Software' },
  { key: 'services', label: 'Services' },
  { key: 'replacementCycles', label: 'Replacement cycles' },
];

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className="gos-field">
      <label htmlFor={id}>
        {label}
        {hint ? <span className="gos-field__hint"> ({hint})</span> : null}
      </label>
      {children(id, error ? errId : undefined)}
      {error ? (
        <span id={errId} className="gos-field__error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function sourceLabel(s: Source): string {
  return `${s.key} · ${s.title}`;
}

function InputRow({
  spec,
  form,
  currency,
  sources,
  assumptions,
  pending,
  onChange,
  onBlur,
  disabled,
}: {
  spec: EditorInputSpec;
  form: SizingForm;
  currency: string;
  sources: readonly Source[];
  assumptions: readonly Assumption[];
  pending: string | undefined;
  onChange: (next: Partial<SizingForm['inputs'][EditorInputSpec['key']]>) => void;
  onBlur: () => void;
  disabled: boolean;
}) {
  const f = form.inputs[spec.key];
  const id = useId();
  const linked = f.basis.startsWith('asm:') ? assumptions.find((a) => a.id === f.basis.slice(4)) : undefined;
  const fits = assumptions.filter((a) => a.current.unit === spec.unit && a.current.value !== null);
  const errId = `${id}-err`;
  return (
    <div className="as-editor-input" role="group" aria-label={spec.label}>
      <label htmlFor={`${id}-v`} className="as-editor-input__name">
        {spec.label}
        {spec.required ? null : <span className="gos-field__hint"> (optional)</span>}
      </label>
      <div className="as-editor-input__value">
        {linked ? (
          <output id={`${id}-v`} className="gos-mono" aria-label={spec.label}>
            {formatLineageValue({ value: linked.current.value, unit: spec.unit }, currency)}
          </output>
        ) : (
          <span className="as-row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <input
              id={`${id}-v`}
              className="gos-input as-editor-num"
              inputMode="decimal"
              value={f.text}
              placeholder="Unknown"
              disabled={disabled}
              aria-invalid={pending ? true : undefined}
              aria-describedby={pending ? errId : undefined}
              onChange={(e) => onChange({ text: e.target.value })}
              onBlur={onBlur}
            />
            <span className="as-muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
              {spec.suffix(currency)}
            </span>
          </span>
        )}
      </div>
      <div className="as-editor-input__basis">
        <select
          className="gos-select"
          aria-label={`${spec.label} · basis`}
          value={f.basis}
          disabled={disabled}
          onChange={(e) => {
            const basis = e.target.value as Basis;
            onChange(basis === '' ? { basis, text: '' } : { basis });
          }}
          onBlur={onBlur}
        >
          <option value="">Unknown — not entered</option>
          <optgroup label="Evidence">
            {sources.map((s) => (
              <option key={s.id} value={`src:${s.id}`}>
                {sourceLabel(s)}
              </option>
            ))}
          </optgroup>
          <optgroup label="Assumption">
            {fits.map((a) => (
              <option key={a.id} value={`asm:${a.id}`}>
                {`${a.key} · ${a.name}`}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      {spec.key === 'reachable_pool' ? (
        <div className="as-editor-input__wide">
          <Field label="Channel definition" hint="how the pool is reached">
            {(fid) => (
              <input
                id={fid}
                className="gos-input"
                value={f.basisText}
                disabled={disabled}
                onChange={(e) => onChange({ basisText: e.target.value })}
                onBlur={onBlur}
              />
            )}
          </Field>
        </div>
      ) : null}
      {pending ? (
        <span id={errId} className="gos-field__error as-editor-input__wide">
          {pending}
        </span>
      ) : null}
    </div>
  );
}

function CohortRow({
  n,
  c,
  sources,
  onChange,
  onRemove,
  onBlur,
  disabled,
}: {
  n: number;
  c: CohortForm;
  sources: readonly Source[];
  onChange: (next: Partial<CohortForm>) => void;
  onRemove: () => void;
  onBlur: () => void;
  disabled: boolean;
}) {
  const label = `Cohort ${n + 1}`;
  return (
    <div className="as-editor-cohort" role="group" aria-label={label}>
      <Field label={`${label} · name`}>
        {(id) => (
          <input
            id={id}
            className="gos-input"
            value={c.name}
            disabled={disabled}
            onChange={(e) => onChange({ name: e.target.value })}
            onBlur={onBlur}
          />
        )}
      </Field>
      <Field label={`${label} · site count`}>
        {(id) => (
          <input
            id={id}
            className="gos-input"
            inputMode="numeric"
            value={c.siteCount}
            disabled={disabled}
            onChange={(e) => onChange({ siteCount: e.target.value })}
            onBlur={onBlur}
          />
        )}
      </Field>
      <Field label={`${label} · rule`}>
        {(id) => (
          <input
            id={id}
            className="gos-input"
            value={c.rule}
            disabled={disabled}
            onChange={(e) => onChange({ rule: e.target.value })}
            onBlur={onBlur}
          />
        )}
      </Field>
      <Field label={`${label} · source`}>
        {(id) => (
          <select
            id={id}
            className="gos-select"
            value={c.sourceId}
            disabled={disabled}
            onChange={(e) => onChange({ sourceId: e.target.value })}
            onBlur={onBlur}
          >
            <option value="">Not linked to a source</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {sourceLabel(s)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div style={{ alignSelf: 'end' }}>
        <Button variant="ghost" icon="x" onClick={onRemove} disabled={disabled}>
          {`Remove cohort ${n + 1}`}
        </Button>
      </div>
    </div>
  );
}

export function SizingEditor({
  caseKey,
  view,
  onClose,
}: {
  caseKey: string;
  view: SizingView;
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const viewer = useViewer();
  const register = useApiQuery(API.assumptions.list, { params: { caseRef: caseKey } });
  const evidence = useApiQuery(API.evidence.list, { query: { limit: 200 } });
  const assumptions = register.data?.items ?? [];
  const sources = (evidence.data?.items ?? []).filter((s) => !s.deletedAt);
  const version: SizingVersion | null = view.draft ?? view.current;
  const serverRef = useRef<{ form: SizingForm; version: SizingVersion | null }>({
    form: formFromVersion(version),
    version,
  });
  useEffect(() => {
    serverRef.current = { form: formFromVersion(version), version };
  }, [version]);
  const assumptionsRef = useRef(assumptions);
  assumptionsRef.current = assumptions;
  const [problem, setProblem] = useState<unknown>(null);
  const [pending, setPending] = useState<Record<string, string>>({});
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const server: Versioned<SizingForm> = useMemo(
    () => ({ value: formFromVersion(version), rowVersion: version?.rowVersion ?? 0 }),
    [version],
  );
  const draft = useDraft<SizingForm>({
    storageKey: viewer.data
      ? `${viewer.data.tenant.id}:sizing-editor:${caseKey}:v${version?.version ?? 0}`
      : null,
    server,
    // One save at a time: the draft hook can start a blur flush and a debounced save together; the
    // later one is planned against the state the earlier one left (and is usually empty).
    save: (value, rowVersion) => {
      const run = queue.current.then(() =>
        saveNow(value, serverRef.current.version?.rowVersion ?? rowVersion),
      );
      queue.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    reload: async () => {
      const v = await api(API.sizing.get, { params: { caseRef: caseKey } });
      const shown = v.draft ?? v.current;
      return { value: formFromVersion(shown), rowVersion: shown?.rowVersion ?? 0 };
    },
  });
  async function saveNow(value: SizingForm, rowVersion: number): Promise<Versioned<SizingForm>> {
    setProblem(null);
    let plan;
    try {
      plan = planPatch(value, serverRef.current, assumptionsRef.current);
    } catch (e) {
      setProblem(e);
      throw e;
    }
    setPending(Object.fromEntries(plan.pending.map((p) => [p.key, p.message])));
    if (!plan.patch && !plan.overlapAfter) return { value, rowVersion };
    try {
      let next = plan.patch
        ? await api(API.sizing.saveDraft, {
            params: { caseRef: caseKey },
            body: plan.patch,
            ifMatch: rowVersion,
          })
        : view;
      if (plan.overlapAfter && next.draft) {
        const o = overlapPatch(value, next.draft);
        if (o)
          next = await api(API.sizing.saveDraft, {
            params: { caseRef: caseKey },
            body: o,
            ifMatch: next.draft.rowVersion,
          });
      }
      const v = next.draft ?? next.current;
      serverRef.current = { form: formFromVersion(v), version: v };
      qc.setQueryData(queryKey(API.sizing.get, { caseRef: caseKey }, undefined), next);
      void invalidateAfter(qc, API.sizing.saveDraft.id);
      return { value: formFromVersion(v), rowVersion: v?.rowVersion ?? rowVersion };
    } catch (e) {
      if (!(e instanceof ApiProblem && e.code === 'VERSION_CONFLICT')) setProblem(e);
      throw e;
    }
  }
  usePublishAutosave(draft.status);
  const commit = useCommand(API.sizing.commit, { onSuccess: () => onClose?.() });

  const form = draft.value ?? server.value;
  const set = (next: Partial<SizingForm>) => draft.set((p) => ({ ...p, ...next }));
  const setInput = (key: EditorInputSpec['key'], next: Partial<SizingForm['inputs'][typeof key]>) =>
    draft.set((p) => ({ ...p, inputs: { ...p.inputs, [key]: { ...p.inputs[key], ...next } } }));
  const setCohort = (n: number, next: Partial<CohortForm>) =>
    draft.set((p) => ({ ...p, cohorts: p.cohorts.map((c, i) => (i === n ? { ...c, ...next } : c)) }));
  const blur = () => void draft.flush();
  const first = version === null;
  const errs = first ? boundaryErrors(form) : {};
  const missing = missingRequired(view.draft);
  const blocking = view.draft?.result?.checks.filter((c) => c.blocking) ?? [];
  const commitReason = !view.draft
    ? 'Save a draft first.'
    : missing.length
      ? `Blocked: add ${missing.map((m) => m.label).join(', ')}.`
      : blocking.length || !view.draft.result
        ? 'Blocked: resolve the blocking checks first.'
        : draft.dirty || draft.status.state === 'saving'
          ? 'Saving…'
          : commit.isPending
            ? 'Creating snapshot…'
            : null;
  const currency = form.currency.trim() || 'EUR';
  const disabled = draft.conflict !== null;
  const group = (g: EditorInputSpec['group']) => SIZING_EDITOR_INPUTS.filter((s) => s.group === g);
  const row = (spec: EditorInputSpec) => (
    <InputRow
      key={spec.key}
      spec={spec}
      form={form}
      currency={currency}
      sources={sources}
      assumptions={assumptions}
      pending={pending[spec.key]}
      onChange={(next) => setInput(spec.key, next)}
      onBlur={blur}
      disabled={disabled}
    />
  );

  return (
    <section aria-labelledby="sz-editor" className="as-editor">
      <SectionHeader
        id="sz-editor"
        title="Sizing draft editor"
        subtitle={
          first
            ? 'Start with the market boundary. Each input is Evidence or an Assumption; a blank input stays Unknown.'
            : `Edits save to draft v${view.draft?.version ?? (view.current?.version ?? 0) + 1}. Committed snapshots never change.`
        }
        right={
          <span className="as-row">
            <AutosaveStatus state={draft.status} onRetry={() => void draft.retry()} />
            {onClose ? (
              <Button variant="ghost" onClick={onClose}>
                Close editor
              </Button>
            ) : null}
          </span>
        }
      />
      {problem ? (
        problem instanceof ApiProblem ? (
          <ProblemBanner error={problem} />
        ) : (
          <Banner tone="warn" title="Not saved yet" body={(problem as Error).message} />
        )
      ) : null}
      {draft.conflict ? (
        <Banner
          tone="warn"
          title="Changed elsewhere"
          body="Someone saved this sizing draft after you opened it."
          actions={
            <>
              <Button variant="secondary" onClick={() => void draft.resolveConflict('theirs')}>
                Take theirs
              </Button>
              <Button variant="secondary" onClick={() => void draft.resolveConflict('mine')}>
                Keep mine
              </Button>
            </>
          }
        />
      ) : null}
      {view.draft && missing.length ? (
        <Banner
          tone="warn"
          title="Not calculated — inputs missing"
          body={`Not available — add ${missing.map((m) => m.label).join(', ')} before calculating. The ledger shows them as Unknown.`}
        />
      ) : null}

      <Card padded>
        <SectionHeader
          level={3}
          title="Market boundary"
          subtitle="What is counted, in which currency and year."
        />
        <div className="as-form-grid">
          <Field label="Market unit" error={errs.marketUnit}>
            {(id, d) => (
              <input
                id={id}
                className="gos-input"
                value={form.marketUnit}
                placeholder="annual spend on water monitoring"
                aria-invalid={errs.marketUnit ? true : undefined}
                aria-describedby={d}
                disabled={disabled}
                onChange={(e) => set({ marketUnit: e.target.value })}
                onBlur={blur}
              />
            )}
          </Field>
          <Field label="Population unit">
            {(id) => (
              <select
                id={id}
                className="gos-select"
                value={form.populationUnit}
                disabled={disabled}
                onChange={(e) => set({ populationUnit: e.target.value as SizingForm['populationUnit'] })}
                onBlur={blur}
              >
                {POPULATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Currency" error={errs.currency}>
            {(id, d) => (
              <input
                id={id}
                className="gos-input"
                value={form.currency}
                maxLength={3}
                aria-invalid={errs.currency ? true : undefined}
                aria-describedby={d}
                disabled={disabled}
                onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
                onBlur={blur}
              />
            )}
          </Field>
          <Field label="Reference year" hint="price year" error={errs.priceYear}>
            {(id, d) => (
              <input
                id={id}
                className="gos-input"
                inputMode="numeric"
                value={form.priceYear}
                aria-invalid={errs.priceYear ? true : undefined}
                aria-describedby={d}
                disabled={disabled}
                onChange={(e) => set({ priceYear: e.target.value })}
                onBlur={blur}
              />
            )}
          </Field>
          <Field label="Horizon" hint="years">
            {(id) => (
              <input
                id={id}
                className="gos-input"
                inputMode="numeric"
                value={form.horizonYears}
                disabled={disabled}
                onChange={(e) => set({ horizonYears: e.target.value })}
                onBlur={blur}
              />
            )}
          </Field>
        </div>
        <div style={{ marginTop: 10 }} onBlur={blur}>
          <TextAreaField
            label="Product boundary"
            hint="what the product covers"
            rows={2}
            value={form.productBoundary}
            onChange={(v) => set({ productBoundary: v })}
          />
        </div>
        <fieldset className="gos-field" style={{ marginTop: 10 }}>
          <legend>What the spend includes</legend>
          <div className="as-row" style={{ gap: '4px 18px' }}>
            {INCLUDES.map((x) => (
              <label key={x.key} className="gos-radio">
                <input
                  type="checkbox"
                  checked={form.includes[x.key]}
                  disabled={disabled}
                  onChange={(e) => set({ includes: { ...form.includes, [x.key]: e.target.checked } })}
                  onBlur={blur}
                />
                {x.label}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card padded>
        <SectionHeader
          level={3}
          title="TAM and spend per site"
          subtitle="All sites of the market and what one spends per year."
        />
        <div className="as-editor-inputs">{group('market').map(row)}</div>
      </Card>

      <Card padded>
        <SectionHeader
          level={3}
          title="Unique-site cohorts"
          subtitle="SAM = the cohorts minus the sites in both. Never a total of the ladder."
          right={
            <Button
              variant="secondary"
              icon="plus"
              disabled={disabled}
              onClick={() =>
                set({
                  cohorts: [...form.cohorts, { id: null, name: '', rule: '', siteCount: '', sourceId: '' }],
                })
              }
            >
              Add cohort
            </Button>
          }
        />
        {form.cohorts.length === 0 ? <p className="as-note">No cohorts yet.</p> : null}
        {form.cohorts.map((c, n) => (
          <CohortRow
            key={c.id ?? `new-${n}`}
            n={n}
            c={c}
            sources={sources}
            disabled={disabled}
            onChange={(next) => setCohort(n, next)}
            onBlur={blur}
            onRemove={() => set({ cohorts: form.cohorts.filter((_, i) => i !== n) })}
          />
        ))}
        <div className="as-form-grid" style={{ marginTop: 10 }}>
          <Field label="Overlap removed (sites in both)" error={pending.overlap}>
            {(id, d) => (
              <input
                id={id}
                className="gos-input"
                inputMode="numeric"
                value={form.overlapCount}
                placeholder="Unknown"
                aria-describedby={d}
                disabled={disabled}
                onChange={(e) => set({ overlapCount: e.target.value })}
                onBlur={blur}
              />
            )}
          </Field>
          <Field label="How the overlap was found">
            {(id) => (
              <input
                id={id}
                className="gos-input"
                value={form.overlapMethod}
                placeholder="Dedup run v2"
                disabled={disabled}
                onChange={(e) => set({ overlapMethod: e.target.value })}
                onBlur={blur}
              />
            )}
          </Field>
        </div>
        <div style={{ marginTop: 10 }} onBlur={blur}>
          <TextAreaField
            label="Dedup rule"
            rows={2}
            value={form.dedupRule}
            onChange={(v) => set({ dedupRule: v })}
          />
        </div>
      </Card>

      <Card padded>
        <SectionHeader
          level={3}
          title="Reachable pool"
          subtitle="Sites the channel can reach. Entered, never derived from SAM; it must not exceed SAM."
        />
        <div className="as-editor-inputs">{group('reach').map(row)}</div>
      </Card>

      <Card padded>
        <SectionHeader
          level={3}
          title="Adoption and capacity"
          subtitle="Link each to its assumption in the register."
        />
        <div className="as-editor-inputs">{group('adoption').map(row)}</div>
      </Card>

      <div className="as-actions">
        <Button
          variant="primary"
          onClick={async () => {
            await draft.flush();
            commit.mutate({ params: { caseRef: caseKey } });
          }}
          disabled={commitReason !== null}
          disabledReason={commitReason ?? undefined}
        >
          {`Create snapshot v${view.draft?.version ?? (view.current?.version ?? 0) + 1}`}
        </Button>
        <span className="as-muted" style={{ fontSize: 12.5 }}>
          A snapshot freezes values for G1 review. Later edits create a draft.
        </span>
      </div>
      {commit.error ? <ProblemBanner error={commit.error} /> : null}
    </section>
  );
}
