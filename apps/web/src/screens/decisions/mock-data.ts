/**
 * View-model builders for the S10 Decisions and decision brief mocks (WS8c). They extend the WS7
 * aster-demo builders (`mocks/data.ts`) with the moments this stream needs: G1 awaiting and
 * approved, the G2 draft, v3 → v4 after a stale snapshot, superseded versions, and approvals
 * that were invalidated or expired. Numbers and copy come from fixtures/aster; copy for stale
 * and invalidated states follows the WS3 materiality rules.
 */
import {
  toFingerprint,
  type ApprovalPanelState,
  type CaseHeader,
  type DecisionPackageView,
  type DecisionSnapshot,
  type GatePreconditionsView,
  type GateRequest,
  type GateScope,
  type GateStatus,
} from '@growth-os/contracts';
import { cases, exp03, fid, gates, journeyMoments as J, mandate, people } from '@growth-os/fixtures-aster';
import { formatBudget } from '@growth-os/ui';
import {
  caseHeader,
  decisionPackage,
  G2_HASH,
  G2_SNAPSHOT_ID,
  G2_V2_SNAPSHOT_ID,
  g2Status,
  hashFor,
  P,
  preconditions,
} from '../../mocks/data';
import { state } from '../../mocks/state';
import { hasResults, isStale, ws } from './mock-state';

const ME104 = cases[0];
const G1_SNAPSHOT_ID = fid('snapshot', 11);
export const G1_HASH = hashFor(gates.g1.prototypeFingerprint);
export const G1_ID = gates.g1.id;
export const G2_ID = gates.g2.id;
export const G2_V4_SNAPSHOT_ID = fid('snapshot', 4);
export const G2_V4_HASH = hashFor('9C1E·4B07');
export const G2_V4_CREATED = '2026-11-26T15:10:00+01:00';
const STALE_AT = gates.g2.staleVariant.changedAt;
/** Tenant-local date the approval expires unused (fixture `expiresAt`). */
const EXPIRES_AT = gates.g2.expiresAt;
const INVALIDATED_AT = '2026-11-30T10:20:00+01:00';
export const G1_SUBMITTED_AT = gates.g1.submittedAt;

/** WS3 materiality copy: `staleBanner(reason)` / `invalidationNotice(v, reasonShort, paused)`. */
export const STALE_REASON = 'adoption assumption changed on 26 Nov';
export const STALE_BANNER = {
  title: `This snapshot is out of date: ${STALE_REASON}. Approval is disabled.`,
  body: 'Refresh the snapshot to create a new version from the current committed inputs.',
};
export const INVALIDATION_REASON = 'adoption assumption changed';

const ELENA_AUTHORITY = 'Up to €[limit] · BU Water · pilots and validation';

// ---------------------------------------------------------------------------
// Approval panel (WS3 PolicyEngine.approvalPanel copy)
// ---------------------------------------------------------------------------

export function panelFor(
  viewerId: string | null,
  gate: 'G1' | 'G2',
  decided: boolean,
  /** Why the designated approver cannot decide this version (stale or superseded snapshot). */
  snapshotBlock: string | null = null,
): ApprovalPanelState {
  const isElena = viewerId === people.elena.id;
  const chain = [
    {
      approver: P('elena'),
      routingReason:
        gate === 'G2'
          ? 'Pilot spend in BU Water routes to the BU VP'
          : 'Validation spend in BU Water routes to the BU VP',
      state: decided ? ('decided' as const) : ('waiting' as const),
      isViewer: isElena,
    },
  ];
  const base = { chain, requiredApprovals: 1, receivedApprovals: decided ? 1 : 0 };
  if (decided) {
    return {
      ...base,
      canDecide: false,
      allowedDispositions: [],
      cannotDecideReason: null,
      viewerAuthorityText: isElena ? ELENA_AUTHORITY : null,
    };
  }
  if (isElena && snapshotBlock) {
    return {
      ...base,
      canDecide: false,
      allowedDispositions: [],
      cannotDecideReason: snapshotBlock,
      viewerAuthorityText: ELENA_AUTHORITY,
    };
  }
  if (isElena) {
    return {
      ...base,
      canDecide: true,
      allowedDispositions: [
        'approve',
        'approve_with_conditions',
        'return_for_revision',
        'not_approved',
        'abstain',
      ],
      cannotDecideReason: null,
      viewerAuthorityText: ELENA_AUTHORITY,
    };
  }
  return {
    ...base,
    canDecide: false,
    allowedDispositions: [],
    cannotDecideReason: cannotDecideReason(viewerId),
    viewerAuthorityText: null,
  };
}

