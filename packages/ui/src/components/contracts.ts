/**
 * FROZEN component prop contracts for the shared design system (FRONTEND.md §5).
 * WS7 implements the components; screen streams (WS8a–d) build against these props from day one.
 * Each component maps to a prototype helper in design/market-expansion/generator/common.py or
 * components.py (noted per interface).
 */
import type { ReactNode } from 'react';
import type {
  AssumptionStatus,
  CaseStage,
  ConditionFlag,
  ConditionStatus,
  ConnectorStatus,
  EpistemicKind,
  EvidenceFreshness,
  EvidenceQuality,
  ExperimentResultDisplay,
  GateCode,
  GateStatus,
  LedgerKind,
  OpportunityStatus,
  ReviewStatus,
  ReviewerPosition,
  RunStatus,
  Scenario,
  Sensitivity,
  SyncStatus,
} from '@growth-os/contracts';

/** common.py kind() — epistemic tag: glyph + label + line style. `detail` e.g. "Maya Rao", "Base · Year 3". */
export interface KindTagProps {
  kind: EpistemicKind | LedgerKind;
  detail?: string;
  small?: boolean;
}
/** common.py ai()/proposed() — AI provenance badge, shown beside (never instead of) the kind. */
export interface AiBadgeProps {
  variant: 'draft' | 'proposed' | 'accepted';
  acceptedBy?: string;
}
/** common.py diamond()/gate_chip() — gate glyph family. */
export interface GateDiamondProps {
  status: GateStatus;
  size?: 14 | 15 | 16;
  label?: string;
}
export interface GateChipProps {
  status: GateStatus;
  text?: string;
}
/** common.py stage() — case stage pill (On hold = warning pause; Stopped/Closed = neutral stop). */
export interface StagePillProps {
  stage: CaseStage;
}
/** common.py result() — threshold result with target glyph. */
export interface ResultGlyphProps {
  result: ExperimentResultDisplay;
  extra?: string;
}
/** common.py astatus() */
export interface AssumptionStatusProps {
  status: AssumptionStatus;
  detail?: string;
}
/** common.py sync() — "Confirmed · PIL-11" only with a key. */
export interface SyncStatusProps {
  status: SyncStatus;
  externalKey?: string | null;
  error?: string | null;
}
/** common.py conn() */
export interface ConnectorStatusProps {
  status: ConnectorStatus;
}
/** common.py fresh() */
export interface FreshnessProps {
  freshness: EvidenceFreshness;
  detail?: string;
}
/** common.py run() — analysis strip status; role=status live region. */
export interface RunStatusProps {
  status: RunStatus;
  detail?: string;
}
/** common.py review() — feasibility/sign-off status. */
export interface ReviewStatusProps {
  status: ReviewStatus | 'signed_scoped' | 'disagreement';
  extra?: string;
}
/** common.py evq() — evidence quality shield. */
export interface EvidenceQualityProps {
  quality: EvidenceQuality;
}
/** common.py sens() — three-bar sensitivity. */
export interface SensitivityProps {
  level: Sensitivity;
}
/** common.py opp() */
export interface OpportunityTagProps {
  status: OpportunityStatus;
}
/** common.py src() — source chip linking to S13. */
export interface SourceChipProps {
  label: string;
  quality: EvidenceQuality;
  href: string;
  restricted?: boolean;
}
/** common.py sc_mark() — ▼ ● ▲ marker; shape carries identity, colour is third cue. */
export interface ScenarioMarkProps {
  scenario: Scenario;
  size?: number;
}
/** common.py cat_mark() */
export interface CategoricalMarkProps {
  index: 1 | 2 | 3 | 4;
}
/** common.py person()/avatar() */
export interface PersonProps {
  name: string;
  initials: string;
  subtitle?: string;
  size?: 22 | 28;
}

/** common.py btn() — primary/secondary/ghost/decision. Decision buttons must carry scoped labels. */
export interface ButtonProps {
  variant: 'primary' | 'secondary' | 'ghost' | 'decision';
  children: ReactNode;
  icon?: string; // lucide icon name
  disabled?: boolean;
  /** Required when disabled: the reason is rendered (never a silent disabled button). */
  disabledReason?: string;
  onClick?: () => void;
  href?: string;
  ariaLabel?: string;
}
/** common.py banner() */
export interface BannerProps {
  tone: 'warn' | 'danger' | 'info' | 'ok' | 'neutral' | 'lock';
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
  live?: boolean;
}
/** common.py table() + TanStack Table — numeric columns right-aligned with tabular figures. */
export interface DataTableColumn<Row> {
  key: string;
  header: string;
  numeric?: boolean;
  cell: (row: Row) => ReactNode;
}
export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  ariaLabel: string;
  minWidth?: number;
  rowKey: (row: Row) => string;
}
/** common.py seg() */
export interface SegmentedControlProps<V extends string> {
  ariaLabel: string;
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
}

