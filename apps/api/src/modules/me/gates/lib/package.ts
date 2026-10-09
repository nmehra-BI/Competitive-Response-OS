/**
 * Decision package (S10, decision brief). The current-decision fields (`approvals`, `positions`,
 * `panel`) describe exactly ONE snapshot — the one the viewer is reading. Decisions on earlier snapshots
 * (e.g. a return before a resubmit) appear only in `gateHistory`, so a resubmitted package is approvable
 * again. The panel binds to the snapshot id and hash in this response (D-059).
 */
import {
  GATE_LABELS,
  type DecisionPackageView,
  type GateCode,
  type GateStatus,
  type SnapshotContent,
} from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import {
  createPolicyEngine,
  diffSnapshotContent,
  staleBanner,
  type PolicySubject,
  type ResourceRef,
} from '@growth-os/domain';
import { toFingerprint } from '@growth-os/contracts';
import { isoDateTimeOrNull } from '../../../../platform/serialize';
import { gatePolicy, peopleOf, type CaseLite } from './common';
import {
  approvalRows,
  contentOf,
  displayStatus,
  dissentOfCase,
  positionsOn,
  SNAPSHOT_COLUMNS,
  toApproval,
  toGateRequest,
  toSnapshot,
  type GateRow,
  type SnapshotRow,
} from './serialize';

const policy = createPolicyEngine();

/** Policy resource for deciding a gate request on a given snapshot. */
export function gateResource(
  gate: GateRow,
  caseRow: CaseLite | null,
  snapshot: SnapshotRow | null,
): ResourceRef {
  return {
    type: 'gate_request',
    id: gate.id,
    businessUnitId: gate.business_unit_id,
    caseId: gate.case_id,
    facts: {
      ...(caseRow ? { caseOwnerId: caseRow.ownerUserId, sponsorId: caseRow.sponsorUserId } : {}),
      packageAuthorId: snapshot?.created_by ?? gate.submitted_by ?? gate.created_by,
      gateCode: gate.gate_code as GateCode,
      requestedAmount: gate.requested_amount,
      currency: gate.currency,
      conflictedUserIds: [],
    },
  };
}

const DECIDED: Record<string, GateStatus> = {
  approve: 'approved',
  approve_with_conditions: 'approved_with_conditions',
  return_for_revision: 'returned_for_revision',
  not_approved: 'not_approved',
};

const MATERIAL_FIELDS = new Set([
  'scope',
  'assumptions',
  'economics',
  'sizing',
  'validationResults',
  'budgetAndStopRules',
  'conditionsProposed',
  'outcomeTargets',
  'signOffs',
  'evidenceSummary',
]);

const FIELD_LABELS: Record<string, string> = {
  ask: 'Ask',
  scope: 'Scope',
  recommendation: 'Recommendation',
  alternatives: 'Alternatives',
  evidenceSummary: 'Evidence',
  assumptions: 'Assumptions',
  validationResults: 'Validation results',
  economics: 'Economics',
  sizing: 'Sizing',
  signOffs: 'Sign-offs',
  budgetAndStopRules: 'Budget and stop rules',
  conditionsProposed: 'Proposed conditions',
  dissent: 'Dissent',
  knownLimitations: 'Known limitations',
  blockers: 'Blockers',
  outcomeTargets: 'Outcome targets',
};

export interface Change {
  path: string;
  label: string;
  from: string | null;
  to: string | null;
  material: boolean;
}

const short = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  const s = JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
};