export function cannotDecideReason(viewerId: string | null): string {
  if (viewerId === people.maya.id) return 'You authored this package and cannot approve it.';
  if (viewerId === people.admin.id)
    return 'Administrators configure roles and policies but cannot approve gates.';
  return 'Your role does not decide gates.';
}

// ---------------------------------------------------------------------------
// G1 · Approve validation €15k
// ---------------------------------------------------------------------------

function g1Scope(): GateScope {
  const w = ws();
  return (
    w.g1Scope ?? {
      amount: gates.g1.amount,
      currency: gates.g1.currency,
      durationDays: null,
      windowStart: exp03.originalPlan.windowStart,
      windowEnd: exp03.originalPlan.windowEnd,
      countryCodes: ['DE'],
      segmentLabel: 'Food processing',
      maxSites: 20,
      milestones: [],
      ownerId: people.maya.id,
      authorizes: [...gates.g1.authorizes],
      doesNotAuthorize: [...gates.g1.doesNotAuthorize],
    }
  );
}

function g1Label(scope: GateScope): string {
  return scope.amount && scope.currency
    ? `Approve validation ${formatBudget(scope.amount, scope.currency)}`
    : gates.g1.buttonLabel;
}

export function g1Request(): GateRequest | null {
  const w = ws();
  if (w.g1 === 'none') return null;
  const scope = g1Scope();
  const d = w.g1Decision ?? (w.g1 === 'approved' ? { ...gates.g1.decision } : null);
  const status: GateRequest['status'] =
    w.g1 === 'draft'
      ? 'draft'
      : w.g1 === 'awaiting'
        ? 'awaiting_decision'
        : d?.disposition === 'return_for_revision'
          ? 'returned_for_revision'
          : d?.disposition === 'not_approved'
            ? 'not_approved'
            : 'approved';
  const display: GateStatus =
    status === 'draft' ? 'ready_to_submit' : status === 'awaiting_decision' ? 'awaiting_decision' : status;
  return {
    id: G1_ID,
    key: gates.g1.key,
    caseId: ME104.id,
    mandateId: mandate.id,
    gateCode: 'G1',
    status,
    displayStatus: display,
    scope,
    buttonLabel: g1Label(scope),
    parentGateRequestId: null,
    submittedBy: w.g1 === 'draft' ? null : P('maya'),
    submittedAt: w.g1 === 'draft' ? null : G1_SUBMITTED_AT,
    decidedAt: w.g1 === 'approved' && d ? d.at : null,
    expiresAt: null,
    currentSnapshotId: w.g1 === 'draft' ? null : G1_SNAPSHOT_ID,
    conditions: [],
    rowVersion: w.g1 === 'draft' ? 1 : w.g1 === 'awaiting' ? 2 : 3,
  };
}

export function g1Package(viewerId: string | null): DecisionPackageView | null {
  const w = ws();
  const req = g1Request();
  if (!req || w.g1 === 'draft') return null;
  const base = decisionPackage(G1_ID, viewerId)!;
  const decided = w.g1 === 'approved';
  const d = w.g1Decision ?? { ...gates.g1.decision };
  const snapshot: DecisionSnapshot = {
    ...base.snapshot,
    createdAt: G1_SUBMITTED_AT,
    content: {
      ...base.snapshot.content,
      scope: req.scope,
      ask: `Approve validation outreach to ${req.scope.maxSites ?? 20} sites with a budget of up to ${
        req.scope.amount && req.scope.currency ? formatBudget(req.scope.amount, req.scope.currency) : '—'
      }. This is not a pilot.`,
      assumptions: base.snapshot.content.assumptions.map((a) => ({ ...a })),
    },
  };
  return {
    ...base,
    gateRequest: req,
    snapshot,
    approvals: decided ? base.approvals.map((a) => ({ ...a, ...pickDecision(d) })) : [],
    panel: panelFor(viewerId, 'G1', decided),
    gateHistory: history(),
  };
}

function pickDecision(d: { disposition: string; rationale: string; at: string; by: string }) {
  return {
    disposition: d.disposition as DecisionPackageView['approvals'][number]['disposition'],
    rationale: d.rationale,
    decidedAt: d.at,
  };
}

// ---------------------------------------------------------------------------
// G2 · Approve pilot €120k · 90 days
// ---------------------------------------------------------------------------

function g2Scope(baseScope: GateScope): GateScope {
  return ws().g2Scope ?? baseScope;
}

export function g2Label(scope: GateScope): string {
  if (!scope.amount || !scope.currency) return gates.g2.buttonLabel;
  const amount = formatBudget(scope.amount, scope.currency);
  return scope.durationDays
    ? `Approve pilot ${amount} · ${scope.durationDays} days`
    : `Approve pilot ${amount}`;
}

