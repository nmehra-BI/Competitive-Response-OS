/**
 * Sizing serializers (S06). Exported for WS4b snapshot content (`committedSizingSummary`).
 *
 * Redaction (D-033): a BLOCKED result never exposes ladder values. The ladder numbers are replaced by
 * placeholders flagged `sam.available = false`, SOM is empty and lineage values are removed; the
 * blocking checks carry the explanation ("SAM … is larger than TAM …").
 */
import { formatMarketSpend, formatScenarioRevenue } from '@growth-os/ui/format';
import type {
  Cohort,
  CohortOverlap,
  DuplicateCohortWarning,
  LedgerRow,
  MarketBoundary,
  SizingOutput,
  SizingVersion,
  SizingView,
  SourceChip,
} from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import type { Identity } from '../../../platform/context';
import { effectiveAccess, entitlementsFor } from '../../../platform/entitlements';
import { isoDateTime, isoDateTimeOrNull } from '../../../platform/serialize';
import { peopleMap, who } from '../cases/access';
import { chipsFor, sourceChips } from '../cases/sources';
import { valueString } from '../assumptions/read';
import { sizingVersions, type SizingVersionRow } from './model';

export function redactBlockedSizing(o: SizingOutput): SizingOutput {
  if (!o.blocked) return o;
  const zero = (m: SizingOutput['ladder']['tam']['value']) => ({ ...m, amount: '0.00' });
  return {
    ...o,
    ladder: {
      // Every rung is flagged, not only SAM (D-033, D-081): the zeros are placeholders, never values.
      tam: { population: 0, value: zero(o.ladder.tam.value), available: false },
      sam: {
        population: 0,
        value: zero(o.ladder.sam.value),
        cohortSum: 0,
        overlapRemoved: 0,
        available: false,
      },
      reachablePool: { population: 0, available: false },
      som: [],
    },
    lineage: o.lineage.map((n) =>
      n.kind === 'calculated' || n.kind === 'scenario' ? { ...n, value: null, formulaWithValues: null } : n,
    ),
  };
}

export async function calcOutput<T>(tx: Tx, id: string | null): Promise<T | null> {
  if (!id) return null;
  const r = await tx
    .selectFrom('platform.calculation_result')
    .select('output')
    .where('id', '=', id)
    .executeTakeFirst();
  return (r?.output as T | undefined) ?? null;
}

function boundaryOf(b: {
  id: string;
  market_unit: string;
  population_unit: string;
  country_code: string;
  segment_label: string;
  product_boundary: string;
  currency: string;
  price_year: number;
  includes_hardware: boolean;
  includes_software: boolean;
  includes_services: boolean;
  includes_replacement: boolean;
  annualization_method: string | null;
}): MarketBoundary {
  return {
    id: b.id,
    marketUnit: b.market_unit,
    populationUnit: b.population_unit as MarketBoundary['populationUnit'],
    countryCode: b.country_code,
    segmentLabel: b.segment_label,
    productBoundary: b.product_boundary,
    currency: b.currency,
    priceYear: b.price_year,
    includes: {
      hardware: b.includes_hardware,
      software: b.includes_software,
      services: b.includes_services,
      replacementCycles: b.includes_replacement,
    },
    annualizationMethod: b.annualization_method,
  };
}