/** "See what changed": field-level changes between two snapshot contents. */
export function diffChanges(from: SnapshotContent, to: SnapshotContent): Change[] {
  const d = diffSnapshotContent(from, to);
  const out: Change[] = [];
  for (const field of d.changedFields) {
    if (field === 'assumptions') {
      const a = new Map(from.assumptions.map((x) => [x.assumptionId, x]));
      const b = new Map(to.assumptions.map((x) => [x.assumptionId, x]));
      for (const [id, x] of b) {
        const y = a.get(id);
        if (!y || y.valueText !== x.valueText || y.versionId !== x.versionId || y.disputed !== x.disputed)
          out.push({
            path: `assumptions.${id}`,
            label: x.name,
            from: y?.valueText ?? null,
            to: x.valueText,
            material: true,
          });
      }
      for (const [id, y] of a)
        if (!b.has(id))
          out.push({ path: `assumptions.${id}`, label: y.name, from: y.valueText, to: null, material: true });
      continue;
    }
    if (field === 'scope') {
      const f = from.scope as Record<string, unknown>;
      const t = to.scope as Record<string, unknown>;
      for (const k of Object.keys(t))
        if (JSON.stringify(f[k]) !== JSON.stringify(t[k]))
          out.push({
            path: `scope.${k}`,
            label: `Scope · ${k}`,
            from: short(f[k]),
            to: short(t[k]),
            material: true,
          });
      continue;
    }
    const f = (from as unknown as Record<string, unknown>)[field];
    const t = (to as unknown as Record<string, unknown>)[field];
    out.push({
      path: field,
      label: FIELD_LABELS[field] ?? field,
      from: short(f),
      to: short(t),
      material: MATERIAL_FIELDS.has(field),
    });
  }
  for (const c of d.components.changed)
    out.push({
      path: `components.${c.type}.${c.id}`,
      label: `${c.type.replace(/_/g, ' ')}`,
      from: c.from === null ? null : `v${c.from}`,
      to: c.to === null ? null : `v${c.to}`,
      material: true,
    });
  for (const c of d.components.added)
    out.push({
      path: `components.${c.type}.${c.id}`,
      label: `${c.type.replace(/_/g, ' ')} added`,
      from: null,
      to: c.version === null ? 'pinned' : `v${c.version}`,
      material: true,
    });
  for (const c of d.components.removed)
    out.push({
      path: `components.${c.type}.${c.id}`,
      label: `${c.type.replace(/_/g, ' ')} removed`,
      from: c.version === null ? 'pinned' : `v${c.version}`,
      to: null,
      material: true,
    });
  return out;
}

export const changeLine = (c: Change): string => `${c.label}: ${c.from ?? '—'} → ${c.to ?? '—'}`;

async function snapshotsOfGate(tx: Tx, gateId: string): Promise<SnapshotRow[]> {
  return (await tx
    .selectFrom('platform.decision_snapshot')
    .select([...SNAPSHOT_COLUMNS])
    .where('gate_request_id', '=', gateId)
    .orderBy('version')
    .execute()) as SnapshotRow[];
}

