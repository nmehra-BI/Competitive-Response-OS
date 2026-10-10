/**
 * Governance facts of one gate request (D-109, D-110, D-124): the effective gate policy, the route
 * under the delegated-authority matrix, the committee seats of the business unit, the people excluded
 * from a seat on this case, and every decision recorded on the request. Pure decisions are made by
 * `@growth-os/domain` (routeRequest, evaluateCommittee); this file only loads facts.
 *
 * All amounts are one-time money of one gate (never-rule 3). The X cumulative rule adds the parent
 * pilot's one-time ask to the one-time asks of its own extensions only.
 */
import {
  type CommitteeSeat,
  type GateCode,
  type GateDisposition,
  type PersonRef,
} from '@growth-os/contracts';
import { sql, type Tx } from '@growth-os/db';
import {
  effectiveGatePolicy,
  evaluateCommittee,
  routeRequest,
  type CommitteeEvaluation,
  type CommitteeHolder,
  type EffectiveGatePolicy,
  type RouteResult,
} from '@growth-os/domain';
import { cents, fromCents, gatePolicy, peopleOf, type CaseLite } from './common';
import type { GateRow } from './serialize';

export interface DecisionFactRow {
  id: string;
  snapshot_id: string;
  approver_user_id: string;
  disposition: string;
  committee_seat: string | null;
  invalidated: boolean;
}

export interface GateGovernance {
  policy: EffectiveGatePolicy;
  route: RouteResult;
  /** Live committee seats of the gate's business unit on the decision date. */
  holders: CommitteeHolder[];
  /** Committee route: author, case owner, the case's signed economics finance reviewer(s). */
  excludedUserIds: string[];
  decisions: DecisionFactRow[];
  /** The case sponsor's grant ceiling for this gate and BU (undefined = no grant). */
  sponsorGrantCeiling: string | null | undefined;
  businessUnitName: string;
}

const ACTIVE_X = ['draft', 'awaiting_decision', 'stale', 'approved', 'approved_with_conditions'];

/** Highest valid grant ceiling of a person for gate × BU on `asOf` (undefined = none; null = no-spend). */
export async function grantCeiling(
  tx: Tx,
  userId: string | null,
  gateCode: GateCode,
  businessUnitId: string,
  asOf: string,
): Promise<string | null | undefined> {
  if (!userId) return undefined;
  const rows = await sql<{ ceiling_amount: string | null }>`
    SELECT ceiling_amount FROM platform.authority_grant
     WHERE user_id = ${userId} AND gate_code = ${gateCode} AND business_unit_id = ${businessUnitId}
       AND revoked_at IS NULL AND valid_from <= ${asOf}::date
       AND (valid_to IS NULL OR valid_to >= ${asOf}::date)
     ORDER BY ceiling_amount DESC NULLS LAST`.execute(tx);
  if (rows.rows.length === 0) return undefined;
  return rows.rows[0]!.ceiling_amount;
}

/** Live committee seats of a business unit on `asOf` (D-124: one live holder per seat). */
export async function committeeHolders(
  tx: Tx,
  businessUnitId: string,
  asOf: string,
): Promise<CommitteeHolder[]> {
  const rows = await sql<{ seat: CommitteeSeat; user_id: string }>`
    SELECT seat, user_id FROM platform.committee_member
     WHERE business_unit_id = ${businessUnitId} AND revoked_at IS NULL
       AND valid_from <= ${asOf}::date AND (valid_to IS NULL OR valid_to >= ${asOf}::date)
     ORDER BY seat`.execute(tx);
  return rows.rows.map((r) => ({ seat: r.seat, userId: r.user_id }));
}

/** Finance reviewers who signed this case's economics review (four eyes: never on a seat for it). */
export async function economicsReviewers(tx: Tx, caseId: string | null): Promise<string[]> {
  if (!caseId) return [];
  const rows = await tx
    .selectFrom('me.model_review')
    .select('reviewer_user_id')
    .where('case_id', '=', caseId)
    .where('model_type', '=', 'economics')
    .where('signed_at', 'is not', null)
    .execute();
  return [...new Set(rows.map((r) => r.reviewer_user_id))];
}

export async function decisionFacts(tx: Tx, gateId: string): Promise<DecisionFactRow[]> {
  const r = await sql<DecisionFactRow>`
    SELECT a.id, a.snapshot_id, a.approver_user_id, a.disposition, a.committee_seat,
      EXISTS (SELECT 1 FROM platform.approval_invalidation i WHERE i.approval_id = a.id) AS invalidated
      FROM platform.approval a WHERE a.gate_request_id = ${gateId}
     ORDER BY a.decided_at`.execute(tx);
  return r.rows;
}

