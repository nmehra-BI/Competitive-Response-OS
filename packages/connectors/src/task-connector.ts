/**
 * TaskConnector — the interface every task-tool adapter implements (simulated now, Jira later).
 * Used only by the outbox worker and the preview endpoint. Never by the analysis agent.
 *
 * Contract:
 *  - createTask MUST attach the idempotency key to the external record (Jira: an issue property and
 *    a label) so `findByIdempotencyKey` can reconcile after an ambiguous timeout.
 *  - A thrown ConnectorError says exactly one of: retryable, permanent for this task, or
 *    connection-level (pause everything for this connection).
 *  - `preview` performs no writes: it validates project, issue type, assignee mapping and permission.
 */

export interface ExternalTaskInput {
  idempotencyKey: string; // sha256(tenant|plan_version|task|destination), stable across retries
  project: string; // e.g. "PIL"
  issueType: string;
  title: string;
  description: string; // includes the case reference, e.g. "ME-104 · G2 v3"
  assignee: string | null; // external account id or email from the mapping
  dueOn: string | null;
  labels: string[];
  links: { caseKey: string; gateLabel: string; url: string };
}

export interface ExternalTaskRef {
  key: string; // "PIL-11"
  url: string;
}

export interface PreviewItemResult {
  title: string;
  assignee: string | null;
  fields: Record<string, string>;
  problems: string[]; // e.g. "assignee [Operations lead] is not a member of project PIL"
  /**
   * Machine-readable reasons, one per entry in `problems` where known (D-134, additive). The S14 mapping
   * check reads `assignee_not_found` as "Not found"; every adapter (simulated, Jira Cloud) should set them.
   */
  problemCodes?: PreviewProblemCode[];
}

export type PreviewProblemCode =
  | 'project_not_found'
  | 'issue_type_not_found'
  | 'assignee_not_found'
  | 'assignee_not_in_project'
  | 'permission_denied';

export interface ConnectorHealth {
  status: 'connected' | 'expired' | 'missing_permission' | 'unavailable';
  checkedAt: string;
  message: string | null;
}

export type ConnectorErrorKind =
  | 'timeout_ambiguous' // the write may have happened: reconcile before retry
  | 'transient' // 5xx, network reset before send completed
  | 'rate_limited' // retry after `retryAfterMs`
  | 'permission_denied' // permanent for this task until fixed (e.g. assignee not in project)
  | 'validation' // permanent for this task (bad field)
  | 'token_expired' // connection-level: pause all sends for this connection
  | 'unavailable'; // connection-level outage

export class ConnectorError extends Error {
  constructor(
    readonly kind: ConnectorErrorKind,
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }

  get retryable(): boolean {
    return this.kind === 'transient' || this.kind === 'rate_limited' || this.kind === 'timeout_ambiguous';
  }

  get connectionLevel(): boolean {
    return this.kind === 'token_expired' || this.kind === 'unavailable';
  }
}

export interface TaskConnector {
  readonly provider: string; // "jira_simulated" | "jira_cloud"
  health(): Promise<ConnectorHealth>;
  preview(items: readonly ExternalTaskInput[]): Promise<PreviewItemResult[]>;
  /** Idempotent by `input.idempotencyKey`: a second call with the same key returns the same ref. */
  createTask(input: ExternalTaskInput): Promise<ExternalTaskRef>;
  findByIdempotencyKey(idempotencyKey: string): Promise<ExternalTaskRef | null>;
}
