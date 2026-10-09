/** Opportunity serializer (S03) shared by opportunities, comparisons and the WS5 writer. */
import type { MarketBoundary, Opportunity } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { isUuid } from '../../../platform/cases';
import type { Identity } from '../../../platform/context';
import { isoDateTime, isoDateTimeOrNull } from '../../../platform/serialize';
import { chipsFor, sourceChips } from '../cases/sources';

export type OpportunityRow = {
  id: string;
  mandate_id: string;
  display_key: string;
  name: string;
  trigger_text: string;
  fit_rationale: string;
  origin: string;
  agent_run_id: string | null;
  status: string;
  dismiss_reason: string | null;
  duplicate_of_id: string | null;
  likely_duplicate_of_id: string | null;
  converted_case_id: string | null;
  market_boundary_id: string | null;
  product_id: string | null;
  segment_id: string | null;
  country_code: string | null;
  evidence_quality: string;
  last_checked_at: Date | null;
  created_at: Date;
  created_by: string;
  updated_at: Date;
};

export async function findOpportunity(tx: Tx, ref: string): Promise<OpportunityRow | undefined> {
  return tx
    .selectFrom('me.opportunity')
    .selectAll()
    .where(isUuid(ref) ? 'id' : 'display_key', '=', ref)
    .executeTakeFirst() as Promise<OpportunityRow | undefined>;
}

export async function toOpportunities(tx: Tx, identity: Identity, rows: readonly OpportunityRow[]): Promise<Opportunity[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [fits, unknowns, links, boundaries] = await Promise.all([
    tx.selectFrom('me.opportunity_fit_criterion').selectAll().where('opportunity_id', 'in', ids).orderBy('ordinal').execute(),
    tx.selectFrom('me.opportunity_unknown').selectAll().where('opportunity_id', 'in', ids).execute(),
    tx.selectFrom('me.opportunity_source').selectAll().where('opportunity_id', 'in', ids).execute(),
    (() => {
      const b = rows.map((r) => r.market_boundary_id).filter((x): x is string => !!x);
      return b.length ? tx.selectFrom('me.market_boundary').selectAll().where('id', 'in', b).execute() : Promise.resolve([]);
    })(),
  ]);
  const chips = await sourceChips(
    tx,
    identity,
    links.map((l) => l.source_id),
  );
  return rows.map((r) => {
    const b = boundaries.find((x) => x.id === r.market_boundary_id);
    const boundary: MarketBoundary | null = b
      ? {
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
        }
      : null;
    const sources = chipsFor(
      chips,
      links.filter((l) => l.opportunity_id === r.id).map((l) => l.source_id),
    );
    const unk = unknowns.filter((u) => u.opportunity_id === r.id).map((u) => u.text);
    return {
      id: r.id,
      key: r.display_key,
      mandateId: r.mandate_id,
      name: r.name,
      trigger: r.trigger_text,
      fitRationale: r.fit_rationale,
      origin: r.origin as Opportunity['origin'],
      agentRunId: r.agent_run_id,
      status: r.status as Opportunity['status'],
      dismissReason: r.dismiss_reason,
      duplicateOfId: r.duplicate_of_id,
      likelyDuplicateOfId: r.likely_duplicate_of_id,
      convertedCaseId: r.converted_case_id,
      evidenceQuality: r.evidence_quality as Opportunity['evidenceQuality'],
      sourceCount: sources.length,
      unknownCount: unk.length,
      lastCheckedAt: isoDateTimeOrNull(r.last_checked_at),
      fitCriteria: fits
        .filter((f) => f.opportunity_id === r.id)
        .map((f) => ({ criterion: f.criterion, result: f.result as 'met', note: f.note })),
      unknowns: unk,
      sources,
      boundary,
      createdAt: isoDateTime(r.created_at),
      createdBy: r.created_by,
    };
  });
}

export async function toOpportunity(tx: Tx, identity: Identity, row: OpportunityRow): Promise<Opportunity> {
  return (await toOpportunities(tx, identity, [row]))[0]!;
}
