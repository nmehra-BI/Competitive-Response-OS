/**
 * Runtime instances of the shared Growth OS machines over the FROZEN tables in ./machines.ts.
 * Usage (API command handler or worker):
 *
 *   const r = gateRequestMachine.apply('awaiting_decision', 'approve', actor, facts);
 *   if (!r.ok) throw problem(r.code, r.reasons);      // every failed guard, in order
 *   write(r.to); audit(r.auditAction); r.events.forEach(emitAnalytics); emitDomain(r.domainEvent);
 */
import type { GateRequestStatus, RunStatus, SnapshotStatus, SyncStatus } from '@growth-os/contracts';
import { GATE_GUARDS, RUN_GUARDS, SYNC_GUARDS, type WorkflowFacts } from './guards';
import {
  GATE_REQUEST_TRANSITIONS,
  RUN_TRANSITIONS,
  SNAPSHOT_TRANSITIONS,
  SYNC_TRANSITIONS,
  type GateCommand,
  type RunCommand,
  type SnapshotCommand,
  type SyncCommand,
} from './machines';
import { createStateMachine, type NextAction, type StateMachine } from './state-machine';

const GATE_NEXT: Partial<Record<GateRequestStatus, NextAction>> = {
  draft: { key: 'submit', label: 'Submit for decision', owner: 'case_owner' },
  awaiting_decision: { key: 'decide', label: 'Awaiting decision', owner: 'approver' },
  stale: { key: 'refresh', label: 'Refresh snapshot', owner: 'case_owner' },
  returned_for_revision: { key: 'resubmit', label: 'Revise and resubmit', owner: 'case_owner' },
  approved: { key: 'execute', label: 'Proceed within the approved scope', owner: 'case_owner' },
  approved_with_conditions: {
    key: 'meet_conditions',
    label: 'Meet the blocking conditions before execution',
    owner: 'case_owner',
  },
  invalidated: {
    key: 'new_request',
    label: 'The approval no longer applies. Prepare a new request.',
    owner: 'case_owner',
  },
  expired: {
    key: 'new_request',
    label: 'The approval expired unused. Prepare a new request.',
    owner: 'case_owner',
  },
};

export const gateRequestMachine: StateMachine<GateRequestStatus, GateCommand, WorkflowFacts> =
  createStateMachine('gate_request', GATE_REQUEST_TRANSITIONS, GATE_GUARDS, {
    nextActions: GATE_NEXT,
    domainEvent: (c) => {
      switch (c) {
        case 'submit':
        case 'refresh':
        case 'resubmit':
          return 'gate.submitted';
        case 'mark_stale':
          return 'gate.snapshot_stale';
        case 'approve':
        case 'approve_with_conditions':
        case 'return_for_revision':
        case 'not_approved':
          return 'gate.decided';
        case 'invalidate':
          return 'gate.approval_invalidated';
        case 'expire':
          return 'gate.approval_expired';
        default:
          return null;
      }
    },
  });

export const snapshotMachine: StateMachine<SnapshotStatus, SnapshotCommand, WorkflowFacts> =
  createStateMachine('decision_snapshot', SNAPSHOT_TRANSITIONS, GATE_GUARDS, {
    nextActions: { stale: { key: 'refresh', label: 'Refresh snapshot', owner: 'case_owner' } },
  });

export const syncMachine: StateMachine<SyncStatus, SyncCommand, WorkflowFacts> = createStateMachine(
  'task_sync',
  SYNC_TRANSITIONS,
  SYNC_GUARDS,
  {
    domainEvent: () => 'task_sync.status_changed',
    nextActions: {
      not_sent: { key: 'preview', label: 'Preview tasks', owner: 'pilot_owner' },
      in_preview: { key: 'send', label: 'Create tasks', owner: 'pilot_owner' },
      sending: { key: 'wait', label: 'Sending…', owner: 'system' },
      checking: { key: 'reconcile', label: 'Checking', owner: 'system' },
      retry_scheduled: { key: 'retry', label: 'Retry scheduled', owner: 'system' },
      failed: {
        key: 'manual_retry',
        label: 'Fix the problem, then retry the failed task',
        owner: 'pilot_owner',
      },
      paused_approval_changed: {
        key: 'await_approval',
        label: 'Paused — approval changed',
        owner: 'case_owner',
      },
      paused_connector: {
        key: 'reconnect',
        label: 'Reconnect the task tool or export CSV instead',
        owner: 'pilot_owner',
      },
    },
  },
);

export const runMachine: StateMachine<RunStatus, RunCommand, WorkflowFacts> = createStateMachine(
  'analysis_run',
  RUN_TRANSITIONS,
  RUN_GUARDS,
  {
    domainEvent: () => 'analysis_run.status_changed',
    nextActions: {
      waiting_for_input: { key: 'answer', label: 'Needs your input', owner: 'requester' },
      awaiting_approval: { key: 'approve_budget', label: 'Needs your input', owner: 'requester' },
      partial: { key: 'resume', label: 'Partial results', owner: 'requester' },
      failed: { key: 'resume', label: 'Stopped — your work is saved', owner: 'requester' },
    },
  },
);
