/**
 * Deterministic precondition evaluator for G0–G3 and the extension gate X (PRD §4, ARCHITECTURE §8.3).
 *
 * Facts are loaded by the API from COMMITTED records only. Task completion is never an input:
 * completing tasks does not pass a gate. Every key has its own function; unknown keys fail closed.
 */
import Decimal from 'decimal.js';
import type {
  Blocker,
  DecisionOutcome,
  GateCode,
  GateRequestStatus,
  GateStatus,
  Precondition,
  ThresholdResult,
} from '@growth-os/contracts';
import { ME_GATES, type PreconditionEvaluator, type PreconditionFacts } from './definitions';

// ---------------------------------------------------------------------------
// Facts per gate
// ---------------------------------------------------------------------------

/** A signed, scoped review (specialist or finance). */
export type SignOffFact = {
  signed: boolean;
  /** Gates the signed scope covers, e.g. ['G2'] for "pilot only". */
  coversGates: readonly GateCode[];
  maxSites: number | null;
  maxDays: number | null;
  scopeText?: string | null;
};

/** A pre-registered outcome target from the approved snapshot and its latest observation. */
export type TargetFact = {
  metricKey: string;
  name: string;
  operator: 'gte' | 'lte' | 'eq' | 'qualitative';
  /** null when the threshold is a placeholder (e.g. "[hours per site]") or qualitative. */
  thresholdValue: string | null;
  observedValue: string | null;
  result: ThresholdResult | null;
};

export type G0Facts = {
  gateCode: 'G0';
  mandate: {
    sponsorId: string | null;
    objective: string | null;
    /** Constraints and exclusions, e.g. "No prospect outreach before G1". */
    constraints: readonly string[];
    ownerId: string | null;
    currency: string | null;
    horizonYears: number | null;
  } | null;
};

export type G1Facts = {
  gateCode: 'G1';
  /** Sources in the case evidence inventory. */
  evidenceSourceCount: number;
  /** Latest COMMITTED sizing version, if any. */
  sizing: { committed: boolean; blockingChecks: number } | null;
  /** Decision-critical assumptions in the register (the material unknowns). */
  materialUnknownsCount: number;
  /** Feasibility rows (dimensions) recorded, with or without blockers. */
  feasibilityRowsCount: number;
};

export type G2Facts = {
  gateCode: 'G2';
  validationResults: readonly { experimentKey: string; resultRecorded: boolean }[];
  financeReview: { signed: boolean } | null;
  specialistSignOff: SignOffFact | null;
  scope: {
    amount: string | null;
    currency: string | null;
    durationDays: number | null;
    maxSites: number | null;
    ownerId: string | null;
  };
  stopRules: readonly string[];
};

export type G3Facts = {
  gateCode: 'G3';
  pilotTargets: readonly TargetFact[];
  /** Specialist review whose scope covers scale (G3). */
  scaleReadiness: SignOffFact | null;
  economicsUpdatedAfterPilot: boolean;
  capacityReviewed: boolean;
  scope: { amount: string | null; currency: string | null };
};

export type XFacts = {
  gateCode: 'X';
  parentGate: { gateCode: GateCode; status: GateRequestStatus } | null;
  /** The outcome decision that led to the extension. */
  outcomeDecision: DecisionOutcome | null;
  scope: { amount: string | null; currency: string | null; ownerId: string | null };
  /**
   * The cap is a declared placeholder ("€[cap]", PRD sets no amount). Submission is allowed so the
   * request can be awaiting decision; approval stays impossible until a real amount is set (the
   * policy engine refuses a spend gate with no amount).
   */
  capPlaceholder?: boolean;
};

export type GateFacts = G0Facts | G1Facts | G2Facts | G3Facts | XFacts;

/** Pre-registered metrics that express demand in "X of N" form (used for the G3 blocker copy). */
// The fixture key and the key S10 derives from the PRD measure name "Paid use and continuation" (D-102).
export const DEMAND_METRIC_KEYS: readonly string[] = ['paid_use_continuation', 'paid_use_and_continuation'];

// ---------------------------------------------------------------------------
// Key functions
// ---------------------------------------------------------------------------

interface KeyResult {
  met: boolean;
  /** Detail shown in the "Why?" list when unmet (null when met). */
  detail: string | null;
  /** Short clause for the one-line summary, e.g. "demand threshold 3 of 4 (4 of 4 required)". */
  short: string | null;
}

