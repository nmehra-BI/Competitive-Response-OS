/**
 * S09 "Add assumption" confidence basis (D-112 §1, D-132): an assumption is Evidence when sources are
 * linked, otherwise "Assumption — no evidence". The link is stored as an accepted, human-authored
 * evidence claim on the assumption (`claim.assumption_id`, `kind_detail` = `assumption_basis`) with
 * one `claim_evidence_link` per source; no new table is needed. The claim carries no case id, so it
 * never appears among the thesis claims. Only sources the author may open can be linked: a hidden or
 * restricted source is refused with the same message as an unknown one (never-rule 8).
 */
import type { EvidenceQuality, SourceChip } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import type { Identity } from '../../../platform/context';
import { ApiError } from '../../../platform/errors';
import { chipsFor, sourceChips } from '../cases/sources';

export const BASIS_DETAIL = 'assumption_basis';
const RANK: EvidenceQuality[] = ['strong', 'some', 'weak', 'conflicting', 'none'];

export async function evidenceBasis(
  tx: Tx,
  identity: Identity,
  sourceIds: readonly string[],
): Promise<{ ids: string[]; quality: EvidenceQuality }> {
  const ids = [...new Set(sourceIds)];
  if (ids.length === 0) return { ids, quality: 'none' };
  const chips = await sourceChips(tx, identity, ids);
  ids.forEach((id, i) => {
    const chip = chips.get(id);
    if (!chip || chip.restricted)
      throw new ApiError('VALIDATION_FAILED', 'Link a source you can open.', {
        errors: [{ path: `body.sourceIds.${i}`, code: 'unknown_source', message: 'Unknown source' }],
      });
  });
  const quality = chipsFor(chips, ids)
    .map((c) => c.quality)
    .sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0]!;
  return { ids, quality };
}

export async function linkEvidence(
  tx: Tx,
  tenantId: string,
  userId: string,
  now: Date,
  assumptionId: string,
  statement: string,
  sourceIds: readonly string[],
): Promise<void> {
  if (sourceIds.length === 0) return;
  const claim = await tx
    .insertInto('platform.claim')
    .values({
      tenant_id: tenantId,
      case_id: null,
      statement,
      kind: 'evidence',
      kind_detail: BASIS_DETAIL,
      origin: 'human',
      status: 'accepted',
      accepted_by: userId,
      accepted_at: now,
      assumption_id: assumptionId,
      created_by: userId,
      created_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const sourceId of sourceIds)
    await tx
      .insertInto('platform.claim_evidence_link')
      .values({
        tenant_id: tenantId,
        claim_id: claim.id,
        source_id: sourceId,
        passage_id: null,
        relation: 'supports',
        created_by: userId,
        created_at: now,
      })
      .execute();
}

/** Linked basis sources per assumption id, as chips the viewer may see (metadata only). */
export async function basisChips(
  tx: Tx,
  identity: Identity,
  assumptionIds: readonly string[],
): Promise<Map<string, SourceChip[]>> {
  if (assumptionIds.length === 0) return new Map();
  const links = await tx
    .selectFrom('platform.claim as c')
    .innerJoin('platform.claim_evidence_link as l', 'l.claim_id', 'c.id')
    .select(['c.assumption_id', 'l.source_id'])
    .where('c.assumption_id', 'in', [...assumptionIds])
    .where('c.kind_detail', '=', BASIS_DETAIL)
    .orderBy('l.created_at')
    .execute();
  const chips = await sourceChips(
    tx,
    identity,
    links.map((l) => l.source_id),
  );
  const out = new Map<string, SourceChip[]>();
  for (const id of assumptionIds)
    out.set(
      id,
      chipsFor(
        chips,
        links.filter((l) => l.assumption_id === id).map((l) => l.source_id),
      ),
    );
  return out;
}
