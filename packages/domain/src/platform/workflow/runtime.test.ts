/**
 * Exhaustive transition tests for the shared machines. The ALLOWED lists are written by hand from
 * ARCHITECTURE.md §8.3, §8.5, §8.6 (not derived from the tables).
 */
import { describe, expect, it } from 'vitest';
import { GateRequestStatus, RunStatus, SnapshotStatus, SyncStatus } from '@growth-os/contracts';
import type { GateDecisionChecks } from '../policy/policy-engine';
import type { WorkflowFacts } from './guards';
import { describeMachine, KIT_HUMAN, KIT_USER, type AllowedTransition } from './machine-test-kit';
import type { GateCommand, RunCommand, SnapshotCommand, SyncCommand } from './machines';
import { gateRequestMachine, runMachine, snapshotMachine, syncMachine } from './runtime';

const HASH = 'a'.repeat(64);
const OK_CHECKS: GateDecisionChecks = {
  designatedApprover: { ok: true },
  authority: { ok: true },
  notSelf: { ok: true },
  notConflicted: { ok: true },
  authorityGrantId: 'grant-1',
};

const PASS: WorkflowFacts = {
  caseOwnerId: KIT_USER,
  packageAuthorId: KIT_USER,
  requesterId: KIT_USER,
  preconditions: [{ key: 'k', met: true }],
  snapshot: { id: 'snap-4', hash: HASH, status: 'current' },
  decision: { snapshotId: 'snap-4', snapshotHash: HASH, conditions: [{ ownerId: 'jonas' }] },
  decisionChecks: OK_CHECKS,
  requiredSignOffs: [{ area: 'finance', present: true }],
  rationale: 'Thresholds met.',
  materialChange: { affectsSnapshot: true },
  newerSnapshotCreated: true,
  expiresAt: '2026-12-11T23:59:00+01:00',
  now: '2026-12-12T00:15:00+01:00',
  executed: false,
  approval: 'effective',
  previewCurrent: true,
  blockingConditionsMet: true,
  ownerAssigned: true,
  externalKey: 'PIL-11',
  attempts: 1,
  connector: 'connected',
  tenantConcurrencyAvailable: true,
  budgetAvailable: true,
  outputSchemaValid: true,
  citationsValid: true,
  checkpointExists: true,
};

const FAIL: Record<string, Partial<WorkflowFacts>> = {
  actor_is_case_owner_or_delegate: { caseOwnerId: 'someone-else', delegateIds: [] },
  actor_is_package_author: { packageAuthorId: 'someone-else' },
  preconditions_met: { preconditions: [{ key: 'k', met: false, detail: 'K missing' }] },
  snapshot_frozen: { snapshot: null },
  snapshot_current: { snapshot: { id: 'snap-4', hash: HASH, status: 'stale' } },
  hash_matches: { decision: { snapshotId: 'snap-4', snapshotHash: 'b'.repeat(64), conditions: [] } },
  authority_covers_gate_bu_amount: {
    decisionChecks: { ...OK_CHECKS, authority: { ok: false, code: 'AUTHORITY_INSUFFICIENT', reason: 'gap' } },
  },
  not_author_or_owner: {
    decisionChecks: {
      ...OK_CHECKS,
      notSelf: { ok: false, code: 'SELF_APPROVAL_PROHIBITED', reason: 'self' },
    },
  },
  not_conflicted: {
    decisionChecks: { ...OK_CHECKS, notConflicted: { ok: false, code: 'CONFLICT_OF_INTEREST', reason: 'c' } },
  },
  is_designated_approver: {
    decisionChecks: { ...OK_CHECKS, designatedApprover: { ok: false, code: 'FORBIDDEN', reason: 'no' } },
  },
  required_signoffs_present: { requiredSignOffs: [{ area: 'specialist', present: false }] },
  conditions_have_owner: {
    decision: { snapshotId: 'snap-4', snapshotHash: HASH, conditions: [{ ownerId: null }] },
  },
  rationale_present: { rationale: '  ' },
  material_change_affects_snapshot: { materialChange: { affectsSnapshot: false } },
  newer_snapshot_created: { newerSnapshotCreated: false },
  expiry_passed: { now: '2026-12-11T12:00:00+01:00' },
  not_yet_executed: { executed: true },
  approval_effective: { approval: 'invalidated' },
  preview_current: { previewCurrent: false },
  blocking_conditions_met: { blockingConditionsMet: false },
  owner_assigned: { ownerAssigned: false },
  external_key_returned: { externalKey: null },
  attempts_remaining: { attempts: 5 },
  connector_connected: { connector: 'expired' },
  tenant_concurrency_available: { tenantConcurrencyAvailable: false },
  budget_available: { budgetAvailable: false },
  actor_is_requester: { requesterId: 'someone-else' },
  actor_is_requester_or_owner: { requesterId: 'x', caseOwnerId: 'y' },
  output_schema_valid: { outputSchemaValid: false },
  citations_valid: { citationsValid: false },
  checkpoint_exists: { checkpointExists: false },
};

