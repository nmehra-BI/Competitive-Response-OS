/**
 * Precondition facts for the case gates, loaded from COMMITTED records only (task completion is never
 * an input). Used by the case header rail; exported so WS4b's `gates.preconditions` can reuse them.
 */
import type { GateCode } from '@growth-os/contracts';
import {
  evaluateGate,
  type G1Facts,
  type G2Facts,
  type G3Facts,
  type GateEvaluation,
} from '@growth-os/domain';
import type { Tx } from '@growth-os/db';
import type { CaseRecord } from './access';
import type { GateRow } from './gate-read';

const SUPPORTS = new Set(['supports', 'supports_with_conditions', 'accepts_ownership']);

export async function caseSourceIds(tx: Tx, c: CaseRecord): Promise<Set<string>> {
  const ids = new Set<string>();
  if (c.origin_type === 'opportunity' && c.origin_id) {
    const rows = await tx
      .selectFrom('me.opportunity_source')
      .select('source_id')
      .where('opportunity_id', '=', c.origin_id)
      .execute();
    rows.forEach((r) => ids.add(r.source_id));
  }
  const sizing = await tx
    .selectFrom('me.sizing_input as i')
    .innerJoin('me.sizing_version as v', 'v.id', 'i.sizing_version_id')
    .select('i.source_id')
    .where('v.case_id', '=', c.id)
    .where('i.source_id', 'is not', null)
    .execute();
  sizing.forEach((r) => ids.add(r.source_id!));
  const cohorts = await tx
    .selectFrom('me.cohort as k')
    .innerJoin('me.sizing_version as v', 'v.id', 'k.sizing_version_id')
    .select('k.source_id')
    .where('v.case_id', '=', c.id)
    .where('k.source_id', 'is not', null)
    .execute();
  cohorts.forEach((r) => ids.add(r.source_id!));
  const claims = await tx
    .selectFrom('platform.claim_evidence_link as l')
    .innerJoin('platform.claim as cl', 'cl.id', 'l.claim_id')
    .select('l.source_id')
    .where('cl.case_id', '=', c.id)
    .execute();
  claims.forEach((r) => ids.add(r.source_id));
  return ids;
}

export async function caseSourceCount(tx: Tx, c: CaseRecord): Promise<number> {
  return (await caseSourceIds(tx, c)).size;
}

export async function g1Facts(tx: Tx, c: CaseRecord): Promise<G1Facts> {
  const sizing = await tx
    .selectFrom('me.sizing_version as v')
    .leftJoin('platform.calculation_result as r', 'r.id', 'v.calculation_result_id')
    .select(['v.id', 'r.output'])
    .where('v.case_id', '=', c.id)
    .where('v.state', '=', 'committed')
    .orderBy('v.version', 'desc')
    .executeTakeFirst();
  const checks = ((sizing?.output as { checks?: { blocking: boolean }[] } | null)?.checks ?? []).filter(
    (x) => x.blocking,
  );
  const unknowns = await tx
    .selectFrom('platform.assumption')
    .select('id')
    .where('case_id', '=', c.id)
    .where('decision_critical', '=', true)
    .where('status', '<>', 'retired')
    .execute();
  const feas = await tx
    .selectFrom('me.feasibility_assessment')
    .select('id')
    .where('case_id', '=', c.id)
    .execute();
  return {
    gateCode: 'G1',
    evidenceSourceCount: await caseSourceCount(tx, c),
    sizing: sizing ? { committed: true, blockingChecks: checks.length } : null,
    materialUnknownsCount: unknowns.length,
    feasibilityRowsCount: feas.length,
  };
}

async function latestGate(tx: Tx, caseId: string, gate: GateCode): Promise<GateRow | undefined> {
  return (await tx
    .selectFrom('platform.gate_request')
    .selectAll()
    .where('case_id', '=', caseId)
    .where('gate_code', '=', gate)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()) as GateRow | undefined;
}

async function specialistReview(tx: Tx, caseId: string) {
  return tx
    .selectFrom('me.feasibility_assessment as a')
    .innerJoin('me.feasibility_review as r', 'r.id', 'a.current_review_id')
    .select(['r.position', 'r.covers_gate', 'r.max_sites', 'r.max_days', 'r.scope_text'])
    .where('a.case_id', '=', caseId)
    .where('a.dimension', '=', 'specialist_review')
    .executeTakeFirst();
}

