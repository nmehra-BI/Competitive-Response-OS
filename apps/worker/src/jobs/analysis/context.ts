/**
 * Structured, permission-filtered case context for a run (ARCHITECTURE §12.1: "instructions +
 * permitted context"). Ids, keys, labels, statuses and committed engine inputs only — never source
 * text (that reaches the model only through evidence.get as untrusted data) and nothing the
 * requester cannot read.
 */
import type { Tx } from '@growth-os/db';
import { canReadCase, canReadMandate, loadRequester } from './access';

export interface RunSubject {
  caseId: string | null;
  mandateId: string | null;
  requestedBy: string;
}

async function people(tx: Tx, businessUnitId: string) {
  const rows = await tx
    .selectFrom('platform.app_user as u')
    .innerJoin('platform.role_assignment as r', 'r.user_id', 'u.id')
    .select(['u.id', 'u.display_name', 'r.role'])
    .where('u.kind', '=', 'human')
    .where('u.is_active', '=', true)
    .where('r.revoked_at', 'is', null)
    .where('r.role', '<>', 'tenant_admin')
    .where((eb) =>
      eb.or([eb('r.business_unit_id', '=', businessUnitId), eb('r.business_unit_id', 'is', null)]),
    )
    .orderBy('u.display_name')
    .execute();
  const byId = new Map<string, { id: string; name: string; roles: string[] }>();
  for (const r of rows) {
    const p = byId.get(r.id) ?? { id: r.id, name: r.display_name, roles: [] };
    p.roles.push(r.role);
    byId.set(r.id, p);
  }
  return [...byId.values()];
}

async function latestInput(tx: Tx, table: 'me.sizing_version' | 'me.economics_version', caseId: string) {
  const row = await tx
    .selectFrom(`${table} as v`)
    .innerJoin('platform.calculation_result as c', 'c.id', 'v.calculation_result_id')
    .select(['v.id', 'v.version', 'c.input'])
    .where('v.case_id', '=', caseId)
    .where('v.state', '=', 'committed')
    .orderBy('v.version', 'desc')
    .executeTakeFirst();
  return row ?? null;
}