const GATE_ALLOWED: AllowedTransition<GateRequestStatus, GateCommand>[] = [
  ['draft', 'submit', 'awaiting_decision', 'human'],
  ['awaiting_decision', 'mark_stale', 'stale', 'system'],
  ['stale', 'refresh', 'awaiting_decision', 'human'],
  ['awaiting_decision', 'approve', 'approved', 'human'],
  ['awaiting_decision', 'approve_with_conditions', 'approved_with_conditions', 'human'],
  ['awaiting_decision', 'return_for_revision', 'returned_for_revision', 'human'],
  ['awaiting_decision', 'not_approved', 'not_approved', 'human'],
  ['draft', 'withdraw', 'withdrawn', 'human'],
  ['awaiting_decision', 'withdraw', 'withdrawn', 'human'],
  ['stale', 'withdraw', 'withdrawn', 'human'],
  ['returned_for_revision', 'resubmit', 'awaiting_decision', 'human'],
  ['approved', 'invalidate', 'invalidated', 'system'],
  ['approved_with_conditions', 'invalidate', 'invalidated', 'system'],
  ['approved', 'expire', 'expired', 'system'],
  ['approved_with_conditions', 'expire', 'expired', 'system'],
];
const GATE_COMMANDS: GateCommand[] = [
  'submit',
  'mark_stale',
  'refresh',
  'approve',
  'approve_with_conditions',
  'return_for_revision',
  'not_approved',
  'withdraw',
  'resubmit',
  'invalidate',
  'expire',
];

describeMachine({
  machine: gateRequestMachine,
  states: GateRequestStatus.options,
  commands: GATE_COMMANDS,
  allowed: GATE_ALLOWED,
  passFacts: PASS,
  failFacts: FAIL,
  actorOnlyGuards: ['interactive_human'],
});

const SNAPSHOT_ALLOWED: AllowedTransition<SnapshotStatus, SnapshotCommand>[] = [
  ['current', 'mark_stale', 'stale', 'system'],
  ['current', 'supersede', 'superseded', 'system'],
  ['stale', 'supersede', 'superseded', 'system'],
];
describeMachine({
  machine: snapshotMachine,
  states: SnapshotStatus.options,
  commands: ['mark_stale', 'supersede'],
  allowed: SNAPSHOT_ALLOWED,
  passFacts: PASS,
  failFacts: FAIL,
});

const SYNC_ALLOWED: AllowedTransition<SyncStatus, SyncCommand>[] = [
  ['not_sent', 'preview', 'in_preview', 'human'],
  ['in_preview', 'enqueue', 'sending', 'human'],
  ['not_sent', 'enqueue', 'sending', 'human'],
  ['sending', 'send_ok', 'confirmed', 'system'],
  ['sending', 'send_timeout', 'checking', 'system'],
  ['checking', 'reconcile_found', 'confirmed', 'system'],
  ['checking', 'reconcile_not_found', 'retry_scheduled', 'system'],
  ['sending', 'send_failed_retryable', 'retry_scheduled', 'system'],
  ['sending', 'send_failed_permanent', 'failed', 'system'],
  ['checking', 'send_failed_permanent', 'failed', 'system'],
  ['retry_scheduled', 'send_failed_permanent', 'failed', 'system'],
  ['retry_scheduled', 'retry_due', 'sending', 'system'],
  ['failed', 'manual_retry', 'sending', 'human'],
  ['not_sent', 'pause_approval_changed', 'paused_approval_changed', 'system'],
  ['in_preview', 'pause_approval_changed', 'paused_approval_changed', 'system'],
  ['sending', 'pause_approval_changed', 'paused_approval_changed', 'system'],
  ['retry_scheduled', 'pause_approval_changed', 'paused_approval_changed', 'system'],
  ['checking', 'pause_approval_changed', 'paused_approval_changed', 'system'],
  ['sending', 'pause_connector', 'paused_connector', 'system'],
  ['retry_scheduled', 'pause_connector', 'paused_connector', 'system'],
  ['checking', 'pause_connector', 'paused_connector', 'system'],
  ['paused_approval_changed', 'resume', 'retry_scheduled', 'system'],
  ['paused_connector', 'resume', 'retry_scheduled', 'system'],
];
describeMachine({
  machine: syncMachine,
  states: SyncStatus.options,
  commands: [
    'preview',
    'enqueue',
    'send_ok',
    'send_timeout',
    'reconcile_found',
    'reconcile_not_found',
    'send_failed_retryable',
    'send_failed_permanent',
    'retry_due',
    'manual_retry',
    'pause_approval_changed',
    'pause_connector',
    'resume',
  ],
  allowed: SYNC_ALLOWED,
  passFacts: PASS,
  failFacts: FAIL,
  actorOnlyGuards: ['interactive_human'],
});

