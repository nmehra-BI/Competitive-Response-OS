/**
 * Authorization model (ARCHITECTURE.md §7). RBAC + resource scope + delegated authority.
 *
 * Enforcement points, in order: (1) Postgres RLS by tenant; (2) PolicyEngine.check in every
 * command/query handler; (3) field/aggregate redaction in serializers; (4) re-check at outbox
 * send time; (5) database triggers for the approval invariants (defence in depth).
 *
 * Invariants that no configuration can change:
 *  - agent and service principals never decide gates, sign reviews or record outcomes;
 *  - tenant admins configure but never gain approval authority from configuration;
 *  - a package author or case owner never approves their own gate;
 *  - task ownership never grants approval.
 */
import Decimal from 'decimal.js';
import type {
  AuthorityGrant,
  GateCode,
  GateDisposition,
  RoleAssignment,
  RoleCode,
} from '@growth-os/contracts';
import type { Actor } from '../workflow/state-machine';

export const ACTIONS = [
  // read
  'case.read',
  'case.read_brief',
  'source.read_metadata',
  'source.read_excerpt',
  'site_list.read',
  'audit.read',
  'diagnostics.read',
  // write: discovery and assessment
  'mandate.edit',
  'mandate.submit',
  'opportunity.triage',
  'opportunity.convert',
  'case.edit',
  'case.hold_resume',
  'case.stop',
  'model.edit_draft',
  'model.commit',
  'assumption.edit',
  'assumption.dispute',
  'challenge.resolve',
  'claim.accept_ai',
  'review.request',
  'review.sign', // feasibility / finance / specialist sign-off, by the named reviewer only
  'experiment.edit',
  'experiment.record_result',
  // gates
  'gate.submit',
  'gate.withdraw',
  'gate.decide',
  'gate.record_position',
  'materiality.resolve',
  // execution
  'pilot.edit_plan',
  'pilot.activate',
  'task.update',
  'task_sync.preview',
  'task_sync.send',
  'budget.record',
  'outcome.record',
  'outcome.decide',
  // analysis
  'analysis.start',
  'proposal.decide',
  // admin
  'admin.configure',
] as const;
export type Action = (typeof ACTIONS)[number];

/** Resource the action targets. Scope checks use business unit and case participation. */
export interface ResourceRef {
  type: 'tenant' | 'case' | 'mandate' | 'source' | 'gate_request' | 'task' | 'assumption' | 'review_request';
  id: string;
  businessUnitId: string | null;
  caseId: string | null;
  /** Facts the policy needs, loaded by the handler (never trusted from the client). */
  facts?: {
    caseOwnerId?: string;
    sponsorId?: string;
    packageAuthorId?: string;
    /** The person named on a review request or challenge (the only one who may sign/resolve as *self*). */
    namedReviewerId?: string;
    gateCode?: GateCode;
    requestedAmount?: string | null;
    currency?: string | null;
    licenseAccess?: 'excerpt' | 'aggregate_only' | 'none';
    /** Users the conflict-of-interest policy marks as conflicted for this case or gate. */
    conflictedUserIds?: readonly string[];
    /** For admin.configure of roles/grants: the user being configured (self-grants are refused). */
    grantTargetUserId?: string;
  };
}

export interface PolicySubject {
  actor: Actor;
  roles: readonly RoleAssignment[];
  authority: readonly AuthorityGrant[];
  /** Users who are case participants (case-scoped access). */
  participantOfCaseIds: readonly string[];
  /**
   * Decision date (ISO YYYY-MM-DD, tenant local) used to check authority grant validity. Required for
   * gate decisions: without it the authority check fails closed. The domain never reads the clock.
   */
  asOf?: string;
}

export type PolicyDenyCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND' // hide existence
  | 'AGENT_IDENTITY_FORBIDDEN'
  | 'AUTHORITY_INSUFFICIENT'
  | 'SELF_APPROVAL_PROHIBITED'
  | 'CONFLICT_OF_INTEREST'
  | 'RESTRICTED_SOURCE';

export type PolicyDecision =
  | { allow: true; rule: string; authorityGrantId: string | null }
  | {
      allow: false;
      rule: string;
      code: PolicyDenyCode;
      reason: string; // business copy shown in the UI, e.g. "You authored this package and cannot approve it."
    };