const ok = (): KeyResult => ({ met: true, detail: null, short: null });
const no = (detail: string, short?: string): KeyResult => ({
  met: false,
  detail,
  // The summary joins clauses with "; ", so a sentence's final full stop is dropped.
  short: short ?? (detail.charAt(0).toLowerCase() + detail.slice(1)).replace(/\.$/, ''),
});

const text = (v: string | null | undefined) => typeof v === 'string' && v.trim().length > 0;

const LABELS: Readonly<Record<string, string>> = {
  sponsor_set: 'Sponsor named',
  objective_set: 'Objective stated',
  constraints_set: 'Constraints and exclusions stated',
  owner_set: 'Accountable owner named',
  currency_and_horizon_set: 'Currency and horizon set',
  evidence_inventory: 'Evidence inventory',
  comparable_sizing: 'Comparable sizing committed',
  material_unknowns_listed: 'Material unknowns listed',
  feasibility_blockers_listed: 'Feasibility blockers listed',
  validation_results: 'Validation results recorded',
  finance_review: 'Finance review signed',
  specialist_sign_off: 'Specialist sign-off covers the pilot scope',
  budget_and_stop_rules: 'Budget and stop rules',
  accountable_pilot_owner: 'Accountable pilot owner',
  pilot_actuals_vs_thresholds: 'Pilot actuals vs pre-registered thresholds',
  readiness_reassessment: 'Specialist scale-readiness review',
  updated_economics_and_capacity: 'Updated economics and capacity',
  approved_scale_budget: 'Scale budget stated',
  parent_gate_reviewed: 'Parent gate reviewed',
  extension_cap_set: 'Extension cap set',
  accountable_owner: 'Accountable owner',
};

function signOffCovers(s: SignOffFact | null, gate: GateCode, sites: number | null, days: number | null) {
  if (!s || !s.signed) return 'missing' as const;
  if (!s.coversGates.includes(gate)) return 'scope' as const;
  if (sites !== null && (s.maxSites === null || s.maxSites < sites)) return 'scope' as const;
  if (days !== null && (s.maxDays === null || s.maxDays < days)) return 'scope' as const;
  return 'ok' as const;
}

function positiveAmount(amount: string | null, currency: string | null): boolean {
  if (!amount || !currency) return false;
  try {
    return new Decimal(amount).gt(0);
  } catch {
    return false;
  }
}

function targetMet(t: TargetFact): boolean | null {
  if (t.operator === 'qualitative' || t.thresholdValue === null) return null; // cannot gate
  if (t.result) return t.result === 'met';
  if (t.observedValue === null) return false;
  try {
    const obs = new Decimal(t.observedValue);
    const thr = new Decimal(t.thresholdValue);
    return t.operator === 'gte' ? obs.gte(thr) : t.operator === 'lte' ? obs.lte(thr) : obs.eq(thr);
  } catch {
    return false;
  }
}

function targetDetail(t: TargetFact): { detail: string; short: string } {
  if (t.observedValue === null) {
    return { detail: `${t.name} · no data recorded`, short: `${t.name.toLowerCase()} has no data` };
  }
  if (DEMAND_METRIC_KEYS.includes(t.metricKey) && t.thresholdValue !== null) {
    const thr = t.thresholdValue;
    return {
      detail: `Demand threshold · ${t.observedValue} of ${thr} met; ${thr} of ${thr} required`,
      short: `demand threshold ${t.observedValue} of ${thr} (${thr} of ${thr} required)`,
    };
  }
  return {
    detail: `${t.name} · ${t.observedValue}; threshold ${t.thresholdValue ?? 'not set'}`,
    short: `${t.name.toLowerCase()} not met`,
  };
}

type KeyFn = (facts: GateFacts) => KeyResult;

function forGate<F extends GateFacts>(code: F['gateCode'], fn: (f: F) => KeyResult): KeyFn {
  return (facts) =>
    facts.gateCode === code ? fn(facts as F) : no(`This check does not apply to ${facts.gateCode}.`);
}

