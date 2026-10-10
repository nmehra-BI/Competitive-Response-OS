/**
 * Status vocabularies (research §7.2). Every status renders glyph + text; colour is the third cue
 * and is never the only carrier of meaning (WCAG 1.4.1). Labels come from contracts `*_LABELS`.
 */
import type { ReactNode } from 'react';
import {
  ASSUMPTION_STATUS_LABELS,
  CASE_STAGE_LABELS,
  CONDITION_FLAG_LABELS,
  CONDITION_STATUS_LABELS,
  CONNECTOR_STATUS_LABELS,
  CROSS_CHECK_RESULT_LABELS,
  EPISTEMIC_KIND_LABELS,
  EVIDENCE_FRESHNESS_LABELS,
  EVIDENCE_QUALITY_LABELS,
  EXPERIMENT_RESULT_LABELS,
  GATE_STATUS_LABELS,
  LEDGER_KIND_LABELS,
  OPPORTUNITY_STATUS_LABELS,
  REVIEWER_POSITION_LABELS,
  REVIEW_STATUS_LABELS,
  RUN_STATUS_LABELS,
  SCENARIO_LABELS,
  SENSITIVITY_LABELS,
  SYNC_STATUS_LABELS,
  TASK_STATUS_LABELS,
  type ConditionFlag,
  type ConditionStatus,
  type CrossCheckResult,
  type ReviewerPosition,
  type Scenario,
  type TaskStatus,
} from '@growth-os/contracts';
import type {
  AiBadgeProps,
  AssumptionStatusProps,
  CategoricalMarkProps,
  ConnectorStatusProps,
  EvidenceQualityProps,
  FreshnessProps,
  GateChipProps,
  GateDiamondProps,
  KindTagProps,
  OpportunityTagProps,
  ResultGlyphProps,
  ReviewStatusProps,
  RunStatusProps,
  ScenarioMarkProps,
  SensitivityProps,
  SourceChipProps,
  StagePillProps,
  SyncStatusProps,
} from './contracts';
import { Icon, UiLink, type IconName } from './Icon';
import {
  ASSUMPTION_STATUS_DOT,
  CONDITION_STATUS_GLYPH,
  CONNECTOR_GLYPH,
  CROSS_CHECK_GLYPH,
  FRESHNESS_GLYPH,
  GATE_STATUS_FG,
  POSITION_GLYPH,
  QUALITY_GLYPH,
  RESULT_GLYPH,
  REVIEW_EXTRA_LABELS,
  REVIEW_GLYPH,
  RUN_GLYPH,
  STAGE_TONE,
  SYNC_GLYPH,
  TASK_STATUS_GLYPH,
  TONE_FG,
  type Fg,
  type Tone,
} from './status-maps';

