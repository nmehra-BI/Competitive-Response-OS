/**
 * Ledger family: formula row (components.py formula), measure-ladder row (ladder_row) with its
 * narrowing connector, input-ledger table and the lineage drawer (research §6.3, §10.7).
 * No total rows and no money bars: market measures are never added up the ladder.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { EvidenceQuality, LedgerKind, LineageNode } from '@growth-os/contracts';
import { formatCount, formatExact, formatRate } from '../format/format';
import { Icon, UiLink } from './Icon';
import { DataTable, IconButton, Mono, Skeleton } from './primitives';
import { EvidenceQualityTag, KindTag } from './status';

/** components.py formula(): `LHS = expression` then `→ result`. */
export function FormulaRow({ lhs, expr, result }: { lhs: string; expr: string; result: ReactNode }) {
  return (
    <div className="gos-formula" role="group" aria-label={`Formula for ${lhs}`}>
      <div>
        <span className="gos-formula__lhs">{lhs}</span> <span className="gos-formula__op">=</span>{' '}
        <span className="gos-formula__expr">{expr}</span>
      </div>
      <div>
        <span className="gos-formula__op" aria-hidden="true">
          →
        </span>{' '}
        <span className="gos-sr-only">result </span>
        <b className="gos-formula__result">{result}</b>
      </div>
    </div>
  );
}

export interface MeasureLadderRowProps {
  /** "TAM", "SAM", "Reachable pool", "SOM". */
  name: string;
  meaning: string;
  /** Formatted site count, e.g. "2,000 unique sites". */
  sites: ReactNode;
  /** Formatted money with its unit, e.g. "€40m/year", or "—" when the measure has none. */
  money: ReactNode;
  kinds: ReactNode;
  /** Open the lineage drawer for this row. */
  onLineage?: () => void;
  lineageHref?: string;
  selected?: boolean;
}

/** components.py ladder_row(): name · definition · sites · money with unit · kind tags · lineage. */
export function MeasureLadderRow({
  name,
  meaning,
  sites,
  money,
  kinds,
  onLineage,
  lineageHref,
  selected,
}: MeasureLadderRowProps) {
  const id = useId();
  return (
    <div
      className={selected ? 'gos-ladder-row gos-ladder-row--selected' : 'gos-ladder-row'}
      role="group"
      aria-labelledby={id}
      data-measure={name}
    >
      <h3 id={id} className="gos-ladder-row__name">
        {name}
      </h3>
      <div className="gos-ladder-row__meaning">{meaning}</div>
      <div className="gos-ladder-row__sites">{sites}</div>
      <div className="gos-ladder-row__money">{money}</div>
      <div className="gos-ladder-row__kinds">
        {kinds}
        {onLineage ? (
          <button
            type="button"
            className="gos-link gos-ladder-row__lineage"
            onClick={onLineage}
            aria-label={`Lineage for ${name}`}
          >
            Lineage
          </button>
        ) : lineageHref ? (
          <UiLink
            href={lineageHref}
            className="gos-link gos-ladder-row__lineage"
            aria-label={`Lineage for ${name}`}
          >
            Lineage
          </UiLink>
        ) : null}
      </div>
    </div>
  );
}

/** components.py connector(): the narrowing step between two ladder rows (decorative; text is read). */
export function LadderConnector({ text }: { text: string }) {
  return (
    <div className="gos-ladder-connector">
      <span className="gos-ladder-connector__line" aria-hidden="true" />
      <Icon name="chevd" size={12} />
      <span>{text}</span>
    </div>
  );
}

export interface InputLedgerRow {
  inputKey: string;
  label: string;
  /** Exact value with unit, e.g. "€20,000/year". */
  valueText: string;
  kind: LedgerKind;
  basis: string;
  quality: EvidenceQuality | null;
  version: string;
  usedBy: string;
}

/** Input ledger (research §6.3): name · value + unit · kind · basis · quality · version · used by. */
export function InputLedgerTable({
  rows,
  ariaLabel = 'Input ledger',
  onSelectInput,
}: {
  rows: InputLedgerRow[];
  ariaLabel?: string;
  onSelectInput?: (inputKey: string) => void;
}) {
  return (
    <DataTable
      ariaLabel={ariaLabel}
      minWidth={760}
      rows={rows}
      rowKey={(r) => r.inputKey}
      rowHeader="input"
      columns={[
        {
          key: 'input',
          header: 'Input',
          cell: (r) =>
            onSelectInput ? (
              <button
                type="button"
                className="gos-link gos-ladder-row__lineage"
                style={{ fontSize: 13 }}
                onClick={() => onSelectInput(r.inputKey)}
              >
                {r.label}
              </button>
            ) : (
              r.label
            ),
        },
        {
          key: 'value',
          header: 'Value',
          numeric: true,
          cell: (r) => (
            <Mono size={13} strong>
              {r.valueText}
            </Mono>
          ),
        },
        { key: 'kind', header: 'Kind', cell: (r) => <KindTag kind={r.kind} small /> },
        { key: 'basis', header: 'Basis', cell: (r) => r.basis },
        {
          key: 'quality',
          header: 'Quality',
          cell: (r) => (r.quality ? <EvidenceQualityTag quality={r.quality} /> : '—'),
        },
        { key: 'version', header: 'Version', cell: (r) => <Mono>{r.version}</Mono> },
        { key: 'usedBy', header: 'Used by', cell: (r) => r.usedBy },
      ]}
    />
  );
}