/** Ledger rows for any versioned model input table (sizing inputs or economics drivers). */
export async function ledgerRows(
  tx: Tx,
  identity: Identity,
  rows: readonly {
    input_key: string;
    label: string;
    value: string;
    unit: string;
    currency: string | null;
    kind: string;
    source_id: string | null;
    assumption_id: string | null;
    assumption_version_id: string | null;
    evidence_quality: string | null;
  }[],
  ctx: {
    modelVersion: number;
    versionCreatedAt: Date;
    lineage: { nodeKey: string; inputs: string[] }[];
    compareTo?: Map<string, string>;
  },
): Promise<LedgerRow[]> {
  const asmIds = rows.flatMap((r) => (r.assumption_id ? [r.assumption_id] : []));
  const asm = asmIds.length
    ? await tx
        .selectFrom('platform.assumption as a')
        .innerJoin('platform.assumption_version as v', 'v.id', 'a.current_version_id')
        .select(['a.id', 'a.owner_user_id', 'v.basis', 'v.version', 'v.created_at', 'v.evidence_quality'])
        .where('a.id', 'in', asmIds)
        .execute()
    : [];
  const pinnedIds = rows.flatMap((r) => (r.assumption_version_id ? [r.assumption_version_id] : []));
  const pinned = pinnedIds.length
    ? await tx
        .selectFrom('platform.assumption_version')
        .select(['id', 'version', 'created_at', 'basis', 'evidence_quality'])
        .where('id', 'in', pinnedIds)
        .execute()
    : [];
  const disputes = asmIds.length
    ? await tx
        .selectFrom('platform.challenge')
        .select('target_id')
        .where('target_type', '=', 'assumption')
        .where('target_id', 'in', asmIds)
        .where('status', '=', 'open')
        .execute()
    : [];
  const people = await peopleMap(
    tx,
    asm.map((a) => a.owner_user_id),
  );
  const chips = await sourceChips(
    tx,
    identity,
    rows.map((r) => r.source_id),
  );
  return rows.map((r) => {
    const a = asm.find((x) => x.id === r.assumption_id);
    const p = pinned.find((x) => x.id === r.assumption_version_id);
    const key = `input.${r.input_key}`;
    const value = valueString(r.value, r.unit);
    const src: SourceChip | null = r.source_id ? (chipsFor(chips, [r.source_id])[0] ?? null) : null;
    return {
      inputKey: r.input_key,
      name: r.label,
      value,
      unit: r.unit as LedgerRow['unit'],
      currency: r.currency,
      kind: (r.kind === 'evidence' || r.kind === 'calculated' ? r.kind : 'assumption') as LedgerRow['kind'],
      basis: {
        source: src,
        owner: a ? who(people, a.owner_user_id) : null,
        text: p?.basis ?? a?.basis ?? (src ? null : 'Draft value · not yet in the assumption register'),
      },
      evidenceQuality: (r.evidence_quality ??
        p?.evidence_quality ??
        a?.evidence_quality ??
        null) as LedgerRow['evidenceQuality'],
      assumptionId: r.assumption_id,
      version: p?.version ?? a?.version ?? ctx.modelVersion,
      lastChangedAt: isoDateTime(p?.created_at ?? a?.created_at ?? ctx.versionCreatedAt),
      usedByCount: ctx.lineage.filter((n) => n.inputs.includes(key)).length,
      disputed: disputes.some((d) => d.target_id === r.assumption_id),
      changedInDraft: ctx.compareTo ? ctx.compareTo.get(r.input_key) !== value : false,
    };
  });
}

export async function toSizingVersion(
  tx: Tx,
  identity: Identity,
  v: SizingVersionRow,
  compareTo?: Map<string, string>,
): Promise<SizingVersion> {
  const b = await tx
    .selectFrom('me.market_boundary')
    .selectAll()
    .where('id', '=', v.market_boundary_id)
    .executeTakeFirstOrThrow();
  const inputs = await tx
    .selectFrom('me.sizing_input')
    .selectAll()
    .where('sizing_version_id', '=', v.id)
    .execute();
  const cohorts = await tx
    .selectFrom('me.cohort')
    .selectAll()
    .where('sizing_version_id', '=', v.id)
    .orderBy('ordinal')
    .execute();
  const overlaps = await tx
    .selectFrom('me.cohort_overlap')
    .selectAll()
    .where('sizing_version_id', '=', v.id)
    .execute();
  const cross = await tx
    .selectFrom('me.sizing_cross_check')
    .selectAll()
    .where('sizing_version_id', '=', v.id)
    .executeTakeFirst();
  const raw = await calcOutput<SizingOutput>(tx, v.calculation_result_id);
  const chips = await sourceChips(tx, identity, [...cohorts.map((c) => c.source_id), cross?.source_id]);
  const order = Object.keys({
    tam_site_count: 1,
    annual_spend_per_site: 1,
    reachable_pool: 1,
    'adoption_rate.downside': 1,
    'adoption_rate.base': 1,
    'adoption_rate.upside': 1,
    capacity: 1,
  });
  const sorted = [...inputs].sort((x, y) => order.indexOf(x.input_key) - order.indexOf(y.input_key));
  const ledger = await ledgerRows(tx, identity, sorted, {
    modelVersion: v.version,
    versionCreatedAt: v.created_at,
    lineage: raw?.lineage ?? [],
    compareTo,
  });
  return {
    id: v.id,
    caseId: v.case_id,
    version: v.version,
    state: v.state as SizingVersion['state'],
    method: v.method as SizingVersion['method'],
    horizonYears: v.horizon_years,
    boundary: boundaryOf(b),
    dedupRuleText: v.dedup_rule_text,
    ledger,
    cohorts: cohorts.map((c): Cohort => ({
      id: c.id,
      name: c.name,
      qualifier: c.qualifier,
      rule: c.rule,
      siteCount: c.site_count,
      source: c.source_id ? (chipsFor(chips, [c.source_id])[0] ?? null) : null,
      status: c.status as Cohort['status'],
    })),
    overlaps: overlaps.map((o): CohortOverlap => ({
      id: o.id,
      cohortAId: o.cohort_a_id,
      cohortBId: o.cohort_b_id,
      overlapCount: o.overlap_count,
      method: o.method_text,
    })),
    crossCheck: cross
      ? {
          low: valueString(cross.low, 'currency_per_year'),
          high: valueString(cross.high, 'currency_per_year'),
          basis: cross.basis,
          source: cross.source_id ? (chipsFor(chips, [cross.source_id])[0] ?? null) : null,
          illustrative: cross.illustrative,
          explanation: cross.explanation,
        }
      : null,
    result: raw ? redactBlockedSizing(raw) : null,
    rowVersion: v.row_version,
    committedAt: isoDateTimeOrNull(v.committed_at),
    committedBy: v.committed_by,
    createdAt: isoDateTime(v.created_at),
  };
}