export async function buildPackage(
  tx: Tx,
  input: {
    gate: GateRow;
    caseRow: CaseLite | null;
    subject: PolicySubject;
    viewerId: string;
    version?: number;
    compareTo?: number;
    /** The version this viewer last opened and when (`platform.gate_request_view`), if ever. */
    lastSeen?: { version: number; viewedAt: Date } | null;
  },
): Promise<DecisionPackageView | null> {
  const { gate, caseRow, subject, viewerId } = input;
  const snaps = await snapshotsOfGate(tx, gate.id);
  const snap = input.version
    ? snaps.find((s) => s.version === input.version)
    : snaps.find((s) => s.id === gate.current_snapshot_id);
  if (!snap) return null;
  const content = contentOf(snap);

  // Current-decision fields: only this snapshot's approvals.
  const approvals = await approvalRows(tx, { snapshotId: snap.id });
  const people = await peopleOf(tx, [
    snap.created_by,
    ...approvals.flatMap((a) => [a.approver_user_id, a.delegated_to_user_id]),
    caseRow?.sponsorUserId,
  ]);

  const isCurrent = snap.id === gate.current_snapshot_id && snap.status === 'current';
  const awaiting = gate.status === 'awaiting_decision';
  const resource = gateResource(gate, caseRow, snap);
  const base = policy.approvalPanel(subject, resource);
  const alreadyDecided = approvals.some((a) => a.approver_user_id === viewerId);
  let cannot: string | null = base.cannotDecideReason;
  let canDecide = base.canDecide;
  if (canDecide && snap.status === 'stale') {
    canDecide = false;
    cannot = staleBanner(snap.stale_reason ?? 'an input changed').title;
  } else if (canDecide && !isCurrent) {
    canDecide = false;
    cannot = 'This is not the current snapshot. Open the current version to decide.';
  } else if (canDecide && !awaiting) {
    canDecide = false;
    cannot = 'This request is not awaiting a decision.';
  } else if (canDecide && alreadyDecided) {
    canDecide = false;
    cannot = 'You have already recorded a decision on this snapshot.';
  }
  const gp = await gatePolicy(tx, gate.gate_code as GateCode);
  const received = approvals.filter(
    (a) =>
      (a.disposition === 'approve' || a.disposition === 'approve_with_conditions') && a.inv_kind === null,
  ).length;
  const bu = await tx
    .selectFrom('platform.business_unit')
    .select('name')
    .where('id', '=', gate.business_unit_id)
    .executeTakeFirst();
  const viewerGrant = subject.authority.find(
    (g) =>
      g.gateCode === gate.gate_code && g.businessUnitId === gate.business_unit_id && g.revokedAt === null,
  );
  const approverId = caseRow?.sponsorUserId ?? null;
  const approverDecision = approverId ? approvals.find((a) => a.approver_user_id === approverId) : undefined;

  // Gate history: every decision on every snapshot of the subject's gates, plus open requests.
  const subjectGates = (await tx
    .selectFrom('platform.gate_request')
    .select(['id', 'gate_code', 'status', 'current_snapshot_id', 'display_key'])
    .where('subject_id', '=', gate.subject_id)
    .orderBy('created_at')
    .execute()) as {
    id: string;
    gate_code: string;
    status: string;
    current_snapshot_id: string | null;
    display_key: string;
  }[];
  const allApprovals = await approvalRows(tx, { gateRequestIds: subjectGates.map((g) => g.id) });
  const snapIndex = new Map<string, { version: number; hash: string }>();
  if (subjectGates.length) {
    const rows = await tx
      .selectFrom('platform.decision_snapshot')
      .select(['id', 'version', 'content_hash'])
      .where(
        'gate_request_id',
        'in',
        subjectGates.map((g) => g.id),
      )
      .execute();
    for (const r of rows) snapIndex.set(r.id, { version: r.version, hash: r.content_hash });
  }
  const gateHistory: DecisionPackageView['gateHistory'] = [];
  for (const g of subjectGates) {
    const code = g.gate_code as GateCode;
    for (const a of allApprovals.filter((x) => x.gate_request_id === g.id && DECIDED[x.disposition])) {
      const si = snapIndex.get(a.snapshot_id);
      gateHistory.push({
        gateRequestId: g.id,
        gateCode: code,
        label: `${GATE_LABELS[code]} · ${g.display_key}${si ? ` · v${si.version}` : ''}`,
        status: a.inv_kind ? (a.inv_kind === 'expired' ? 'expired' : 'invalidated') : DECIDED[a.disposition]!,
        snapshotVersion: si?.version ?? null,
        fingerprint: si ? toFingerprint(si.hash) : null,
        rationale: a.rationale,
        decidedAt: isoDateTimeOrNull(a.decided_at),
      });
    }
    if (['draft', 'awaiting_decision', 'stale', 'withdrawn'].includes(g.status)) {
      const si = g.current_snapshot_id ? snapIndex.get(g.current_snapshot_id) : undefined;
      gateHistory.push({
        gateRequestId: g.id,
        gateCode: code,
        label: `${GATE_LABELS[code]} · ${g.display_key}${si ? ` · v${si.version}` : ''}`,
        status:
          g.status === 'withdrawn' ? 'superseded' : displayStatus({ gate_code: code, status: g.status }),
        snapshotVersion: si?.version ?? null,
        fingerprint: si ? toFingerprint(si.hash) : null,
        rationale: null,
        decidedAt: null,
      });
    }
  }

  // "Changes since" (D-078): against the requested version; else against the version this viewer last
  // opened (nothing when it is this one); a first-time viewer sees the changes from the snapshot this
  // one superseded.
  let changes: string[] = [];
  const seen = input.lastSeen ?? null;
  const against = input.compareTo
    ? snaps.find((s) => s.version === input.compareTo)
    : seen
      ? snaps.find((s) => s.version === seen.version)
      : snaps.find((s) => s.superseded_by_snapshot_id === snap.id);
  if (against && against.id !== snap.id) changes = diffChanges(contentOf(against), content).map(changeLine);

  return {
    gateRequest: await toGateRequest(tx, gate),
    snapshot: toSnapshot(snap, people),
    approvals: approvals.map((a) => toApproval(a, people)),
    dissent: caseRow ? await dissentOfCase(tx, caseRow.id) : [],
    positions: await positionsOn(tx, snap.id),
    panel: {
      canDecide,
      allowedDispositions: canDecide ? base.allowedDispositions : [],
      cannotDecideReason: canDecide ? base.cannotDecideReason : cannot,
      viewerAuthorityText: viewerGrant ? `Up to €[limit] · ${bu?.name ?? 'this business unit'}` : null,
      chain: approverId
        ? [
            {
              approver: people(approverId),
              routingReason: `${GATE_LABELS[gate.gate_code as GateCode]} in ${bu?.name ?? 'this business unit'} routes to the sponsor`,
              state: approverDecision
                ? approverDecision.disposition === 'abstain'
                  ? 'abstained'
                  : approverDecision.disposition === 'delegate'
                    ? 'delegated'
                    : 'decided'
                : 'waiting',
              isViewer: approverId === viewerId,
            },
          ]
        : [],
      requiredApprovals: gp.requiredApprovals,
      receivedApprovals: received,
    },
    changesSinceViewerLastSaw: changes,
    changesSince: seen ? { sinceVersion: seen.version, viewedAt: seen.viewedAt.toISOString() } : null,
    staleBanner: snap.status === 'stale' ? staleBanner(snap.stale_reason ?? 'an input changed') : null,
    gateHistory,
  };
}