export const PRECONDITION_KEYS: Readonly<Record<string, KeyFn>> = {
  // --- G0 ------------------------------------------------------------------
  sponsor_set: forGate<G0Facts>('G0', (f) => (text(f.mandate?.sponsorId) ? ok() : no('Name a sponsor.'))),
  objective_set: forGate<G0Facts>('G0', (f) =>
    text(f.mandate?.objective) ? ok() : no('State the objective.'),
  ),
  constraints_set: forGate<G0Facts>('G0', (f) =>
    (f.mandate?.constraints ?? []).some(text) ? ok() : no('State the constraints and exclusions.'),
  ),
  owner_set: forGate<G0Facts>('G0', (f) =>
    text(f.mandate?.ownerId) ? ok() : no('Name an accountable owner.'),
  ),
  currency_and_horizon_set: forGate<G0Facts>('G0', (f) => {
    const m = f.mandate;
    if (!text(m?.currency)) return no('State the currency.');
    if (!m?.horizonYears || m.horizonYears <= 0) return no('Set the decision horizon.');
    return ok();
  }),

  // --- G1 ------------------------------------------------------------------
  evidence_inventory: forGate<G1Facts>('G1', (f) =>
    f.evidenceSourceCount > 0 ? ok() : no('Add sources to the evidence inventory.'),
  ),
  comparable_sizing: forGate<G1Facts>('G1', (f) => {
    if (!f.sizing?.committed) return no('Commit a sizing version.');
    if (f.sizing.blockingChecks > 0) return no('Sizing has blocking checks.');
    return ok();
  }),
  material_unknowns_listed: forGate<G1Facts>('G1', (f) =>
    f.materialUnknownsCount > 0 ? ok() : no('List the material unknowns in the assumption register.'),
  ),
  feasibility_blockers_listed: forGate<G1Facts>('G1', (f) =>
    f.feasibilityRowsCount > 0 ? ok() : no('Record the feasibility review and its blockers.'),
  ),

  // --- G2 ------------------------------------------------------------------
  validation_results: forGate<G2Facts>('G2', (f) =>
    f.validationResults.some((r) => r.resultRecorded) ? ok() : no('Record validation results.'),
  ),
  finance_review: forGate<G2Facts>('G2', (f) =>
    f.financeReview?.signed ? ok() : no('Finance review · not signed'),
  ),
  specialist_sign_off: forGate<G2Facts>('G2', (f) => {
    const c = signOffCovers(f.specialistSignOff, 'G2', f.scope.maxSites, f.scope.durationDays);
    if (c === 'ok') return ok();
    return c === 'missing'
      ? no('Specialist sign-off · pending')
      : no('Specialist sign-off does not cover the requested pilot scope');
  }),
  budget_and_stop_rules: forGate<G2Facts>('G2', (f) => {
    if (!positiveAmount(f.scope.amount, f.scope.currency)) return no('State the pilot budget.');
    if (!f.stopRules.some(text)) return no('Add stop rules.');
    return ok();
  }),
  accountable_pilot_owner: forGate<G2Facts>('G2', (f) =>
    text(f.scope.ownerId) ? ok() : no('Name the accountable pilot owner.'),
  ),

  // --- G3 ------------------------------------------------------------------
  pilot_actuals_vs_thresholds: forGate<G3Facts>('G3', (f) => {
    const gating = f.pilotTargets.filter((t) => targetMet(t) !== null);
    if (gating.length === 0) return no('No pre-registered thresholds to compare against.');
    const failing = gating.filter((t) => targetMet(t) === false);
    if (failing.length === 0) return ok();
    const parts = failing.map(targetDetail);
    return {
      met: false,
      detail: parts.map((p) => p.detail).join('; '),
      short: parts.map((p) => p.short).join('; '),
    };
  }),
  readiness_reassessment: forGate<G3Facts>('G3', (f) =>
    signOffCovers(f.scaleReadiness, 'G3', null, null) === 'ok'
      ? ok()
      : no('Specialist scale-readiness review · incomplete', 'specialist scale-readiness review incomplete'),
  ),
  // Copy follows the fixture's "<what> · <state>" pattern (D-039: every unmet precondition is listed).
  updated_economics_and_capacity: forGate<G3Facts>('G3', (f) => {
    if (!f.economicsUpdatedAfterPilot && !f.capacityReviewed)
      return no(
        'Economics and capacity · not updated after the pilot',
        'economics and capacity not updated after the pilot',
      );
    if (!f.economicsUpdatedAfterPilot)
      return no('Economics · not updated with pilot actuals', 'economics not updated with pilot actuals');
    if (!f.capacityReviewed)
      return no('Capacity for scale · not reviewed', 'capacity for scale not reviewed');
    return ok();
  }),
  approved_scale_budget: forGate<G3Facts>('G3', (f) =>
    positiveAmount(f.scope.amount, f.scope.currency)
      ? ok()
      : no('Scale budget · not stated', 'no scale budget stated'),
  ),

  // --- X -------------------------------------------------------------------
  parent_gate_reviewed: forGate<XFacts>('X', (f) => {
    if (!f.parentGate) return no('An extension needs the gate it extends.');
    if (f.outcomeDecision !== 'extend' && f.outcomeDecision !== 'revise') {
      return no('Record the outcome decision (revise or extend) first.');
    }
    return ok();
  }),
  extension_cap_set: forGate<XFacts>('X', (f) =>
    positiveAmount(f.scope.amount, f.scope.currency) || f.capPlaceholder === true
      ? ok()
      : no('Set the extension cap.'),
  ),
  accountable_owner: forGate<XFacts>('X', (f) =>
    text(f.scope.ownerId) ? ok() : no('Name the accountable owner.'),
  ),
};

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface GateEvaluation {
  gateCode: GateCode;
  preconditions: Precondition[];
  /** The "Why?" list (unmet preconditions), for problem+json `blockers`. */
  blockers: Blocker[];
  allMet: boolean;
  metCount: number;
  total: number;
  /** e.g. "G3 preconditions unmet: demand threshold 3 of 4 (4 of 4 required); specialist …". */
  summary: string | null;
}

