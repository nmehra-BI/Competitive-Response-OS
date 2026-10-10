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
