/**
 * S08 Economics (prototype Economics.dc.html). Editable draft drivers with live recompute through
 * the deterministic engine adapter; Downside · Base · Upside table with ▼ ● ▲ markers; recurring
 * and one-time money in separate cards with a "Do not add" divider; cash flow and payback "Not
 * available" with the missing inputs; the adoption dispute thread; committed snapshots never change.
 *
 * Deep links: input + view=lineage (lineage drawer), version (a committed snapshot), scenario.
 */
import {
  API,
  SCENARIO_LABELS,
  type Assumption,
  type EconomicsOutput,
  type EconomicsVersion,
  type LedgerRow,
  type Scenario,
} from '@growth-os/contracts';
import {
  Avatar,
  Banner,
  Button,
  Card,
  ChartTable,
  Icon,
  KindTag,
  ScenarioMark,
  SectionHeader,
  SegmentedControl,
  Skeleton,
  TextAreaField,
  formatContributionK,
  formatCount,
  formatGrossContribution,
  formatNotAvailable,
  formatOneTime,
  formatRate,
  formatScenarioRevenue,
} from '@growth-os/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { LineageDrawer } from '../../app/connected/LineageDrawer';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { api, buildPath, queryKey } from '../../lib/api-client';
import { usePublishAutosave, useDraft, type Versioned } from '../../lib/drafts';
import { useApiQuery, useCommand } from '../../lib/query';
import { useViewer } from '../../lib/session';
import '../sizing/assessment.css';
import {
  DRIVER_FIELDS,
  economicsEngine,
  economicsInputFromDrivers,
  fieldText,
  fieldValue,
  type DriverField,
} from './engine/adapter';
import {
  breakEvenWorking,
  capacityOf,
  cellText,
  differs,
  MEASURES,
  rawCell,
  SCENARIOS,
  scenarioOf,
  shareOfPool,
} from './view';

type Values = Record<string, string>;

const MARK: Record<Scenario, string> = { downside: '▼', base: '●', upside: '▲' };
const EDIT_ORDER = [
  'annual_price',
  'adoption_rate.base',
  'gross_margin',
  'annual_incremental_opex',
  'capacity',
  'one_time_investment',
] as const;

function valuesOf(drivers: LedgerRow[]): Values {
  return Object.fromEntries(drivers.map((d) => [d.inputKey, d.value]));
}

function useParamPatch() {
  const [sp, setSp] = useSearchParams();
  const patch = (changes: Record<string, string | null>) =>
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      return next;
    });
  return [sp, patch] as const;
}

// ---------------------------------------------------------------------------
// Live recompute (engine adapter) for the draft being edited
// ---------------------------------------------------------------------------

function useLocalResult(draft: EconomicsVersion | null | undefined, values: Values | undefined) {
  const [result, setResult] = useState<{ key: string; out: EconomicsOutput } | null>(null);
  const key = values ? JSON.stringify(values) : '';
  useEffect(() => {
    if (!draft || !values) return undefined;
    let live = true;
    const input = economicsInputFromDrivers(draft, values);
    economicsEngine
      .calculate(input)
      .then((out) => {
        if (live) setResult({ key, out });
      })
      .catch(() => {
        if (live) setResult(null);
      });
    return () => {
      live = false;
    };
  }, [draft?.id, key]);
  return result && result.key === key ? result.out : null;
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

function DriverInput({
  row,
  field,
  value,
  committedValue,
  onChange,
  onBlur,
  readOnly,
}: {
  row: LedgerRow;
  field: DriverField;
  value: string;
  committedValue: string | undefined;
  onChange: (decimal: string | null, text: string) => void;
  onBlur: () => void;
  readOnly: boolean;
}) {
  const id = `in-${row.inputKey.replace(/\./g, '-')}`;
  const errId = `${id}-err`;
  const [text, setText] = useState(() => fieldText(field, value));
  const [invalid, setInvalid] = useState(false);
  // Follow outside changes (reset, server echo) unless the field holds an invalid entry.
  useEffect(() => {
    const parsed = fieldValue(field, text, value);
    if (!invalid && parsed !== value) setText(fieldText(field, value));
  }, [value]);
  const changed = differs(value, committedValue);
  if (readOnly) {
    return (
      <span className="gos-mono" style={{ fontSize: 13 }}>
        {field.prefix}
        {fieldText(field, value)}
        {field.suffix === '%' ? '%' : ` ${field.suffix}`}
      </span>
    );
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
      }}
    >
      {field.prefix ? <span aria-hidden="true">{field.prefix}</span> : null}
      <input
        id={id}
        className={changed ? 'as-num-input as-num-input--changed' : 'as-num-input'}
        inputMode="decimal"
        value={text}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errId : undefined}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const parsed = fieldValue(field, t, value);
          setInvalid(parsed === null);
          onChange(parsed, t);
        }}
        onBlur={onBlur}
      />
      <span aria-hidden="true">{field.suffix}</span>
      {invalid ? (
        <span id={errId} className="gos-field__error" style={{ fontFamily: 'var(--font-ui)' }}>
          Enter a number
        </span>
      ) : null}
    </span>
  );
}

