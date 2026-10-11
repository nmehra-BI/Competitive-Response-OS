/**
 * One-step "Accept as fact" (D-116, D-131). An unedited claim proposal whose every evidence citation
 * opens for the viewer may be accepted as a fact by one human act: the proposal is accepted, the AI
 * draft claim is written and accepted in the same transaction, with both audit events
 * (`claim.created_from_proposal` + `claim.accepted`, then `proposal.accepted`). Otherwise only "Add as
 * draft" is offered and acceptance stays a second step (`claims.accept`). Uncited evidence still
 * becomes Unknown (D-088). Never-rule 11 holds: one human acceptance, never by regeneration.
 *
 * "Opens for the viewer" is the source chip rule: the cited passage or source exists in this tenant
 * and is not restricted for this person (licence, availability, deletion). The reason never names or
 * counts what is hidden (never-rule 8).
 */
import type { Proposal, ProposalPayload } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { roleAllows } from '../../platform/authz';
import type { Identity } from '../../platform/context';
import { sourceChips } from '../me/cases/sources';

export const ONE_STEP_REASONS = {
  decided: 'This proposal has already been decided.',
  uncited: 'No citation: add it as a draft, then decide.',
  notOpen: 'A citation does not open for you: add it as a draft, then decide.',
  kind: 'A scenario or an actual is never accepted from an analysis.',
  role: 'Your role does not accept AI claims.',
} as const;

/** Map cited ids (passage ids from `evidence.get`, or source ids) to source ids; null if any is unknown. */
async function citedSources(tx: Tx, ids: readonly string[]): Promise<string[] | null> {
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
  const out: string[] = [];
  for (const id of ids) {
    const p = passages.find((x) => x.id === id);
    if (p) out.push(p.source_id);
    else if (sources.some((s) => s.id === id)) out.push(id);
    else return null;
  }
  return [...new Set(out)];
}

/** Does every citation open for this viewer? (At least one citation is required.) */
export async function citationsOpen(tx: Tx, identity: Identity, ids: readonly string[]): Promise<boolean> {
  if (ids.length === 0) return false;
  const sourceIds = await citedSources(tx, ids);
  if (!sourceIds || sourceIds.length === 0) return false;
  const chips = await sourceChips(tx, identity, sourceIds);
  return sourceIds.every((id) => {
    const chip = chips.get(id);
    return !!chip && !chip.restricted;
  });
}

/** `Proposal.oneStepAccept` for this viewer; undefined for proposals that are not claims. */
export async function oneStepAcceptFor(
  tx: Tx,
  identity: Identity,
  p: {
    status: string;
    payload: ProposalPayload;
    caseScope: { businessUnitId: string; caseId: string } | null;
  },
): Promise<Proposal['oneStepAccept']> {
  if (p.payload.type !== 'claim') return undefined;
  const no = (reason: string) => ({ available: false, reason });
  if (p.status !== 'proposed') return no(ONE_STEP_REASONS.decided);
  const k = p.payload.claim.kind;
  if (k === 'scenario' || k === 'actual') return no(ONE_STEP_REASONS.kind);
  if (!p.caseScope || !roleAllows(identity.subject, 'claim.accept_ai', p.caseScope).allow)
    return no(ONE_STEP_REASONS.role);
  if (p.payload.claim.evidenceIds.length === 0) return no(ONE_STEP_REASONS.uncited);
  if (!(await citationsOpen(tx, identity, p.payload.claim.evidenceIds))) return no(ONE_STEP_REASONS.notOpen);
  return { available: true, reason: null };
}