export async function loadCaseContext(tx: Tx, s: RunSubject): Promise<Record<string, unknown>> {
  const r = await loadRequester(tx, s.requestedBy);
  if (!r) return {};
  if (s.mandateId && !s.caseId) {
    const m = await tx
      .selectFrom('me.mandate as m')
      .leftJoin('me.mandate_version as v', 'v.id', 'm.current_version_id')
      .select([
        'm.id',
        'm.display_key',
        'm.title',
        'm.status',
        'm.business_unit_id',
        'v.objective',
        'v.product_id',
        'v.segment_ids',
        'v.geography_codes',
        'v.exclusions',
        'v.horizon_years',
      ])
      .where('m.id', '=', s.mandateId)
      .executeTakeFirst();
    if (!m || !canReadMandate(r, { businessUnitId: m.business_unit_id })) return {};
    const opps = await tx
      .selectFrom('me.opportunity')
      .select(['id', 'display_key', 'name', 'status', 'country_code', 'likely_duplicate_of_id'])
      .where('mandate_id', '=', m.id)
      .orderBy('display_key')
      .execute();
    return {
      type: 'mandate',
      id: m.id,
      key: m.display_key,
      title: m.title,
      status: m.status,
      objective: m.objective,
      productId: m.product_id,
      segmentIds: m.segment_ids ?? [],
      geographyCodes: m.geography_codes ?? [],
      exclusions: m.exclusions ?? [],
      horizonYears: m.horizon_years,
      opportunities: opps.map((o) => ({
        id: o.id,
        key: o.display_key,
        name: o.name,
        status: o.status,
        countryCode: o.country_code,
        likelyDuplicateOfId: o.likely_duplicate_of_id,
      })),
    };
  }
  if (!s.caseId) return {};
  const c = await tx
    .selectFrom('platform.workflow_case')
    .select([
      'id',
      'display_key',
      'title',
      'stage',
      'business_unit_id',
      'owner_user_id',
      'sponsor_user_id',
      'mandate_id',
    ])
    .where('id', '=', s.caseId)
    .executeTakeFirst();
  if (
    !c ||
    !canReadCase(r, {
      id: c.id,
      businessUnitId: c.business_unit_id,
      ownerUserId: c.owner_user_id,
      sponsorUserId: c.sponsor_user_id,
    })
  )
    return {};
  const [assumptions, sizing, economics, experiments, targets, observations, team] = await Promise.all([
    tx
      .selectFrom('platform.assumption as a')
      .leftJoin('platform.assumption_version as v', 'v.id', 'a.current_version_id')
      .select([
        'a.id',
        'a.display_key',
        'a.name',
        'a.input_key',
        'a.scenario',
        'a.sensitivity',
        'a.decision_critical',
        'a.status',
        'v.value',
        'v.unit',
        'v.evidence_quality',
      ])
      .where('a.case_id', '=', c.id)
      .where('a.status', '<>', 'retired')
      .orderBy('a.display_key')
      .execute(),
    latestInput(tx, 'me.sizing_version', c.id),
    latestInput(tx, 'me.economics_version', c.id),
    tx
      .selectFrom('me.experiment')
      .select(['id', 'display_key', 'title', 'lifecycle'])
      .where('case_id', '=', c.id)
      .orderBy('display_key')
      .execute(),
    tx
      .selectFrom('platform.outcome_target')
      .select(['id', 'metric_key', 'name', 'threshold_text', 'window_text'])
      .where('case_id', '=', c.id)
      .execute(),
    tx
      .selectFrom('platform.outcome_observation')
      .select([
        'id',
        'target_id',
        'label',
        'value_text',
        'result',
        'period_start',
        'period_end',
        'source_text',
      ])
      .where('case_id', '=', c.id)
      .orderBy('recorded_at')
      .execute(),
    people(tx, c.business_unit_id),
  ]);
  const cohorts = sizing
    ? await tx
        .selectFrom('me.cohort')
        .select(['id', 'name', 'qualifier', 'site_count', 'status'])
        .where('sizing_version_id', '=', sizing.id)
        .orderBy('ordinal')
        .execute()
    : [];
  return {
    type: 'case',
    id: c.id,
    key: c.display_key,
    title: c.title,
    stage: c.stage,
    mandateId: c.mandate_id,
    ownerId: c.owner_user_id,
    sponsorId: c.sponsor_user_id,
    people: team,
    assumptions: assumptions.map((a) => ({
      id: a.id,
      key: a.display_key,
      name: a.name,
      inputKey: a.input_key,
      scenario: a.scenario,
      sensitivity: a.sensitivity,
      decisionCritical: a.decision_critical,
      status: a.status,
      value: a.value,
      unit: a.unit,
      evidenceQuality: a.evidence_quality,
    })),
    sizingVersion: sizing ? { id: sizing.id, version: sizing.version } : null,
    sizingInput: sizing?.input ?? null,
    cohorts: cohorts.map((k) => ({
      id: k.id,
      name: k.name,
      label: k.qualifier ? `${k.name} ${k.qualifier}` : k.name,
      siteCount: k.site_count,
      status: k.status,
    })),
    economicsVersion: economics ? { id: economics.id, version: economics.version } : null,
    economicsInput: economics?.input ?? null,
    experiments: experiments.map((e) => ({
      id: e.id,
      key: e.display_key,
      title: e.title,
      lifecycle: e.lifecycle,
    })),
    targets: targets.map((t) => ({
      id: t.id,
      metricKey: t.metric_key,
      name: t.name,
      thresholdText: t.threshold_text,
      windowText: t.window_text,
    })),
    observations: observations.map((o) => ({
      id: o.id,
      targetId: o.target_id,
      label: o.label,
      valueText: o.value_text,
      result: o.result,
      period: `${o.period_start} – ${o.period_end}`,
      sourceText: o.source_text,
    })),
  };
}
