/**
 * Where a source is used (S13 "Impact" and "Linked uses"), and which cases it belongs to.
 *
 * The evidence primitive is shared (platform), but its uses live in app tables (sizing inputs,
 * cohorts, opportunities). This file is the Market Expansion adapter for those reads; it only reads.
 * A source used by no case is tenant-level evidence; a source used only by cases the viewer cannot
 * read is hidden (404) — and hidden cases are never listed or counted.
 */
import type { Tx } from '@growth-os/db';

export interface SourceUse {
  sourceId: string;
  caseId: string;
  /** "TAM site count", "Size-qualified cohort", "Evidence claim" */
  label: string;
  /** "Sizing v2" */
  where: string;
  tab: 'sizing' | 'thesis' | 'outcomes' | 'overview';
}

export async function sourceUses(tx: Tx, sourceIds: readonly string[]): Promise<SourceUse[]> {
  if (sourceIds.length === 0) return [];
  const ids = [...new Set(sourceIds)];
  const [inputs, cohorts, claims, opps, observations] = await Promise.all([
    tx
      .selectFrom('me.sizing_input as i')
      .innerJoin('me.sizing_version as v', 'v.id', 'i.sizing_version_id')
      .select(['i.source_id', 'v.case_id', 'v.version', 'v.state', 'i.label'])
      .where('i.source_id', 'in', ids)
      .execute(),
    tx
      .selectFrom('me.cohort as c')
      .innerJoin('me.sizing_version as v', 'v.id', 'c.sizing_version_id')
      .select(['c.source_id', 'v.case_id', 'v.version', 'v.state', 'c.name'])
      .where('c.source_id', 'in', ids)
      .execute(),
    tx
      .selectFrom('platform.claim_evidence_link as l')
      .innerJoin('platform.claim as c', 'c.id', 'l.claim_id')
      .select(['l.source_id', 'c.case_id', 'c.kind'])
      .where('l.source_id', 'in', ids)
      .where('c.case_id', 'is not', null)
      .execute(),
    tx
      .selectFrom('me.opportunity_source as os')
      .innerJoin('me.opportunity as o', 'o.id', 'os.opportunity_id')
      .select(['os.source_id', 'o.converted_case_id', 'o.display_key'])
      .where('os.source_id', 'in', ids)
      .where('o.converted_case_id', 'is not', null)
      .execute(),
    tx
      .selectFrom('platform.outcome_observation')
      .select(['source_id', 'case_id', 'label'])
      .where('source_id', 'in', ids)
      .execute(),
  ]);
  const ver = (v: number, state: string) => `Sizing v${v}${state === 'draft' ? ' (draft)' : ''}`;
  return [
    ...inputs.map((r) => ({
      sourceId: r.source_id!,
      caseId: r.case_id,
      label: r.label,
      where: ver(r.version, r.state),
      tab: 'sizing' as const,
    })),
    ...cohorts.map((r) => ({
      sourceId: r.source_id!,
      caseId: r.case_id,
      label: `${r.name} cohort`,
      where: ver(r.version, r.state),
      tab: 'sizing' as const,
    })),
    ...claims.map((r) => ({
      sourceId: r.source_id,
      caseId: r.case_id!,
      label: 'Linked claim',
      where: 'Thesis',
      tab: 'thesis' as const,
    })),
    ...opps.map((r) => ({
      sourceId: r.source_id,
      caseId: r.converted_case_id!,
      label: `Origin evidence (${r.display_key})`,
      where: 'Opportunity',
      tab: 'overview' as const,
    })),
    ...observations.map((r) => ({
      sourceId: r.source_id!,
      caseId: r.case_id,
      label: r.label,
      where: 'Outcome actuals',
      tab: 'outcomes' as const,
    })),
  ];
}
