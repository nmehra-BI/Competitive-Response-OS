/**
 * HTTP for the Jira Cloud adapter: one request helper with a timeout, and the pure mapping from an
 * HTTP outcome to the typed `ConnectorError` the outbox understands (WAVE4 E5):
 *
 *   401                      → token_expired      (after one refresh attempt; connection-level: pause)
 *   403                      → permission_denied  (permanent for the task until fixed)
 *   404 project / issue type → validation         (permanent for the task: fix the mapping)
 *   400 assignee             → permission_denied  ("assignee … is not a member of project …")
 *   400 other                → validation
 *   429                      → rate_limited       (retryAfterMs from Retry-After)
 *   5xx                      → transient
 *   timeout or reset on a write → timeout_ambiguous (the issue may exist: reconcile before retry)
 *   timeout or reset on a read  → transient
 *
 * Messages carry project keys, field names and status codes only — never tokens, authorization
 * codes or issue bodies (log-scrubbing release gate).
 */
import { ConnectorError } from '../task-connector';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpResult {
  status: number;
  headers: Headers;
  body: unknown;
}

/** The request failed before an HTTP status arrived. */
export class JiraTransportError extends Error {
  constructor(readonly reason: 'timeout' | 'network') {
    super(reason === 'timeout' ? 'Jira did not answer in time.' : 'The connection to Jira failed.');
    this.name = 'JiraTransportError';
  }
}

export async function httpRequest(
  fetchImpl: FetchLike,
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: unknown },
  timeoutMs: number,
): Promise<HttpResult> {
  const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: init.method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    throw new JiraTransportError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
  }
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    throw new JiraTransportError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
  }
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  return { status: res.status, headers: res.headers, body: parsed };
}

/** Retry-After in ms: delta-seconds or an HTTP date; a missing or odd value falls back to 5 s. */
export function retryAfterMs(value: string | null, now: Date = new Date()): number {
  const fallback = 5_000;
  if (!value) return fallback;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  if (Number.isNaN(at)) return fallback;
  return Math.max(0, at - now.getTime());
}

export interface RequestDescription {
  /** True for requests that may change Jira (create issue, set property). */
  write: boolean;
  /** Business wording for messages, e.g. "create an issue in project PIL". */
  action: string;
  project?: string;
  issueType?: string;
  assignee?: string | null;
}

export const MESSAGES = {
  expired: 'Jira connection expired. Reconnect it or export CSV instead.',
  timeout: 'Jira did not answer in time; the issue may have been created.',
  rateLimited: 'Jira is rate limiting requests.',
} as const;

function jiraErrors(body: unknown): Record<string, string> {
  const e = (body as { errors?: unknown } | null)?.errors;
  return e && typeof e === 'object' ? (e as Record<string, string>) : {};
}

/** Map a non-2xx HTTP result to a ConnectorError (pure; the table above). */
export function connectorErrorFor(
  res: Pick<HttpResult, 'status' | 'headers' | 'body'>,
  d: RequestDescription,
): ConnectorError {
  const s = res.status;
  if (s === 401) return new ConnectorError('token_expired', MESSAGES.expired);
  if (s === 403)
    return new ConnectorError(
      'permission_denied',
      `The Jira integration account is not allowed to ${d.action}.`,
    );
  if (s === 404) {
    const what = d.issueType
      ? `project ${d.project ?? '?'} or issue type ${d.issueType}`
      : `project ${d.project ?? '?'}`;
    return new ConnectorError('validation', `Jira ${what} was not found.`);
  }
  if (s === 429)
    return new ConnectorError(
      'rate_limited',
      MESSAGES.rateLimited,
      retryAfterMs(res.headers.get('retry-after')),
    );
  if (s >= 500) return new ConnectorError('transient', `Jira returned a server error (${s}).`);
  if (s === 400 || s === 422) {
    const fields = Object.keys(jiraErrors(res.body));
    if (fields.includes('assignee'))
      return new ConnectorError(
        'permission_denied',
        `assignee ${d.assignee ?? '(none)'} is not a member of project ${d.project ?? '?'}`,
      );
    if (fields.includes('project'))
      return new ConnectorError('validation', `Jira project ${d.project ?? '?'} was not found.`);
    if (fields.includes('issuetype'))
      return new ConnectorError(
        'validation',
        `Jira issue type ${d.issueType ?? '?'} is not available in project ${d.project ?? '?'}.`,
      );
    return new ConnectorError(
      'validation',
      `Jira refused to ${d.action}${fields.length ? ` (fields: ${fields.sort().join(', ')})` : ''}.`,
    );
  }
  return new ConnectorError('transient', `Jira answered with an unexpected status (${s}).`);
}

/** A transport failure: ambiguous for writes (reconcile first), transient for reads. */
export function connectorErrorForTransport(e: JiraTransportError, d: RequestDescription): ConnectorError {
  if (d.write) return new ConnectorError('timeout_ambiguous', MESSAGES.timeout);
  return new ConnectorError(
    'transient',
    e.reason === 'timeout' ? 'Jira did not answer in time.' : 'The connection to Jira failed.',
  );
}
