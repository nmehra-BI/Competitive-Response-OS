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
import type { AuthorityGrant, GateCode, RoleAssignment, RoleCode } from '@growth-os/contracts';
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
    namedReviewerId?: string;
    gateCode?: GateCode;
    requestedAmount?: string | null;
    currency?: string | null;
    licenseAccess?: 'excerpt' | 'aggregate_only' | 'none';
  };
}

export interface PolicySubject {
  actor: Actor;
  roles: readonly RoleAssignment[];
  authority: readonly AuthorityGrant[];
  /** Users who are case participants (case-scoped access). */
  participantOfCaseIds: readonly string[];
}

export type PolicyDecision =
  | { allow: true; rule: string; authorityGrantId: string | null }
  | {
      allow: false;
      rule: string;
      code:
        | 'FORBIDDEN'
        | 'NOT_FOUND' // hide existence
        | 'AGENT_IDENTITY_FORBIDDEN'
        | 'AUTHORITY_INSUFFICIENT'
        | 'SELF_APPROVAL_PROHIBITED'
        | 'CONFLICT_OF_INTEREST'
        | 'RESTRICTED_SOURCE';
      reason: string; // business copy shown in the UI, e.g. "You authored this package and cannot approve it."
    };

export interface PolicyEngine {
  check(subject: PolicySubject, action: Action, resource: ResourceRef): PolicyDecision;
  /** Which actions to render as enabled for a resource (UI hides or disables the rest with a reason). */
  allowedActions(subject: PolicySubject, resource: ResourceRef): Action[];
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

/** TODO(WS3 workflow/authz): implement with exhaustive role × action × scope tests. */
export function createPolicyEngine(): PolicyEngine {
  return {
    check: () => {
      throw new Error('TODO(WS3): PolicyEngine.check');
    },
    allowedActions: () => {
      throw new Error('TODO(WS3): PolicyEngine.allowedActions');
    },
  };
}
