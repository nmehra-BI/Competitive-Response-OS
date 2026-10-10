/**
 * FROZEN transition tables for shared Growth OS primitives: gate request, snapshot, external task
 * sync, analysis run. Diagrams: docs/market-expansion/architecture/ARCHITECTURE.md §8.
 */
import type { GateRequestStatus, RunStatus, SnapshotStatus, SyncStatus } from '@growth-os/contracts';
import type { Transition } from './state-machine';

// ---------------------------------------------------------------------------
// Gate request
// ---------------------------------------------------------------------------

export type GateCommand =
  | 'submit' // freeze snapshot vN and request a decision
  | 'mark_stale' // material input changed before decision
  | 'refresh' // build vN+1 from current committed inputs
  | 'approve'
  | 'approve_with_conditions'
  | 'return_for_revision'
  | 'not_approved'
  | 'withdraw'
  | 'resubmit' // after return: new snapshot version
  | 'invalidate' // material change after approval
  | 'expire'; // approval unused by expires_at

export const GATE_REQUEST_TRANSITIONS: readonly Transition<GateRequestStatus, GateCommand>[] = [
  {
    from: 'draft',
    command: 'submit',
    to: 'awaiting_decision',
    by: 'human',
    guards: ['actor_is_case_owner_or_delegate', 'preconditions_met', 'snapshot_frozen'],
    emits: ['gate_submitted'],
  },
  {
    from: 'awaiting_decision',
    command: 'mark_stale',
    to: 'stale',
    by: 'system',
    guards: ['material_change_affects_snapshot'],
  },
  {
    from: 'stale',
    command: 'refresh',
    to: 'awaiting_decision',
    by: 'human',
    guards: ['actor_is_case_owner_or_delegate', 'preconditions_met', 'snapshot_frozen'],
    emits: ['gate_submitted'],
    note: 'old snapshot → superseded',
  },
  {
    from: 'awaiting_decision',
    command: 'approve',
    to: 'approved',
    by: 'human',
    guards: [
      'interactive_human',
      'snapshot_current',
      'hash_matches',
      'authority_covers_gate_bu_amount',
      'not_author_or_owner',
      'not_conflicted',
      'required_signoffs_present',
    ],
    emits: ['gate_approved'],
  },
  {
    from: 'awaiting_decision',
    command: 'approve_with_conditions',
    to: 'approved_with_conditions',
    by: 'human',
    guards: [
      'interactive_human',
      'snapshot_current',
      'hash_matches',
      'authority_covers_gate_bu_amount',
      'not_author_or_owner',
      'not_conflicted',
      'required_signoffs_present',
      'conditions_have_owner',
    ],
    emits: ['gate_approved'],
  },
  {
    from: 'awaiting_decision',
    command: 'return_for_revision',
    to: 'returned_for_revision',
    by: 'human',
    guards: ['interactive_human', 'snapshot_current', 'is_designated_approver', 'rationale_present'],
    emits: ['gate_returned'],
  },
  {
    from: 'awaiting_decision',
    command: 'not_approved',
    to: 'not_approved',
    by: 'human',
    guards: ['interactive_human', 'snapshot_current', 'is_designated_approver', 'rationale_present'],
    emits: ['gate_returned'],
  },
  {
    from: ['awaiting_decision', 'stale', 'draft'],
    command: 'withdraw',
    to: 'withdrawn',
    by: 'human',
    guards: ['actor_is_package_author'],
  },
  {
    from: 'returned_for_revision',
    command: 'resubmit',
    to: 'awaiting_decision',
    by: 'human',
    guards: ['actor_is_case_owner_or_delegate', 'preconditions_met', 'snapshot_frozen'],
    emits: ['gate_submitted'],
  },
  {
    from: ['approved', 'approved_with_conditions'],
    command: 'invalidate',
    to: 'invalidated',
    by: 'system',
    guards: ['material_change_affects_snapshot'],
    emits: ['approval_invalidated'],
    note: 'pause unsent outbox rows; executed writes preserved',
  },
  {
    from: ['approved', 'approved_with_conditions'],
    command: 'expire',
    to: 'expired',
    by: 'system',
    guards: ['expiry_passed', 'not_yet_executed'],
  },
];

/** Abstain and delegate are recorded as Approval rows but do not change the gate request status. */
export const NON_TRANSITION_DISPOSITIONS = ['abstain', 'delegate'] as const;

// ---------------------------------------------------------------------------
// Decision snapshot
// ---------------------------------------------------------------------------

export type SnapshotCommand = 'mark_stale' | 'supersede';
export const SNAPSHOT_TRANSITIONS: readonly Transition<SnapshotStatus, SnapshotCommand>[] = [
  {
    from: 'current',
    command: 'mark_stale',
    to: 'stale',
    by: 'system',
    guards: ['material_change_affects_snapshot'],
  },
  {
    from: ['current', 'stale'],
    command: 'supersede',
    to: 'superseded',
    by: 'system',
    guards: ['newer_snapshot_created'],
  },
];

// ---------------------------------------------------------------------------
// External task sync (one row per task × destination). Honest sync: "Confirmed" only with a key.
// ---------------------------------------------------------------------------