/** Shared glyph + label row. `tinted` colours the label too (sync, as in the prototype). */
function StatusText({
  icon,
  fg,
  label,
  extra,
  strong,
  tinted,
  iconSize = 14,
  role,
  sep = ' · ',
}: {
  icon: IconName;
  fg: Fg;
  label: string;
  extra?: ReactNode;
  strong?: boolean;
  tinted?: boolean;
  iconSize?: number;
  role?: 'status';
  sep?: string;
}) {
  return (
    <span
      className={strong ? 'gos-status gos-status--strong' : 'gos-status'}
      style={{ color: fg }}
      role={role}
      data-status={label}
    >
      <Icon name={icon} size={iconSize} />
      <span className={tinted ? 'gos-status__label gos-status__label--tinted' : 'gos-status__label'}>
        {label}
      </span>
      {extra ? (
        <span className="gos-status__extra">
          {sep}
          {extra}
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Epistemic kinds and AI provenance
// ---------------------------------------------------------------------------

const KIND_ICON: Record<KindTagProps['kind'], IconName> = {
  evidence: 'filetext',
  assumption: 'pencilruler',
  scenario: 'branch',
  actual: 'flag',
  unknown: 'dashcircle',
  inference_ai: 'sparkle',
  calculated: 'sigma',
};

/** common.py kind(): Evidence solid · Assumption dashed · Scenario dotted · Actual bold. */
export function KindTag({ kind, detail, small }: KindTagProps) {
  const label =
    kind === 'calculated'
      ? LEDGER_KIND_LABELS.calculated
      : EPISTEMIC_KIND_LABELS[kind as keyof typeof EPISTEMIC_KIND_LABELS];
  return (
    <span className={`gos-kind gos-kind--${kind}${small ? ' gos-kind--small' : ''}`} data-kind={kind}>
      <Icon name={KIND_ICON[kind]} size={12} />
      {label}
      {detail ? <span className="gos-kind__detail">· {detail}</span> : null}
    </span>
  );
}

/** common.py ai()/proposed(): shown beside, never instead of, the kind tag. */
export function AiBadge({ variant, acceptedBy }: AiBadgeProps) {
  const text =
    variant === 'proposed'
      ? 'Proposed · AI'
      : variant === 'accepted'
        ? `AI draft · accepted${acceptedBy ? ` by ${acceptedBy}` : ''}`
        : EPISTEMIC_KIND_LABELS.inference_ai;
  return (
    <span className={variant === 'accepted' ? 'gos-ai gos-ai--accepted' : 'gos-ai'}>
      <Icon name="sparkle" size={12} />
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

const DIAMOND = 'M12 2.5 21.5 12 12 21.5 2.5 12Z';

/** common.py diamond(): one glyph family for every gate status (research §10.4). */
export function GateDiamond({ status, size = 16, label }: GateDiamondProps) {
  const filled = status === 'approved' || status === 'approved_with_conditions';
  const inner: ReactNode = (() => {
    switch (status) {
      case 'approved':
        return <path d="m8.3 12 2.6 2.6 4.8-5" style={{ stroke: 'var(--bg-surface)' }} strokeWidth={2} />;
      case 'approved_with_conditions':
        return (
          <>
            <path d="m8.3 12 2.6 2.6 4.8-5" style={{ stroke: 'var(--bg-surface)' }} strokeWidth={2} />
            <circle
              cx="20.2"
              cy="4"
              r="3"
              fill="currentColor"
              style={{ stroke: 'var(--bg-surface)' }}
              strokeWidth={1.4}
            />
          </>
        );
      case 'awaiting_decision':
        return <path d="M12 2.5 2.5 12 12 21.5Z" fill="currentColor" stroke="none" />;
      case 'returned_for_revision':
        return (
          <>
            <path d="M14.5 14.5v-1.5a2 2 0 0 0-2-2H9" />
            <path d="m10.5 9-1.8 2 1.8 2" />
          </>
        );
      case 'blocked':
        return <path d="M8 12h8" strokeWidth={2.4} />;
      case 'not_approved':
        return <path d="m8 16 8-8" />;
      case 'invalidated':
      case 'expired':
        return <circle cx="12" cy="12" r="11.2" strokeWidth={1.4} />;
      case 'ready_to_submit':
        return <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />;
      default:
        return null;
    }
  })();
  return (
    <svg
      role="img"
      aria-label={label ?? GATE_STATUS_LABELS[status]}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="gos-icon"
      style={{ color: GATE_STATUS_FG[status], overflow: 'visible' }}
      opacity={status === 'superseded' ? 0.55 : undefined}
      data-gate-status={status}
      focusable="false"
    >
      <path d={DIAMOND} fill={filled ? 'currentColor' : 'none'} />
      {inner}
    </svg>
  );
}

/** common.py gate_chip(): diamond + text. The diamond is decorative here because the text names the state. */
export function GateChip({ status, text }: GateChipProps) {
  return (
    <span className="gos-gate-chip" style={{ color: GATE_STATUS_FG[status] }} data-status={status}>
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>
        <GateDiamond status={status} size={15} />
      </span>
      <span className="gos-status__label">{text ?? GATE_STATUS_LABELS[status]}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pills and tags
// ---------------------------------------------------------------------------

export function Pill({ label, tone = 'acc', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  return (
    <span className={`gos-pill gos-tone-${tone}`}>
      {icon ? <Icon name={icon} size={12} strokeWidth={2} /> : <span className="gos-pill__dot" aria-hidden />}
      {label}
    </span>
  );
}

/** common.py stage(). */
export function StagePill({ stage }: StagePillProps) {
  const { tone, icon } = STAGE_TONE[stage];
  return <Pill label={CASE_STAGE_LABELS[stage]} tone={tone} icon={icon} />;
}

/** common.py result(): Met / Not met (neutral) / Inconclusive / Too early / Amended. */
export function ResultGlyph({ result, extra }: ResultGlyphProps) {
  const g = RESULT_GLYPH[result];
  return (
    <StatusText
      icon={g.icon}
      fg={g.fg}
      label={EXPERIMENT_RESULT_LABELS[result]}
      extra={extra}
      strong
      iconSize={15}
    />
  );
}

/** common.py astatus(): ruler-pencil glyph + status dot + text. */
export function AssumptionStatusTag({ status, detail }: AssumptionStatusProps) {
  return (
    <span className="gos-status" data-status={ASSUMPTION_STATUS_LABELS[status]}>
      <span style={{ color: 'var(--kind-assumption-fg)', display: 'inline-flex' }}>
        <Icon name="pencilruler" size={14} />
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: ASSUMPTION_STATUS_DOT[status],
          flex: 'none',
        }}
      />
      <span className="gos-status__label">{ASSUMPTION_STATUS_LABELS[status]}</span>
      {detail ? <span className="gos-status__extra"> · {detail}</span> : null}
    </span>
  );
}

/**
 * common.py sync(). "Confirmed" is only ever shown with the external key (never-rule 9): a
 * confirmed status without a key renders as "Checking" until the connector returns the key.
 */
export function SyncStatusTag({ status, externalKey, error }: SyncStatusProps) {
  const effective = status === 'confirmed' && !externalKey ? 'checking' : status;
  const g = SYNC_GLYPH[effective];
  return (
    <StatusText
      icon={g.icon}
      fg={g.fg}
      label={SYNC_STATUS_LABELS[effective]}
      strong
      tinted
      extra={
        effective === 'confirmed' && externalKey ? (
          <span className="gos-mono" style={{ fontSize: 12 }}>
            {externalKey}
          </span>
        ) : error ? (
          error
        ) : undefined
      }
    />
  );
}

/** common.py conn(). */
export function ConnectorStatusTag({ status }: ConnectorStatusProps) {
  const g = CONNECTOR_GLYPH[status];
  return <StatusText icon={g.icon} fg={g.fg} label={CONNECTOR_STATUS_LABELS[status]} strong />;
}

/** common.py fresh(). */
export function Freshness({ freshness, detail }: FreshnessProps) {
  const g = FRESHNESS_GLYPH[freshness];
  return <StatusText icon={g.icon} fg={g.fg} label={EVIDENCE_FRESHNESS_LABELS[freshness]} extra={detail} />;
}

/** common.py run(): business copy, a polite live region, never a percentage. */
export function RunStatusTag({ status, detail }: RunStatusProps) {
  const g = RUN_GLYPH[status];
  return (
    <StatusText
      icon={g.icon}
      fg={g.fg}
      label={RUN_STATUS_LABELS[status]}
      extra={detail}
      role="status"
      sep=" "
    />
  );
}

/** common.py review(): sign-off status. */
export function ReviewStatusTag({ status, extra }: ReviewStatusProps) {
  const g = REVIEW_GLYPH[status];
  const label =
    status === 'signed_scoped' || status === 'disagreement'
      ? REVIEW_EXTRA_LABELS[status]
      : REVIEW_STATUS_LABELS[status];
  return <StatusText icon={g.icon} fg={g.fg} label={label} extra={extra} strong iconSize={15} />;
}

/** common.py evq(): evidence quality shield. */
export function EvidenceQualityTag({ quality }: EvidenceQualityProps) {
  const g = QUALITY_GLYPH[quality];
  return (
    <span className={`gos-tag gos-tone-${g.tone}`} data-status={EVIDENCE_QUALITY_LABELS[quality]}>
      <Icon name={g.icon} size={14} />
      {EVIDENCE_QUALITY_LABELS[quality]}
    </span>
  );
}

/** common.py sens(): three bars + text. */
export function SensitivityTag({ level }: SensitivityProps) {
  const n = level === 'high' ? 3 : level === 'medium' ? 2 : 1;
  return (
    <span
      className="gos-status"
      style={{ color: 'var(--text-primary)' }}
      data-status={SENSITIVITY_LABELS[level]}
    >
      <svg aria-hidden="true" width="15" height="14" viewBox="0 0 15 14" className="gos-icon">
        {[5, 9, 13].map((h, i) => (
          <rect
            key={h}
            x={1 + i * 5}
            y={14 - h}
            width="3"
            height={h}
            rx="0.5"
            className={i < n ? 'gos-sens-bar--on' : 'gos-sens-bar--off'}
          />
        ))}
      </svg>
      {SENSITIVITY_LABELS[level]}
    </span>
  );
}

/** common.py opp(): outlined opportunity status tag. */
export function OpportunityTag({ status }: OpportunityTagProps) {
  return (
    <span className="gos-tag gos-tag--outline" data-status={OPPORTUNITY_STATUS_LABELS[status]}>
      {OPPORTUNITY_STATUS_LABELS[status]}
    </span>
  );
}

/** common.py src(): source chip linking to S13. The restricted variant shows a lock and no detail. */
export function SourceChip({ label, quality, href, restricted }: SourceChipProps) {
  if (restricted) {
    return (
      <UiLink
        href={href}
        className="gos-chip gos-chip--restricted"
        aria-label={`${label} (restricted source)`}
      >
        <Icon name="lock" size={13} />
        {label}
      </UiLink>
    );
  }
  const g = QUALITY_GLYPH[quality];
  return (
    <UiLink
      href={href}
      className="gos-chip"
      aria-label={`${label} · evidence ${EVIDENCE_QUALITY_LABELS[quality]}`}
    >
      <span style={{ color: TONE_FG[g.tone], display: 'inline-flex' }}>
        <Icon name={g.icon} size={13} />
      </span>
      {label}
    </UiLink>
  );
}

// ---------------------------------------------------------------------------
// Marks (shape carries identity; colour is the third cue)
// ---------------------------------------------------------------------------

const SCENARIO_SHAPE: Record<Scenario, { fill: string; shape: ReactNode; glyph: string }> = {
  downside: { fill: 'var(--scenario-downside)', shape: <path d="M2 3h10L7 11Z" />, glyph: '▼' },
  base: { fill: 'var(--scenario-base)', shape: <circle cx="7" cy="7" r="4.5" />, glyph: '●' },
  upside: { fill: 'var(--scenario-upside)', shape: <path d="M2 11h10L7 3Z" />, glyph: '▲' },
};

/** common.py sc_mark(): ▼ ● ▲. Decorative; always pair with the scenario name (see ScenarioLabel). */
export function ScenarioMark({ scenario, size = 12 }: ScenarioMarkProps) {
  const s = SCENARIO_SHAPE[scenario];
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 14 14"
      className="gos-icon"
      style={{ display: 'inline-block', verticalAlign: -1 }}
      data-scenario={scenario}
      data-glyph={s.glyph}
    >
      <g style={{ fill: s.fill }}>{s.shape}</g>
    </svg>
  );
}

/** Marker + scenario name, in the fixed order Downside · Base · Upside. */
export function ScenarioLabel({ scenario, size = 12 }: ScenarioMarkProps) {
  return (
    <span className="gos-status">
      <ScenarioMark scenario={scenario} size={size} />
      {SCENARIO_LABELS[scenario]}
    </span>
  );
}

/** common.py cat_mark(): categorical swatch for up to four candidates or cohorts. Never status. */
export function CategoricalMark({ index }: CategoricalMarkProps) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 10,
        height: 10,
        borderRadius: 2,
        background: `var(--cat-${index})`,
        flex: 'none',
        display: 'inline-block',
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Other vocabularies used across screens
// ---------------------------------------------------------------------------

/** components.py condition() flag: "Blocks execution until met" vs "Monitor only". */
export function ConditionFlagTag({ flag }: { flag: ConditionFlag }) {
  const blocking = flag === 'blocks_execution';
  return (
    <span className={`gos-tag gos-tag--small gos-tone-${blocking ? 'warn' : 'neutral'}`}>
      <Icon name={blocking ? 'lockbar' : 'eye'} size={13} />
      {CONDITION_FLAG_LABELS[flag]}
    </span>
  );
}

export function ConditionStatusTag({ status }: { status: ConditionStatus }) {
  const g = CONDITION_STATUS_GLYPH[status];
  return <StatusText icon={g.icon} fg={g.fg} label={CONDITION_STATUS_LABELS[status]} iconSize={13} />;
}

export function ReviewerPositionTag({ position }: { position: ReviewerPosition }) {
  const g = POSITION_GLYPH[position];
  return <StatusText icon={g.icon} fg={g.fg} label={REVIEWER_POSITION_LABELS[position]} strong />;
}

/** Internal task status ("Done" is reserved for tasks). Separate from external sync status. */
export function TaskStatusTag({ status }: { status: TaskStatus }) {
  const g = TASK_STATUS_GLYPH[status];
  return <StatusText icon={g.icon} fg={g.fg} label={TASK_STATUS_LABELS[status]} />;
}

export function CrossCheckTag({ result }: { result: CrossCheckResult }) {
  const g = CROSS_CHECK_GLYPH[result];
  return <StatusText icon={g.icon} fg={g.fg} label={CROSS_CHECK_RESULT_LABELS[result]} />;
}
