/**
 * OAuth 2.0 (3LO) against the local mock authorization server: consent URL and scopes, one-time
 * state, code exchange (single use), refresh-token rotation, accessible resources → cloud id.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JIRA_SCOPES, jiraConfigFromEnv, jiraRequested, type JiraConfig } from './config';
import { startMockJira, type MockJira } from './mock-server';
import {
  accessibleResources,
  authorizeUrl,
  connectionIdOfState,
  exchangeCode,
  newOAuthState,
  normaliseSiteUrl,
  OAuthGrantError,
  OAuthUnavailableError,
  refreshTokens,
} from './oauth';
import { mockJiraConfig } from './testing';

let mock: MockJira;
let config: JiraConfig;
const CONN = '6f1d3b52-9c1e-4b8a-a1f0-1c2d3e4f5a6b';

beforeAll(async () => {
  mock = await startMockJira();
  config = mockJiraConfig(mock);
});
afterAll(async () => {
  await mock.close();
});

describe('consent URL and state', () => {
  it('asks for exactly the minimal scopes as the integration account', () => {
    const state = newOAuthState(CONN);
    const url = new URL(authorizeUrl(config, state));
    expect(`${url.origin}${url.pathname}`).toBe(`${mock.url}/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      audience: 'api.atlassian.com',
      client_id: mock.clientId,
      scope: 'read:jira-work write:jira-work read:jira-user offline_access',
      redirect_uri: config.redirectUri,
      state,
      response_type: 'code',
      prompt: 'consent',
    });
    expect(JIRA_SCOPES).toEqual(['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access']);
    // The client secret never appears in a URL.
    expect(url.toString()).not.toContain(mock.clientSecret);
  });

  it('a state is unguessable, unique and carries its connection id', () => {
    const a = newOAuthState(CONN);
    const b = newOAuthState(CONN);
    expect(a).not.toBe(b);
    expect(connectionIdOfState(a)).toBe(CONN);
    expect(a.split('.')[1]).toHaveLength(43); // 32 random bytes, base64url
    expect(connectionIdOfState('not-a-state')).toBeNull();
    expect(connectionIdOfState(`${CONN}.short`)).toBeNull();
  });

  it('the mock consent redirects back with a code and the same state', async () => {
    const state = newOAuthState(CONN);
    const res = await fetch(authorizeUrl(config, state), { redirect: 'manual' });
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location')!);
    expect(`${to.origin}${to.pathname}`).toBe(config.redirectUri);
    expect(to.searchParams.get('state')).toBe(state);
    expect(to.searchParams.get('code')).toMatch(/^code-/);
  });
});

describe('code exchange and refresh', () => {
  it('exchanges a code once; the scopes are recorded', async () => {
    const code = mock.issueCode(config.redirectUri);
    const now = new Date();
    const t = await exchangeCode(config, fetch, code, now);
    expect(t.accessToken).toMatch(/^at-/);
    expect(t.refreshToken).toMatch(/^rt-/);
    expect(t.expiresAt.getTime()).toBe(now.getTime() + 3600_000);
    expect(t.scopes).toEqual([...JIRA_SCOPES]);
    await expect(exchangeCode(config, fetch, code)).rejects.toBeInstanceOf(OAuthGrantError);
    await expect(exchangeCode(config, fetch, 'code-forged')).rejects.toBeInstanceOf(OAuthGrantError);
  });

  it('a code issued for another redirect URI is refused', async () => {
    const code = mock.issueCode('https://evil.example/cb');
    await expect(exchangeCode(config, fetch, code)).rejects.toBeInstanceOf(OAuthGrantError);
  });

  it('refresh rotates the refresh token: the old one is spent', async () => {
    const first = await exchangeCode(config, fetch, mock.issueCode(config.redirectUri));
    const second = await refreshTokens(config, fetch, first.refreshToken!);
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(refreshTokens(config, fetch, first.refreshToken!)).rejects.toBeInstanceOf(OAuthGrantError);
    const third = await refreshTokens(config, fetch, second.refreshToken!);
    expect(third.accessToken).toMatch(/^at-/);
  });

  it('a revoked grant cannot refresh (→ Expired); an outage is not a revocation', async () => {
    const t = await exchangeCode(config, fetch, mock.issueCode(config.redirectUri));
    mock.setFaults([{ mode: 'http_5xx', match: { op: 'token' }, times: 1 }]);
    await expect(refreshTokens(config, fetch, t.refreshToken!)).rejects.toBeInstanceOf(OAuthUnavailableError);
    mock.setFaults([{ mode: 'token_expired' }]);
    await expect(refreshTokens(config, fetch, t.refreshToken!)).rejects.toBeInstanceOf(OAuthGrantError);
    mock.setFaults([]);
    // Clearing the fault does not revive revoked tokens: a new authorization is needed.
    await expect(refreshTokens(config, fetch, t.refreshToken!)).rejects.toBeInstanceOf(OAuthGrantError);
  });

  it('a wrong client secret is refused', async () => {
    const bad = { ...config, clientSecret: 'wrong' };
    await expect(exchangeCode(bad, fetch, mock.issueCode(config.redirectUri))).rejects.toBeInstanceOf(
      OAuthGrantError,
    );
  });

  it('accessible resources give the cloud id of the configured site', async () => {
    const t = await exchangeCode(config, fetch, mock.issueCode(config.redirectUri));
    const sites = await accessibleResources(config, fetch, t.accessToken);
    expect(sites).toEqual([
      { id: mock.cloudId, url: mock.siteUrl, name: 'aster-industrial', scopes: [...JIRA_SCOPES] },
    ]);
    expect(normaliseSiteUrl('https://Aster-Industrial.atlassian.net/')).toBe(normaliseSiteUrl(mock.siteUrl));
    await expect(accessibleResources(config, fetch, 'at-forged')).rejects.toBeInstanceOf(OAuthGrantError);
  });
});

describe('configuration', () => {
  const full = {
    JIRA_CLIENT_ID: 'id',
    JIRA_CLIENT_SECRET: 'secret',
    JIRA_REDIRECT_URI: 'http://localhost:5173/admin/connections',
    CONNECTOR_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64'),
  };

  it('is off by default and on with TASK_CONNECTOR=jira or a complete configuration', () => {
    expect(jiraRequested({})).toBe(false);
    expect(jiraRequested({ TASK_CONNECTOR: 'simulated' })).toBe(false);
    expect(jiraRequested({ TASK_CONNECTOR: 'jira' })).toBe(true);
    expect(jiraRequested({ TASK_CONNECTOR: 'simulated', ...full })).toBe(true);
    expect(jiraRequested({ ...full, CONNECTOR_TOKEN_KEY: '' })).toBe(false);
  });

  it('names what is missing, never a value; defaults to the Atlassian hosts', () => {
    const r = jiraConfigFromEnv({ JIRA_CLIENT_SECRET: 'top-secret' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('JIRA_CLIENT_ID');
      expect(r.reason).not.toContain('top-secret');
    }
    const bad = jiraConfigFromEnv({ ...full, CONNECTOR_TOKEN_KEY: 'c2hvcnQ=' });
    expect(bad).toEqual({ ok: false, reason: 'CONNECTOR_TOKEN_KEY must be a base64-encoded 32-byte key.' });
    const ok = jiraConfigFromEnv(full);
    expect(ok.ok && ok.config.apiBaseUrl).toBe('https://api.atlassian.com');
    expect(ok.ok && ok.config.authBaseUrl).toBe('https://auth.atlassian.com');
    const local = jiraConfigFromEnv({ ...full, JIRA_API_BASE_URL: 'http://127.0.0.1:4762/' });
    expect(local.ok && local.config.authBaseUrl).toBe('http://127.0.0.1:4762');
  });
});
