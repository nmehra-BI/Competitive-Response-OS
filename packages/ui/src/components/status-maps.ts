/**
 * Status grammars (research §7.2, §7.5). One grammar per dimension: glyph + text + colour, in that
 * order of importance. Labels always come from the contracts `*_LABELS` maps; this file only adds
 * the glyph and the tone (ported from common.py: RES, AST, SYNC, CONN, FRESH, RUN, REV, EVQ, DIA).
 */
import type {
  AssumptionStatus,
  CaseStage,
  ConditionStatus,
  ConnectorStatus,
  CrossCheckResult,
  EvidenceFreshness,
  EvidenceQuality,
  ExperimentResultDisplay,
  GateStatus,
  ReviewerPosition,
  RunStatus,
  SyncStatus,
  TaskStatus,
} from '@growth-os/contracts';
import type { IconName } from './icon-paths';

/** Foreground colour tokens (CSS custom properties). */
export type Fg =
  | 'var(--success-fg)'
  | 'var(--warning-fg)'
  | 'var(--danger-fg)'
  | 'var(--info-fg)'
  | 'var(--neutral-fg)'
  | 'var(--text-tertiary)'
  | 'var(--accent)'
  | 'var(--text-secondary)';

const OK: Fg = 'var(--success-fg)';
const WARN: Fg = 'var(--warning-fg)';
const DANGER: Fg = 'var(--danger-fg)';
const INFO: Fg = 'var(--info-fg)';
const NEUTRAL: Fg = 'var(--neutral-fg)';
const T3: Fg = 'var(--text-tertiary)';
const T2: Fg = 'var(--text-secondary)';
const ACC: Fg = 'var(--accent)';

export interface Glyph {
  icon: IconName;
  fg: Fg;
}

/** common.py DIA — colour per gate status. The diamond shape is drawn by GateDiamond. */
export const GATE_STATUS_FG: Record<GateStatus, Fg> = {
  not_started: T3,
  preconditions_open: T2,
  ready_to_submit: ACC,
  awaiting_decision: INFO,
  approved: OK,
  approved_with_conditions: OK,
  returned_for_revision: WARN,
  blocked: WARN,
  not_approved: NEUTRAL,
  invalidated: DANGER,
  expired: DANGER,
  superseded: T3,
};

export const RESULT_GLYPH: Record<ExperimentResultDisplay, Glyph> = {
  met: { icon: 'targetcheck', fg: OK },
  not_met: { icon: 'targetdash', fg: NEUTRAL },
  inconclusive: { icon: 'targetq', fg: WARN },
  planned: { icon: 'dashcircle', fg: NEUTRAL },
  running: { icon: 'progress', fg: INFO },
  too_early_to_read: { icon: 'clock', fg: NEUTRAL },
  amended: { icon: 'history', fg: WARN },
};

export const ASSUMPTION_STATUS_DOT: Record<AssumptionStatus, Fg> = {
  untested: NEUTRAL,
  testing: INFO,
  supported: OK,
  contradicted: DANGER,
  inconclusive: WARN,
  retired: T3,
};

export const SYNC_GLYPH: Record<SyncStatus, Glyph> = {
  not_sent: { icon: 'link', fg: NEUTRAL },
  in_preview: { icon: 'eye', fg: INFO },
  sending: { icon: 'progress', fg: INFO },
  confirmed: { icon: 'link', fg: OK },
  failed: { icon: 'xcircle', fg: DANGER },
  retry_scheduled: { icon: 'refresh', fg: WARN },
  checking: { icon: 'progress', fg: INFO },
  paused_approval_changed: { icon: 'pause', fg: WARN },
  paused_connector: { icon: 'pause', fg: WARN },
};

export const CONNECTOR_GLYPH: Record<ConnectorStatus, Glyph> = {
  connected: { icon: 'plug', fg: OK },
  expired: { icon: 'clock', fg: WARN },
  missing_permission: { icon: 'lock', fg: WARN },
  unavailable: { icon: 'unplug', fg: DANGER },
};

export const FRESHNESS_GLYPH: Record<EvidenceFreshness, Glyph> = {
  current: { icon: 'clock', fg: OK },
  ageing: { icon: 'clock', fg: WARN },
  stale: { icon: 'alert', fg: WARN },
  superseded: { icon: 'history', fg: T3 },
};