export function duplicateWarnings(o: SizingOutput | null): DuplicateCohortWarning[] {
  if (!o) return [];
  return o.checks
    .filter((c) => c.key === 'DUPLICATE_COHORT')
    .map((c) => {
      const ids = c.inputKeys.map((k) => k.replace(/^cohort\./, ''));
      return { cohortAId: ids[0]!, cohortBId: ids[1] ?? ids[0]!, sharedSiteCount: null, message: c.message };
    });
}

export async function sizingView(tx: Tx, identity: Identity, caseId: string): Promise<SizingView> {
  const versions = await sizingVersions(tx, caseId);
  const committed = versions.filter((v) => v.state === 'committed');
  const currentRow = committed[committed.length - 1];
  const draftRow = versions.find((v) => v.state === 'draft');
  const current = currentRow ? await toSizingVersion(tx, identity, currentRow) : null;
  const compare = current ? new Map(current.ledger.map((l) => [l.inputKey, l.value])) : undefined;
  const draft = draftRow ? await toSizingVersion(tx, identity, draftRow, compare) : null;
  // Site lists follow the licence of the cohorts' sources (S06 restricted state).
  const shownId = draftRow?.id ?? currentRow?.id;
  const sources = shownId
    ? await tx
        .selectFrom('me.cohort as c')
        .innerJoin('platform.source as s', 's.id', 'c.source_id')
        .select(['s.license_id', 's.availability', 's.deleted_at', 's.created_by'])
        .where('c.sizing_version_id', '=', shownId)
        .execute()
    : [];
  const ent = await entitlementsFor(
    tx,
    identity,
    sources.map((s) => s.license_id),
  );
  const restricted = sources.filter((s) => effectiveAccess(ent.get(s.license_id) ?? 'none', s) !== 'excerpt');
  const owners = await peopleMap(
    tx,
    restricted.map((s) => s.created_by),
  );
  const draftOut = draftRow ? await calcOutput<SizingOutput>(tx, draftRow.calculation_result_id) : null;
  return {
    current,
    draft,
    duplicateCohorts: duplicateWarnings(draftOut),
    siteListRestricted: restricted.length > 0,
    siteListDataOwner: restricted[0] ? who(owners, restricted[0].created_by) : null,
    versions: committed.map((v) => ({
      id: v.id,
      version: v.version,
      committedAt: isoDateTimeOrNull(v.committed_at),
    })),
  };
}

/** WS4b hand-off: committed sizing summary for snapshot content (`SnapshotContent.sizing`). */
export async function committedSizingSummary(
  tx: Tx,
  caseId: string,
): Promise<{ sizingVersionId: string; version: number; inputHash: string; summary: string } | null> {
  const v = (await sizingVersions(tx, caseId)).filter((x) => x.state === 'committed').pop();
  if (!v) return null;
  const o = await calcOutput<SizingOutput>(tx, v.calculation_result_id);
  if (!o || o.blocked) return null;
  const base = o.ladder.som.find((s) => s.scenario === 'base');
  const unit = o.ladder.reachablePool.population === 1 ? 'site' : 'sites';
  return {
    sizingVersionId: v.id,
    version: v.version,
    inputHash: o.inputHash,
    summary: [
      `TAM ${formatMarketSpend(o.ladder.tam.value.amount, o.ladder.tam.value.currency)}`,
      `SAM ${formatMarketSpend(o.ladder.sam.value.amount, o.ladder.sam.value.currency)}`,
      `Reachable ${o.ladder.reachablePool.population} unique ${unit}`,
      ...(base
        ? [
            `SOM Base Year ${v.horizon_years} ${formatScenarioRevenue(base.annualRevenue.amount, base.annualRevenue.currency)} annual revenue`,
          ]
        : []),
    ].join(' · '),
  };
}
