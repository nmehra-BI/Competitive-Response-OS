/**
 * Jira Cloud adapter configuration (D-121, D-135). Read from the environment by the factory; tests
 * pass a config object directly. Secrets (client secret, token key) live only in memory here and are
 * never logged, serialized into errors or returned by the API.
 *
 *   TASK_CONNECTOR=jira     turn the Jira Cloud adapter on (the simulated connector stays the default)
 *   JIRA_CLIENT_ID          OAuth 2.0 (3LO) app client id
 *   JIRA_CLIENT_SECRET      OAuth 2.0 (3LO) app client secret
 *   JIRA_REDIRECT_URI       <web origin>/admin/connections (registered on the app; exact match)
 *   JIRA_API_BASE_URL       https://api.atlassian.com (tests: the local mock Jira server)
 *   JIRA_AUTH_BASE_URL      optional; https://auth.atlassian.com, or JIRA_API_BASE_URL when that is
 *                           not the Atlassian default (the mock serves both)
 *   CONNECTOR_TOKEN_KEY     base64 32-byte key, AES-256-GCM for stored tokens
 *   CONNECTOR_TOKEN_KEY_PREVIOUS  optional; the key before a rotation (decrypt only)
 */
import { parseTokenKey, type TokenKey } from './crypto';

export const JIRA_CLOUD_PROVIDER = 'jira_cloud';

/** Minimal scopes (D-121 §2): read and write Jira work, read users, refresh tokens. */
export const JIRA_SCOPES = ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'] as const;

/** Issue entity property that carries our idempotency key (D-121 §4). */
export const IDEMPOTENCY_PROPERTY = 'growth-os.idempotency';

/** Label that carries the idempotency key, so a JQL label search finds the issue (see adapter). */
export function idempotencyLabel(idempotencyKey: string): string {
  return `growth-os-key-${idempotencyKey}`;
}

/** OAuth state lifetime (WAVE4 E5): ten minutes, single use. */
export const OAUTH_STATE_TTL_MS = 10 * 60_000;

/** Refresh the access token when it expires within this window. */
export const REFRESH_SKEW_MS = 60_000;

/** Request timeout for Jira calls; a timed-out write is ambiguous and is reconciled first. */
export const DEFAULT_TIMEOUT_MS = 15_000;

export const ATLASSIAN_API_BASE_URL = 'https://api.atlassian.com';
export const ATLASSIAN_AUTH_BASE_URL = 'https://auth.atlassian.com';

export interface JiraConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBaseUrl: string;
  authBaseUrl: string;
  tokenKey: TokenKey;
  previousTokenKeys: TokenKey[];
  timeoutMs: number;
}

export type JiraConfigResult = { ok: true; config: JiraConfig } | { ok: false; reason: string };

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/** Parse the Jira configuration. The reason names the missing variable, never a value. */
export function jiraConfigFromEnv(env: Readonly<Record<string, string | undefined>>): JiraConfigResult {
  const missing = ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET', 'JIRA_REDIRECT_URI', 'CONNECTOR_TOKEN_KEY'].filter(
    (k) => !env[k],
  );
  if (missing.length) return { ok: false, reason: `Jira Cloud is not configured (${missing.join(', ')}).` };
  let tokenKey: TokenKey;
  const previousTokenKeys: TokenKey[] = [];
  try {
    tokenKey = parseTokenKey(env.CONNECTOR_TOKEN_KEY!);
    if (env.CONNECTOR_TOKEN_KEY_PREVIOUS)
      previousTokenKeys.push(parseTokenKey(env.CONNECTOR_TOKEN_KEY_PREVIOUS));
  } catch {
    return { ok: false, reason: 'CONNECTOR_TOKEN_KEY must be a base64-encoded 32-byte key.' };
  }
  const apiBaseUrl = trimSlash(env.JIRA_API_BASE_URL || ATLASSIAN_API_BASE_URL);
  const authBaseUrl = trimSlash(
    env.JIRA_AUTH_BASE_URL || (apiBaseUrl === ATLASSIAN_API_BASE_URL ? ATLASSIAN_AUTH_BASE_URL : apiBaseUrl),
  );
  const timeout = Number(env.JIRA_TIMEOUT_MS);
  return {
    ok: true,
    config: {
      clientId: env.JIRA_CLIENT_ID!,
      clientSecret: env.JIRA_CLIENT_SECRET!,
      redirectUri: env.JIRA_REDIRECT_URI!,
      apiBaseUrl,
      authBaseUrl,
      tokenKey,
      previousTokenKeys,
      timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    },
  };
}

/**
 * Is the Jira Cloud adapter on for this process? Only `TASK_CONNECTOR=jira` turns it on (D-135, strict;
 * decisions.md D-143). A deployment sets the same value for the API and the worker; the Jira
 * configuration alone never turns it on, so a stray secret cannot switch a process to a live tool.
 */
export function jiraRequested(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.TASK_CONNECTOR === 'jira';
}
