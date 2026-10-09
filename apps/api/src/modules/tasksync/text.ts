/**
 * Pure copy and export helpers for task sync (unit-tested). Honest sync: the summary counts each
 * task's own external status; "confirmed" counts only tasks with a returned key.
 */
import {
  SYNC_STATUS_LABELS,
  TASK_STATUS_LABELS,
  type SyncStatus,
  type TaskStatus,
} from '@growth-os/contracts';

export interface SyncCount {
  status: SyncStatus;
  lastErrorCode: string | null;
}

export interface SyncSummary {
  total: number;
  confirmed: number;
  failed: number;
  pending: number;
  paused: number;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** "permission" for `permission_denied`, used in "1 failed (permission)". */
export function failureReason(code: string | null): string {
  switch (code) {
    case 'permission_denied':
      return 'permission';
    case 'validation':
      return 'validation';
    case 'actor_not_authorized':
      return 'sender no longer authorized';
    case 'attempts_exhausted':
    case 'http_5xx':
    case 'rate_limited':
    case 'timeout':
      return 'task tool unavailable';
    default:
      return code ?? 'unknown';
  }
}

export function summarize(rows: readonly SyncCount[]): SyncSummary {
  const by = (pred: (s: SyncStatus) => boolean) => rows.filter((r) => pred(r.status)).length;
  const confirmed = by((s) => s === 'confirmed');
  const failed = by((s) => s === 'failed');
  const paused = by((s) => s === 'paused_approval_changed' || s === 'paused_connector');
  return {
    total: rows.length,
    confirmed,
    failed,
    paused,
    pending: rows.length - confirmed - failed - paused,
  };
}

/** "5 of 6 tasks confirmed in Jira · 1 failed (permission)" — one clause per non-zero group. */
export function summaryText(rows: readonly SyncCount[], tool: string): string {
  const total = rows.length;
  if (total === 0) return 'No tasks';
  const count = (...s: SyncStatus[]) => rows.filter((r) => s.includes(r.status)).length;
  const unsent = count('not_sent', 'in_preview');
  if (unsent === total) return `${total} ${plural(total, 'task', 'tasks')} not sent to ${tool}`;
  const parts = [`${count('confirmed')} of ${total} ${plural(total, 'task', 'tasks')} confirmed in ${tool}`];
  const failed = rows.filter((r) => r.status === 'failed');
  if (failed.length > 0) {
    const reasons = [...new Set(failed.map((r) => failureReason(r.lastErrorCode)))];
    parts.push(`${failed.length} failed${reasons.length === 1 ? ` (${reasons[0]})` : ''}`);
  }
  const sending = count('sending', 'retry_scheduled');
  if (sending) parts.push(`${sending} sending`);
  const checking = count('checking');
  if (checking) parts.push(`${checking} checking`);
  const approval = count('paused_approval_changed');
  if (approval) parts.push(`${approval} paused — approval changed`);
  const connector = count('paused_connector');
  if (connector) parts.push(`${connector} paused — connection expired`);
  if (unsent) parts.push(`${unsent} not sent`);
  return parts.join(' · ');
}

/** Tool name for copy: every Jira adapter reads "Jira". */
export function toolLabel(provider: string, connectionName: string): string {
  return provider.startsWith('jira') ? 'Jira' : connectionName;
}

/** "Task 1", "Tasks 4, 5", "—". */
export function dependsOnLabel(ordinals: readonly number[]): string {
  if (ordinals.length === 0) return '—';
  const sorted = [...ordinals].sort((a, b) => a - b);
  return `${sorted.length === 1 ? 'Task' : 'Tasks'} ${sorted.join(', ')}`;
}

// ---------------------------------------------------------------------------
// CSV export (outage fallback, PRD §10)
// ---------------------------------------------------------------------------

export interface CsvTask {
  ordinal: number;
  title: string;
  milestone: string | null;
  function: string;
  owner: string | null;
  assignee: string | null;
  dueOn: string | null;
  dueRule: string | null;
  deliverable: string;
  dependsOn: string;
  conditionKey: string | null;
  status: TaskStatus;
  syncStatus: SyncStatus;
  externalKey: string | null;
  reference: string | null;
}

export const CSV_HEADER = [
  'Task',
  'Title',
  'Milestone',
  'Function',
  'Owner',
  'Assignee',
  'Due',
  'Due rule',
  'Deliverable',
  'Depends on',
  'Condition',
  'Internal status',
  'External status',
  'External key',
  'Reference',
] as const;

/** Quote per RFC 4180 and neutralise spreadsheet formulas (a leading = + - @ tab or CR). */
export function csvCell(value: string | number | null): string {
  let s = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tasksCsv(tasks: readonly CsvTask[]): string {
  const rows = tasks.map((t) =>
    [
      `Task ${t.ordinal}`,
      t.title,
      t.milestone,
      t.function,
      t.owner,
      t.assignee,
      t.dueOn,
      t.dueRule,
      t.deliverable,
      t.dependsOn,
      t.conditionKey,
      TASK_STATUS_LABELS[t.status],
      SYNC_STATUS_LABELS[t.syncStatus],
      t.externalKey,
      t.reference,
    ].map(csvCell),
  );
  return [CSV_HEADER.map(csvCell), ...rows].map((r) => r.join(',')).join('\r\n') + '\r\n';
}