function snapshotIdFor(v: number): string {
  return v === 4 ? G2_V4_SNAPSHOT_ID : v === 3 ? G2_SNAPSHOT_ID : G2_V2_SNAPSHOT_ID;
}

export function snapshotHashFor(v: number): string {
  return v === 4 ? G2_V4_HASH : v === 3 ? G2_HASH : hashFor('2C55·A10E');
}

function decided(): boolean {
  const d = state.g2Decision;
  return !!d && d.disposition !== 'abstain';
}

export function g2Request(): GateRequest | null {
  const w = ws();
  if (w.g2 === 'none') return null;
  const base = decisionPackage(G2_ID, null)!.gateRequest;
  const scope = g2Scope(base.scope);
  const isDraft = w.g2 === 'draft';
  const stale = isStale();
  let status: GateRequest['status'] = base.status === 'stale' ? 'awaiting_decision' : base.status;
  if (stale) status = 'stale';
  if (isDraft) status = 'draft';
  if (w.g2 === 'withdrawn') status = 'withdrawn';
  if (decided() && w.g2Invalidated) status = 'invalidated';
  if (decided() && w.g2Expired) status = 'expired';
  const display: GateStatus =
    status === 'draft'
      ? 'ready_to_submit'
      : status === 'stale'
        ? 'awaiting_decision'
        : status === 'withdrawn'
          ? 'ready_to_submit'
          : status;
  const proposed = w.g2Proposed;
  const conditions = proposed
    ? [
        ...proposed.map((c, i) => ({
          id: fid('condition', 30 + i),
          key: `C${i + 1}`,
          text: c.text,
          owner: P(personKey(c.ownerId)),
          dueOn: c.dueOn,
          dueRule: c.dueRule,
          flag: c.flag,
          status: 'open' as const,
          addedBy: P('maya'),
          metEvidence: null,
          metAt: null,
        })),
        ...base.conditions.filter((c) => c.addedBy.id !== people.maya.id),
      ]
    : base.conditions;
  return {
    ...base,
    status,
    displayStatus: display,
    scope,
    buttonLabel: g2Label(scope),
    submittedBy: isDraft ? null : base.submittedBy,
    submittedAt: isDraft ? null : base.submittedAt,
    currentSnapshotId: isDraft ? null : snapshotIdFor(w.g2Version),
    conditions,
    rowVersion: base.rowVersion + (w.g2Version - 3),
  };
}

function personKey(id: string): keyof typeof people {
  const k = (Object.keys(people) as (keyof typeof people)[]).find((key) => people[key].id === id);
  if (!k) throw new Error(`unknown person ${id}`);
  return k;
}

function g2Snapshot(v: number, current: number): DecisionSnapshot {
  const base = decisionPackage(G2_ID, null)!.snapshot;
  const req = g2Request()!;
  const status: DecisionSnapshot['status'] = v < current ? 'superseded' : isStale() ? 'stale' : 'current';
  const content = { ...base.content, scope: req.scope };
  if (v === 4) {
    content.assumptions = content.assumptions.map((a) =>
      a.name === 'Adoption 20% by year 3' ? { ...a, versionId: fid('assumptionVersion', 101) } : a,
    );
    content.components = content.components.map((c) => ({ ...c }));
  }
  if (v === 2) {
    content.signOffs = content.signOffs.filter((s) => s.area !== 'specialist');
    content.budgetAndStopRules = [];
    content.conditionsProposed = [];
  }
  const id = snapshotIdFor(v);
  const hash = snapshotHashFor(v);
  return {
    ...base,
    id,
    version: v,
    status,
    staleReason: status === 'stale' ? gates.g2.staleVariant.reason : null,
    staleAt: status === 'stale' ? STALE_AT : null,
    supersededBySnapshotId: v < current ? snapshotIdFor(v + 1) : null,
    contentHash: hash,
    fingerprint: toFingerprint(hash),
    createdAt: v === 4 ? G2_V4_CREATED : v === 2 ? gates.g2.snapshots[0].createdAt : base.createdAt,
    content,
  };
}

const CHANGES: Record<string, string[]> = {
  '3:2': [...gates.g2.snapshots[1].changesSinceV2],
  '4:3': ['adoption assumption updated (version 2)'],
  '4:2': [...gates.g2.snapshots[1].changesSinceV2, 'adoption assumption updated (version 2)'],
};

