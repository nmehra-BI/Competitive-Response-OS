/**
 * Gate precondition facts, loaded from COMMITTED records only (task completion is never an input),
 * then evaluated by the WS3 evaluator (`evaluateGate`). G3 lists every unmet precondition (D-039);
 * X accepts a cap placeholder for submission only (D-040).
 */
import type { DecisionOutcome, GateCode, GateRequestStatus, GateStatus } from '@growth-os/contracts';
import { sql, type Tx } from '@growth-os/db';
import {
  deriveGateDisplayStatus,
  effectiveGatePolicy,
  evaluateGate,
  type ExtensionContext,
  type ExtensionRequestFacts,
  type GateEvaluation,
  type GateFacts,
  type SignOffFact,
  type TargetFact,
} from '@growth-os/domain';
import type { MeasureType, ThresholdResult } from '@growth-os/contracts';
import { gatePolicy, type CaseLite } from './common';
import { GATE_COLUMNS, scopeOf, stopRulesOf, type GateRow } from './serialize';

/** numeric(24,8) → shortest exact text ("4.00000000" → "4"). */
export function trimDecimal(v: string | null): string | null {
  return v === null ? null : v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
}

const SIGNED = ['supports', 'supports_with_conditions', 'accepts_ownership'];

async function latestCommittedSizing(tx: Tx, caseId: string) {
  return tx
    .selectFrom('me.sizing_version as v')
    .leftJoin('platform.calculation_result as r', 'r.id', 'v.calculation_result_id')
    .select(['v.id', 'v.version', 'v.committed_at', 'r.blocked', 'r.input_hash', 'r.output'])
    .where('v.case_id', '=', caseId)
    .where('v.state', '=', 'committed')
    .orderBy('v.version', 'desc')
    .executeTakeFirst();
}

async function latestCommittedEconomics(tx: Tx, caseId: string) {
  return tx
    .selectFrom('me.economics_version as v')
    .leftJoin('platform.calculation_result as r', 'r.id', 'v.calculation_result_id')
    .select(['v.id', 'v.version', 'v.committed_at', 'r.input_hash', 'r.output'])
    .where('v.case_id', '=', caseId)
    .where('v.state', '=', 'committed')
    .orderBy('v.version', 'desc')
    .executeTakeFirst();
}

export { latestCommittedEconomics, latestCommittedSizing };

/**
 * Distinct sources of a case: its originating opportunity's sources, and the sources its sizing
 * versions, cohorts and claims cite. One definition for G1 evidence, snapshot evidence and the header's
 * freshness (D-072).
 */
export async function caseSourceIds(tx: Tx, caseId: string): Promise<string[]> {
  const r = await sql<{ id: string }>`
    SELECT DISTINCT os.source_id AS id FROM me.opportunity_source os
      JOIN platform.workflow_case wc ON wc.origin_type = 'opportunity' AND wc.origin_id = os.opportunity_id
     WHERE wc.id = ${caseId}
    UNION
    SELECT DISTINCT i.source_id FROM me.sizing_input i
      JOIN me.sizing_version v ON v.id = i.sizing_version_id
     WHERE v.case_id = ${caseId} AND i.source_id IS NOT NULL
    UNION
    SELECT DISTINCT c.source_id FROM me.cohort c
      JOIN me.sizing_version v ON v.id = c.sizing_version_id
     WHERE v.case_id = ${caseId} AND c.source_id IS NOT NULL
    UNION
    SELECT DISTINCT l.source_id FROM platform.claim_evidence_link l
      JOIN platform.claim cl ON cl.id = l.claim_id
     WHERE cl.case_id = ${caseId}`.execute(tx);
  return r.rows.map((x) => x.id);
}

/** Current specialist sign-off (scoped) for a case. */
async function specialistSignOff(tx: Tx, caseId: string): Promise<SignOffFact | null> {
  const rows = await tx
    .selectFrom('me.feasibility_assessment as a')
    .innerJoin('me.feasibility_review as r', 'r.id', 'a.current_review_id')
    .select(['r.position', 'r.covers_gate', 'r.max_sites', 'r.max_days', 'r.scope_text'])
    .where('a.case_id', '=', caseId)
    .where('a.dimension', '=', 'specialist_review')
    .execute();
  const r = rows[0];
  if (!r) return null;
  const covers = (r.covers_gate ? [r.covers_gate] : []) as GateCode[];
  return {
    signed: SIGNED.includes(r.position),
    coversGates: covers,
    maxSites: r.max_sites,
    maxDays: r.max_days,
    scopeText: r.scope_text,
  };
}