/** One check of a gate decision, as consumed by the gate request machine guards. */
export interface PolicyCheck {
  ok: boolean;
  code?: PolicyDenyCode;
  reason?: string;
}

/** The gate-decision checks, separately (API order: designated approver, authority, self, conflict). */
export interface GateDecisionChecks {
  /** Human, interactive, case visible, not an administrator, holds a deciding role in scope. */
  designatedApprover: PolicyCheck;
  /** A valid grant covers gate × business unit × amount × currency × date. */
  authority: PolicyCheck;
  /** Not the package author and not the case owner. */
  notSelf: PolicyCheck;
  /** Not marked as conflicted. */
  notConflicted: PolicyCheck;
  authorityGrantId: string | null;
}

/** What the viewer may do on the approval panel (subset of ApprovalPanelState). */
export interface ApprovalPanelPolicy {
  canDecide: boolean;
  allowedDispositions: GateDisposition[];
  cannotDecideReason: string | null;
  authorityGrantId: string | null;
}

export interface PolicyEngine {
  /**
   * May the subject perform the action on the resource? For `gate.decide` this answers "may approve":
   * it includes the authority grant check. Returning or declining needs only `designatedApprover`
   * (see `gateDecisionChecks`).
   */
  check(subject: PolicySubject, action: Action, resource: ResourceRef): PolicyDecision;
  /** Which actions to render as enabled for a resource (UI hides or disables the rest with a reason). */
  allowedActions(subject: PolicySubject, resource: ResourceRef): Action[];
  /** Each gate-decision check separately; feeds the gate request machine guards. */
  gateDecisionChecks(subject: PolicySubject, resource: ResourceRef): GateDecisionChecks;
  /** Approval panel state for the viewer. */
  approvalPanel(subject: PolicySubject, resource: ResourceRef): ApprovalPanelPolicy;
}

/**
 * Role → action table (the "policy table"). Scope and authority checks are applied on top.
 * `self` means only the named person (e.g. the requested reviewer) may act.
 * FROZEN: changes need a change request. Full matrix in ARCHITECTURE.md §7.3.
 */
export const ROLE_ACTIONS: Readonly<Record<RoleCode, readonly Action[]>> = {
  sponsor: [
    'case.read',
    'case.read_brief',
    'source.read_metadata',
    'gate.decide',
    'gate.record_position',
    'case.stop',
    'case.hold_resume',
    'outcome.decide',
    'materiality.resolve',
    'challenge.resolve',
    'assumption.dispute',
    'review.request',
  ],
  case_owner: [
    'case.read',
    'case.read_brief',
    'source.read_metadata',
    'mandate.edit',
    'mandate.submit',
    'opportunity.triage',
    'opportunity.convert',
    'case.edit',
    'case.hold_resume',
    'model.edit_draft',
    'model.commit',
    'assumption.edit',
    'assumption.dispute',
    'claim.accept_ai',
    'review.request',
    'experiment.edit',
    'experiment.record_result',
    'gate.submit',
    'gate.withdraw',
    'pilot.edit_plan',
    'task.update',
    'outcome.record',
    'analysis.start',
    'proposal.decide',
    'budget.record',
  ],
  pilot_owner: [
    'case.read',
    'case.read_brief',
    'source.read_metadata',
    'pilot.edit_plan',
    'pilot.activate',
    'task.update',
    'task_sync.preview',
    'task_sync.send',
    'outcome.record',
    'budget.record',
    'review.sign',
    'gate.record_position',
  ],
  commercial_reviewer: [
    'case.read',
    'case.read_brief',
    'source.read_metadata',
    'review.sign',
    'assumption.dispute',
    'gate.record_position',
    'task.update',
  ],
  product_reviewer: [
    'case.read',
    'case.read_brief',
    'source.read_metadata',
    'review.sign',
    'assumption.dispute',
    'gate.record_position',
    'task.update',
  ],
  finance_reviewer: [
    'case.read',
    'case.read_brief',
    'source.read_metadata',
    'review.sign',
    'assumption.dispute',
    'challenge.resolve',
    'gate.record_position',
    'model.edit_draft',
  ],
  specialist_reviewer: [
    'case.read',
    'case.read_brief',
    'source.read_metadata',
    'review.sign',
    'gate.record_position',
  ],
  investment_committee: [
    'case.read',
    'case.read_brief',
    'source.read_metadata',
    'gate.decide',
    'gate.record_position',
    'outcome.decide',
    'materiality.resolve',
  ],
  read_only_reviewer: ['case.read', 'case.read_brief', 'source.read_metadata'],
  tenant_admin: ['admin.configure', 'audit.read', 'diagnostics.read'],
};

