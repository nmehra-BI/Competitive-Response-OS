/**
 * Exhaustive transition tests for the Market Expansion lifecycles. ALLOWED lists are written by hand
 * from ARCHITECTURE.md §8.1, §8.2, §8.4 and the PRD §4 stage table.
 */
import { describe, expect, it } from 'vitest';
import { ACTIVE_CASE_STAGES, CaseStage, ExperimentLifecycle, OpportunityStatus } from '@growth-os/contracts';
import { mandate as md21, people } from '@growth-os/fixtures-aster';
import {
  describeMachine,
  KIT_HUMAN,
  KIT_USER,
  type AllowedTransition,
} from '../../platform/workflow/machine-test-kit';
import type { Actor } from '../../platform/workflow/state-machine';
import type {
  CaseStageCommand,
  ExperimentCommand,
  MandateCommand,
  MandateStatusValue,
  OpportunityCommand,
} from './machines';
import {
  caseMachine,
  experimentMachine,
  followOnForGate,
  mandateMachine,
  opportunityMachine,
  type LifecycleFacts,
} from './runtime';

const MANDATE_OK: NonNullable<LifecycleFacts['mandate']> = {
  ownerId: KIT_USER,
  sponsorId: 'elena',
  currency: 'EUR',
  objective: 'Evaluate German food-processing plants.',
  horizonYears: 3,
  pilotDurationDays: 90,
  geographyCodes: ['DE'],
  productId: 'p1',
  segmentIds: ['s1'],
};

const PASS: LifecycleFacts = {
  caseOwnerId: KIT_USER,
  sponsorId: KIT_USER,
  pilotOwnerId: KIT_USER,
  marketBoundaryDefined: true,
  causalLimitations: ['4 sites, no comparison group.'],
  reviewAuthority: true,
  stopAuthority: true,
  approvalsStillEffective: true,
  allTasksOwned: true,
  approval: 'effective',
  blockingConditionsMet: true,
  windowEnd: '2027-02-28',
  today: '2027-03-01',
  heldFromStage: 'validation',
  rationale: 'Recorded rationale.',
  mandate: MANDATE_OK,
  newMandateVersionApproved: true,
  mandateApproved: true,
  mergeTarget: { sameMandate: true, status: 'shortlisted' },
  newCaseOwnerId: 'maya',
  plan: { complete: true, linkedAssumptionCount: 2 },
  authorizingGate: 'effective',
  reason: 'Two sites rescheduled.',
  result: {
    periodStart: '2026-10-19',
    periodEnd: '2026-11-20',
    source: 'partner log and signed commitments',
    metrics: [
      { observed: true, tooEarly: false },
      { observed: true, tooEarly: false },
    ],
  },
};

const FAIL: Record<string, Partial<LifecycleFacts>> = {
  actor_is_case_owner: { caseOwnerId: 'x' },
  actor_is_case_owner_or_pilot_owner: { caseOwnerId: 'x', pilotOwnerId: 'y' },
  actor_is_sponsor_or_case_owner: { sponsorId: 'x', caseOwnerId: 'y' },
  actor_is_sponsor: { sponsorId: 'x' },
  actor_is_sponsor_or_authorized: { sponsorId: 'x', stopAuthority: false },
  actor_has_review_authority: { reviewAuthority: false },
  market_boundary_defined: { marketBoundaryDefined: false },
  causal_limitations_present: { causalLimitations: [' '] },
  approvals_still_effective: { approvalsStillEffective: false },
  all_tasks_owned: { allTasksOwned: false },
  window_end_passed: { today: '2027-02-28' },
  approval_effective: { approval: 'expired' },
  blocking_conditions_met: { blockingConditionsMet: false },
  rationale_present: { rationale: null },
  owner_set: { mandate: { ...MANDATE_OK, ownerId: null } },
  sponsor_set: { mandate: { ...MANDATE_OK, sponsorId: null } },
  currency_set: { mandate: { ...MANDATE_OK, currency: null } },
  horizons_compatible: { mandate: { ...MANDATE_OK, horizonYears: 0 } },
  required_fields: { mandate: { ...MANDATE_OK, geographyCodes: [] } },
  actor_is_owner: { mandate: { ...MANDATE_OK, ownerId: 'x' } },
  new_mandate_version_approved: { newMandateVersionApproved: false },
  mandate_approved: { mandateApproved: false },
  target_in_same_mandate: { mergeTarget: { sameMandate: false, status: 'detected' } },
  target_not_duplicate: { mergeTarget: { sameMandate: true, status: 'duplicate' } },
  owner_named: { newCaseOwnerId: null },
  plan_complete: { plan: { complete: false, linkedAssumptionCount: 1 } },
  linked_to_assumption: { plan: { complete: true, linkedAssumptionCount: 0 } },
  authorizing_gate_effective: { authorizingGate: 'missing' },
  reason_present: { reason: '' },
  period_and_source_present: { result: { ...PASS.result!, source: null } },
  all_metrics_observed_or_too_early: {
    result: { ...PASS.result!, metrics: [{ observed: false, tooEarly: false }] },
  },
};

