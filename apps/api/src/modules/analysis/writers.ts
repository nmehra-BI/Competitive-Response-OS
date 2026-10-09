/**
 * Business-record writers for accepted proposals. They run inside the caller's command pipeline
 * (`tools`), so the business row, its audit event and the proposal decision commit together.
 *
 * WAVE3 §7: WS4a owns `createOpportunityFromProposal` (me/opportunities/writers.ts) and
 * `createClaimFromProposal` (me/thesis/writers.ts). WS4a lands in parallel, so these are WS5's
 * stand-ins with the agreed signatures; at integration the PE swaps the imports (notes: CR-WS5-3).
 * Provenance: `origin` ai (edited claims: ai_edited), `agent_run_id`, accepted by the deciding person.
 */
import type { ProposalPayload } from '@growth-os/contracts';
import { allocateDisplayKey, type Tx } from '@growth-os/db';
import type { Tools } from '../../platform/pipeline';

export interface ProposalProvenance {
  runId: string;
  proposalId: string;
  acceptedBy: string;
  edited: boolean;
}

/** Map cited ids (source or passage ids returned to the run) to source ids, keeping only real ones. */
async function sourceIdsFor(
  tx: Tx,
  ids: readonly string[],
): Promise<{ sourceId: string; passageId: string | null }[]> {
  if (ids.length === 0) return [];
  const [passages, sources] = await Promise.all([
    tx
      .selectFrom('platform.evidence_passage')
      .select(['id', 'source_id'])
      .where('id', 'in', [...ids])
      .execute(),
    tx
      .selectFrom('platform.source')
      .select('id')
      .where('id', 'in', [...ids])
      .execute(),
  ]);
  const out = new Map<string, { sourceId: string; passageId: string | null }>();
  for (const p of passages) out.set(`${p.source_id}:${p.id}`, { sourceId: p.source_id, passageId: p.id });
  for (const s of sources)
    if (![...out.values()].some((v) => v.sourceId === s.id))
      out.set(`${s.id}:`, { sourceId: s.id, passageId: null });
  return [...out.values()];
}

export async function createOpportunityFromProposal(
  t: Tools,
  input: {
    tenantId: string;
    mandateId: string;
    payload: Extract<ProposalPayload, { type: 'opportunity_candidate' }>;
    provenance: ProposalProvenance;
  },
): Promise<{ id: string; key: string }> {
  const { tx } = t;
  const p = input.payload;
  const mandate = await tx
    .selectFrom('me.mandate as m')
    .leftJoin('me.mandate_version as v', 'v.id', 'm.current_version_id')
    .select(['m.id', 'v.product_id', 'v.segment_ids', 'v.geography_codes'])
    .where('m.id', '=', input.mandateId)
    .executeTakeFirstOrThrow();
  const dup = p.likelyDuplicateOfOpportunityId
    ? await tx
        .selectFrom('me.opportunity')
        .select('id')
        .where('id', '=', p.likelyDuplicateOfOpportunityId)
        .where('mandate_id', '=', input.mandateId)
        .executeTakeFirst()
    : undefined;
  const key = await allocateDisplayKey(tx, input.tenantId, 'OPP', async (k) =>
    Boolean(
      await tx.selectFrom('me.opportunity').select('id').where('display_key', '=', k).executeTakeFirst(),
    ),
  );
  const sources = await sourceIdsFor(tx, p.evidenceIds);
  const row = await tx
    .insertInto('me.opportunity')
    .values({
      tenant_id: input.tenantId,
      mandate_id: input.mandateId,
      display_key: key,
      name: p.name,
      trigger_text: p.trigger,
      fit_rationale: p.fitRationale,
      origin: 'ai',
      agent_run_id: input.provenance.runId,
      status: 'detected',
      likely_duplicate_of_id: dup?.id ?? null,
      product_id: mandate.product_id,
      segment_id: mandate.segment_ids?.[0] ?? null,
      country_code: mandate.geography_codes?.length === 1 ? mandate.geography_codes[0]! : null,
      evidence_quality: sources.length >= 2 ? 'some' : sources.length === 1 ? 'weak' : 'none',
      last_checked_at: new Date(),
      created_by: input.provenance.acceptedBy,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  let ordinal = 0;
  for (const c of p.fitCriteria)
    await tx
      .insertInto('me.opportunity_fit_criterion')
      .values({
        tenant_id: input.tenantId,
        opportunity_id: row.id,
        criterion: c.criterion,
        result: c.result,
        ordinal: ordinal++,
      })
      .execute();
  for (const text of p.unknowns)
    await tx
      .insertInto('me.opportunity_unknown')
      .values({ tenant_id: input.tenantId, opportunity_id: row.id, text })
      .execute();
  for (const sourceId of new Set(sources.map((s) => s.sourceId)))
    await tx
      .insertInto('me.opportunity_source')
      .values({ tenant_id: input.tenantId, opportunity_id: row.id, source_id: sourceId })
      .execute();
  await t.audit({
    action: 'opportunity.detected',
    objectType: 'opportunity',
    objectId: row.id,
    summary: `${key} added from an AI proposal${dup ? ' · likely duplicate flagged' : ''}`,
    details: {
      origin: 'ai',
      edited: input.provenance.edited,
      proposalId: input.provenance.proposalId,
      sources: sources.length,
    },
  });
  return { id: row.id, key };
}

export async function createClaimFromProposal(
  t: Tools,
  input: {
    tenantId: string;
    caseId: string | null;
    payload: Extract<ProposalPayload, { type: 'claim' }>;
    provenance: ProposalProvenance;
  },
): Promise<{ id: string }> {
  const { tx } = t;
  const c = input.payload.claim;
  const links = await sourceIdsFor(tx, c.evidenceIds);
  const now = new Date();
  const row = await tx
    .insertInto('platform.claim')
    .values({
      tenant_id: input.tenantId,
      case_id: input.caseId,
      statement: c.statement,
      // An evidence claim needs at least one real citation; otherwise it can only be an unknown.
      kind: c.kind === 'evidence' && links.length === 0 ? 'unknown' : c.kind,
      origin: input.provenance.edited ? 'ai_edited' : 'ai',
      agent_run_id: input.provenance.runId,
      status: 'accepted',
      accepted_by: input.provenance.acceptedBy,
      accepted_at: now,
      created_by: input.provenance.acceptedBy,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const l of links)
    await tx
      .insertInto('platform.claim_evidence_link')
      .values({
        tenant_id: input.tenantId,
        claim_id: row.id,
        source_id: l.sourceId,
        passage_id: l.passageId,
        relation: l.passageId ? 'quoted' : 'supports',
        created_by: input.provenance.acceptedBy,
      })
      .execute();
  await t.audit({
    action: 'claim.accepted',
    objectType: 'claim',
    objectId: row.id,
    caseId: input.caseId,
    summary: `AI claim accepted${input.provenance.edited ? ' with edits' : ''}`,
    details: { origin: input.provenance.edited ? 'ai_edited' : 'ai', kind: c.kind, citations: links.length },
  });
  return { id: row.id };
}
