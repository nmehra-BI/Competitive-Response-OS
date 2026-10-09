import { describe, expect, it } from 'vitest';
import { Precondition } from '@growth-os/contracts';
import {
  exp03,
  gates,
  mandate as md21,
  outcomeObservations,
  outcomeTargets,
  people,
  specialistSignOff,
} from '@growth-os/fixtures-aster';
import { ME_GATES } from './definitions';
import {
  createPreconditionEvaluator,
  deriveGateDisplayStatus,
  evaluateGate,
  type G0Facts,
  type G1Facts,
  type G2Facts,
  type G3Facts,
  type GateFacts,
  type TargetFact,
  type XFacts,
} from './preconditions';

const v2 = md21.versions[1];
const g0: G0Facts = {
  gateCode: 'G0',
  mandate: {
    sponsorId: v2.sponsorId,
    objective: v2.objective,
    constraints: v2.exclusions,
    ownerId: v2.ownerId,
    currency: v2.currency,
    horizonYears: v2.horizonYears,
  },
};

const g1: G1Facts = {
  gateCode: 'G1',
  evidenceSourceCount: 6,
  sizing: { committed: true, blockingChecks: 0 },
  materialUnknownsCount: 3,
  feasibilityRowsCount: 7,
};

const lenaSigned = {
  signed: true,
  coversGates: [specialistSignOff.coversGate],
  maxSites: specialistSignOff.maxSites,
  maxDays: specialistSignOff.maxDays,
  scopeText: specialistSignOff.scopeText,
} as const;

const g2: G2Facts = {
  gateCode: 'G2',
  validationResults: [{ experimentKey: exp03.key, resultRecorded: true }],
  financeReview: { signed: true },
  specialistSignOff: lenaSigned,
  scope: {
    amount: gates.g2.amount,
    currency: gates.g2.currency,
    durationDays: gates.g2.durationDays,
    maxSites: gates.g2.maxSites,
    ownerId: gates.g2.pilotOwnerId,
  },
  stopRules: gates.g2.stopRules,
};

/** Pre-registered targets from the G2 snapshot joined with the recorded actuals (fixture). */
const asterTargets: TargetFact[] = outcomeTargets.map((t) => {
  const o = outcomeObservations.find((x) => x.targetKey === t.metricKey);
  return {
    metricKey: t.metricKey,
    name: t.name,
    operator: t.operator,
    thresholdValue: t.thresholdValue,
    observedValue: o?.value ?? null,
    result: o?.result ?? null,
  };
});

/**
 * Aster at step 28: actuals recorded, Lena's sign-off covers the pilot only. The other G3 facts are
 * set as met so the evaluation shows exactly the two fixture blockers (see notes: open question).
 */
const g3Aster: G3Facts = {
  gateCode: 'G3',
  pilotTargets: asterTargets,
  scaleReadiness: lenaSigned,
  economicsUpdatedAfterPilot: true,
  capacityReviewed: true,
  scope: { amount: '400000.00', currency: 'EUR' },
};

const x1: XFacts = {
  gateCode: 'X',
  parentGate: { gateCode: 'G2', status: 'approved_with_conditions' },
  outcomeDecision: 'extend',
  scope: { amount: gates.x1.amount, currency: null, ownerId: gates.x1.ownerId },
  capPlaceholder: true,
};