const RUN_ALLOWED: AllowedTransition<RunStatus, RunCommand>[] = [
  ['queued', 'start', 'running', 'system'],
  ['running', 'ask_input', 'waiting_for_input', 'system'],
  ['waiting_for_input', 'input_received', 'running', 'human'],
  ['running', 'await_approval', 'awaiting_approval', 'system'],
  ['awaiting_approval', 'approval_received', 'running', 'human'],
  ['running', 'complete', 'completed', 'system'],
  ['running', 'complete_partial', 'partial', 'system'],
  ['running', 'fail', 'failed', 'system'],
  ['queued', 'fail', 'failed', 'system'],
  ['queued', 'cancel', 'cancelled', 'human'],
  ['running', 'cancel', 'cancelled', 'human'],
  ['waiting_for_input', 'cancel', 'cancelled', 'human'],
  ['awaiting_approval', 'cancel', 'cancelled', 'human'],
  ['partial', 'resume', 'queued', 'human'],
  ['failed', 'resume', 'queued', 'human'],
];
describeMachine({
  machine: runMachine,
  states: RunStatus.options,
  commands: [
    'start',
    'ask_input',
    'input_received',
    'await_approval',
    'approval_received',
    'complete',
    'complete_partial',
    'fail',
    'cancel',
    'resume',
  ],
  allowed: RUN_ALLOWED,
  passFacts: PASS,
  failFacts: FAIL,
});

describe('gate request: decision semantics', () => {
  it('approve returns the decided event, analytics and next action', () => {
    const r = gateRequestMachine.apply('awaiting_decision', 'approve_with_conditions', KIT_HUMAN, PASS);
    expect(r).toMatchObject({
      ok: true,
      to: 'approved_with_conditions',
      events: ['gate_approved'],
      domainEvent: 'gate.decided',
      auditAction: 'gate_request.approve_with_conditions',
      nextAction: { key: 'meet_conditions' },
    });
  });

  it('reports failures in the API check order, with the first one as the error code', () => {
    const r = gateRequestMachine.apply('awaiting_decision', 'approve', KIT_HUMAN, {
      ...PASS,
      snapshot: { id: 'snap-4', hash: HASH, status: 'stale' },
      decision: { snapshotId: 'snap-4', snapshotHash: 'b'.repeat(64) },
      decisionChecks: {
        ...OK_CHECKS,
        notSelf: {
          ok: false,
          code: 'SELF_APPROVAL_PROHIBITED',
          reason: 'You authored this package and cannot approve it.',
        },
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('SNAPSHOT_STALE');
    expect(r.failed.map((f) => f.key)).toEqual(['snapshot_current', 'hash_matches', 'not_author_or_owner']);
    expect(r.failed.map((f) => f.code)).toEqual([
      'SNAPSHOT_STALE',
      'SNAPSHOT_HASH_MISMATCH',
      'SELF_APPROVAL_PROHIBITED',
    ]);
  });

  it('a decision on an older snapshot id is stale even if that snapshot was current', () => {
    const r = gateRequestMachine.apply('awaiting_decision', 'approve', KIT_HUMAN, {
      ...PASS,
      decision: { snapshotId: 'snap-3', snapshotHash: HASH },
    });
    expect(r).toMatchObject({ ok: false, code: 'SNAPSHOT_STALE' });
  });

  it('a stale request cannot be approved at all (approval disabled until refresh)', () => {
    expect(gateRequestMachine.apply('stale', 'approve', KIT_HUMAN, PASS)).toMatchObject({
      ok: false,
      code: 'INVALID_TRANSITION',
    });
    expect(gateRequestMachine.nextActionFor('stale')).toMatchObject({ key: 'refresh' });
  });

  it('missing decision checks fail closed', () => {
    const r = gateRequestMachine.apply('awaiting_decision', 'approve', KIT_HUMAN, {
      ...PASS,
      decisionChecks: undefined,
    });
    expect(r.ok).toBe(false);
  });

  it('an approval already executed never expires', () => {
    const r = gateRequestMachine.apply(
      'approved',
      'expire',
      { kind: 'system', reason: 'timer' },
      {
        ...PASS,
        executed: true,
      },
    );
    expect(r).toMatchObject({ ok: false, code: 'PRECONDITIONS_UNMET' });
  });

  it('approval_effective maps invalidated and expired to their error codes', () => {
    const sys = { kind: 'system', reason: 'worker' } as const;
    expect(
      syncMachine.apply('retry_scheduled', 'retry_due', sys, { ...PASS, approval: 'expired' }),
    ).toMatchObject({
      ok: false,
      code: 'APPROVAL_EXPIRED',
    });
    expect(
      syncMachine.apply('retry_scheduled', 'retry_due', sys, { ...PASS, approval: 'invalidated' }),
    ).toMatchObject({ ok: false, code: 'APPROVAL_INVALIDATED' });
  });

  it('a sync is confirmed only with an external key', () => {
    const sys = { kind: 'system', reason: 'worker' } as const;
    expect(syncMachine.apply('sending', 'send_ok', sys, { ...PASS, externalKey: '' }).ok).toBe(false);
    expect(syncMachine.apply('sending', 'send_ok', sys, PASS)).toMatchObject({
      ok: true,
      to: 'confirmed',
      events: ['external_task_confirmed'],
    });
  });
});