export function g2Package(
  viewerId: string | null,
  version?: number,
  compareTo?: number,
): DecisionPackageView | null {
  const w = ws();
  if (w.g2 === 'none' || w.g2 === 'draft') return null;
  const current = w.g2Version;
  const v = version ?? current;
  if (v < 2 || v > current) return null;
  const base = decisionPackage(G2_ID, viewerId)!;
  const isDecided = decided();
  const lastSeen = compareTo ?? (viewerId === people.elena.id ? v - 1 : undefined);
  const approvals = base.approvals.map((a) => ({
    ...a,
    snapshotId: snapshotIdFor(current),
    snapshotHash: snapshotHashFor(current),
    effective: !(w.g2Invalidated || w.g2Expired),
    invalidation: w.g2Invalidated
      ? { reason: INVALIDATION_REASON, at: INVALIDATED_AT, materialChangeId: fid('decision', 90) }
      : w.g2Expired
        ? { reason: 'The approval expired unused.', at: EXPIRES_AT, materialChangeId: null }
        : null,
  }));
  return {
    ...base,
    gateRequest: g2Request()!,
    snapshot: g2Snapshot(v, current),
    approvals,
    dissent: v === 2 ? [] : base.dissent,
    panel: panelFor(
      viewerId,
      'G2',
      isDecided || w.g2 !== 'submitted',
      v < current
        ? `v${v} is superseded and cannot be approved. Open v${current}.`
        : isStale()
          ? `Approval disabled: snapshot v${v} is out of date. Refresh to create v${v + 1}.`
          : null,
    ),
    changesSinceViewerLastSaw: lastSeen ? (CHANGES[`${v}:${lastSeen}`] ?? []) : [],
    staleBanner: v === current && isStale() ? { ...STALE_BANNER } : null,
    gateHistory: history(),
  };
}

export function history(): DecisionPackageView['gateHistory'] {
  const w = ws();
  const out: DecisionPackageView['gateHistory'] = [];
  if (w.g2 === 'submitted' || w.g2 === 'withdrawn') {
    const req = g2Request()!;
    const d = state.g2Decision;
    out.push({
      gateRequestId: G2_ID,
      gateCode: 'G2',
      label: `G2 · ${req.buttonLabel}`,
      status: req.displayStatus,
      snapshotVersion: w.g2Version,
      fingerprint: toFingerprint(snapshotHashFor(w.g2Version)),
      rationale: d?.rationale ?? null,
      decidedAt: d?.at ?? null,
    });
    for (let v = w.g2Version - 1; v >= 2; v--) {
      out.push({
        gateRequestId: G2_ID,
        gateCode: 'G2',
        label: `G2 · Package v${v}`,
        status: 'superseded',
        snapshotVersion: v,
        fingerprint: toFingerprint(snapshotHashFor(v)),
        rationale: null,
        decidedAt: null,
      });
    }
  }
  const g1 = g1Request();
  if (g1 && w.g1 !== 'draft') {
    const d = w.g1Decision ?? (w.g1 === 'approved' ? gates.g1.decision : null);
    out.push({
      gateRequestId: G1_ID,
      gateCode: 'G1',
      label: `G1 · ${g1.buttonLabel}`,
      status: g1.displayStatus,
      snapshotVersion: 1,
      fingerprint: toFingerprint(G1_HASH),
      rationale: d?.rationale ?? null,
      decidedAt: d?.at ?? null,
    });
  }
  out.push({
    gateRequestId: gates.g0.id,
    gateCode: 'G0',
    label: 'G0 · Approve mandate',
    status: 'approved',
    snapshotVersion: 2,
    fingerprint: null,
    rationale: 'Scope v2 is bounded and owned.',
    decidedAt: J.mandateApproved,
  });
  return out;
}

export function snapshotFor(gate: 'G1' | 'G2'): DecisionSnapshot {
  if (gate === 'G1') return g1Package(null)!.snapshot;
  const w = ws();
  return g2Snapshot(w.g2Version, w.g2Version);
}

// ---------------------------------------------------------------------------
// Preconditions and case header for the earlier moments
// ---------------------------------------------------------------------------