export type SyncCommand =
  | 'preview'
  | 'enqueue'
  | 'send_ok'
  | 'send_timeout' // ambiguous: may have succeeded
  | 'reconcile_found'
  | 'reconcile_not_found'
  | 'send_failed_retryable' // 5xx, rate limit
  | 'send_failed_permanent' // permission, validation
  | 'retry_due'
  | 'manual_retry'
  | 'pause_approval_changed'
  | 'pause_connector'
  | 'resume';

export const SYNC_TRANSITIONS: readonly Transition<SyncStatus, SyncCommand>[] = [
  { from: 'not_sent', command: 'preview', to: 'in_preview', by: 'human', guards: ['approval_effective'] },
  {
    from: ['in_preview', 'not_sent'],
    command: 'enqueue',
    to: 'sending',
    by: 'human',
    guards: [
      'interactive_human',
      'preview_current',
      'approval_effective',
      'blocking_conditions_met',
      'owner_assigned',
    ],
  },
  {
    // A write in flight when a pause landed is still recorded once the tool returns its key
    // (CR-WS6-1, D-083): "sent preserved" — never-rule 9 still needs the key.
    from: ['sending', 'paused_approval_changed', 'paused_connector'],
    command: 'send_ok',
    to: 'confirmed',
    by: 'system',
    guards: ['external_key_returned'],
    emits: ['external_task_confirmed'],
  },
  { from: 'sending', command: 'send_timeout', to: 'checking', by: 'system', guards: [] },
  {
    // An ambiguous send paused while Checking is searched once; if the issue exists it is Confirmed.
    from: ['checking', 'paused_approval_changed', 'paused_connector'],
    command: 'reconcile_found',
    to: 'confirmed',
    by: 'system',
    guards: ['external_key_returned'],
    emits: ['external_task_confirmed'],
  },
  {
    from: 'checking',
    command: 'reconcile_not_found',
    to: 'retry_scheduled',
    by: 'system',
    guards: ['attempts_remaining'],
  },
  {
    from: 'sending',
    command: 'send_failed_retryable',
    to: 'retry_scheduled',
    by: 'system',
    guards: ['attempts_remaining'],
  },
  {
    from: ['sending', 'checking', 'retry_scheduled'],
    command: 'send_failed_permanent',
    to: 'failed',
    by: 'system',
    guards: [],
    emits: ['external_task_failed'],
    note: 'also when attempts are exhausted',
  },
  {
    from: 'retry_scheduled',
    command: 'retry_due',
    to: 'sending',
    by: 'system',
    guards: ['approval_effective', 'connector_connected'],
  },
  {
    from: 'failed',
    command: 'manual_retry',
    to: 'sending',
    by: 'human',
    guards: ['interactive_human', 'approval_effective', 'connector_connected'],
    note: 'same idempotency key',
  },
  {
    from: ['not_sent', 'in_preview', 'sending', 'retry_scheduled', 'checking'],
    command: 'pause_approval_changed',
    to: 'paused_approval_changed',
    by: 'system',
    guards: [],
  },
  {
    from: ['sending', 'retry_scheduled', 'checking'],
    command: 'pause_connector',
    to: 'paused_connector',
    by: 'system',
    guards: [],
  },
  {
    from: ['paused_approval_changed', 'paused_connector'],
    command: 'resume',
    to: 'retry_scheduled',
    by: 'system',
    guards: ['approval_effective', 'connector_connected'],
    note: 'reconcile first: a pause may follow an ambiguous send',
  },
];

// ---------------------------------------------------------------------------
// Analysis run (PRD §8). Separate from case stage.
// ---------------------------------------------------------------------------

export type RunCommand =
  | 'start'
  | 'ask_input'
  | 'input_received'
  | 'await_approval'
  | 'approval_received'
  | 'complete'
  | 'complete_partial' // some steps failed, or budget reached with committed results
  | 'fail'
  | 'cancel'
  | 'resume';

export const RUN_TRANSITIONS: readonly Transition<RunStatus, RunCommand>[] = [
  {
    from: 'queued',
    command: 'start',
    to: 'running',
    by: 'system',
    guards: ['tenant_concurrency_available', 'budget_available'],
  },
  { from: 'running', command: 'ask_input', to: 'waiting_for_input', by: 'system', guards: [] },
  {
    from: 'waiting_for_input',
    command: 'input_received',
    to: 'running',
    by: 'human',
    guards: ['actor_is_requester'],
  },
  {
    from: 'running',
    command: 'await_approval',
    to: 'awaiting_approval',
    by: 'system',
    guards: [],
    note: 'e.g. extra budget or access request needs a human',
  },
  {
    from: 'awaiting_approval',
    command: 'approval_received',
    to: 'running',
    by: 'human',
    guards: ['actor_is_requester'],
  },
  {
    from: 'running',
    command: 'complete',
    to: 'completed',
    by: 'system',
    guards: ['output_schema_valid', 'citations_valid'],
  },
  { from: 'running', command: 'complete_partial', to: 'partial', by: 'system', guards: [] },
  { from: ['running', 'queued'], command: 'fail', to: 'failed', by: 'system', guards: [] },
  {
    from: ['queued', 'running', 'waiting_for_input', 'awaiting_approval'],
    command: 'cancel',
    to: 'cancelled',
    by: 'human',
    guards: ['actor_is_requester_or_owner'],
  },
  {
    from: ['partial', 'failed'],
    command: 'resume',
    to: 'queued',
    by: 'human',
    guards: ['checkpoint_exists', 'budget_available'],
    note: 'resumes from last committed checkpoint',
  },
];