export async function g2Facts(tx: Tx, c: CaseRecord): Promise<G2Facts> {
  const exps = await tx
    .selectFrom('me.experiment')
    .select(['id', 'display_key'])
    .where('case_id', '=', c.id)
    .execute();
  const results = exps.length
    ? await tx
        .selectFrom('me.experiment_result_version')
        .select('experiment_id')
        .where(
          'experiment_id',
          'in',
          exps.map((e) => e.id),
        )
        .execute()
    : [];
  const finance = await tx
    .selectFrom('me.model_review')
    .select(['position', 'signed_at'])
    .where('case_id', '=', c.id)
    .where('model_type', '=', 'economics')
    .orderBy('requested_at', 'desc')
    .executeTakeFirst();
  const spec = await specialistReview(tx, c.id);
  const gate = await latestGate(tx, c.id, 'G2');
  const scope = (gate?.scope ?? {}) as {
    maxSites?: number | null;
    ownerId?: string | null;
    durationDays?: number | null;
  };
  let stopRules: string[] = [];
  if (gate?.current_snapshot_id) {
    const s = await tx
      .selectFrom('platform.decision_snapshot')
      .select('content')
      .where('id', '=', gate.current_snapshot_id)
      .executeTakeFirst();
    stopRules = ((s?.content as { budgetAndStopRules?: string[] } | null)?.budgetAndStopRules ?? []).slice();
  }
  return {
    gateCode: 'G2',
    validationResults: exps.map((e) => ({
      experimentKey: e.display_key,
      resultRecorded: results.some((r) => r.experiment_id === e.id),
    })),
    financeReview: finance
      ? { signed: finance.signed_at !== null && SUPPORTS.has(finance.position ?? '') }
      : null,
    specialistSignOff: spec
      ? {
          signed: SUPPORTS.has(spec.position),
          coversGates: spec.covers_gate ? [spec.covers_gate as GateCode] : [],
          maxSites: spec.max_sites,
          maxDays: spec.max_days,
          scopeText: spec.scope_text,
        }
      : null,
    scope: {
      amount: gate?.requested_amount ?? null,
      currency: gate?.currency ?? null,
      durationDays: gate?.duration_days ?? scope.durationDays ?? null,
      maxSites: scope.maxSites ?? null,
      ownerId: scope.ownerId ?? null,
    },
    stopRules,
  };
}

export async function g3Facts(tx: Tx, c: CaseRecord): Promise<G3Facts> {
  const targets = await tx
    .selectFrom('platform.outcome_target')
    .selectAll()
    .where('case_id', '=', c.id)
    .execute();
  const obs = await tx
    .selectFrom('platform.outcome_observation')
    .selectAll()
    .where('case_id', '=', c.id)
    .orderBy('recorded_at', 'desc')
    .execute();
  const spec = await specialistReview(tx, c.id);
  const g2 = await latestGate(tx, c.id, 'G2');
  const econ = await tx
    .selectFrom('me.economics_version')
    .select('committed_at')
    .where('case_id', '=', c.id)
    .where('state', '=', 'committed')
    .orderBy('version', 'desc')
    .executeTakeFirst();
  const g3 = await latestGate(tx, c.id, 'G3');
  return {
    gateCode: 'G3',
    pilotTargets: targets.map((t) => {
      const o = obs.find((x) => x.target_id === t.id);
      return {
        metricKey: t.metric_key,
        name: t.name,
        operator: t.operator as 'gte',
        thresholdValue: t.threshold_value,
        observedValue: o?.value ?? null,
        result: (o?.result as 'met' | null) ?? null,
      };
    }),
    scaleReadiness: spec
      ? {
          signed: SUPPORTS.has(spec.position),
          coversGates: spec.covers_gate ? [spec.covers_gate as GateCode] : [],
          maxSites: spec.max_sites,
          maxDays: spec.max_days,
        }
      : null,
    economicsUpdatedAfterPilot: Boolean(
      econ?.committed_at && g2?.decided_at && econ.committed_at > g2.decided_at,
    ),
    capacityReviewed: false,
    scope: { amount: g3?.requested_amount ?? null, currency: g3?.currency ?? null },
  };
}

/** Evaluate G1–G3 for a case (G0 and X are evaluated from their own records). */
export async function evaluateCaseGate(
  tx: Tx,
  c: CaseRecord,
  gate: 'G1' | 'G2' | 'G3',
): Promise<GateEvaluation> {
  const facts =
    gate === 'G1' ? await g1Facts(tx, c) : gate === 'G2' ? await g2Facts(tx, c) : await g3Facts(tx, c);
  return evaluateGate(facts);
}
