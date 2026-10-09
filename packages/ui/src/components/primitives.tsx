/**
 * Primitives ported from common.py: avatar(), person(), btn(), ibtn(), card(), h2(), eyebrow(),
 * kbd(), mono(), banner(), seg(), table() — plus the restricted value, autosave indicator, the
 * illustrative-data ribbon and the chart/table toggle (research §10.6).
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import type {
  AutosaveState,
  BannerProps,
  ButtonProps,
  DataTableProps,
  PersonProps,
  SegmentedControlProps,
} from './contracts';
import { Icon, UiLink, type IconName } from './Icon';
import { ICON_PATHS } from './icon-paths';

/** Map a lucide icon name (contracts use lucide names) to the ported path set. */
const LUCIDE_ALIASES: Record<string, IconName> = {
  'file-text': 'filetext',
  'pencil-ruler': 'pencilruler',
  'git-branch': 'branch',
  sparkles: 'sparkle',
  'circle-dashed': 'dashcircle',
  'layout-dashboard': 'dashboard',
  'square-check': 'checksq',
  'arrow-right': 'arrowr',
  'chevron-right': 'chevr',
  'chevron-down': 'chevd',
  'refresh-cw': 'refresh',
  'external-link': 'ext',
  'check-circle': 'checkcircle',
  'x-circle': 'xcircle',
  'alert-triangle': 'alert',
};
export function toIconName(name: string | undefined): IconName | undefined {
  if (!name) return undefined;
  if (name in ICON_PATHS) return name as IconName;
  return LUCIDE_ALIASES[name];
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export function Avatar({ initials, size = 28 }: { initials: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="gos-avatar"
      style={{ width: size, height: size, fontSize: size > 24 ? 11 : 10 }}
    >
      {initials}
    </span>
  );
}

/** common.py person(): avatar + name + optional subtitle. */
export function Person({ name, initials, subtitle, size = 22 }: PersonProps) {
  return (
    <span className="gos-person">
      <Avatar initials={initials} size={size} />
      <span className="gos-person__text">
        <span className="gos-person__name">{name}</span>
        {subtitle ? <span className="gos-person__sub">{subtitle}</span> : null}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export interface ButtonViewProps extends ButtonProps {
  type?: 'button' | 'submit';
  block?: boolean;
  /** Dark style for consequential non-approve decisions (common.py btn kind "d"). */
  tone?: 'default' | 'dark';
  describedBy?: string;
}

const BARE_DECISION = /^(approve|reject|decline|ok|yes|confirm)$/i;

/**
 * common.py btn(). Disabled buttons always render their reason next to them (never a silent
 * disabled button). Decision buttons must carry a scoped label such as
 * "Approve pilot €120k · 90 days" — a bare "Approve" is refused in development.
 */
export function Button({
  variant,
  children,
  icon,
  disabled,
  disabledReason,
  onClick,
  href,
  ariaLabel,
  type = 'button',
  block,
  tone = 'default',
  describedBy,
}: ButtonViewProps) {
  const reasonId = useId();
  if (variant === 'decision' && typeof children === 'string' && BARE_DECISION.test(children.trim())) {
    throw new Error(`Decision buttons need a scoped label, not "${children}" (research §6.12).`);
  }
  const iconName = toIconName(icon);
  const cls = [
    'gos-btn',
    `gos-btn--${variant}`,
    tone === 'dark' && variant !== 'primary' && variant !== 'decision' ? 'gos-btn--dark' : '',
    block ? 'gos-btn--block' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const content = (
    <>
      {iconName ? <Icon name={iconName} size={15} /> : null}
      {children}
    </>
  );
  if (href && !disabled) {
    return (
      <UiLink href={href} className={cls} aria-label={ariaLabel}>
        {content}
      </UiLink>
    );
  }
  const describe = [disabled && disabledReason ? reasonId : '', describedBy ?? ''].filter(Boolean).join(' ');
  const button = (
    <button
      type={type}
      className={cls}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={describe || undefined}
    >
      {content}
    </button>
  );
  if (!disabled || !disabledReason) return button;
  return (
    <span className={block ? 'gos-btn-wrap gos-btn-wrap--block' : 'gos-btn-wrap'}>
      {button}
      <span id={reasonId} className="gos-btn__reason">
        {disabledReason}
      </span>
    </span>
  );
}

/** common.py ibtn(): icon-only button; the accessible name is required. */
export function IconButton({
  icon,
  ariaLabel,
  onClick,
  pressed,
  expanded,
  controls,
}: {
  icon: IconName;
  ariaLabel: string;
  onClick?: () => void;
  pressed?: boolean;
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button
      type="button"
      className="gos-ibtn"
      aria-label={ariaLabel}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Card({
  children,
  padded,
  className,
  as: Tag = 'div',
  ariaLabel,
}: {
  children: ReactNode;
  padded?: boolean;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'aside';
  ariaLabel?: string;
}) {
  return (
    <Tag
      className={['gos-card', padded ? 'gos-card--pad' : '', className ?? ''].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
    >
      {children}
    </Tag>
  );
}

/** common.py h2(): section title with optional subtitle and right-aligned actions. */
export function SectionHeader({
  title,
  subtitle,
  right,
  id,
  level = 2,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  id?: string;
  level?: 2 | 3;
}) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <div className="gos-h2">
      <div className="gos-h2__text">
        <H id={id}>{title}</H>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="gos-eyebrow">{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="gos-kbd">{children}</kbd>;
}

/** IDs, versions, fingerprints, task keys and ledger figures. */
export function Mono({
  children,
  size = 12.5,
  strong,
}: {
  children: ReactNode;
  size?: number;
  strong?: boolean;
}) {
  return (
    <span
      className="gos-mono"
      style={{ fontSize: size, color: strong ? 'var(--text-primary)' : 'var(--text-secondary)' }}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="gos-empty">
      <h3>{title}</h3>
      {children ? <div>{children}</div> : null}
      {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  );
}

/** Layout-stable loading placeholder (no invented percentages). */
export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: number | string }) {
  return <span aria-hidden="true" className="gos-skeleton" style={{ display: 'block', height, width }} />;
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

const BANNER: Record<BannerProps['tone'], { icon: IconName; fg: string; bg: string }> = {
  warn: { icon: 'alert', fg: 'var(--warning-fg)', bg: 'var(--warning-bg)' },
  danger: { icon: 'xcircle', fg: 'var(--danger-fg)', bg: 'var(--danger-bg)' },
  info: { icon: 'info', fg: 'var(--info-fg)', bg: 'var(--info-bg)' },
  ok: { icon: 'checkcircle', fg: 'var(--success-fg)', bg: 'var(--success-bg)' },
  neutral: { icon: 'info', fg: 'var(--neutral-fg)', bg: 'var(--neutral-bg)' },
  lock: { icon: 'lock', fg: 'var(--restricted-fg)', bg: 'var(--restricted-bg)' },
};

/** common.py banner(): warn / danger / info / ok / neutral / lock. Live by default (role=status). */
export function Banner({ tone, title, body, actions, live = true }: BannerProps) {
  const b = BANNER[tone];
  return (
    <div
      className="gos-banner"
      role={live ? 'status' : undefined}
      style={{ background: b.bg, borderColor: b.bg }}
      data-tone={tone}
    >
      <span className="gos-banner__icon" style={{ color: b.fg }}>
        <Icon name={b.icon} size={16} />
      </span>
      <div className="gos-banner__text">
        <div className="gos-banner__title" style={{ color: b.fg }}>
          {title}
        </div>
        {body ? <div className="gos-banner__body">{body}</div> : null}
      </div>
      {actions ? <div className="gos-banner__actions">{actions}</div> : null}
    </div>
  );
}

export const ILLUSTRATIVE_TITLE = 'Illustrative data — synthetic';

/** The "Illustrative data — synthetic" ribbon shown on every page of an illustrative tenant. */
export function IllustrativeDataBar({
  tenantName = 'Aster Industrial Systems',
  moment,
}: {
  tenantName?: string;
  moment?: string;
}) {
  return (
    <div role="note" aria-label="Illustrative data notice" className="gos-ribbon">
      <span className="gos-ribbon__title">
        <Icon name="info" size={13} />
        {ILLUSTRATIVE_TITLE}
      </span>
      <span>{tenantName} sample workspace · fictional people and figures · no live systems connected</span>
      {moment ? (
        <span className="gos-ribbon__item">
          <Icon name="clock" size={13} />
          {moment}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Restricted value
// ---------------------------------------------------------------------------

/**
 * A value the viewer may not see. It takes no value prop on purpose: restricted content never
 * reaches the component (never-rule 8), so it cannot leak through a tooltip or an attribute.
 */
export function RestrictedValue({
  detail,
  onRequestAccess,
}: {
  detail?: string;
  onRequestAccess?: () => void;
}) {
  return (
    <span className="gos-status" style={{ gap: 8 }}>
      <span className="gos-restricted" data-status="Restricted">
        <Icon name="lock" size={13} />
        Restricted
      </span>
      {detail ? <span className="gos-status__extra">{detail}</span> : null}
      {onRequestAccess ? (
        <button type="button" className="gos-link gos-ladder-row__lineage" onClick={onRequestAccess}>
          Request access
        </button>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Autosave indicator
// ---------------------------------------------------------------------------

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Header save status (FRONTEND §6): "Saving…", "Saved · 2 min ago", "Unsaved changes — retry", "Changed elsewhere". */
export function AutosaveStatus({ state, onRetry }: { state: AutosaveState; onRetry?: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (state.state !== 'saved') return undefined;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [state.state]);
  const view: { icon: IconName; fg: string; text: string } = (() => {
    switch (state.state) {
      case 'saved':
        return { icon: 'checkcircle', fg: 'var(--success-fg)', text: `Saved · ${relativeTime(state.at)}` };
      case 'saving':
        return { icon: 'progress', fg: 'var(--info-fg)', text: 'Saving…' };
      case 'unsaved':
        return { icon: 'alert', fg: 'var(--warning-fg)', text: 'Unsaved changes — retry' };
      case 'error':
        return { icon: 'xcircle', fg: 'var(--danger-fg)', text: `Not saved — ${state.message}` };
      case 'conflict':
        return { icon: 'alert', fg: 'var(--warning-fg)', text: 'Changed elsewhere' };
    }
  })();
  return (
    <span className="gos-autosave" role="status" aria-live="polite" data-autosave={state.state}>
      <span style={{ color: view.fg, display: 'inline-flex' }}>
        <Icon name={view.icon} size={14} />
      </span>
      {view.text}
      {onRetry && (state.state === 'unsaved' || state.state === 'error') ? (
        <button type="button" className="gos-link gos-ladder-row__lineage" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Segmented control, table, chart/table toggle
// ---------------------------------------------------------------------------

/** common.py seg(): a group of toggle buttons (aria-pressed). */
export function SegmentedControl<V extends string>({
  ariaLabel,
  value,
  options,
  onChange,
}: SegmentedControlProps<V>) {
  return (
    <div role="group" aria-label={ariaLabel} className="gos-seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="gos-seg__btn"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** common.py table(): numeric columns right-aligned with tabular figures; scoped headers. */
export function DataTable<Row>({
  columns,
  rows,
  ariaLabel,
  minWidth = 640,
  rowKey,
  caption,
  rowHeader,
}: DataTableProps<Row> & { caption?: string; rowHeader?: string }) {
  return (
    <div className="gos-table-scroll">
      <table className="gos-table" aria-label={caption ? undefined : ariaLabel} style={{ minWidth }}>
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'gos-num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) =>
                c.key === rowHeader ? (
                  <th
                    key={c.key}
                    scope="row"
                    style={{
                      background: 'transparent',
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      fontWeight: 500,
                      whiteSpace: 'normal',
                    }}
                  >
                    {c.cell(r)}
                  </th>
                ) : (
                  <td key={c.key} className={c.numeric ? 'gos-num' : undefined}>
                    {c.cell(r)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every chart has a Table toggle and a visible caption with unit, year and currency
 * (research §10.6). The table is the accessible equivalent of the chart.
 */
export function ChartTable<Row>({
  caption,
  chart,
  table,
  defaultView = 'chart',
}: {
  caption: string;
  chart: ReactNode;
  table: DataTableProps<Row> & { rowHeader?: string };
  defaultView?: 'chart' | 'table';
}) {
  const [view, setView] = useState<'chart' | 'table'>(defaultView);
  const capId = useId();
  return (
    <figure className="gos-figure" aria-labelledby={capId}>
      <div className="gos-figure__head">
        <figcaption id={capId} className="gos-figure__caption">
          {caption}
        </figcaption>
        <SegmentedControl
          ariaLabel="Show as"
          value={view}
          onChange={setView}
          options={[
            { value: 'chart', label: 'Chart' },
            { value: 'table', label: 'Table' },
          ]}
        />
      </div>
      {view === 'chart' ? chart : <DataTable {...table} />}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export function TextAreaField({
  label,
  value,
  onChange,
  required,
  hint,
  rows = 3,
  error,
  id,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  hint?: string;
  rows?: number;
  error?: string;
  id?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  const errId = `${fid}-err`;
  return (
    <label className="gos-field" htmlFor={fid}>
      <span>
        {label}
        {required ? ' (required)' : hint ? <span className="gos-field__hint"> ({hint})</span> : null}
      </span>
      <textarea
        id={fid}
        className="gos-textarea"
        rows={rows}
        value={value}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <span id={errId} className="gos-field__error">
          {error}
        </span>
      ) : null}
    </label>
  );
}
