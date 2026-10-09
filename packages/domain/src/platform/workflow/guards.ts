/**
 * Guard library for the shared Growth OS machines (gate request, snapshot, task sync, analysis run).
 *
 * Guards read FACTS that the caller loads from committed records (never from the client) plus the
 * actor. A missing fact fails closed. Each failure carries business copy for the "Why?" list and the
 * error code the API returns. Authorization facts for gate decisions come from
 * `PolicyEngine.gateDecisionChecks` so the policy and the machine never disagree.
 */
import type { ConnectorStatus, SnapshotStatus } from '@growth-os/contracts';
import type { GateDecisionChecks, PolicyCheck } from '../policy/policy-engine';
import type { Actor, GuardFn, GuardResult, TransitionErrorCode } from './state-machine';

/** Whether the approval that authorizes execution still applies. */
export type ApprovalEffectiveness = 'effective' | 'invalidated' | 'expired' | 'missing';

export interface PreconditionFact {
  key: string;
  met: boolean;
  label?: string;
  detail?: string | null;
}

export interface WorkflowFacts {
  // --- people -------------------------------------------------------------
  caseOwnerId?: string | null;
  /** Users the case owner delegated preparation to. */
  delegateIds?: readonly string[];
  packageAuthorId?: string | null;
  /** Analysis run requester. */
  requesterId?: string | null;

  // --- gate request -------------------------------------------------------
  /** PreconditionEvaluator output for the gate. */
  preconditions?: readonly PreconditionFact[];
  /** The gate request's current snapshot (after building it for submit/refresh). */
  snapshot?: { id: string; hash: string; status: SnapshotStatus } | null;
  /** What the approver says they decided on. */
  decision?: {
    snapshotId: string;
    snapshotHash: string;
    conditions?: readonly { ownerId: string | null }[];
  } | null;
  /** From PolicyEngine.gateDecisionChecks(subject, resource). */
  decisionChecks?: GateDecisionChecks;
  /** Sign-off areas the gate policy requires, and whether each is present on the snapshot. */
  requiredSignOffs?: readonly { area: string; present: boolean }[];
  rationale?: string | null;
  /** MaterialityEvaluator said this change affects the pinned snapshot. */
  materialChange?: { affectsSnapshot: boolean } | null;
  newerSnapshotCreated?: boolean;
  /** Approval expiry instant (ISO date-time). */
  expiresAt?: string | null;
  /** Evaluation instant (ISO date-time). The domain never reads the clock. */
  now?: string;
  /** The approval has been executed (pilot activated or tasks sent). */
  executed?: boolean;

  // --- task sync ----------------------------------------------------------
  approval?: ApprovalEffectiveness;
  previewCurrent?: boolean;
  blockingConditionsMet?: boolean;
  ownerAssigned?: boolean;
  externalKey?: string | null;
  attempts?: number;
  /** Default 5 (ARCHITECTURE §13). */
  maxAttempts?: number;
  connector?: ConnectorStatus;

  // --- analysis run -------------------------------------------------------
  tenantConcurrencyAvailable?: boolean;
  budgetAvailable?: boolean;
  outputSchemaValid?: boolean;
  citationsValid?: boolean;
  checkpointExists?: boolean;
}

export const DEFAULT_MAX_ATTEMPTS = 5;

export function actorId(actor: Actor): string | null {
  return actor.kind === 'system' ? null : actor.userId;
}

export function pass(key: string): GuardResult {
  return { ok: true, key };
}

export function fail(key: string, message: string, code?: TransitionErrorCode): GuardResult {
  return code ? { ok: false, key, message, code } : { ok: false, key, message };
}

/** Boolean-fact guard: true passes; false or missing fails closed. */
export function factGuard<F>(
  key: string,
  read: (facts: F) => boolean | undefined | null,
  message: string,
  code?: TransitionErrorCode,
): GuardFn<F> {
  return (facts) => (read(facts) === true ? pass(key) : fail(key, message, code));
}