/** Actions an agent principal may ever perform (through the tool gateway only). */
export const AGENT_ALLOWED_ACTIONS: readonly Action[] = [
  'case.read',
  'source.read_metadata',
  'source.read_excerpt',
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const READ_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'case.read',
  'case.read_brief',
  'source.read_metadata',
  'source.read_excerpt',
  'site_list.read',
  'audit.read',
  'diagnostics.read',
]);

/** Licence-governed reads: any role that may read the case, plus an `excerpt` entitlement. */
const LICENSED_ACTIONS: ReadonlySet<Action> = new Set<Action>(['source.read_excerpt', 'site_list.read']);

/** Reads a case participant gets without a role. */
const PARTICIPANT_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'case.read',
  'case.read_brief',
  'source.read_metadata',
]);

/** Actions only the named person may take when granted by this role (*self* in ARCHITECTURE §7.3). */
const SELF_ONLY: Readonly<Partial<Record<RoleCode, readonly Action[]>>> = {
  pilot_owner: ['review.sign'],
  commercial_reviewer: ['review.sign'],
  product_reviewer: ['review.sign'],
  finance_reviewer: ['review.sign', 'challenge.resolve'],
  specialist_reviewer: ['review.sign'],
};

/** Actions a conflicted reviewer may not take. */
const CONFLICT_SENSITIVE: ReadonlySet<Action> = new Set<Action>([
  'gate.decide',
  'gate.record_position',
  'review.sign',
  'materiality.resolve',
  'outcome.decide',
]);

/** Gates that authorize spend: approving needs a stated amount within a grant ceiling. */
const SPEND_GATES: ReadonlySet<GateCode> = new Set<GateCode>(['G1', 'G2', 'G3', 'X']);

const ALL_DISPOSITIONS: readonly GateDisposition[] = [
  'approve',
  'approve_with_conditions',
  'return_for_revision',
  'not_approved',
  'abstain',
  'delegate',
];
const APPROVE_DISPOSITIONS: ReadonlySet<GateDisposition> = new Set<GateDisposition>([
  'approve',
  'approve_with_conditions',
]);

export const POLICY_COPY = {
  agent: 'Only a person can take this action. The analysis assistant makes proposals only.',
  nonInteractive: 'This action needs your own signed-in session.',
  system: 'System actors act through recorded transitions, not through permissions.',
  notFound: 'Not found.',
  forbidden: 'Your role does not include this action.',
  adminNeverApproves: 'Administrators configure roles and policies but cannot approve gates.',
  adminSelfGrant: 'You cannot change your own roles or authority.',
  author: 'You authored this package and cannot approve it.',
  owner: 'You own this case and cannot approve its gate.',
  conflicted: 'You are marked as conflicted for this decision and cannot take part.',
  notNamedReviewer: 'Only the named reviewer can sign this review.',
  notOwnChallenge: 'Only the reviewer who raised this challenge, or the sponsor, can resolve it.',
  restricted: 'This source is restricted by its licence. No excerpt is available.',
  notDecider: 'Your role does not decide gates.',
  noDate: 'Authority could not be checked without a decision date.',
  noGate: 'The gate for this decision is unknown, so authority cannot be checked.',
  noAmount:
    'This request has no stated amount yet (placeholder). It cannot be approved until the amount is set.',
  aboveCeiling: 'This request is above your delegated authority (up to €[limit]).',
  currency: 'Your delegated authority is in a different currency.',
} as const;

const authorityGap = (gate: GateCode) =>
  `No ${gate} approver with authority in this business unit — Authority gap.`;

function deny(code: PolicyDenyCode, rule: string, reason: string): PolicyDecision {
  return { allow: false, code, rule, reason };
}

function rolesInScope(subject: PolicySubject, resource: ResourceRef): RoleAssignment[] {
  return subject.roles.filter(
    (r) =>
      r.userId === actorUserId(subject.actor) &&
      r.revokedAt === null &&
      (r.businessUnitId === null ||
        resource.businessUnitId === null ||
        r.businessUnitId === resource.businessUnitId) &&
      (r.caseId === null || r.caseId === resource.caseId),
  );
}

