/** Thesis and claim serializers (S05). Exported for WS4b snapshot content and WS5. */
import {
  FEASIBILITY_DIMENSION_LABELS,
  REVIEW_STATUS_LABELS,
  ThesisFields,
  type Claim,
  type FeasibilityDimension,
  type ReviewStatus,
  type ThesisVersion,
  type ThesisView,
} from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import type { Identity } from '../../../platform/context';
import { isoDateOrNull, isoDateTime, isoDateTimeOrNull } from '../../../platform/serialize';
import { caseAssumptions, challengesWhere } from '../assumptions/read';
import { peopleMap, who, type CaseRecord } from '../cases/access';
import { chipsFor, sourceChips } from '../cases/sources';

export type ThesisRow = {
  id: string;
  case_id: string;
  version: number;
  state: string;
  fields: unknown;
  reviewer_accepted_by: string | null;
  row_version: number;
  committed_at: Date | null;
  created_at: Date;
};

const empty = { value: '', origin: 'human' as const, agentRunId: null, editedBy: null };
export const EMPTY_THESIS: ThesisFields = {
  proposition: empty,
  intendedCustomer: empty,
  whyNow: empty,
  reasonsToWin: [],
  alternatives: [],
  recommendation: null,
  recommendationBy: null,
  claimIds: [],
};

export function toThesisVersion(r: ThesisRow): ThesisVersion {
  return {
    id: r.id,
    caseId: r.case_id,
    version: r.version,
    state: r.state as ThesisVersion['state'],
    fields: ThesisFields.parse(r.fields),
    rowVersion: r.row_version,
    committedAt: isoDateTimeOrNull(r.committed_at),
    reviewerAcceptedBy: r.reviewer_accepted_by,
    createdAt: isoDateTime(r.created_at),
  };
}

export async function thesisVersions(tx: Tx, caseId: string): Promise<ThesisRow[]> {
  return (await tx.selectFrom('me.thesis_version').selectAll().where('case_id', '=', caseId).orderBy('version').execute()) as ThesisRow[];
}

type ClaimRow = Awaited<ReturnType<typeof claimRows>>[number];
async function claimRows(tx: Tx, where: { caseId?: string; ids?: string[] }) {
  let q = tx.selectFrom('platform.claim').selectAll();
  if (where.caseId) q = q.where('case_id', '=', where.caseId);
  if (where.ids) q = q.where('id', 'in', where.ids.length ? where.ids : ['00000000-0000-4000-8000-000000000000']);
  return q.orderBy('created_at').execute();
}

export async function toClaims(tx: Tx, identity: Identity, rows: readonly ClaimRow[]): Promise<Claim[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const links = await tx.selectFrom('platform.claim_evidence_link').select(['claim_id', 'source_id']).where('claim_id', 'in', ids).execute();
  const open = await tx
    .selectFrom('platform.challenge')
    .select('target_id')
    .where('target_type', '=', 'claim')
    .where('target_id', 'in', ids)
    .where('status', '=', 'open')
    .execute();
  const chips = await sourceChips(tx, identity, links.map((l) => l.source_id));
  return rows.map((r) => ({
    id: r.id,
    caseId: r.case_id,
    statement: r.statement,
    kind: r.kind as Claim['kind'],
    kindDetail: r.kind_detail,
    origin: r.origin as Claim['origin'],
    agentRunId: r.agent_run_id,
    status: r.status as Claim['status'],
    acceptedBy: r.accepted_by,
    acceptedAt: isoDateTimeOrNull(r.accepted_at),
    sources: chipsFor(chips, [...new Set(links.filter((l) => l.claim_id === r.id).map((l) => l.source_id))]),
    disputed: open.some((o) => o.target_id === r.id),
    createdAt: isoDateTime(r.created_at),
    createdBy: r.created_by,
  }));
}

export async function claimsByIds(tx: Tx, identity: Identity, ids: string[]): Promise<Claim[]> {
  return toClaims(tx, identity, await claimRows(tx, { ids }));
}

export async function thesisView(tx: Tx, identity: Identity, c: CaseRecord): Promise<ThesisView> {
  const versions = await thesisVersions(tx, c.id);
  const committed = versions.filter((v) => v.state === 'committed');
  const draft = versions.find((v) => v.state === 'draft');
  const assumptions = (await caseAssumptions(tx, c.id, c.display_key)).filter((a) => a.decisionCritical && a.status !== 'retired');
  const blockers = await tx.selectFrom('me.blocker').selectAll().where('case_id', '=', c.id).where('status', '=', 'open').execute();
  const feas = await tx.selectFrom('me.feasibility_assessment').selectAll().where('case_id', '=', c.id).execute();
  const people = await peopleMap(tx, [...blockers.map((b) => b.owner_user_id ?? c.owner_user_id), ...feas.map((f) => f.reviewer_user_id)]);
  return {
    current: committed.length ? toThesisVersion(committed[committed.length - 1]!) : null,
    draft: draft ? toThesisVersion(draft) : null,
    claims: await toClaims(tx, identity, await claimRows(tx, { caseId: c.id })),
    criticalAssumptions: assumptions.slice(0, 5),
    disagreements: await challengesWhere(tx, { caseId: c.id, openOnly: true }),
    blockers: blockers.map((b) => ({
      id: b.id,
      text: b.text,
      owner: who(people, b.owner_user_id ?? c.owner_user_id),
      dueOn: isoDateOrNull(b.due_on),
      gate: b.blocks_gate,
    })),
    reviewers: feas.map((f) => ({
      person: who(people, f.reviewer_user_id),
      area: FEASIBILITY_DIMENSION_LABELS[f.dimension as FeasibilityDimension],
      status: REVIEW_STATUS_LABELS[f.status as ReviewStatus],
    })),
  };
}

/** WS4b hand-off: the committed thesis version a snapshot pins, with its recommendation and alternatives. */
export async function committedThesis(tx: Tx, caseId: string): Promise<ThesisVersion | null> {
  const v = (await thesisVersions(tx, caseId)).filter((x) => x.state === 'committed').pop();
  return v ? toThesisVersion(v) : null;
}