/** Exact display of a lineage value (ledger rule: exact values on demand). Missing is "Unknown". */
export function formatLineageValue(node: Pick<LineageNode, 'value' | 'unit'>, currency = 'EUR'): string {
  if (node.value === null) return 'Unknown';
  switch (node.unit) {
    case 'sites':
    case 'companies':
    case 'customers':
    case 'interviews':
    case 'commitments':
      return `${formatCount(Number(node.value))} ${node.unit}`;
    case 'rate':
      return formatRate(node.value);
    case 'currency_per_year':
      return `${formatExact(node.value, currency)}/year`;
    case 'currency_per_year_per_site':
      return `${formatExact(node.value, currency)}/year per site`;
    case 'currency_one_time':
      return `${formatExact(node.value, currency)} one-time`;
    case 'hours_per_site':
      return `${node.value} hours per site`;
    default:
      return node.value;
  }
}

export interface LineageDrawerViewProps {
  title: string;
  onClose: () => void;
  loading?: boolean;
  error?: ReactNode;
  node?: LineageNode;
  inputs?: LineageNode[];
  usedBy?: { label: string; href: string }[];
  history?: { at: string; text: string }[];
  exactValue?: string | null;
  engineLabel?: string;
  currency?: string;
  /** Draft mode: values recalculate on the server; changed cells are flagged by the screen. */
  draft?: boolean;
  onSelectInput?: (nodeKey: string) => void;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

/** "13 Oct 2026, 16:30" for an ISO date-time; anything else is shown as given. */
function whenText(at: string): string {
  const d = new Date(at);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(d.getTime())) return at;
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Lineage drawer: formula, inputs one level deep, used by, history, engine label. A modal dialog
 * that traps focus, closes on Escape and restores focus to the trigger.
 */
export function LineageDrawerView({
  title,
  onClose,
  loading,
  error,
  node,
  inputs = [],
  usedBy = [],
  history = [],
  exactValue,
  engineLabel,
  currency = 'EUR',
  draft,
  onSelectInput,
}: LineageDrawerViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => prev?.focus?.();
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <>
      <div className="gos-drawer-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        className="gos-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <div className="gos-drawer__head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="gos-eyebrow">Lineage{draft ? ' · draft' : ''}</div>
            <h2 id={titleId} className="gos-drawer__title">
              {title}
            </h2>
          </div>
          <IconButton icon="x" ariaLabel="Close lineage" onClick={onClose} />
        </div>
        <div className="gos-drawer__body">
          {loading ? (
            <>
              <Skeleton height={20} width="60%" />
              <Skeleton height={56} />
              <Skeleton height={120} />
            </>
          ) : error ? (
            error
          ) : node ? (
            <>
              <section className="gos-drawer__section" aria-label="Value">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <KindTag kind={node.kind === 'scenario' ? 'scenario' : node.kind} small />
                  <span className="gos-mono" style={{ fontSize: 16, fontWeight: 600 }}>
                    {exactValue ?? formatLineageValue(node, currency)}
                  </span>
                </div>
                {node.dependsOnAssumptionCount > 0 ? (
                  <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    Depends on {node.dependsOnAssumptionCount} assumption
                    {node.dependsOnAssumptionCount > 1 ? 's' : ''}
                  </p>
                ) : null}
              </section>
              {node.formulaText ? (
                <section className="gos-drawer__section">
                  <h3>Formula</h3>
                  <FormulaRow
                    lhs={node.label}
                    expr={node.formulaText}
                    result={node.formulaWithValues ?? exactValue ?? ''}
                  />
                </section>
              ) : null}
              {inputs.length ? (
                <section className="gos-drawer__section">
                  <h3>Inputs · one level</h3>
                  <ul className="gos-list-plain">
                    {inputs.map((i) => (
                      <li key={i.nodeKey} className="gos-lineage-input">
                        <span className="gos-lineage-input__label">
                          {onSelectInput && i.inputs.length ? (
                            <button
                              type="button"
                              className="gos-link gos-ladder-row__lineage"
                              style={{ fontSize: 13 }}
                              onClick={() => onSelectInput(i.nodeKey)}
                            >
                              {i.label}
                            </button>
                          ) : (
                            i.label
                          )}
                        </span>
                        <KindTag kind={i.kind === 'scenario' ? 'scenario' : i.kind} small />
                        <span className="gos-lineage-input__value">{formatLineageValue(i, currency)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {!loading && node ? (
                <section className="gos-drawer__section">
                  <h3>Used by</h3>
                  {usedBy.length ? (
                    <ul className="gos-list-plain" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {usedBy.map((u) => (
                        <li key={u.href}>
                          <UiLink href={u.href} className="gos-chip">
                            {u.label}
                          </UiLink>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                      No other calculated figure uses this value.
                    </p>
                  )}
                </section>
              ) : null}
              {history.length ? (
                <section className="gos-drawer__section">
                  <h3>History</h3>
                  <ul className="gos-activity">
                    {history.map((h) => (
                      <li key={`${h.at}-${h.text}`} className="gos-activity__item">
                        <span
                          className="gos-activity__body gos-activity__detail"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {h.text}
                        </span>
                        <time className="gos-activity__when" dateTime={h.at}>
                          {whenText(h.at)}
                        </time>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {engineLabel ? (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>{engineLabel}</p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
