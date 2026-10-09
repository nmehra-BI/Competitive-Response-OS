/** Assumption register and challenge serializers (S09, S05). Exported for thesis, sizing and WS4b. */
import type {
  Assumption,
  AssumptionVersion,
  Challenge,
  EvidenceQuality,
  RegisterGroup,
  Sensitivity,
} from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { isoDateOrNull, isoDateTime, isoDateTimeOrNull } from '../../../platform/serialize';
import { caseHref, moneyString, peopleMap, trimDecimal, who } from '../cases/access';

export type AssumptionRow = {
  id: string;
  case_id: string;
  display_key: string;
  input_key: string;
  name: string;
  scenario: string | null;
  owner_user_id: string;
  sensitivity: string;
  decision_critical: boolean;
  consequence_if_false: string;
  validation_method: string;
  due_on: string | Date | null;
  status: string;
  status_detail: string | null;
  retired_reason: string | null;
  current_version_id: string | null;
  row_version: number;
};

export type VersionRow = {
  id: string;
  assumption_id: string;
  version: number;
  value: string | null;
  value_text: string | null;
  unit: string;
  currency: string | null;
  price_year: number | null;
  basis: string;
  evidence_quality: string;
  origin: string;
  agent_run_id: string | null;
  change_reason: string | null;
  created_by: string;
  created_at: Date;
};

const MONEY_UNITS = new Set(['currency_per_year_per_site', 'currency_per_year', 'currency_one_time']);

/** Decimal text as stored for an engine input: money keeps 2 fraction digits, others are trimmed. */
export const valueString = (v: string, unit: string) => (MONEY_UNITS.has(unit) ? moneyString(v) : trimDecimal(v));

const WEAK = new Set<EvidenceQuality>(['none', 'weak', 'conflicting']);
const SENS_ORDER: Sensitivity[] = ['high', 'medium', 'low'];
const QUALITY_ORDER: EvidenceQuality[] = ['none', 'conflicting', 'weak', 'some', 'strong'];

/** Sensitivity first, then evidence quality. No combined score. */
export function registerGroup(sensitivity: Sensitivity, quality: EvidenceQuality, retired: boolean): RegisterGroup {
  if (retired || sensitivity === 'low') return 'monitor';
  if (sensitivity === 'high') return WEAK.has(quality) ? 'test_first' : quality === 'some' ? 'test_next' : 'watch';
  return WEAK.has(quality) ? 'test_next' : 'watch';
}

export function sortRegister<T extends { sensitivity: Sensitivity; current: { evidenceQuality: EvidenceQuality }; status: string }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      Number(a.status === 'retired') - Number(b.status === 'retired') ||
      SENS_ORDER.indexOf(a.sensitivity) - SENS_ORDER.indexOf(b.sensitivity) ||
      QUALITY_ORDER.indexOf(a.current.evidenceQuality) - QUALITY_ORDER.indexOf(b.current.evidenceQuality),
  );
}

export async function challengesWhere(
  tx: Tx,
  where: { ids?: string[]; caseId?: string; targetType?: string; targetIds?: string[]; openOnly?: boolean },
): Promise<Challenge[]> {
  let q = tx.selectFrom('platform.challenge').selectAll();
  if (where.ids) q = q.where('id', 'in', where.ids.length ? where.ids : ['00000000-0000-4000-8000-000000000000']);
  if (where.caseId) q = q.where('case_id', '=', where.caseId);
  if (where.targetType) q = q.where('target_type', '=', where.targetType);
  if (where.targetIds) {
    if (where.targetIds.length === 0) return [];
    q = q.where('target_id', 'in', where.targetIds);
  }
  if (where.openOnly) q = q.where('status', '=', 'open');
  const rows = await q.orderBy('created_at').execute();
  const replies = rows.length
    ? await tx
        .selectFrom('platform.challenge_reply')
        .selectAll()
        .where(
          'challenge_id',
          'in',
          rows.map((r) => r.id),
        )
        .orderBy('created_at')
        .execute()
    : [];
  const people = await peopleMap(tx, [...rows.flatMap((r) => [r.raised_by, r.resolved_by]), ...replies.map((r) => r.author_id)]);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as Challenge['kind'],
    targetType: r.target_type as Challenge['targetType'],
    targetId: r.target_id,
    caseId: r.case_id,
    raisedBy: who(people, r.raised_by),
    statement: r.statement,
    proposedValue: r.proposed_value,
    status: r.status as Challenge['status'],
    resolution: r.resolution,
    resolvedBy: r.resolved_by ? who(people, r.resolved_by) : null,
    resolvedAt: isoDateTimeOrNull(r.resolved_at),
    createdAt: isoDateTime(r.created_at),
    replies: replies
      .filter((x) => x.challenge_id === r.id)
      .map((x) => ({ id: x.id, author: who(people, x.author_id), body: x.body, createdAt: isoDateTime(x.created_at) })),
  }));
}