export async function financeSigned(tx: Tx, caseId: string, economicsVersionId: string | null) {
  if (!economicsVersionId) return false;
  const r = await tx
    .selectFrom('me.model_review')
    .select('id')
    .where('case_id', '=', caseId)
    .where('model_type', '=', 'economics')
    .where('model_version_id', '=', economicsVersionId)
    .where('signed_at', 'is not', null)
    .where('position', 'in', ['supports', 'supports_with_conditions'])
    .executeTakeFirst();
  return !!r;
}

/** The approved G2 of a case (latest by decision), whose snapshot holds the pilot's thresholds. */
export async function approvedG2(tx: Tx, caseId: string) {
  return tx
    .selectFrom('platform.gate_request')
    .select(['id', 'status', 'current_snapshot_id', 'requested_amount', 'currency', 'decided_at'])
    .where('case_id', '=', caseId)
    .where('gate_code', '=', 'G2')
    .where('status', 'in', ['approved', 'approved_with_conditions', 'invalidated', 'expired'])
    .orderBy('decided_at', 'desc')
    .executeTakeFirst();
}

/** Pre-registered targets (approved G2 snapshot) with their latest observation. */
export async function targetFacts(tx: Tx, caseId: string): Promise<TargetFact[]> {
  const g2 = await approvedG2(tx, caseId);
  if (!g2?.current_snapshot_id) return [];
  const targets = await tx
    .selectFrom('platform.outcome_target')
    .selectAll()
    .where('snapshot_id', '=', g2.current_snapshot_id)
    .execute();
  const out: TargetFact[] = [];
  for (const t of targets) {
    const obs = await latestObservation(tx, t.id);
    out.push({
      metricKey: t.metric_key,
      name: t.name,
      operator: t.operator as TargetFact['operator'],
      thresholdValue: trimDecimal(t.threshold_value),
      observedValue: obs ? trimDecimal(obs.value ?? null) : null,
      result: (obs?.result ?? null) as TargetFact['result'],
      measureType: (t.measure_type ?? null) as MeasureType | null, // D-115: the G3 demand clause reads it
    });
  }
  return out;
}

/** The latest observation of a target: the newest version not superseded by another. */
export async function latestObservation(tx: Tx, targetId: string) {
  return tx
    .selectFrom('platform.outcome_observation as o')
    .selectAll('o')
    .where('o.target_id', '=', targetId)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('platform.outcome_observation as n')
            .select('n.id')
            .whereRef('n.supersedes_id', '=', 'o.id'),
        ),
      ),
    )
    .orderBy('o.recorded_at', 'desc')
    .executeTakeFirst();
}

export async function latestDecisionOutcome(tx: Tx, caseId: string): Promise<DecisionOutcome | null> {
  const r = await tx
    .selectFrom('platform.decision_record')
    .select('outcome')
    .where('case_id', '=', caseId)
    .orderBy('decided_at', 'desc')
    .executeTakeFirst();
  return (r?.outcome ?? null) as DecisionOutcome | null;
}

export interface FactInput {
  gateCode: GateCode;
  caseRow: CaseLite | null;
  gate: GateRow | null;
  /**
   * D-111: whether the viewer may read the committed economics. The G3 scale-budget blocker names the
   * one-time investment only then. Default true (every caller has already checked case access).
   */
  economicsReadable?: boolean;
  /** Scope for gates not yet requested (preconditions view). */
  scopeOverride?: {
    amount: string | null;
    currency: string | null;
    durationDays: number | null;
    maxSites: number | null;
    ownerId: string | null;
  };
}

