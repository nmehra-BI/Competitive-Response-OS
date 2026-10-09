/**
 * WS8d mock journey state (pilot → outcomes → history, evidence and admin corrections). Mock-only:
 * imported by the screens' `mocks.ts` files, never by screen code.
 *
 * The state is bound to WS7's `state.scenario` object, so `resetMockState()` also resets it. It is
 * mirrored to sessionStorage so a full page load in Playwright keeps the journey (MSW state lives
 * in page memory). A spec seeds a variant before navigating:
 *
 *   sessionStorage.setItem('growth-os:ws8d-mocks', JSON.stringify({ seed: { pilotVariant: 'expired' } }))
 */
import type { PrincipalKind, RoleCode, SyncStatus, TaskStatus } from '@growth-os/contracts';
import {
  journeyMoments as J,
  outcomeObservations,
  outcomeReview,
  outcomeTargets,
  people,
} from '@growth-os/fixtures-aster';
import { state } from '../../mocks/state';

export const WS8D_STORAGE_KEY = 'growth-os:ws8d-mocks';

/** S11 variants (FRONTEND §7): partial sync is the normal path; the others are seeded states. */
export type PilotVariant = 'normal' | 'expired' | 'invalidated' | 'timeout';
/** S12 starting point: pilot window ended with no actuals, or the decision already recorded. */
export type OutcomesMoment = 'pilot_ended' | 'recommended' | 'decided';

export interface Seed {
  pilotVariant?: PilotVariant;
  outcomesMoment?: OutcomesMoment;
}

export interface TaskSyncState {
  status: SyncStatus;
  externalKey: string | null;
  attempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  retryable: boolean;
  confirmedAt: string | null;
  /** Reads while "checking" before the reconcile finds the issue (timeout-after-success). */
  checkingReads: number;
  /** Wall-clock ms when the task entered Checking (reconcile never completes instantly). */
  checkingSince?: number;
}

export interface ObservationState {
  id: string;
  targetKey: string;
  version: number;
  valueText: string;
  value: string | null;
  unit: string;
  periodStart: string;
  periodEnd: string;
  sourceText: string;
  result: 'met' | 'not_met' | 'inconclusive' | null;
  recordedBy: string;
  recordedAt: string;
  supersedesId: string | null;
}

export interface JourneyAudit {
  at: string;
  actorId: string | null;
  actorKind: PrincipalKind | 'system';
  actorRole: RoleCode | null;
  action: string;
  objectType: string;
  objectId: string;
  objectVersion: number | null;
  summary: string;
  rule: string;
}

export interface ChallengeState {
  id: string;
  statement: string;
  raisedBy: string;
  createdAt: string;
}

export interface Ws8dState {
  pilotVariant: PilotVariant;
  task2OwnerId: string | null;
  c1Evidence: string | null;
  c1MetAt: string | null;
  activatedAt: string | null;
  draftRowVersion: number;
  preview: { id: string; hash: string; n: number } | null;
  permissionFaultArmed: boolean;
  timeoutFaultArmed: boolean;
  sync: Record<string, TaskSyncState>;
  blockedTasks: Record<string, string>;
  /** Internal task status set through tasks.update (S11, My Work), with the task row version. */
  taskStatus?: Record<string, { status: TaskStatus; rowVersion: number }>;
  messageDraft: { title: string; body: string; origin: 'human' | 'ai' | 'ai_edited'; rowVersion: number };
  scopeChanges: number;
  observations: ObservationState[];
  reviewRowVersion: number;
  recommendation: { outcome: 'proceed' | 'revise' | 'extend' | 'stop' | 'scale'; text: string } | null;
  decision: {
    outcome: 'stop' | 'revise' | 'extend' | 'proceed';
    label: string;
    rationale: string;
    by: string;
    at: string;
  } | null;
  extension: {
    /** Null = the PRD placeholder "€[cap]" / "[duration] days" (D-040, D-068). */
    spendCap: string | null;
    currency: string;
    durationDays: number | null;
    ownerId: string;
    scopeItems: string[];
    by: string;
    at: string;
  } | null;
  evidence: {
    stale: Record<string, string>;
    challenges: Record<string, ChallengeState[]>;
    replacedBy: Record<string, string>;
  };
  admin: { reconnected: string[]; tested: string[] };
  audit: JourneyAudit[];
  /** Minutes since the last journey moment, for deterministic synthetic timestamps. */
  clock: Record<string, number>;
}

