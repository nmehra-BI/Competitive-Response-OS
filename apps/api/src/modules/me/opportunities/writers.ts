/**
 * Opportunity writers. `createOpportunityFromProposal` is the hand-off to WS5: when a person accepts a
 * discovery proposal (`analysis.decideProposal`), WS5 calls it inside its own command pipeline with its
 * `tools`. The candidate is created as Detected with origin `ai` and the run id as provenance ("Proposed ·
 * AI"); it is never shortlisted or converted by the writer. One audit event is written here.
 */
import type { Opportunity } from '@growth-os/contracts';
import { allocateDisplayKey, type Tx } from '@growth-os/db';
import type { Identity } from '../../../platform/context';
import { ApiError, notFound } from '../../../platform/errors';
import type { Tools } from '../../../platform/pipeline';
import { toOpportunity, type OpportunityRow } from './read';

export interface NewOpportunityInput {
  mandateId: string;
  name: string;
  trigger: string;
  fitRationale: string;
  origin: 'ai' | 'manual' | 'handoff';
  agentRunId: string | null;
  countryCode?: string | null;
  sourceIds?: readonly string[];
  unknowns?: readonly string[];
  fitCriteria?: readonly { criterion: string; result: 'met' | 'not_met' | 'unknown'; note: string | null }[];
  likelyDuplicateOfId?: string | null;
}

export async function insertOpportunity(
  tx: Tx,
  ctx: { tenantId: string; actorUserId: string; now: Date },
  input: NewOpportunityInput,
): Promise<OpportunityRow> {
  const mandate = await tx
    .selectFrom('me.mandate')
    .select(['id', 'current_version_id', 'draft_version_id'])
    .where('id', '=', input.mandateId)
    .executeTakeFirst();
  if (!mandate) throw notFound();
  const ver = await tx
    .selectFrom('me.mandate_version')
    .select(['product_id', 'segment_ids'])
    .where('id', '=', (mandate.current_version_id ?? mandate.draft_version_id)!)
    .executeTakeFirst();
  const key = await allocateDisplayKey(tx, ctx.tenantId, 'OPP', async (k) =>
    Boolean(
      await tx.selectFrom('me.opportunity').select('id').where('display_key', '=', k).executeTakeFirst(),
    ),
  );
  const row = (await tx
    .insertInto('me.opportunity')
    .values({
      tenant_id: ctx.tenantId,
      mandate_id: input.mandateId,
      display_key: key,
      name: input.name,
      trigger_text: input.trigger,
      fit_rationale: input.fitRationale,
      origin: input.origin,
      agent_run_id: input.agentRunId,
      status: 'detected',
      likely_duplicate_of_id: input.likelyDuplicateOfId ?? null,
      product_id: ver?.product_id ?? null,
      segment_id: ver?.segment_ids[0] ?? null,
      country_code: input.countryCode ?? null,
      evidence_quality: 'none',
      last_checked_at: ctx.now,
      created_by: ctx.actorUserId,
      created_at: ctx.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow()) as OpportunityRow;
  for (const text of input.unknowns ?? [])
    await tx
      .insertInto('me.opportunity_unknown')
      .values({ tenant_id: ctx.tenantId, opportunity_id: row.id, text })
      .execute();
  for (const [i, f] of (input.fitCriteria ?? []).entries())
    await tx
      .insertInto('me.opportunity_fit_criterion')
      .values({
        tenant_id: ctx.tenantId,
        opportunity_id: row.id,
        criterion: f.criterion,
        result: f.result,
        note: f.note,
        ordinal: i + 1,
      })
      .execute();
  for (const sourceId of new Set(input.sourceIds ?? [])) {
    const exists = await tx
      .selectFrom('platform.source')
      .select('id')
      .where('id', '=', sourceId)
      .executeTakeFirst();
    if (!exists) throw new ApiError('VALIDATION_FAILED', 'Unknown source');
    await tx
      .insertInto('me.opportunity_source')
      .values({ tenant_id: ctx.tenantId, opportunity_id: row.id, source_id: sourceId })
      .execute();
  }
  return row;
}

/** WS5 hand-off: accepted discovery proposal → Detected opportunity with AI provenance. */
export async function createOpportunityFromProposal(
  t: Tools,
  ctx: { tenantId: string; actorUserId: string; now: Date; identity: Identity },
  proposal: Omit<NewOpportunityInput, 'origin'> & { agentRunId: string; proposalId: string },
): Promise<Opportunity> {
  const row = await insertOpportunity(t.tx, ctx, { ...proposal, origin: 'ai' });
  await t.audit({
    action: 'opportunity.created_from_proposal',
    objectType: 'opportunity',
    objectId: row.id,
    summary: `${row.display_key} created from an accepted analysis proposal (Proposed · AI)`,
    details: { proposalId: proposal.proposalId, agentRunId: proposal.agentRunId },
  });
  return toOpportunity(t.tx, ctx.identity, row);
}
