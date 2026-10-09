/**
 * Fault-rule matching for the simulated task tool (pure; shared by the memory and Postgres stores).
 *
 *   token_expired          connection-level and sticky: every operation fails until the rule is
 *                          removed ("reconnected"). `remaining` is not consumed.
 *   timeout_after_success  create only: the issue is created, then the call times out
 *   http_5xx               create only: server error, nothing created
 *   permission_denied      create only: e.g. assignee not a member of the project
 *   rate_limited           create only: retry after `retryAfterMs`
 *
 * A rule matches when every match field it sets matches: `titleContains` (substring of the title),
 * `assignee` (exact external assignee), `nthCall` (1-based index of create calls on the connection,
 * this call included). Non-sticky rules apply while `remaining > 0` and consume one per hit.
 */
import type { ExternalTaskInput } from '../task-connector';
import type { SimFaultMode } from './simulated-connector';

export type SimOperation = 'create' | 'find' | 'preview' | 'health';

export interface SimFaultMatch {
  titleContains?: string;
  assignee?: string;
  nthCall?: number;
}

export interface StoredFaultRule {
  id: string;
  mode: SimFaultMode;
  match: SimFaultMatch;
  remaining: number;
}

export const SIM_FAULT_MODES: readonly SimFaultMode[] = [
  'timeout_after_success',
  'http_5xx',
  'permission_denied',
  'token_expired',
  'rate_limited',
];

/** Sticky, connection-level modes apply to every operation and are never consumed. */
export function isStickyMode(mode: SimFaultMode): boolean {
  return mode === 'token_expired';
}

export function ruleApplies(
  rule: StoredFaultRule,
  input: ExternalTaskInput | null,
  operation: SimOperation,
  createCallIndex: number,
): boolean {
  if (isStickyMode(rule.mode)) return true;
  if (operation !== 'create' || rule.remaining <= 0) return false;
  const m = rule.match;
  if (m.titleContains !== undefined && !(input?.title ?? '').includes(m.titleContains)) return false;
  if (m.assignee !== undefined && (input?.assignee ?? null) !== m.assignee) return false;
  if (m.nthCall !== undefined && createCallIndex !== m.nthCall) return false;
  return true;
}

/** Normalise a stored `match` JSON value (unknown keys dropped). */
export function parseMatch(raw: unknown): SimFaultMatch {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: SimFaultMatch = {};
  if (typeof o.titleContains === 'string') out.titleContains = o.titleContains;
  if (typeof o.assignee === 'string') out.assignee = o.assignee;
  if (typeof o.nthCall === 'number') out.nthCall = o.nthCall;
  return out;
}

/** Jira-like key prefix for a project: "PIL" → "PIL", "ME-VAL" → "VAL" (VAL-1 … in the fixture). */
export function issueKeyPrefix(project: string): string {
  const parts = project.split('-').filter(Boolean);
  return parts[parts.length - 1] ?? project;
}
