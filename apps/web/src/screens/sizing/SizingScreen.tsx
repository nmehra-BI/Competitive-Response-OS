/**
 * S06 Sizing workbench (prototype Sizing.dc.html). Measure ladder (no total row), unique-site
 * cohorts with the signed overlap, the formula and input ledger with a lineage drawer, the top-down
 * cross-check (a test, never averaged) and "Create snapshot". While a blocking check is open the
 * ladder values are never shown and the snapshot is disabled with its reason.
 *
 * Deep links: input (node key or alias), view=lineage, version, scenario.
 */
import {
  API,
  SCENARIO_LABELS,
  type Cohort,
  type LedgerRow,
  type Scenario,
  type SizingVersion,
  type SizingView,
} from '@growth-os/contracts';
import {
  Banner,
  Button,
  Card,
  ChartTable,
  CrossCheckTag,
  DataTable,
  EmptyState,
  FormulaRow,
  Icon,
  InputLedgerTable,
  KindTag,
  LadderConnector,
  MeasureLadderRow,
  Mono,
  RestrictedValue,
  SectionHeader,
  SegmentedControl,
  Skeleton,
  SourceChip,
  formatCount,
  formatExact,
  formatLineageValue,
  formatMarketSpend,
  formatSigned,
  type InputLedgerRow,
} from '@growth-os/ui';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { LineageDrawer } from '../../app/connected/LineageDrawer';
import { Modal } from '../../app/shell/Modal';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';
import { fieldText, fieldValue, type DriverField } from '../economics/engine/adapter';
import './assessment.css';
import {
  blockingChecks,
  blockingTitle,
  formulaExpression,
  isScenario,
  ladderModel,
  lineageNode,
  nodeForLedger,
  nodeFromParam,
  SCENARIOS,
  snapshotBlockedReason,
} from './view';

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

function useParamPatch() {
  const [sp, setSp] = useSearchParams();
  const patch = (changes: Record<string, string | null>, replace = false) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace },
    );
  return [sp, patch] as const;
}

/** Session undo stack for draft input edits ("Undo edit" restores the value before the edit). */
interface UndoEntry {
  inputKey: string;
  label: string;
  from: string;
}
function useUndo(caseKey: string) {
  const key = `sizing-undo:${caseKey}`;
  const [stack, setStack] = useState<UndoEntry[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? '[]') as UndoEntry[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(stack));
    } catch {
      /* storage unavailable: undo lasts for this view only */
    }
  }, [key, stack]);
  return [stack, setStack] as const;
}

// ---------------------------------------------------------------------------
// Editable inputs (draft)
// ---------------------------------------------------------------------------

type EditField = Pick<DriverField, 'scale' | 'kind'> & { unitText: string };
const EDITABLE: Record<string, EditField> = {
  tam_site_count: { scale: 1, kind: 'count', unitText: 'sites' },
  annual_spend_per_site: { scale: 1, kind: 'money', unitText: '€ per year' },
  reachable_pool: { scale: 1, kind: 'count', unitText: 'sites' },
  'adoption_rate.base': { scale: 0.01, kind: 'rate', unitText: '%' },
  capacity: { scale: 1, kind: 'count', unitText: 'customers' },
};

