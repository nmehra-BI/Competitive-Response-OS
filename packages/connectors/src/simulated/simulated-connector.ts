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
 * Matching: titleContains | assignee | nthCall; `remaining` decrements per hit (see ./faults.ts).
 *
 * Invariant the duplicate-write suite checks: for any sequence of faults, retries and worker
 * crashes, sim.external_issue has at most one row per idempotency key (enforced by a UNIQUE index;
 * `createTask` also returns the existing issue for a key it has seen, like a Jira adapter that
 * searches its issue property before creating).
 */
import {
  ConnectorError,
  type ConnectorHealth,
  type ExternalTaskInput,
  type ExternalTaskRef,
  type PreviewItemResult,
  type TaskConnector,
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

export const SIMULATED_PROVIDER = 'jira_simulated';
export const SIM_BASE_URL = 'https://jira.simulated.invalid';
/** Retry-After the simulator advertises for `rate_limited`. */
export const SIM_RETRY_AFTER_MS = 1000;

export function simIssueUrl(key: string): string {
  return `${SIM_BASE_URL}/browse/${key}`;
}

const MESSAGES = {
  token_expired: 'The task tool rejected the access token (expired). Reconnect it or export CSV instead.',
  http_5xx: 'The task tool returned a server error (503).',
  rate_limited: 'The task tool is rate limiting requests.',
  timeout: 'The task tool did not answer in time; the issue may have been created.',
};

export function createSimulatedConnector(connectionId: string, store: SimStore): TaskConnector {
  const failConnection = async (operation: string, key: string | null): Promise<never> => {
    await store.logCall(connectionId, operation, key, 'token_expired');
    throw new ConnectorError('token_expired', MESSAGES.token_expired);
  };

  return {
    provider: SIMULATED_PROVIDER,

    async health(): Promise<ConnectorHealth> {
      const mode = await store.nextFault(connectionId, null, 'health');
      const checkedAt = new Date().toISOString();
      await store.logCall(connectionId, 'health', null, mode ?? 'ok');
      if (mode === 'token_expired') return { status: 'expired', checkedAt, message: MESSAGES.token_expired };
      return { status: 'connected', checkedAt, message: null };
    },

    async preview(items): Promise<PreviewItemResult[]> {
      const mode = await store.nextFault(connectionId, null, 'preview');
      if (mode === 'token_expired') return failConnection('preview', null);
      const members = new Map<string, string[]>();
      const out: PreviewItemResult[] = [];
      for (const item of items) {
        if (!members.has(item.project))
          members.set(item.project, await store.projectMembers(connectionId, item.project));
        const projectMembers = members.get(item.project)!;
        const problems: string[] = [];
        if (!item.assignee) problems.push(`no assignee is mapped for "${item.title}"`);
        else if (projectMembers.length > 0 && !projectMembers.includes(item.assignee))
          problems.push(`assignee ${item.assignee} is not a member of project ${item.project}`);
        out.push({
          title: item.title,
          assignee: item.assignee,
          fields: {
            project: item.project,
            issueType: item.issueType,
            ...(item.dueOn ? { dueOn: item.dueOn } : {}),
            labels: item.labels.join(', '),
          },
          problems,
        });
      }
      await store.logCall(connectionId, 'preview', null, `ok:${items.length}`);
      return out;
    },

    async createTask(input): Promise<ExternalTaskRef> {
      const key = input.idempotencyKey;
      const mode = await store.nextFault(connectionId, input, 'create');
      switch (mode) {
        case 'token_expired':
          return failConnection('create', key);
        case 'http_5xx':
          await store.logCall(connectionId, 'create', key, 'http_5xx');
          throw new ConnectorError('transient', MESSAGES.http_5xx);
        case 'rate_limited':
          await store.logCall(connectionId, 'create', key, 'rate_limited');
          throw new ConnectorError('rate_limited', MESSAGES.rate_limited, SIM_RETRY_AFTER_MS);
        case 'permission_denied':
          await store.logCall(connectionId, 'create', key, 'permission_denied');
          throw new ConnectorError(
            'permission_denied',
            `assignee ${input.assignee ?? '(none)'} is not a member of project ${input.project}`,
          );
        default:
          break;
      }
      // Idempotent by key: a repeated create returns the issue that already carries the key.
      const existing = await store.findByKey(connectionId, key);
      const ref = existing ?? (await store.insertIssue(connectionId, input));
      if (mode === 'timeout_after_success') {
        await store.logCall(connectionId, 'create', key, `timeout_after_success:${ref.key}`);
        throw new ConnectorError('timeout_ambiguous', MESSAGES.timeout);
      }
      await store.logCall(
        connectionId,
        'create',
        key,
        existing ? `existing:${ref.key}` : `created:${ref.key}`,
      );
      return ref;
    },

    async findByIdempotencyKey(idempotencyKey): Promise<ExternalTaskRef | null> {
      const mode = await store.nextFault(connectionId, null, 'find');
      if (mode === 'token_expired') return failConnection('find', idempotencyKey);
      const ref = await store.findByKey(connectionId, idempotencyKey);
      await store.logCall(connectionId, 'find', idempotencyKey, ref ? `found:${ref.key}` : 'not_found');
      return ref;
    },
  };
}
