/**
 * Claim writers. `createClaimFromProposal` is the hand-off to WS5: an analysis output accepted into a
 * case becomes a claim with origin `ai` and status `proposed` ("AI draft"). It is never an accepted fact
 * until a person accepts it through `claims.accept` (never-rule 11; the database CHECK agrees).
 * Runs inside the caller's command pipeline `tools`; writes one audit event.
 */
import type { Claim, EpistemicKind } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import type { Identity } from '../../../platform/context';
import { ApiError } from '../../../platform/errors';
import type { Tools } from '../../../platform/pipeline';
import { claimsByIds } from './read';

export interface NewClaim {
  caseId: string;
  statement: string;
  kind: EpistemicKind;
  kindDetail: string | null;
  origin: 'human' | 'ai' | 'ai_edited';
  agentRunId: string | null;
  sourceIds: readonly string[];
  assumptionId: string | null;
  /** Human claims are accepted on creation; AI claims stay proposed. */
  acceptedBy: string | null;
}

export async function insertClaim(
  tx: Tx,
  ctx: { tenantId: string; actorUserId: string; now: Date },
  c: NewClaim,
): Promise<string> {
  for (const id of c.sourceIds) {
    const s = await tx.selectFrom('platform.source').select('id').where('id', '=', id).executeTakeFirst();
    if (!s) throw new ApiError('VALIDATION_FAILED', 'Unknown source.');
  }
  const row = await tx
    .insertInto('platform.claim')
    .values({
      tenant_id: ctx.tenantId,
      case_id: c.caseId,
      statement: c.statement,
      kind: c.kind,
      kind_detail: c.kindDetail,
      origin: c.origin,
      agent_run_id: c.agentRunId,
      status: c.acceptedBy ? 'accepted' : 'proposed',
      accepted_by: c.acceptedBy,
      accepted_at: c.acceptedBy ? ctx.now : null,
      assumption_id: c.assumptionId,
      created_by: ctx.actorUserId,
      created_at: ctx.now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const sourceId of new Set(c.sourceIds))
    await tx
      .insertInto('platform.claim_evidence_link')
      .values({
        tenant_id: ctx.tenantId,
        claim_id: row.id,
        source_id: sourceId,
        relation: 'supports',
        created_by: ctx.actorUserId,
        created_at: ctx.now,
      })
      .execute();
  return row.id;
}

/** WS5 hand-off: an accepted analysis proposal becomes a PROPOSED AI claim on the case. */
export async function createClaimFromProposal(
  t: Tools,
  ctx: { tenantId: string; actorUserId: string; now: Date; identity: Identity },
  p: {
    caseId: string;
    statement: string;
    sourceIds: readonly string[];
    agentRunId: string;
    proposalId: string;
    kindDetail?: string | null;
    /** The proposal's epistemic kind (default `inference_ai`); AI never states a scenario or an actual. */
    kind?: Exclude<EpistemicKind, 'scenario' | 'actual'>;
    /** The person edited the proposal before accepting it: origin `ai_edited`. */
    edited?: boolean;
  },
): Promise<Claim> {
  const kind = p.kind ?? 'inference_ai';
  if ((kind as EpistemicKind) === 'scenario' || (kind as EpistemicKind) === 'actual')
    throw new ApiError('VALIDATION_FAILED', 'An AI claim cannot be a scenario or an actual.');
  // An evidence claim needs a real citation; without one it can only be an unknown.
  const id = await insertClaim(t.tx, ctx, {
    caseId: p.caseId,
    statement: p.statement,
    kind: kind === 'evidence' && p.sourceIds.length === 0 ? 'unknown' : kind,
    kindDetail: p.kindDetail ?? null,
    origin: p.edited ? 'ai_edited' : 'ai',
    agentRunId: p.agentRunId,
    sourceIds: p.sourceIds,
    assumptionId: null,
    acceptedBy: null,
  });
  await t.audit({
    action: 'claim.created_from_proposal',
    objectType: 'claim',
    objectId: id,
    caseId: p.caseId,
    summary: 'AI draft claim added from an analysis proposal (not a fact until a person accepts it)',
    details: { proposalId: p.proposalId, agentRunId: p.agentRunId, edited: p.edited ?? false },
  });
  return (await claimsByIds(t.tx, ctx.identity, [id]))[0]!;
}