export function preconditionsFor(gateCode: string): GatePreconditionsView {
  const w = ws();
  const base = preconditions(gateCode) as GatePreconditionsView;
  if (gateCode === 'G1') {
    const g1 = g1Request();
    return {
      ...base,
      status: g1 ? g1.displayStatus : w.exp === 'none' ? 'preconditions_open' : 'ready_to_submit',
      canSubmit: w.exp !== 'none' && (w.g1 === 'none' || w.g1 === 'draft'),
      preconditions: base.preconditions.map((p) =>
        p.key === 'comparable_sizing' ? { ...p, detail: 'Sizing v2 committed 13 Oct' } : p,
      ),
    };
  }
  if (gateCode === 'G2') {
    if (w.g2 === 'submitted') {
      const req = g2Request()!;
      return { ...base, status: req.displayStatus };
    }
    const pre = base.preconditions.map((p) =>
      p.key === 'validation_results' ? { ...p, met: hasResults(w) } : p,
    );
    const blockers = pre
      .filter((p) => !p.met)
      .map((p) => ({ key: p.key, message: `${p.label} · not yet`, gate: 'G2' as const }));
    return {
      ...base,
      status: blockers.length ? 'preconditions_open' : 'ready_to_submit',
      preconditions: pre,
      blockers,
      canSubmit: !blockers.length && w.g2 === 'draft',
    };
  }
  return base;
}

export function header(c: (typeof cases)[number]): CaseHeader {
  const h = caseHeader(c);
  if (c.key !== ME104.key) return h;
  const w = ws();
  const tabCounts: Record<string, string> = w.disputeResolved ? {} : { Validation: '1 disputed' };
  const g1 = g1Request();
  const g2 = g2Request();
  const rail = h.rail.map((n) => {
    if (n.gateCode === 'G1') {
      return {
        ...n,
        status: g1?.displayStatus ?? (w.exp === 'none' ? 'preconditions_open' : 'ready_to_submit'),
        caption: g1?.decidedAt ? 'Validation €15k · 16 Oct' : 'Validation €15k',
        gateRequestId: g1?.id ?? null,
      };
    }
    if (n.gateCode === 'G2') {
      if (!g2) {
        return {
          ...n,
          status: (hasResults(w) ? 'ready_to_submit' : 'not_started') as GateStatus,
          caption: 'Pilot',
          gateRequestId: null,
        };
      }
      const status: GateStatus = w.g2 === 'submitted' && isStale() ? 'blocked' : g2.displayStatus;
      return { ...n, status, gateRequestId: g2.id };
    }
    return n;
  });
  if (w.g1 !== 'approved') {
    return {
      ...h,
      case: { ...h.case, stage: 'assessment' },
      currentSegment: 'discovery_assessment',
      rail,
      tabCounts,
      nextDecision: {
        title: `G1 · ${g1?.buttonLabel ?? gates.g1.buttonLabel}`,
        subtitle:
          w.g1 === 'awaiting'
            ? 'Elena Fischer · awaiting decision'
            : 'Maya Rao prepares · Elena Fischer decides',
        decider: P('elena'),
        gateCode: 'G1',
        blocked: false,
        why: [],
        primaryAction:
          w.g1 === 'awaiting'
            ? { label: 'Open decision package', href: `/me/cases/${c.key}/decisions?gate=G1` }
            : { label: 'Open validation', href: `/me/cases/${c.key}/validation` },
      },
    };
  }
  if (w.g2 !== 'submitted') {
    return {
      ...h,
      case: { ...h.case, stage: 'validation' },
      currentSegment: 'validation',
      rail,
      tabCounts,
      nextDecision: {
        title: hasResults(w) ? 'G2 · Prepare pilot request' : 'Run validation · EXP-03',
        subtitle: hasResults(w)
          ? 'Maya Rao submits · Elena Fischer decides'
          : 'Maya Rao · window closes 20 Nov',
        decider: P('maya'),
        gateCode: hasResults(w) ? 'G2' : null,
        blocked: false,
        why: [],
        primaryAction: hasResults(w)
          ? { label: 'Prepare pilot package', href: `/me/cases/${c.key}/decisions?gate=G2` }
          : { label: 'Open validation', href: `/me/cases/${c.key}/validation?experiment=EXP-03` },
      },
    };
  }
  const nextDecision = h.nextDecision.primaryAction?.href.includes('decisions')
    ? {
        ...h.nextDecision,
        primaryAction: {
          label: h.nextDecision.primaryAction.label,
          href: `/me/cases/${c.key}/decisions?gate=G2&version=${w.g2Version}`,
        },
        why: h.nextDecision.why.map((b) =>
          b.key === 'snapshot_stale'
            ? {
                ...b,
                message: `Snapshot v${w.g2Version} is out of date. Refresh to create v${w.g2Version + 1}.`,
              }
            : b,
        ),
      }
    : h.nextDecision;
  const g2Display = g2?.displayStatus;
  return {
    ...h,
    rail:
      g2Display === 'invalidated' || g2Display === 'expired'
        ? rail.map((n) => (n.gateCode === 'G2' ? { ...n, status: g2Display } : n))
        : rail,
    tabCounts,
    nextDecision,
  };
}

export { g2Status };