// ---------------------------------------------------------------------------

const CASE_ALLOWED: AllowedTransition<CaseStage, CaseStageCommand>[] = [
  ['draft_mandate', 'g0_approved', 'discovery', 'system'],
  ['discovery', 'start_assessment', 'assessment', 'human'],
  ['assessment', 'g1_approved', 'validation', 'system'],
  ['validation', 'g1_invalidated', 'assessment', 'system'],
  ['validation', 'g2_submitted', 'pilot_approval_pending', 'system'],
  ['pilot_approval_pending', 'g2_returned_or_withdrawn', 'validation', 'system'],
  ['pilot_approval_pending', 'g2_approved', 'pilot_approved', 'system'],
  ['pilot_approved', 'g2_invalidated', 'pilot_approval_pending', 'system'],
  ['pilot_running', 'g2_invalidated', 'pilot_approval_pending', 'system'],
  ['pilot_approved', 'pilot_activated', 'pilot_running', 'system'],
  ['pilot_running', 'pilot_window_ended', 'review_due', 'system'],
  ['pilot_running', 'start_review', 'review_due', 'human'],
  ['review_due', 'g3_submitted', 'scale_approval_pending', 'system'],
  ['scale_approval_pending', 'g3_returned_or_withdrawn', 'review_due', 'system'],
  ['scale_approval_pending', 'g3_approved', 'scaling', 'system'],
  ['review_due', 'outcome_revise_or_extend', 'validation', 'human'],
  ['on_hold', 'resume', 'validation', 'human'], // held_from_stage = validation in PASS
  ['scaling', 'close', 'closed', 'human'],
  ...ACTIVE_CASE_STAGES.flatMap((s): AllowedTransition<CaseStage, CaseStageCommand>[] => [
    [s, 'stop', 'stopped', 'human'],
    [s, 'outcome_stop', 'stopped', 'human'],
    [s, 'hold', 'on_hold', 'human'],
  ]),
];

describeMachine({
  machine: caseMachine,
  states: CaseStage.options,
  commands: [
    'start_assessment',
    'hold',
    'resume',
    'stop',
    'close',
    'g0_approved',
    'g1_approved',
    'g1_invalidated',
    'g2_submitted',
    'g2_returned_or_withdrawn',
    'g2_approved',
    'g2_invalidated',
    'pilot_activated',
    'pilot_window_ended',
    'start_review',
    'g3_submitted',
    'g3_returned_or_withdrawn',
    'g3_approved',
    'outcome_revise_or_extend',
    'outcome_stop',
  ],
  allowed: CASE_ALLOWED,
  passFacts: PASS,
  failFacts: FAIL,
});

const MANDATE_ALLOWED: AllowedTransition<MandateStatusValue, MandateCommand>[] = [
  ['draft', 'submit', 'awaiting_decision', 'human'],
  ['awaiting_decision', 'return', 'returned', 'system'],
  ['awaiting_decision', 'approve', 'approved', 'system'],
  ['returned', 'revise', 'draft', 'human'],
  ['approved', 'supersede', 'superseded', 'human'],
];
describeMachine({
  machine: mandateMachine,
  states: ['draft', 'awaiting_decision', 'returned', 'approved', 'superseded'],
  commands: ['submit', 'return', 'approve', 'revise', 'supersede'],
  allowed: MANDATE_ALLOWED,
  passFacts: PASS,
  failFacts: FAIL,
});

const OPP_ALLOWED: AllowedTransition<OpportunityStatus, OpportunityCommand>[] = [
  ['detected', 'shortlist', 'shortlisted', 'human'],
  ['shortlisted', 'unshortlist', 'detected', 'human'],
  ['detected', 'dismiss', 'dismissed', 'human'],
  ['shortlisted', 'dismiss', 'dismissed', 'human'],
  ['detected', 'merge', 'duplicate', 'human'],
  ['shortlisted', 'merge', 'duplicate', 'human'],
  ['dismissed', 'restore', 'detected', 'human'],
  ['shortlisted', 'convert', 'converted', 'human'],
];
describeMachine({
  machine: opportunityMachine,
  states: OpportunityStatus.options,
  commands: ['shortlist', 'dismiss', 'merge', 'restore', 'convert', 'unshortlist'],
  allowed: OPP_ALLOWED,
  passFacts: PASS,
  failFacts: FAIL,
});

