/** Test helpers: a Jira config and a stored credential pointed at the local mock server. */
import { jiraConfigFromEnv, type JiraConfig } from './config';
import { generateTokenKey } from './crypto';
import { exchangeCode } from './oauth';
import type { JiraCredential } from './store';
import type { MockJira } from './mock-server';

export const TEST_REDIRECT_URI = 'http://127.0.0.1:5173/admin/connections';

export function mockJiraConfig(
  mock: Pick<MockJira, 'url' | 'clientId' | 'clientSecret'>,
  over: Partial<JiraConfig> = {},
): JiraConfig {
  const r = jiraConfigFromEnv({
    JIRA_CLIENT_ID: mock.clientId,
    JIRA_CLIENT_SECRET: mock.clientSecret,
    JIRA_REDIRECT_URI: TEST_REDIRECT_URI,
    JIRA_API_BASE_URL: mock.url,
    CONNECTOR_TOKEN_KEY: generateTokenKey(),
  });
  if (!r.ok) throw new Error(r.reason);
  return { ...r.config, ...over };
}

/** A credential as a completed authorization stores it (tokens issued by the mock). */
export async function authorizedCredential(
  mock: MockJira,
  config: JiraConfig,
  over: Partial<JiraCredential> = {},
): Promise<JiraCredential> {
  const tokens = await exchangeCode(config, fetch, mock.issueCode(config.redirectUri));
  return {
    connectionId: '00000000-0000-4000-8000-0000000000c1',
    tenantId: '00000000-0000-4000-8000-0000000000a1',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
    siteUrl: mock.siteUrl,
    cloudId: mock.cloudId,
    accountId: 'acc-integration',
    accountDisplayName: 'Growth OS integration',
    revokedAt: null,
    ...over,
  };
}

/** The environment that turns Jira on against the mock (test values only). */
export function mockJiraEnv(
  mock: Pick<MockJira, 'url' | 'clientId' | 'clientSecret'>,
  over: Record<string, string> = {},
): Record<string, string> {
  return {
    TASK_CONNECTOR: 'jira',
    JIRA_CLIENT_ID: mock.clientId,
    JIRA_CLIENT_SECRET: mock.clientSecret,
    JIRA_REDIRECT_URI: TEST_REDIRECT_URI,
    JIRA_API_BASE_URL: mock.url,
    CONNECTOR_TOKEN_KEY: generateTokenKey(),
    ...over,
  };
}

const JIRA_ENV_NAMES = [
  'TASK_CONNECTOR',
  'JIRA_CLIENT_ID',
  'JIRA_CLIENT_SECRET',
  'JIRA_REDIRECT_URI',
  'JIRA_API_BASE_URL',
  'JIRA_AUTH_BASE_URL',
  'JIRA_TIMEOUT_MS',
  'CONNECTOR_TOKEN_KEY',
  'CONNECTOR_TOKEN_KEY_PREVIOUS',
] as const;

/** Set the Jira variables in `process.env`; returns a function that restores the previous values. */
export function applyJiraEnv(values: Record<string, string>): () => void {
  const saved = Object.fromEntries(JIRA_ENV_NAMES.map((k) => [k, process.env[k]]));
  for (const k of JIRA_ENV_NAMES) delete process.env[k];
  Object.assign(process.env, values);
  return () => {
    for (const k of JIRA_ENV_NAMES) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
}

/** Follow the consent URL on the mock (auto-approve) and return the code and state it redirects with. */
export async function consent(
  authorizeUrlText: string,
): Promise<{ code: string; state: string; redirect: URL }> {
  const res = await fetch(authorizeUrlText, { redirect: 'manual' });
  if (res.status !== 302) throw new Error(`consent failed: ${res.status}`);
  const redirect = new URL(res.headers.get('location')!);
  return { code: redirect.searchParams.get('code')!, state: redirect.searchParams.get('state')!, redirect };
}