function initial(seed: Seed = {}): Ws8dState {
  const v = seed.pilotVariant ?? 'normal';
  const prepared = v !== 'normal';
  const s: Ws8dState = {
    pilotVariant: v,
    task2OwnerId: prepared ? OPS_LEAD_ID : null,
    c1Evidence: prepared ? 'Signed site list limited to 4 sites (specialist scope)' : null,
    c1MetAt: prepared ? '2026-12-01T08:40:00+01:00' : null,
    activatedAt: prepared ? J.pilotActivated : null,
    draftRowVersion: 1,
    preview: null,
    permissionFaultArmed: v === 'normal',
    timeoutFaultArmed: v === 'timeout',
    sync: {},
    blockedTasks: {},
    taskStatus: {},
    messageDraft: {
      title: 'Welcome note to the 4 pilot site contacts',
      body: 'Thank you for joining the 90-day monitoring pilot. Your site lead will contact you to schedule installation…',
      origin: 'ai',
      rowVersion: 1,
    },
    scopeChanges: 0,
    observations: [],
    reviewRowVersion: 1,
    recommendation: null,
    decision: null,
    extension: null,
    evidence: { stale: {}, challenges: {}, replacedBy: {} },
    admin: { reconnected: [], tested: [] },
    audit: [],
    clock: {},
  };
  if (prepared) {
    s.audit.push({
      at: s.c1MetAt!,
      actorId: people.jonas.id,
      actorKind: 'human',
      actorRole: 'pilot_owner',
      action: 'condition.met',
      objectType: 'condition',
      objectId: 'a57e0017-0000-4000-8000-000000000001',
      objectVersion: 1,
      summary: 'Marked C1 met · Pilot limited to 4 sites as signed by the specialist',
      rule: 'condition.owner',
    });
    s.audit.push({
      at: J.pilotActivated,
      actorId: people.jonas.id,
      actorKind: 'human',
      actorRole: 'pilot_owner',
      action: 'pilot_plan.activated',
      objectType: 'pilot_plan_version',
      objectId: 'a57eff00-0000-4000-8000-000000001003',
      objectVersion: 1,
      summary: 'Activated the approved pilot plan v1 · stage Pilot running',
      rule: 'pilot.activate',
    });
  }
  if (seed.outcomesMoment === 'decided' || seed.outcomesMoment === 'recommended') seedDecided(s);
  if (seed.outcomesMoment === 'recommended') {
    s.decision = null;
    s.audit = s.audit.filter((e) => e.action !== 'outcome.decided');
  }
  return s;
}

