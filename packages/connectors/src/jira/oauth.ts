/**
 * OAuth 2.0 authorization code grant (3LO) for the dedicated Jira integration account (D-121 §2).
 *
 *   1. `newOAuthState` + `authorizeUrl`: the consent URL with the minimal scopes and a one-time state.
 *      The state is `<connection id>.<32 random bytes>`; only its sha256 is stored (single use, ten
 *      minutes). The connection id prefix lets the S14 page find the connection when Atlassian
 *      redirects back to the one registered redirect URI.
 *   2. `exchangeCode`: code → access + refresh token (server side, with the client secret).
 *   3. `accessibleResources`: the Jira sites the grant covers → the cloud id of the configured site.
 *   4. `refreshTokens`: rotating refresh tokens; a refused refresh means the grant is gone
 *      (revoked, or the integration account lost access) → the connection is Expired.
 *
 * PKCE is not used: this is a confidential client (the code is exchanged server side with the
 * client secret), and the single-use, hashed, short-lived state binds the callback to the admin who
 * started it (W4-E5 notes).
 */
import { randomBytes } from 'node:crypto';
import { JIRA_SCOPES, type JiraConfig } from './config';
import { httpRequest, JiraTransportError, type FetchLike } from './http';

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
}

export interface AccessibleResource {
  id: string; // cloud id
  url: string; // https://<site>.atlassian.net
  name: string;
  scopes: string[];
}

/** The grant was refused (bad or used code, revoked or rotated-away refresh token). */
export class OAuthGrantError extends Error {
  constructor(message = 'Jira refused the authorization grant.') {
    super(message);
    this.name = 'OAuthGrantError';
  }
}

/** The authorization server could not be reached or failed (retry later). */
export class OAuthUnavailableError extends Error {
  constructor(message = 'The Atlassian authorization service is not available.') {
    super(message);
    this.name = 'OAuthUnavailableError';
  }
}

const STATE_RE = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;

export function newOAuthState(connectionId: string): string {
  return `${connectionId}.${randomBytes(32).toString('base64url')}`;
}

/** The connection id carried in a state, or null when the state is malformed. */
export function connectionIdOfState(state: string): string | null {
  return STATE_RE.exec(state)?.[1] ?? null;
}

export function authorizeUrl(config: JiraConfig, state: string): string {
  const q = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: config.clientId,
    scope: JIRA_SCOPES.join(' '),
    redirect_uri: config.redirectUri,
    state,
    response_type: 'code',
    prompt: 'consent',
  });
  return `${config.authBaseUrl}/authorize?${q.toString()}`;
}

async function tokenRequest(
  config: JiraConfig,
  fetchImpl: FetchLike,
  body: Record<string, string>,
  now: Date,
): Promise<TokenSet> {
  let res;
  try {
    res = await httpRequest(
      fetchImpl,
      `${config.authBaseUrl}/oauth/token`,
      { method: 'POST', body: { ...body, client_id: config.clientId, client_secret: config.clientSecret } },
      config.timeoutMs,
    );
  } catch (e) {
    if (e instanceof JiraTransportError) throw new OAuthUnavailableError();
    throw e;
  }
  if (res.status >= 500 || res.status === 429) throw new OAuthUnavailableError();
  if (res.status !== 200) throw new OAuthGrantError();
  const b = (res.body ?? {}) as Record<string, unknown>;
  if (typeof b.access_token !== 'string' || typeof b.expires_in !== 'number')
    throw new OAuthGrantError('Jira returned an unexpected token response.');
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === 'string' ? b.refresh_token : null,
    expiresAt: new Date(now.getTime() + b.expires_in * 1000),
    scopes: typeof b.scope === 'string' ? b.scope.split(' ').filter(Boolean) : [],
  };
}

export function exchangeCode(
  config: JiraConfig,
  fetchImpl: FetchLike,
  code: string,
  now = new Date(),
): Promise<TokenSet> {
  return tokenRequest(
    config,
    fetchImpl,
    { grant_type: 'authorization_code', code, redirect_uri: config.redirectUri },
    now,
  );
}

/** Refresh with rotation: the answer carries a new refresh token that replaces the old one. */
export async function refreshTokens(
  config: JiraConfig,
  fetchImpl: FetchLike,
  refreshToken: string,
  now = new Date(),
): Promise<TokenSet> {
  const t = await tokenRequest(
    config,
    fetchImpl,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    now,
  );
  return { ...t, refreshToken: t.refreshToken ?? refreshToken };
}

export async function accessibleResources(
  config: JiraConfig,
  fetchImpl: FetchLike,
  accessToken: string,
): Promise<AccessibleResource[]> {
  let res;
  try {
    res = await httpRequest(
      fetchImpl,
      `${config.apiBaseUrl}/oauth/token/accessible-resources`,
      { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } },
      config.timeoutMs,
    );
  } catch (e) {
    if (e instanceof JiraTransportError) throw new OAuthUnavailableError();
    throw e;
  }
  if (res.status === 401 || res.status === 403) throw new OAuthGrantError();
  if (res.status !== 200 || !Array.isArray(res.body)) throw new OAuthUnavailableError();
  return (res.body as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    url: String(r.url),
    name: String(r.name ?? ''),
    scopes: Array.isArray(r.scopes) ? r.scopes.map(String) : [],
  }));
}

/** Normalise a site URL for comparison ("https://aster.atlassian.net/" → "https://aster.atlassian.net"). */
export function normaliseSiteUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return url.replace(/\/+$/, '').toLowerCase();
  }
}
