/**
 * Mock journey state shared by the S09 Validation and S10 Decisions mocks (WS8c).
 *
 * The WS7 base mocks sit at the aster-demo moment (26 Nov: G2 v3 awaiting Elena Fischer). The
 * validate-and-decide acceptance steps (10–11, 13–14, 17–20) need earlier moments too, so this
 * module keeps the extra facts on `state.scenario.ws8c` (reset by `resetMockState()`) and offers
 * presets that place the case at a known point:
 *
 *   setScenario({ ws8cPreset: 'start' })     // before EXP-03 exists (step 10)
 *   window.__growthOsMocks.setScenario({ ws8cPreset: 'g1_approved' })
 *
 * Presets also set the WS7 base facts (`g2Stale`, `g2Decision`) so the case header follows.
 *
 * In the browser the journey state is kept in sessionStorage so it survives the full page loads
 * of a persona switch (Maya submits, Elena decides). E2E specs choose a starting moment with
 *   sessionStorage.setItem('growth-os:ws8c-preset', 'start')
 * before loading the app. Node tests never restore (no sessionStorage, or a fresh jsdom one).
 */
import type { ConditionInput, ExperimentPlan, GateDisposition, GateScope } from '@growth-os/contracts';
import { exp03, gates, people } from '@growth-os/fixtures-aster';
import { state } from '../../mocks/state';

export const WS8C_PRESETS = [
  /** No experiment yet, G1 not requested (acceptance step 10). */
  'start',
  /** 16 Oct: G1 approved, EXP-03 locked, validation tasks not sent. */
  'g1_approved',
  /** 20 Nov: results recorded, decision taken, G2 not requested yet (step 17). */
  'g2_prep',
  /** 26 Nov (default): G2 v3 awaiting Elena Fischer. */
  'demo',
  /** 26 Nov: Base adoption changed after review, v3 is stale (step 19). */
  'stale',
  /** 26 Nov: v3 refreshed to v4 after the adoption change, awaiting decision (step 20). */
  'v4',
  /** 27 Nov: v4 approved with conditions C1 (blocking) and C2 (monitor). */
  'approved',
  /** After approval: a material change invalidated the v4 approval. */
  'invalidated',
  /** After approval: the approval expired unused on 11 Dec. */
  'expired',
] as const;
export type Ws8cPreset = (typeof WS8C_PRESETS)[number];

export type TaskPhase = 'not_sent' | 'preview' | 'sending' | 'sent';

export interface AmendmentRec {
  reason: string;
  plan: Partial<ExperimentPlan>;
  at: string;
  by: string;
  afterResultsSeen: boolean;
}

export interface ResultRec {
  observations: { metricKey: string; observed: string | null }[];
  periodStart: string;
  periodEnd: string;
  sourceText: string;
  interpretation: string;
  limitations: string;
  by: string;
  at: string;
}

export interface G1Decision {
  disposition: GateDisposition;
  rationale: string;
  by: string;
  at: string;
}

export interface Ws8cState {
  preset: Ws8cPreset;
  /** EXP-03 lifecycle as far as the mocks need it. */
  exp: 'none' | 'draft' | 'locked';
  /** Plan and title captured from `experiments.create` (null → fixture EXP-03). */
  expDraft: {
    title: string;
    plan: ExperimentPlan;
    assumptionIds: string[];
    fieldworkOwnerId: string | null;
  } | null;
  g1: 'none' | 'draft' | 'awaiting' | 'approved';
  g1Scope: GateScope | null;
  g1Decision: G1Decision | null;
  /** Amendments after the plan locked (Amendment 1 = fixture window extension). */
  amendments: AmendmentRec[];
  /** Result versions, append-only (version 1 = fixture 9 interviews / 4 commitments). */
  resultVersions: ResultRec[];
  decisionTaken: { text: string; by: string; at: string } | null;
  tasks: TaskPhase;
  previewId: string | null;
  g2: 'none' | 'draft' | 'submitted' | 'withdrawn';
  g2Scope: GateScope | null;
  g2Proposed: ConditionInput[] | null;
  /** Current G2 snapshot version (3 or 4). */
  g2Version: number;
  g2Invalidated: boolean;
  g2Expired: boolean;
  adoptionVersion: number;
  disputeReplies: { authorId: string; body: string; at: string }[];
  disputeResolved: { by: string; text: string; at: string } | null;
}

type ScenarioBag = { ws8c?: Ws8cState; ws8cPreset?: Ws8cPreset; g2Stale: boolean };

const APPROVED_DECISION = {
  disposition: 'approve_with_conditions' as const,
  rationale: gates.g2.decision.rationale,
  note: null,
  by: people.elena.id,
  at: gates.g2.decision.at,
  conditions: [],
};

const FIXTURE_AMENDMENT: AmendmentRec = {
  reason: exp03.amendment1.reason,
  plan: { windowEnd: exp03.amendment1.newWindowEnd },
  at: exp03.amendment1.at,
  by: exp03.amendment1.authorId,
  afterResultsSeen: exp03.amendment1.afterResultsSeen,
};