const EXP_ALLOWED: AllowedTransition<ExperimentLifecycle, ExperimentCommand>[] = [
  ['draft', 'lock', 'locked', 'system'],
  ['locked', 'start', 'running', 'human'],
  ['locked', 'amend', 'locked', 'human'],
  ['running', 'amend', 'running', 'human'],
  ['result_recorded', 'amend', 'result_recorded', 'human'],
  ['running', 'record_result', 'result_recorded', 'human'],
  ['result_recorded', 'record_result', 'result_recorded', 'human'],
  ['draft', 'cancel', 'cancelled', 'human'],
  ['locked', 'cancel', 'cancelled', 'human'],
  ['running', 'cancel', 'cancelled', 'human'],
];
describeMachine({
  machine: experimentMachine,
  states: ExperimentLifecycle.options,
  commands: ['lock', 'start', 'amend', 'record_result', 'cancel'],
  allowed: EXP_ALLOWED,
  passFacts: PASS,
  failFacts: FAIL,
});

// ---------------------------------------------------------------------------
// Scenarios on the Aster fixture
// ---------------------------------------------------------------------------

const maya: Actor = { kind: 'human', userId: people.maya.id, interactive: true };
const elena: Actor = { kind: 'human', userId: people.elena.id, interactive: true };
const system: Actor = { kind: 'system', reason: 'gate_decision' };