function EditInputForm({
  version,
  onSave,
  onCancel,
  pending,
  initialKey,
}: {
  version: SizingVersion;
  onSave: (row: LedgerRow, value: string) => void;
  onCancel: () => void;
  pending: boolean;
  initialKey: string;
}) {
  const rows = version.ledger.filter((r) => EDITABLE[r.inputKey]);
  const [key, setKey] = useState(EDITABLE[initialKey] ? initialKey : (rows[0]?.inputKey ?? ''));
  const row = rows.find((r) => r.inputKey === key);
  const field = EDITABLE[key];
  const [text, setText] = useState(row && field ? fieldText(field, row.value) : '');
  const [touched, setTouched] = useState(false);
  const selectId = useId();
  const valueId = useId();
  const errId = useId();
  if (!row || !field) return null;
  const parsed = fieldValue(field, text, row.value);
  const invalid = touched && parsed === null;
  return (
    <form
      className="as-inline-form"
      aria-label="Edit a draft input"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (parsed !== null) onSave(row, parsed);
      }}
    >
      <div className="as-form-grid">
        <label className="gos-field" htmlFor={selectId}>
          <span>Input</span>
          <select
            id={selectId}
            className="gos-select"
            value={key}
            onChange={(e) => {
              const next = rows.find((r) => r.inputKey === e.target.value)!;
              setKey(next.inputKey);
              setText(fieldText(EDITABLE[next.inputKey]!, next.value));
              setTouched(false);
            }}
          >
            {rows.map((r) => (
              <option key={r.inputKey} value={r.inputKey}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="gos-field" htmlFor={valueId}>
          <span>New value ({field.unitText})</span>
          <input
            id={valueId}
            className="gos-input"
            inputMode="decimal"
            value={text}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errId : undefined}
            onChange={(e) => {
              setText(e.target.value);
              setTouched(true);
            }}
          />
          {invalid ? (
            <span id={errId} className="gos-field__error">
              Enter a number.
            </span>
          ) : null}
        </label>
      </div>
      <p className="as-note" style={{ marginTop: 0 }}>
        Current: {formatLineageValue(row, version.boundary.currency)}. The draft recalculates; the committed
        snapshot never changes.
      </p>
      <div className="as-row">
        <Button
          variant="primary"
          type="submit"
          disabled={pending}
          disabledReason={pending ? 'Saving…' : undefined}
        >
          Save to draft
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function ContextStrip({ v, engineLabel }: { v: SizingVersion; engineLabel: string }) {
  const b = v.boundary;
  return (
    <div className="as-strip" role="group" aria-label="Market boundary">
      <span>
        <span className="as-faint">Market unit</span> {b.marketUnit}
      </span>
      <span>
        <span className="as-faint">Population</span> unique {b.populationUnit}s
      </span>
      <span>
        <span className="as-faint">Geography</span> {b.countryCode === 'DE' ? 'Germany' : b.countryCode} ·{' '}
        {b.segmentLabel}
      </span>
      <Mono size={12.5} strong>
        {b.currency} · {b.priceYear} prices
      </Mono>
      <span className="as-row" style={{ gap: 6 }}>
        <Icon name="lock" size={13} />
        Sizing v{v.version} · {v.state === 'draft' ? 'draft' : 'committed'}
      </span>
      <span className="as-strip__right">
        <Icon name="sigma" size={14} />
        {engineLabel}
      </span>
    </div>
  );
}

function Ladder({
  v,
  scenario,
  onScenario,
  onLineage,
  selected,
}: {
  v: SizingVersion;
  scenario: Scenario;
  onScenario: (s: Scenario) => void;
  onLineage: (nodeKey: string) => void;
  selected: string | null;
}) {
  const model = ladderModel(v, scenario);
  const checks = blockingChecks(v.result);
  const sam = lineageNode(v.result, 'sizing.sam.value');
  const reachOwner = v.ledger.find((l) => l.inputKey === 'reachable_pool')?.basis.owner?.displayName;
  return (
    <section aria-labelledby="ml">
      <SectionHeader
        id="ml"
        title="Measure ladder"
        subtitle="Four different questions. Rows narrow by sites first and money second. Never added together."
      />
      {!model ? (
        <div className="as-box as-box--dashed" role="status">
          <div className="as-row" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            <Icon name="lock" size={14} />
            Ladder values are hidden while a blocking check is open
          </div>
          <p className="as-note" style={{ marginTop: 4 }}>
            {checks.length
              ? 'Fix the blocking check above. TAM, SAM, reachable pool and SOM reappear when the draft calculates.'
              : 'This draft has not been calculated yet.'}
          </p>
        </div>
      ) : (
        <>
          <div className="as-ladder">
            {model.rows.map((r, i) => {
              const kinds =
                r.key === 'tam' ? (
                  <>
                    <KindTag kind="evidence" small />
                    <KindTag kind="assumption" detail="price" small />
                  </>
                ) : r.key === 'sam' ? (
                  <KindTag
                    kind="calculated"
                    detail={`${sam?.dependsOnAssumptionCount ?? 0} assumption${sam?.dependsOnAssumptionCount === 1 ? '' : 's'}`}
                    small
                  />
                ) : r.key === 'reach' ? (
                  <KindTag kind="assumption" detail={reachOwner} small />
                ) : (
                  <KindTag kind="scenario" detail={SCENARIO_LABELS[scenario]} small />
                );
              return (
                <div key={r.key}>
                  {i > 0 ? <LadderConnector text={model.connectors[i - 1]!} /> : null}
                  <MeasureLadderRow
                    name={r.name}
                    meaning={r.meaning}
                    sites={
                      <>
                        <div className="as-ladder-sites">{r.sites}</div>
                        <div className="as-ladder-bar" aria-hidden="true">
                          <span style={{ width: `${Math.round(r.share * 1000) / 10}%` }} />
                        </div>
                      </>
                    }
                    money={
                      r.money === null ? (
                        <span className="as-muted">
                          — <span style={{ fontSize: 12 }}>site count, not money</span>
                        </span>
                      ) : (
                        <b style={{ fontWeight: 600 }}>{r.money}</b>
                      )
                    }
                    kinds={kinds}
                    onLineage={() => onLineage(r.nodeKey)}
                    selected={selected === r.nodeKey}
                  />
                </div>
              );
            })}
          </div>
          <div className="as-row" style={{ marginTop: 10, gap: '8px 14px' }}>
            <span className="as-muted" style={{ fontSize: 12.5 }}>
              SOM scenario
            </span>
            <SegmentedControl
              ariaLabel="SOM scenario"
              value={scenario}
              onChange={onScenario}
              options={SCENARIOS.map((s) => ({
                value: s,
                label: `${s === 'downside' ? '▼' : s === 'base' ? '●' : '▲'} ${SCENARIO_LABELS[s]}`,
              }))}
            />
            <span className="as-row as-muted" style={{ fontSize: 12.5, gap: 6 }}>
              <span style={{ color: 'var(--chart-cap)', display: 'inline-flex' }}>
                <Icon name="lockbar" size={14} />
              </span>
              {model.capNote}
            </span>
          </div>
          <p className="as-note">{model.footnote}</p>
        </>
      )}
    </section>
  );
}

type CohortRow =
  | { kind: 'cohort'; c: Cohort; duplicate: boolean }
  | { kind: 'overlap'; count: number; method: string }
  | { kind: 'sam'; text: string };

function Cohorts({
  v,
  view,
  onInspect,
  onKeep,
  resolving,
  onRequestAccess,
  accessRequested,
}: {
  v: SizingVersion;
  view: SizingView;
  onInspect: () => void;
  onKeep: (keep: string, exclude: string) => void;
  resolving: boolean;
  onRequestAccess: () => void;
  accessRequested: boolean;
}) {
  const [compare, setCompare] = useState(false);
  const r = v.result;
  const blocked = !r || r.blocked;
  const dup = view.duplicateCohorts[0];
  const samNode = lineageNode(r, 'sizing.sam.value');
  const expr = formulaExpression(samNode);
  const rows: CohortRow[] = [
    ...v.cohorts.map((c) => ({
      kind: 'cohort' as const,
      c,
      duplicate:
        !!dup && (c.id === dup.cohortBId || (c.status === 'duplicate_candidate' && c.id !== dup.cohortAId)),
    })),
    ...v.overlaps.map((o) => ({ kind: 'overlap' as const, count: o.overlapCount, method: o.method })),
    { kind: 'sam' as const, text: blocked ? 'Paused' : formatCount(r.ladder.sam.population) },
  ];
  const nameOf = (id: string) => v.cohorts.find((c) => c.id === id);
  const label = (c: Cohort | undefined) => (c ? `${c.name}${c.qualifier ? ` ${c.qualifier}` : ''}` : '');
  return (
    <section aria-labelledby="co" className="as-section">
      <SectionHeader
        id="co"
        title="Unique-site cohorts"
        subtitle="The arithmetic is the explanation"
        right={
          <Button variant="secondary" icon="users" onClick={onInspect}>
            Inspect population
          </Button>
        }
      />
      {dup ? (
        <div style={{ marginBottom: 10 }}>
          <Banner
            tone="warn"
            title="Duplicate cohort — calculation paused"
            body={
              <>
                {dup.message}
                {compare && dup.sharedSiteCount !== null ? (
                  <span style={{ display: 'block', marginTop: 4 }}>
                    {label(nameOf(dup.cohortAId))} and {label(nameOf(dup.cohortBId))} share{' '}
                    {formatCount(dup.sharedSiteCount)} site IDs.
                  </span>
                ) : null}
              </>
            }
            actions={
              <>
                <Button variant="secondary" onClick={() => setCompare((x) => !x)}>
                  Compare
                </Button>
                <Button
                  variant="secondary"
                  disabled={resolving}
                  disabledReason={resolving ? 'Saving…' : undefined}
                  onClick={() => onKeep(dup.cohortAId, dup.cohortBId)}
                >
                  Keep v1
                </Button>
                <Button
                  variant="secondary"
                  disabled={resolving}
                  disabledReason={resolving ? 'Saving…' : undefined}
                  onClick={() => onKeep(dup.cohortBId, dup.cohortAId)}
                >
                  Keep imported
                </Button>
              </>
            }
          />
        </div>
      ) : null}
      {view.siteListRestricted ? (
        <div style={{ marginBottom: 10 }}>
          <Banner
            tone="lock"
            title="Site list restricted under your access"
            body={`Aggregates are shown under policy. Individual site IDs and names are not available to you.${
              view.siteListDataOwner
                ? ` Ask ${view.siteListDataOwner.displayName} (data owner) for access.`
                : ''
            }`}
            actions={
              <Button
                variant="secondary"
                onClick={onRequestAccess}
                disabled={accessRequested}
                disabledReason={accessRequested ? 'Access requested' : undefined}
              >
                Request access
              </Button>
            }
          />
        </div>
      ) : null}
      <Card>
        <DataTable<CohortRow>
          ariaLabel="Cohorts"
          minWidth={560}
          rows={rows}
          rowKey={(x) => (x.kind === 'cohort' ? x.c.id : x.kind)}
          rowHeader="cohort"
          columns={[
            {
              key: 'cohort',
              header: 'Cohort',
              cell: (x) =>
                x.kind === 'cohort' ? (
                  <span className="as-row" style={{ gap: 6 }}>
                    {x.duplicate ? (
                      <span style={{ color: 'var(--warning-fg)', display: 'inline-flex' }}>
                        <Icon name="alert" size={14} label="Possible duplicate" />
                      </span>
                    ) : null}
                    <span>
                      {x.c.name} {x.c.qualifier ? <span className="as-faint">{x.c.qualifier}</span> : null}
                      {x.c.status === 'excluded' ? (
                        <span className="as-faint"> · excluded, kept in history</span>
                      ) : null}
                    </span>
                  </span>
                ) : x.kind === 'overlap' ? (
                  <span>
                    Overlap removed <span className="as-faint">(in both)</span>
                  </span>
                ) : (
                  <b style={{ fontWeight: 600 }}>Unique eligible sites (SAM)</b>
                ),
            },
            {
              key: 'rule',
              header: 'Rule',
              cell: (x) =>
                x.kind === 'cohort' ? (
                  <span className="as-muted">{x.duplicate ? 'Same rule, imported 13 Oct' : x.c.rule}</span>
                ) : x.kind === 'overlap' ? (
                  <span className="as-muted">Same site ID in both cohorts</span>
                ) : null,
            },
            {
              key: 'sites',
              header: 'Sites',
              numeric: true,
              cell: (x) =>
                x.kind === 'cohort' ? (
                  formatCount(x.c.siteCount)
                ) : x.kind === 'overlap' ? (
                  <span style={{ color: 'var(--text-primary)' }}>{formatSigned(-x.count)}</span>
                ) : (
                  <b style={{ fontWeight: 600, fontSize: 14 }}>{x.text}</b>
                ),
            },
            {
              key: 'source',
              header: 'Source',
              cell: (x) =>
                x.kind === 'cohort' ? (
                  x.c.source ? (
                    <SourceChip
                      label={x.c.source.label}
                      quality={x.c.source.quality}
                      href={`/evidence/${x.c.source.key}`}
                      restricted={x.c.source.restricted}
                    />
                  ) : (
                    <span className="as-muted" style={{ fontSize: 12 }}>
                      Upload · not linked to a source
                    </span>
                  )
                ) : x.kind === 'overlap' ? (
                  <Mono size={12}>{x.method}</Mono>
                ) : (
                  <span className="as-muted">Calculated</span>
                ),
            },
          ]}
        />
      </Card>
      <p className="as-note" style={{ color: 'var(--text-secondary)' }}>
        Dedup rule: {v.dedupRuleText.replace(/\.$/, '')}. Blocking checks: overlap below 0 · overlap above the
        smaller cohort · SAM above TAM · mixed units · mixed years.
      </p>
      <div style={{ marginTop: 12 }}>
        <FormulaRow
          lhs="SAM"
          expr={expr ?? 'Size-qualified + Process-qualified − Overlap, × Annual spend per site'}
          result={
            blocked
              ? `Paused — ${dup ? 'duplicate cohort' : 'blocking check open'}`
              : `${formatMarketSpend(r.ladder.sam.value.amount, r.ladder.sam.value.currency)} · Calculated · depends on ${
                  samNode?.dependsOnAssumptionCount ?? 0
                } assumption${samNode?.dependsOnAssumptionCount === 1 ? '' : 's'}`
          }
        />
      </div>
    </section>
  );
}

function basisText(r: LedgerRow): string {
  if (r.disputed) return 'Disputed · open thread';
  if (r.basis.source) return r.basis.source.label;
  return r.basis.text ?? '—';
}

function Ledger({
  v,
  onSelect,
  onEdit,
  editing,
  canEdit,
  onCompare,
  compareReason,
}: {
  v: SizingVersion;
  onSelect: (inputKey: string) => void;
  onEdit: () => void;
  editing: ReactNode;
  canEdit: boolean;
  onCompare: () => void;
  compareReason: string | null;
}) {
  const rows: InputLedgerRow[] = v.ledger.map((r) => ({
    inputKey: r.inputKey,
    label: r.name,
    valueText: formatLineageValue(r, v.boundary.currency),
    kind: r.kind,
    basis: `${basisText(r)}${r.basis.owner ? ` · ${r.basis.owner.displayName}` : ''}${r.changedInDraft ? ' · changed in draft' : ''}`,
    quality: r.evidenceQuality,
    version: `v${r.version}`,
    usedBy: String(r.usedByCount),
  }));
  return (
    <section aria-labelledby="lg" className="as-section">
      <SectionHeader
        id="lg"
        title="Input ledger"
        subtitle="Select a row to see its lineage. Exact values live here."
        right={
          <span className="as-row">
            <Button
              variant="secondary"
              icon="compare"
              onClick={onCompare}
              disabled={compareReason !== null}
              disabledReason={compareReason ?? undefined}
            >
              Compare versions
            </Button>
            <Button variant="secondary" icon="clip" href="/evidence?case=ME-104">
              Attach source
            </Button>
            {canEdit ? (
              <Button variant="secondary" icon="pencil" onClick={onEdit}>
                Edit draft input
              </Button>
            ) : null}
          </span>
        }
      />
      {editing}
      <Card>
        <InputLedgerTable rows={rows} onSelectInput={onSelect} />
      </Card>
    </section>
  );
}

function CrossCheck({ v }: { v: SizingVersion }) {
  const r = v.result;
  const blocked = !r || r.blocked;
  const cur = v.boundary.currency;
  const bottomUp = blocked ? 'Paused' : `${formatMarketSpend(r.ladder.sam.value.amount, cur)} SAM`;
  const cc = v.crossCheck;
  const top = cc ? `${formatExact(cc.low, cur)}–${formatExact(cc.high, cur)}/year` : 'Not available';
  const result = r?.crossCheck.result ?? 'not_available';
  const message = r?.crossCheck.message ?? 'Not available — the draft has not been calculated.';
  return (
    <section aria-labelledby="xc" className="as-box" style={{ padding: '14px 16px' }}>
      <h2 id="xc" style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
        Top-down cross-check · SAM
      </h2>
      <p style={{ margin: '4px 0 10px', fontSize: 12.5, color: 'var(--text-secondary)' }}>
        A test with a pass or explain outcome. Never averaged with the model.
      </p>
      <ChartTable<{ method: string; value: string; basis: string }>
        caption={`SAM · ${cur} · ${v.boundary.priceYear} prices · per year`}
        chart={
          <svg
            className="as-chart"
            role="img"
            aria-label={
              blocked
                ? 'Bottom-up SAM is paused while a blocking check is open; no top-down range is recorded'
                : `Bottom-up SAM ${formatMarketSpend(r.ladder.sam.value.amount, cur)}; ${cc ? `top-down range ${top}` : 'no top-down range recorded'}`
            }
            viewBox="0 0 360 96"
          >
            <line className="as-chart__axis" x1="10" y1="60" x2="350" y2="60" />
            {cc ? <rect className="as-chart__range" x="160" y="34" width="120" height="16" /> : null}
            <text x="220" y="28" fontSize="11" textAnchor="middle">
              {cc ? `Top-down ${top}` : 'Top-down range not recorded'}
            </text>
            {!blocked ? (
              <>
                <circle className="as-chart__bottomup" cx="230" cy="60" r="6" />
                <text x="230" y="82" fontSize="11" textAnchor="middle">
                  Bottom-up {formatMarketSpend(r.ladder.sam.value.amount, cur)}
                </text>
              </>
            ) : null}
          </svg>
        }
        table={{
          ariaLabel: 'Cross-check table',
          minWidth: 300,
          rowKey: (x) => x.method,
          rowHeader: 'method',
          rows: [
            { method: 'Bottom-up (model)', value: bottomUp, basis: 'Cohorts × price' },
            {
              method: 'Top-down (cross-check)',
              value: top,
              basis: cc ? cc.basis : 'No top-down estimate recorded',
            },
            {
              method: 'Result',
              value: blocked ? 'Paused' : result.replace('_', ' '),
              basis: 'No average shown',
            },
          ],
          columns: [
            { key: 'method', header: 'Method', cell: (x) => x.method },
            { key: 'value', header: 'Value', cell: (x) => x.value },
            { key: 'basis', header: 'Basis', cell: (x) => x.basis },
          ],
        }}
      />
      <div className="as-row" style={{ marginTop: 8, fontSize: 12.5 }}>
        <CrossCheckTag result={blocked ? 'not_available' : result} />
        <span className="as-muted">{blocked ? 'Resolve the blocking checks first.' : message}</span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function SizingScreen() {
  const { caseKey = '' } = useParams();
  const [sp, patch] = useParamPatch();
  const view = useApiQuery(API.sizing.get, { params: { caseRef: caseKey } });
  const versionParam = sp.get('version');
  const pinned = versionParam && /^\d+$/.test(versionParam) ? Number(versionParam) : null;
  const pinnedQ = useApiQuery(
    API.sizing.getVersion,
    { params: { caseRef: caseKey, version: pinned ?? 1 } },
    { enabled: pinned !== null },
  );
  const scenarioParam = sp.get('scenario');
  const scenario: Scenario = isScenario(scenarioParam) ? scenarioParam : 'base';
  const lineageOpen = sp.get('view') === 'lineage' && sp.get('input');
  const [undo, setUndo] = useUndo(caseKey);
  const [editing, setEditing] = useState<string | null>(null);
  const [inspect, setInspect] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [justCommitted, setJustCommitted] = useState<number | null>(null);

  const save = useCommand(API.sizing.saveDraft);
  const commit = useCommand(API.sizing.commit, {
    onSuccess: (v) => {
      setJustCommitted(v.version);
      setUndo([]);
    },
  });
  const resolve = useCommand(API.sizing.resolveDuplicateCohort);
  const access = useCommand(API.evidence.requestAccess);

  const data = view.data;
  const shown: SizingVersion | null = useMemo(() => {
    if (!data) return null;
    if (pinned !== null) return pinnedQ.data ?? null;
    return data.draft ?? data.current;
  }, [data, pinned, pinnedQ.data]);

  if (view.isPending || (pinned !== null && pinnedQ.isPending)) {
    return (
      <div className="as-page" aria-busy="true">
        <Skeleton height={40} />
        <Skeleton height={320} />
      </div>
    );
  }
  if (view.error || !data) {
    return (
      <div className="as-page">
        <ProblemBanner error={view.error} />
      </div>
    );
  }
  if (pinnedQ.error && pinned !== null) {
    return (
      <div className="as-page">
        <ProblemBanner error={pinnedQ.error} />
      </div>
    );
  }
  if (!shown) {
    return (
      <div className="as-page">
        <h2 className="gos-sr-only">Sizing</h2>
        <EmptyState title="No sizing yet">
          Define the market boundary and cohorts to calculate the measure ladder.
        </EmptyState>
      </div>
    );
  }

  const isDraft = shown.state === 'draft';
  const checks = blockingChecks(shown.result);
  const blocked = !shown.result || shown.result.blocked;
  const engineLabel = `Calculated by sizing engine v${shown.result?.engineVersion ?? '—'} · reproducible`;
  const draftRowVersion = data.draft?.rowVersion ?? data.current?.rowVersion ?? 0;
  const lineageVersion: number | 'draft' = isDraft ? 'draft' : shown.version;
  const selectedNode = lineageOpen ? nodeFromParam(sp.get('input')!) : null;

  const openLineage = (nodeKey: string) => patch({ input: nodeKey, view: 'lineage' });
  const closeLineage = () => patch({ input: null, view: null });

  const saveInput = (row: LedgerRow, value: string) => {
    if (value === row.value) {
      setEditing(null);
      return;
    }
    save.mutate(
      {
        params: { caseRef: caseKey },
        ifMatch: draftRowVersion,
        body: {
          inputs: [
            { inputKey: row.inputKey, value, unit: row.unit, sourceId: null, assumptionId: row.assumptionId },
          ],
        },
      },
      {
        onSuccess: () => {
          setUndo((s) => [...s, { inputKey: row.inputKey, label: row.name, from: row.value }]);
          setEditing(null);
        },
      },
    );
  };

  const lastUndo = undo.at(-1);
  const undoEdit = () => {
    if (!lastUndo) return;
    const row = data.draft?.ledger.find((r) => r.inputKey === lastUndo.inputKey);
    if (!row) return;
    save.mutate(
      {
        params: { caseRef: caseKey },
        ifMatch: draftRowVersion,
        body: {
          inputs: [
            {
              inputKey: row.inputKey,
              value: lastUndo.from,
              unit: row.unit,
              sourceId: null,
              assumptionId: row.assumptionId,
            },
          ],
        },
      },
      { onSuccess: () => setUndo((s) => s.slice(0, -1)) },
    );
  };

  const tamRow = shown.ledger.find((r) => r.inputKey === 'tam_site_count');
  const versionsOptions = [
    ...data.versions.map((x) => ({ value: String(x.version), label: `v${x.version} · committed` })),
    ...(data.draft ? [{ value: 'draft', label: `v${data.draft.version} · draft` }] : []),
  ];

  return (
    <div className="as-page">
      <h2 className="gos-sr-only">Sizing</h2>
      <ContextStrip v={shown} engineLabel={engineLabel} />
      {versionsOptions.length > 1 ? (
        <div className="as-row">
          <span className="as-muted" style={{ fontSize: 12.5 }}>
            Version
          </span>
          <SegmentedControl
            ariaLabel="Sizing version"
            value={pinned !== null ? String(pinned) : isDraft ? 'draft' : String(shown.version)}
            onChange={(val) => patch({ version: val === 'draft' ? null : val })}
            options={versionsOptions}
          />
        </div>
      ) : null}
      {!isDraft ? (
        <Banner
          tone="neutral"
          title={`Snapshot v${shown.version} · committed${justCommitted === shown.version ? ' just now' : ''}`}
          body="Committed values are frozen and never recalculate. Editing an input creates a new draft."
          live={justCommitted === shown.version}
        />
      ) : null}
      {checks
        .filter((c) => c.key !== 'DUPLICATE_COHORT')
        .map((c) => (
          <Banner
            key={`${c.key}-${c.inputKeys.join(',')}`}
            tone="danger"
            title={blockingTitle(c)}
            body={
              <>
                {c.message}
                {c.key === 'SAM_EXCEEDS_TAM' && tamRow?.changedInDraft
                  ? ` The TAM site count was edited to ${formatCount(Number(tamRow.value))} in this draft.`
                  : ''}{' '}
                Snapshot and submission are blocked until fixed.
              </>
            }
            actions={
              <>
                {lastUndo ? (
                  <Button
                    variant="secondary"
                    onClick={undoEdit}
                    disabled={save.isPending}
                    disabledReason={save.isPending ? 'Saving…' : undefined}
                  >
                    Undo edit
                  </Button>
                ) : null}
                {c.key === 'SAM_EXCEEDS_TAM' ? (
                  <Button variant="ghost" onClick={() => openLineage('input.tam_site_count')}>
                    Open TAM input
                  </Button>
                ) : null}
              </>
            }
          />
        ))}
      {save.error ? <ProblemBanner error={save.error} /> : null}
      {commit.error ? <ProblemBanner error={commit.error} /> : null}
      <div className="as-split">
        <div className="as-main">
          <Ladder
            v={shown}
            scenario={scenario}
            onScenario={(s) => patch({ scenario: s === 'base' ? null : s }, true)}
            onLineage={openLineage}
            selected={selectedNode}
          />
          <Cohorts
            v={shown}
            view={data}
            onInspect={() => setInspect(true)}
            resolving={resolve.isPending}
            onKeep={(keep, exclude) =>
              resolve.mutate({
                params: { caseRef: caseKey },
                ifMatch: draftRowVersion,
                body: { keepCohortId: keep, excludeCohortId: exclude },
              })
            }
            accessRequested={access.isSuccess}
            onRequestAccess={() =>
              access.mutate({
                params: { ref: shown.cohorts[0]?.source?.key ?? 'SRC-014' },
                body: { reason: `Site-level population for ${caseKey} sizing` },
              })
            }
          />
          <Ledger
            v={shown}
            onSelect={(k) => openLineage(nodeForLedger(k))}
            canEdit={pinned === null}
            onEdit={() => setEditing((e) => (e ? null : 'tam_site_count'))}
            editing={
              editing ? (
                <div style={{ marginBottom: 12 }}>
                  <EditInputForm
                    version={data.draft ?? shown}
                    initialKey={editing}
                    pending={save.isPending}
                    onCancel={() => setEditing(null)}
                    onSave={saveInput}
                  />
                </div>
              ) : null
            }
            onCompare={() => setCompareOpen(true)}
            compareReason={
              data.current && data.draft ? null : 'Needs a committed version and a draft to compare.'
            }
          />
          <div className="as-actions">
            {isDraft ? (
              <Button
                variant="primary"
                onClick={() => commit.mutate({ params: { caseRef: caseKey } })}
                disabled={blocked || commit.isPending}
                disabledReason={
                  blocked
                    ? snapshotBlockedReason(checks)
                    : commit.isPending
                      ? 'Creating snapshot…'
                      : undefined
                }
              >
                {`Create snapshot v${shown.version}`}
              </Button>
            ) : null}
            <Button variant="secondary" icon="pencilruler" href={`/me/cases/${caseKey}/validation`}>
              Edit assumption
            </Button>
            {!blocked && isDraft ? (
              <span className="as-muted" style={{ fontSize: 12.5 }}>
                A snapshot freezes values for G1 review. Later edits create a draft.
              </span>
            ) : null}
          </div>
        </div>
        <div className="as-aside" style={{ flexBasis: 340 }}>
          <CrossCheck v={shown} />
          <section aria-labelledby="lin-help" className="as-box as-box--canvas">
            <h3 id="lin-help">Lineage</h3>
            <p className="as-note" style={{ marginTop: 0 }}>
              Select a ladder row or a ledger input to trace its formula, inputs one level deep and what uses
              it.
            </p>
            <div className="as-row" style={{ marginTop: 8 }}>
              <button type="button" className="as-link-btn" onClick={() => openLineage('sizing.sam.value')}>
                Trace SAM
              </button>
              <button
                type="button"
                className="as-link-btn"
                onClick={() => openLineage('input.adoption_rate.base')}
              >
                Trace adoption
              </button>
            </div>
          </section>
        </div>
      </div>
      {selectedNode ? (
        <LineageDrawer
          caseRef={caseKey}
          model="sizing"
          nodeKey={selectedNode}
          version={lineageVersion}
          onClose={closeLineage}
        />
      ) : null}
      {inspect ? <PopulationDialog caseKey={caseKey} v={shown} onClose={() => setInspect(false)} /> : null}
      {compareOpen && data.current && data.draft ? (
        <CompareDialog caseKey={caseKey} from={data.current.version} onClose={() => setCompareOpen(false)} />
      ) : null}
    </div>
  );
}

function PopulationDialog({
  caseKey,
  v,
  onClose,
}: {
  caseKey: string;
  v: SizingVersion;
  onClose: () => void;
}) {
  const cohort = v.cohorts.find((c) => c.status === 'active') ?? v.cohorts[0];
  const q = useApiQuery(
    API.sizing.population,
    { params: { caseRef: caseKey, cohortId: cohort?.id ?? '' }, query: {} },
    { enabled: !!cohort },
  );
  return (
    <Modal label="Inspect population" onClose={onClose}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 280 }}>
        <SectionHeader title="Inspect population" subtitle="Aggregates by cohort under your access" />
        {q.error ? <ProblemBanner error={q.error} /> : null}
        {q.data?.restricted ? (
          <RestrictedValue
            detail={`Site IDs and names are restricted${q.data.dataOwnerName ? ` · data owner ${q.data.dataOwnerName}` : ''}`}
          />
        ) : null}
        <ul className="as-list" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          {v.cohorts
            .filter((c) => c.status !== 'excluded')
            .map((c) => (
              <li key={c.id} className="as-row" style={{ justifyContent: 'space-between' }}>
                <span>
                  {c.name} {c.qualifier ? <span className="as-faint">{c.qualifier}</span> : null}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCount(c.siteCount)} sites</span>
              </li>
            ))}
        </ul>
        {q.data && q.data.rows.length === 0 && !q.data.restricted ? (
          <p className="as-note" style={{ marginTop: 0 }}>
            Site-level rows are not loaded in this workspace; aggregates only.
          </p>
        ) : null}
        <div>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CompareDialog({ caseKey, from, onClose }: { caseKey: string; from: number; onClose: () => void }) {
  const q = useApiQuery(API.sizing.compareVersions, {
    params: { caseRef: caseKey },
    query: { from, to: 'draft' },
  });
  return (
    <Modal label="Compare versions" onClose={onClose}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 300 }}>
        <SectionHeader title="Compare versions" subtitle={`Snapshot v${from} → draft`} />
        {q.error ? <ProblemBanner error={q.error} /> : null}
        {q.data && q.data.changes.length === 0 ? <p className="as-muted">No input changed.</p> : null}
        {q.data?.changes.length ? (
          <DataTable
            ariaLabel="Changed inputs"
            minWidth={300}
            rows={q.data.changes}
            rowKey={(c) => c.inputKey}
            columns={[
              { key: 'label', header: 'Input', cell: (c) => c.label },
              { key: 'from', header: `v${from}`, cell: (c) => c.from ?? '—' },
              { key: 'to', header: 'Draft', cell: (c) => c.to ?? '—' },
            ]}
          />
        ) : null}
        <div>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