export function hasText(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function fromPolicy(key: string, check: PolicyCheck | undefined, fallback: string): GuardResult {
  if (!check) return fail(key, fallback, 'FORBIDDEN');
  if (check.ok) return pass(key);
  const code: TransitionErrorCode =
    check.code === 'NOT_FOUND' || check.code === 'RESTRICTED_SOURCE' || !check.code
      ? 'FORBIDDEN'
      : check.code;
  return fail(key, check.reason ?? fallback, code);
}

/** Compare ISO date-times as instants. Unparseable input returns null (callers fail closed). */
export function instantAtOrAfter(a: string | null | undefined, b: string | null | undefined): boolean | null {
  if (!a || !b) return null;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return ta >= tb;
}

const HASH = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Shared guards (also used by Market Expansion lifecycles)
// ---------------------------------------------------------------------------

export const COMMON_GUARDS = {
  interactive_human: ((_f: WorkflowFacts, actor: Actor) =>
    actor.kind === 'human' && actor.interactive
      ? pass('interactive_human')
      : fail(
          'interactive_human',
          'This action needs your own signed-in session.',
          'AGENT_IDENTITY_FORBIDDEN',
        )) as GuardFn<WorkflowFacts>,

  rationale_present: factGuard<WorkflowFacts>(
    'rationale_present',
    (f) => hasText(f.rationale),
    'Add a rationale.',
  ),

  approval_effective: ((f: WorkflowFacts) => {
    switch (f.approval) {
      case 'effective':
        return pass('approval_effective');
      case 'invalidated':
        return fail(
          'approval_effective',
          'The approval no longer applies after a material change.',
          'APPROVAL_INVALIDATED',
        );
      case 'expired':
        return fail('approval_effective', 'The approval expired unused.', 'APPROVAL_EXPIRED');
      default:
        return fail('approval_effective', 'No effective approval authorizes this.');
    }
  }) as GuardFn<WorkflowFacts>,

  blocking_conditions_met: factGuard<WorkflowFacts>(
    'blocking_conditions_met',
    (f) => f.blockingConditionsMet,
    'A condition that blocks execution is still open.',
  ),

  connector_connected: ((f: WorkflowFacts) =>
    f.connector === 'connected'
      ? pass('connector_connected')
      : fail(
          'connector_connected',
          f.connector === 'expired'
            ? 'The task tool connection expired. Reconnect it or export CSV instead.'
            : 'The task tool connection is not usable.',
          'CONNECTOR_UNAVAILABLE',
        )) as GuardFn<WorkflowFacts>,
} as const;

// ---------------------------------------------------------------------------
// Gate request + snapshot guards
// ---------------------------------------------------------------------------

export const GATE_GUARDS = {
  ...COMMON_GUARDS,

  actor_is_case_owner_or_delegate: ((f: WorkflowFacts, actor: Actor) => {
    const uid = actorId(actor);
    return uid !== null && (uid === f.caseOwnerId || (f.delegateIds ?? []).includes(uid))
      ? pass('actor_is_case_owner_or_delegate')
      : fail(
          'actor_is_case_owner_or_delegate',
          'Only the case owner or a delegate can submit this request.',
          'FORBIDDEN',
        );
  }) as GuardFn<WorkflowFacts>,

  actor_is_package_author: ((f: WorkflowFacts, actor: Actor) => {
    const uid = actorId(actor);
    return uid !== null && uid === f.packageAuthorId
      ? pass('actor_is_package_author')
      : fail('actor_is_package_author', 'Only the package author can withdraw this request.', 'FORBIDDEN');
  }) as GuardFn<WorkflowFacts>,

  preconditions_met: ((f: WorkflowFacts) => {
    if (!f.preconditions) return fail('preconditions_met', 'Preconditions have not been checked.');
    const unmet = f.preconditions.filter((p) => !p.met);
    if (unmet.length === 0) return pass('preconditions_met');
    const parts = unmet.map((p) => p.detail ?? p.label ?? p.key);
    return fail('preconditions_met', `Preconditions unmet: ${parts.join('; ')}`);
  }) as GuardFn<WorkflowFacts>,

  snapshot_frozen: factGuard<WorkflowFacts>(
    'snapshot_frozen',
    (f) => !!f.snapshot && f.snapshot.status === 'current' && HASH.test(f.snapshot.hash),
    'The decision snapshot has not been frozen and hashed.',
  ),

  snapshot_current: ((f: WorkflowFacts) => {
    const s = f.snapshot;
    if (!s || s.status !== 'current') {
      return fail(
        'snapshot_current',
        'This snapshot is out of date. Approval is disabled until it is refreshed.',
        'SNAPSHOT_STALE',
      );
    }
    if (f.decision && f.decision.snapshotId !== s.id) {
      return fail(
        'snapshot_current',
        'You decided on a snapshot that is no longer the current one.',
        'SNAPSHOT_STALE',
      );
    }
    return pass('snapshot_current');
  }) as GuardFn<WorkflowFacts>,

  hash_matches: factGuard<WorkflowFacts>(
    'hash_matches',
    (f) => !!f.snapshot && !!f.decision && f.decision.snapshotHash === f.snapshot.hash,
    'The package you read differs from the current snapshot. Reload before deciding.',
    'SNAPSHOT_HASH_MISMATCH',
  ),

  authority_covers_gate_bu_amount: ((f: WorkflowFacts) =>
    fromPolicy(
      'authority_covers_gate_bu_amount',
      f.decisionChecks?.authority,
      'Authority could not be checked.',
    )) as GuardFn<WorkflowFacts>,

  not_author_or_owner: ((f: WorkflowFacts) =>
    fromPolicy(
      'not_author_or_owner',
      f.decisionChecks?.notSelf,
      'Self-approval could not be ruled out.',
    )) as GuardFn<WorkflowFacts>,

  not_conflicted: ((f: WorkflowFacts) =>
    fromPolicy(
      'not_conflicted',
      f.decisionChecks?.notConflicted,
      'Conflict of interest could not be ruled out.',
    )) as GuardFn<WorkflowFacts>,

  is_designated_approver: ((f: WorkflowFacts) =>
    fromPolicy(
      'is_designated_approver',
      f.decisionChecks?.designatedApprover,
      'You are not a designated approver for this gate.',
    )) as GuardFn<WorkflowFacts>,

  required_signoffs_present: ((f: WorkflowFacts) => {
    if (!f.requiredSignOffs)
      return fail('required_signoffs_present', 'Required sign-offs have not been checked.');
    const missing = f.requiredSignOffs.filter((s) => !s.present).map((s) => s.area);
    return missing.length === 0
      ? pass('required_signoffs_present')
      : fail('required_signoffs_present', `Required sign-off missing: ${missing.join(', ')}.`);
  }) as GuardFn<WorkflowFacts>,

  conditions_have_owner: ((f: WorkflowFacts) => {
    const conds = f.decision?.conditions ?? [];
    if (conds.length === 0) return fail('conditions_have_owner', 'Add at least one condition.');
    return conds.every((c) => hasText(c.ownerId))
      ? pass('conditions_have_owner')
      : fail('conditions_have_owner', 'Every condition needs an owner.');
  }) as GuardFn<WorkflowFacts>,

  material_change_affects_snapshot: factGuard<WorkflowFacts>(
    'material_change_affects_snapshot',
    (f) => f.materialChange?.affectsSnapshot,
    'No material change affects this snapshot.',
  ),

  newer_snapshot_created: factGuard<WorkflowFacts>(
    'newer_snapshot_created',
    (f) => f.newerSnapshotCreated,
    'No newer snapshot exists.',
  ),

  expiry_passed: factGuard<WorkflowFacts>(
    'expiry_passed',
    (f) => instantAtOrAfter(f.now, f.expiresAt),
    'The approval has not reached its expiry time.',
  ),

  not_yet_executed: factGuard<WorkflowFacts>(
    'not_yet_executed',
    (f) => (f.executed === undefined ? undefined : !f.executed),
    'The approval has already been used, so it does not expire.',
  ),
} as const;

// ---------------------------------------------------------------------------
// Task sync guards
// ---------------------------------------------------------------------------

export const SYNC_GUARDS = {
  ...COMMON_GUARDS,
  preview_current: factGuard<WorkflowFacts>(
    'preview_current',
    (f) => f.previewCurrent,
    'The plan changed or the preview expired. Preview again.',
  ),
  owner_assigned: factGuard<WorkflowFacts>(
    'owner_assigned',
    (f) => f.ownerAssigned,
    'Assign an owner first.',
  ),
  external_key_returned: factGuard<WorkflowFacts>(
    'external_key_returned',
    (f) => hasText(f.externalKey),
    'The task tool did not return a key, so the task is not confirmed.',
  ),
  attempts_remaining: factGuard<WorkflowFacts>(
    'attempts_remaining',
    (f) => (f.attempts === undefined ? undefined : f.attempts < (f.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)),
    'No attempts remain.',
  ),
} as const;

// ---------------------------------------------------------------------------
// Analysis run guards
// ---------------------------------------------------------------------------

export const RUN_GUARDS = {
  tenant_concurrency_available: factGuard<WorkflowFacts>(
    'tenant_concurrency_available',
    (f) => f.tenantConcurrencyAvailable,
    'Other analyses are running. This one is queued.',
  ),
  budget_available: factGuard<WorkflowFacts>(
    'budget_available',
    (f) => f.budgetAvailable,
    'The analysis budget is used up.',
    'BUDGET_EXHAUSTED',
  ),
  actor_is_requester: ((f: WorkflowFacts, actor: Actor) =>
    actorId(actor) !== null && actorId(actor) === f.requesterId
      ? pass('actor_is_requester')
      : fail(
          'actor_is_requester',
          'Only the person who started this analysis can answer.',
          'FORBIDDEN',
        )) as GuardFn<WorkflowFacts>,
  actor_is_requester_or_owner: ((f: WorkflowFacts, actor: Actor) => {
    const uid = actorId(actor);
    return uid !== null && (uid === f.requesterId || uid === f.caseOwnerId)
      ? pass('actor_is_requester_or_owner')
      : fail(
          'actor_is_requester_or_owner',
          'Only the requester or the case owner can stop this analysis.',
          'FORBIDDEN',
        );
  }) as GuardFn<WorkflowFacts>,
  output_schema_valid: factGuard<WorkflowFacts>(
    'output_schema_valid',
    (f) => f.outputSchemaValid,
    'The analysis output did not match its schema.',
  ),
  citations_valid: factGuard<WorkflowFacts>(
    'citations_valid',
    (f) => f.citationsValid,
    'Some citations could not be verified.',
  ),
  checkpoint_exists: factGuard<WorkflowFacts>(
    'checkpoint_exists',
    (f) => f.checkpointExists,
    'There is no saved checkpoint to resume from.',
  ),
} as const;
