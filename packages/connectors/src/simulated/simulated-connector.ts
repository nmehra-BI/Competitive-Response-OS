/**
 * Simulated task tool (D-020). Behaves like a remote Jira project but stores issues in the `sim`
 * schema so state survives worker restarts — required to test "timeout after success".
 *
 * Fault injection (rules in sim.fault_rule, set via PUT /dev/simulator/faults or tests):
 *   timeout_after_success  create the issue, then throw ConnectorError('timeout_ambiguous')
 *   http_5xx               throw ConnectorError('transient') without creating
 *   permission_denied      throw ConnectorError('permission_denied') (e.g. assignee not in project)
 *   token_expired          throw ConnectorError('token_expired') for every call until reconnected
 *   rate_limited           throw ConnectorError('rate_limited', …, retryAfterMs)
 * Matching: titleContains | assignee | nthCall; `remaining` decrements per hit.
 *
 * Invariant the duplicate-write suite checks: for any sequence of faults, retries and worker
 * crashes, sim.external_issue has at most one row per idempotency key (enforced by a UNIQUE index).
 */
import type {
  ConnectorHealth,
  ExternalTaskInput,
  ExternalTaskRef,
  PreviewItemResult,
  TaskConnector,
} from '../task-connector';

/** Storage port so the simulator can run against Postgres (sim schema) or memory in unit tests. */
export interface SimStore {
  findByKey(connectionId: string, idempotencyKey: string): Promise<ExternalTaskRef | null>;
  insertIssue(connectionId: string, input: ExternalTaskInput): Promise<ExternalTaskRef>; // allocates PROJECT-n
  nextFault(
    connectionId: string,
    input: ExternalTaskInput | null,
    operation: 'create' | 'find' | 'preview' | 'health',
  ): Promise<SimFaultMode | null>;
  projectMembers(connectionId: string, project: string): Promise<string[]>;
  logCall(
    connectionId: string,
    operation: string,
    idempotencyKey: string | null,
    outcome: string,
  ): Promise<void>;
}

export type SimFaultMode =
  'timeout_after_success' | 'http_5xx' | 'permission_denied' | 'token_expired' | 'rate_limited';

/** TODO(WS6 connector/outbox): implement against SimStore; unit-test each fault mode. */
export function createSimulatedConnector(_connectionId: string, _store: SimStore): TaskConnector {
  return {
    provider: 'jira_simulated',
    health: async (): Promise<ConnectorHealth> => {
      throw new Error('TODO(WS6): simulated health');
    },
    preview: async (): Promise<PreviewItemResult[]> => {
      throw new Error('TODO(WS6): simulated preview');
    },
    createTask: async (): Promise<ExternalTaskRef> => {
      throw new Error('TODO(WS6): simulated createTask');
    },
    findByIdempotencyKey: async (): Promise<ExternalTaskRef | null> => {
      throw new Error('TODO(WS6): simulated findByIdempotencyKey');
    },
  };
}