function actorUserId(actor: Actor): string | null {
  return actor.kind === 'system' ? null : actor.userId;
}

function holdsAdmin(subject: PolicySubject): boolean {
  const uid = actorUserId(subject.actor);
  return subject.roles.some((r) => r.userId === uid && r.role === 'tenant_admin' && r.revokedAt === null);
}

function isVisible(subject: PolicySubject, resource: ResourceRef, scoped: RoleAssignment[]): boolean {
  if (resource.caseId === null && resource.type === 'tenant') return true;
  if (scoped.length > 0) return true;
  return resource.caseId !== null && subject.participantOfCaseIds.includes(resource.caseId);
}

function isConflicted(subject: PolicySubject, resource: ResourceRef): boolean {
  const uid = actorUserId(subject.actor);
  return uid !== null && (resource.facts?.conflictedUserIds ?? []).includes(uid);
}

function selfCheck(subject: PolicySubject, resource: ResourceRef): PolicyCheck {
  const uid = actorUserId(subject.actor);
  if (uid !== null && resource.facts?.packageAuthorId === uid) {
    return { ok: false, code: 'SELF_APPROVAL_PROHIBITED', reason: POLICY_COPY.author };
  }
  if (uid !== null && resource.facts?.caseOwnerId === uid) {
    return { ok: false, code: 'SELF_APPROVAL_PROHIBITED', reason: POLICY_COPY.owner };
  }
  return { ok: true };
}