/** common.py shell() — sidebar, app switcher, header, illustrative-data bar. */
export interface AppShellProps {
  activeNav: string;
  counts?: Record<string, number>;
  illustrative: boolean;
  autosave?: AutosaveState;
  children: ReactNode;
}
export type AutosaveState =
  | { state: 'saved'; at: string }
  | { state: 'saving' }
  | { state: 'unsaved' }
  | { state: 'error'; message: string }
  | { state: 'conflict' };
/** common.py case_header() + rail() + next_block() */
export interface CaseHeaderProps {
  caseRef: string;
  activeTab: CaseTab;
}
export type CaseTab =
  | 'thesis'
  | 'sizing'
  | 'feasibility'
  | 'economics'
  | 'validation'
  | 'decisions'
  | 'pilot'
  | 'outcomes'
  | 'history';
export interface GateRailProps {
  currentSegment: 'mandate' | 'discovery_assessment' | 'validation' | 'pilot_review' | 'scale';
  nodes: { gateCode: GateCode; status: GateStatus; caption: string }[];
  flag?: 'on_hold' | 'stopped';
}
/** components.py auth_boxes() — "What this authorizes" / "What this does not authorize". */
export interface AuthBoxesProps {
  authorizes: string[];
  doesNotAuthorize: string[];
}
/** components.py condition() */
export interface ConditionItemProps {
  conditionKey: string;
  text: string;
  owner: string;
  due: string;
  flag: ConditionFlag;
  status: ConditionStatus;
}
/** Approval panel (S10): version + fingerprint, authority, boxes, chain, scoped actions. */
export interface ApprovalPanelProps {
  gateRequestId: string;
  snapshotId: string;
  snapshotHash: string;
}
/** Reviewer positions table (research §6.12). */
export interface ReviewerPositionsProps {
  rows: { reviewer: string; role: string; position: ReviewerPosition; scope: string; version: string }[];
}
/** Measure ladder (research §6.1): rows narrow by sites first, money second. No total row. */
export interface MeasureLadderProps {
  caseRef: string;
  version: number | 'draft';
  onSelectNode: (nodeKey: string) => void;
}
/** Cohort table with signed overlap row and blocking checks (research §6.2). */
export interface CohortTableProps {
  caseRef: string;
  version: number | 'draft';
  editable: boolean;
}
/** Input ledger (research §6.3). */
export interface InputLedgerProps {
  caseRef: string;
  model: 'sizing' | 'economics';
  version: number | 'draft';
  editable: boolean;
  onSelectInput: (inputKey: string) => void;
}
/** Lineage drawer: formula, inputs (one level), used by, history, recalc in draft. */
export interface LineageDrawerProps {
  caseRef: string;
  model: 'sizing' | 'economics';
  nodeKey: string;
  version: number | 'draft';
  onClose: () => void;
}
/** Scenario table: Downside · Base · Upside, equal widths, "What changes" row, cap labels. */
export interface ScenarioTableProps {
  caseRef: string;
  version: number | 'draft';
}
/** Money card pair: recurring vs one-time with "Do not add" divider; disabled cash-flow card. */
export interface MoneyCardPairProps {
  caseRef: string;
  version: number | 'draft';
}
/** Experiment card: plan (locked) · decision rule · result · amendments with original struck through. */
export interface ExperimentCardProps {
  experimentId: string;
}
/** Budget meter: Approved · Committed · Spent · Remaining. */
export interface BudgetMeterProps {
  caseRef: string;
}
/** Analysis strip: run status in business copy; never a percentage. */
export interface AnalysisStripProps {
  caseRef: string;
  runId?: string;
}
/** Evidence drawer (shared), owner picker, review panel, activity timeline (PRD §7 shared components). */
export interface EvidenceDrawerProps {
  sourceRef: string;
  onClose: () => void;
}
export interface OwnerPickerProps {
  value: string | null;
  onChange: (userId: string) => void;
  required?: boolean;
  label: string;
}
export interface ReviewPanelProps {
  reviewRequestId: string;
}
export interface ActivityTimelineProps {
  caseRef: string;
  keyOnly?: boolean;
}