function Drivers({
  shown,
  values,
  committed,
  readOnly,
  onValue,
  onBlur,
  onReset,
  adoption,
  canDispute,
  onDispute,
}: {
  shown: EconomicsVersion;
  values: Values;
  committed: EconomicsVersion | null;
  readOnly: boolean;
  onValue: (key: string, decimal: string) => void;
  onBlur: () => void;
  onReset: () => void;
  adoption: Assumption | undefined;
  canDispute: boolean;
  onDispute: () => void;
}) {
  const committedValues = committed ? valuesOf(committed.drivers) : {};
  const changedCount = readOnly
    ? 0
    : EDIT_ORDER.filter((k) => values[k] !== undefined && differs(values[k], committedValues[k])).length;
  const reach = shown.drivers.find((d) => d.inputKey === 'reachable_pool');
  return (
    <section aria-labelledby="dr">
      <SectionHeader
        id="dr"
        title="Drivers"
        subtitle={
          readOnly
            ? `Snapshot v${shown.version} is read-only. The approved snapshot never recalculates.`
            : 'Edit in draft. The approved snapshot never recalculates.'
        }
        right={
          readOnly ? null : (
            <span className="as-row">
              <span
                role="status"
                style={{
                  fontSize: 12.5,
                  color: changedCount ? 'var(--kind-scenario-fg)' : 'var(--text-secondary)',
                  fontWeight: changedCount ? 500 : 400,
                }}
              >
                {changedCount
                  ? `Draft · ${changedCount} driver${changedCount > 1 ? 's' : ''} differ from snapshot v${committed?.version ?? ''}`
                  : `Matches snapshot v${committed?.version ?? ''}`}
              </span>
              <Button
                variant="ghost"
                onClick={onReset}
                disabled={!changedCount}
                disabledReason={changedCount ? undefined : 'Nothing to reset'}
              >
                {`Reset to v${committed?.version ?? ''}`}
              </Button>
            </span>
          )
        }
      />
      <Card>
        <div className="gos-table-scroll">
          <table className="gos-table" aria-label="Economics drivers" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th scope="col">Driver</th>
                <th scope="col">Value</th>
                <th scope="col">Kind</th>
                <th scope="col">Basis</th>
              </tr>
            </thead>
            <tbody>
              {EDIT_ORDER.map((k) => {
                const row = shown.drivers.find((d) => d.inputKey === k);
                const field = DRIVER_FIELDS[k];
                if (!row || !field) return null;
                const id = `in-${k.replace(/\./g, '-')}`;
                return (
                  <tr key={k}>
                    <th
                      scope="row"
                      style={{
                        background: 'transparent',
                        fontSize: 13,
                        color: 'var(--text-primary)',
                        fontWeight: 500,
                      }}
                    >
                      {readOnly ? row.name : <label htmlFor={id}>{row.name}</label>}
                    </th>
                    <td>
                      <DriverInput
                        row={row}
                        field={field}
                        value={values[k] ?? row.value}
                        committedValue={committedValues[k]}
                        onChange={(d) => {
                          if (d !== null) onValue(k, d);
                        }}
                        onBlur={onBlur}
                        readOnly={readOnly}
                      />
                    </td>
                    <td>
                      <span className="as-row" style={{ gap: 6 }}>
                        <KindTag kind={row.kind} detail={row.basis.owner?.displayName} small />
                        {k === 'adoption_rate.base' && adoption?.openDispute ? (
                          <a href="#dispute" className="as-flag">
                            <Icon name="message" size={12} />
                            <span>Disputed</span>
                          </a>
                        ) : null}
                        {k === 'adoption_rate.base' && canDispute && !adoption?.openDispute ? (
                          <button
                            type="button"
                            className="as-link-btn"
                            style={{ fontSize: 12 }}
                            onClick={onDispute}
                          >
                            Dispute
                          </button>
                        ) : null}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>{row.basis.text}</td>
                  </tr>
                );
              })}
              {reach ? (
                <tr>
                  <th
                    scope="row"
                    style={{
                      background: 'transparent',
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      fontWeight: 500,
                    }}
                  >
                    {reach.name}
                  </th>
                  <td className="gos-mono" style={{ fontSize: 13 }}>
                    {formatCount(Number(reach.value))} sites
                  </td>
                  <td>
                    <KindTag kind={reach.kind} detail={reach.basis.owner?.displayName} small />
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>
                    <Link
                      to="../sizing?input=input.reachable_pool&view=lineage"
                      relative="path"
                      className="gos-link"
                    >
                      {reach.basis.text}
                    </Link>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Scenario table
// ---------------------------------------------------------------------------

function ScenarioTable({
  result,
  snapshot,
  drivers,
  readOnly,
  onLineage,
}: {
  result: EconomicsOutput | null;
  snapshot: EconomicsOutput | null;
  drivers: LedgerRow[];
  readOnly: boolean;
  onLineage: (node: string) => void;
}) {
  const cap = capacityOf(drivers);
  const downsideOwner = drivers.find((d) => d.inputKey === 'adoption_rate.downside')?.basis.owner
    ?.displayName;
  const unavailable = !result || result.scenarios.length === 0;
  return (
    <section aria-labelledby="sc" className="as-section">
      <SectionHeader
        id="sc"
        title="Scenarios"
        subtitle="Conditional cases with named changes — not probabilities. Steady state at end of year 3 · EUR · 2026 prices."
        right={<KindTag kind="scenario" detail="Year 3" />}
      />
      <Card>
        <div className="gos-table-scroll">
          <table
            className="gos-table"
            aria-label="Scenario table"
            style={{ minWidth: 720, tableLayout: 'fixed' }}
          >
            <thead>
              <tr>
                <th scope="col" style={{ width: '34%' }}>
                  Measure
                </th>
                {SCENARIOS.map((s) => (
                  <th key={s} scope="col" className="gos-num" style={{ width: '22%' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        gap: 6,
                        alignItems: 'center',
                        color: 'var(--text-primary)',
                        fontWeight: 600,
                      }}
                    >
                      <ScenarioMark scenario={s} />
                      <span className="gos-sr-only">{MARK[s]} </span>
                      {SCENARIO_LABELS[s]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MEASURES.map((m) => (
                <tr key={m.key}>
                  <th
                    scope="row"
                    style={{
                      background: 'transparent',
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      fontWeight: 500,
                      whiteSpace: 'normal',
                    }}
                  >
                    {m.label}
                    <span className="as-formula-sub">{m.formula}</span>
                    {m.key === 'after' ? (
                      <button
                        type="button"
                        className="as-link-btn"
                        style={{ fontSize: 12 }}
                        onClick={() => onLineage('economics.base.contribution_after_opex')}
                      >
                        Lineage
                      </button>
                    ) : null}
                  </th>
                  {SCENARIOS.map((s) => {
                    const cell = scenarioOf(result, s);
                    const snap = scenarioOf(snapshot, s);
                    if (unavailable || !cell) {
                      return (
                        <td key={s} className="gos-num as-muted">
                          Not available
                        </td>
                      );
                    }
                    const recalc =
                      !readOnly &&
                      snapshot !== null &&
                      differs(rawCell(cell, m.key), snap ? rawCell(snap, m.key) : undefined);
                    return (
                      <td
                        key={s}
                        className={recalc ? 'gos-num as-recalc' : 'gos-num'}
                        style={m.strong ? { fontWeight: 600 } : undefined}
                        data-recalculated={recalc || undefined}
                      >
                        {cellText(cell, m.key, cap)}
                        {recalc ? <span className="as-recalc-tag">Recalculated</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <th
                  scope="row"
                  style={{
                    background: 'transparent',
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    fontWeight: 500,
                  }}
                >
                  What changes vs Base
                </th>
                {SCENARIOS.map((s) => {
                  const cell = scenarioOf(result, s);
                  const text =
                    s === 'base' || !cell
                      ? '—'
                      : [
                          ...cell.whatChangesVsBase,
                          ...(s === 'downside' && downsideOwner ? [`${downsideOwner}’s position`] : []),
                        ].join(' · ') || '—';
                  return (
                    <td key={s} style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      <p className="as-note">
        Revenue in €m with one decimal · gross contribution in €m with two · opex and after-opex in €k.
        {readOnly ? '' : ' Cells marked Recalculated differ from the committed snapshot.'}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Money cards
// ---------------------------------------------------------------------------

function MoneyCards({
  result,
  scenario,
  values,
}: {
  result: EconomicsOutput | null;
  scenario: Scenario;
  values: Values;
}) {
  const sc = scenarioOf(result, scenario);
  const once = result?.oneTimeInvestment;
  const margin = values['gross_margin'];
  const after = sc
    ? formatContributionK(sc.contributionAfterOpex.amount, sc.contributionAfterOpex.currency)
    : null;
  return (
    <section aria-labelledby="mc" className="as-section">
      <SectionHeader id="mc" title="Recurring and one-time money" subtitle="Different time bases" />
      <div className="as-money-pair">
        <div className="as-money-card" role="group" aria-label="Recurring money">
          <div className="gos-eyebrow">Recurring · per year · steady state · {SCENARIO_LABELS[scenario]}</div>
          {sc ? (
            <dl className="as-dl as-dl--money">
              <dt>Annual revenue</dt>
              <dd>{formatScenarioRevenue(sc.annualRevenue.amount, sc.annualRevenue.currency)}/year</dd>
              <dt>Gross contribution{margin ? ` · ${formatRate(margin)} margin` : ''}</dt>
              <dd>
                {formatGrossContribution(sc.grossContribution.amount, sc.grossContribution.currency)}/year
              </dd>
              <dt>Contribution after incremental opex</dt>
              <dd>{after?.includes('break-even') ? after : `${after}/year`}</dd>
            </dl>
          ) : (
            <p className="as-muted" style={{ margin: 0 }}>
              {formatNotAvailable('recurring inputs are blocked')}
            </p>
          )}
        </div>
        <div className="as-divider" role="separator" aria-label="Different time bases. Do not add.">
          <span className="as-divider__line" />
          <Icon name="x" size={14} />
          <span className="as-divider__title">Do not add</span>
          <span>Different time bases</span>
          <span className="as-divider__line" />
        </div>
        <div className="as-money-card as-money-card--once" role="group" aria-label="One-time money">
          <div className="gos-eyebrow">One-time</div>
          <div className="as-money-big">
            {once && 'amount' in once
              ? formatOneTime(once.amount, once.currency)
              : (once?.reason ?? formatNotAvailable('not calculated'))}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>
            Scale-entry investment · only relevant at G3 · not part of the pilot
          </div>
        </div>
      </div>
      <div className="as-grid-cards" style={{ marginTop: 12 }}>
        <div className="as-box as-box--dashed" aria-disabled="true" role="group" aria-label="Cash flow">
          <div
            className="as-row"
            style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13.5, gap: 6 }}
          >
            <Icon name="lock" size={14} />
            Cash flow
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {result?.cashFlow.reason ?? formatNotAvailable('needs inputs below')}
          </div>
        </div>
        <div className="as-box as-box--dashed" aria-disabled="true" role="group" aria-label="Payback">
          <div
            className="as-row"
            style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13.5, gap: 6 }}
          >
            <Icon name="lock" size={14} />
            Payback
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {result?.payback.reason ?? formatNotAvailable('needs inputs below')}
          </div>
        </div>
        <div className="as-box">
          <div className="gos-eyebrow">Missing inputs</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: '20px' }}>
            {(result?.cashFlow.missingInputs ?? []).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      </div>
      <div
        className="as-box"
        style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}
      >
        <span style={{ color: 'var(--text-secondary)', display: 'inline-flex' }}>
          <Icon name="info" size={15} />
        </span>
        <span>
          <b style={{ fontWeight: 600 }}>Exclusions</b> · {result?.exclusionsText}
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Aside: what must be true, customers chart, finance review, dispute thread
// ---------------------------------------------------------------------------

function WhatMustBeTrue({
  result,
  values,
  version,
}: {
  result: EconomicsOutput | null;
  values: Values;
  version: EconomicsVersion;
}) {
  const be = result?.breakEven;
  const base = scenarioOf(result, 'base');
  const cap = values['capacity'] ? Number(values['capacity']) : null;
  const share = be && be.customers !== null ? shareOfPool(be.customers, values['reachable_pool']) : null;
  return (
    <aside
      aria-labelledby="wmbt"
      className="as-box"
      style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <h2 id="wmbt" style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
        What must be true?
      </h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
        Working back from a target contribution after opex of €0k (break-even):
      </p>
      <div className="as-formula-box">
        {be?.formulaText}
        <br />= {breakEvenWorking(version, values)}
        <br />={' '}
        <b style={{ color: 'var(--text-primary)' }}>
          {be && be.customers !== null ? `${formatCount(be.customers)} customers` : 'Not available'}
        </b>
      </div>
      <p role="status" style={{ margin: 0, fontSize: 13 }}>
        {!be || be.customers === null
          ? formatNotAvailable('price × margin is zero or an input is blocked.')
          : `Break-even needs ${formatCount(be.customers)} customers${share ? `, ${share} of the reachable pool` : ''}${
              cap !== null && be.customers > cap
                ? `, which is above capacity ${formatCount(cap)}.`
                : base
                  ? `. Base is ${formatCount(base.customers)}.`
                  : '.'
            }`}
      </p>
    </aside>
  );
}

function CustomersChart({ result, drivers }: { result: EconomicsOutput | null; drivers: LedgerRow[] }) {
  const cap = capacityOf(drivers) ?? 0;
  const pts = SCENARIOS.map((s) => ({ s, n: scenarioOf(result, s)?.customers ?? null }));
  const max = Math.max(160, Math.ceil((cap * 4) / 3), ...pts.map((p) => p.n ?? 0));
  const x = (c: number) => Math.round(10 + (Math.min(c, max) / max) * 280);
  const aria = pts.every((p) => p.n !== null)
    ? `Downside ${pts[0]!.n}, Base ${pts[1]!.n}, Upside ${pts[2]!.n} customers; capacity ${cap}`
    : 'Customers by scenario are not available';
  return (
    <section aria-labelledby="ch" className="as-box" style={{ padding: '14px 16px' }}>
      <h2 id="ch" style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>
        Customers by scenario
      </h2>
      <ChartTable<{ s: Scenario; n: number | null }>
        caption={`Count at end of year 3 · capacity line ${formatCount(cap)}`}
        chart={
          <svg className="as-chart" role="img" aria-label={aria} viewBox="0 0 300 92">
            <line className="as-chart__axis" x1="10" y1="50" x2="290" y2="50" />
            <line className="as-chart__cap" x1={x(cap)} y1="14" x2={x(cap)} y2="62" strokeWidth="2" />
            <text className="as-chart__cap-label" x={x(cap)} y="10" fontSize="10" textAnchor="middle">
              Capacity {formatCount(cap)}
            </text>
            {pts.map((p, i) =>
              p.n === null ? null : (
                <g key={p.s}>
                  <circle className={`as-sc--${p.s}`} cx={x(p.n)} cy="50" r={p.s === 'base' ? 6 : 5} />
                  <text x={x(p.n)} y={[76, 88, 34][i]} fontSize="10" textAnchor="middle">
                    {MARK[p.s]} {formatCount(p.n)}
                  </text>
                </g>
              ),
            )}
          </svg>
        }
        table={{
          ariaLabel: 'Customers by scenario',
          minWidth: 200,
          rowKey: (r) => r.s,
          rowHeader: 'scenario',
          rows: pts,
          columns: [
            { key: 'scenario', header: 'Scenario', cell: (r) => `${MARK[r.s]} ${SCENARIO_LABELS[r.s]}` },
            {
              key: 'customers',
              header: 'Customers',
              numeric: true,
              cell: (r) => (r.n === null ? 'Not available' : formatCount(r.n)),
            },
          ],
        }}
      />
    </section>
  );
}

function fmtDay(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Berlin',
  }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
}

function DisputeThread({
  assumption,
  viewerId,
  caseKey,
}: {
  assumption: Assumption;
  viewerId: string | null;
  caseKey: string;
}) {
  const d = assumption.openDispute!;
  const [reply, setReply] = useState('');
  const send = useCommand(API.assumptions.replyToChallenge, { onSuccess: () => setReply('') });
  return (
    <section id="dispute" aria-labelledby="dispute-h" className="as-box" style={{ padding: '14px 16px' }}>
      <h2 id="dispute-h" style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
        Dispute · {assumption.name}
      </h2>
      <div className="as-thread" style={{ marginTop: 8 }}>
        <div className="as-row" style={{ gap: 8 }}>
          <Avatar initials={d.raisedBy.initials} size={22} />
          <span className="as-flag">
            <Icon name="message" size={13} />
            <span className="as-flag__text">Disputed by {d.raisedBy.displayName}</span>
          </span>
          <span className="as-faint" style={{ fontSize: 12 }}>
            {fmtDay(d.createdAt)}
          </span>
        </div>
        <blockquote>“{d.statement}”</blockquote>
        {d.proposedValue ? (
          <div style={{ fontSize: 13 }}>
            <span className="as-faint">Proposed</span> {d.proposedValue}
          </div>
        ) : null}
        {d.replies.map((r) => (
          <div key={r.id} className="as-thread__reply">
            <b style={{ fontWeight: 600 }}>{r.author.displayName}</b>{' '}
            <span className="as-faint">· {fmtDay(r.createdAt)}</span>
            <div>{r.body}</div>
          </div>
        ))}
        {viewerId ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (reply.trim()) send.mutate({ params: { id: d.id }, body: { body: reply.trim() } });
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <TextAreaField label="Reply in thread" value={reply} onChange={setReply} rows={2} />
            <div className="as-row">
              <Button
                variant="secondary"
                type="submit"
                disabled={!reply.trim() || send.isPending}
                disabledReason={!reply.trim() ? 'Write a reply first' : 'Sending…'}
              >
                Reply
              </Button>
              <Link
                className="gos-link"
                style={{ fontSize: 12.5 }}
                to={`/me/cases/${caseKey}/validation?assumption=${assumption.key}`}
              >
                Open in register
              </Link>
            </div>
            {send.error ? <ProblemBanner error={send.error} /> : null}
          </form>
        ) : null}
      </div>
    </section>
  );
}

function DisputeForm({
  assumption,
  onDone,
  onCancel,
}: {
  assumption: Assumption;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [statement, setStatement] = useState('');
  const [proposed, setProposed] = useState('');
  const pid = useId();
  const cmd = useCommand(API.assumptions.dispute, { onSuccess: onDone });
  return (
    <form
      className="as-inline-form"
      aria-label={`Dispute ${assumption.name}`}
      style={{ marginTop: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!statement.trim()) return;
        cmd.mutate({
          params: { id: assumption.id },
          body: { statement: statement.trim(), proposedValueText: proposed.trim() || null },
        });
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600 }}>
        Dispute · {assumption.name} <span className="as-faint">· owner {assumption.owner.displayName}</span>
      </div>
      <TextAreaField
        label="Why do you dispute this value? In your own words"
        value={statement}
        onChange={setStatement}
        required
        rows={3}
      />
      <label className="gos-field" htmlFor={pid}>
        <span>
          Proposed value <span className="gos-field__hint">(optional, e.g. “Downside adoption 10%”)</span>
        </span>
        <input
          id={pid}
          className="gos-input"
          value={proposed}
          onChange={(e) => setProposed(e.target.value)}
        />
      </label>
      <p className="as-note" style={{ marginTop: 0 }}>
        The dispute stays open until resolved with a reason and is carried into every decision package.
      </p>
      <div className="as-row">
        <Button
          variant="primary"
          type="submit"
          tone="dark"
          disabled={!statement.trim() || cmd.isPending}
          disabledReason={!statement.trim() ? 'A statement is required' : 'Recording…'}
        >
          Record dispute
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {cmd.error ? <ProblemBanner error={cmd.error} /> : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function EconomicsScreen() {
  const { caseKey = '' } = useParams();
  const [sp, patch] = useParamPatch();
  const qc = useQueryClient();
  const viewer = useViewer();
  const viewerId = viewer.data?.person.id ?? null;
  const q = useApiQuery(API.economics.get, { params: { caseRef: caseKey } });
  const register = useApiQuery(API.assumptions.list, { params: { caseRef: caseKey } });
  const [disputing, setDisputing] = useState(false);
  const versionParam = sp.get('version');
  const scenarioParam = sp.get('scenario');
  const scenario: Scenario =
    scenarioParam === 'downside' || scenarioParam === 'upside' || scenarioParam === 'base'
      ? scenarioParam
      : 'base';
  const lineageNode = sp.get('view') === 'lineage' ? sp.get('input') : null;

  const data = q.data;
  const draftV = data?.draft ?? null;
  const current = data?.current ?? null;
  // The view carries the latest committed snapshot; `version` pins the read-only view of it.
  const pinned = current && versionParam === String(current.version) ? current.version : null;

  const server: Versioned<Values> | undefined = useMemo(
    () => (draftV ? { value: valuesOf(draftV.drivers), rowVersion: draftV.rowVersion } : undefined),
    [draftV],
  );
  const draft = useDraft<Values>({
    storageKey:
      draftV && viewer.data ? `${viewer.data.tenant.id}:economics:${caseKey}:v${draftV.version}` : null,
    server,
    save: async (value, rowVersion) => {
      const body = {
        drivers: EDIT_ORDER.filter((k) => value[k] !== undefined).map((k) => ({
          inputKey: k,
          value: value[k]!,
        })),
      };
      const view = await api(API.economics.saveDraft, {
        params: { caseRef: caseKey },
        body,
        ifMatch: rowVersion,
      });
      qc.setQueryData(queryKey(API.economics.get, { caseRef: caseKey }, undefined), view);
      return { value: valuesOf(view.draft!.drivers), rowVersion: view.draft!.rowVersion };
    },
    reload: async () => {
      const view = await api(API.economics.get, { params: { caseRef: caseKey } });
      return view.draft
        ? { value: valuesOf(view.draft.drivers), rowVersion: view.draft.rowVersion }
        : undefined;
    },
  });
  usePublishAutosave(pinned === null && draftV ? draft.status : null);

  const local = useLocalResult(draftV, draft.value);
  const commit = useCommand(API.economics.commit);
  const finance = useCommand(API.economics.requestFinanceReview);

  if (q.isPending) {
    return (
      <div className="as-page" aria-busy="true">
        <Skeleton height={240} />
        <Skeleton height={200} />
      </div>
    );
  }
  if (q.error || !data) {
    return (
      <div className="as-page">
        <ProblemBanner error={q.error} />
      </div>
    );
  }

  const readOnly = pinned !== null || !draftV;
  const shown: EconomicsVersion | null = readOnly ? current : draftV;
  if (!shown) {
    return (
      <div className="as-page">
        <h2 className="gos-sr-only">Economics</h2>
        <Banner
          tone="neutral"
          title="No economics yet"
          body="Commit sizing first; economics starts from the committed ladder."
        />
      </div>
    );
  }
  const values: Values = readOnly ? valuesOf(shown.drivers) : (draft.value ?? valuesOf(shown.drivers));
  const result: EconomicsOutput | null = readOnly ? shown.result : (local ?? shown.result);
  const snapshotResult = current?.result ?? null;
  const adoption = register.data?.items.find((a) => a.inputKey === 'adoption_rate.base');
  const canDispute = !!viewerId && !!adoption && adoption.owner.id !== viewerId;
  const changed =
    !readOnly && EDIT_ORDER.some((k) => current && differs(values[k], valuesOf(current.drivers)[k]));
  const blocking = result?.checks.filter((c) => c.blocking) ?? [];
  const capped = result?.checks.filter((c) => c.key === 'CAPACITY_CAP_APPLIED') ?? [];

  return (
    <div className="as-page">
      <h2 className="gos-sr-only">Economics</h2>
      {data.versions.length ? (
        <div className="as-row">
          <span className="as-muted" style={{ fontSize: 12.5 }}>
            Showing
          </span>
          <SegmentedControl
            ariaLabel="Economics version"
            value={pinned !== null ? String(pinned) : 'draft'}
            onChange={(v) => patch({ version: v === 'draft' ? null : v })}
            options={[
              ...(draftV ? [{ value: 'draft', label: `Draft v${draftV.version}` }] : []),
              ...(current ? [{ value: String(current.version), label: `Snapshot v${current.version}` }] : []),
            ]}
          />
        </div>
      ) : null}
      {readOnly && current ? (
        <Banner
          tone="neutral"
          title={`Snapshot v${current.version} · committed${current.committedAt ? ` ${fmtDay(current.committedAt)}` : ''} · read-only`}
          body="The approved snapshot never recalculates. Edits happen in the draft."
          live={false}
        />
      ) : null}
      {blocking.length ? (
        <Banner
          tone="warn"
          title="Recommendation incomplete"
          body={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {blocking.map((c) => (
                <li key={`${c.key}-${c.inputKeys.join()}`}>{c.message}</li>
              ))}
            </ul>
          }
        />
      ) : null}
      {draft.conflict ? (
        <Banner
          tone="warn"
          title="Changed elsewhere"
          body="Someone saved this draft after you opened it."
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
      <div className="as-split">
        <div className="as-main">
          <Drivers
            shown={shown}
            values={values}
            committed={current}
            readOnly={readOnly}
            onValue={(k, v) => draft.set((prev) => ({ ...prev, [k]: v }))}
            onBlur={() => void draft.flush()}
            onReset={() => current && draft.set(() => valuesOf(current.drivers))}
            adoption={adoption}
            canDispute={canDispute}
            onDispute={() => setDisputing(true)}
          />
          {disputing && adoption && !adoption.openDispute ? (
            <DisputeForm
              assumption={adoption}
              onCancel={() => setDisputing(false)}
              onDone={() => setDisputing(false)}
            />
          ) : null}
          <ScenarioTable
            result={result}
            snapshot={snapshotResult}
            drivers={shown.drivers.map((d) => ({ ...d, value: values[d.inputKey] ?? d.value }))}
            readOnly={readOnly}
            onLineage={(node) => patch({ input: node, view: 'lineage' })}
          />
          {capped.length ? (
            <p className="as-note" role="note">
              {capped.map((c) => c.message).join(' ')}
            </p>
          ) : null}
          <MoneyCards result={result} scenario={scenario} values={values} />
          <div className="as-actions">
            <Button
              variant="secondary"
              icon="send"
              disabled={!current || finance.isPending || finance.isSuccess}
              disabledReason={
                finance.isSuccess
                  ? 'Finance review requested'
                  : !current
                    ? 'Commit a snapshot first'
                    : 'Sending…'
              }
              onClick={() =>
                current &&
                finance.mutate({
                  params: { caseRef: caseKey },
                  body: {
                    economicsVersion: current.version,
                    reviewerId: data.financeReview?.reviewer.id ?? viewerId!,
                    dueOn: data.financeReview?.dueOn ?? null,
                  },
                })
              }
            >
              Request finance review
            </Button>
            {!readOnly && draftV ? (
              <Button
                variant="primary"
                onClick={async () => {
                  await draft.flush();
                  commit.mutate({ params: { caseRef: caseKey } });
                }}
                disabled={!changed || blocking.length > 0 || commit.isPending}
                disabledReason={
                  blocking.length
                    ? 'Blocked: recommendation incomplete.'
                    : !changed
                      ? `No changes from snapshot v${current?.version ?? ''}.`
                      : 'Creating snapshot…'
                }
              >
                {`Create snapshot v${draftV.version}`}
              </Button>
            ) : null}
            <a
              className="gos-btn gos-btn--secondary"
              href={buildPath(
                API.economics.export,
                { caseRef: caseKey },
                { format: 'csv', version: readOnly ? shown.version : 'draft' },
              )}
              download
            >
              <Icon name="download" size={15} />
              Export with formulas
            </a>
          </div>
          {commit.error ? <ProblemBanner error={commit.error} /> : null}
          {commit.isSuccess ? (
            <Banner
              tone="ok"
              title={`Snapshot v${commit.data.version} created`}
              body="It is frozen; edits continue in a new draft."
            />
          ) : null}
        </div>
        <div className="as-aside">
          <WhatMustBeTrue result={result} values={values} version={shown} />
          <CustomersChart
            result={result}
            drivers={shown.drivers.map((d) => ({ ...d, value: values[d.inputKey] ?? d.value }))}
          />
          {data.financeReview ? (
            <aside
              aria-label="Finance review"
              className="as-box"
              style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <div className="as-row" style={{ gap: 8 }}>
                <Avatar initials={data.financeReview.reviewer.initials} size={24} />
                <div style={{ lineHeight: '17px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    Finance review · {data.financeReview.reviewer.displayName}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Requested {fmtDay(data.financeReview.requestedAt)}
                    {data.financeReview.dueOn ? ` · due ${fmtDay(data.financeReview.dueOn)}` : ''}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 12.5 }}>
                <div className="as-faint" style={{ fontWeight: 500 }}>
                  Checked so far
                </div>
                {data.financeReview.checkedItems.join(' · ') || 'Nothing yet'}
              </div>
              <div style={{ fontSize: 12.5 }}>
                <div className="as-faint" style={{ fontWeight: 500 }}>
                  Not checked
                </div>
                {data.financeReview.notCheckedItems.join(' · ') || '—'}
              </div>
              {adoption?.openDispute &&
              adoption.openDispute.raisedBy.id === data.financeReview.reviewer.id ? (
                <a href="#dispute" className="as-flag" style={{ fontSize: 12.5 }}>
                  <Icon name="message" size={13} />
                  <span>Disputes {formatRate(adoption.current.value ?? '0')} adoption · open thread</span>
                </a>
              ) : null}
            </aside>
          ) : null}
          {adoption?.openDispute ? (
            <DisputeThread assumption={adoption} viewerId={viewerId} caseKey={caseKey} />
          ) : null}
        </div>
      </div>
      {lineageNode ? (
        <LineageDrawer
          caseRef={caseKey}
          model="economics"
          nodeKey={lineageNode}
          version={readOnly ? shown.version : 'draft'}
          onClose={() => patch({ input: null, view: null })}
        />
      ) : null}
    </div>
  );
}