/** Find a grant that covers gate × business unit × amount × currency on the decision date. */
function authorityCheck(
  subject: PolicySubject,
  resource: ResourceRef,
): PolicyCheck & { grantId: string | null } {
  const uid = actorUserId(subject.actor);
  const gate = resource.facts?.gateCode;
  if (!gate) return { ok: false, code: 'AUTHORITY_INSUFFICIENT', reason: POLICY_COPY.noGate, grantId: null };
  if (!subject.asOf) {
    return { ok: false, code: 'AUTHORITY_INSUFFICIENT', reason: POLICY_COPY.noDate, grantId: null };
  }
  const asOf = subject.asOf;
  const valid = subject.authority
    .filter(
      (g) =>
        g.userId === uid &&
        g.gateCode === gate &&
        g.businessUnitId === resource.businessUnitId &&
        g.revokedAt === null &&
        g.validFrom <= asOf &&
        (g.validTo === null || g.validTo >= asOf),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (valid.length === 0) {
    return { ok: false, code: 'AUTHORITY_INSUFFICIENT', reason: authorityGap(gate), grantId: null };
  }
  const amount = resource.facts?.requestedAmount ?? null;
  const currency = resource.facts?.currency ?? null;
  if (amount === null) {
    if (SPEND_GATES.has(gate)) {
      return { ok: false, code: 'AUTHORITY_INSUFFICIENT', reason: POLICY_COPY.noAmount, grantId: null };
    }
    return { ok: true, grantId: valid[0]?.id ?? null };
  }
  let requested: Decimal;
  try {
    requested = new Decimal(amount);
  } catch {
    return { ok: false, code: 'AUTHORITY_INSUFFICIENT', reason: POLICY_COPY.noAmount, grantId: null };
  }
  let sawCurrencyMismatch = false;
  for (const g of valid) {
    if (g.ceilingAmount === null || g.currency === null) continue;
    if (g.currency !== currency) {
      sawCurrencyMismatch = true;
      continue;
    }
    if (requested.lte(new Decimal(g.ceilingAmount))) return { ok: true, grantId: g.id };
  }
  return {
    ok: false,
    code: 'AUTHORITY_INSUFFICIENT',
    reason: sawCurrencyMismatch ? POLICY_COPY.currency : POLICY_COPY.aboveCeiling,
    grantId: null,
  };
}

/** Actor-kind gate shared by every check. Returns a denial or null. */
function actorDenial(subject: PolicySubject, action: Action): PolicyDecision | null {
  const a = subject.actor;
  if (a.kind === 'system') return deny('FORBIDDEN', 'actor:system', POLICY_COPY.system);
  if (a.kind === 'service') return deny('AGENT_IDENTITY_FORBIDDEN', 'actor:service', POLICY_COPY.agent);
  if (a.kind === 'agent') {
    if (!AGENT_ALLOWED_ACTIONS.includes(action)) {
      return deny('AGENT_IDENTITY_FORBIDDEN', 'actor:agent', POLICY_COPY.agent);
    }
    return null;
  }
  if (!a.interactive && !READ_ACTIONS.has(action)) {
    return deny('AGENT_IDENTITY_FORBIDDEN', 'actor:non_interactive', POLICY_COPY.nonInteractive);
  }
  return null;
}

function checkAgent(subject: PolicySubject, action: Action, resource: ResourceRef): PolicyDecision {
  // The tool gateway scopes the agent to the run's case; here only licence rules apply.
  if (resource.caseId !== null && !subject.participantOfCaseIds.includes(resource.caseId)) {
    return deny('NOT_FOUND', 'agent:not_in_run_scope', POLICY_COPY.notFound);
  }
  if (LICENSED_ACTIONS.has(action) && resource.facts?.licenseAccess !== 'excerpt') {
    return deny('RESTRICTED_SOURCE', 'licence', POLICY_COPY.restricted);
  }
  return { allow: true, rule: `agent:${action}`, authorityGrantId: null };
}

function computeGateChecks(subject: PolicySubject, resource: ResourceRef): GateDecisionChecks {
  const notSelf = selfCheck(subject, resource);
  const notConflicted: PolicyCheck = isConflicted(subject, resource)
    ? { ok: false, code: 'CONFLICT_OF_INTEREST', reason: POLICY_COPY.conflicted }
    : { ok: true };

  let designatedApprover: PolicyCheck;
  const a = subject.actor;
  const scoped = rolesInScope(subject, resource);
  if (a.kind === 'agent' || a.kind === 'service') {
    designatedApprover = { ok: false, code: 'AGENT_IDENTITY_FORBIDDEN', reason: POLICY_COPY.agent };
  } else if (a.kind === 'system') {
    designatedApprover = { ok: false, code: 'FORBIDDEN', reason: POLICY_COPY.system };
  } else if (!a.interactive) {
    designatedApprover = { ok: false, code: 'AGENT_IDENTITY_FORBIDDEN', reason: POLICY_COPY.nonInteractive };
  } else if (!isVisible(subject, resource, scoped)) {
    designatedApprover = { ok: false, code: 'NOT_FOUND', reason: POLICY_COPY.notFound };
  } else if (holdsAdmin(subject)) {
    designatedApprover = { ok: false, code: 'FORBIDDEN', reason: POLICY_COPY.adminNeverApproves };
  } else if (!scoped.some((r) => ROLE_ACTIONS[r.role].includes('gate.decide'))) {
    designatedApprover = { ok: false, code: 'FORBIDDEN', reason: POLICY_COPY.notDecider };
  } else {
    designatedApprover = { ok: true };
  }

  const auth = designatedApprover.ok
    ? authorityCheck(subject, resource)
    : { ok: false, code: designatedApprover.code, reason: designatedApprover.reason, grantId: null };
  return {
    designatedApprover,
    authority: { ok: auth.ok, code: auth.code, reason: auth.reason },
    notSelf,
    notConflicted,
    authorityGrantId: auth.grantId,
  };
}

function checkGateDecide(subject: PolicySubject, resource: ResourceRef): PolicyDecision {
  const c = computeGateChecks(subject, resource);
  // Order: visibility → admin → self → conflict → deciding role → authority. Self comes before the
  // role check so a case owner forcing a decision gets SELF_APPROVAL_PROHIBITED (BUILD_PLAN §8 step 18).
  const d = c.designatedApprover;
  if (!d.ok && (d.code === 'NOT_FOUND' || d.reason === POLICY_COPY.adminNeverApproves)) {
    return deny(d.code ?? 'FORBIDDEN', 'gate.decide:designated_approver', d.reason ?? POLICY_COPY.forbidden);
  }
  if (!c.notSelf.ok) return deny('SELF_APPROVAL_PROHIBITED', 'gate.decide:not_self', c.notSelf.reason ?? '');
  if (!c.notConflicted.ok) {
    return deny('CONFLICT_OF_INTEREST', 'gate.decide:not_conflicted', c.notConflicted.reason ?? '');
  }
  if (!d.ok) {
    return deny(d.code ?? 'FORBIDDEN', 'gate.decide:designated_approver', d.reason ?? POLICY_COPY.forbidden);
  }
  if (!c.authority.ok) {
    return deny('AUTHORITY_INSUFFICIENT', 'gate.decide:authority', c.authority.reason ?? '');
  }
  return { allow: true, rule: 'gate.decide:grant', authorityGrantId: c.authorityGrantId };
}

function checkHuman(subject: PolicySubject, action: Action, resource: ResourceRef): PolicyDecision {
  const uid = actorUserId(subject.actor);
  const scoped = rolesInScope(subject, resource);
  if (!isVisible(subject, resource, scoped)) return deny('NOT_FOUND', 'scope', POLICY_COPY.notFound);

  if (action === 'gate.decide') return checkGateDecide(subject, resource);

  if (CONFLICT_SENSITIVE.has(action) && isConflicted(subject, resource)) {
    return deny('CONFLICT_OF_INTEREST', `${action}:not_conflicted`, POLICY_COPY.conflicted);
  }

  if (action === 'admin.configure' && resource.facts?.grantTargetUserId === uid) {
    return deny('FORBIDDEN', 'admin.configure:not_self', POLICY_COPY.adminSelfGrant);
  }

  if (LICENSED_ACTIONS.has(action)) {
    const canRead = scoped.some((r) => ROLE_ACTIONS[r.role].includes('case.read'));
    if (!canRead) return deny('FORBIDDEN', `${action}:role`, POLICY_COPY.forbidden);
    if (resource.facts?.licenseAccess !== 'excerpt') {
      return deny('RESTRICTED_SOURCE', 'licence', POLICY_COPY.restricted);
    }
    return { allow: true, rule: `${action}:licence`, authorityGrantId: null };
  }

  let selfFailure: string | null = null;
  for (const r of scoped) {
    if (!ROLE_ACTIONS[r.role].includes(action)) continue;
    const selfOnly = action === 'review.sign' || (SELF_ONLY[r.role] ?? []).includes(action);
    if (selfOnly && (uid === null || resource.facts?.namedReviewerId !== uid)) {
      selfFailure =
        action === 'challenge.resolve' ? POLICY_COPY.notOwnChallenge : POLICY_COPY.notNamedReviewer;
      continue;
    }
    return { allow: true, rule: `role:${r.role}`, authorityGrantId: null };
  }
  if (selfFailure) return deny('FORBIDDEN', `${action}:self`, selfFailure);

  if (
    PARTICIPANT_ACTIONS.has(action) &&
    resource.caseId !== null &&
    subject.participantOfCaseIds.includes(resource.caseId) &&
    !holdsAdmin(subject)
  ) {
    return { allow: true, rule: 'participant', authorityGrantId: null };
  }
  return deny('FORBIDDEN', `${action}:role`, POLICY_COPY.forbidden);
}

/** Pure, table-driven policy engine (ARCHITECTURE.md §7.3, D-016). */
export function createPolicyEngine(): PolicyEngine {
  const check = (subject: PolicySubject, action: Action, resource: ResourceRef): PolicyDecision => {
    const denied = actorDenial(subject, action);
    if (denied) return denied;
    if (subject.actor.kind === 'agent') return checkAgent(subject, action, resource);
    return checkHuman(subject, action, resource);
  };

  const approvalPanel = (subject: PolicySubject, resource: ResourceRef): ApprovalPanelPolicy => {
    const decision = check(subject, 'gate.decide', resource);
    const c = computeGateChecks(subject, resource);
    const canTakePart = c.designatedApprover.ok && c.notSelf.ok && c.notConflicted.ok;
    if (!canTakePart) {
      return {
        canDecide: false,
        allowedDispositions: [],
        cannotDecideReason: decision.allow ? null : decision.reason,
        authorityGrantId: null,
      };
    }
    const allowedDispositions = ALL_DISPOSITIONS.filter(
      (d) => !APPROVE_DISPOSITIONS.has(d) || c.authority.ok,
    );
    return {
      canDecide: true,
      allowedDispositions,
      cannotDecideReason: c.authority.ok ? null : (c.authority.reason ?? null),
      authorityGrantId: c.authorityGrantId,
    };
  };

  return {
    check,
    allowedActions: (subject, resource) => ACTIONS.filter((a) => check(subject, a, resource).allow),
    gateDecisionChecks: computeGateChecks,
    approvalPanel,
  };
}
