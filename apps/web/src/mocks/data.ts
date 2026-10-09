/**
 * View-model builders over fixtures/aster. Each returns the contract *input* shape for one
 * endpoint; `mock()` validates it against the contract on every response. Numbers and copy come
 * from the frozen fixture (PRD §6) and the approved prototype; nothing is invented here except
 * timestamps for synthetic audit rows, which reuse the journey moments.
 */
import {
  toFingerprint,
  type ActivityItem,
  type ApprovalPanelState,
  type CaseHeader,
  type CaseListRow,
  type CaseStage,
  type Condition,
  type DecisionPackageView,
  type DecisionSnapshot,
  type DevPersona,
  type DirectoryPerson,
  type GateRailNode,
  type GateRequest,
  type GateStatus,
  type Mandate,
  type Opportunity,
  type PersonRef,
  type RailSegment,
  type ReviewRequest,
  type RoleCode,
  type ScopeOptions,
  type SearchHit,
  type Viewer,
  type WorkItem,
} from '@growth-os/contracts';
import {
  assumptions,
  authorityGrants,
  businessUnits,
  cases,
  connections,
  connectorMappings,
  devPersonaOrder,
  exp03,
  expectedSizing,
  fid,
  gates,
  journeyMoments as J,
  mandate,
  opportunities,
  people,
  pilotTasks,
  products,
  roleAssignments,
  segments,
  sizingV2Input,
  sources,
  tenant,
} from '@growth-os/fixtures-aster';
import { state } from './state';

// ---------------------------------------------------------------------------
// People and identity
// ---------------------------------------------------------------------------

type PersonKey = keyof typeof people;
const ALL = Object.values(people);
const byId = new Map<string, (typeof ALL)[number]>(ALL.map((p) => [p.id, p]));

export function personRef(id: string): PersonRef {
  const p = byId.get(id);
  if (!p) throw new Error(`unknown person ${id}`);
  return { id: p.id, displayName: p.displayName, title: p.title, initials: p.initials };
}
export const P = (k: PersonKey) => personRef(people[k].id);
export const HUMANS: PersonRef[] = ALL.filter((p) => p.kind === 'human').map((p) => personRef(p.id));

const ADMIN_ID = people.admin.id;
const GRANTED_AT = '2026-01-05T09:00:00+01:00';
const BU = businessUnits[0].id;