/** Evaluate the gate's precondition keys (default: ME_GATES; pass a gate policy's keys to override). */
export function evaluateGate(facts: GateFacts, keys?: readonly string[]): GateEvaluation {
  const list = keys ?? ME_GATES[facts.gateCode].preconditionKeys;
  const shorts: string[] = [];
  const preconditions: Precondition[] = list.map((key) => {
    const fn = Object.prototype.hasOwnProperty.call(PRECONDITION_KEYS, key)
      ? PRECONDITION_KEYS[key]
      : undefined;
    let r: KeyResult;
    if (!fn) r = no(`Unknown precondition "${key}" — blocked until configured.`);
    else {
      try {
        r = fn(facts);
      } catch {
        r = no(`Precondition "${key}" could not be checked.`);
      }
    }
    if (!r.met && r.short) shorts.push(r.short);
    return { key, label: LABELS[key] ?? key, met: r.met, detail: r.met ? null : r.detail, href: null };
  });
  const unmet = preconditions.filter((p) => !p.met);
  return {
    gateCode: facts.gateCode,
    preconditions,
    blockers: unmet.map((p) => ({ key: p.key, message: p.detail ?? p.label, gate: facts.gateCode })),
    allMet: unmet.length === 0,
    metCount: preconditions.length - unmet.length,
    total: preconditions.length,
    summary: unmet.length === 0 ? null : `${facts.gateCode} preconditions unmet: ${shorts.join('; ')}`,
  };
}

/** Implementation of the frozen PreconditionEvaluator interface. */
export function createPreconditionEvaluator(): PreconditionEvaluator {
  return {
    evaluate: (facts: PreconditionFacts) => evaluateGate(facts as unknown as GateFacts).preconditions,
  };
}

/**
 * Display status for the rail and approval panel (GateStatus), derived from the stored request status
 * and the precondition evaluation. `afterReview` marks G3 after the outcome review (unmet → Blocked).
 */
export function deriveGateDisplayStatus(input: {
  gateCode: GateCode;
  requestStatus: GateRequestStatus | null;
  evaluation: Pick<GateEvaluation, 'allMet' | 'metCount'>;
  afterReview?: boolean;
}): GateStatus {
  const { requestStatus, evaluation } = input;
  if (requestStatus === null || requestStatus === 'draft' || requestStatus === 'withdrawn') {
    if (evaluation.allMet) return 'ready_to_submit';
    if (input.gateCode === 'G3' && input.afterReview) return 'blocked';
    return evaluation.metCount === 0 ? 'not_started' : 'preconditions_open';
  }
  if (requestStatus === 'stale') return 'awaiting_decision';
  return requestStatus;
}
