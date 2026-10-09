/**
 * Profile `aster-demo` = aster-start + ME-104 history up to 26 Nov 2026 (BUILD_PLAN §7):
 * OPP-07 converted to ME-104 (OPP-12 merged), comparison, assumption register with Daniel's dispute,
 * sizing v2 and economics v2 committed, finance review signed, feasibility with Lena's scoped
 * sign-off, EXP-03 locked by G1 with amendment 1 and results, validation tasks confirmed VAL-1…5,
 * G2 snapshot v2 superseded and v3 awaiting Elena's decision with positions and dissent, and the
 * pilot plan draft (6 tasks). Stage: pilot_approval_pending.
 */
import { randomUUID } from 'node:crypto';
import type { ConditionInput, PersonRef, SnapshotContent } from '@growth-os/contracts';
import { externalTaskIdempotencyKey } from '@growth-os/connectors';
import {
  adoptionDispute,
  assumptions,
  authorityGrants,
  businessUnits,
  cases,
  comparison,
  connections,
  economicsMeta,
  economicsV2Input,
  exp03,
  expectedDisplay,
  feasibility,
  fid,
  gates,
  journeyMoments,
  mandate,
  opportunities,
  outboundDraft,
  outcomeTargets,
  people,
  pilotMilestones,
  pilotTasks,
  sizingMeta,
  sizingV2Input,
  sources,
  specialistQuestion,
  specialistSignOff,
  validationTasks,
} from '@growth-os/fixtures-aster';
import { at, seedAudit, type SeedCtx } from './context';
import { decide, insertSnapshot, setGateStatus, setSnapshotStatus } from './gates';
import { economicsRun, sizingRun } from './outputs';
import { opportunityId, setCounters, sourceId } from './start';

const U = people;
type Person = (typeof people)[keyof typeof people];

function ref(s: SeedCtx, p: Person): PersonRef {
  return { id: s.R.id(p.id), displayName: p.displayName, title: p.title, initials: p.initials };
}
const personById = (id: string): Person => {
  const p = Object.values(people).find((x) => x.id === id);
  if (!p) throw new Error(`seed: unknown person ${id}`);
  return p;
};

/** Assumption versions: every assumption has v1; ASM-01 and ASM-04 also v2 (pinned by sizing v2). */
const V2_KEYS = new Set(['ASM-01', 'ASM-04']);
const versionId = (s: SeedCtx, n: number, v: number): string => s.R.id(fid('assumptionVersion', n * 10 + v));
const asmNumber = (key: string): number => Number(key.slice(4));
const currentVersion = (key: string): number => (V2_KEYS.has(key) ? 2 : 1);

function valueText(a: (typeof assumptions)[number]): string {
  const v = a as Partial<{ value: string | null; valueText: string }>;
  if (v.value === null || v.value === undefined) return v.valueText ?? 'Unknown';
  switch (a.unit) {
    case 'rate':
      return `${Math.round(Number(v.value) * 100)}%`;
    case 'currency_per_year_per_site':
      return `€${Number(v.value).toLocaleString('en-GB')} per site per year`;
    case 'currency_per_year':
      return `€${Number(v.value).toLocaleString('en-GB')}/year`;
    case 'currency_one_time':
      return `€${Number(v.value).toLocaleString('en-GB')} one-time`;
    default:
      return `${Number(v.value).toLocaleString('en-GB')} ${a.unit}`;
  }
}

const CASE = cases[0];
const BU_WATER = businessUnits[0].id;
const SNAP = { g1v1: fid('snapshot', 1041), g2v2: fid('snapshot', 1042), g2v3: fid('snapshot', 1043) };
const TASKSET = { validation: fid('taskSet', 1), pilot: fid('taskSet', 2) };