/** Load everything the route and the committee panel need for one request. */
export async function loadGovernance(
  tx: Tx,
  gate: GateRow,
  caseRow: CaseLite | null,
  asOf: string,
  sponsorId: string | null = caseRow?.sponsorUserId ?? null,
): Promise<GateGovernance> {
  const code = gate.gate_code as GateCode;
  const policy = effectiveGatePolicy(await gatePolicy(tx, code));
  const sponsorGrantCeiling = await grantCeiling(tx, sponsorId, code, gate.business_unit_id, asOf);
  let cumulative: Parameters<typeof routeRequest>[0]['cumulative'];
  if (code === 'X' && gate.parent_gate_request_id && policy.extension) {
    const parent = await tx
      .selectFrom('platform.gate_request')
      .select(['requested_amount'])
      .where('id', '=', gate.parent_gate_request_id)
      .executeTakeFirst();
    const others = await tx
      .selectFrom('platform.gate_request')
      .select('requested_amount')
      .where('parent_gate_request_id', '=', gate.parent_gate_request_id)
      .where('gate_code', '=', 'X')
      .where('id', '<>', gate.id)
      .where('status', 'in', ACTIVE_X)
      .execute();
    const prior = [parent?.requested_amount, ...others.map((o) => o.requested_amount)]
      .filter((x): x is string => typeof x === 'string')
      .reduce((s, x) => s + cents(x), 0n);
    cumulative = {
      priorAmount: fromCents(prior),
      sponsorParentCeiling: (await grantCeiling(tx, sponsorId, 'G2', gate.business_unit_id, asOf)) ?? null,
      within: policy.extension.cumulativeWithinSponsorCeiling,
    };
  }
  const route = routeRequest({
    gateCode: code,
    amount: gate.requested_amount,
    currency: gate.currency,
    authority: policy.authority,
    sponsorGrantCeiling,
    cumulative,
  });
  const bu = await tx
    .selectFrom('platform.business_unit')
    .select('name')
    .where('id', '=', gate.business_unit_id)
    .executeTakeFirst();
  const holders = route.route === 'committee' ? await committeeHolders(tx, gate.business_unit_id, asOf) : [];
  let excludedUserIds: string[] = [];
  if (route.route === 'committee') {
    const snap = gate.current_snapshot_id
      ? await tx
          .selectFrom('platform.decision_snapshot')
          .select('created_by')
          .where('id', '=', gate.current_snapshot_id)
          .executeTakeFirst()
      : undefined;
    excludedUserIds = [
      ...new Set(
        [
          snap?.created_by ?? gate.submitted_by ?? gate.created_by,
          caseRow?.ownerUserId,
          ...(await economicsReviewers(tx, gate.case_id)),
        ].filter((x): x is string => typeof x === 'string'),
      ),
    ];
  }
  return {
    policy,
    route,
    holders,
    excludedUserIds,
    decisions: route.route === 'committee' ? await decisionFacts(tx, gate.id) : [],
    sponsorGrantCeiling,
    businessUnitName: bu?.name ?? 'this business unit',
  };
}

/** Evaluate the committee on the request's current snapshot. */
export function committeeOf(
  gov: GateGovernance,
  currentSnapshotId: string | null,
  viewerId: string | null,
): CommitteeEvaluation {
  return evaluateCommittee({
    quorum: gov.policy.committee.quorum,
    seats: gov.policy.committee.seats,
    requiredSeats: gov.policy.committee.requiredSeats,
    holders: gov.holders,
    excludedUserIds: gov.excludedUserIds,
    currentSnapshotId,
    viewerId,
    decisions: gov.decisions.map((d) => ({
      userId: d.approver_user_id,
      seat: (d.committee_seat ?? null) as CommitteeSeat | null,
      disposition: d.disposition as GateDisposition,
      snapshotId: d.snapshot_id,
      effective: !d.invalidated,
    })),
  });
}

/** The S10 panel's committee block (contract `ApprovalPanelState.committee`). */
export async function committeePanel(
  tx: Tx,
  gov: GateGovernance,
  currentSnapshotId: string | null,
  viewerId: string,
) {
  const e = committeeOf(gov, currentSnapshotId, viewerId);
  const people = await peopleOf(
    tx,
    e.seats.map((s) => s.userId),
  );
  return {
    evaluation: e,
    panel: {
      quorum: gov.policy.committee.quorum,
      requiredSeats: [...gov.policy.committee.requiredSeats],
      seats: e.seats.map((s) => ({
        seat: s.seat,
        member: s.userId ? (people(s.userId) as PersonRef) : null,
        required: s.required,
        state: s.state,
        isViewer: s.isViewer,
      })),
      statusText: e.statusText,
    },
  };
}
