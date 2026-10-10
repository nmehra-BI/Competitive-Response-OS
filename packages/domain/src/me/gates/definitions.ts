/**
 * Market Expansion gate definitions (PRD §4 gate table). The shared gate primitive is generic;
 * this file is the app-specific part: preconditions, decision owner and scoped button labels.
 */
import type { GateCode, GateScope, Precondition } from '@growth-os/contracts';

export interface GateDefinition {
  code: GateCode;
  name: string;
  decisionOwner: string;
  output: string;
  preconditionKeys: readonly string[];
  /** Never a bare "Approve" (research §7.4). */
  buttonLabel(scope: GateScope, fmtMoney: (amount: string, currency: string) => string): string;
}

export const ME_GATES: Readonly<Record<GateCode, GateDefinition>> = {
  G0: {
    code: 'G0',
    name: 'Scope approved',
    decisionOwner: 'Sponsor',
    output: 'Approved mandate',
    preconditionKeys: [
      'sponsor_set',
      'objective_set',
      'constraints_set',
      'owner_set',
      'currency_and_horizon_set',
    ],
    buttonLabel: () => 'Approve mandate (G0)',
  },
  G1: {
    code: 'G1',
    name: 'Validate thesis',
    decisionOwner: 'Case owner + designated reviewers; sponsor approves validation spend',
    output: 'Validation plan approval',
    preconditionKeys: [
      'evidence_inventory',
      'comparable_sizing',
      'material_unknowns_listed',
      'feasibility_blockers_listed',
    ],
    buttonLabel: (s, fmt) =>
      `Approve validation ${s.amount && s.currency ? fmt(s.amount, s.currency) : '€[amount]'}`,
  },
  G2: {
    code: 'G2',
    name: 'Pilot investment',
    decisionOwner: 'Authorized investment approver',
    output: 'Approved pilot snapshot or revision / no-go',
    preconditionKeys: [
      'validation_results',
      'finance_review',
      'specialist_sign_off',
      'budget_and_stop_rules',
      'accountable_pilot_owner',
    ],
    buttonLabel: (s, fmt) =>
      `Approve pilot ${s.amount && s.currency ? fmt(s.amount, s.currency) : '€[amount]'}${s.durationDays ? ` · ${s.durationDays} days` : ''}`,
  },
  G3: {
    code: 'G3',
    name: 'Scale / enter market',
    decisionOwner: 'Authorized investment committee / sponsor',
    output: 'Scale authorization, extension, or stop',
    preconditionKeys: [
      'pilot_actuals_vs_thresholds',
      'readiness_reassessment',
      'updated_economics_and_capacity',
      'approved_scale_budget',
    ],
    buttonLabel: () => 'Authorize scale',
  },
  X: {
    code: 'X',
    name: 'Extension',
    decisionOwner: 'Sponsor within delegated authority',
    output: 'Scoped extension with its own cap',
    preconditionKeys: ['parent_gate_reviewed', 'extension_cap_set', 'accountable_owner'],
    buttonLabel: (s, fmt) =>
      `Approve extension ${s.amount && s.currency ? fmt(s.amount, s.currency) : '€[cap]'}`,
  },
};

/** Inputs the precondition evaluator needs; loaded by the API from committed records only. */
export interface PreconditionFacts {
  gateCode: GateCode;
  [key: string]: unknown;
}

export interface PreconditionEvaluator {
  /** Pure. Task completion is never an input: completing tasks does not pass a gate. */
  evaluate(facts: PreconditionFacts): Precondition[];
}

// Implementation: ./preconditions.ts (createPreconditionEvaluator, evaluateGate).