export async function seedDemo(s: SeedCtx): Promise<void> {
  const { tx, R, tenantId } = s;
  const caseId = R.id(CASE.id);
  const maya = R.id(U.maya.id);
  const elena = R.id(U.elena.id);
  const daniel = R.id(U.daniel.id);
  const jonas = R.id(U.jonas.id);
  const lena = R.id(U.lena.id);

  // --- Discovery: shortlist, merge, compare, convert -------------------------------------------
  await tx
    .insertInto('platform.workflow_case')
    .values({
      id: caseId,
      tenant_id: tenantId,
      app_type: 'market_expansion',
      display_key: CASE.key,
      title: CASE.title,
      business_unit_id: R.id(BU_WATER),
      owner_user_id: maya,
      sponsor_user_id: elena,
      stage: 'pilot_approval_pending',
      origin_type: 'opportunity',
      origin_id: opportunityId(s, 'OPP-07'),
      mandate_id: R.id(mandate.id),
      created_by: maya,
      created_at: at(CASE.convertedAt),
    })
    .execute();
  for (const [p, role] of [
    [U.daniel, 'finance_reviewer'],
    [U.jonas, 'pilot_owner'],
    [U.priya, 'product_reviewer'],
    [U.lena, 'specialist_reviewer'],
    [U.opsLead, 'operations'],
  ] as const)
    await tx
      .insertInto('platform.case_participant')
      .values({
        tenant_id: tenantId,
        case_id: caseId,
        user_id: R.id(p.id),
        participant_role: role,
        added_at: at(CASE.convertedAt),
      })
      .execute();
  await tx
    .updateTable('me.opportunity')
    .set({ status: 'converted', converted_case_id: caseId })
    .where('id', '=', opportunityId(s, 'OPP-07'))
    .execute();
  await tx
    .updateTable('me.opportunity')
    .set({ status: 'duplicate', duplicate_of_id: opportunityId(s, 'OPP-07') })
    .where('id', '=', opportunityId(s, 'OPP-12'))
    .execute();

  const cmpId = R.id(comparison.id);
  await tx
    .insertInto('me.comparison')
    .values({
      id: cmpId,
      tenant_id: tenantId,
      mandate_id: R.id(mandate.id),
      opportunity_ids: comparison.opportunityKeys.map((k) => opportunityId(s, k)),
      common_unit_text: comparison.commonUnit,
      selected_opportunity_id: opportunityId(s, 'OPP-07'),
      created_by: maya,
      created_at: at(journeyMoments.compared),
    })
    .execute();
  await tx
    .insertInto('me.comparison_weights_version')
    .values({
      tenant_id: tenantId,
      comparison_id: cmpId,
      version: comparison.weights.version,
      product_fit: comparison.weights.productFit,
      channel_access: comparison.weights.channelAccess,
      evidence_coverage: comparison.weights.evidenceCoverage,
      applied_by: maya,
      applied_at: at(journeyMoments.compared),
    })
    .execute();
  const raters = { productFit: U.priya, channelAccess: U.jonas, evidenceCoverage: U.maya } as const;
  const attr = {
    productFit: 'product_fit',
    channelAccess: 'channel_access',
    evidenceCoverage: 'evidence_coverage',
  } as const;
  for (const key of comparison.opportunityKeys) {
    const ratings = comparison.ratings[key];
    for (const k of ['productFit', 'channelAccess', 'evidenceCoverage'] as const)
      await tx
        .insertInto('me.comparison_cell')
        .values({
          tenant_id: tenantId,
          comparison_id: cmpId,
          opportunity_id: opportunityId(s, key),
          attribute: attr[k],
          rating: ratings[k],
          value_text: ratings[k] === null ? 'Unknown' : null,
          rated_by: ratings[k] === null ? null : R.id(raters[k].id),
        })
        .execute();
    const o = opportunities.find((x) => x.key === key) as
      Partial<{ incomparableBoundary: string }> | undefined;
    if (o?.incomparableBoundary)
      await tx
        .insertInto('me.comparison_cell')
        .values({
          tenant_id: tenantId,
          comparison_id: cmpId,
          opportunity_id: opportunityId(s, key),
          attribute: 'market_boundary',
          value_text: o.incomparableBoundary,
          incomparable: true,
        })
        .execute();
  }
  for (const key of comparison.excludedUntilNormalized)
    await tx
      .insertInto('me.comparison_exclusion')
      .values({
        tenant_id: tenantId,
        comparison_id: cmpId,
        opportunity_id: opportunityId(s, key),
        reason: 'Excluded from ranking until its boundary is normalized (company counts, 2024 prices)',
        excluded_by: maya,
        excluded_at: at(journeyMoments.compared),
      })
      .execute();

  // --- Assumption register and Daniel's dispute -------------------------------------------------
  for (const a of assumptions) {
    const n = asmNumber(a.key);
    const v = a as Partial<{ value: string | null; valueText: string; currency: string; priceYear: number }>;
    await tx
      .insertInto('platform.assumption')
      .values({
        id: R.id(a.id),
        tenant_id: tenantId,
        case_id: caseId,
        display_key: a.key,
        input_key: a.inputKey,
        name: a.name,
        scenario: a.scenario,
        owner_user_id: R.id(a.ownerId),
        sensitivity: a.sensitivity,
        decision_critical: a.decisionCritical,
        consequence_if_false: a.consequenceIfFalse,
        validation_method: a.validationMethod,
        due_on: a.dueOn,
        status: a.status,
        created_by: maya,
        created_at: at('2026-10-09T10:00:00+02:00'),
      })
      .execute();
    for (let ver = 1; ver <= currentVersion(a.key); ver++)
      await tx
        .insertInto('platform.assumption_version')
        .values({
          id: versionId(s, n, ver),
          tenant_id: tenantId,
          assumption_id: R.id(a.id),
          version: ver,
          value: v.value ?? null,
          value_text: v.value === null || v.value === undefined ? (v.valueText ?? null) : null,
          unit: a.unit,
          currency: v.currency ?? null,
          price_year: v.priceYear ?? null,
          basis: a.basis,
          evidence_quality: a.evidenceQuality,
          origin: 'human',
          change_reason: ver === 1 ? null : 'Value re-confirmed for sizing v2',
          created_by: R.id(a.ownerId),
          created_at: at(ver === 1 ? '2026-10-09T10:00:00+02:00' : '2026-10-13T15:00:00+02:00'),
        })
        .execute();
    await tx
      .updateTable('platform.assumption')
      .set({ current_version_id: versionId(s, n, currentVersion(a.key)) })
      .where('id', '=', R.id(a.id))
      .execute();
  }
  const asmByInput = new Map<string, (typeof assumptions)[number]>(assumptions.map((a) => [a.inputKey, a]));
  const asmVersionFor = (inputKey: string): { assumptionId: string; versionId: string } => {
    const a = asmByInput.get(inputKey === 'annual_price' ? 'annual_spend_per_site' : inputKey);
    if (!a) throw new Error(`seed: no assumption for ${inputKey}`);
    return { assumptionId: R.id(a.id), versionId: versionId(s, asmNumber(a.key), currentVersion(a.key)) };
  };

  const disputeAsm = assumptions.find((a) => a.key === adoptionDispute.assumptionKey)!;
  const disputeId = R.id(adoptionDispute.id);
  await tx
    .insertInto('platform.challenge')
    .values({
      id: disputeId,
      tenant_id: tenantId,
      kind: 'dispute',
      target_type: 'assumption',
      target_id: R.id(disputeAsm.id),
      case_id: caseId,
      raised_by: R.id(adoptionDispute.raisedBy),
      statement: adoptionDispute.statement,
      proposed_value: adoptionDispute.proposedValue,
      status: 'open',
      created_at: at(adoptionDispute.raisedAt),
    })
    .execute();
  for (const r of adoptionDispute.replies)
    await tx
      .insertInto('platform.challenge_reply')
      .values({
        tenant_id: tenantId,
        challenge_id: disputeId,
        author_id: R.id(r.authorId),
        body: r.body,
        created_at: at(r.at),
      })
      .execute();

  // --- Sizing v2 and economics v2 (committed) ---------------------------------------------------
  const boundaryId = R.id(fid('boundary', 1));
  const b = sizingV2Input.boundary;
  await tx
    .insertInto('me.market_boundary')
    .values({
      id: boundaryId,
      tenant_id: tenantId,
      market_unit: b.marketUnit,
      population_unit: b.populationUnit,
      country_code: b.countryCode,
      segment_label: b.segmentLabel,
      product_boundary: 'Existing water-monitoring system (hardware, software and services, annual)',
      currency: b.currency,
      price_year: b.priceYear,
      includes_hardware: true,
      includes_software: true,
      includes_services: true,
      annualization_method: b.annualizationMethod,
    })
    .execute();

  const sizingInput = R.json(sizingV2Input);
  const sizing = await sizingRun(sizingInput);
  const sizingCalcId = randomUUID();
  await tx
    .insertInto('platform.calculation_result')
    .values({
      id: sizingCalcId,
      tenant_id: tenantId,
      engine: 'sizing',
      engine_version: sizing.engineVersion,
      input_hash: sizing.inputHash,
      input: JSON.stringify(sizingInput),
      output: JSON.stringify(sizing.output),
      blocked: sizing.blocked,
      created_at: at(journeyMoments.sizingCommitted),
    })
    .execute();
  const sizingId = R.id(sizingMeta.versionId);
  await tx
    .insertInto('me.sizing_version')
    .values({
      id: sizingId,
      tenant_id: tenantId,
      case_id: caseId,
      version: sizingMeta.version,
      state: 'draft',
      method: sizingInput.method,
      horizon_years: sizingInput.horizonYears,
      market_boundary_id: boundaryId,
      dedup_rule_text: sizingMeta.dedupRuleText,
      created_by: maya,
      created_at: at('2026-10-12T09:00:00+02:00'),
    })
    .execute();
  const ledger = [
    sizingInput.tamPopulation,
    sizingInput.annualSpendPerUnit,
    sizingInput.reachablePool,
    sizingInput.adoption.downside!,
    sizingInput.adoption.base,
    sizingInput.adoption.upside!,
    sizingInput.capacity,
  ];
  for (const inp of ledger) {
    const pinned = inp.kind === 'assumption' ? asmVersionFor(inp.inputKey) : null;
    await tx
      .insertInto('me.sizing_input')
      .values({
        tenant_id: tenantId,
        sizing_version_id: sizingId,
        input_key: inp.inputKey,
        label: inp.label,
        kind: inp.kind,
        value: inp.value,
        unit: inp.unit,
        currency: inp.currency,
        price_year: inp.priceYear,
        assumption_id: pinned?.assumptionId ?? null,
        assumption_version_id: pinned?.versionId ?? null,
        source_id: inp.kind === 'evidence' ? inp.ref.id : null,
        evidence_quality: inp.kind === 'evidence' ? 'strong' : null,
      })
      .execute();
  }
  for (const [i, c] of sizingInput.cohorts.entries())
    await tx
      .insertInto('me.cohort')
      .values({
        id: c.cohortId,
        tenant_id: tenantId,
        sizing_version_id: sizingId,
        name: c.name,
        rule: c.rule,
        site_count: c.siteCount,
        population_unit: c.populationUnit,
        price_year: c.priceYear,
        source_id: c.ref.id,
        status: c.status,
        ordinal: i + 1,
      })
      .execute();
  for (const o of sizingInput.overlaps)
    await tx
      .insertInto('me.cohort_overlap')
      .values({
        tenant_id: tenantId,
        sizing_version_id: sizingId,
        cohort_a_id: o.cohortAId,
        cohort_b_id: o.cohortBId,
        overlap_count: o.overlapCount,
        method_text: sizingMeta.overlapMethod,
      })
      .execute();
  await tx
    .updateTable('me.sizing_version')
    .set({
      state: 'committed',
      calculation_result_id: sizingCalcId,
      committed_at: at(sizingMeta.committedAt),
      committed_by: maya,
    })
    .where('id', '=', sizingId)
    .execute();

  const econInput = R.json(economicsV2Input);
  const econ = await economicsRun(econInput);
  const econCalcId = randomUUID();
  await tx
    .insertInto('platform.calculation_result')
    .values({
      id: econCalcId,
      tenant_id: tenantId,
      engine: 'economics',
      engine_version: econ.engineVersion,
      input_hash: econ.inputHash,
      input: JSON.stringify(econInput),
      output: JSON.stringify(econ.output),
      blocked: econ.blocked,
      created_at: at('2026-10-13T17:00:00+02:00'),
    })
    .execute();
  const econId = R.id(economicsMeta.versionId);
  await tx
    .insertInto('me.economics_version')
    .values({
      id: econId,
      tenant_id: tenantId,
      case_id: caseId,
      version: economicsMeta.version,
      state: 'draft',
      sizing_version_id: sizingId,
      currency: econInput.currency,
      price_year: econInput.priceYear,
      horizon_years: econInput.horizonYears,
      exclusions_text: economicsMeta.exclusionsText,
      created_by: maya,
      created_at: at('2026-10-13T09:00:00+02:00'),
    })
    .execute();
  const drivers = [
    econInput.annualPricePerCustomer,
    econInput.adoption.downside!,
    econInput.adoption.base,
    econInput.adoption.upside!,
    econInput.grossMargin,
    econInput.annualIncrementalOpex,
    econInput.capacity,
    econInput.oneTimeInvestment!,
    econInput.reachablePool,
  ];
  for (const d of drivers) {
    const pinned = asmVersionFor(d.inputKey);
    await tx
      .insertInto('me.economics_driver')
      .values({
        tenant_id: tenantId,
        economics_version_id: econId,
        input_key: d.inputKey,
        label: d.label,
        value: d.value,
        unit: d.unit,
        time_basis:
          d.unit === 'currency_one_time'
            ? 'one_time'
            : d.unit.startsWith('currency_per_year')
              ? 'per_year'
              : null,
        assumption_id: pinned.assumptionId,
        assumption_version_id: pinned.versionId,
      })
      .execute();
  }
  await tx
    .updateTable('me.economics_version')
    .set({
      state: 'committed',
      calculation_result_id: econCalcId,
      committed_at: at('2026-10-13T17:00:00+02:00'),
      committed_by: maya,
    })
    .where('id', '=', econId)
    .execute();
  const fr = economicsMeta.financeReview;
  await tx
    .insertInto('me.model_review')
    .values({
      tenant_id: tenantId,
      case_id: caseId,
      model_type: 'economics',
      model_version_id: econId,
      reviewer_user_id: R.id(fr.reviewerId),
      requested_by: maya,
      requested_at: at(fr.requestedAt),
      due_on: fr.dueOn,
      checked_items: [...fr.checkedItems],
      not_checked_items: [...fr.notCheckedItems],
      position: 'supports_with_conditions',
      statement:
        'Supports with conditions: margin definition, opex scope and EUR 2026 checked; ramp and cash timing not in the model.',
      signed_at: at('2026-11-24T16:30:00+01:00'),
    })
    .execute();

  // --- Feasibility (S07) -------------------------------------------------------------------------
  const reviewIds = new Map<string, string>();
  for (const f of feasibility) {
    const isSpecialist = f.dimension === 'specialist_review';
    const signed = f.status === 'signed' || isSpecialist; // Lena signed on 23 Nov
    await tx
      .insertInto('me.feasibility_assessment')
      .values({
        id: R.id(f.id),
        tenant_id: tenantId,
        case_id: caseId,
        dimension: f.dimension,
        question: isSpecialist ? specialistQuestion : f.question,
        evidence_text: f.evidenceText,
        reviewer_user_id: R.id(f.reviewerId),
        status: signed ? 'signed' : f.status,
        scope_text: isSpecialist ? specialistSignOff.scopeText : f.scopeText,
        due_on: f.dueOn,
        human_only: f.humanOnly,
      })
      .execute();
    if (signed) {
      const reviewId = randomUUID();
      reviewIds.set(f.dimension, reviewId);
      await tx
        .insertInto('me.feasibility_review')
        .values({
          id: reviewId,
          tenant_id: tenantId,
          assessment_id: R.id(f.id),
          version: 1,
          position: isSpecialist ? specialistSignOff.position : 'supports',
          scope_text: isSpecialist ? specialistSignOff.scopeText : f.scopeText,
          covers_gate: isSpecialist ? specialistSignOff.coversGate : null,
          max_sites: isSpecialist ? specialistSignOff.maxSites : null,
          max_days: isSpecialist ? specialistSignOff.maxDays : null,
          signed_by: R.id(f.reviewerId),
          signed_at: at(isSpecialist ? specialistSignOff.signedAt : '2026-10-12T17:00:00+02:00'),
        })
        .execute();
      await tx
        .updateTable('me.feasibility_assessment')
        .set({ current_review_id: reviewId })
        .where('id', '=', R.id(f.id))
        .execute();
    }
    const blocker = (f as Partial<{ blocker: { text: string; blocksGate: string } }>).blocker;
    if (blocker)
      await tx
        .insertInto('me.blocker')
        .values({
          tenant_id: tenantId,
          case_id: caseId,
          assessment_id: R.id(f.id),
          text: blocker.text,
          owner_user_id: lena,
          due_on: f.dueOn,
          blocks_gate: blocker.blocksGate,
          status: 'resolved',
          resolution: specialistSignOff.scopeText,
          resolved_by: lena,
          resolved_at: at(specialistSignOff.signedAt),
          created_at: at('2026-10-12T09:00:00+02:00'),
        })
        .execute();
  }

  // --- G1 and EXP-03 -----------------------------------------------------------------------------
  const expId = R.id(exp03.id);
  const p = exp03.originalPlan;
  await tx
    .insertInto('me.experiment')
    .values({
      id: expId,
      tenant_id: tenantId,
      case_id: caseId,
      display_key: exp03.key,
      title: exp03.title,
      lifecycle: 'draft',
      owner_user_id: R.id(exp03.ownerId),
      fieldwork_owner_user_id: R.id(exp03.fieldworkOwnerId),
      current_plan_version: 1,
      created_by: maya,
      created_at: at('2026-10-14T09:00:00+02:00'),
    })
    .execute();
  for (const k of exp03.linkedAssumptionKeys) {
    const a = assumptions.find((x) => x.key === k)!;
    await tx
      .insertInto('me.experiment_assumption')
      .values({ tenant_id: tenantId, experiment_id: expId, assumption_id: R.id(a.id) })
      .execute();
  }
  const planIds = [randomUUID(), randomUUID()];
  for (const [i, windowEnd] of [p.windowEnd, exp03.amendment1.newWindowEnd].entries()) {
    await tx
      .insertInto('me.experiment_plan_version')
      .values({
        id: planIds[i]!,
        tenant_id: tenantId,
        experiment_id: expId,
        version: i + 1,
        is_original: i === 0,
        hypothesis: p.hypothesis,
        method: p.method,
        sample_text: p.sampleText,
        sample_size: p.sampleSize,
        selection_text: p.selectionText,
        nonresponse_note: p.nonresponseNote,
        window_start: p.windowStart,
        window_end: windowEnd,
        budget_amount: p.budgetAmount,
        currency: p.currency,
        budget_note: p.budgetNote,
        decision_rules: JSON.stringify(p.decisionRules),
        created_by: maya,
        created_at: at(i === 0 ? '2026-10-14T09:00:00+02:00' : exp03.amendment1.at),
      })
      .execute();
    for (const m of p.metrics)
      await tx
        .insertInto('me.experiment_metric')
        .values({
          tenant_id: tenantId,
          plan_version_id: planIds[i]!,
          metric_key: m.metricKey,
          name: m.name,
          operator: m.operator,
          threshold_value: m.thresholdValue,
          threshold_text: m.thresholdText,
          unit: m.unit,
        })
        .execute();
  }

  const evidenceSummary = ['SRC-014', 'SRC-021', 'SRC-040'].map((k) => ({
    sourceId: sourceId(s, k),
    label: sources.find((x) => x.key === k)!.chipLabel,
  }));
  const pinnedAssumptions = assumptions.map((a) => ({
    assumptionId: R.id(a.id),
    versionId: versionId(s, asmNumber(a.key), currentVersion(a.key)),
    name: a.name,
    valueText: valueText(a),
    disputed: a.disputed,
  }));
  const econTable = [
    ['', 'Downside', 'Base', 'Upside'],
    ['Annual revenue', ...expectedDisplay.scenarioRevenue],
    ['Gross contribution', ...expectedDisplay.scenarioGross],
    ['Annual incremental opex', ...expectedDisplay.scenarioOpex],
    ['Contribution after incremental opex', ...expectedDisplay.scenarioAfterOpex],
  ];
  const sizingSummary = `TAM ${expectedDisplay.tam} · SAM ${expectedDisplay.sam} · Reachable ${expectedDisplay.reachablePool} · SOM Base Year 3 ${expectedDisplay.somBase}`;
  const sharedComponents: SnapshotContent['components'] = [
    { type: 'sizing_version', id: sizingId, version: sizingMeta.version },
    { type: 'economics_version', id: econId, version: economicsMeta.version },
    ...pinnedAssumptions.map((a) => ({
      type: 'assumption_version' as const,
      id: a.versionId,
      version: currentVersion(assumptions.find((x) => R.id(x.id) === a.assumptionId)!.key),
    })),
    ...evidenceSummary.map((e) => ({ type: 'source' as const, id: e.sourceId, version: null })),
  ];
  const caseScope = (g: {
    amount: string;
    durationDays?: number;
    windowStart?: string;
    windowEnd?: string;
    maxSites?: number;
    ownerId: string;
    authorizes: readonly string[];
    doesNotAuthorize: readonly string[];
  }) => ({
    amount: g.amount,
    currency: 'EUR',
    durationDays: g.durationDays ?? null,
    windowStart: g.windowStart ?? null,
    windowEnd: g.windowEnd ?? null,
    countryCodes: ['DE'],
    segmentLabel: 'Food processing',
    maxSites: g.maxSites ?? null,
    milestones: [] as string[],
    ownerId: g.ownerId,
    authorizes: [...g.authorizes],
    doesNotAuthorize: [...g.doesNotAuthorize],
  });
  const signOff = (
    dimension: string,
    area: 'product' | 'commercial' | 'specialist',
    person: Person,
    scopeText: string,
    signedAt: string,
  ) => ({
    reviewer: ref(s, person),
    area,
    position: 'supports' as const,
    scopeText,
    signedVersion: 1,
    signedAt: at(signedAt).toISOString(),
    _dimension: dimension,
  });
  const strip = <T extends { _dimension: string }>(x: T): Omit<T, '_dimension'> => {
    const { _dimension: _d, ...rest } = x;
    return rest;
  };

  const g1 = gates.g1;
  const g1Id = R.id(g1.id);
  const g1Content: SnapshotContent = {
    schemaVersion: 1,
    caseId,
    caseKey: CASE.key,
    gateCode: 'G1',
    ask: 'Approve validation outreach to 20 sites, up to €15k. This is not a pilot and not market entry.',
    scope: caseScope({
      amount: g1.amount,
      ownerId: maya,
      authorizes: g1.authorizes,
      doesNotAuthorize: g1.doesNotAuthorize,
    }),
    recommendation:
      'Approve the bounded validation: thresholds are pre-registered and the result changes the G2 decision.',
    alternatives: [{ name: 'No entry.', meaning: 'Stop at assessment; keep €15k.', isNoEntry: true }],
    evidenceSummary,
    assumptions: pinnedAssumptions,
    validationResults: [],
    economics: {
      economicsVersionId: econId,
      inputHash: econ.inputHash,
      tableText: econTable,
      note: `One-time scale-entry investment ${expectedDisplay.oneTime}, kept separate. Cash flow and payback not available.`,
    },
    sizing: { sizingVersionId: sizingId, inputHash: sizing.inputHash, summary: sizingSummary },
    signOffs: [
      strip(
        signOff(
          'differentiation',
          'product',
          U.priya,
          'Signed by Priya Shah · v2 · 12 Oct',
          '2026-10-12T17:00:00+02:00',
        ),
      ),
      strip(
        signOff(
          'commercial_access',
          'commercial',
          U.jonas,
          'Signed · reach stays an Assumption',
          '2026-10-12T17:00:00+02:00',
        ),
      ),
    ],
    budgetAndStopRules: [p.budgetNote, ...p.decisionRules.map((r) => `${r.condition} → ${r.action}`)],
    conditionsProposed: [],
    dissent: [],
    knownLimitations: ['20 selected sites are not a random sample.'],
    blockers: [],
    outcomeTargets: p.metrics.map((m) => ({
      metricKey: m.metricKey,
      name: m.name,
      thresholdText: m.thresholdText,
      window: `${p.windowStart} – ${p.windowEnd}`,
    })),
    components: [...sharedComponents, { type: 'experiment_plan_version', id: planIds[0]!, version: 1 }],
  };
  await tx
    .insertInto('platform.gate_request')
    .values({
      id: g1Id,
      tenant_id: tenantId,
      display_key: g1.key,
      case_id: caseId,
      subject_type: 'case',
      subject_id: caseId,
      business_unit_id: R.id(BU_WATER),
      gate_code: 'G1',
      status: 'awaiting_decision',
      scope: JSON.stringify(g1Content.scope),
      requested_amount: g1.amount,
      currency: g1.currency,
      submitted_by: maya,
      submitted_at: at(g1.submittedAt),
      created_by: maya,
      created_at: at(g1.submittedAt),
    })
    .execute();
  const g1Hash = await insertSnapshot(s, {
    id: R.id(SNAP.g1v1),
    gateRequestId: g1Id,
    caseId,
    subjectId: caseId,
    version: g1.snapshotVersion,
    content: g1Content,
    createdBy: maya,
    createdAt: g1.submittedAt,
  });
  await setGateStatus(s, g1Id, 'awaiting_decision', { currentSnapshotId: R.id(SNAP.g1v1) });
  await decide(s, {
    gateRequestId: g1Id,
    snapshotId: R.id(SNAP.g1v1),
    snapshotHash: g1Hash,
    approverId: elena,
    approverRole: 'sponsor',
    authorityGrantId: R.id(authorityGrants[1].id),
    disposition: g1.decision.disposition,
    rationale: g1.decision.rationale,
    decidedAt: g1.decision.at,
  });
  await setGateStatus(s, g1Id, 'approved', { decidedAt: g1.decision.at });

  // EXP-03 locked by G1, amended, results recorded.
  await tx
    .updateTable('me.experiment')
    .set({ lifecycle: 'locked', locked_by_gate_request_id: g1Id, locked_at: at(exp03.lockedAt) })
    .where('id', '=', expId)
    .execute();
  const am = exp03.amendment1;
  await tx
    .insertInto('me.experiment_amendment')
    .values({
      tenant_id: tenantId,
      experiment_id: expId,
      number: am.number,
      from_plan_version: 1,
      to_plan_version: 2,
      reason: am.reason,
      changed_fields: [...am.changedFields],
      thresholds_changed: am.thresholdsChanged,
      after_results_seen: am.afterResultsSeen,
      author_id: R.id(am.authorId),
      created_at: at(am.at),
    })
    .execute();
  const res = exp03.result;
  const resultId = randomUUID();
  await tx
    .insertInto('me.experiment_result_version')
    .values({
      id: resultId,
      tenant_id: tenantId,
      experiment_id: expId,
      version: res.version,
      observations: JSON.stringify(res.observations),
      period_start: res.periodStart,
      period_end: res.periodEnd,
      source_text: res.sourceText,
      interpretation: res.interpretation,
      limitations: res.limitations,
      recorded_by: R.id(res.recordedBy),
      recorded_at: at(res.recordedAt),
    })
    .execute();
  await tx
    .insertInto('me.experiment_decision')
    .values({
      tenant_id: tenantId,
      experiment_id: expId,
      decision_text: exp03.decisionTaken.text,
      decided_by: R.id(exp03.decisionTaken.by),
      decided_at: at(exp03.decisionTaken.at),
    })
    .execute();
  await tx
    .updateTable('me.experiment')
    .set({ lifecycle: 'result_recorded', current_plan_version: 2 })
    .where('id', '=', expId)
    .execute();

  // Validation tasks, confirmed in the simulated Jira (VAL-1 … VAL-5).
  const taskTool = R.id(connections[1].id);
  const valMapping = await tx
    .selectFrom('platform.connector_mapping')
    .select('id')
    .where('connection_id', '=', taskTool)
    .where('purpose', '=', 'validation_tasks')
    .executeTakeFirstOrThrow();
  const valSet = R.id(TASKSET.validation);
  await tx
    .insertInto('platform.task_set')
    .values({
      id: valSet,
      tenant_id: tenantId,
      case_id: caseId,
      owner_type: 'experiment',
      owner_id: expId,
      authorizing_gate_request_id: g1Id,
      connection_id: taskTool,
      mapping_id: valMapping.id,
      created_at: at(g1.decision.at),
    })
    .execute();
  for (const t of validationTasks) {
    const taskId = R.id(fid('task', 100 + t.ordinal));
    await tx
      .insertInto('platform.task')
      .values({
        id: taskId,
        tenant_id: tenantId,
        case_id: caseId,
        task_set_id: valSet,
        ordinal: t.ordinal,
        title: t.title,
        function: t.function,
        owner_user_id: R.id(t.ownerId),
        due_on: t.dueOn,
        deliverable: t.deliverable,
        status: 'done',
        completed_at: at(exp03.result.recordedAt),
      })
      .execute();
    const key = externalTaskIdempotencyKey({
      tenantId,
      planVersionId: planIds[0]!,
      taskId,
      connectionId: taskTool,
      project: 'ME-VAL',
    });
    await tx
      .insertInto('platform.external_task_link')
      .values({
        tenant_id: tenantId,
        task_id: taskId,
        connection_id: taskTool,
        idempotency_key: key,
        sync_status: 'confirmed',
        external_key: t.externalKey,
        attempts: 1,
        confirmed_at: at('2026-10-17T10:00:00+02:00'),
      })
      .execute();
    await tx
      .insertInto('sim.external_issue')
      .values({
        connection_id: taskTool,
        key: t.externalKey,
        project: 'ME-VAL',
        title: t.title,
        assignee: personById(t.ownerId).email,
        idempotency_key: key,
        created_at: at('2026-10-17T10:00:00+02:00'),
      })
      .execute();
  }
  await tx
    .insertInto('sim.project_counter')
    .values({ connection_id: taskTool, project: 'ME-VAL', next_value: 6 })
    .execute();

  // --- G2: snapshot v2 superseded, v3 awaiting decision -----------------------------------------
  const g2 = gates.g2;
  const g2Id = R.id(g2.id);
  const conditions: ConditionInput[] = g2.conditions.map((c) => ({
    text: c.text,
    ownerId: R.id(c.ownerId),
    dueOn: c.dueOn,
    dueRule: c.dueRule,
    flag: c.blocksExecution ? 'blocks_execution' : 'monitor_only',
  }));
  const positions = g2.positions.map((pos) => ({
    reviewer: ref(s, personById(pos.reviewerId)),
    area: pos.area,
    position: pos.position,
    scopeText: pos.scopeText,
    signedVersion: 3,
    signedAt: at('2026-11-24T17:00:00+01:00').toISOString(),
  }));
  const g2Base = {
    schemaVersion: 1 as const,
    caseId,
    caseKey: CASE.key,
    gateCode: 'G2' as const,
    ask: g2.ask,
    scope: caseScope({
      amount: g2.amount,
      durationDays: g2.durationDays,
      windowStart: g2.windowStart,
      windowEnd: g2.windowEnd,
      maxSites: g2.maxSites,
      ownerId: jonas,
      authorizes: g2.authorizes,
      doesNotAuthorize: g2.doesNotAuthorize,
    }),
    recommendation: g2.recommendation,
    alternatives: g2.alternatives.map((a) => ({ ...a })),
    evidenceSummary,
    assumptions: pinnedAssumptions,
    validationResults: [
      {
        experimentId: expId,
        resultVersionId: resultId,
        summary: 'Met · 9 of 8 interviews; Met · 4 of 4 commitments',
        limitations: res.limitations,
      },
    ],
    economics: g1Content.economics,
    sizing: g1Content.sizing,
    knownLimitations: [...g2.knownLimitations],
    blockers: [],
    outcomeTargets: outcomeTargets.map((t) => ({
      metricKey: t.metricKey,
      name: t.name,
      thresholdText: t.thresholdText,
      window: t.windowText,
    })),
  };
  const resultComponent = { type: 'experiment_result_version' as const, id: resultId, version: 1 };
  const reviewComponents = [...reviewIds.values()].map((id) => ({
    type: 'feasibility_review' as const,
    id,
    version: 1,
  }));
  const v2Content: SnapshotContent = {
    ...g2Base,
    signOffs: positions.filter((x) => x.area !== 'specialist'),
    budgetAndStopRules: [g2.stopRules[0]!],
    conditionsProposed: [],
    dissent: [],
    components: [...sharedComponents, resultComponent, ...reviewComponents.slice(0, -1)],
  };
  const v3Content: SnapshotContent = {
    ...g2Base,
    signOffs: positions,
    budgetAndStopRules: [...g2.stopRules],
    conditionsProposed: conditions,
    dissent: [
      {
        author: ref(s, U.daniel),
        authorRole: 'Finance partner',
        statement: g2.dissent.statement,
        scopeText: g2.dissent.scopeText,
        signedAt: at(g2.dissent.signedAt).toISOString(),
        signedSnapshotVersion: 3,
      },
    ],
    components: [...sharedComponents, resultComponent, ...reviewComponents],
  };
  const [sv2, sv3] = g2.snapshots;
  await tx
    .insertInto('platform.gate_request')
    .values({
      id: g2Id,
      tenant_id: tenantId,
      display_key: g2.key,
      case_id: caseId,
      subject_type: 'case',
      subject_id: caseId,
      business_unit_id: R.id(BU_WATER),
      gate_code: 'G2',
      status: 'awaiting_decision',
      scope: JSON.stringify(v3Content.scope),
      requested_amount: g2.amount,
      currency: g2.currency,
      duration_days: g2.durationDays,
      submitted_by: maya,
      submitted_at: at(sv2.createdAt),
      expires_at: null,
      created_by: maya,
      created_at: at(sv2.createdAt),
    })
    .execute();
  await insertSnapshot(s, {
    id: R.id(SNAP.g2v2),
    gateRequestId: g2Id,
    caseId,
    subjectId: caseId,
    version: sv2.version,
    content: v2Content,
    createdBy: maya,
    createdAt: sv2.createdAt,
  });
  await insertSnapshot(s, {
    id: R.id(SNAP.g2v3),
    gateRequestId: g2Id,
    caseId,
    subjectId: caseId,
    version: sv3.version,
    content: v3Content,
    createdBy: maya,
    createdAt: sv3.createdAt,
  });
  await setSnapshotStatus(s, R.id(SNAP.g2v2), 'superseded', R.id(SNAP.g2v3));
  await setGateStatus(s, g2Id, 'awaiting_decision', {
    currentSnapshotId: R.id(SNAP.g2v3),
    submittedAt: sv3.createdAt,
  });
  for (const pos of g2.positions)
    await tx
      .insertInto('platform.reviewer_position')
      .values({
        tenant_id: tenantId,
        snapshot_id: R.id(SNAP.g2v3),
        reviewer_user_id: R.id(pos.reviewerId),
        area: pos.area,
        position: pos.position,
        scope_text: pos.scopeText,
        signed_at: at('2026-11-25T17:00:00+01:00'),
      })
      .execute();
  await tx
    .insertInto('platform.dissent')
    .values({
      tenant_id: tenantId,
      case_id: caseId,
      author_id: daniel,
      statement: g2.dissent.statement,
      scope_text: g2.dissent.scopeText,
      signed_snapshot_id: R.id(SNAP.g2v3),
      signed_at: at(g2.dissent.signedAt),
    })
    .execute();
  for (const t of outcomeTargets)
    await tx
      .insertInto('platform.outcome_target')
      .values({
        id: R.id(t.id),
        tenant_id: tenantId,
        case_id: caseId,
        snapshot_id: R.id(SNAP.g2v3),
        metric_key: t.metricKey,
        name: t.name,
        threshold_text: t.thresholdText,
        operator: t.operator,
        threshold_value: t.thresholdValue,
        unit: t.unit,
        window_text: t.windowText,
      })
      .execute();

  // --- Pilot plan draft (S11) ---------------------------------------------------------------------
  const pilotMapping = await tx
    .selectFrom('platform.connector_mapping')
    .select('id')
    .where('connection_id', '=', taskTool)
    .where('purpose', '=', 'pilot_tasks')
    .executeTakeFirstOrThrow();
  const pilotPlanId = randomUUID();
  const pilotVersionId = randomUUID();
  const pilotSet = R.id(TASKSET.pilot);
  await tx
    .insertInto('me.pilot_plan')
    .values({
      id: pilotPlanId,
      tenant_id: tenantId,
      case_id: caseId,
      gate_request_id: g2Id,
      status: 'draft',
      created_at: at(sv2.createdAt),
    })
    .execute();
  await tx
    .insertInto('platform.task_set')
    .values({
      id: pilotSet,
      tenant_id: tenantId,
      case_id: caseId,
      owner_type: 'pilot_plan_version',
      owner_id: pilotVersionId,
      authorizing_gate_request_id: g2Id,
      connection_id: taskTool,
      mapping_id: pilotMapping.id,
      created_at: at(sv2.createdAt),
    })
    .execute();
  await tx
    .insertInto('me.pilot_plan_version')
    .values({
      id: pilotVersionId,
      tenant_id: tenantId,
      pilot_plan_id: pilotPlanId,
      version: 1,
      state: 'draft',
      baseline_snapshot_id: R.id(SNAP.g2v3),
      budget_ceiling: g2.amount,
      currency: g2.currency,
      window_start: g2.windowStart,
      window_end: g2.windowEnd,
      scope_text: `Up to ${g2.maxSites} German food-processing sites · ${g2.durationDays} days`,
      thresholds_text: outcomeTargets.map((t) => `${t.name}: ${t.thresholdText}`),
      task_set_id: pilotSet,
      created_by: jonas,
      created_at: at(sv2.createdAt),
    })
    .execute();
  await tx
    .updateTable('me.pilot_plan')
    .set({ draft_version_id: pilotVersionId })
    .where('id', '=', pilotPlanId)
    .execute();
  for (const m of pilotMilestones)
    await tx
      .insertInto('platform.milestone')
      .values({
        id: R.id(m.id),
        tenant_id: tenantId,
        task_set_id: pilotSet,
        name: m.name,
        window_text: m.windowText,
        ordinal: m.ordinal,
      })
      .execute();
  for (const t of pilotTasks) {
    const extra = t as Partial<{ conditionKey: string }>;
    await tx
      .insertInto('platform.task')
      .values({
        id: R.id(t.id),
        tenant_id: tenantId,
        case_id: caseId,
        task_set_id: pilotSet,
        ordinal: t.ordinal,
        title: t.title,
        milestone_id: R.id(pilotMilestones[t.milestone - 1]!.id),
        function: t.function,
        owner_user_id: R.id(t.ownerId),
        due_on: t.dueOn,
        due_rule: t.dueRule,
        deliverable: t.deliverable,
        condition_key: extra.conditionKey ?? null,
      })
      .execute();
  }
  for (const t of pilotTasks)
    for (const dep of t.dependsOn)
      await tx
        .insertInto('platform.task_dependency')
        .values({
          tenant_id: tenantId,
          task_id: R.id(t.id),
          depends_on_task_id: R.id(pilotTasks[dep - 1]!.id),
        })
        .execute();
  await tx
    .insertInto('me.message_draft')
    .values({
      tenant_id: tenantId,
      case_id: caseId,
      title: outboundDraft.title,
      body: outboundDraft.body,
      origin: outboundDraft.origin,
      created_by: jonas,
      created_at: at(sv2.createdAt),
    })
    .execute();

  await setCounters(s, { ME: 106, EXP: 4, ASM: 12, CMP: 2 });

  const history: [string, string, string, string][] = [
    [
      'seed.case_converted',
      'case',
      'OPP-07 converted to ME-104 by Maya Rao (stage Discovery); OPP-12 merged into OPP-07',
      CASE.convertedAt,
    ],
    [
      'seed.sizing_committed',
      'sizing_version',
      'Sizing v2 committed: TAM €100m/year · SAM €40m/year · reachable 500 sites',
      sizingMeta.committedAt,
    ],
    [
      'seed.assumption_disputed',
      'assumption',
      'Daniel Weber disputed ASM-01 adoption 20% (proposed Downside 10%)',
      adoptionDispute.raisedAt,
    ],
    [
      'seed.gate_decided',
      'gate_request',
      'G1 approved by Elena Fischer: Approve validation €15k (snapshot v1)',
      g1.decision.at,
    ],
    [
      'seed.experiment_result',
      'experiment',
      'EXP-03 results recorded: Met · 9 of 8; Met · 4 of 4',
      res.recordedAt,
    ],
    [
      'seed.feasibility_signed',
      'feasibility_review',
      'Lena Hoffmann signed for pilot only: up to 4 sites, 90 days',
      specialistSignOff.signedAt,
    ],
    [
      'seed.gate_submitted',
      'gate_request',
      'G2 snapshot v3 submitted (v2 superseded); awaiting Elena Fischer',
      sv3.createdAt,
    ],
  ];
  const objectFor: Record<string, string> = {
    case: caseId,
    sizing_version: sizingId,
    assumption: R.id(disputeAsm.id),
    gate_request: g2Id,
    experiment: expId,
    feasibility_review: reviewIds.get('specialist_review')!,
  };
  for (const [action, objectType, summary, occurredAt] of history)
    await seedAudit(s, {
      action,
      objectType,
      objectId: action === 'seed.gate_decided' ? g1Id : objectFor[objectType]!,
      caseId,
      summary,
      occurredAt,
    });
}