export async function loadGateFacts(tx: Tx, f: FactInput): Promise<GateFacts> {
  const scope = f.gate ? scopeOf(f.gate) : null;
  const s = scope
    ? {
        amount: scope.amount,
        currency: scope.currency,
        durationDays: scope.durationDays,
        maxSites: scope.maxSites,
        ownerId: scope.ownerId,
      }
    : (f.scopeOverride ?? {
        amount: null,
        currency: null,
        durationDays: null,
        maxSites: null,
        ownerId: null,
      });
  const caseId = f.caseRow?.id ?? '';
  switch (f.gateCode) {
    case 'G0': {
      const mandateId = f.gate?.subject_type === 'mandate' ? f.gate.subject_id : f.caseRow?.mandateId;
      const m = mandateId
        ? await tx
            .selectFrom('me.mandate as m')
            .innerJoin('me.mandate_version as v', (j) =>
              j.on((eb) => eb('v.id', '=', eb.fn.coalesce('m.draft_version_id', 'm.current_version_id'))),
            )
            .select([
              'v.sponsor_user_id',
              'v.objective',
              'v.exclusions',
              'v.owner_user_id',
              'v.currency',
              'v.horizon_years',
            ])
            .where('m.id', '=', mandateId)
            .executeTakeFirst()
        : undefined;
      return {
        gateCode: 'G0',
        mandate: m
          ? {
              sponsorId: m.sponsor_user_id,
              objective: m.objective,
              constraints: m.exclusions,
              ownerId: m.owner_user_id,
              currency: m.currency,
              horizonYears: m.horizon_years,
            }
          : null,
      };
    }
    case 'G1': {
      const sizing = await latestCommittedSizing(tx, caseId);
      const [sources, unknowns, feas] = await Promise.all([
        caseSourceIds(tx, caseId),
        tx
          .selectFrom('platform.assumption')
          .select(sql<string>`count(*)`.as('n'))
          .where('case_id', '=', caseId)
          .where('decision_critical', '=', true)
          .where('status', '<>', 'retired')
          .executeTakeFirst(),
        tx
          .selectFrom('me.feasibility_assessment')
          .select(sql<string>`count(*)`.as('n'))
          .where('case_id', '=', caseId)
          .executeTakeFirst(),
      ]);
      const blockingChecks = sizing?.blocked ? 1 : 0;
      return {
        gateCode: 'G1',
        evidenceSourceCount: sources.length,
        sizing: sizing ? { committed: true, blockingChecks } : null,
        materialUnknownsCount: Number(unknowns?.n ?? 0),
        feasibilityRowsCount: Number(feas?.n ?? 0),
      };
    }
    case 'G2': {
      const exps = await tx
        .selectFrom('me.experiment as e')
        .select([
          'e.display_key',
          sql<boolean>`EXISTS (SELECT 1 FROM me.experiment_result_version r WHERE r.experiment_id = e.id)`.as(
            'has_result',
          ),
        ])
        .where('e.case_id', '=', caseId)
        .where('e.illustrative', '=', false)
        .execute();
      const econ = await latestCommittedEconomics(tx, caseId);
      const stopRules = await stopRuleLines(tx, f.gate);
      const structured = f.gate ? stopRulesOf(f.gate) : [];
      return {
        gateCode: 'G2',
        validationResults: exps.map((e) => ({ experimentKey: e.display_key, resultRecorded: e.has_result })),
        financeReview: { signed: await financeSigned(tx, caseId, econ?.id ?? null) },
        specialistSignOff: await specialistSignOff(tx, caseId),
        scope: s,
        stopRules,
        // D-112: null = a request from before structured stop rules (its text lines still count).
        structuredStopRules: structured === null ? null : structured.length,
      };
    }
    case 'G3': {
      const targets = await targetFacts(tx, caseId);
      const scale = await specialistSignOff(tx, caseId);
      // Economics "updated after the pilot": a committed economics version after pilot activation.
      const plan = await tx
        .selectFrom('me.pilot_plan')
        .select('activated_at')
        .where('case_id', '=', caseId)
        .executeTakeFirst();
      const econ = await latestCommittedEconomics(tx, caseId);
      const updated = !!plan?.activated_at && !!econ?.committed_at && econ.committed_at > plan.activated_at;
      return {
        gateCode: 'G3',
        pilotTargets: targets,
        scaleReadiness: scale,
        economicsUpdatedAfterPilot: updated,
        capacityReviewed: updated,
        scope: { amount: s.amount, currency: s.currency },
        scaleInvestment: f.economicsReadable === false ? null : scaleInvestmentOf(econ),
      };
    }
    case 'X': {
      const parent = f.gate?.parent_gate_request_id
        ? await tx
            .selectFrom('platform.gate_request')
            .select(['gate_code', 'status'])
            .where('id', '=', f.gate.parent_gate_request_id)
            .executeTakeFirst()
        : undefined;
      return {
        gateCode: 'X',
        parentGate: parent
          ? { gateCode: parent.gate_code as GateCode, status: parent.status as GateRequestStatus }
          : null,
        outcomeDecision: await latestDecisionOutcome(tx, caseId),
        scope: { amount: s.amount, currency: s.currency, ownerId: s.ownerId },
        capPlaceholder: s.amount === null,
        extension: f.gate?.parent_gate_request_id ? await extensionFactsOf(tx, f.gate) : null,
      };
    }
  }
}