describe('Aster: MD-21 mandate and G0 (WF-01)', () => {
  const v2 = md21.versions[1];
  const v2Facts: LifecycleFacts = {
    mandate: {
      ownerId: v2.ownerId,
      sponsorId: v2.sponsorId,
      currency: v2.currency,
      objective: v2.objective,
      horizonYears: v2.horizonYears,
      pilotDurationDays: v2.pilotDurationDays,
      geographyCodes: v2.geographyCodes,
      productId: v2.productId,
      segmentIds: v2.segmentIds,
    },
  };

  it('v1 without owner and currency cannot be submitted; both reasons are listed', () => {
    const r = mandateMachine.apply('draft', 'submit', maya, {
      mandate: { ...v2Facts.mandate!, ownerId: null, currency: null },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failed.map((f) => f.key)).toEqual(['owner_set', 'currency_set']);
      expect(r.reasons).toEqual(['Name an accountable owner.', 'State the currency.']);
    }
  });

  it('v2 submits; G0 return and approval are system transitions after Elena decides', () => {
    expect(mandateMachine.apply('draft', 'submit', maya, v2Facts)).toMatchObject({
      ok: true,
      to: 'awaiting_decision',
      events: ['gate_submitted'],
    });
    expect(mandateMachine.apply('awaiting_decision', 'approve', elena, v2Facts)).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(followOnForGate('G0', 'approve')).toEqual({
      case: 'g0_approved',
      mandate: 'approve',
      lockExperiments: false,
    });
    expect(mandateMachine.apply('awaiting_decision', 'approve', system, v2Facts)).toMatchObject({
      ok: true,
      to: 'approved',
    });
  });

  it('Maya revises a returned mandate; Elena cannot', () => {
    expect(mandateMachine.apply('returned', 'revise', maya, v2Facts).ok).toBe(true);
    expect(mandateMachine.apply('returned', 'revise', elena, v2Facts)).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('case lifecycle scenarios', () => {
  it('a case moves past a gate only on a gate event, never by a person or by tasks', () => {
    expect(caseMachine.apply('pilot_approval_pending', 'g2_approved', KIT_HUMAN, PASS)).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    for (const s of CaseStage.options) {
      for (const c of caseMachine.commandsFrom(s)) expect(c).not.toMatch(/task/);
    }
  });

  it('activation is blocked by an open blocking condition and an unowned task, both listed', () => {
    const r = caseMachine.apply('pilot_approved', 'pilot_activated', system, {
      ...PASS,
      blockingConditionsMet: false,
      allTasksOwned: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failed.map((f) => f.key)).toEqual(['blocking_conditions_met', 'all_tasks_owned']);
      expect(r.reasons).toContain('Activation blocked: a task has no owner.');
    }
  });

  it('activation with an expired approval returns APPROVAL_EXPIRED', () => {
    expect(
      caseMachine.apply('pilot_approved', 'pilot_activated', system, { ...PASS, approval: 'expired' }),
    ).toMatchObject({ ok: false, code: 'APPROVAL_EXPIRED' });
  });

  it('hold then resume returns to the held stage; resume needs a recorded stage', () => {
    const held = caseMachine.apply('pilot_running', 'hold', KIT_HUMAN, PASS);
    expect(held).toMatchObject({ ok: true, from: 'pilot_running', to: 'on_hold' });
    expect(
      caseMachine.apply('on_hold', 'resume', KIT_HUMAN, { ...PASS, heldFromStage: 'pilot_running' }),
    ).toMatchObject({ ok: true, to: 'pilot_running' });
    expect(caseMachine.apply('on_hold', 'resume', KIT_HUMAN, { ...PASS, heldFromStage: null })).toMatchObject(
      {
        ok: false,
        code: 'INVALID_TRANSITION',
      },
    );
  });

  it('stopped and closed cases accept no command', () => {
    expect(caseMachine.commandsFrom('stopped')).toEqual([]);
    expect(caseMachine.commandsFrom('closed')).toEqual([]);
  });

  it('pilot window ends only after the last day (28 Feb 2027 → review due on 1 Mar)', () => {
    const f = { ...PASS, windowEnd: '2027-02-28' };
    expect(
      caseMachine.apply('pilot_running', 'pilot_window_ended', system, { ...f, today: '2027-02-28' }).ok,
    ).toBe(false);
    expect(
      caseMachine.apply('pilot_running', 'pilot_window_ended', system, { ...f, today: '2027-03-01' }),
    ).toMatchObject({
      ok: true,
      to: 'review_due',
      domainEvent: 'case.stage_changed',
      nextAction: { key: 'outcome_decision' },
    });
  });

  it('revise/extend needs causal limitations and emits extension_requested', () => {
    expect(
      caseMachine.apply('review_due', 'outcome_revise_or_extend', elena, {
        ...PASS,
        causalLimitations: [],
      }),
    ).toMatchObject({ ok: false, code: 'PRECONDITIONS_UNMET' });
    expect(caseMachine.apply('review_due', 'outcome_revise_or_extend', elena, PASS)).toMatchObject({
      ok: true,
      to: 'validation',
      events: ['extension_requested'],
    });
  });
});

describe('followOnForGate', () => {
  it('maps gate decisions to case and mandate transitions', () => {
    expect(followOnForGate('G1', 'approve').case).toBe('g1_approved');
    expect(followOnForGate('G1', 'approve').lockExperiments).toBe(true);
    expect(followOnForGate('G1', 'invalidate').case).toBe('g1_invalidated');
    expect(followOnForGate('G2', 'submit').case).toBe('g2_submitted');
    expect(followOnForGate('G2', 'resubmit').case).toBe('g2_submitted');
    expect(followOnForGate('G2', 'refresh').case).toBeNull();
    expect(followOnForGate('G2', 'approve_with_conditions').case).toBe('g2_approved');
    expect(followOnForGate('G2', 'not_approved').case).toBe('g2_returned_or_withdrawn');
    expect(followOnForGate('G2', 'withdraw', 'awaiting_decision').case).toBe('g2_returned_or_withdrawn');
    expect(followOnForGate('G2', 'withdraw', 'draft').case).toBeNull();
    expect(followOnForGate('G2', 'invalidate').case).toBe('g2_invalidated');
    expect(followOnForGate('G2', 'expire').case).toBeNull();
    expect(followOnForGate('G3', 'submit').case).toBe('g3_submitted');
    expect(followOnForGate('G3', 'approve').case).toBe('g3_approved');
    expect(followOnForGate('G0', 'return_for_revision').mandate).toBe('return');
  });

  it('an extension (X) never moves the case and never unblocks G3', () => {
    for (const c of ['submit', 'approve', 'approve_with_conditions', 'invalidate', 'expire'] as const) {
      expect(followOnForGate('X', c)).toEqual({ case: null, mandate: null, lockExperiments: false });
    }
  });
});

describe('experiment: thresholds never move silently', () => {
  it('amend keeps the state and needs a reason', () => {
    expect(experimentMachine.apply('running', 'amend', KIT_HUMAN, PASS)).toMatchObject({
      ok: true,
      changed: false,
      domainEvent: 'experiment.amended',
    });
    expect(experimentMachine.apply('running', 'amend', KIT_HUMAN, { ...PASS, reason: '' }).ok).toBe(false);
  });

  it('a draft cannot be edited into running without G1 locking it', () => {
    expect(experimentMachine.apply('draft', 'start', KIT_HUMAN, PASS)).toMatchObject({
      ok: false,
      code: 'INVALID_TRANSITION',
    });
  });

  it('"too early to read" counts as recorded; a missing metric does not', () => {
    const r = experimentMachine.apply('running', 'record_result', KIT_HUMAN, {
      ...PASS,
      result: { ...PASS.result!, metrics: [{ observed: false, tooEarly: true }] },
    });
    expect(r).toMatchObject({ ok: true, events: ['experiment_completed'] });
  });
});