/** Deterministic ids for synthetic rows the fixture does not carry (activity, work items). */
export function mockId(n: number): string {
  return `a57eff00-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** Hash whose fingerprint is the prototype's illustrative one ("7F3A·19C2"). */
export function hashFor(fingerprint: string, salt = 0): string {
  const head = fingerprint.replace('·', '').toLowerCase();
  return (head + (salt.toString(16) + '0'.repeat(64)).slice(0, 56)).slice(0, 64);
}

export function viewerFor(userId: string): Viewer {
  const p = byId.get(userId)!;
  const roles = roleAssignments
    .filter((r) => r.userId === userId)
    .map((r) => ({
      id: r.id,
      userId: r.userId,
      role: r.role,
      businessUnitId: r.businessUnitId,
      caseId: null,
      grantedBy: ADMIN_ID,
      grantedAt: GRANTED_AT,
      revokedAt: null,
    }));
  return {
    user: {
      id: p.id,
      email: p.email,
      displayName: p.displayName,
      title: p.title,
      kind: p.kind,
      isActive: true,
    },
    person: personRef(p.id),
    tenant: { ...tenant },
    roles,
    authority: authorityGrants
      .filter((a) => a.userId === userId)
      .map((a) => ({ ...a, validTo: null, grantedBy: ADMIN_ID, revokedAt: null })),
    landing: p.landing,
    isAdmin: roles.some((r) => r.role === 'tenant_admin'),
  };
}

export function devPersonas(): { tenantName: string; personas: DevPersona[] } {
  const keys: PersonKey[] = [...devPersonaOrder, 'admin'];
  return {
    tenantName: tenant.name,
    personas: keys.map((k) => ({
      userId: people[k].id,
      person: P(k),
      roleSummary: people[k].title,
      landing: people[k].landing,
    })),
  };
}

// ---------------------------------------------------------------------------
// Gates for ME-104 at the aster-demo moment
// ---------------------------------------------------------------------------

const ME104 = cases[0];
const G2_SNAPSHOT_ID = fid('snapshot', 3);
const G2_V2_SNAPSHOT_ID = fid('snapshot', 2);
const G1_SNAPSHOT_ID = fid('snapshot', 11);
export const G2_FINGERPRINT = gates.g2.prototypeFingerprint;
export const G2_HASH = hashFor(G2_FINGERPRINT);
const G1_HASH = hashFor(gates.g1.prototypeFingerprint);

export function g2Status(): GateStatus {
  const d = state.g2Decision;
  if (!d) return 'awaiting_decision';
  return (
    {
      approve: 'approved',
      approve_with_conditions: 'approved_with_conditions',
      return_for_revision: 'returned_for_revision',
      not_approved: 'not_approved',
      abstain: 'awaiting_decision',
      delegate: 'awaiting_decision',
    } as const
  )[d.disposition];
}

function me104Stage(): CaseStage {
  const s = g2Status();
  return s === 'approved' || s === 'approved_with_conditions' ? 'pilot_approved' : 'pilot_approval_pending';
}

function me104Rail(): GateRailNode[] {
  const s = g2Status();
  return [
    {
      gateCode: 'G0',
      status: 'approved',
      caption: 'Mandate · 5 Oct',
      preconditionsMet: 5,
      preconditionsTotal: 5,
      gateRequestId: gates.g0.id,
    },
    {
      gateCode: 'G1',
      status: 'approved',
      caption: 'Validation €15k · 16 Oct',
      preconditionsMet: 4,
      preconditionsTotal: 4,
      gateRequestId: gates.g1.id,
    },
    {
      gateCode: 'G2',
      status: state.scenario.g2Stale && !state.g2Decision ? 'blocked' : s,
      caption: state.g2Decision ? 'Pilot €120k · 90 days · 27 Nov' : 'Pilot €120k · 90 days · due 27 Nov',
      preconditionsMet: 5,
      preconditionsTotal: 5,
      gateRequestId: gates.g2.id,
    },
    {
      gateCode: 'G3',
      status: 'not_started',
      caption: 'Scale',
      preconditionsMet: 0,
      preconditionsTotal: 4,
      gateRequestId: null,
    },
  ];
}

const g2Scope = () => ({
  amount: gates.g2.amount,
  currency: gates.g2.currency,
  durationDays: gates.g2.durationDays,
  windowStart: gates.g2.windowStart,
  windowEnd: gates.g2.windowEnd,
  countryCodes: ['DE'],
  segmentLabel: 'Food processing',
  maxSites: gates.g2.maxSites,
  milestones: ['M1 · Kick-off', 'M2 · Run and measure', 'M3 · Review'],
  ownerId: gates.g2.pilotOwnerId,
  authorizes: [...gates.g2.authorizes],
  doesNotAuthorize: [...gates.g2.doesNotAuthorize],
});

function g2Conditions(): Condition[] {
  const proposed = gates.g2.conditions.map((c, i) => ({
    id: fid('condition', i + 1),
    key: c.key,
    text: c.text,
    owner: personRef(c.ownerId),
    dueOn: c.dueOn,
    dueRule: c.dueRule,
    flag: c.blocksExecution ? ('blocks_execution' as const) : ('monitor_only' as const),
    status: 'open' as const,
    addedBy: P('maya'),
    metEvidence: null,
    metAt: null,
  }));
  const added = (state.g2Decision?.conditions ?? []).map((c, i) => ({
    id: fid('condition', 10 + i),
    key: `C${proposed.length + i + 1}`,
    text: c.text,
    owner: personRef(c.ownerId),
    dueOn: c.dueOn,
    dueRule: c.dueRule,
    flag: c.flag,
    status: 'open' as const,
    addedBy: P('elena'),
    metEvidence: null,
    metAt: null,
  }));
  return [...proposed, ...added];
}

export function g2Request(): GateRequest {
  const s = g2Status();
  const decided = state.g2Decision && s !== 'awaiting_decision';
  return {
    id: gates.g2.id,
    key: gates.g2.key,
    caseId: ME104.id,
    mandateId: mandate.id,
    gateCode: 'G2',
    status:
      s === 'approved'
        ? 'approved'
        : s === 'approved_with_conditions'
          ? 'approved_with_conditions'
          : s === 'returned_for_revision'
            ? 'returned_for_revision'
            : s === 'not_approved'
              ? 'not_approved'
              : state.scenario.g2Stale
                ? 'stale'
                : 'awaiting_decision',
    displayStatus: state.scenario.g2Stale && !decided ? 'blocked' : s,
    scope: g2Scope(),
    buttonLabel: gates.g2.buttonLabel,
    parentGateRequestId: null,
    submittedBy: P('maya'),
    submittedAt: J.g2Submitted,
    decidedAt: decided ? state.g2Decision!.at : null,
    expiresAt: gates.g2.expiresAt,
    currentSnapshotId: G2_SNAPSHOT_ID,
    conditions: g2Conditions(),
    rowVersion: decided ? 4 : 3,
  };
}

function g1Request(): GateRequest {
  return {
    id: gates.g1.id,
    key: gates.g1.key,
    caseId: ME104.id,
    mandateId: mandate.id,
    gateCode: 'G1',
    status: 'approved',
    displayStatus: 'approved',
    scope: {
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
    },
    buttonLabel: gates.g1.buttonLabel,
    parentGateRequestId: null,
    submittedBy: P('maya'),
    submittedAt: gates.g1.submittedAt,
    decidedAt: gates.g1.decision.at,
    expiresAt: null,
    currentSnapshotId: G1_SNAPSHOT_ID,
    conditions: [],
    rowVersion: 2,
  };
}

function g0Request(): GateRequest {
  return {
    id: gates.g0.id,
    key: gates.g0.key,
    caseId: null,
    mandateId: mandate.id,
    gateCode: 'G0',
    status: 'approved',
    displayStatus: 'approved',
    scope: {
      amount: null,
      currency: null,
      durationDays: null,
      windowStart: null,
      windowEnd: null,
      countryCodes: ['DE'],
      segmentLabel: 'Food processing',
      maxSites: null,
      milestones: [],
      ownerId: people.maya.id,
      authorizes: [...gates.g0.authorizes],
      doesNotAuthorize: [...gates.g0.doesNotAuthorize],
    },
    buttonLabel: gates.g0.buttonLabel,
    parentGateRequestId: null,
    submittedBy: P('maya'),
    submittedAt: mandate.versions[1].submittedAt,
    decidedAt: J.mandateApproved,
    expiresAt: null,
    currentSnapshotId: fid('snapshot', 21),
    conditions: [],
    rowVersion: 3,
  };
}

export function gateRequestById(id: string): GateRequest | null {
  if (id === gates.g2.id) return g2Request();
  if (id === gates.g1.id) return g1Request();
  if (id === gates.g0.id) return g0Request();
  return null;
}

function g2Snapshot(): DecisionSnapshot {
  const stale = state.scenario.g2Stale && !state.g2Decision;
  return {
    id: G2_SNAPSHOT_ID,
    gateRequestId: gates.g2.id,
    caseId: ME104.id,
    version: 3,
    status: stale ? 'stale' : 'current',
    staleReason: stale ? gates.g2.staleVariant.reason : null,
    staleAt: stale ? gates.g2.staleVariant.changedAt : null,
    supersededBySnapshotId: null,
    contentHash: G2_HASH,
    fingerprint: toFingerprint(G2_HASH),
    createdBy: P('maya'),
    createdAt: J.g2Submitted,
    content: {
      schemaVersion: 1,
      caseId: ME104.id,
      caseKey: ME104.key,
      gateCode: 'G2',
      ask: gates.g2.ask,
      scope: g2Scope(),
      recommendation: gates.g2.recommendation,
      alternatives: gates.g2.alternatives.map((a) => ({ ...a })),
      evidenceSummary: sources
        .filter((s) => ['SRC-014', 'SRC-021', 'SRC-040'].includes(s.key))
        .map((s) => ({ sourceId: s.id, label: s.chipLabel })),
      assumptions: assumptions.slice(0, 4).map((a) => ({
        assumptionId: a.id,
        versionId: fid('assumptionVersion', Number(a.key.slice(4))),
        name: a.name,
        valueText: a.value ?? 'Unknown',
        disputed: a.disputed,
      })),
      validationResults: [
        {
          experimentId: exp03.id,
          resultVersionId: fid('experiment', 103),
          summary: 'Met · 9 interviews (threshold 8) · Met · 4 paid commitments (threshold 4)',
          limitations: exp03.result.limitations,
        },
      ],
      economics: {
        economicsVersionId: fid('economicsVersion', 2),
        inputHash: hashFor('E2C0·0002'),
        tableText: [
          ['Steady state · end of year 3 · EUR 2026', 'Downside', 'Base', 'Upside'],
          ['Customers', '50', '100', '120 · capped'],
          ['Annual revenue', '€1.0m', '€2.0m', '€2.4m'],
          ['Gross contribution · 60%', '€0.60m', '€1.20m', '€1.44m'],
          ['After incremental opex €600k', '€0k (break-even)', '€600k', '€840k'],
        ],
        note: '€400k one-time scale-entry investment is separate and not requested here. Payback and cash flow: not available — needs ramp, retention and cash-timing inputs.',
      },
      sizing: {
        sizingVersionId: fid('sizingVersion', 2),
        inputHash: hashFor('5120·0002'),
        summary:
          'TAM €100m/year · SAM €40m/year · Reachable pool 500 sites · SOM Base €2.0m annual revenue (end of year 3)',
      },
      signOffs: gates.g2.positions.map((p) => ({
        reviewer: personRef(p.reviewerId),
        area: p.area,
        position: p.position,
        scopeText: p.scopeText,
        signedVersion: 3,
        signedAt: J.specialistSigned,
      })),
      budgetAndStopRules: [...gates.g2.stopRules],
      conditionsProposed: gates.g2.conditions.map((c) => ({
        text: c.text,
        ownerId: c.ownerId,
        dueOn: c.dueOn,
        dueRule: c.dueRule,
        flag: c.blocksExecution ? ('blocks_execution' as const) : ('monitor_only' as const),
      })),
      dissent: [
        {
          author: P('daniel'),
          authorRole: 'Finance partner',
          statement: gates.g2.dissent.statement,
          scopeText: gates.g2.dissent.scopeText,
          signedAt: gates.g2.dissent.signedAt,
          signedSnapshotVersion: 3,
        },
      ],
      knownLimitations: [...gates.g2.knownLimitations],
      blockers: [],
      outcomeTargets: [
        {
          metricKey: 'paid_use_continuation',
          name: 'Paid use and continuation',
          thresholdText: '4 of 4 pilot customers',
          window: '1 Dec 2026 – 28 Feb 2027',
        },
        {
          metricKey: 'deployment_effort',
          name: 'Deployment effort per site',
          thresholdText: 'Within [hours per site] assumed',
          window: 'weekly log',
        },
      ],
      components: [
        { type: 'sizing_version', id: fid('sizingVersion', 2), version: 2 },
        { type: 'economics_version', id: fid('economicsVersion', 2), version: 2 },
        { type: 'experiment_result_version', id: fid('experiment', 103), version: 1 },
      ],
    },
  };
}

function g1Snapshot(): DecisionSnapshot {
  const s = g2Snapshot();
  return {
    ...s,
    id: G1_SNAPSHOT_ID,
    gateRequestId: gates.g1.id,
    version: 1,
    status: 'current',
    staleReason: null,
    staleAt: null,
    contentHash: G1_HASH,
    fingerprint: toFingerprint(G1_HASH),
    createdAt: gates.g1.submittedAt,
    content: {
      ...s.content,
      gateCode: 'G1',
      ask: 'Approve validation outreach to 20 sites with a budget of up to €15k. This is not a pilot.',
      scope: g1Request().scope,
      recommendation: 'Approve validation. The outcome changes the G2 decision.',
      validationResults: [],
      economics: null,
      dissent: [],
      signOffs: [],
      conditionsProposed: [],
      budgetAndStopRules: ['Approved budget ceiling €15k.'],
    },
  };
}

function panelFor(viewerId: string | null, gateCode: 'G1' | 'G2', decided: boolean): ApprovalPanelState {
  const isElena = viewerId === people.elena.id;
  const chain = [
    {
      approver: P('elena'),
      routingReason:
        gateCode === 'G2'
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
      viewerAuthorityText: isElena ? 'Up to €[limit] · BU Water · pilots and validation' : null,
    };
  }
  if (isElena) {
    return {
      ...base,
      canDecide: !state.scenario.g2Stale,
      allowedDispositions: [
        'approve',
        'approve_with_conditions',
        'return_for_revision',
        'not_approved',
        'abstain',
      ],
      cannotDecideReason: state.scenario.g2Stale
        ? 'Approval disabled: snapshot v3 is out of date. Refresh to create v4.'
        : null,
      viewerAuthorityText: 'Up to €[limit] · BU Water · pilots and validation',
    };
  }
  const reason =
    viewerId === people.maya.id
      ? 'You authored this package and cannot approve it.'
      : viewerId === people.admin.id
        ? 'Administrators configure policy and never approve gates.'
        : `Only Elena Fischer can decide ${gateCode} v3.`;
  return {
    ...base,
    canDecide: false,
    allowedDispositions: [],
    cannotDecideReason: reason,
    viewerAuthorityText: null,
  };
}

export function decisionPackage(gateRequestId: string, viewerId: string | null): DecisionPackageView | null {
  const history = gateHistory();
  if (gateRequestId === gates.g1.id) {
    return {
      gateRequest: g1Request(),
      snapshot: g1Snapshot(),
      approvals: [
        {
          id: fid('decision', 1),
          gateRequestId: gates.g1.id,
          snapshotId: G1_SNAPSHOT_ID,
          snapshotHash: G1_HASH,
          approver: P('elena'),
          approverRole: 'sponsor',
          authorityGrantId: authorityGrants[1].id,
          disposition: 'approve',
          rationale: gates.g1.decision.rationale,
          note: null,
          delegatedTo: null,
          decidedAt: gates.g1.decision.at,
          effective: true,
          invalidation: null,
        },
      ],
      dissent: [],
      positions: [],
      panel: panelFor(viewerId, 'G1', true),
      changesSinceViewerLastSaw: [],
      staleBanner: null,
      gateHistory: history,
    };
  }
  if (gateRequestId !== gates.g2.id) return null;
  const d = state.g2Decision;
  const decided = !!d && d.disposition !== 'abstain';
  const stale = state.scenario.g2Stale && !d;
  return {
    gateRequest: g2Request(),
    snapshot: g2Snapshot(),
    approvals: d
      ? [
          {
            id: fid('decision', 3),
            gateRequestId: gates.g2.id,
            snapshotId: G2_SNAPSHOT_ID,
            snapshotHash: G2_HASH,
            approver: personRef(d.by),
            approverRole: 'sponsor',
            authorityGrantId: authorityGrants[2].id,
            disposition: d.disposition,
            rationale: d.rationale,
            note: d.note,
            delegatedTo: null,
            decidedAt: d.at,
            effective: true,
            invalidation: null,
          },
        ]
      : [],
    dissent: [
      {
        id: fid('challenge', 50),
        author: P('daniel'),
        authorRole: 'Finance partner',
        statement: gates.g2.dissent.statement,
        scopeText: gates.g2.dissent.scopeText,
        signedAt: gates.g2.dissent.signedAt,
        signedSnapshotVersion: 3,
      },
    ],
    positions: gates.g2.positions.map((p, i) => ({
      id: fid('reviewRequest', 60 + i),
      reviewer: personRef(p.reviewerId),
      area: p.area,
      position: p.position,
      scopeText: p.scopeText,
      signedVersion: 3,
      signedAt: J.specialistSigned,
    })),
    panel: panelFor(viewerId, 'G2', decided),
    changesSinceViewerLastSaw: viewerId === people.elena.id ? [...gates.g2.snapshots[1].changesSinceV2] : [],
    staleBanner: stale
      ? {
          title:
            'This snapshot is out of date: the adoption assumption changed on 26 Nov. Approval is disabled.',
          body: 'Maya Rao edited Base adoption in Economics after Daniel Weber’s review; v3 still shows the earlier value. You can never approve something different from what you read.',
        }
      : null,
    gateHistory: history,
  };
}

function gateHistory(): DecisionPackageView['gateHistory'] {
  return [
    {
      gateRequestId: gates.g2.id,
      gateCode: 'G2',
      label: `G2 · ${gates.g2.buttonLabel}`,
      status: g2Status(),
      snapshotVersion: 3,
      fingerprint: toFingerprint(G2_HASH),
      rationale: state.g2Decision?.rationale ?? null,
      decidedAt: state.g2Decision?.at ?? null,
    },
    {
      gateRequestId: gates.g2.id,
      gateCode: 'G2',
      label: 'G2 · Package v2',
      status: 'superseded',
      snapshotVersion: 2,
      fingerprint: toFingerprint(hashFor('2C55·A10E')),
      rationale: null,
      decidedAt: null,
    },
    {
      gateRequestId: gates.g1.id,
      gateCode: 'G1',
      label: `G1 · ${gates.g1.buttonLabel}`,
      status: 'approved',
      snapshotVersion: 1,
      fingerprint: toFingerprint(G1_HASH),
      rationale: gates.g1.decision.rationale,
      decidedAt: gates.g1.decision.at,
    },
    {
      gateRequestId: gates.g0.id,
      gateCode: 'G0',
      label: 'G0 · Approve mandate',
      status: 'approved',
      snapshotVersion: 2,
      fingerprint: null,
      rationale: 'Scope v2 is bounded and owned.',
      decidedAt: J.mandateApproved,
    },
  ];
}
export { G2_SNAPSHOT_ID, G2_V2_SNAPSHOT_ID };

export function preconditions(gateCode: string) {
  if (gateCode === 'G3') {
    return {
      gateCode: 'G3' as const,
      status: 'blocked' as const,
      preconditions: [
        {
          key: 'pilot_actuals_vs_thresholds',
          label: 'Pilot actuals against thresholds',
          met: false,
          detail: gates.g3.blockedBy[0].message,
          href: `/me/cases/${ME104.key}/outcomes`,
        },
        {
          key: 'readiness_reassessment',
          label: 'Specialist scale-readiness review',
          met: false,
          detail: gates.g3.blockedBy[1].message,
          href: `/me/cases/${ME104.key}/feasibility`,
        },
        {
          key: 'updated_economics_and_capacity',
          label: 'Updated economics and capacity',
          met: false,
          detail: null,
          href: null,
        },
        {
          key: 'approved_scale_budget',
          label: 'Approved scale budget',
          met: false,
          detail: null,
          href: null,
        },
      ],
      blockers: gates.g3.blockedBy.map((b) => ({ key: b.key, message: b.message, gate: 'G3' as const })),
      canSubmit: false,
    };
  }
  const labels: Record<string, string> = {
    validation_results: 'Validation results recorded',
    finance_review: 'Finance review signed',
    specialist_sign_off: 'Specialist sign-off',
    budget_and_stop_rules: 'Budget and stop rules',
    accountable_pilot_owner: 'Accountable pilot owner',
    evidence_inventory: 'Evidence inventory',
    comparable_sizing: 'Comparable sizing committed',
    material_unknowns_listed: 'Material unknowns listed',
    feasibility_blockers_listed: 'Feasibility blockers listed',
  };
  const keys =
    gateCode === 'G1'
      ? ['evidence_inventory', 'comparable_sizing', 'material_unknowns_listed', 'feasibility_blockers_listed']
      : [
          'validation_results',
          'finance_review',
          'specialist_sign_off',
          'budget_and_stop_rules',
          'accountable_pilot_owner',
        ];
  return {
    gateCode: (gateCode === 'G1' ? 'G1' : 'G2') as 'G1' | 'G2',
    status: (gateCode === 'G1' ? 'approved' : g2Status()) as GateStatus,
    preconditions: keys.map((k) => ({ key: k, label: labels[k]!, met: true, detail: null, href: null })),
    blockers: [],
    canSubmit: false,
  };
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

type CaseFx = (typeof cases)[number];

function caseStage(c: CaseFx): CaseStage {
  return c.key === 'ME-104' ? me104Stage() : (c as { stage: CaseStage }).stage;
}

function workflowCase(c: CaseFx) {
  return {
    id: c.id,
    key: c.key,
    appType: 'market_expansion' as const,
    title: c.title,
    businessUnitId: BU,
    mandateId: mandate.id,
    owner: personRef(c.ownerId),
    sponsor: personRef(c.sponsorId),
    stage: caseStage(c),
    heldFromStage: null,
    originType: c.key === 'ME-104' ? ('opportunity' as const) : ('direct' as const),
    originId: c.key === 'ME-104' ? opportunities[0].id : null,
    rowVersion: c.key === 'ME-104' ? 12 : 3,
    createdAt: J.opportunitiesDetected,
    updatedAt: J.g2Submitted,
  };
}

function railFor(c: CaseFx): { segment: RailSegment; rail: GateRailNode[] } {
  if (c.key === 'ME-104') return { segment: 'pilot_review', rail: me104Rail() };
  const g0: GateRailNode = {
    gateCode: 'G0',
    status: 'approved',
    caption: 'Mandate · 5 Oct',
    preconditionsMet: 5,
    preconditionsTotal: 5,
    gateRequestId: gates.g0.id,
  };
  const rest = (s1: GateStatus): GateRailNode[] => [
    g0,
    {
      gateCode: 'G1',
      status: s1,
      caption: 'Validation',
      preconditionsMet: s1 === 'preconditions_open' ? 2 : null,
      preconditionsTotal: s1 === 'preconditions_open' ? 4 : null,
      gateRequestId: null,
    },
    {
      gateCode: 'G2',
      status: 'not_started',
      caption: 'Pilot',
      preconditionsMet: null,
      preconditionsTotal: null,
      gateRequestId: null,
    },
    {
      gateCode: 'G3',
      status: 'not_started',
      caption: 'Scale',
      preconditionsMet: null,
      preconditionsTotal: null,
      gateRequestId: null,
    },
  ];
  const stage = caseStage(c);
  return {
    segment: 'discovery_assessment',
    rail: rest(stage === 'assessment' ? 'preconditions_open' : 'not_started'),
  };
}

export function findCase(ref: string): CaseFx | null {
  return cases.find((c) => c.key === ref || c.id === ref) ?? null;
}

export function caseHeader(c: CaseFx): CaseHeader {
  const { segment, rail } = railFor(c);
  const decided = c.key === 'ME-104' && !!state.g2Decision;
  const approved = c.key === 'ME-104' && me104Stage() === 'pilot_approved';
  const nextDecision =
    c.key !== 'ME-104'
      ? {
          title: 'G1 · Approve validation',
          subtitle: 'Elena Fischer · not yet requested',
          decider: P('elena'),
          gateCode: 'G1' as const,
          blocked: true,
          why: [
            { key: 'comparable_sizing', message: 'Comparable sizing not committed', gate: 'G1' as const },
          ],
          primaryAction: null,
        }
      : approved
        ? {
            title: 'Activate pilot plan',
            subtitle: 'Jonas Klein · from 1 Dec · task creation is separate',
            decider: P('jonas'),
            gateCode: null,
            blocked: false,
            why: [],
            primaryAction: { label: 'Open pilot', href: `/me/cases/${c.key}/pilot` },
          }
        : decided
          ? {
              title: 'G2 · Revise and resubmit',
              subtitle: 'Maya Rao · returned with comments',
              decider: P('maya'),
              gateCode: 'G2' as const,
              blocked: false,
              why: [],
              primaryAction: {
                label: 'Open decision package',
                href: `/me/cases/${c.key}/decisions?gate=G2&version=3`,
              },
            }
          : {
              title: `G2 · ${gates.g2.buttonLabel}`,
              subtitle: 'Elena Fischer · due today, 27 Nov',
              decider: P('elena'),
              gateCode: 'G2' as const,
              blocked: state.scenario.g2Stale,
              why: state.scenario.g2Stale
                ? [
                    {
                      key: 'snapshot_stale',
                      message: 'Snapshot v3 is out of date. Refresh to create v4.',
                      gate: 'G2' as const,
                    },
                  ]
                : [],
              primaryAction: {
                label: 'Open decision package',
                href: `/me/cases/${c.key}/decisions?gate=G2&version=3`,
              },
            };
  return {
    case: workflowCase(c),
    mandateLabel: mandate.mandateLabel,
    marketLabel: c.marketLabel,
    currencyLabel: 'EUR · 2026 prices',
    currentSegment: segment,
    rail,
    nextDecision,
    freshness: {
      lastCheckedAt: '2026-11-24T09:00:00+01:00',
      label:
        c.key === 'ME-104'
          ? 'Evidence checked 2 days ago · current'
          : 'Evidence checked 2 days ago · 1 source ageing',
      worst: c.key === 'ME-104' ? 'current' : 'ageing',
      staleCount: 0,
      ageingCount: c.key === 'ME-104' ? 0 : 1,
    },
    tabCounts: c.key === 'ME-104' ? { Validation: '1 disputed' } : {},
    illustrative: true,
  };
}

export function caseListRows(): CaseListRow[] {
  return cases.map((c) => {
    const { rail } = railFor(c);
    const next =
      rail.find((n) => !['approved', 'approved_with_conditions', 'superseded'].includes(n.status)) ?? null;
    return {
      id: c.id,
      key: c.key,
      title: c.title,
      marketLabel: c.marketLabel,
      owner: personRef(c.ownerId),
      stage: caseStage(c),
      nextGate: caseStage(c) === 'stopped' ? null : next,
      blockersLabel: c.key === 'ME-104' ? '1 dissent recorded' : caseStage(c) === 'stopped' ? '—' : 'None',
      freshness: c.key === 'ME-104' ? 'current' : 'ageing',
      freshnessDetail: c.key === 'ME-104' ? 'Checked 2 days ago' : '1 source ageing',
      latestUpdate:
        c.key === 'ME-104'
          ? 'G2 package v3 submitted by Maya Rao'
          : caseStage(c) === 'stopped'
            ? 'Stopped · outside channel coverage'
            : 'Sizing draft updated',
      latestUpdateAt: c.key === 'ME-104' ? J.g2Submitted : J.compared,
    };
  });
}

export function activity(): ActivityItem[] {
  const items: ActivityItem[] = [
    {
      id: mockId(1),
      at: J.g2Submitted,
      actor: P('maya'),
      title: 'Submitted G2 package v3',
      detail: `Snapshot v3 · ${toFingerprint(G2_HASH)}`,
      keyDecision: false,
      href: `/me/cases/ME-104/decisions?gate=G2&version=3`,
    },
    {
      id: mockId(2),
      at: J.specialistSigned,
      actor: P('lena'),
      title: 'Signed specialist review for pilot only: up to 4 sites, 90 days',
      detail: 'Feasibility · specialist review',
      keyDecision: false,
      href: '/me/cases/ME-104/feasibility',
    },
    {
      id: mockId(3),
      at: J.validationResults,
      actor: P('maya'),
      title: 'Recorded EXP-03 results: Met · 9 of 8, Met · 4 of 4',
      detail: 'Experiment result v1',
      keyDecision: false,
      href: '/me/cases/ME-104/validation?experiment=EXP-03',
    },
    {
      id: mockId(4),
      at: exp03.amendment1.at,
      actor: P('maya'),
      title: 'Amended the validation window',
      detail: 'Amendment 1 · original kept',
      keyDecision: false,
      href: '/me/cases/ME-104/validation?experiment=EXP-03&amendment=1',
    },
    {
      id: mockId(5),
      at: J.g1Approved,
      actor: P('elena'),
      title: 'Approved validation €15k (G1)',
      detail: `Snapshot v1 · ${toFingerprint(G1_HASH)}`,
      keyDecision: true,
      href: '/me/cases/ME-104/decisions?gate=G1&version=1',
    },
    {
      id: mockId(6),
      at: J.adoptionDisputed,
      actor: P('daniel'),
      title: 'Disputed 20% adoption',
      detail: 'Economics v2',
      keyDecision: false,
      href: '/me/cases/ME-104/validation?assumption=ASM-01',
    },
    {
      id: mockId(7),
      at: J.sizingCommitted,
      actor: P('maya'),
      title: 'Committed sizing v2',
      detail: 'SAM €40m/year',
      keyDecision: false,
      href: '/me/cases/ME-104/sizing?version=2',
    },
    {
      id: mockId(8),
      at: J.mandateApproved,
      actor: P('elena'),
      title: 'Approved mandate MD-21 (G0)',
      detail: 'Scope v2',
      keyDecision: true,
      href: '/me/mandates/MD-21',
    },
  ];
  const d = state.g2Decision;
  if (d) {
    items.unshift({
      id: mockId(20),
      at: d.at,
      actor: personRef(d.by),
      title:
        d.disposition === 'approve' || d.disposition === 'approve_with_conditions'
          ? `Approved pilot €120k · 90 days (G2)${d.conditions.length ? ` with ${d.conditions.length + 2} conditions` : ''}`
          : d.disposition === 'return_for_revision'
            ? 'Returned G2 package v3 for revision'
            : d.disposition === 'not_approved'
              ? 'Recorded G2 as not approved'
              : 'Abstained on G2',
      detail: `Snapshot v3 · ${toFingerprint(G2_HASH)}`,
      keyDecision: d.disposition !== 'abstain',
      href: '/me/cases/ME-104/decisions?gate=G2&version=3',
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Inbox, my work, overview
// ---------------------------------------------------------------------------

export function gateDecisionsFor(viewerId: string | null) {
  if (viewerId !== people.elena.id || state.g2Decision) return [];
  return [
    {
      gateRequestId: gates.g2.id,
      caseKey: ME104.key,
      buttonLabel: gates.g2.buttonLabel,
      snapshotVersion: 3,
      dueText: 'Due today, 27 Nov',
      href: `/me/cases/${ME104.key}/decisions?gate=G2&version=3`,
    },
  ];
}

export function reviewRequests(viewerId: string | null): ReviewRequest[] {
  const all: ReviewRequest[] = [
    {
      id: fid('reviewRequest', 1),
      caseId: ME104.id,
      caseKey: ME104.key,
      area: 'finance',
      targetType: 'economics_version',
      targetId: fid('economicsVersion', 2),
      question: 'Economics review · margin definition and opex scope',
      whatToCheck: [
        'Margin definition: 60% gross, delivery/COGS deducted',
        'Opex scope: €600k/year incremental sales and admin',
        'Currency EUR · 2026 prices',
      ],
      requestedBy: P('maya'),
      reviewer: P('daniel'),
      dueOn: '2026-10-22',
      status: 'open',
      response: null,
      responseReason: null,
      respondedAt: null,
    },
    {
      id: fid('reviewRequest', 2),
      caseId: ME104.id,
      caseKey: ME104.key,
      area: 'product',
      targetType: 'feasibility_review',
      targetId: fid('feasibility', 1),
      question: 'Does the product fit the target workflow?',
      whatToCheck: ['Workflow comparison memo v1', 'Demo notes 21 Oct'],
      requestedBy: P('maya'),
      reviewer: P('priya'),
      dueOn: '2026-10-21',
      status: 'open',
      response: null,
      responseReason: null,
      respondedAt: null,
    },
  ];
  return all.filter((r) => r.reviewer.id === viewerId);
}

export function workItems(viewerId: string | null): WorkItem[] {
  const tasks = pilotTasks.filter((t) => t.ownerId === viewerId);
  return tasks.map((t, i) => ({
    id: mockId(100 + i),
    kind: 'task' as const,
    title: t.title,
    caseId: ME104.id,
    caseKey: ME104.key,
    subtitle: `${ME104.key} · ${['M1 Kick-off', 'M2 Run and measure', 'M3 Review'][t.milestone - 1]} · ${t.function[0]!.toUpperCase()}${t.function.slice(1)}`,
    dueText: t.dueRule ?? t.dueOn,
    statusText: 'Not started',
    href: `/my-work?item=${t.externalKey}`,
    brief: {
      gateText: 'Approved at G2 · pilot €120k · 90 days',
      syncText: 'Not sent',
      why: 'The pilot tests deployment effort and paid use at 4 sites.',
      doneLooksLike: t.deliverable,
      stayInside: ['Up to 4 sites', 'No prospect outreach beyond the committed sites'],
      measuredAgainst: 'Day-90 review against pre-registered thresholds',
    },
  }));
}

export function overview(viewerId: string | null) {
  const rows = caseListRows();
  const byStage = new Map<CaseStage, number>();
  rows.forEach((r) => byStage.set(r.stage, (byStage.get(r.stage) ?? 0) + 1));
  return {
    scope: { label: 'Showing BU Water · cases you can access · hidden cases are not counted', partial: true },
    businessUnits: businessUnits.map((b) => ({ id: b.id, name: b.name, accessible: b.key === 'water' })),
    casesByStage: [...byStage.entries()].map(([stage, count]) => ({ stage, count })),
    decisionsAwaitingViewer: gateDecisionsFor(viewerId),
    spend: {
      rows: [
        {
          caseKey: 'ME-104',
          gateLabel: 'G1 · Validation',
          statusText: 'Approved · 16 Oct',
          amount: {
            amount: '15000.00',
            currency: 'EUR',
            measure: 'approved_budget' as const,
            timeBasis: 'budget' as const,
          },
        },
        {
          caseKey: 'ME-104',
          gateLabel: 'G2 · Pilot · 90 days',
          statusText:
            me104Stage() === 'pilot_approved' ? 'Approved · 27 Nov' : 'Requested · awaiting decision',
          amount: {
            amount: '120000.00',
            currency: 'EUR',
            measure:
              me104Stage() === 'pilot_approved'
                ? ('approved_budget' as const)
                : ('requested_budget' as const),
            timeBasis: 'budget' as const,
          },
        },
      ],
      spentToDate: {
        unavailable: true as const,
        reason: 'finance source unavailable',
        missingInputs: ['finance export'],
      },
      note: 'Approved and requested budgets are one-time gate budgets. They are not added to market sizes.',
    },
    overdueValidation: [],
    pilotsNeedingReview: [],
    pilotsNeedingReviewNote: 'No pilot is running yet.',
    cases: rows,
    casesNote:
      'Market sizes are not totalled across cases. Each case has its own market boundary, unit and year.' as const,
    keyEvents: activity().filter((a) => a.keyDecision),
    dataSources: connections.map((c) => ({
      key: c.kind,
      name: c.name,
      available: c.status === 'connected',
      lastRefreshedAt: c.lastSuccessAt,
      message:
        c.status === 'connected'
          ? null
          : c.status === 'expired'
            ? 'Connection expired · ask an administrator'
            : c.status === 'missing_permission'
              ? 'Missing permission'
              : 'Unavailable',
    })),
    refreshedAt: '2026-11-26T09:00:00+01:00',
  };
}

// ---------------------------------------------------------------------------
// Mandate and opportunities
// ---------------------------------------------------------------------------

export function mandateView(): Mandate {
  const v2 = mandate.versions[1];
  const fields = {
    objective: v2.objective,
    productId: v2.productId,
    segmentIds: [...v2.segmentIds],
    geographyCodes: [...v2.geographyCodes],
    exclusions: [...v2.exclusions],
    horizonYears: v2.horizonYears,
    pilotDurationDays: v2.pilotDurationDays,
    investmentCeiling: v2.investmentCeiling,
    currency: v2.currency,
    evidenceSourceKinds: [...v2.evidenceSourceKinds],
    ownerId: v2.ownerId,
    sponsorId: v2.sponsorId,
    successDefinition: v2.successDefinition,
  };
  return {
    id: mandate.id,
    key: mandate.key,
    businessUnitId: mandate.businessUnitId,
    title: mandate.title,
    status: 'approved',
    currentVersion: {
      id: v2.id,
      mandateId: mandate.id,
      version: 2,
      state: 'committed',
      fields,
      committedAt: v2.submittedAt,
      rowVersion: state.mandateDraftRowVersion,
      createdBy: people.maya.id,
      createdAt: J.mandateDrafted,
      updatedAt: v2.approvedAt,
    },
    draftVersion: null,
    g0GateRequestId: gates.g0.id,
    scopePreview:
      'Evaluate German food-processing plants for the water-monitoring system within 3 years, in EUR, owned by Maya Rao and sponsored by Elena Fischer. No prospect outreach before G1.',
    validationErrors: [],
  };
}

const oppByKey = new Map<string, (typeof opportunities)[number]>(opportunities.map((o) => [o.key, o]));

export function opportunityView(key: string): Opportunity | null {
  const o = oppByKey.get(key);
  if (!o) return null;
  const status = state.opportunityStatus[o.key] ?? o.status;
  const dup = 'likelyDuplicateOf' in o ? (oppByKey.get(o.likelyDuplicateOf)?.id ?? null) : null;
  return {
    id: o.id,
    key: o.key,
    mandateId: mandate.id,
    name: o.name,
    trigger: o.trigger,
    fitRationale: o.fitRationale,
    origin: o.origin,
    agentRunId: null,
    status,
    dismissReason: 'dismissReason' in o ? o.dismissReason : null,
    duplicateOfId: status === 'duplicate' ? dup : null,
    likelyDuplicateOfId: status === 'detected' ? dup : null,
    convertedCaseId: status === 'converted' && o.key === 'OPP-07' ? ME104.id : null,
    evidenceQuality: o.evidenceQuality,
    sourceCount: o.sourceKeys.length,
    unknownCount: o.unknowns.length,
    lastCheckedAt: o.lastCheckedAt,
    fitCriteria: [
      {
        criterion: 'Inside mandate geography',
        result: o.countryCode === 'DE' ? 'met' : 'not_met',
        note: null,
      },
      { criterion: 'Uses the existing product', result: 'met', note: null },
      { criterion: 'Channel coverage', result: o.key === 'OPP-07' ? 'met' : 'unknown', note: null },
    ],
    unknowns: [...o.unknowns],
    sources: o.sourceKeys.map((k) => {
      const s = sources.find((x) => x.key === k)!;
      return {
        sourceId: s.id,
        key: s.key,
        label: s.chipLabel,
        quality: s.quality,
        restricted: s.availability === 'restricted',
      };
    }),
    boundary: null,
    createdAt: o.lastCheckedAt,
    createdBy: o.origin === 'manual' ? people.jonas.id : people.analysisAgent.id,
  };
}

export function opportunityList(status?: string) {
  const items = opportunities
    .map((o) => opportunityView(o.key)!)
    .filter((o) => !status || o.status === status);
  const trade = connections.find((c) => c.kind === 'trade_registry')!;
  return {
    items,
    nextCursor: null,
    discoveryPartial: true,
    unavailableSources: [{ connectionId: trade.id, name: trade.name, since: '5 Oct' }],
    filtersText: 'Mandate MD-21 · Water-monitoring system · Germany and neighbours · food processing',
  };
}

// ---------------------------------------------------------------------------
// Lineage (sizing v2)
// ---------------------------------------------------------------------------

type LNode = {
  nodeKey: string;
  label: string;
  kind: 'evidence' | 'assumption' | 'calculated' | 'scenario';
  value: string | null;
  unit: 'sites' | 'rate' | 'currency_per_year' | 'currency_per_year_per_site' | 'customers';
  formulaText: string | null;
  formulaWithValues: string | null;
  inputs: string[];
  dependsOnAssumptionCount: number;
  ref: null;
};
const S = sizingV2Input;
const leaf = (
  nodeKey: string,
  label: string,
  kind: LNode['kind'],
  value: string,
  unit: LNode['unit'],
): LNode => ({
  nodeKey,
  label,
  kind,
  value,
  unit,
  formulaText: null,
  formulaWithValues: null,
  inputs: [],
  dependsOnAssumptionCount: kind === 'assumption' ? 1 : 0,
  ref: null,
});
const NODES: Record<string, LNode> = {
  'sizing.input.tam_site_count': leaf(
    'sizing.input.tam_site_count',
    S.tamPopulation.label,
    'evidence',
    S.tamPopulation.value,
    'sites',
  ),
  'sizing.input.annual_spend_per_site': leaf(
    'sizing.input.annual_spend_per_site',
    S.annualSpendPerUnit.label,
    'assumption',
    S.annualSpendPerUnit.value,
    'currency_per_year_per_site',
  ),
  'sizing.cohort.size': leaf('sizing.cohort.size', 'Size-qualified cohort', 'evidence', '1400', 'sites'),
  'sizing.cohort.process': leaf(
    'sizing.cohort.process',
    'Process-qualified cohort',
    'evidence',
    '1100',
    'sites',
  ),
  'sizing.cohort.overlap': leaf('sizing.cohort.overlap', 'Overlap removed', 'calculated', '500', 'sites'),
  'sizing.input.reachable_pool': leaf(
    'sizing.input.reachable_pool',
    S.reachablePool.label,
    'assumption',
    S.reachablePool.value,
    'sites',
  ),
  'sizing.input.adoption_rate.base': leaf(
    'sizing.input.adoption_rate.base',
    'Adoption by year 3 · Base',
    'assumption',
    '0.20',
    'rate',
  ),
  'sizing.tam.value': {
    nodeKey: 'sizing.tam.value',
    label: 'TAM',
    kind: 'calculated',
    value: expectedSizing.tam.value,
    unit: 'currency_per_year',
    formulaText: 'TAM site count × Annual spend per site',
    formulaWithValues: '5,000 × €20,000 = €100,000,000/year',
    inputs: ['sizing.input.tam_site_count', 'sizing.input.annual_spend_per_site'],
    dependsOnAssumptionCount: 1,
    ref: null,
  },
  'sizing.sam.value': {
    nodeKey: 'sizing.sam.value',
    label: 'SAM',
    kind: 'calculated',
    value: expectedSizing.sam.value,
    unit: 'currency_per_year',
    formulaText: '(Size-qualified + Process-qualified − Overlap) × Annual spend per site',
    formulaWithValues: '(1,400 + 1,100 − 500) × €20,000 = €40,000,000/year',
    inputs: [
      'sizing.cohort.size',
      'sizing.cohort.process',
      'sizing.cohort.overlap',
      'sizing.input.annual_spend_per_site',
    ],
    dependsOnAssumptionCount: 1,
    ref: null,
  },
  'sizing.reachable.population': {
    ...leaf('sizing.reachable.population', 'Reachable pool', 'assumption', '500', 'sites'),
  },
  'sizing.som.base.revenue': {
    nodeKey: 'sizing.som.base.revenue',
    label: 'SOM · Base · end of year 3',
    kind: 'scenario',
    value: expectedSizing.som.base.annualRevenue,
    unit: 'currency_per_year',
    formulaText: 'Reachable pool × Adoption (Base) × Annual price, capped by capacity',
    formulaWithValues: '500 × 20% × €20,000 = €2,000,000/year',
    inputs: [
      'sizing.input.reachable_pool',
      'sizing.input.adoption_rate.base',
      'sizing.input.annual_spend_per_site',
    ],
    dependsOnAssumptionCount: 3,
    ref: null,
  },
};
const EXACT: Record<string, string> = {
  'sizing.tam.value': '€100,000,000',
  'sizing.sam.value': '€40,000,000',
  'sizing.som.base.revenue': '€2,000,000',
};

export function lineage(caseKey: string, nodeKey: string) {
  const node = NODES[nodeKey];
  if (!node) return null;
  const usedBy = Object.values(NODES)
    .filter((n) => n.inputs.includes(nodeKey))
    .map((n) => ({
      label: n.label,
      href: `/me/cases/${caseKey}/sizing?input=${encodeURIComponent(n.nodeKey)}&view=lineage`,
    }));
  if (nodeKey === 'sizing.sam.value')
    usedBy.push({ label: 'Economics v2', href: `/me/cases/${caseKey}/economics` });
  return {
    node,
    inputs: node.inputs.map((k) => NODES[k]!),
    usedBy,
    history: [
      { at: '13 Oct 2026, 16:30', text: 'Committed in sizing v2 by Maya Rao' },
      { at: '9 Oct 2026, 11:05', text: 'Draft v1 created by Maya Rao' },
    ],
    exactValue: EXACT[nodeKey] ?? null,
    engineLabel: 'Calculated by sizing engine v1.0 · reproducible',
  };
}

// ---------------------------------------------------------------------------
// Search and admin
// ---------------------------------------------------------------------------

export function search(q: string, limit: number): SearchHit[] {
  const s = q.toLowerCase();
  const hits: SearchHit[] = [
    ...cases.map((c) => ({
      type: 'case' as const,
      id: c.id,
      key: c.key,
      title: c.title,
      subtitle: `Expansion case · ${c.marketLabel}`,
      href: `/me/cases/${c.key}/thesis`,
    })),
    ...opportunities.map((o) => ({
      type: 'opportunity' as const,
      id: o.id,
      key: o.key,
      title: o.name,
      subtitle: 'Opportunity · MD-21',
      href: `/me/opportunities?mandate=MD-21&selected=${o.key}`,
    })),
    ...assumptions.map((a) => ({
      type: 'assumption' as const,
      id: a.id,
      key: a.key,
      title: a.name,
      subtitle: 'Assumption · ME-104',
      href: `/me/cases/ME-104/validation?assumption=${a.key}`,
    })),
    {
      type: 'experiment' as const,
      id: exp03.id,
      key: exp03.key,
      title: exp03.title,
      subtitle: 'Experiment · ME-104',
      href: '/me/cases/ME-104/validation?experiment=EXP-03',
    },
    // Restricted sources are never searchable (never-rule 8).
    ...sources
      .filter((x) => x.availability !== 'restricted')
      .map((x) => ({
        type: 'source' as const,
        id: x.id,
        key: x.key,
        title: x.title,
        subtitle: `Source · ${x.chipLabel}`,
        href: `/evidence/${x.key}`,
      })),
    {
      type: 'mandate' as const,
      id: mandate.id,
      key: mandate.key,
      title: mandate.title,
      subtitle: mandate.mandateLabel,
      href: `/me/mandates/${mandate.key}`,
    },
  ];
  return hits
    .filter((h) => `${h.key ?? ''} ${h.title} ${h.subtitle}`.toLowerCase().includes(s))
    .slice(0, limit);
}

export function adminConnections() {
  return {
    items: connections.map((c) => ({ ...c, lastCheckedAt: '2026-11-26T08:00:00+01:00' })),
    mappings: connectorMappings.map((m, i) => ({
      id: fid('connection', 20 + i),
      connectionId: m.connectionId,
      purpose: m.purpose,
      destinationProject: m.destinationProject,
      issueType: m.issueType,
      assigneeMap: {},
    })),
  };
}

// ---------------------------------------------------------------------------
// Directory (D-068 §12–13): people.list and catalogue.scopeOptions, mirroring the API rules (D-079)
// ---------------------------------------------------------------------------

/** Active people with a role: never the agent; the administrator only with the admin role. */
export function directoryPeople(query: { businessUnitId?: string; role?: RoleCode }): DirectoryPerson[] {
  const byUser = new Map<string, { roles: Set<RoleCode>; bus: Set<string>; tenantWide: boolean }>();
  for (const r of roleAssignments) {
    const e = byUser.get(r.userId) ?? { roles: new Set(), bus: new Set(), tenantWide: false };
    e.roles.add(r.role as RoleCode);
    if (r.businessUnitId) e.bus.add(r.businessUnitId);
    else e.tenantWide = true;
    byUser.set(r.userId, e);
  }
  return [...byUser.entries()]
    .filter(([id]) => HUMANS.some((h) => h.id === id))
    .filter(([, e]) => !query.role || e.roles.has(query.role))
    .filter(([, e]) => !query.businessUnitId || e.tenantWide || e.bus.has(query.businessUnitId))
    .map(([id, e]) => ({
      ...personRef(id),
      roles: [...e.roles].sort(),
      businessUnitIds: e.tenantWide ? [] : [...e.bus].sort(),
    }))
    .sort((x, y) => x.displayName.localeCompare(y.displayName) || x.id.localeCompare(y.id));
}

/** Business units the viewer can see, the catalogue, and the countries the tenant's mandates use. */
export function scopeOptions(viewerId: string, businessUnitId?: string): ScopeOptions | null {
  const mine = roleAssignments.filter((r) => r.userId === viewerId);
  const tenantWide = mine.some((r) => r.businessUnitId === null);
  const visible = businessUnits.filter((b) => tenantWide || mine.some((r) => r.businessUnitId === b.id));
  if (businessUnitId && !visible.some((b) => b.id === businessUnitId)) return null;
  const countries = [
    ...new Set([
      ...mandate.versions.flatMap((v) => ('geographyCodes' in v ? [...v.geographyCodes] : [])),
      ...opportunities.map((o) => o.countryCode),
    ]),
  ].sort();
  return {
    businessUnits: visible
      .map((b) => ({ id: b.id, key: b.key, name: b.name }))
      .sort((x, y) => x.name.localeCompare(y.name)),
    products: products.map((x) => ({ id: x.id, key: x.key, name: x.name })),
    segments: segments
      .map((x) => ({ id: x.id, key: x.key, name: x.name }))
      .sort((x, y) => x.name.localeCompare(y.name)),
    countries,
  };
}