/** The committed economics' one-time scale-entry investment (D-111), or null. One-time money only. */
export function scaleInvestmentOf(
  econ: { version: number; output: unknown } | undefined,
): { economicsVersion: number; amount: string; currency: string } | null {
  const inv = (econ?.output as { oneTimeInvestment?: { amount?: string; currency?: string } } | null)
    ?.oneTimeInvestment;
  if (!econ || !inv?.amount || !inv.currency) return null;
  return { economicsVersion: econ.version, amount: inv.amount, currency: inv.currency };
}

/** Whether the tenant is illustrative (training data: an extension cap may stay a placeholder). */
export async function tenantIllustrative(tx: Tx): Promise<boolean> {
  const t = await tx.selectFrom('platform.tenant').select('illustrative').executeTakeFirst();
  return t?.illustrative ?? false;
}

const ACTIVE_X = ['draft', 'awaiting_decision', 'stale', 'approved', 'approved_with_conditions'] as const;

/** Parent pilot facts and the extensions already asked of it (other than `excludeGateId`). */
export async function extensionParentOf(tx: Tx, parentId: string, excludeGateId: string | null) {
  const parent = await tx
    .selectFrom('platform.gate_request')
    .select([...GATE_COLUMNS])
    .where('id', '=', parentId)
    .executeTakeFirst();
  if (!parent) return null;
  let q = tx
    .selectFrom('platform.gate_request')
    .select(['id', 'display_key'])
    .where('parent_gate_request_id', '=', parentId)
    .where('gate_code', '=', 'X')
    .where('status', 'in', [...ACTIVE_X]);
  if (excludeGateId) q = q.where('id', '<>', excludeGateId);
  const others = await q.execute();
  const ps = scopeOf(parent as GateRow);
  return {
    row: parent as GateRow,
    facts: {
      amount: parent.requested_amount,
      currency: parent.currency,
      durationDays: parent.duration_days ?? ps.durationDays,
      maxSites: ps.maxSites,
    },
    others,
  };
}

/** Parent targets with their latest result (for "re-tests unmet or inconclusive thresholds"). */
export async function parentTargetResults(tx: Tx, parent: GateRow) {
  if (!parent.current_snapshot_id) return [];
  const targets = await tx
    .selectFrom('platform.outcome_target')
    .select(['id', 'name', 'metric_key'])
    .where('snapshot_id', '=', parent.current_snapshot_id)
    .orderBy('metric_key')
    .execute();
  const out: { id: string; metricKey: string; name: string; result: ThresholdResult | null }[] = [];
  for (const t of targets) {
    const o = await latestObservation(tx, t.id);
    out.push({
      id: t.id,
      metricKey: t.metric_key,
      name: t.name,
      result: (o?.result ?? null) as ThresholdResult | null,
    });
  }
  return out;
}

/** Retest target ids stored with an X request (D-136). */
export function retestTargetIdsOf(g: Pick<GateRow, 'scope'>): string[] | null {
  const ids = (g.scope as { retestTargetIds?: unknown } | null)?.retestTargetIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : null;
}

