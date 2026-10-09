/**
 * Economics serializers (S08). Exported for WS4b snapshot content (`committedEconomicsSummary`): the
 * scenario table rows are per-year only; the one-time investment is reported separately and cash
 * flow / payback stay "Not available".
 */
import type { EconomicsOutput, EconomicsVersion, EconomicsView, ModelReview } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import type { Identity } from '../../../platform/context';
import { isoDateOrNull, isoDateTime, isoDateTimeOrNull } from '../../../platform/serialize';
import { moneyLabel, peopleMap, who } from '../cases/access';
import { calcOutput, ledgerRows } from '../sizing/read';
import { driverRows, economicsVersions, type EconomicsVersionRow } from './model';

export async function toEconomicsVersion(
  tx: Tx,
  identity: Identity,
  v: EconomicsVersionRow,
  compareTo?: Map<string, string>,
): Promise<EconomicsVersion> {
  const result = await calcOutput<EconomicsOutput>(tx, v.calculation_result_id);
  const rows = await driverRows(tx, v.id);
  const drivers = await ledgerRows(
    tx,
    identity,
    rows.map((r) => ({
      input_key: r.input_key,
      label: r.label,
      value: r.value,
      unit: r.unit,
      currency: r.unit.startsWith('currency') ? v.currency : null,
      kind: 'assumption',
      source_id: null,
      assumption_id: r.assumption_id,
      assumption_version_id: r.assumption_version_id,
      evidence_quality: null,
    })),
    { modelVersion: v.version, versionCreatedAt: v.created_at, lineage: result?.lineage ?? [], compareTo },
  );
  return {
    id: v.id,
    caseId: v.case_id,
    version: v.version,
    state: v.state as EconomicsVersion['state'],
    sizingVersionId: v.sizing_version_id,
    currency: v.currency,
    priceYear: v.price_year,
    horizonYears: v.horizon_years,
    drivers,
    result,
    rowVersion: v.row_version,
    committedAt: isoDateTimeOrNull(v.committed_at),
    committedBy: v.committed_by,
    createdAt: isoDateTime(v.created_at),
  };
}

type ReviewRow = {
  id: string;
  model_type: string;
  model_version_id: string;
  reviewer_user_id: string;
  requested_at: Date;
  due_on: string | Date | null;
  checked_items: string[];
  not_checked_items: string[];
  position: string | null;
  statement: string | null;
  signed_at: Date | null;
};

export async function toModelReview(tx: Tx, r: ReviewRow): Promise<ModelReview> {
  const people = await peopleMap(tx, [r.reviewer_user_id]);
  return {
    id: r.id,
    modelType: r.model_type as ModelReview['modelType'],
    modelVersionId: r.model_version_id,
    reviewer: who(people, r.reviewer_user_id),
    requestedAt: isoDateTime(r.requested_at),
    dueOn: isoDateOrNull(r.due_on),
    checkedItems: r.checked_items,
    notCheckedItems: r.not_checked_items,
    position: (r.position ?? 'not_yet_reviewed') as ModelReview['position'],
    statement: r.statement,
    signedAt: isoDateTimeOrNull(r.signed_at),
  };
}

export async function economicsView(tx: Tx, identity: Identity, caseId: string): Promise<EconomicsView> {
  const versions = await economicsVersions(tx, caseId);
  const committed = versions.filter((v) => v.state === 'committed');
  const curRow = committed[committed.length - 1];
  const draftRow = versions.find((v) => v.state === 'draft');
  const current = curRow ? await toEconomicsVersion(tx, identity, curRow) : null;
  const compare = current ? new Map(current.drivers.map((d) => [d.inputKey, d.value])) : undefined;
  const draft = draftRow ? await toEconomicsVersion(tx, identity, draftRow, compare) : null;
  const review = (await tx
    .selectFrom('me.model_review')
    .selectAll()
    .where('case_id', '=', caseId)
    .where('model_type', '=', 'economics')
    .orderBy('requested_at', 'desc')
    .executeTakeFirst()) as ReviewRow | undefined;
  const shown = draft ?? current;
  const reasons: string[] = [];
  if (!shown) reasons.push('No economics version yet');
  else if (!shown.result) reasons.push('Not calculated — required drivers are missing');
  else {
    for (const c of shown.result.checks.filter((x) => x.blocking)) reasons.push(c.message);
    if ('unavailable' in shown.result.oneTimeInvestment)
      reasons.push(`One-time investment: ${shown.result.oneTimeInvestment.reason}`);
  }
  return {
    current,
    draft,
    financeReview: review ? await toModelReview(tx, review) : null,
    recommendationIncomplete: reasons.length > 0,
    incompleteReasons: reasons,
    versions: committed.map((v) => ({
      id: v.id,
      version: v.version,
      committedAt: isoDateTimeOrNull(v.committed_at),
    })),
  };
}

const SCEN = ['downside', 'base', 'upside'] as const;

/** Scenario table as display text (per-year rows only) for snapshot content and exports. */
export function scenarioTable(o: EconomicsOutput): string[][] {
  const row = (label: string, f: (s: EconomicsOutput['scenarios'][number]) => string) => [
    label,
    ...SCEN.map((k) => {
      const s = o.scenarios.find((x) => x.scenario === k);
      return s ? f(s) : 'Not available';
    }),
  ];
  const m = (x: { amount: string; currency: string }) => moneyLabel(x.amount, x.currency);
  return [
    ['', 'Downside', 'Base', 'Upside'],
    row('Annual revenue', (s) => m(s.annualRevenue)),
    row('Gross contribution', (s) => m(s.grossContribution)),
    row('Annual incremental opex', (s) => m(s.annualIncrementalOpex)),
    row('Contribution after incremental opex', (s) =>
      s.contributionAfterOpex.amount === '0.00'
        ? `${m(s.contributionAfterOpex)} (break-even)`
        : m(s.contributionAfterOpex),
    ),
  ];
}

/** WS4b hand-off: committed economics for `SnapshotContent.economics`. */
export async function committedEconomicsSummary(
  tx: Tx,
  caseId: string,
): Promise<{
  economicsVersionId: string;
  version: number;
  inputHash: string;
  tableText: string[][];
  note: string;
} | null> {
  const v = (await economicsVersions(tx, caseId)).filter((x) => x.state === 'committed').pop();
  if (!v) return null;
  const o = await calcOutput<EconomicsOutput>(tx, v.calculation_result_id);
  if (!o) return null;
  const one =
    'amount' in o.oneTimeInvestment
      ? `${moneyLabel(o.oneTimeInvestment.amount, o.oneTimeInvestment.currency)} one-time, kept separate`
      : `not available — ${o.oneTimeInvestment.reason}`;
  return {
    economicsVersionId: v.id,
    version: v.version,
    inputHash: o.inputHash,
    tableText: scenarioTable(o),
    note: `One-time scale-entry investment ${one}. Cash flow and payback not available.`,
  };
}