/** The prototype moment (5 Mar 2027): actuals recorded, recommendation accepted, decision recorded. */
function seedDecided(s: Ws8dState) {
  s.observations = outcomeObservations.map((o) => ({
    id: o.id,
    targetKey: o.targetKey,
    version: 1,
    valueText: o.valueText,
    value: o.value,
    unit: o.unit,
    periodStart: o.periodStart,
    periodEnd: o.periodEnd,
    sourceText: o.sourceText,
    result: o.result,
    recordedBy: o.recordedBy,
    recordedAt: o.recordedAt,
    supersedesId: null,
  }));
  s.recommendation = {
    outcome: outcomeReview.recommendation.outcome,
    text: outcomeReview.recommendation.text,
  };
  s.decision = {
    outcome: outcomeReview.decision.outcome,
    label: outcomeReview.decision.label,
    rationale: outcomeReview.decision.rationale,
    by: outcomeReview.decision.decidedBy,
    at: outcomeReview.decision.decidedAt,
  };
  // The seeded moment appears in History exactly as if it had been recorded step by step.
  for (const o of s.observations) {
    s.audit.push({
      at: o.recordedAt,
      actorId: o.recordedBy,
      actorKind: 'human',
      actorRole: 'pilot_owner',
      action: 'outcome.recorded',
      objectType: 'outcome_observation',
      objectId: o.id,
      objectVersion: 1,
      summary: `Recorded ${o.targetKey.replace(/_/g, ' ')}: ${o.valueText} · ${o.sourceText.replace(/^Source: /, '')}`,
      rule: 'outcome.record',
    });
  }
  s.audit.push({
    at: '2027-03-04T17:00:00+01:00',
    actorId: people.maya.id,
    actorKind: 'human',
    actorRole: 'case_owner',
    action: 'outcome_review.recommendation_set',
    objectType: 'outcome_review',
    objectId: 'a57eff00-0000-4000-8000-000000002001',
    objectVersion: 1,
    summary: `Recommended “${outcomeReview.recommendation.label}” · not a decision`,
    rule: 'outcome_review.edit',
  });
  s.audit.push({
    at: outcomeReview.decision.decidedAt,
    actorId: outcomeReview.decision.decidedBy,
    actorKind: 'human',
    actorRole: 'sponsor',
    action: 'outcome.decided',
    objectType: 'decision_record',
    objectId: 'a57e0022-0000-4000-8000-000000000001',
    objectVersion: 1,
    summary: `Decision recorded: ${outcomeReview.decision.label} · stage Validation`,
    rule: 'outcome.decide · sponsor',
  });
}

/** Fixture outcome target keys, in the order of the pre-registered thresholds. */
export const TARGET_KEYS = outcomeTargets.map((t) => t.metricKey);

const OPS_LEAD_ID = people.opsLead.id;

function read(): Ws8dState | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(WS8D_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { full?: Ws8dState; seed?: Seed };
    if (parsed.full) return parsed.full;
    if (parsed.seed) return initial(parsed.seed);
  } catch {
    /* unavailable or malformed: start fresh */
  }
  return null;
}

function write(s: Ws8dState | null) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (s) sessionStorage.setItem(WS8D_STORAGE_KEY, JSON.stringify({ full: s }));
    else sessionStorage.removeItem(WS8D_STORAGE_KEY);
  } catch {
    /* node */
  }
}

let bound: object | null = null;
let current: Ws8dState = initial();

/** The WS8d journey state, reset whenever WS7's `resetMockState()` runs. */
export function ws8d(): Ws8dState {
  if (bound === null) {
    bound = state.scenario;
    current = read() ?? initial();
  } else if (bound !== state.scenario) {
    bound = state.scenario;
    current = initial();
    write(null);
  }
  return current;
}

/** Persist after every mutation so a full page load keeps the journey. */
export function save() {
  write(current);
}

/** Start the WS8d state from a seeded variant (tests and the browser helper). */
export function seedWs8d(seed: Seed) {
  ws8d();
  current = initial(seed);
  save();
}

/** Deterministic timestamp: `base` + n minutes, advancing per base on each call. */
export function at(base: string, step = 1): string {
  const s = ws8d();
  const n = (s.clock[base] ?? 0) + step;
  s.clock[base] = n;
  const d = new Date(new Date(base).getTime() + n * 60_000);
  const offset = base.slice(-6);
  const local = new Date(d.getTime() + offsetMinutes(offset) * 60_000);
  return `${local.toISOString().slice(0, 19)}${offset}`;
}

function offsetMinutes(o: string): number {
  const sign = o.startsWith('-') ? -1 : 1;
  const [h, m] = o.slice(1).split(':').map(Number);
  return sign * ((h ?? 0) * 60 + (m ?? 0));
}

export function audit(e: JourneyAudit) {
  ws8d().audit.push(e);
}

if (typeof window !== 'undefined') {
  (window as unknown as { __ws8dMocks: unknown }).__ws8dMocks = {
    seed: seedWs8d,
    get state() {
      return ws8d();
    },
  };
}