const FIXTURE_RESULT: ResultRec = {
  observations: exp03.result.observations.map((o) => ({ metricKey: o.metricKey, observed: o.observed })),
  periodStart: exp03.result.periodStart,
  periodEnd: exp03.result.periodEnd,
  sourceText: exp03.result.sourceText,
  interpretation: exp03.result.interpretation,
  limitations: exp03.result.limitations,
  by: exp03.result.recordedBy,
  at: exp03.result.recordedAt,
};

function build(preset: Ws8cPreset): Ws8cState {
  const base: Ws8cState = {
    preset,
    exp: 'locked',
    expDraft: null,
    g1: 'approved',
    g1Scope: null,
    g1Decision: null,
    amendments: [FIXTURE_AMENDMENT],
    resultVersions: [FIXTURE_RESULT],
    decisionTaken: { ...exp03.decisionTaken },
    tasks: 'sent',
    previewId: null,
    g2: 'submitted',
    g2Scope: null,
    g2Proposed: null,
    g2Version: 3,
    g2Invalidated: false,
    g2Expired: false,
    adoptionVersion: 1,
    disputeReplies: [],
    disputeResolved: null,
  };
  switch (preset) {
    case 'start':
      return {
        ...base,
        exp: 'none',
        g1: 'none',
        amendments: [],
        resultVersions: [],
        decisionTaken: null,
        tasks: 'not_sent',
        g2: 'none',
      };
    case 'g1_approved':
      return {
        ...base,
        amendments: [],
        resultVersions: [],
        decisionTaken: null,
        tasks: 'not_sent',
        g2: 'none',
      };
    case 'g2_prep':
      return { ...base, g2: 'none' };
    case 'v4':
    case 'approved':
    case 'invalidated':
    case 'expired':
      return {
        ...base,
        g2Version: 4,
        adoptionVersion: 2,
        g2Invalidated: preset === 'invalidated',
        g2Expired: preset === 'expired',
      };
    default:
      return base;
  }
}

/** Apply the WS7 base facts a preset implies (stale flag and G2 decision). */
function applyBase(preset: Ws8cPreset) {
  const sc = state.scenario as ScenarioBag;
  sc.g2Stale = preset === 'stale';
  state.g2Decision =
    preset === 'approved' || preset === 'invalidated' || preset === 'expired'
      ? { ...APPROVED_DECISION }
      : null;
}

const STATE_KEY = 'growth-os:ws8c-mock';
export const PRESET_KEY = 'growth-os:ws8c-preset';
let restoreChecked = false;

function storage(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function isPreset(v: unknown): v is Ws8cPreset {
  return typeof v === 'string' && (WS8C_PRESETS as readonly string[]).includes(v);
}

interface Saved {
  ws: Ws8cState;
  g2Decision: typeof state.g2Decision;
  g2Stale: boolean;
}

/** Restore once per page load (never after `resetMockState()` in the same module instance). */
function restore(sc: ScenarioBag, preset: Ws8cPreset) {
  if (restoreChecked) return;
  restoreChecked = true;
  try {
    const raw = storage()?.getItem(STATE_KEY);
    const saved = raw ? (JSON.parse(raw) as Saved) : null;
    if (saved?.ws && saved.ws.preset === preset) {
      sc.ws8c = saved.ws;
      state.g2Decision = saved.g2Decision;
      sc.g2Stale = saved.g2Stale;
    }
  } catch {
    /* ignore a damaged entry */
  }
}

/** The current WS8c mock state; (re)built when the preset changes. */
export function ws(): Ws8cState {
  const sc = state.scenario as ScenarioBag;
  if (!sc.ws8cPreset) {
    const stored = storage()?.getItem(PRESET_KEY);
    if (isPreset(stored)) sc.ws8cPreset = stored;
  }
  const preset = sc.ws8cPreset ?? 'demo';
  if (!sc.ws8c) restore(sc, preset);
  let current = sc.ws8c;
  if (!current || current.preset !== preset) {
    current = build(preset);
    sc.ws8c = current;
    if (sc.ws8cPreset) applyBase(preset);
  }
  return current;
}

/** Persist the journey after a command (browser only). */
export function save() {
  const sc = state.scenario as ScenarioBag;
  if (!sc.ws8c) return;
  try {
    storage()?.setItem(
      STATE_KEY,
      JSON.stringify({ ws: sc.ws8c, g2Decision: state.g2Decision, g2Stale: sc.g2Stale } satisfies Saved),
    );
  } catch {
    /* storage full or unavailable */
  }
}

export function isStale(): boolean {
  return (state.scenario as ScenarioBag).g2Stale && !state.g2Decision;
}

export function setStale(v: boolean) {
  (state.scenario as ScenarioBag).g2Stale = v;
}

/** Wrap a mutating resolver so its outcome is persisted for the next page load. */
export function persisting<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return (...args: A) => {
    const out = fn(...args);
    save();
    return out;
  };
}

export function hasResults(w: Ws8cState = ws()): boolean {
  return w.resultVersions.length > 0;
}