describe('PreconditionEvaluator', () => {
  it('evaluates every key of every gate definition and returns contract-valid preconditions', () => {
    const all: GateFacts[] = [g0, g1, g2, g3Aster, x1];
    const ev = createPreconditionEvaluator();
    for (const f of all) {
      const out = ev.evaluate(f);
      expect(out.map((p) => p.key)).toEqual([...ME_GATES[f.gateCode].preconditionKeys]);
      for (const p of out) expect(Precondition.safeParse(p).success).toBe(true);
    }
  });

  it('G0: MD-21 v2 meets all; v1 (no owner, no currency) does not', () => {
    expect(evaluateGate(g0).allMet).toBe(true);
    const v1 = evaluateGate({ ...g0, mandate: { ...g0.mandate!, ownerId: null, currency: null } });
    expect(v1.allMet).toBe(false);
    expect(v1.blockers.map((b) => b.key)).toEqual(['owner_set', 'currency_and_horizon_set']);
  });

  it('G1: comparable sizing must be committed with no blocking checks', () => {
    expect(evaluateGate(g1).allMet).toBe(true);
    expect(evaluateGate({ ...g1, sizing: { committed: false, blockingChecks: 0 } }).blockers[0]?.key).toBe(
      'comparable_sizing',
    );
    expect(evaluateGate({ ...g1, sizing: { committed: true, blockingChecks: 1 } }).allMet).toBe(false);
  });

  it('G2: blocked until Lena signs; a pilot-only sign-off covers 4 sites · 90 days', () => {
    expect(evaluateGate(g2).allMet).toBe(true);
    const pending = evaluateGate({ ...g2, specialistSignOff: null });
    expect(pending.blockers).toEqual([
      { key: 'specialist_sign_off', message: 'Specialist sign-off · pending', gate: 'G2' },
    ]);
    const tooBig = evaluateGate({ ...g2, scope: { ...g2.scope, maxSites: 6 } });
    expect(tooBig.blockers[0]?.message).toMatch(/does not cover/);
  });

  it('G2: missing finance review, budget, stop rules and owner are each listed', () => {
    const e = evaluateGate({
      ...g2,
      financeReview: null,
      stopRules: [],
      scope: { ...g2.scope, ownerId: null },
    });
    expect(e.blockers.map((b) => b.key)).toEqual([
      'finance_review',
      'budget_and_stop_rules',
      'accountable_pilot_owner',
    ]);
    expect(e.metCount).toBe(2);
  });

  it('G3 on the Aster outcome is blocked: demand 3 of 4 (4 of 4 required) and scale-readiness incomplete', () => {
    const e = evaluateGate(g3Aster);
    expect(e.allMet).toBe(false);
    expect(e.blockers).toEqual([
      {
        key: gates.g3.blockedBy[0].key,
        message: gates.g3.blockedBy[0].message,
        gate: 'G3',
      },
      {
        key: gates.g3.blockedBy[1].key,
        message: gates.g3.blockedBy[1].message,
        gate: 'G3',
      },
    ]);
    expect(e.summary).toBe(
      'G3 preconditions unmet: demand threshold 3 of 4 (4 of 4 required); specialist scale-readiness review incomplete',
    );
    expect(
      deriveGateDisplayStatus({ gateCode: 'G3', requestStatus: null, evaluation: e, afterReview: true }),
    ).toBe('blocked');
  });

  it('G3 with honest step-28 facts lists every unmet precondition (D-039 interim)', () => {
    // At step 28 no scale budget is requested and economics/capacity were not refreshed after the pilot.
    const e = evaluateGate({
      ...g3Aster,
      economicsUpdatedAfterPilot: false,
      capacityReviewed: false,
      scope: { amount: null, currency: null },
    });
    expect(e.allMet).toBe(false);
    expect(e.blockers.map((b) => b.key)).toEqual([...ME_GATES.G3.preconditionKeys]);
    expect(e.summary).toBe(
      'G3 preconditions unmet: demand threshold 3 of 4 (4 of 4 required); specialist scale-readiness review incomplete; economics and capacity not updated after the pilot; no scale budget stated',
    );
    expect(e.blockers.map((b) => b.message)).toEqual([
      'Demand threshold · 3 of 4 met; 4 of 4 required',
      'Specialist scale-readiness review · incomplete',
      'Economics and capacity · not updated after the pilot',
      'Scale budget · not stated',
    ]);
  });

  it('G3 passes only when the demand threshold is met AND a specialist signs for scale', () => {
    const met = asterTargets.map((t) =>
      t.metricKey === 'paid_use_continuation' ? { ...t, observedValue: '4', result: 'met' as const } : t,
    );
    const onlyDemand = evaluateGate({ ...g3Aster, pilotTargets: met });
    expect(onlyDemand.blockers.map((b) => b.key)).toEqual(['readiness_reassessment']);
    const both = evaluateGate({
      ...g3Aster,
      pilotTargets: met,
      scaleReadiness: { signed: true, coversGates: ['G3'], maxSites: null, maxDays: null },
    });
    expect(both.allMet).toBe(true);
  });

  it('G3 with no actuals recorded is not met (missing is never zero)', () => {
    const none = asterTargets.map((t) => ({ ...t, observedValue: null, result: null }));
    const e = evaluateGate({ ...g3Aster, pilotTargets: none });
    expect(e.blockers[0]?.message).toBe('Paid use and continuation · no data recorded');
  });

  it('an approved extension (X) never unblocks G3', () => {
    // G3 facts have no input for extensions: the same Aster facts stay blocked.
    expect(evaluateGate(g3Aster).allMet).toBe(false);
  });

  it('X1: parent reviewed, placeholder cap allows submission, owner Jonas', () => {
    const e = evaluateGate(x1);
    expect(e.allMet).toBe(true);
    expect(x1.scope.ownerId).toBe(people.jonas.id);
    const noCap = evaluateGate({ ...x1, capPlaceholder: false });
    expect(noCap.blockers.map((b) => b.key)).toEqual(['extension_cap_set']);
    const noDecision = evaluateGate({ ...x1, outcomeDecision: null });
    expect(noDecision.blockers.map((b) => b.key)).toEqual(['parent_gate_reviewed']);
  });

  it('task completion is never an input', () => {
    const withTasks = { ...g2, specialistSignOff: null, tasksDone: 6, tasksTotal: 6 } as G2Facts;
    expect(evaluateGate(withTasks).allMet).toBe(false);
  });

  it('unknown keys and wrong-gate keys fail closed', () => {
    const e = evaluateGate(g2, ['validation_results', 'made_up_key', 'sponsor_set']);
    expect(e.preconditions.map((p) => p.met)).toEqual([true, false, false]);
  });

  it('display status follows the request when one exists', () => {
    const ev = evaluateGate(g2);
    expect(deriveGateDisplayStatus({ gateCode: 'G2', requestStatus: null, evaluation: ev })).toBe(
      'ready_to_submit',
    );
    expect(deriveGateDisplayStatus({ gateCode: 'G2', requestStatus: 'stale', evaluation: ev })).toBe(
      'awaiting_decision',
    );
    expect(
      deriveGateDisplayStatus({ gateCode: 'G2', requestStatus: 'approved_with_conditions', evaluation: ev }),
    ).toBe('approved_with_conditions');
    expect(
      deriveGateDisplayStatus({
        gateCode: 'G2',
        requestStatus: null,
        evaluation: evaluateGate({ ...g2, specialistSignOff: null }),
      }),
    ).toBe('preconditions_open');
  });
});