/** The D-110 rule facts of an X request (pure check in `checkExtensionRequest`). */
export async function extensionFactsOf(
  tx: Tx,
  gate: GateRow,
): Promise<{ context: ExtensionContext; request: ExtensionRequestFacts } | null> {
  if (!gate.parent_gate_request_id) return null;
  const parent = await extensionParentOf(tx, gate.parent_gate_request_id, gate.id);
  if (!parent) return null;
  const rule = effectiveGatePolicy(await gatePolicy(tx, 'X')).extension!;
  const scope = scopeOf(gate);
  const targets = await parentTargetResults(tx, parent.row);
  const ids = retestTargetIdsOf(gate);
  const retest = ids ? targets.filter((t) => ids.includes(t.id)) : targets.filter((t) => t.result !== 'met');
  return {
    context: {
      rule,
      parent: parent.facts,
      // An extension decided before this one still counts; withdrawn and refused ones do not.
      otherExtensions: parent.others.length,
      illustrative: await tenantIllustrative(tx),
    },
    request: {
      amount: scope.amount,
      currency: scope.currency,
      durationDays: scope.durationDays,
      maxSites: scope.maxSites,
      scopeItems: scope.authorizes,
      retestTargets: retest.map((t) => ({ name: t.name, result: t.result })),
    },
  };
}

/** Readable stop-rule lines of a request: its snapshot's budget and stop rules, else the scope text. */
async function stopRuleLines(tx: Tx, gate: GateRow | null): Promise<string[]> {
  if (!gate) return [];
  if (gate.current_snapshot_id) {
    const s = await tx
      .selectFrom('platform.decision_snapshot')
      .select('content')
      .where('id', '=', gate.current_snapshot_id)
      .executeTakeFirst();
    const rules = (s?.content as { budgetAndStopRules?: string[] } | undefined)?.budgetAndStopRules;
    if (rules?.length) return rules;
  }
  const scope = scopeOf(gate);
  return scope.amount && scope.currency ? defaultStopRules(scope.amount, scope.currency) : [];
}

export function defaultStopRules(amount: string, currency: string): string[] {
  return [
    `Approved budget ceiling ${currency} ${amount}. Spend above it needs a scope-change request and a new authorization.`,
  ];
}

export async function evaluate(tx: Tx, f: FactInput): Promise<GateEvaluation> {
  const facts = await loadGateFacts(tx, f);
  const policy = await gatePolicy(tx, f.gateCode);
  return evaluateGate(facts, policy.preconditionKeys);
}

const AFTER_REVIEW = new Set(['review_due', 'scale_approval_pending', 'scaling', 'closed']);

/** The latest gate request of a code for a case (withdrawn requests excluded). */
export async function latestCaseGate(tx: Tx, caseId: string, code: GateCode): Promise<GateRow | null> {
  return (
    ((await tx
      .selectFrom('platform.gate_request')
      .select([...GATE_COLUMNS])
      .where('case_id', '=', caseId)
      .where('gate_code', '=', code)
      .where('status', '<>', 'withdrawn')
      .orderBy('created_at', 'desc')
      .executeTakeFirst()) as GateRow | undefined) ?? null
  );
}

export interface CaseGateState {
  gate: GateRow | null;
  evaluation: GateEvaluation;
  status: GateStatus;
}

/**
 * The single source of a case gate's preconditions and display status (D-072): `gates.preconditions`,
 * the case header rail and the overview all call this, so they cannot disagree.
 */
export async function caseGateState(
  tx: Tx,
  caseRow: CaseLite,
  code: GateCode,
  opts?: { economicsReadable?: boolean },
): Promise<CaseGateState> {
  const gate = await latestCaseGate(tx, caseRow.id, code);
  const evaluation = await evaluate(tx, {
    gateCode: code,
    caseRow,
    gate,
    economicsReadable: opts?.economicsReadable,
  });
  const status = deriveGateDisplayStatus({
    gateCode: code,
    requestStatus: (gate?.status as GateRequestStatus | undefined) ?? null,
    evaluation,
    afterReview: AFTER_REVIEW.has(caseRow.stage),
  });
  return { gate, evaluation, status };
}