export const RUN_GLYPH: Record<RunStatus, Glyph> = {
  queued: { icon: 'dashcircle', fg: NEUTRAL },
  running: { icon: 'progress', fg: INFO },
  waiting_for_input: { icon: 'alert', fg: WARN },
  awaiting_approval: { icon: 'alert', fg: WARN },
  partial: { icon: 'halfcircle', fg: WARN },
  completed: { icon: 'checkcircle', fg: OK },
  failed: { icon: 'squarestop', fg: NEUTRAL },
  cancelled: { icon: 'squarestop', fg: NEUTRAL },
};

export type ReviewDisplay =
  'pending' | 'in_review' | 'signed' | 'declined' | 'signed_scoped' | 'disagreement';
export const REVIEW_GLYPH: Record<ReviewDisplay, Glyph> = {
  signed: { icon: 'checkcircle', fg: OK },
  signed_scoped: { icon: 'checkcircle', fg: OK },
  pending: { icon: 'dashcircle', fg: NEUTRAL },
  in_review: { icon: 'halfcircle', fg: INFO },
  declined: { icon: 'alert', fg: WARN },
  disagreement: { icon: 'message', fg: WARN },
};
/** The two display-only review states named by the frozen ReviewStatusProps contract. */
export const REVIEW_EXTRA_LABELS = {
  signed_scoped: 'Signed · pilot scope',
  disagreement: 'Disagreement',
} as const;

export const QUALITY_GLYPH: Record<EvidenceQuality, { icon: IconName; tone: Tone }> = {
  strong: { icon: 'shieldcheck', tone: 'ok' },
  some: { icon: 'shieldhalf', tone: 'warn' },
  weak: { icon: 'shielddash', tone: 'neutral' },
  none: { icon: 'shielddash', tone: 'neutral' },
  conflicting: { icon: 'shieldalert', tone: 'danger' },
};

export const POSITION_GLYPH: Record<ReviewerPosition, Glyph> = {
  supports: { icon: 'checkcircle', fg: OK },
  supports_with_conditions: { icon: 'checkcircle', fg: OK },
  accepts_ownership: { icon: 'checkcircle', fg: OK },
  dissents: { icon: 'message', fg: WARN },
  abstains: { icon: 'dashcircle', fg: NEUTRAL },
  not_yet_reviewed: { icon: 'dashcircle', fg: NEUTRAL },
};

export const CONDITION_STATUS_GLYPH: Record<ConditionStatus, Glyph> = {
  open: { icon: 'dashcircle', fg: T2 },
  met: { icon: 'checkcircle', fg: OK },
  waived: { icon: 'minus', fg: NEUTRAL },
};

export const TASK_STATUS_GLYPH: Record<TaskStatus, Glyph> = {
  not_started: { icon: 'dashcircle', fg: NEUTRAL },
  in_progress: { icon: 'progress', fg: INFO },
  blocked: { icon: 'alert', fg: WARN },
  done: { icon: 'checkcircle', fg: OK },
};

export const CROSS_CHECK_GLYPH: Record<CrossCheckResult, Glyph> = {
  within_range: { icon: 'checkcircle', fg: OK },
  outside_range: { icon: 'alert', fg: WARN },
  not_available: { icon: 'dashcircle', fg: NEUTRAL },
};

export type Tone = 'acc' | 'ok' | 'warn' | 'neutral' | 'danger' | 'info' | 'lock';

/** common.py stage(): On hold = warning pause; Stopped/Closed = neutral stop; Draft = neutral dot. */
export const STAGE_TONE: Record<CaseStage, { tone: Tone; icon?: IconName }> = {
  draft_mandate: { tone: 'neutral' },
  discovery: { tone: 'acc' },
  assessment: { tone: 'acc' },
  validation: { tone: 'acc' },
  pilot_approval_pending: { tone: 'acc' },
  pilot_approved: { tone: 'acc' },
  pilot_running: { tone: 'acc' },
  review_due: { tone: 'acc' },
  scale_approval_pending: { tone: 'acc' },
  scaling: { tone: 'acc' },
  closed: { tone: 'neutral', icon: 'squarestop' },
  on_hold: { tone: 'warn', icon: 'pause' },
  stopped: { tone: 'neutral', icon: 'squarestop' },
};

/** Foreground token per tone (for glyphs that sit on a neutral surface). */
export const TONE_FG: Record<Tone, string> = {
  acc: 'var(--accent)',
  ok: 'var(--success-fg)',
  warn: 'var(--warning-fg)',
  neutral: 'var(--neutral-fg)',
  danger: 'var(--danger-fg)',
  info: 'var(--info-fg)',
  lock: 'var(--restricted-fg)',
};