export function toVersion(v: VersionRow, people: Awaited<ReturnType<typeof peopleMap>>): AssumptionVersion {
  return {
    id: v.id,
    assumptionId: v.assumption_id,
    version: v.version,
    value: v.value === null ? null : valueString(v.value, v.unit),
    valueText: v.value_text,
    unit: v.unit as AssumptionVersion['unit'],
    currency: v.currency,
    priceYear: v.price_year,
    basis: v.basis,
    evidenceQuality: v.evidence_quality as EvidenceQuality,
    sources: [],
    origin: v.origin as AssumptionVersion['origin'],
    agentRunId: v.agent_run_id,
    changeReason: v.change_reason,
    createdBy: who(people, v.created_by),
    createdAt: isoDateTime(v.created_at),
  };
}

export async function toAssumptions(tx: Tx, rows: readonly AssumptionRow[], caseKey: string): Promise<Assumption[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const versions = (await tx
    .selectFrom('platform.assumption_version')
    .selectAll()
    .where('id', 'in', rows.map((r) => r.current_version_id).filter((x): x is string => !!x))
    .execute()) as VersionRow[];
  const disputes = await challengesWhere(tx, { targetType: 'assumption', targetIds: ids, openOnly: true });
  const exps = await tx.selectFrom('me.experiment_assumption').selectAll().where('assumption_id', 'in', ids).execute();
  const sizing = await tx
    .selectFrom('me.sizing_input as i')
    .innerJoin('me.sizing_version as v', 'v.id', 'i.sizing_version_id')
    .select(['i.assumption_id', 'v.version', 'v.state', 'i.label'])
    .where('i.assumption_id', 'in', ids)
    .execute();
  const econ = await tx
    .selectFrom('me.economics_driver as d')
    .innerJoin('me.economics_version as v', 'v.id', 'd.economics_version_id')
    .select(['d.assumption_id', 'v.version', 'v.state'])
    .where('d.assumption_id', 'in', ids)
    .execute();
  const people = await peopleMap(tx, [...rows.map((r) => r.owner_user_id), ...versions.map((v) => v.created_by)]);
  const latest = <T extends { version: number; state: string }>(xs: T[]) =>
    xs.filter((x) => x.state === 'committed').sort((a, b) => b.version - a.version)[0];
  const items = rows.map((r): Assumption => {
    const v = versions.find((x) => x.id === r.current_version_id)!;
    const current = toVersion(v, people);
    const s = latest(sizing.filter((x) => x.assumption_id === r.id));
    const e = latest(econ.filter((x) => x.assumption_id === r.id));
    const usedBy = [
      ...(s ? [{ label: `Sizing v${s.version} · ${s.label}`, href: caseHref(caseKey, 'sizing') }] : []),
      ...(e ? [{ label: `Economics v${e.version}`, href: caseHref(caseKey, 'economics') }] : []),
    ];
    return {
      id: r.id,
      key: r.display_key,
      caseId: r.case_id,
      inputKey: r.input_key,
      name: r.name,
      scenario: r.scenario as Assumption['scenario'],
      owner: who(people, r.owner_user_id),
      sensitivity: r.sensitivity as Sensitivity,
      decisionCritical: r.decision_critical,
      consequenceIfFalse: r.consequence_if_false,
      validationMethod: r.validation_method,
      linkedExperimentIds: exps.filter((x) => x.assumption_id === r.id).map((x) => x.experiment_id),
      dueOn: isoDateOrNull(r.due_on),
      status: r.status as Assumption['status'],
      statusDetail: r.status_detail,
      retiredReason: r.retired_reason,
      current,
      registerGroup: registerGroup(r.sensitivity as Sensitivity, current.evidenceQuality, r.status === 'retired'),
      openDispute: disputes.filter((d) => d.targetId === r.id).pop() ?? null,
      usedBy,
      rowVersion: r.row_version,
    };
  });
  return sortRegister(items);
}

export async function caseAssumptions(tx: Tx, caseId: string, caseKey: string): Promise<Assumption[]> {
  const rows = (await tx.selectFrom('platform.assumption').selectAll().where('case_id', '=', caseId).execute()) as AssumptionRow[];
  return toAssumptions(tx, rows, caseKey);
}

/** Business name for materiality copy: "adoption assumption changed on 26 Nov". */
export function assumptionLabel(inputKey: string, displayKey: string): string {
  if (inputKey.startsWith('adoption_rate')) return 'adoption assumption';
  const map: Record<string, string> = {
    annual_spend_per_site: 'price assumption',
    annual_price: 'price assumption',
    reachable_pool: 'reachable pool assumption',
    capacity: 'capacity assumption',
    gross_margin: 'margin assumption',
    annual_incremental_opex: 'opex assumption',
    one_time_investment: 'investment assumption',
  };
  return map[inputKey] ?? `assumption ${displayKey}`;
}
